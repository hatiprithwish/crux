import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import getDbClient from "@/db/dbClient";
import {
  entries,
  notificationPrefs,
  notificationSends,
  pushSubscriptions,
  trackers,
} from "@/db/tables";
import * as Schemas from "@app/schemas";
import AppLogger from "@/providers/logger";
import Utility from "@/utils/Utility";

// DEV_NOTE: what the dispatcher needs from a due tracker — publicId/userId/name for the send,
// manifestJson so the Repo can run isScheduled() against manifest.schedule (the DB row's shape, not
// the API's — same as TrackersDAL.toTracker's own `manifest` rename, done in the Repo here instead
// since this read never goes through TrackersDAL).
export type TrackerDueForReminder = {
  publicId: string;
  userId: string;
  name: string;
  manifestJson: Schemas.TrackerManifest;
  activeFrom: string;
};

// DEV_NOTE: what the open-interval nag needs — entryPublicId to build the dedup bucket key,
// trackerPublicId/trackerName for the notification's url/body, occurredAt to compute minutes open.
export type OpenIntervalEntry = {
  userId: string;
  entryPublicId: string;
  trackerPublicId: string;
  trackerName: string;
  occurredAt: Date;
};

export default class NotificationsDAL {
  private db: DrizzleD1Database;

  constructor(env: Env) {
    this.db = getDbClient(env);
  }

