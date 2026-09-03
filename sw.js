"use strict";

// Bump this whenever the precached shell files change, so old caches get thrown away.
var CACHE_NAME = "eyad-portfolio-v1";

var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/css/style.css",
  "./assets/js/main.js",
  "./assets/js/media-loader.js",
  "./assets/js/mini-game.js",
  "./assets/js/gallery-feed.js",
  "./assets/js/content-loader.js",
  "./data/about.json",
  "./data/experience.json",
  "./assets/images/icons/favicon.png",
  "./assets/images/icons/apple-touch-icon.png",
  "./assets/images/icons/icon-192.png",
  "./assets/images/icons/icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Cache each file individually so one missing/renamed asset
      // doesn't fail the whole install.
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () {});
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;

  // Only handle same-origin GET requests — leave cross-origin
  // (fonts, Instagram/Facebook CDN media, maps) to the network as usual.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // HTML navigations: try the network first so content stays fresh,
  // fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || caches.match("./index.html");
          });
        })
    );
    return;
  }

  // Everything else (CSS/JS/images/data): cache-first, refresh in the background.
  event.respondWith(
    caches.match(request).then(function (cached) {
      var networkFetch = fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
          }
          return response;
        })
        .catch(function () { return cached; });
      return cached || networkFetch;
    })
  );
});
