const CACHE_NAME = 'insta-aio-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './assets/icon.svg', './src/styles.css', './src/app-loader.js',
  './src/app.parts/part-01.jsfrag', './src/app.parts/part-02.jsfrag',
  './src/app.parts/part-03.jsfrag', './src/app.parts/part-04.jsfrag',
  './src/core/accounts.js', './src/core/snapshots.js', './src/core/queue.js',
  './src/core/messages.js', './src/core/imports.js', './src/core/storage.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
