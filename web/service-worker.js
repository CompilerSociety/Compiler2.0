/* Service worker for seating-plan push notifications.
   Shows a system-tray notification (works even when the site is closed). */
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

// A fetch handler is required for the app to be installable (PWA). We just pass
// requests through to the network — no offline caching (data must stay fresh).
self.addEventListener('fetch', event => { /* network passthrough */ });

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: 'FAST Compiler', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'FAST Compiler';
  const options = {
    body: data.body || '',
    tag: data.tag || 'seating-update',
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
