/* Blob's service worker.
 *
 * Deliberately minimal: push and notification-click only. No offline precache — a
 * stale-shell SPA served from a cache is a support burden self-hosters do not need,
 * and the outbox already covers the "sent while offline" case that matters.
 *
 * Versioned so a deploy replaces the worker promptly; skipWaiting keeps an old
 * worker from pinning old clients for days.
 */

const VERSION = 'blob-sw-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Blob', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Blob';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      // One notification per conversation: a busy channel updates in place
      // rather than stacking.
      tag: payload.tag || 'blob',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Prefer a tab that is already open: focus it and steer it to the
      // conversation instead of multiplying windows.
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
