/* EYAD STUDIO — service worker (scope: /studio/ only).
 * Makes the Studio installable and usable offline. It never touches the
 * portfolio: its scope is /studio/, its cache name is Studio-specific, and it
 * only deletes caches that start with "eyad-studio-".
 * Strategy: navigations = network first (fresh HTML), falling back to the
 * cached shell offline; static files = cache first, refreshed in the background.
 */
"use strict";
<<<<<<< HEAD
var VERSION = "de18a702cf";
var CACHE = "eyad-studio-" + VERSION;
var SHELL = [
"./3d/",
"./3d/index.html",
"./camera/",
"./camera/index.html",
"./css/3d.css",
"./css/camera.css",
"./css/fonts-extra.css",
"./css/generate.css",
"./css/hub.css",
"./css/image.css",
"./css/studio.css",
"./css/templates.css",
"./css/vector.css",
"./css/video.css",
"./fonts/archivo-black-latin-400-normal.woff2",
"./fonts/bebas-neue-latin-400-normal.woff2",
"./fonts/cairo-arabic-400-normal.woff2",
"./fonts/cairo-arabic-700-normal.woff2",
"./fonts/cairo-arabic-900-normal.woff2",
"./fonts/cairo-latin-400-normal.woff2",
"./fonts/cairo-latin-700-normal.woff2",
"./fonts/cairo-latin-900-normal.woff2",
"./fonts/caveat-latin-600-normal.woff2",
"./fonts/dm-serif-display-latin-400-italic.woff2",
"./fonts/dm-serif-display-latin-400-normal.woff2",
"./fonts/great-vibes-latin-400-normal.woff2",
=======
var VERSION = "c038819397";
var CACHE = "eyad-studio-" + VERSION;
var SHELL = [
"./css/hub.css",
"./css/image.css",
"./css/studio.css",
"./css/vector.css",
"./css/video.css",
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
"./fonts/inter-latin-400-normal.woff2",
"./fonts/inter-latin-500-normal.woff2",
"./fonts/inter-latin-600-normal.woff2",
"./fonts/inter-latin-700-normal.woff2",
"./fonts/jetbrains-mono-latin-400-normal.woff2",
<<<<<<< HEAD
"./fonts/montserrat-latin-400-normal.woff2",
"./fonts/montserrat-latin-600-normal.woff2",
"./fonts/montserrat-latin-800-normal.woff2",
"./fonts/oswald-latin-500-normal.woff2",
"./fonts/oswald-latin-600-normal.woff2",
"./fonts/oswald-latin-700-normal.woff2",
"./fonts/playfair-display-latin-400-italic.woff2",
"./fonts/playfair-display-latin-400-normal.woff2",
"./fonts/playfair-display-latin-700-normal.woff2",
"./fonts/playfair-display-latin-900-normal.woff2",
"./fonts/poppins-latin-400-normal.woff2",
"./fonts/poppins-latin-600-normal.woff2",
"./fonts/poppins-latin-800-normal.woff2",
"./fonts/space-grotesk-latin-400-normal.woff2",
"./fonts/space-grotesk-latin-700-normal.woff2",
"./help/",
"./help/index.html",
"./icons/app-3d.png",
"./icons/app-camera.png",
"./icons/app-image.png",
"./icons/app-projects.png",
"./icons/app-templates.png",
"./icons/app-vector.png",
"./icons/app-video.png",
=======
"./fonts/oswald-latin-500-normal.woff2",
"./fonts/oswald-latin-600-normal.woff2",
"./fonts/oswald-latin-700-normal.woff2",
"./help/",
"./help/index.html",
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
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
<<<<<<< HEAD
"./js/3d/anim.js",
"./js/3d/app.js",
"./js/3d/editor-flag.js",
"./js/3d/icons.js",
"./js/3d/io.js",
"./js/3d/main.js",
"./js/3d/objects.js",
"./js/3d/panels.js",
"./js/3d/timeline.js",
"./js/3d/viewport.js",
"./js/3d/webm.js",
"./js/camera/main.js",
"./js/core/ai.js",
"./js/core/appicons.js",
"./js/core/db.js",
"./js/core/docs.js",
"./js/core/dom.js",
"./js/core/experience.js",
"./js/core/eyad.js",
"./js/core/files.js",
"./js/core/film-looks.js",
"./js/core/film.js",
"./js/core/genai.js",
"./js/core/glutil.js",
"./js/core/history.js",
"./js/core/icons.js",
"./js/core/inpaint.js",
"./js/core/lut.js",
=======
"./js/core/ai.js",
"./js/core/db.js",
"./js/core/docs.js",
"./js/core/dom.js",
"./js/core/eyad.js",
"./js/core/files.js",
"./js/core/history.js",
"./js/core/icons.js",
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
"./js/core/open.js",
"./js/core/settings.js",
"./js/core/shell.js",
"./js/core/ui.js",
"./js/core/zip.js",
"./js/file-notice.js",
"./js/image/ai.js",
"./js/image/app.js",
<<<<<<< HEAD
"./js/image/artboards.js",
"./js/image/doc.js",
"./js/image/filmlab.js",
"./js/image/filters.js",
"./js/image/generate.js",
=======
"./js/image/doc.js",
"./js/image/filters.js",
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
"./js/image/history.js",
"./js/image/io.js",
"./js/image/main.js",
"./js/image/menus.js",
"./js/image/ops.js",
"./js/image/panels.js",
"./js/image/pro.js",
"./js/image/psd.js",
"./js/image/render.js",
"./js/image/selection.js",
"./js/image/tools.js",
"./js/image/tools2.js",
"./js/image/view.js",
"./js/pages/common.js",
"./js/pages/help.js",
"./js/pages/home.js",
"./js/pages/projects.js",
"./js/pages/settings.js",
<<<<<<< HEAD
"./js/templates/data.js",
"./js/templates/fonts.js",
"./js/templates/kit.js",
"./js/templates/main.js",
"./js/vector/app.js",
"./js/vector/commands.js",
"./js/vector/import-fig.js",
"./js/vector/import-pdf.js",
=======
"./js/vector/app.js",
"./js/vector/commands.js",
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
"./js/vector/io.js",
"./js/vector/main.js",
"./js/vector/menus.js",
"./js/vector/model.js",
"./js/vector/panels.js",
"./js/vector/pathops.js",
"./js/vector/tools.js",
"./js/video/anim.js",
"./js/video/app.js",
"./js/video/captions.js",
<<<<<<< HEAD
"./js/video/collect.js",
=======
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
"./js/video/effects.js",
"./js/video/engine.js",
"./js/video/export.js",
"./js/video/gen.js",
"./js/video/gl.js",
"./js/video/io.js",
"./js/video/link.js",
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
<<<<<<< HEAD
"./models/selfie_segmenter.tflite",
=======
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
"./projects/",
"./projects/index.html",
"./settings/",
"./settings/index.html",
<<<<<<< HEAD
"./templates/",
"./templates/index.html",
"./vector/",
"./vector/index.html",
"./vendor/ag-psd.min.js",
"./vendor/fflate/LICENSE",
"./vendor/fflate/fflate.js",
=======
"./vector/",
"./vector/index.html",
"./vendor/ag-psd.min.js",
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
"./vendor/paper/paper-core.min.js",
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
<<<<<<< HEAD
    return Promise.all(names.filter(function (n) { return n.indexOf("eyad-studio-") === 0 && n !== CACHE && n.indexOf("eyad-studio-ai-") !== 0 && n.indexOf("eyad-studio-offline-") !== 0; }).map(function (n) { return caches.delete(n); }));
=======
    return Promise.all(names.filter(function (n) { return n.indexOf("eyad-studio-") === 0 && n !== CACHE; }).map(function (n) { return caches.delete(n); }));
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  }).then(function () { return self.clients.claim(); }));
});

