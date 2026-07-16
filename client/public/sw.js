/* ChatConnect service worker — Web Push notifications.
   Kept dependency-free and tiny; it only handles push display + click routing. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
    icon: data.icon || '/logo.svg',
    badge: '/logo.svg',
    tag: data.tag, // collapse repeat pings for the same chat
    renotify: Boolean(data.tag),
    data: data.data || {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Focus an existing tab if one is open; otherwise open a new one.
      for (const w of wins) {
        if ('focus' in w) {
          if ('navigate' in w) w.navigate(target).catch(() => {});
          return w.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});
