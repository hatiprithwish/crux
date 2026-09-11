import { useSyncExternalStore } from "react";
import { useAuth } from "@clerk/tanstack-react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shadcn/ui/card";
import { Button } from "@/shadcn/ui/button";
import Utilities from "@/utils";
import {
  clearStoredSubscriptionPublicId,
  getStoredSubscriptionPublicId,
} from "@/providers/pushClient";
import { NotificationsQueries, useDeletePushSubscription } from "./-data";

function subscribeToNothing() {
  return () => {};
}
function getServerSnapshot() {
  return null;
}

export function DeviceList() {
  const { getToken } = useAuth();
  const subscriptionsQuery = useQuery(NotificationsQueries.subscriptions(getToken));
  const deleteSubscription = useDeletePushSubscription();

  // DEV_NOTE: client-only — localStorage isn't available during SSR, and this is only a label
  // ("this device"), never something the delete flow depends on to function. useSyncExternalStore
  // (a no-op subscribe — there's nothing to subscribe to) reads it without a hydration mismatch;
  // removing a device re-renders this component anyway (the delete mutation invalidates the
  // subscriptions query), which is what picks up clearStoredSubscriptionPublicId()'s effect below.
  const thisDevicePublicId = useSyncExternalStore(
    subscribeToNothing,
    getStoredSubscriptionPublicId,
    getServerSnapshot,
  );

  const subscriptions = subscriptionsQuery.data?.subscriptions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>Where reminders are sent.</CardDescription>
      </CardHeader>
      <CardContent>
        {subscriptionsQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : subscriptionsQuery.isError ? (
          <p className="text-sm text-destructive">Failed to load devices.</p>
        ) : subscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices enabled yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {subscriptions.map((subscription) => (
              <div key={subscription.publicId} className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-sm">
                    {subscription.deviceLabel}
                    {subscription.publicId === thisDevicePublicId ? (
                      <span className="ml-2 text-xs text-muted-foreground">(this device)</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Last seen {Utilities.formatTimestampDate(subscription.lastSeenAt)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deleteSubscription.isPending}
                  onClick={() => {
                    deleteSubscription.mutate(subscription.publicId);
                    if (subscription.publicId === thisDevicePublicId) {
                      clearStoredSubscriptionPublicId();
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
