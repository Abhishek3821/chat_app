/* ChatConnect service worker — Web Push notifications + offline app shell.
   Dependency-free; handles push display/click routing AND caches the app so it
   opens (installed, like a native app) without a network connection. */

// Bumped to v3: the shell list gained the raster icons, and an old cache would
// keep serving a manifest that still pointed only at the SVG.
const CACHE = 'cc-shell-v3';
const APP_SHELL = ['/', '/index.html', '/logo.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
// Chrome will NOT render an SVG as a notification icon — it silently falls back
// to a generic browser glyph, which is what every push used to show.
const ICON = '/icon-192.png';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * Fetch strategy:
 *  - API / socket.io / non-GET / cross-origin → straight to network (never cached).
 *  - Page navigations → network-first, fall back to the cached shell when offline
 *    (so the SPA still boots; it then shows its own "reconnecting" states).
 *  - Same-origin static assets (hashed JS/CSS/img) → stale-while-revalidate.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/uploads')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => { caches.open(CACHE).then((c) => c.put('/index.html', res.clone())).catch(() => {}); return res; })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  const title = data.title || 'ChatConnect';
  const options = {
    body: data.body || '',
    icon: data.icon || ICON,
    badge: ICON,
    tag: data.tag, // collapse repeat pings for the same chat
    renotify: Boolean(data.tag),
    vibrate: [90, 40, 90],
    timestamp: Date.now(),
    data: data.data || {},
  };
  // The server pushes to every recipient regardless of whether they have the app
  // open. If a window is visible right now the page is already alerting the user
  // in-app, so showing this too would double-notify.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return undefined;
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => 'focus' in w);
      if (open) {
        // Tell the running app to switch conversations rather than calling
        // w.navigate(): navigate() is a real page load, so tapping a
        // notification on an already-open app threw away the whole SPA — socket,
        // stores, loaded messages — and re-booted it just to change chat.
        if (data.chatId) open.postMessage({ type: 'cc:open-chat', chatId: data.chatId });
        return open.focus();
      }
      // Nothing open: cold-start at the deep link, which App.jsx reads on boot.
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});
