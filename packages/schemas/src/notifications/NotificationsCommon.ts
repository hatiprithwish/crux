import { z } from "zod";

// DEV_NOTE: text columns, not the int+label Status Enum Pattern — same reasoning as DomainEnums.ts:
// these are `text not null` in the DB (notification_sends.trigger), so the DB and wire format share
// one string with no int mapping to maintain.
export const ZNotificationTrigger = z.enum(["tracker_reminder", "streak_digest", "open_interval"]);
export type NotificationTrigger = z.infer<typeof ZNotificationTrigger>;

// DEV_NOTE: the contract with sw.js, which is plain JS and cannot import this — keep the two in
// sync by hand. `url` is where notificationclick focuses/opens; `tag` collapses repeat notifications
// of the same trigger into one system-tray entry rather than stacking.
export const ZPushPayload = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  url: z.string().min(1),
  tag: z.string().min(1),
});
export type PushPayload = z.infer<typeof ZPushPayload>;

// Whole PushSubscription Body — DB shape
export interface PushSubscription {
  id: number;
  publicId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  lastSeenAt: Date;
  lastSentAt?: Date | null;
  createdAt: Date;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
}

// DEV_NOTE: endpoint/p256dh/auth omitted alongside id/userId/deletedAt — an endpoint is a write
// capability for that device's push channel, no screen needs it back, and the device list
// identifies "this device" by the publicId the client stashed in localStorage at subscribe time.
export type PushSubscriptionApiShape = Omit<
  PushSubscription,
  "id" | "userId" | "deletedAt" | "endpoint" | "p256dh" | "auth"
>;

export const ZPushSubscriptionInput = z.object({
  endpoint: z.string().min(1),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  deviceLabel: z.string().min(1),
});
export type PushSubscriptionInput = z.infer<typeof ZPushSubscriptionInput>;

// DEV_NOTE: its own table rather than columns on `users` — see NOTIFICATION_PREFS_DEFAULTS below
// and the DEV_NOTE in tables.ts. No publicId (never in a URL, architecture.md §4), no deletedAt
// (turning every trigger off is `false`, not a delete).
export const ZNotificationPrefs = z.object({
  trackerRemindersEnabled: z.boolean(),
  streakDigestEnabled: z.boolean(),
  streakDigestHour: z.number().int().min(0).max(23),
  openIntervalEnabled: z.boolean(),
  openIntervalThresholdMinutes: z.number().int().min(1),
});
export type NotificationPrefs = z.infer<typeof ZNotificationPrefs>;

// DEV_NOTE: "no row" means never-configured, and this is what a never-configured user gets — reminders
// and the digest on by default (the whole point of shipping this feature), an evening hour for the
// digest, and a 4h open-interval threshold (a 9h timer nags at 4h and 8h, not hourly — see
// NotificationsRepo's dedup key).
export const NOTIFICATION_PREFS_DEFAULTS: NotificationPrefs = {
  trackerRemindersEnabled: true,
  streakDigestEnabled: true,
  streakDigestHour: 21,
  openIntervalEnabled: true,
  openIntervalThresholdMinutes: 240,
};
