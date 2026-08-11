/* Service worker for seating-plan push notifications.
   Shows a system-tray notification (works even when the site is closed). */
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

function buildSwErrorPayload(reason, context) {
  let message = 'An unexpected service worker error occurred.';
  let detail = '';
  if (reason instanceof Error) {
    message = reason.message || message;
    detail = reason.stack || reason.message || '';
  } else if (typeof reason === 'string') {
    message = reason;
  } else if (reason && typeof reason === 'object') {
    if (typeof reason.message === 'string' && reason.message) message = reason.message;
    try { detail = JSON.stringify(reason); } catch (e) {}
  } else if (reason != null) {
    message = String(reason);
  }
  return { type: 'vtable-sw-error', context: context || 'Service worker', message, detail };
}

function reportSwError(reason, context) {
  const payload = buildSwErrorPayload(reason, context);
  console.error(payload.context + ':', reason);
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if (client && 'postMessage' in client) client.postMessage(payload);
    }
  }).catch(() => {});
}

// A fetch handler is required for the app to be installable (PWA). We just pass
// requests through to the network — no offline caching (data must stay fresh).
self.addEventListener('fetch', event => { /* network passthrough */ });

self.addEventListener('error', event => {
  const reason = event?.error || event?.message || 'Unhandled service worker error';
  reportSwError(reason, 'Service worker runtime');
});

self.addEventListener('unhandledrejection', event => {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  reportSwError(event?.reason || 'Unhandled service worker promise rejection', 'Service worker promise');
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) {
    reportSwError(e, 'Push payload parse');
    data = { title: 'FAST Compiler', body: event.data ? event.data.text() : '' };
  }

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
    }).catch(err => reportSwError(err, 'Notification click'))
  );
});
