const CACHE_NAME = 'assistant-v1';
const urlsToCache = ['./index.html', './app.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('api.anthropic.com') || event.request.url.includes('open-meteo.com')) {
    return; // не кэшируем сетевые запросы к API
  }
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
