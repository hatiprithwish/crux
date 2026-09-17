import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import getDbClient from "@/db/dbClient";
import {
  entries,
  notificationPrefs,
  notificationSends,
  pushSubscriptions,
  trackers,
} from "@/db/tables";
import NotificationsDAL from "@/data-access-layer/NotificationsDAL";
import NotificationsRepo from "@/repositories/NotificationsRepo";
import UsersDAL from "@/data-access-layer/UsersDAL";
import MetricsDAL from "@/data-access-layer/MetricsDAL";
import TrackersDAL from "@/data-access-layer/TrackersDAL";
import EntriesDAL from "@/data-access-layer/EntriesDAL";
import Constants from "@/config/Constants";
import { utcDateString } from "@/utils/DateTime";
import worker from "../index";
import * as Schemas from "@app/schemas";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

// DEV_NOTE: same reasoning as orphanScan.test.ts — this session's remote D1 proxy connection is
// visibly unstable, and every DAL method here resolves `isSuccess: false` on failure rather than
// throwing, so retrying is keyed on that flag.
async function withRetry<T extends { isSuccess: boolean }>(
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let result: T;
  for (let i = 0; i < attempts; i++) {
    result = await fn();
    if (result.isSuccess) return result;
  }
  return result!;
}

vi.mock("@/providers/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  configureLogger: vi.fn().mockResolvedValue(undefined),
  disposeLogger: vi.fn().mockResolvedValue(undefined),
  withRequestContext: vi.fn().mockImplementation((_id, next) => next()),
}));

// DEV_NOTE: sendWebPush is mocked — never real HTTP. This suite exercises the DAL/Repo contract
// (upsert-on-conflict, prefs defaults, prune-on-isGone), not the crypto or the push service, which
// are webPush.test.ts's job.
vi.mock("@/providers/webPush", () => ({
  sendWebPush: vi.fn(),
}));
import { sendWebPush } from "@/providers/webPush";

const testEnv = { ...env, APP_ENV: "staging" as const };
const userId = `user_test_notifications_${Date.now()}`;
const otherUserId = `${userId}_other`;

