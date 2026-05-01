const CACHE_NAME = "sos-offline-v5";
const TILE_CACHE  = "sos-tiles-v1";

// Core app files — pre-cached on install
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./facilities.json",
  "./manifest.json",
  // Leaflet library (cached for offline)
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

// Install: pre-cache all critical assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pre-caching app assets");
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches (but keep tile cache)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ── Map tiles: cache-on-use, survive app updates ───────────────────────
  // OpenStreetMap tile URLs look like: https://tile.openstreetmap.org/{z}/{x}/{y}.png
  if (url.hostname.includes("tile.openstreetmap.org") ||
      url.hostname.includes("tiles.openstreetmap.org")) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          const response = await fetch(event.request);
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch {
          // Return a transparent 1x1 PNG as fallback for missing tiles
          return new Response(
            Uint8Array.from(atob(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB" +
              "Nl7BcQAAAABJRU5ErkJggg=="
            ), c => c.charCodeAt(0)),
            { headers: { "Content-Type": "image/png" } }
          );
        }
      })
    );
    return;
  }

  // ── Same-origin: cache-first ───────────────────────────────────────────
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // ── External (fonts, Leaflet CDN): cache-first, network fallback ──────
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Silently fail for non-critical external resources
        return new Response("", { status: 503 });
      });
    })
  );
});
