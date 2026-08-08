const CACHE_NAME = 'insta-aio-v11';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './assets/icon.svg',
  './assets/icon-192.png', './assets/icon-512.png', './src/styles.css', './src/app-loader.js',
  './src/app.parts/part-01.jsfrag', './src/app.parts/part-02.jsfrag',
  './src/app.parts/part-03.jsfrag', './src/app.parts/part-04.jsfrag',
  './src/core/accounts.js', './src/core/snapshots.js', './src/core/queue.js',
  './src/core/action-jobs.js', './src/core/action-ledger.js',
  './src/core/dm-jobs.js', './src/core/dm-ledger.js',
  './src/core/bridge-protocol.js', './src/core/windowing.js',
  './src/core/messages.js', './src/core/imports.js', './src/core/storage.js',
  './src/core/import-classification.js', './src/core/zip.js',
  './src/adapters/legacy-components.js', './src/adapters/zip-import-worker-client.js',
  './src/adapters/reviewed-action-adapter.js', './src/adapters/indexeddb-action-ledger.js',
  './src/adapters/reviewed-dm-adapter.js', './src/adapters/indexeddb-dm-ledger.js',
  './src/adapters/instagram-dm-unsender.js',
  './src/adapters/extension-bridge-client.js',
  './src/workers/zip-import-worker.js',
  './src/migrations/migration-report.js', './src/migrations/instagram-helper.js',
  './src/migrations/simpleinstabot.js', './src/migrations/follower-checker.js',
  './src/migrations/instagram-dm-unsender.js',
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
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      const requestUrl = new URL(event.request.url);
      if (response.ok && requestUrl.origin === self.location.origin) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw error;
    }
  })());
});
