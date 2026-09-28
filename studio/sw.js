/* EYAD STUDIO — service worker (scope: /studio/ only).
 * Makes the Studio installable and usable offline. It never touches the
 * portfolio: its scope is /studio/, its cache name is Studio-specific, and it
 * only deletes caches that start with "eyad-studio-".
 * Strategy: navigations = network first (fresh HTML), falling back to the
 * cached shell offline; static files = cache first, refreshed in the background.
 */
"use strict";
var VERSION = "1d9a1910be";
var CACHE = "eyad-studio-" + VERSION;
var SHELL = [
"./css/hub.css",
"./css/image.css",
"./css/studio.css",
"./css/video.css",
"./fonts/inter-latin-400-normal.woff2",
"./fonts/inter-latin-500-normal.woff2",
"./fonts/inter-latin-600-normal.woff2",
"./fonts/inter-latin-700-normal.woff2",
"./fonts/jetbrains-mono-latin-400-normal.woff2",
"./fonts/oswald-latin-500-normal.woff2",
"./fonts/oswald-latin-600-normal.woff2",
"./fonts/oswald-latin-700-normal.woff2",
"./help/",
"./help/index.html",
"./icons/apple-touch-icon.png",
"./icons/icon-192.png",
"./icons/icon-512.png",
"./icons/maskable-512.png",
"./icons/shortcut-image.png",
"./image/",
"./image/index.html",
"./img/grain-dark.png",
"./img/grain-light.png",
"./",
"./index.html",
"./js/core/db.js",
"./js/core/docs.js",
"./js/core/dom.js",
"./js/core/eyad.js",
"./js/core/files.js",
"./js/core/history.js",
"./js/core/icons.js",
"./js/core/settings.js",
"./js/core/shell.js",
"./js/core/ui.js",
"./js/core/zip.js",
"./js/file-notice.js",
"./js/image/app.js",
"./js/image/doc.js",
"./js/image/filters.js",
"./js/image/history.js",
"./js/image/io.js",
"./js/image/main.js",
"./js/image/menus.js",
"./js/image/ops.js",
"./js/image/panels.js",
"./js/image/psd.js",
"./js/image/render.js",
"./js/image/selection.js",
"./js/image/tools.js",
"./js/image/view.js",
"./js/pages/common.js",
"./js/pages/help.js",
"./js/pages/home.js",
"./js/pages/projects.js",
"./js/pages/settings.js",
"./js/video/app.js",
"./js/video/effects.js",
"./js/video/engine.js",
"./js/video/export.js",
"./js/video/io.js",
"./js/video/main.js",
"./js/video/media.js",
"./js/video/menus.js",
"./js/video/model.js",
"./js/video/ops.js",
"./js/video/panels.js",
"./js/video/prproj.js",
"./js/video/timeline.js",
"./js/workers/filters.worker.js",
"./js/workers/peaks.worker.js",
"./js/workers/psd.worker.js",
"./manifest.webmanifest",
"./projects/",
"./projects/index.html",
"./settings/",
"./settings/index.html",
"./vendor/ag-psd.min.js",
"./video/",
"./video/index.html"
];

function precache() {
  return caches.open(CACHE).then(function (cache) {
    return Promise.all(SHELL.map(function (u) { return cache.add(new Request(u, { cache: "reload" })).catch(function () {}); }));
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) { return n.indexOf("eyad-studio-") === 0 && n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

// The portfolio's own worker may clear caches it doesn't know when it updates;
// Studio pages ask us to re-check our cache on load.
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "ensure-cache") {
    event.waitUntil(caches.has(CACHE).then(function (ok) { return ok ? caches.open(CACHE).then(function (c) { return c.keys().then(function (k) { return k.length < SHELL.length / 2 ? precache() : null; }); }) : precache(); }));
  }
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var scope = new URL(self.registration.scope);
  if (url.pathname.indexOf(scope.pathname) !== 0) return; // only Studio files
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match(new URL("./", scope).href);
      });
    }));
    return;
  }
  event.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok && res.type === "basic") { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
