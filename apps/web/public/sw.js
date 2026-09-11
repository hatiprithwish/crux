// DEV_NOTE: plain JS, no imports, no build step — this file ships as-is (see @cloudflare/vite-plugin
// serving apps/web/public/* at origin root). It has no fetch handler and does no caching; it exists
// solely so the browser accepts a push subscription (userVisibleOnly requires an active SW), and its
// two jobs are showing a notification and focusing/opening a tab when one is clicked.
//
// The payload shape (title, body, url, tag) is the contract with ZPushPayload in
// packages/schemas/src/notifications/NotificationsCommon.ts — this file can't import that Zod
// schema, so keep the two in sync by hand if either changes.

self.addEventListener("push", (event) => {
  let payload = { title: "Crux", body: "", url: "/trackers", tag: "crux-notification" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Malformed payload — fall back to the generic notification below rather than showing nothing.
  }

  // DEV_NOTE: showNotification MUST be called — userVisibleOnly: true (required by Chrome at
  // subscribe time) means a push handler that resolves without showing anything makes the browser
  // display its own "This site has been updated in the background" notice instead.
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
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
