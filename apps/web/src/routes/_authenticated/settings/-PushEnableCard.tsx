import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@clerk/tanstack-react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shadcn/ui/card";
import { Button } from "@/shadcn/ui/button";
import {
  deviceLabel,
  getExistingSubscription,
  isIos,
  isIosStandalone,
  isPushSupported,
  registerServiceWorker,
  storeSubscriptionPublicId,
  subscribeToPush,
} from "@/providers/pushClient";
import { NotificationsQueries, useCreatePushSubscription, useSendTestNotification } from "./-data";

type SupportState = "checking" | "unsupported" | "ios-needs-install" | "ready";
type SubscriptionState = "checking" | "enabled" | "disabled";

// DEV_NOTE: isPushSupported()/isIos()/isIosStandalone() read `window`/`navigator`, which don't exist
// during SSR and never change once the page has loaded — useSyncExternalStore (a no-op subscribe,
// since there's nothing to subscribe to) is the sanctioned way to read an environment fact like this
// without a hydration mismatch: React renders the server snapshot on the client's first pass too,
// then settles into the real one, rather than a useEffect+setState desync-and-repaint.
function getSupportSnapshot(): SupportState {
  if (!isPushSupported()) return isIos() ? "ios-needs-install" : "unsupported";
  if (isIos() && !isIosStandalone()) return "ios-needs-install";
  return "ready";
}
function getSupportServerSnapshot(): SupportState {
  return "checking";
}
function subscribeToNothing() {
  return () => {};
}
function useSupportState(): SupportState {
  return useSyncExternalStore(subscribeToNothing, getSupportSnapshot, getSupportServerSnapshot);
}

export function PushEnableCard() {
  const { getToken } = useAuth();
  const supportState = useSupportState();
  const vapidQuery = useQuery({
    ...NotificationsQueries.vapidKey(getToken),
    enabled: supportState === "ready",
  });
  const createSubscription = useCreatePushSubscription();
  const sendTest = useSendTestNotification();

  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState>("checking");
  const [isEnabling, setIsEnabling] = useState(false);

  // DEV_NOTE: the self-heal — push services silently rotate and expire endpoints, and upsert-on-
  // endpoint makes a re-POST idempotent server-side. Runs on every mount, not just after enabling.
  useEffect(() => {
    if (supportState !== "ready") return;
    let cancelled = false;

    (async () => {
      if (Notification.permission !== "granted") {
        if (!cancelled) setSubscriptionState("disabled");
        return;
      }
      const existing = await getExistingSubscription();
      if (!existing) {
        if (!cancelled) setSubscriptionState("disabled");
        return;
      }
      if (!cancelled) setSubscriptionState("enabled");

      const json = existing.toJSON();
      if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
        createSubscription.mutate({
          subscription: {
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
            deviceLabel: deviceLabel(),
          },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // createSubscription is a fresh object every render (react-query doesn't memoize it) — including
    // it would re-run this effect (and re-POST the subscription) on every render instead of once per
    // mount / supportState change, which is the actual trigger for "check if we should self-heal".
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps
  }, [supportState]);

  async function handleEnable() {
    if (!vapidQuery.data?.vapidPublicKey) {
      toast.error("Couldn't load notification settings. Please try again.");
      return;
    }

    setIsEnabling(true);
    try {
      // DEV_NOTE: MUST be the first await in this handler — Safari drops the user-gesture context
      // across an await, so anything awaited before requestPermission() silently fails on iOS.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Notifications permission was not granted.");
        return;
      }

      await registerServiceWorker();
      const subscription = await subscribeToPush(vapidQuery.data.vapidPublicKey);
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Push subscription is missing required fields");
      }

      const response = await createSubscription.mutateAsync({
        subscription: {
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          deviceLabel: deviceLabel(),
        },
      });
      if (response.subscription) {
        storeSubscriptionPublicId(response.subscription.publicId);
      }
      setSubscriptionState("enabled");
    } catch {
      // useCreatePushSubscription's onError already toasts network/server failures; this catches
      // the browser-API steps (permission, registration, subscribe) before that mutation runs.
      toast.error("Failed to enable notifications. Please try again.");
    } finally {
      setIsEnabling(false);
    }
  }

  if (supportState === "checking") return null;

  if (supportState === "unsupported") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>This browser doesn't support push notifications.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (supportState === "ios-needs-install") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            iOS only supports notifications for an app added to your Home Screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
            <li>Tap the Share button in Safari's toolbar.</li>
            <li>Choose "Add to Home Screen".</li>
            <li>Open Neuron from the Home Screen icon, then come back to this page.</li>
          </ol>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          {subscriptionState === "enabled"
            ? "Push notifications are enabled on this device."
            : "Get a reminder for trackers you haven't logged yet today."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        {subscriptionState === "enabled" ? (
          <Button variant="outline" disabled={sendTest.isPending} onClick={() => sendTest.mutate()}>
            {sendTest.isPending ? "Sending..." : "Send a test notification"}
          </Button>
        ) : (
          <Button disabled={isEnabling || subscriptionState === "checking"} onClick={handleEnable}>
            {isEnabling ? "Enabling..." : "Enable notifications"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
