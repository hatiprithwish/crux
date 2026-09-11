import type { NotificationPrefs, PushSubscription } from "./NotificationsCommon";

export type UpsertPushSubscriptionDALRequest = Pick<PushSubscription, "userId"> & {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
};

export type GetPushSubscriptionsDALRequest = Pick<PushSubscription, "userId">;

export type DeletePushSubscriptionDALRequest = Pick<PushSubscription, "userId" | "publicId">;

// DEV_NOTE: not userId-scoped — a 410 from the push service names only the endpoint, and endpoints
// are globally unique (see tables.ts). This is one of two deliberately unscoped queries in the
// notifications surface; the other is NotificationsDAL.getSubscribedUserIds (PR 3).
export type PruneSubscriptionByEndpointDALRequest = { endpoint: string };

export type GetNotificationPrefsDALRequest = { userId: string };

export type UpsertNotificationPrefsDALRequest = {
  userId: string;
  fields: Partial<NotificationPrefs>;
};
