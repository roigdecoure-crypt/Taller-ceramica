/**
 * sw.js - Service Worker per a funcionament offline i PWA al mòbil Android
 */

const CACHE_NAME = 'ceramica-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './admin.html',
  './scanner.html',
  './alumne.html',
  './manifest.json',
  './css/styles.css',
  './css/admin.css',
  './css/card.css',
  './css/scanner.css',
  './js/time-utils.js',
  './js/sound.js',
  './js/qr-engine.js',
  './js/store.js',
  './js/admin.js',
  './js/scanner.js',
  './js/alumne.js',
  './lib/qrcode.min.js',
  './lib/html5-qrcode.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Avís guardant en cache alguns recursos:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Ignorar peticions a l'API per assegurar dades fresques
  if (e.request.url.includes('/api/')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).catch(() => cached);
    })
  );
});