describe("Notifications DAL/Repo (PR 2 — push plumbing)", () => {
  afterAll(async () => {
    const db = getDbClient(testEnv);
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, otherUserId));
    await db.delete(notificationPrefs).where(eq(notificationPrefs.userId, userId));
  });

  it("upsertPushSubscription reassigns userId on endpoint conflict without creating a new row", async () => {
    const dal = new NotificationsDAL(testEnv);
    // DEV_NOTE: a fresh endpoint per run, not a fixed one — remote D1 is persistent, and a fixed
    // endpoint would collide with a leftover row from a previous run of this same test.
    const endpoint = `https://push.example.net/conflict-${Date.now()}`;

    const first = await withRetry(() =>
      dal.upsertPushSubscription({
        userId,
        endpoint,
        p256dh: "p1",
        auth: "a1",
        deviceLabel: "Device A",
      }),
    );
    if (!first.isSuccess || !first.subscription)
      throw new Error("Failed to create first subscription");
    expect(first.subscription.userId).toBe(userId);

    // Same browser install, a different user signed in — the shared-machine case the partial unique
    // index exists for (see tables.ts DEV_NOTE on push_subscriptions).
    const second = await withRetry(() =>
      dal.upsertPushSubscription({
        userId: otherUserId,
        endpoint,
        p256dh: "p2",
        auth: "a2",
        deviceLabel: "Device B",
      }),
    );
    if (!second.isSuccess || !second.subscription)
      throw new Error("Failed to reassign subscription");
    expect(second.subscription.userId).toBe(otherUserId);
    expect(second.subscription.publicId).toBe(first.subscription.publicId);
    expect(second.subscription.deviceLabel).toBe("Device B");

    const firstUsersRows = await withRetry(() => dal.getPushSubscriptions({ userId }));
    expect(firstUsersRows.subscriptions?.some((s) => s.endpoint === endpoint)).toBe(false);
  });

  it("getNotificationPrefs reports defaults with no row, then a partial update preserves the rest", async () => {
    const repo = new NotificationsRepo(testEnv);

    const before = await withRetry(() => repo.getNotificationPrefs({ userId }));
    if (!before.isSuccess) throw new Error("Failed to fetch prefs");
    expect(before.prefs).toEqual(Schemas.NOTIFICATION_PREFS_DEFAULTS);

    const updated = await withRetry(() =>
      repo.updateNotificationPrefs({ userId, streakDigestHour: 8 }),
    );
    if (!updated.isSuccess || !updated.prefs) throw new Error("Failed to update prefs");
    expect(updated.prefs.streakDigestHour).toBe(8);
    // DEV_NOTE: the field this test never touched must keep its default — a tz-only-style partial
    // write, per UpsertNotificationPrefsDALRequest's DEV_NOTE.
    expect(updated.prefs.trackerRemindersEnabled).toBe(
      Schemas.NOTIFICATION_PREFS_DEFAULTS.trackerRemindersEnabled,
    );

    const again = await withRetry(() =>
      repo.updateNotificationPrefs({ userId, trackerRemindersEnabled: false }),
    );
    if (!again.isSuccess || !again.prefs) throw new Error("Failed to update prefs a second time");
    expect(again.prefs.trackerRemindersEnabled).toBe(false);
    // The earlier write's value survives this one — onConflictDoUpdate only sets what was sent.
    expect(again.prefs.streakDigestHour).toBe(8);
  });

  it("prunes a subscription whose send comes back isGone", async () => {
    const dal = new NotificationsDAL(testEnv);
    const endpoint = `https://push.example.net/gone-${Date.now()}`;
    const created = await withRetry(() =>
      dal.upsertPushSubscription({
        userId,
        endpoint,
        p256dh: "p",
        auth: "a",
        deviceLabel: "Gone Device",
      }),
    );
    if (!created.isSuccess) throw new Error("Failed to create subscription");

    vi.mocked(sendWebPush).mockResolvedValue({
      status: 410,
      isDelivered: false,
      isGone: true,
      isMisconfigured: false,
    });

    const repo = new NotificationsRepo(testEnv);
    const result = await repo.sendTestNotification({ userId });
    expect(result.isSuccess).toBe(false);
    expect(result.message).toMatch(/Failed to deliver/);

    const remaining = await withRetry(() => dal.getPushSubscriptions({ userId }));
    expect(remaining.subscriptions?.some((s) => s.endpoint === endpoint)).toBe(false);
  });

  it("reports a delivered send and never prunes on a misconfigured (4xx) response", async () => {
    const dal = new NotificationsDAL(testEnv);
    const endpoint = `https://push.example.net/delivered-${Date.now()}`;
    await withRetry(() =>
      dal.upsertPushSubscription({
        userId,
        endpoint,
        p256dh: "p",
        auth: "a",
        deviceLabel: "Delivered Device",
      }),
    );

    vi.mocked(sendWebPush).mockResolvedValue({
      status: 201,
      isDelivered: true,
      isGone: false,
      isMisconfigured: false,
    });

    const repo = new NotificationsRepo(testEnv);
    const delivered = await repo.sendTestNotification({ userId });
    expect(delivered.isSuccess).toBe(true);

    vi.mocked(sendWebPush).mockResolvedValue({
      status: 403,
      isDelivered: false,
      isGone: false,
      isMisconfigured: true,
    });
    // DEV_NOTE: a bad VAPID key must never prune — see webPush.ts's status-mapping DEV_NOTE. This is
    // the test that would catch a regression turning that into a prune.
    await repo.sendTestNotification({ userId });
    const stillThere = await withRetry(() => dal.getPushSubscriptions({ userId }));
    expect(stillThere.subscriptions?.some((s) => s.endpoint === endpoint)).toBe(true);
  });
});

