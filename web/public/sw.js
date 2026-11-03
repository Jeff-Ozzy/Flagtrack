/* FlagTrack service worker: app-shell cache + Web Push reminders.
 * API calls are never cached — data always comes from the server, so the
 * 24h retroactive rule is always validated with the server clock. */
const CACHE = 'flagtrack-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    // Network first for navigation, cached shell when offline.
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.png'))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'FlagTrack', body: 'Você tem um lembrete.', url: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(target);
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
