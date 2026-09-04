// sw.js - Service Worker per al Taller de Ceramica (Suport Offline i PWA)
const CACHE_NAME = "taller-ceramica-v3.4";
const ASSETS_TO_CACHE = [
  "./",
  "./alumne.html",
  "./scanner.html",
  "./manifest.json",
  "./css/styles.css",
  "./css/card.css",
  "./lib/qrcode.min.js",
  "./lib/html5-qrcode.min.js",
  "./js/time-utils.js",
  "./js/sound.js",
  "./js/qr-engine.js",
  "./js/store.js",
  "./js/alumne.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn("Alguns fitxers no shan pogut guardar a la cache inicial:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Estrategia: Network first, fallback to cache (per tenir sempre les dades fresques pero funcionar offline)
self.addEventListener("fetch", (event) => {
  // No interceptar peticions de l-API ni d-altres dominis (com Google Sheets o Stripe)
  if (event.request.url.includes("/api/") || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.headers.get("accept") && event.request.headers.get("accept").includes("text/html")) {
            return caches.match("./alumne.html");
          }
        });
      })
  );
});