// DEV_NOTE: mirrors orphanScan.test.ts's shape — invokes the real worker.scheduled() against the
// real remote D1, same as that suite already does for the orphan scan. getSubscribedUserIds() is
// deliberately unscoped (see NotificationsDAL), so this dispatch run processes every subscribed
// user in the shared remote database, not just this test's own rows — every assertion below is
// filtered to this test's own endpoint/tracker for that reason, never a bare call count.
describe("Hourly notification dispatch (PR 3 — cron)", () => {
  const dispatchUserId = `user_test_dispatch_${Date.now()}`;
  const REMINDER_HOUR = 9;
  // DEV_NOTE: Asia/Dubai is UTC+4 with no DST — a whole-hour, never-changing offset, so "local hour
  // 9" is always exactly "UTC hour 5" with no half-hour or seasonal arithmetic to get wrong.
  const TZ = "Asia/Dubai";
  const scheduledTime = Date.UTC(2026, 0, 15, REMINDER_HOUR - 4, 0, 0);
  const utcWeekday = new Date(scheduledTime).getUTCDay();

  const createdTrackerIds: number[] = [];

  let dailyTracker: Schemas.Tracker;
  const dailyEndpoint = `https://push.example.net/dispatch-daily-${Date.now()}`;

  afterAll(async () => {
    const db = getDbClient(testEnv);
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, dispatchUserId));
    await db.delete(notificationSends).where(eq(notificationSends.userId, dispatchUserId));
    await db.delete(notificationPrefs).where(eq(notificationPrefs.userId, dispatchUserId));
    for (const trackerId of createdTrackerIds) {
      await db.delete(trackers).where(eq(trackers.id, trackerId));
    }
  });

  async function seedUser() {
    const usersDal = new UsersDAL(testEnv);
    await withRetry(() =>
      usersDal.upsertUser({
        clerkId: dispatchUserId,
        email: `${dispatchUserId}@example.com`,
        role: Schemas.UserRoleEnum.User,
      }),
    );
    await withRetry(() => usersDal.updateUser({ clerkId: dispatchUserId, fields: { tz: TZ } }));
  }

  async function seedTracker(params: {
    schedule: Schemas.TrackerSchedule;
    reminderHour: number | null;
    label: string;
  }): Promise<Schemas.Tracker> {
    const key = `dispatch_test_${params.label}_${Date.now()}`;
    const metric = await withRetry(() =>
      new MetricsDAL(testEnv).createMetric({
        userId: dispatchUserId,
        key,
        name: "Dispatch Test Metric",
        semanticType: "count",
        canonicalUnit: "count",
        defaultAgg: "sum",
        defaultDirection: "higher_better",
        dateAttribution: "start",
      }),
    );
    if (!metric.isSuccess || !metric.metric) throw new Error("Failed to create test metric");

    const tracker = await withRetry(() =>
      new TrackersDAL(testEnv).createTracker({
        userId: dispatchUserId,
        primaryMetricId: metric.metric!.id,
        name: `Dispatch Test ${params.label}`,
        manifest: {
          control: "toggle",
          metrics: [key],
          target: null,
          step: null,
          direction: "higher_better",
          entryMode: "retro",
          schedule: params.schedule,
          compute: null,
        },
        activeFrom: "2020-01-01",
        reminderHour: params.reminderHour,
      }),
    );
    if (!tracker.isSuccess || !tracker.tracker) throw new Error("Failed to create test tracker");
    createdTrackerIds.push(tracker.tracker.id);
    return tracker.tracker;
  }

  async function seedSubscription(endpoint: string) {
    await withRetry(() =>
      new NotificationsDAL(testEnv).upsertPushSubscription({
        userId: dispatchUserId,
        endpoint,
        p256dh: "p",
        auth: "a",
        deviceLabel: "Dispatch Test Device",
      }),
    );
  }

  async function invokeDispatch(time: number) {
    const ctx = createExecutionContext();
    await worker.scheduled(
      { scheduledTime: time, cron: Constants.CRON_NOTIFICATION_DISPATCH, noRetry: () => {} },
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
  }

  function callsTo(endpoint: string) {
    return vi.mocked(sendWebPush).mock.calls.filter((call) => call[0].target.endpoint === endpoint);
  }

  beforeAll(async () => {
    await seedUser();
    dailyTracker = await seedTracker({
      schedule: { type: "daily" },
      reminderHour: REMINDER_HOUR,
      label: "daily",
    });
    await seedSubscription(dailyEndpoint);
  });

  it("sends one reminder to the right endpoint with the tracker's publicId in the payload url", async () => {
    vi.mocked(sendWebPush).mockResolvedValue({
      status: 201,
      isDelivered: true,
      isGone: false,
      isMisconfigured: false,
    });

    await invokeDispatch(scheduledTime);

    const calls = callsTo(dailyEndpoint);
    expect(calls.length).toBe(1);
    const payload = JSON.parse(calls[0][0].payload);
    expect(payload.url).toBe(`/trackers/${dailyTracker.publicId}`);
  });

  it("does not send a second time for the same hour (dedup)", async () => {
    await invokeDispatch(scheduledTime);

    // Still 1 — the previous test's send already claimed this (user, dedupKey) pair.
    expect(callsTo(dailyEndpoint).length).toBe(1);
  });

  it("does not send outside the tracker's reminder hour", async () => {
    // One UTC hour later — Dubai has no DST, so this reliably lands on local hour 10, not 9.
    await invokeDispatch(scheduledTime + 60 * 60 * 1000);

    expect(callsTo(dailyEndpoint).length).toBe(1);
  });

  it("does not send on a day the tracker's schedule excludes", async () => {
    const excludedDay = (utcWeekday + 3) % 7;
    const endpoint = `https://push.example.net/dispatch-unscheduled-${Date.now()}`;
    await seedTracker({
      schedule: { type: "days_of_week", days: [excludedDay] },
      reminderHour: REMINDER_HOUR,
      label: "unscheduled",
    });
    await seedSubscription(endpoint);

    await invokeDispatch(scheduledTime);

    expect(callsTo(endpoint).length).toBe(0);
  });

  it("soft-deletes a subscription whose send comes back isGone", async () => {
    await seedTracker({
      schedule: { type: "daily" },
      reminderHour: REMINDER_HOUR,
      label: "gone",
    });
    const goneEndpoint = `https://push.example.net/dispatch-gone-${Date.now()}`;
    await seedSubscription(goneEndpoint);

    vi.mocked(sendWebPush).mockImplementation(async (sendParams) =>
      sendParams.target.endpoint === goneEndpoint
        ? { status: 410, isDelivered: false, isGone: true, isMisconfigured: false }
        : { status: 201, isDelivered: true, isGone: false, isMisconfigured: false },
    );

    // Same instant as the daily tracker's — its dedup key is already claimed from earlier tests, so
    // only this fresh tracker's dedup key is actually up for a send here.
    await invokeDispatch(scheduledTime);

    expect(callsTo(goneEndpoint).length).toBe(1);
    const remaining = await withRetry(() =>
      new NotificationsDAL(testEnv).getPushSubscriptions({ userId: dispatchUserId }),
    );
    expect(remaining.subscriptions?.some((s) => s.endpoint === goneEndpoint)).toBe(false);
  });
});

