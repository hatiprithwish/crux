// DEV_NOTE: a plain browser-API adapter beside apiClient.ts — no React, no Zod. Orchestration (the
// permission-then-register-then-subscribe order, the POST to save the subscription) lives in
// -PushEnableCard.tsx; this file only wraps individual browser APIs so that component isn't reading
// raw `navigator.serviceWorker`/`PushManager` calls directly.

const SUBSCRIPTION_PUBLIC_ID_KEY = "crux:pushSubscriptionPublicId";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // DEV_NOTE: iPadOS 13+ reports as "MacIntel" with touch support — the classic iPad UA-sniffing
  // trap. maxTouchPoints > 1 is what actually distinguishes it from a real Mac.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isIosStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // `navigator.standalone` is Safari-only and not in the DOM lib types.
  return isIos() && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// DEV_NOTE: ~15 lines of coarse UA parsing, not a library — a native equivalent (UA-CH where
// available, UA string otherwise) is enough for a device-list label like "Chrome on Mac"; nothing
// here needs to be exact.
export function deviceLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

  let os = "Unknown device";
  if (/ipad/i.test(ua)) os = "iPad";
  else if (/iphone|ipod/i.test(ua)) os = "iPhone";
  else if (/android/i.test(ua)) os = "Android";
  else if (/mac os x/i.test(ua)) os = "Mac";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "Browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/crios\//i.test(ua) || /chrome\//i.test(ua)) browser = "Chrome";
  else if (/fxios\//i.test(ua) || /firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua)) browser = "Safari";

  return `${browser} on ${os}`;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js");
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
}

export async function unsubscribeFromPush(): Promise<boolean> {
  const existing = await getExistingSubscription();
  if (!existing) return true;
  return existing.unsubscribe();
}

// DEV_NOTE: identifies "this device" in the device list without ever holding the endpoint client-
// side (see PushSubscriptionApiShape) — set once on a successful subscribe, read on every settings
// mount for the self-heal re-POST and to highlight this row in the list.
export function getStoredSubscriptionPublicId(): string | null {
  try {
    return localStorage.getItem(SUBSCRIPTION_PUBLIC_ID_KEY);
  } catch {
    return null;
  }
}

export function storeSubscriptionPublicId(publicId: string): void {
  try {
    localStorage.setItem(SUBSCRIPTION_PUBLIC_ID_KEY, publicId);
  } catch {
    // Private browsing / storage blocked — the self-heal re-POST just won't highlight "this device".
  }
}

export function clearStoredSubscriptionPublicId(): void {
  try {
    localStorage.removeItem(SUBSCRIPTION_PUBLIC_ID_KEY);
  } catch {
    // Nothing to clean up if storage was never writable.
  }
}
