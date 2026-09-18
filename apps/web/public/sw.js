// DEV_NOTE: plain JS, no imports, no build step — this file ships as-is (see @cloudflare/vite-plugin
// serving apps/web/public/* at origin root). It has no fetch handler and does no caching; it exists
// solely so the browser accepts a push subscription (userVisibleOnly requires an active SW), and its
// two jobs are showing a notification and focusing/opening a tab when one is clicked.
//
// The payload shape (title, body, url, tag) is the contract with ZPushPayload in
// packages/schemas/src/notifications/NotificationsCommon.ts — this file can't import that Zod
// schema, so keep the two in sync by hand if either changes.

// Take over as soon as a new version installs, instead of waiting for every open tab to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = { title: "Neuron", body: "", url: "/trackers", tag: "neuron-notification" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Non-JSON payload (e.g. DevTools' Push button sends plain text) — show the raw text as the body.
    payload.body = event.data.text();
  }

  // DEV_NOTE: showNotification MUST be called — userVisibleOnly: true (required by Chrome at
  // subscribe time) means a push handler that resolves without showing anything makes the browser
  // display its own "This site has been updated in the background" notice instead.
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      // Same-tag pushes replace the existing notification; without renotify the replacement is silent.
      renotify: true,
      icon: "/favicons/android-chrome-192x192.png",
      badge: "/favicons/favicon-32x32.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/trackers";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
