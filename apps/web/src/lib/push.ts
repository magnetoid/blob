/**
 * Web push, client half. The server half — VAPID keys, subscription storage, the
 * worker's fan-out — has been complete since the port; this is its first caller.
 *
 * The subscription lives in the browser's push service, keyed by this origin. Blob
 * stores the endpoint + keys and posts to it; 404/410 from the push service is how
 * the server learns a browser threw the subscription away.
 */

import { api } from './api.ts';

export type PushState =
  | 'unsupported'   // no serviceWorker/PushManager (or an http origin)
  | 'no-server-key' // the server has no VAPID keys configured
  | 'denied'        // the person said no; only they can undo that, in browser UI
  | 'off'
  | 'on';

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Register the worker. Idempotent; safe to call on every boot. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    // Dev servers and odd origins fail here; push simply reads as unsupported.
    return null;
  }
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const { key } = await api.me.pushPublicKey().catch(() => ({ key: null }));
  if (!key) return 'no-server-key';
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  const registration = await registerServiceWorker();
  if (!registration) return 'unsupported';
  const { key } = await api.me.pushPublicKey();
  if (!key) return 'no-server-key';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKeyBytes(key),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    await subscription.unsubscribe();
    throw new Error('The browser returned an unusable subscription.');
  }
  await api.me.subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    // Tell the server first: if unsubscribe succeeds but the DELETE fails, the
    // server pushes into a void until a 410 teaches it, which is harmless. The
    // other order leaks a dead row forever.
    await api.me.unsubscribePush(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
  }
  return 'off';
}

/** True on iOS Safari when the app is NOT installed to the home screen — the one
 * platform where push exists only after installation, with no prompt to say so. */
export function needsIosInstall(): boolean {
  if (typeof navigator === 'undefined') return false;
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari's non-standard flag predates the media query and is still what iOS sets.
    (navigator as { standalone?: boolean }).standalone === true;
  return isIos && !standalone;
}

/** The base64url VAPID key, as the BufferSource subscribe() wants. */
function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
