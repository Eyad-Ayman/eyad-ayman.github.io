// Populates the horizontal "Showreel" film-strip from real Instagram video
// posts (data/instagram.json) — the same auto-synced source gallery-feed.js
// already uses. Only posts with a direct, playable video file qualify (some
// Instagram video posts come back from the API with no direct media_url —
// see gallery-feed.js for why); the strip stays hidden if there aren't any
// yet, since the full-bleed video above it already carries the section on
// its own, and grows on its own as more Reels get posted.

(function () {
  "use strict";

  var wrap = document.querySelector("[data-showreel-wrap]");
  var strip = document.querySelector("[data-showreel-strip]");
  if (!wrap || !strip) return;

  var escapeEl = document.createElement("div");
  function escapeHtml(str) {
    escapeEl.textContent = str == null ? "" : String(str);
    return escapeEl.innerHTML;
  }
  function safeUrl(str) {
    var s = str == null ? "" : String(str);
    if (/^(https?:)?\/\//i.test(s) || s.indexOf("./") === 0 || s.indexOf("/") === 0) {
      return escapeHtml(s);
    }
    return "";
  }

  fetch("./data/instagram.json", { cache: "no-store" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      var posts = data && Array.isArray(data.posts) ? data.posts : [];
      var reels = posts.filter(function (p) { return p.isVideo && p.videoUrl; });
      if (reels.length === 0) return;

      strip.innerHTML = reels
        .map(function (post, i) {
          var num = String(i + 1).padStart(2, "0");
          var title = escapeHtml(post.caption || "@eyadayman__ on Instagram");
          var vidUrl = safeUrl(post.videoUrl);
          var imgUrl = safeUrl(post.image);
          var linkUrl = safeUrl(post.permalink);
          return (
            '<a href="' + linkUrl + '" target="_blank" rel="noopener noreferrer" class="showreel-card" title="' + title + ' — View on Instagram">' +
              '<video src="' + vidUrl + '" poster="' + imgUrl + '" muted loop playsinline preload="metadata" data-showreel-video></video>' +
              '<span class="showreel-reel-number">Reel ' + num + "</span>" +
              '<span class="showreel-caption">' + title + "</span>" +
            "</a>"
          );
        })
        .join("");

      wrap.classList.add("has-reels");

      // Same autoplay-in-view / pause-off-screen behavior as the main
      // gallery grid, kept independent since this strip scrolls
      // horizontally on its own axis rather than with the page.
      var videos = strip.querySelectorAll("[data-showreel-video]");
      if (videos.length && "IntersectionObserver" in window) {
        var playObserver = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) entry.target.play().catch(function () {});
              else entry.target.pause();
            });
          },
          { threshold: 0.35 }
        );
        videos.forEach(function (v) { playObserver.observe(v); });
      } else {
        videos.forEach(function (v) { v.play().catch(function () {}); });
      }
    })
    .catch(function () {});
})();
