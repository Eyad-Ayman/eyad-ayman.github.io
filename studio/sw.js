// Retired. A previous service worker cached this site's pages; this
// replacement clears every cache it left, unregisters itself, and reloads
// open tabs so they fetch the live site. Nothing registers it anymore.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    await self.registration.unregister();
    var clients = await self.clients.matchAll({ type: "window" });
    clients.forEach(function (c) { c.navigate(c.url); });
  })());
});