// The portfolio's own worker may clear caches it doesn't know when it updates;
// Studio pages ask us to re-check our cache on load.
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "ensure-cache") {
    event.waitUntil(caches.has(CACHE).then(function (ok) { return ok ? caches.open(CACHE).then(function (c) { return c.keys().then(function (k) { return k.length < SHELL.length / 2 ? precache() : null; }); }) : precache(); }));
  }
});

// Android "Share → EYAD STUDIO": the shared files arrive as a POST; keep them
// in the same IndexedDB hand-off store the pages use, then open the Studio.
function shareTarget(event) {
  event.respondWith((async function () {
    var id = "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      var form = await event.request.formData();
      var files = form.getAll("files").filter(function (f) { return f && typeof f === "object" && "size" in f; });
      var db = await new Promise(function (res, rej) { var r = indexedDB.open("eyad-studio"); r.onupgradeneeded = function () { r.transaction.abort(); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; });
      await new Promise(function (res, rej) {
        var tx = db.transaction("handoff", "readwrite");
        tx.objectStore("handoff").put({ id: id, files: files, created: Date.now() });
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    } catch (e) { id = ""; }
    return Response.redirect(new URL(id ? "./?handoff=" + id : "./", self.registration.scope).href, 303);
  })());
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method === "POST" && new URL(req.url).pathname === new URL("./share-target/", self.registration.scope).pathname) { shareTarget(event); return; }
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
