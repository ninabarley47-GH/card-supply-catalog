importScripts("./sw-build.js");

const CACHE_NAME = `card-supply-catalog-${self.CSC_BUILD || "local"}`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./version.json",
  "./sw-build.js",
  "./css/styles.css",
  "./css/cards.css",
  "./js/app.js",
  "./js/add-dsp.js",
  "./js/backup.js",
  "./js/card-images.js",
  "./js/cards.js",
  "./js/color-form.js",
  "./js/cover-sheet.js",
  "./js/images.js",
  "./js/library.js",
  "./js/pwa.js",
  "./js/schema.js",
  "./js/settings.js",
  "./js/storage.js",
  "./js/thumbnails.js",
  "./js/version.js",
  "./data/colors.json",
  "./data/paper-packs.json",
  "./assets/logo/CSC-logo-150px.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  const isHttpRequest = requestUrl.protocol === "http:" || requestUrl.protocol === "https:";
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (event.request.method !== "GET" || !isHttpRequest || !isSameOrigin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseCopy = response.clone();

        return caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(event.request, responseCopy))
          .catch((error) => {
            console.warn("The response could not be cached.", error);
          })
          .then(() => response);
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "catalog:activate-update") {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === "catalog:get-service-worker-version") {
    event.ports?.[0]?.postMessage({ version: CACHE_NAME });
  }
});
