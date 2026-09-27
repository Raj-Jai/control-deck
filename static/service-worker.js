// The cache name carries the build's asset hash, so a rebuild invalidates the
// old entries. A fixed name meant cache-first HTML kept serving the previous
// build to an already-installed PWA, which is how a deployed change silently
// did not appear (BUG-019).
const CACHE = 'control-deck-vCjEshpvW';
const PRECACHE = [
  '/static/',
  '/static/manifest.json',
  '/static/background.html',
  '/static/icon-192.png',
  '/static/icon-512.png',
];



self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(()=>{})).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Same origin only. The worker is served from /static/ but registered with
  // Service-Worker-Allowed: /, so its scope is the whole origin and this
  // handler was seeing every request the page made - Open-Meteo forecasts,
  // YouTube thumbnails and the rest. Each of those got a cache lookup and,
  // because the shell test matched any pathname ending in '/', some of them
  // were written into our cache as well (BUG-018, PERF-24). A worker has no
  // business holding a third party's response, and it added a hop to every
  // request for no benefit.
  if (url.origin !== self.location.origin) return;

  // Never touch live data: the audio socket, the event stream, or anything
  // under /api/. Caching any of those would replay a stale position or a stale
  // session, and the deck would show numbers that are not true.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/media-stream') ||
    url.pathname.startsWith('/seek') ||
    url.pathname.startsWith('/ws/') ||
    e.request.method !== 'GET'
  ) {
    return;
  }

  // Network-first for the HTML shell: a cached index.html points at asset
  // hashes that a rebuild has replaced, so serving it first breaks the page.
  const isShell = url.pathname === '/' || url.pathname.endsWith('/') ||
    url.pathname === '/static/' || url.pathname.endsWith('.html');
  if (isShell) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((c) => c || Response.error()))
    );
    return;
  }

  // Cache-first for hashed build assets, which are immutable by construction.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok && url.pathname.startsWith('/static/')) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached || Response.error());
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
