// Applies data/media.json onto every element carrying a matching
// data-media-key / data-media-poster-key attribute. The HTML already has
// working defaults baked in as src/poster, so if this fetch fails (offline
// file:// preview, etc.) the page still looks correct — this only
// overrides those defaults when the JSON loads successfully.
(function () {
  "use strict";

  fetch("./data/media.json")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (media) {
      if (!media) return;

      document.querySelectorAll("[data-media-key]").forEach(function (el) {
        var key = el.getAttribute("data-media-key");
        if (!Object.prototype.hasOwnProperty.call(media, key)) return;
        var value = media[key];
        if (el.tagName === "SOURCE" || el.tagName === "IMG") {
          el.src = value;
          if (el.tagName === "SOURCE") {
            var video = el.closest("video");
            if (video) video.load();
          }
        }
      });

      document.querySelectorAll("[data-media-poster-key]").forEach(function (el) {
        var key = el.getAttribute("data-media-poster-key");
        if (Object.prototype.hasOwnProperty.call(media, key)) {
          el.setAttribute("poster", media[key]);
        }
      });
    })
    .catch(function () {
      // No JSON available — the baked-in defaults already cover this.
    });
})();