// DEV_NOTE: same shape as the PR 3 describe block above — a real worker.scheduled() invocation
// against the shared remote D1, with every assertion filtered to this test's own endpoint rather
// than a bare call count, since getSubscribedUserIds() processes every subscribed user in the
// database. A dedicated user (not dispatchUserId above) so the reminder pass has nothing to do —
// every tracker created here has reminderHour: null — and so this block's own dedup keys can never
// collide with PR 3's.
describe("Streak digest (PR 4 — cron)", () => {
  const digestUserId = `user_test_digest_${Date.now()}`;
  const DIGEST_HOUR = 20;
  const TZ = "Asia/Dubai"; // UTC+4, no DST — see PR 3's block for why this tz was picked.
  const scheduledTime = Date.UTC(2026, 0, 20, DIGEST_HOUR - 4, 0, 0);
  const utcDate = utcDateString(new Date(scheduledTime));

  const digestEndpoint = `https://push.example.net/digest-${Date.now()}`;
  const createdTrackerIds: number[] = [];
  let openTrackerName: string;
  let metTrackerName: string;

  afterAll(async () => {
    const db = getDbClient(testEnv);
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, digestUserId));
    await db.delete(notificationSends).where(eq(notificationSends.userId, digestUserId));
    await db.delete(notificationPrefs).where(eq(notificationPrefs.userId, digestUserId));
    await db.delete(entries).where(eq(entries.userId, digestUserId));
    for (const trackerId of createdTrackerIds) {
      await db.delete(trackers).where(eq(trackers.id, trackerId));
    }
  });

  function callsTo(endpoint: string) {
    return vi.mocked(sendWebPush).mock.calls.filter((call) => call[0].target.endpoint === endpoint);
  }

  async function invokeDispatch(time: number) {
    const ctx = createExecutionContext();
    await worker.scheduled(
      { scheduledTime: time, cron: Constants.CRON_NOTIFICATION_DISPATCH, noRetry: () => {} },
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
  }

  beforeAll(async () => {
    const usersDal = new UsersDAL(testEnv);
    await withRetry(() =>
      usersDal.upsertUser({
        clerkId: digestUserId,
        email: `${digestUserId}@example.com`,
        role: Schemas.UserRoleEnum.User,
      }),
    );
    await withRetry(() => usersDal.updateUser({ clerkId: digestUserId, fields: { tz: TZ } }));
    await withRetry(() =>
      new NotificationsRepo(testEnv).updateNotificationPrefs({
        userId: digestUserId,
        streakDigestHour: DIGEST_HOUR,
      }),
    );

    async function seedTracker(label: string) {
      const key = `digest_test_${label}_${Date.now()}`;
      const metric = await withRetry(() =>
        new MetricsDAL(testEnv).createMetric({
          userId: digestUserId,
          key,
          name: "Digest Test Metric",
          semanticType: "count",
          canonicalUnit: "count",
          defaultAgg: "sum",
          defaultDirection: "higher_better",
          dateAttribution: "start",
        }),
      );
      if (!metric.isSuccess || !metric.metric) throw new Error("Failed to create test metric");

      const tracker = await withRetry(() =>
        new TrackersDAL(testEnv).createTracker({
          userId: digestUserId,
          primaryMetricId: metric.metric!.id,
          name: `Digest Test ${label}`,
          manifest: {
            control: "toggle",
            metrics: [key],
            target: null,
            step: null,
            direction: "higher_better",
            entryMode: "retro",
            schedule: { type: "daily" },
            compute: null,
          },
          activeFrom: "2020-01-01",
          reminderHour: null,
        }),
      );
      if (!tracker.isSuccess || !tracker.tracker) throw new Error("Failed to create test tracker");
      createdTrackerIds.push(tracker.tracker.id);
      return tracker.tracker;
    }

    // DEV_NOTE: target is null on both, so dayState scores "met" the instant there's any logged
    // value for the day (architecture.md §6 — no target means nothing to fall short of). The open
    // tracker is left with no entry at all today, which is what makes it "no_data", not "partial".
    const openTracker = await seedTracker("open");
    const metTracker = await seedTracker("met");
    openTrackerName = openTracker.name;
    metTrackerName = metTracker.name;

    await withRetry(() =>
      new EntriesDAL(testEnv).writeEntry({
        userId: digestUserId,
        trackerId: metTracker.id,
        occurredAt: new Date(scheduledTime),
        localDate: utcDate,
        tz: TZ,
        values: [{ metricId: metTracker.primaryMetricId, valueNum: 1 }],
      }),
    );

    await withRetry(() =>
      new NotificationsDAL(testEnv).upsertPushSubscription({
        userId: digestUserId,
        endpoint: digestEndpoint,
        p256dh: "p",
        auth: "a",
        deviceLabel: "Digest Test Device",
      }),
    );

    vi.mocked(sendWebPush).mockResolvedValue({
      status: 201,
      isDelivered: true,
      isGone: false,
      isMisconfigured: false,
    });
  });

  it("sends a digest naming only the tracker with no entry today, never the met one", async () => {
    await invokeDispatch(scheduledTime);

    const calls = callsTo(digestEndpoint);
    expect(calls.length).toBe(1);
    const payload = JSON.parse(calls[0][0].payload);
    expect(payload.url).toBe("/trackers");
    expect(payload.body).toContain(openTrackerName);
    expect(payload.body).not.toContain(metTrackerName);
  });

  it("does not send a second digest for the same day (dedup)", async () => {
    await invokeDispatch(scheduledTime);

    expect(callsTo(digestEndpoint).length).toBe(1);
  });

  it("does not send when the digest is disabled, even on a fresh day", async () => {
    await withRetry(() =>
      new NotificationsRepo(testEnv).updateNotificationPrefs({
        userId: digestUserId,
        streakDigestEnabled: false,
      }),
    );

    // A new UTC day (fresh dedup key) at the same local digest hour — if disablement weren't
    // checked, this alone would produce a second send.
    await invokeDispatch(scheduledTime + 24 * 60 * 60 * 1000);

    expect(callsTo(digestEndpoint).length).toBe(1);
  });
});

