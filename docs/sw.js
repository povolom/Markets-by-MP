// Markets by MP service worker: keeps the app's own files so it opens offline.
// It never caches price data or API calls; those always go to the network.
const CACHE = 'markets-shell-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'calc.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // Delete old versions of this app's cache only (names starting with "markets-").
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('markets-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // prices and APIs: straight to the network
  // App files: try the network first so updates show up, fall back to the saved copy offline.
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
