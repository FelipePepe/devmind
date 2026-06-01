// DevMind service worker — network-first for API, cache-first for static assets.
const CACHE = 'devmind-v1';
const STATIC_EXTS = ['.js', '.css', '.woff2', '.woff', '.ttf'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(['/', '/projects'])
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API / auth / admin / ws — always network, never cache
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth') ||
      url.pathname.startsWith('/admin') || url.pathname.startsWith('/ws')) return;

  const isStatic = STATIC_EXTS.some((ext) => url.pathname.endsWith(ext));

  if (isStatic) {
    // Cache-first for versioned static assets
    e.respondWith(
      caches.match(request).then((cached) =>
        cached ?? fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
      )
    );
  } else {
    // Network-first for navigation (HTML shell)
    e.respondWith(
      fetch(request).catch(() => caches.match(request).then((r) => r ?? caches.match('/')))
    );
  }
});
