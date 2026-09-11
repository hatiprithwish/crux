import { z } from "zod";
import { ZNotificationPrefs, ZPushSubscriptionInput } from "./NotificationsCommon";

export const ZCreatePushSubscriptionApiRequest = z.object({
  subscription: ZPushSubscriptionInput,
});
export type CreatePushSubscriptionApiRequest = z.infer<typeof ZCreatePushSubscriptionApiRequest>;

// DEV_NOTE: partial/strict/refine, same shape as ZUpdateMetricApiRequest and ZUpdateUserApiRequest —
// only the fields the caller actually sent are written, so toggling one preference can't reset
// another the settings screen never showed.
export const ZUpdateNotificationPrefsApiRequest = ZNotificationPrefs.partial()
  .strict()
  .refine((prefs) => Object.keys(prefs).length > 0, {
    message: "Provide at least one field to update",
  });
export type UpdateNotificationPrefsApiRequest = z.infer<typeof ZUpdateNotificationPrefsApiRequest>;
