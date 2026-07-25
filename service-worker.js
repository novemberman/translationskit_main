const CACHE_NAME = "interlingo-shell-v7";

// Only the app shell — never cache stream media or signaling traffic.
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/auth.js",
  "./js/config.js",
  "./js/mixer.js",
  "./js/network.js",
  "./js/source.js",
  "./js/streaming.js",
  "./js/streamLock.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests for the app shell. Everything
  // else (AMS websocket/HTTP, auth API, CDN module, REST lock checks)
  // passes straight through to the network untouched.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Network-first: always try to get the latest version. Only fall back
  // to the cached copy if the network request fails (e.g. offline). This
  // trades a little offline freshness for never silently serving stale
  // app code — worth it while this app is still under active development.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
