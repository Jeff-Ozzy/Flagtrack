/* FlagTrack service worker.
 * - Precaches every built file (list injected at build time) so the installed
 *   app opens and works fully offline.
 * - Never caches /api: in server mode data always comes from the server, so
 *   the 24h retroactive rule uses the server clock.
 * - Handles Web Push reminders (server mode). */
const VERSION = '__BUILD_VERSION__';
const CACHE = `flagtrack-${VERSION}`;
const FONT_CACHE = 'flagtrack-fonts';
const PRECACHE = self.__PRECACHE__ || [];
const BASE = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([BASE, ...PRECACHE.map((f) => new URL(f, BASE).href)]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: cache-first so typography also works offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then((c) =>
        c.match(req).then((hit) => hit || fetch(req).then((res) => (c.put(req, res.clone()), res)).catch(() => hit)),
      ),
    );
    return;
  }
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return;

  if (req.mode === 'navigate') {
    // Network first (fresh version when online), app shell when offline.
    event.respondWith(withTimeout(fetch(req), 3500).catch(() => caches.match(BASE)));
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.href.startsWith(BASE)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'FlagTrack', body: 'Você tem um lembrete.', url: BASE };
  try {
    data = { ...data, ...event.data.json() };
  } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: new URL('icon-192.png', BASE).href,
      badge: new URL('icon-192.png', BASE).href,
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '.', BASE).href;
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
