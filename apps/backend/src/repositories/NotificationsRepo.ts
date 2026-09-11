import EntriesDAL from "@/data-access-layer/EntriesDAL";
import MetricsDAL from "@/data-access-layer/MetricsDAL";
import NotificationsDAL, { type OpenIntervalEntry } from "@/data-access-layer/NotificationsDAL";
import TrackersDAL from "@/data-access-layer/TrackersDAL";
import UsersDAL from "@/data-access-layer/UsersDAL";
import { factValue } from "@/manifest/Aggregation";
import { dayState, isScheduled, resolveTargetAt } from "@/manifest/Scoring";
import { sendWebPush, type VapidKeys } from "@/providers/webPush";
import AppLogger from "@/providers/logger";
import { localHourIn, utcDateString } from "@/utils/DateTime";
import Utility from "@/utils/Utility";
import * as Schemas from "@app/schemas";

// DEV_NOTE: a Worker invocation has a subrequest ceiling — blowing through it silently truncates
// the last users in the list every hour. CPU is not the constraint (sub-millisecond crypto per
// send); subrequests are. Logged at error if hit, so a growing user base surfaces here before it
// silently drops reminders rather than after.
const MAX_SENDS_PER_INVOCATION = 500;
const SEND_CONCURRENCY = 10;

// DEV_NOTE: the payload cap is ~3800 bytes after encryption overhead (see the plan's open risks).
// A user with more open trackers than this in one day is not the common case this digest serves,
// and the body is truncated here — never in sw.js, which only ever renders whatever it's handed.
const MAX_DIGEST_NAMES = 12;

type ReminderTarget = {
  userId: string;
  trackerPublicId: string;
  trackerName: string;
  dedupKey: string;
};

// DEV_NOTE: the second Repo in this codebase (after OrphanScanRepo) that logs directly rather than
// leaving it to its DAL — "how many notifications went out, which subscriptions got pruned" is this
// feature's own observable output, not incidental error handling around a business-rule failure.
export default class NotificationsRepo {
  private dal: NotificationsDAL;
  private usersDal: UsersDAL;
  private trackersDal: TrackersDAL;
  private entriesDal: EntriesDAL;
  private metricsDal: MetricsDAL;

  constructor(private env: Env) {
    this.dal = new NotificationsDAL(env);
    this.usersDal = new UsersDAL(env);
    this.trackersDal = new TrackersDAL(env);
    this.entriesDal = new EntriesDAL(env);
    this.metricsDal = new MetricsDAL(env);
  }

