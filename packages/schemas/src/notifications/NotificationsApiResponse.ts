import type { NotificationPrefs, PushSubscriptionApiShape } from "./NotificationsCommon";
import type { ApiResponse } from "../common";

export interface GetVapidPublicKeyApiResponse extends ApiResponse {
  vapidPublicKey?: string;
}

export interface CreatePushSubscriptionApiResponse extends ApiResponse {
  subscription?: PushSubscriptionApiShape;
}

export interface GetPushSubscriptionsApiResponse extends ApiResponse {
  subscriptions?: PushSubscriptionApiShape[];
}

export interface GetNotificationPrefsApiResponse extends ApiResponse {
  prefs?: NotificationPrefs;
}

export interface UpdateNotificationPrefsApiResponse extends ApiResponse {
  prefs?: NotificationPrefs;
}