// DEV_NOTE: not tz-gated — deliberately no `users` row is seeded for this block's user, which is
// itself the assertion that runOpenIntervalNags never needs one (see its DEV_NOTE in
// NotificationsRepo.ts). A dedicated user, so this block's dedup keys can't collide with the other
// two describe blocks above.
describe("Open interval nag (PR 4 — cron)", () => {
  const intervalUserId = `user_test_interval_${Date.now()}`;
  const THRESHOLD_MINUTES = 60;
  const at = Date.UTC(2026, 0, 21, 12, 0, 0);

  const nagEndpoint = `https://push.example.net/open-interval-${Date.now()}`;
  const createdTrackerIds: number[] = [];
  let trackerName: string;
  let trackerPublicId: string;

  afterAll(async () => {
    const db = getDbClient(testEnv);
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, intervalUserId));
    await db.delete(notificationSends).where(eq(notificationSends.userId, intervalUserId));
    await db.delete(notificationPrefs).where(eq(notificationPrefs.userId, intervalUserId));
    await db.delete(entries).where(eq(entries.userId, intervalUserId));
    for (const trackerId of createdTrackerIds) {
      await db.delete(trackers).where(eq(trackers.id, trackerId));
    }
  });

  function callsTo(endpoint: string) {
    return vi.mocked(sendWebPush).mock.calls.filter((call) => call[0].target.endpoint === endpoint);
  }

  async function invokeDispatch(time: number) {
    const ctx = createExecutionContext();
    await worker.scheduled(
      { scheduledTime: time, cron: Constants.CRON_NOTIFICATION_DISPATCH, noRetry: () => {} },
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
  }

  async function seedOpenInterval(label: string, occurredAt: Date) {
    const key = `interval_test_${label}_${Date.now()}`;
    const metric = await withRetry(() =>
      new MetricsDAL(testEnv).createMetric({
        userId: intervalUserId,
        key,
        name: "Interval Test Metric",
        semanticType: "duration_seconds",
        canonicalUnit: "seconds",
        defaultAgg: "sum",
        defaultDirection: "higher_better",
        dateAttribution: "start",
      }),
    );
    if (!metric.isSuccess || !metric.metric) throw new Error("Failed to create test metric");

    const tracker = await withRetry(() =>
      new TrackersDAL(testEnv).createTracker({
        userId: intervalUserId,
        primaryMetricId: metric.metric!.id,
        name: `Interval Test ${label}`,
        manifest: {
          control: "timer",
          metrics: [key],
          target: null,
          step: null,
          direction: "higher_better",
          entryMode: "retro",
          schedule: { type: "daily" },
          compute: null,
        },
        activeFrom: "2020-01-01",
        reminderHour: null,
      }),
    );
    if (!tracker.isSuccess || !tracker.tracker) throw new Error("Failed to create test tracker");
    createdTrackerIds.push(tracker.tracker.id);

    await withRetry(() =>
      new EntriesDAL(testEnv).writeEntry({
        userId: intervalUserId,
        trackerId: tracker.tracker!.id,
        entryKind: "interval",
        occurredAt,
        endedAt: null,
        localDate: utcDateString(occurredAt),
        tz: "UTC",
        values: [],
      }),
    );

    return tracker.tracker;
  }

  beforeAll(async () => {
    await withRetry(() =>
      new NotificationsRepo(testEnv).updateNotificationPrefs({
        userId: intervalUserId,
        openIntervalThresholdMinutes: THRESHOLD_MINUTES,
      }),
    );

    const openSince90Minutes = new Date(at - 90 * 60_000);
    const tracker = await seedOpenInterval("running", openSince90Minutes);
    trackerName = tracker.name;
    trackerPublicId = tracker.publicId;

    // Younger than the threshold — must never nag regardless of how many times dispatch runs.
    await seedOpenInterval("fresh", new Date(at - 10 * 60_000));

    await withRetry(() =>
      new NotificationsDAL(testEnv).upsertPushSubscription({
        userId: intervalUserId,
        endpoint: nagEndpoint,
        p256dh: "p",
        auth: "a",
        deviceLabel: "Interval Test Device",
      }),
    );

    vi.mocked(sendWebPush).mockResolvedValue({
      status: 201,
      isDelivered: true,
      isGone: false,
      isMisconfigured: false,
    });
  });

  it("nags once a timer has been open past the threshold, with the tracker's publicId and elapsed time", async () => {
    await invokeDispatch(at);

    const calls = callsTo(nagEndpoint);
    expect(calls.length).toBe(1);
    const payload = JSON.parse(calls[0][0].payload);
    expect(payload.url).toBe(`/trackers/${trackerPublicId}`);
    expect(payload.body).toContain(trackerName);
    expect(payload.body).toContain("1h 30m");
  });

  it("does not nag again within the same threshold bucket (dedup)", async () => {
    await invokeDispatch(at);

    expect(callsTo(nagEndpoint).length).toBe(1);
  });

  it("nags again once elapsed time crosses into the next threshold multiple", async () => {
    // 90 + 40 = 130 minutes open, threshold 60 — bucket goes from 1 to 2.
    await invokeDispatch(at + 40 * 60_000);

    const calls = callsTo(nagEndpoint);
    expect(calls.length).toBe(2);
    const payload = JSON.parse(calls[1][0].payload);
    expect(payload.body).toContain("2h 10m");
  });
});
