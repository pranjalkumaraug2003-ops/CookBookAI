// Offline support. After the first visit the app opens without a network: the app itself, its fonts and the
// on-device vision models are kept in the browser's cache. Recipe import and YouTube need the network and are
// never cached.
const VERSION = 'cookalong-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'recipe.js', 'store.js', 'library.js', 'parse-text.js', 'icons.js', 'video.js', 'voice.js', 'sensing.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/atkinson-hyperlegible-next-latin-400-normal.woff2', 'fonts/atkinson-hyperlegible-next-latin-500-normal.woff2',
  'fonts/atkinson-hyperlegible-next-latin-700-normal.woff2', 'fonts/atkinson-hyperlegible-next-latin-800-normal.woff2',
  'fonts/atkinson-hyperlegible-mono-latin-400-normal.woff2', 'fonts/atkinson-hyperlegible-mono-latin-700-normal.woff2',
];
// Version-pinned files from other hosts: safe to keep forever once fetched.
const PINNED = [/^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\//, /^https:\/\/storage\.googleapis\.com\/mediapipe-models\//];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/api/')) return; // imports always go to the network

  if (PINNED.some((re) => re.test(req.url))) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (url.origin === self.location.origin) {
    // Stale-while-revalidate: open instantly from the cache, fetch the newer file for next time.
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const res = await net;
      if (res) return res;
      if (req.mode === 'navigate') return (await c.match('index.html')) || Response.error();
      return Response.error();
    }));
  }
});
