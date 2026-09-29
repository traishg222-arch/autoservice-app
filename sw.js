// Service worker: сеть в приоритете (данные всегда свежие), кэш — на случай отсутствия связи.
const CACHE = 'shell-v1';
const SHELL = [
  '/', '/admin', '/css/app.css', '/css/admin.css', '/theme.css', '/manifest.webmanifest',
  '/js/api.js', '/js/ui.js', '/js/client.js', '/js/admin.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: request.destination === 'image' });
        if (cached) return cached;
        if (request.mode === 'navigate') return (await caches.match(url.pathname === '/admin' ? '/admin' : '/')) || Response.error();
        return Response.error();
      }),
  );
});