  private formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hours === 0) return `${mins}m`;
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
  }

  // DEV_NOTE: id/userId/deletedAt/endpoint/p256dh/auth never cross the API boundary — an endpoint is
  // a write capability for that device's push channel, no screen needs it back (see
  // PushSubscriptionApiShape in NotificationsCommon.ts).
  private toApiShape(subscription: Schemas.PushSubscription): Schemas.PushSubscriptionApiShape {
    const {
      id: _id,
      userId: _userId,
      deletedAt: _deletedAt,
      endpoint: _endpoint,
      p256dh: _p256dh,
      auth: _auth,
      ...rest
    } = subscription;
    return rest;
  }

  private vapidKeys(): VapidKeys {
    return {
      publicKey: this.env.VAPID_PUBLIC_KEY,
      privateKey: this.env.VAPID_PRIVATE_KEY,
      subject: this.env.VAPID_SUBJECT,
    };
  }

  getVapidPublicKey(): Schemas.GetVapidPublicKeyApiResponse {
    return {
      isSuccess: true,
      message: "VAPID public key fetched",
      vapidPublicKey: this.env.VAPID_PUBLIC_KEY,
    };
  }

  async createPushSubscription(
    params: Schemas.CreatePushSubscriptionApiRequest & { userId: string },
  ): Promise<Schemas.CreatePushSubscriptionApiResponse> {
    const result = await this.dal.upsertPushSubscription({
      userId: params.userId,
      endpoint: params.subscription.endpoint,
      p256dh: params.subscription.p256dh,
      auth: params.subscription.auth,
      deviceLabel: params.subscription.deviceLabel,
    });
    if (!result.isSuccess || !result.subscription) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Push subscription saved successfully",
      subscription: this.toApiShape(result.subscription),
    };
  }

  async getPushSubscriptions(params: {
    userId: string;
  }): Promise<Schemas.GetPushSubscriptionsApiResponse> {
    const result = await this.dal.getPushSubscriptions(params);
    if (!result.isSuccess || !result.subscriptions) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Push subscriptions fetched successfully",
      subscriptions: result.subscriptions.map((subscription) => this.toApiShape(subscription)),
    };
  }

  async deletePushSubscription(params: {
    userId: string;
    publicId: string;
  }): Promise<Schemas.ApiResponse> {
    return await this.dal.deletePushSubscription(params);
  }

  async getNotificationPrefs(params: {
    userId: string;
  }): Promise<Schemas.GetNotificationPrefsApiResponse> {
    const result = await this.dal.getNotificationPrefs(params);
    if (!result.isSuccess) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Notification prefs fetched successfully",
      prefs: { ...Schemas.NOTIFICATION_PREFS_DEFAULTS, ...result.prefs },
    };
  }

  async updateNotificationPrefs(
    params: Schemas.UpdateNotificationPrefsApiRequest & { userId: string },
  ): Promise<Schemas.UpdateNotificationPrefsApiResponse> {
    const { userId, ...fields } = params;
    const result = await this.dal.upsertNotificationPrefs({ userId, fields });
    if (!result.isSuccess || !result.prefs) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Notification prefs saved successfully",
      prefs: result.prefs,
    };
  }

  // DEV_NOTE: crons are production-only, so this is the only way to exercise push end to end in
  // staging, and it doubles as the settings screen's "Send a test notification" button. Sends to
  // every one of the user's active subscriptions (usually one, sometimes a couple of devices) rather
  // than a single targeted device — there is no per-device "test" affordance in the UI, and testing
  // "is push wired up for me" is naturally a question about every device, not one.
  // DEV_NOTE: shared by sendTestNotification and runHourlyDispatch's fan-out — "send this payload to
  // every one of this user's subscriptions, pruning the dead ones" is the same operation whether the
  // caller is a button press or a cron. userId is only for the log lines; it never enters the send.
  private async sendToSubscriptions(
    userId: string,
    subscriptions: { endpoint: string; p256dh: string; auth: string }[],
    payload: Schemas.PushPayload,
    vapid: VapidKeys,
  ): Promise<{ delivered: number; pruned: number }> {
    let delivered = 0;
    let pruned = 0;

    for (const subscription of subscriptions) {
      const result = await sendWebPush({
        target: {
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        payload: JSON.stringify(payload),
        vapid,
      });

      if (result.isDelivered) {
        delivered++;
      } else if (result.isGone) {
        await this.dal.pruneSubscriptionByEndpoint({ endpoint: subscription.endpoint });
        pruned++;
      } else if (result.isMisconfigured) {
        AppLogger.error({
          category: Schemas.LogCategory.Repo,
          action: Schemas.LogAction.SendWebPush,
          message: `Push send misconfigured (status ${result.status})`,
          metadata: { userId, status: result.status, body: result.body },
        });
      } else {
        // Transient (429/5xx) — the row is left alone, but still worth a signal if it keeps happening.
        AppLogger.warn({
          category: Schemas.LogCategory.Repo,
          action: Schemas.LogAction.SendWebPush,
          message: `Push send failed transiently (status ${result.status})`,
          metadata: { userId, status: result.status },
        });
      }
    }

    return { delivered, pruned };
  }

  async sendTestNotification(params: { userId: string }): Promise<Schemas.ApiResponse> {
    const subscriptionsResult = await this.dal.getPushSubscriptions({ userId: params.userId });
    if (!subscriptionsResult.isSuccess || !subscriptionsResult.subscriptions) {
      return { isSuccess: false, message: subscriptionsResult.message };
    }
    if (subscriptionsResult.subscriptions.length === 0) {
      return { isSuccess: false, message: "No push subscriptions to send to" };
    }

    const payload: Schemas.PushPayload = {
      title: "Crux",
      body: "Test notification — push is wired up correctly.",
      url: "/trackers",
      tag: "test",
    };

    const { delivered, pruned } = await this.sendToSubscriptions(
      params.userId,
      subscriptionsResult.subscriptions,
      payload,
      this.vapidKeys(),
    );

    AppLogger.info({
      category: Schemas.LogCategory.Repo,
      action: Schemas.LogAction.SendTestNotification,
      message: `Test notification sent: ${delivered} delivered, ${pruned} pruned`,
      metadata: { userId: params.userId, delivered, pruned },
    });

    if (delivered === 0) {
      return { isSuccess: false, message: "Failed to deliver test notification to any device" };
    }
    return { isSuccess: true, message: `Test notification sent to ${delivered} device(s)` };
  }

  // DEV_NOTE: architecture.md's notification dispatch. Called once an hour from the Worker's
  // scheduled() handler (see index.ts) with `at` = the cron's own scheduledTime, never Date.now() —
  // a delayed or retried invocation must still resolve to the hour it was scheduled for, which is
  // also what makes this testable without fake timers.
  //
  // Query shape (see NotificationsDAL for why each read is chunked/unscoped):
  //   1. getSubscribedUserIds() — the one unscoped query, bounded to users who could ever be acted on.
  //   2. getUsersByClerkIds(chunk) → tz per user. getNotificationPrefsForUsers(chunk) → prefs per user.
  //   3. Bucket every user by localHourIn(tz, at) in TS — at most a handful of distinct local hours
  //      exist at any UTC instant (IANA offsets include :30/:45), so this is the entire timezone
  //      resolution; everything downstream is back to userId-scoped reads.
  //   4. Per bucket: getTrackersDueForReminder(chunk, hour) hits the partial index directly.
  //   5. Filter in TS with isScheduled(utcDateString(at), manifest.schedule) — which *day* the
  //      schedule allows isn't index-backed and doesn't belong in the WHERE clause.
  //   6. Claim the dedup key (insert-before-send) and fan out with bounded concurrency.
  //
  // PR 4 adds two more triggers after the reminder fan-out above, both reusing tzByUserId/
  // prefsByUserId/utcDate computed in steps 2-3: runStreakDigest (tz-gated on prefs.streakDigestHour)
  // and runOpenIntervalNags (not tz-gated — see its own DEV_NOTE).
  async runHourlyDispatch(params: { at: Date }): Promise<Schemas.ApiResponse & { sent?: number }> {
    const subscribedResult = await this.dal.getSubscribedUserIds();
    if (!subscribedResult.isSuccess || !subscribedResult.userIds) {
      return { isSuccess: false, message: subscribedResult.message };
    }
    const userIds = subscribedResult.userIds;
    if (userIds.length === 0) {
      return { isSuccess: true, message: "No subscribed users", sent: 0 };
    }

    const tzByUserId = new Map<string, string>();
    for (const chunk of Utility.chunk(userIds)) {
      const usersResult = await this.usersDal.getUsersByClerkIds({ clerkIds: chunk });
      for (const user of usersResult.users ?? []) tzByUserId.set(user.clerkId, user.tz);
    }

    const prefsByUserId = new Map<string, Schemas.NotificationPrefs>();
    for (const chunk of Utility.chunk(userIds)) {
      const prefsResult = await this.dal.getNotificationPrefsForUsers({ userIds: chunk });
      for (const [userId, prefs] of prefsResult.prefsByUserId ?? new Map()) {
        prefsByUserId.set(userId, prefs);
      }
    }

    // DEV_NOTE: distinct local hours at any UTC instant number at most ~38 (IANA offsets), in
    // practice 1–3 — this loop's iteration count, not userIds.length.
    const usersByHour = new Map<number, string[]>();
    for (const userId of userIds) {
      const tz = tzByUserId.get(userId);
      if (!tz) continue; // no matching users row (shouldn't happen — a subscription implies a user)

      const prefs = prefsByUserId.get(userId) ?? Schemas.NOTIFICATION_PREFS_DEFAULTS;
      if (!prefs.trackerRemindersEnabled) continue;

      const hour = localHourIn(tz, params.at);
      const bucket = usersByHour.get(hour);
      if (bucket) bucket.push(userId);
      else usersByHour.set(hour, [userId]);
    }

    const utcDate = utcDateString(params.at);
    const targets: ReminderTarget[] = [];
    for (const [hour, hourUserIds] of usersByHour) {
      for (const chunk of Utility.chunk(hourUserIds)) {
        const trackersResult = await this.dal.getTrackersDueForReminder({ userIds: chunk, hour });
        for (const tracker of trackersResult.trackers ?? []) {
          if (!isScheduled(utcDate, tracker.manifestJson.schedule)) continue;
          targets.push({
            userId: tracker.userId,
            trackerPublicId: tracker.publicId,
            trackerName: tracker.name,
            dedupKey: `tracker_reminder:${tracker.publicId}:${utcDate}:${hour}`,
          });
        }
      }
    }

    let sendTargets = targets;
    if (targets.length > MAX_SENDS_PER_INVOCATION) {
      AppLogger.error({
        category: Schemas.LogCategory.Repo,
        action: Schemas.LogAction.RunNotificationDispatch,
        message: `Notification dispatch found ${targets.length} due reminders, over the ${MAX_SENDS_PER_INVOCATION} cap — truncating`,
        metadata: { due: targets.length, cap: MAX_SENDS_PER_INVOCATION },
      });
      sendTargets = targets.slice(0, MAX_SENDS_PER_INVOCATION);
    }

    const vapid = this.vapidKeys();
    let claimed = 0;
    let delivered = 0;
    let pruned = 0;

    await Utility.mapWithConcurrency(sendTargets, SEND_CONCURRENCY, async (target) => {
      const claim = await this.dal.claimNotificationSend({
        userId: target.userId,
        dedupKey: target.dedupKey,
        trigger: "tracker_reminder",
      });
      if (!claim.isSuccess || !claim.claimed) return;
      claimed++;

      const subscriptionsResult = await this.dal.getPushSubscriptions({ userId: target.userId });
      if (!subscriptionsResult.isSuccess || !subscriptionsResult.subscriptions?.length) return;

      const payload: Schemas.PushPayload = {
        title: "Crux",
        body: `Don't forget: ${target.trackerName}`,
        url: `/trackers/${target.trackerPublicId}`,
        tag: "tracker_reminder",
      };

      const result = await this.sendToSubscriptions(
        target.userId,
        subscriptionsResult.subscriptions,
        payload,
        vapid,
      );
      delivered += result.delivered;
      pruned += result.pruned;
    });

    // DEV_NOTE: reuses tzByUserId/prefsByUserId/utcDate/vapid from steps 2-3 above rather than
    // re-fetching — both PR 4 triggers ride the same subscribed-user set the reminder pass already
    // resolved. Digest is tz-gated (fires once, at the user's own streakDigestHour); open-interval
    // is not (see runOpenIntervalNags's own DEV_NOTE).
    const digestUserIds = userIds.filter((candidateId) => {
      const tz = tzByUserId.get(candidateId);
      if (!tz) return false;
      const prefs = prefsByUserId.get(candidateId) ?? Schemas.NOTIFICATION_PREFS_DEFAULTS;
      return prefs.streakDigestEnabled && localHourIn(tz, params.at) === prefs.streakDigestHour;
    });
    const digest = await this.runStreakDigest(digestUserIds, utcDate, vapid);

    const openInterval = await this.runOpenIntervalNags({
      userIds,
      prefsByUserId,
      at: params.at,
      vapid,
    });

    AppLogger.info({
      category: Schemas.LogCategory.Repo,
      action: Schemas.LogAction.RunNotificationDispatch,
      message:
        `Notification dispatch — reminders: ${targets.length} due/${claimed} claimed/${delivered} delivered/${pruned} pruned; ` +
        `digest: ${digest.candidates} candidates/${digest.delivered} delivered/${digest.pruned} pruned; ` +
        `open interval: ${openInterval.candidates} candidates/${openInterval.delivered} delivered/${openInterval.pruned} pruned`,
      metadata: {
        reminders: { due: targets.length, claimed, delivered, pruned },
        digest,
        openInterval,
      },
    });

    return {
      isSuccess: true,
      message: "Notification dispatch completed",
      sent: delivered + digest.delivered + openInterval.delivered,
    };
  }

  // DEV_NOTE: PR 4 — streak digest. Reuses TrackersDAL/EntriesDAL/MetricsDAL directly rather than
  // adding bulk reads to NotificationsDAL: unlike the reminder dispatch, this is a per-user read
  // (a user's own trackers, facts and targets), so it's the same userId-scoped shape TrackersRepo's
  // own getTrackers/getHeatmap already use, and IDX_daily_facts_lookup's (user_id, metric_id,
  // local_date) prefix is what a per-user query naturally hits. dayState/resolveTargetAt come from
  // Scoring.ts so "still open today" is exactly what the heatmap would render for that tracker.
  private async runStreakDigest(
    userIds: string[],
    utcDate: string,
    vapid: VapidKeys,
  ): Promise<{ candidates: number; delivered: number; pruned: number }> {
    let candidates = 0;
    let delivered = 0;
    let pruned = 0;

    await Utility.mapWithConcurrency(userIds, SEND_CONCURRENCY, async (userId) => {
      const [trackersResult, metricsResult] = await Promise.all([
        this.trackersDal.getTrackers({ userId }),
        this.metricsDal.getMetrics({ userId }),
      ]);
      const trackerRows = trackersResult.trackers ?? [];
      if (trackerRows.length === 0) return;

      const metricsById = new Map(
        (metricsResult.metrics ?? []).map((metric) => [metric.id, metric]),
      );
      const metricIds = [...new Set(trackerRows.map((tracker) => tracker.primaryMetricId))];

      const [factsResult, targetsResult] = await Promise.all([
        this.entriesDal.getDailyFactsForMetrics({
          userId,
          metricIds,
          dateFrom: utcDate,
          dateTo: utcDate,
        }),
        this.trackersDal.getTrackerTargetsForTrackers({
          userId,
          trackerIds: trackerRows.map((tracker) => tracker.id),
        }),
      ]);
      if (!factsResult.isSuccess || !targetsResult.isSuccess) return;

      // DEV_NOTE: mirrors TrackersRepo.getTrackers' own valuesByMetric build — a null aggregate is
      // left out entirely rather than stored as 0 (invariant 7), so a metric that was never computed
      // for today reads as no_data, not as a met-or-partial zero.
      const sumsByMetric = new Map<number, Map<string, number>>();
      for (const fact of factsResult.dailyFacts ?? []) {
        const agg = metricsById.get(fact.metricId)?.defaultAgg ?? "sum";
        const value = factValue(fact, agg);
        if (value === null) continue;
        const byDate = sumsByMetric.get(fact.metricId) ?? new Map<string, number>();
        byDate.set(fact.localDate, value);
        sumsByMetric.set(fact.metricId, byDate);
      }

      const targetsByTracker = new Map<number, Schemas.TrackerTarget[]>();
      for (const target of targetsResult.targets ?? []) {
        const bucket = targetsByTracker.get(target.trackerId);
        if (bucket) bucket.push(target);
        else targetsByTracker.set(target.trackerId, [target]);
      }

      const open: string[] = [];
      for (const tracker of trackerRows) {
        const sums = sumsByMetric.get(tracker.primaryMetricId) ?? new Map<string, number>();
        const target = resolveTargetAt(targetsByTracker.get(tracker.id) ?? [], utcDate);
        const state = dayState(utcDate, sums, tracker, target);
        if (state === "no_data" || state === "partial") open.push(tracker.name);
      }
      if (open.length === 0) return;
      candidates++;

      // DEV_NOTE: dedup key carries no per-tracker or per-user component of its own — see the plan's
      // dedup key table — because the composite PK on notification_sends is (userId, dedupKey), so
      // uniqueness per user per day comes from that column, not from the string.
      const dedupKey = `streak_digest:-:${utcDate}`;
      const claim = await this.dal.claimNotificationSend({
        userId,
        dedupKey,
        trigger: "streak_digest",
      });
      if (!claim.isSuccess || !claim.claimed) return;

      const subscriptionsResult = await this.dal.getPushSubscriptions({ userId });
      if (!subscriptionsResult.isSuccess || !subscriptionsResult.subscriptions?.length) return;

      const listed =
        open.length > MAX_DIGEST_NAMES
          ? [...open.slice(0, MAX_DIGEST_NAMES), `+${open.length - MAX_DIGEST_NAMES} more`]
          : open;
      const payload: Schemas.PushPayload = {
        title: "Crux",
        body: `${open.length} tracker${open.length === 1 ? "" : "s"} still open today — ${listed.join(", ")}.`,
        url: "/trackers",
        tag: "streak_digest",
      };

      const result = await this.sendToSubscriptions(
        userId,
        subscriptionsResult.subscriptions,
        payload,
        vapid,
      );
      delivered += result.delivered;
      pruned += result.pruned;
    });

    return { candidates, delivered, pruned };
  }

  // DEV_NOTE: PR 4 — open-interval nag. Not tz-dependent (see the plan): "N minutes elapsed" means
  // this runs for every subscribed user every hour regardless of local time, unlike the reminder and
  // digest triggers above. `olderThan` is the smallest threshold across every eligible user, which
  // keeps NotificationsDAL's scan to one bounded query instead of one per user; the exact bucket
  // (which multiple of *that* user's own threshold this entry has crossed) is resolved here since it
  // needs each user's own openIntervalThresholdMinutes.
  private async runOpenIntervalNags(params: {
    userIds: string[];
    prefsByUserId: Map<string, Schemas.NotificationPrefs>;
    at: Date;
    vapid: VapidKeys;
  }): Promise<{ candidates: number; delivered: number; pruned: number }> {
    let candidates = 0;
    let delivered = 0;
    let pruned = 0;

    const eligibleUserIds = params.userIds.filter(
      (userId) =>
        (params.prefsByUserId.get(userId) ?? Schemas.NOTIFICATION_PREFS_DEFAULTS)
          .openIntervalEnabled,
    );
    if (eligibleUserIds.length === 0) return { candidates, delivered, pruned };

    const minThresholdMinutes = Math.min(
      ...eligibleUserIds.map(
        (userId) =>
          (params.prefsByUserId.get(userId) ?? Schemas.NOTIFICATION_PREFS_DEFAULTS)
            .openIntervalThresholdMinutes,
      ),
    );
    const olderThan = new Date(params.at.getTime() - minThresholdMinutes * 60_000);

    const openResult = await this.dal.getOpenIntervalsForUsers({
      userIds: eligibleUserIds,
      olderThan,
    });
    if (!openResult.isSuccess || !openResult.entries) return { candidates, delivered, pruned };

    await Utility.mapWithConcurrency(
      openResult.entries,
      SEND_CONCURRENCY,
      async (entry: OpenIntervalEntry) => {
        const prefs = params.prefsByUserId.get(entry.userId) ?? Schemas.NOTIFICATION_PREFS_DEFAULTS;
        const minutesOpen = (params.at.getTime() - entry.occurredAt.getTime()) / 60_000;
        // DEV_NOTE: a 9-hour timer at a 4h threshold nags at 4h and 8h, not hourly — the bucket is the
        // dedup key's own variable component, so crossing into a new multiple is what re-fires it.
        const bucket = Math.floor(minutesOpen / prefs.openIntervalThresholdMinutes);
        if (bucket < 1) return;
        candidates++;

        const dedupKey = `open_interval:${entry.entryPublicId}:${bucket}`;
        const claim = await this.dal.claimNotificationSend({
          userId: entry.userId,
          dedupKey,
          trigger: "open_interval",
        });
        if (!claim.isSuccess || !claim.claimed) return;

        const subscriptionsResult = await this.dal.getPushSubscriptions({ userId: entry.userId });
        if (!subscriptionsResult.isSuccess || !subscriptionsResult.subscriptions?.length) return;

        const payload: Schemas.PushPayload = {
          title: "Crux",
          body: `Timer still running: ${entry.trackerName}, ${this.formatDuration(minutesOpen)}.`,
          url: `/trackers/${entry.trackerPublicId}`,
          tag: "open_interval",
        };

        const result = await this.sendToSubscriptions(
          entry.userId,
          subscriptionsResult.subscriptions,
          payload,
          params.vapid,
        );
        delivered += result.delivered;
        pruned += result.pruned;
      },
    );

    return { candidates, delivered, pruned };
  }
}
