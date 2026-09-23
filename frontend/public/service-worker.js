const CACHE = 'control-deck-v2';
const STATIC_ASSETS = [
  '/static/',
  '/static/manifest.json',
  '/static/background.html',
  '/static/icon-192.png',
  '/static/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC_ASSETS).catch(()=>{})).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
  );
});

// Network-first for API/media-stream, cache-first for static
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media-stream') || url.pathname.startsWith('/ws/')) {
    // Don't cache API — just pass through, but keep service worker alive
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        // Cache successful static responses
        if (res.ok && e.request.method === 'GET' && url.pathname.startsWith('/static/')) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(()=> cached || Response.error());
    })
  );
});

// Background Sync: when the browser wakes the SW, try to notify clients to reconnect
self.addEventListener('sync', (e) => {
  if (e.tag === 'deck-broadcast-sync') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'deck-sync' }));
      })
    );
  }
});

// Push: server could send a push when broadcast starts (if VAPID configured)
// For now, handle generic push and show a notification that opens the background page
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  const title = data.title || 'Control Deck';
  const body = data.body || 'Broadcast started — tap to listen';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/static/icon-192.png',
      badge: '/static/icon-192.png',
      tag: 'deck-broadcast',
      renotify: true,
      data: { url: '/static/background.html?autostart=1' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/static/background.html?autostart=1';
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes('/static/background.html') || c.url.includes('/static/')) {
          c.focus();
          c.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Keep alive: periodic message to clients to check broadcast
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'deck-poll') {
    e.waitUntil(
      fetch('/api/clients', { cache: 'no-store' }).then((r)=>r.json()).then((j)=>{
        if (j.broadcasting) {
          return self.registration.showNotification('Control Deck', {
            body: 'Broadcast is live — tap to join',
            icon: '/static/icon-192.png',
            tag: 'deck-broadcast',
            data: { url: '/static/background.html?autostart=1' },
          });
        }
      }).catch(()=>{})
    );
  }
});