  // DEV_NOTE: onConflictDoUpdate on the endpoint (the partial unique index, deleted_at is null),
  // reassigning userId and clearing deletedAt — a push service issues one endpoint per
  // browser-install/origin pair, so a re-subscribe on the same device (including a different user
  // signing in on a shared machine) must adopt the existing row rather than collide with it. Also
  // the self-heal path: the settings page re-POSTs on every mount, which is what keeps lastSeenAt
  // fresh without a separate "ping" endpoint.
  async upsertPushSubscription(params: Schemas.UpsertPushSubscriptionDALRequest) {
    const response: Schemas.ApiResponse & { subscription?: Schemas.PushSubscription } = {
      isSuccess: false,
    };

    try {
      const now = new Date();
      const subscriptionResponse = await this.db
        .insert(pushSubscriptions)
        .values({
          publicId: Utility.generatePublicId("psb_"),
          userId: params.userId,
          endpoint: params.endpoint,
          p256dh: params.p256dh,
          auth: params.auth,
          deviceLabel: params.deviceLabel,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: null,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          targetWhere: isNull(pushSubscriptions.deletedAt),
          set: {
            userId: params.userId,
            p256dh: params.p256dh,
            auth: params.auth,
            deviceLabel: params.deviceLabel,
            lastSeenAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        })
        .returning()
        .get();

      response.isSuccess = true;
      response.message = "Push subscription saved successfully";
      response.subscription = subscriptionResponse;
    } catch (error) {
      const message = "Unknown error in saving push subscription";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.CreatePushSubscription,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async getPushSubscriptions(params: Schemas.GetPushSubscriptionsDALRequest) {
    const response: Schemas.ApiResponse & { subscriptions?: Schemas.PushSubscription[] } = {
      isSuccess: false,
    };

    try {
      const subscriptionsResponse = await this.db
        .select()
        .from(pushSubscriptions)
        .where(
          and(eq(pushSubscriptions.userId, params.userId), isNull(pushSubscriptions.deletedAt)),
        );

      response.isSuccess = true;
      response.message = "Push subscriptions fetched successfully";
      response.subscriptions = subscriptionsResponse;
    } catch (error) {
      const message = "Unknown error in listing push subscriptions";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetPushSubscriptions,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async deletePushSubscription(params: Schemas.DeletePushSubscriptionDALRequest) {
    const response: Schemas.ApiResponse = { isSuccess: false };

    try {
      const now = new Date();
      const deleted = await this.db
        .update(pushSubscriptions)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(pushSubscriptions.publicId, params.publicId),
            eq(pushSubscriptions.userId, params.userId),
            isNull(pushSubscriptions.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!deleted) {
        const message = "Push subscription not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.DeletePushSubscription,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Push subscription deleted successfully";
    } catch (error) {
      const message = "Unknown error in deleting push subscription";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.DeletePushSubscription,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: NOT userId-scoped — a 410 from the push service names only the endpoint, and endpoints
  // are globally unique (see tables.ts DEV_NOTE). One of two deliberately unscoped queries in this
  // surface; the other, getSubscribedUserIds, lands in PR 3.
  async pruneSubscriptionByEndpoint(params: Schemas.PruneSubscriptionByEndpointDALRequest) {
    const response: Schemas.ApiResponse = { isSuccess: false };

    try {
      const now = new Date();
      const pruned = await this.db
        .update(pushSubscriptions)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(eq(pushSubscriptions.endpoint, params.endpoint), isNull(pushSubscriptions.deletedAt)),
        )
        .returning()
        .get();

      response.isSuccess = true;
      response.message = pruned ? "Push subscription pruned" : "No matching push subscription";
    } catch (error) {
      const message = "Unknown error in pruning push subscription";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.PrunePushSubscription,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: "no row" is a meaningful state (never-configured), not an error — response.isSuccess
  // is true whenever the query itself succeeds, and prefs stays undefined when there's no row. The
  // caller (Repo) fills in NOTIFICATION_PREFS_DEFAULTS for that case.
  async getNotificationPrefs(params: Schemas.GetNotificationPrefsDALRequest) {
    const response: Schemas.ApiResponse & { prefs?: Schemas.NotificationPrefs } = {
      isSuccess: false,
    };

    try {
      const [prefs] = await this.db
        .select()
        .from(notificationPrefs)
        .where(eq(notificationPrefs.userId, params.userId))
        .limit(1);

      response.isSuccess = true;
      response.message = prefs ? "Notification prefs fetched successfully" : "No prefs row yet";
      if (prefs) {
        response.prefs = {
          trackerRemindersEnabled: prefs.trackerRemindersEnabled,
          streakDigestEnabled: prefs.streakDigestEnabled,
          streakDigestHour: prefs.streakDigestHour,
          openIntervalEnabled: prefs.openIntervalEnabled,
          openIntervalThresholdMinutes: prefs.openIntervalThresholdMinutes,
        };
      }
    } catch (error) {
      const message = "Unknown error in fetching notification prefs";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetNotificationPrefs,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: insert values are NOTIFICATION_PREFS_DEFAULTS overridden by whatever fields the caller
  // sent — the row is NOT NULL end to end, so the first-ever write for a user needs concrete values
  // for the columns the caller didn't touch. On conflict (a row already exists), only the fields the
  // caller sent are updated — same partial-write guarantee as every other DAL update here.
  async upsertNotificationPrefs(params: Schemas.UpsertNotificationPrefsDALRequest) {
    const response: Schemas.ApiResponse & { prefs?: Schemas.NotificationPrefs } = {
      isSuccess: false,
    };

    try {
      const now = new Date();
      const merged = { ...Schemas.NOTIFICATION_PREFS_DEFAULTS, ...params.fields };

      const prefsResponse = await this.db
        .insert(notificationPrefs)
        .values({
          userId: params.userId,
          trackerRemindersEnabled: merged.trackerRemindersEnabled,
          streakDigestEnabled: merged.streakDigestEnabled,
          streakDigestHour: merged.streakDigestHour,
          openIntervalEnabled: merged.openIntervalEnabled,
          openIntervalThresholdMinutes: merged.openIntervalThresholdMinutes,
          createdAt: now,
          updatedAt: null,
        })
        .onConflictDoUpdate({
          target: notificationPrefs.userId,
          set: { ...params.fields, updatedAt: now },
        })
        .returning()
        .get();

      response.isSuccess = true;
      response.message = "Notification prefs saved successfully";
      response.prefs = {
        trackerRemindersEnabled: prefsResponse.trackerRemindersEnabled,
        streakDigestEnabled: prefsResponse.streakDigestEnabled,
        streakDigestHour: prefsResponse.streakDigestHour,
        openIntervalEnabled: prefsResponse.openIntervalEnabled,
        openIntervalThresholdMinutes: prefsResponse.openIntervalThresholdMinutes,
      };
    } catch (error) {
      const message = "Unknown error in saving notification prefs";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.UpsertNotificationPrefs,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: the ONE deliberately un-scoped query in this codebase (getPushSubscriptions above,
  // and every other DAL query anywhere, is userId-scoped by construction). The set it returns is
  // "users with at least one live push subscription" — a strict subset of users, and precisely the
  // set the dispatcher could act on. Reading `users` first would scan a table that grows with
  // signups; this one grows with people who actually turned notifications on. Everything downstream
  // (getUsersByClerkIds, getNotificationPrefsForUsers, getTrackersDueForReminder) is chunked back
  // into scoped queries, so the scoping invariant holds everywhere except this SELECT DISTINCT.
  async getSubscribedUserIds() {
    const response: Schemas.ApiResponse & { userIds?: string[] } = { isSuccess: false };

    try {
      const rows = await this.db
        .selectDistinct({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(isNull(pushSubscriptions.deletedAt));

      response.isSuccess = true;
      response.message = "Subscribed user ids fetched successfully";
      response.userIds = rows.map((row) => row.userId);
    } catch (error) {
      const message = "Unknown error in fetching subscribed user ids";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetSubscribedUserIds,
        message,
        error,
      });
      response.message = message;
    }

    return response;
  }

  async getNotificationPrefsForUsers(params: { userIds: string[] }) {
    const response: Schemas.ApiResponse & {
      prefsByUserId?: Map<string, Schemas.NotificationPrefs>;
    } = { isSuccess: false };

    if (params.userIds.length === 0) {
      response.isSuccess = true;
      response.prefsByUserId = new Map();
      return response;
    }

    try {
      const prefsByUserId = new Map<string, Schemas.NotificationPrefs>();
      for (const userIds of Utility.chunk(params.userIds)) {
        const rows = await this.db
          .select()
          .from(notificationPrefs)
          .where(inArray(notificationPrefs.userId, userIds));
        for (const row of rows) {
          prefsByUserId.set(row.userId, {
            trackerRemindersEnabled: row.trackerRemindersEnabled,
            streakDigestEnabled: row.streakDigestEnabled,
            streakDigestHour: row.streakDigestHour,
            openIntervalEnabled: row.openIntervalEnabled,
            openIntervalThresholdMinutes: row.openIntervalThresholdMinutes,
          });
        }
      }

      response.isSuccess = true;
      response.message = "Notification prefs fetched successfully";
      response.prefsByUserId = prefsByUserId;
    } catch (error) {
      const message = "Unknown error in fetching notification prefs for users";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetNotificationPrefs,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: lives here, not in TrackersDAL — precedent is OrphanScanDAL, which already reads
  // entries/entry_values/trackers because those reads serve one job. Keeping every dispatcher read
  // in one file is worth more here than one-DAL-per-table. Hits IDX_trackers_reminder_hour directly:
  // archived and deleted trackers are excluded because a hidden tracker shouldn't page anyone about
  // itself, but which *days* it fires on is left to the caller (isScheduled against manifest.schedule
  // in NotificationsRepo) — that filter isn't index-backed and doesn't belong in the WHERE clause.
  async getTrackersDueForReminder(params: { userIds: string[]; hour: number }) {
    const response: Schemas.ApiResponse & { trackers?: TrackerDueForReminder[] } = {
      isSuccess: false,
    };

    if (params.userIds.length === 0) {
      response.isSuccess = true;
      response.trackers = [];
      return response;
    }

    try {
      const due: TrackerDueForReminder[] = [];
      for (const userIds of Utility.chunk(params.userIds)) {
        const rows = await this.db
          .select({
            publicId: trackers.publicId,
            userId: trackers.userId,
            name: trackers.name,
            manifestJson: trackers.manifestJson,
            activeFrom: trackers.activeFrom,
          })
          .from(trackers)
          .where(
            and(
              inArray(trackers.userId, userIds),
              eq(trackers.reminderHour, params.hour),
              isNull(trackers.archivedAt),
              isNull(trackers.deletedAt),
            ),
          );
        due.push(...rows);
      }

      response.isSuccess = true;
      response.message = "Trackers due for reminder fetched successfully";
      response.trackers = due;
    } catch (error) {
      const message = "Unknown error in fetching trackers due for reminder";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetTrackersDueForReminder,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: the only atomic claim available with no KV/Queue — a unique index in D1 (composite PK
  // on notification_sends). Insert-before-send: a conflict means somebody already claimed this
  // (user, dedupKey), so `claimed: false` tells the caller to skip the send entirely, not retry it.
  // Verified: SQLite's INSERT ... ON CONFLICT DO NOTHING RETURNING yields zero rows when the
  // conflict suppresses the insert — exactly what `claimed` reads off of, no fallback needed.
  async claimNotificationSend(params: {
    userId: string;
    dedupKey: string;
    trigger: Schemas.NotificationTrigger;
  }) {
    const response: Schemas.ApiResponse & { claimed?: boolean } = { isSuccess: false };

    try {
      const now = new Date();
      const inserted = await this.db
        .insert(notificationSends)
        .values({
          userId: params.userId,
          dedupKey: params.dedupKey,
          trigger: params.trigger,
          sentAt: now,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning();

      response.isSuccess = true;
      response.message = inserted.length > 0 ? "Claimed" : "Already claimed";
      response.claimed = inserted.length > 0;
    } catch (error) {
      const message = "Unknown error in claiming notification send";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.ClaimNotificationSend,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: PR 4's second cross-user read (after getSubscribedUserIds/getTrackersDueForReminder) —
  // lives here for the same reason: one dispatcher-only query file rather than one-DAL-per-table.
  // `olderThan` is the *smallest* threshold across every eligible user (computed by the caller), so
  // this is one bounded scan rather than one query per user; the exact per-user bucket (which
  // multiple of their own threshold this entry has crossed) is resolved in the Repo, since it needs
  // each user's own openIntervalThresholdMinutes. Joins trackers only for the name/publicId the
  // notification body needs — an archived or deleted tracker is excluded, same reasoning as
  // getTrackersDueForReminder: a hidden tracker shouldn't page anyone about itself.
  async getOpenIntervalsForUsers(params: { userIds: string[]; olderThan: Date }) {
    const response: Schemas.ApiResponse & { entries?: OpenIntervalEntry[] } = { isSuccess: false };

    if (params.userIds.length === 0) {
      response.isSuccess = true;
      response.entries = [];
      return response;
    }

    try {
      const found: OpenIntervalEntry[] = [];
      for (const userIds of Utility.chunk(params.userIds)) {
        const rows = await this.db
          .select({
            userId: entries.userId,
            entryPublicId: entries.publicId,
            trackerPublicId: trackers.publicId,
            trackerName: trackers.name,
            occurredAt: entries.occurredAt,
          })
          .from(entries)
          .innerJoin(trackers, eq(trackers.id, entries.trackerId))
          .where(
            and(
              inArray(entries.userId, userIds),
              eq(entries.entryKind, "interval"),
              isNull(entries.endedAt),
              isNull(entries.deletedAt),
              isNull(trackers.deletedAt),
              isNull(trackers.archivedAt),
              lt(entries.occurredAt, params.olderThan),
            ),
          );
        found.push(...rows);
      }

      response.isSuccess = true;
      response.message = "Open intervals fetched successfully";
      response.entries = found;
    } catch (error) {
      const message = "Unknown error in fetching open intervals for users";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetOpenIntervalsForUsers,
        message,
        error,
        metadata: { userIds: params.userIds.length, olderThan: params.olderThan },
      });
      response.message = message;
    }

    return response;
  }
}
