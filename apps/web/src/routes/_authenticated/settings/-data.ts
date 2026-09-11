import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { apiClient } from "@/providers/apiClient";
import type * as Schemas from "@app/schemas";
import { toast } from "sonner";

// DEV_NOTE: mirrors entities/-data.ts — a Queries class with hierarchical keys, all() prefixing
// every other key so one invalidation covers the vapid key, the device list, and prefs together.
export class NotificationsQueries {
  static readonly keys = {
    all: () => ["notifications"] as const,
    vapidKey: () => ["notifications", "vapidKey"] as const,
    subscriptions: () => ["notifications", "subscriptions"] as const,
    prefs: () => ["notifications", "prefs"] as const,
  };

  static vapidKey(getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: NotificationsQueries.keys.vapidKey(),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetVapidPublicKeyApiResponse>(
          "/notifications/vapid-public-key",
          getToken,
          { signal },
        ),
      // DEV_NOTE: the key rotates only alongside a worker deploy, if ever — no reason to refetch it
      // more than once per session.
      staleTime: Infinity,
    });
  }

  static subscriptions(getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: NotificationsQueries.keys.subscriptions(),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetPushSubscriptionsApiResponse>(
          "/notifications/subscriptions",
          getToken,
          {
            signal,
          },
        ),
    });
  }

  static prefs(getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: NotificationsQueries.keys.prefs(),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetNotificationPrefsApiResponse>("/notifications/prefs", getToken, {
          signal,
        }),
    });
  }
}

// DEV_NOTE: mutateAsync, not mutate — the enable flow needs the returned publicId back
// synchronously to stash in localStorage (see pushClient.ts), which is what makes the device list
// able to point out "this device" and what the self-heal re-POST on mount reads back.
export function useCreatePushSubscription() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Schemas.CreatePushSubscriptionApiRequest) =>
      apiClient<Schemas.CreatePushSubscriptionApiResponse>(
        "/notifications/subscriptions",
        getToken,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: NotificationsQueries.keys.subscriptions() });
    },
    onError: () => {
      toast.error("Failed to enable notifications. Please try again.");
    },
  });
}

export function useDeletePushSubscription() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (publicId: string) =>
      apiClient<Schemas.ApiResponse>(`/notifications/subscriptions/${publicId}`, getToken, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: NotificationsQueries.keys.subscriptions() });
    },
    onError: () => {
      toast.error("Failed to remove device. Please try again.");
    },
  });
}

export function useUpdateNotificationPrefs() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Schemas.UpdateNotificationPrefsApiRequest) =>
      apiClient<Schemas.UpdateNotificationPrefsApiResponse>("/notifications/prefs", getToken, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    // DEV_NOTE: setQueryData, not invalidate — a toggle should reflect immediately, not flicker back
    // to its old value while a refetch is in flight.
    onSuccess: (response) => {
      if (response.prefs) {
        queryClient.setQueryData(NotificationsQueries.keys.prefs(), response);
      }
    },
    onError: () => {
      toast.error("Failed to save preference. Please try again.");
    },
  });
}

export function useSendTestNotification() {
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: () =>
      apiClient<Schemas.ApiResponse>("/notifications/test", getToken, { method: "POST" }),
    onSuccess: (response) => {
      toast.success(response.message ?? "Test notification sent");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to send test notification");
    },
  });
}
