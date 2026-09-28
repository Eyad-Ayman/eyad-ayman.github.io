// Showreel — the Reels row under the full-bleed video in the Motion section.
// Built from the same auto-synced Instagram data the gallery uses
// (data/instagram.json, or the data/gallery-snapshot.js copy when the page
// is opened from disk). Every video post is shown: ones with a playable file
// autoplay (muted) in view, ones Instagram gave no file for show their cover
// with a play badge. If a video link has expired (Instagram CDN links do),
// the card quietly falls back to its cover image instead of a black box.

(function () {
  "use strict";

  var wrap = document.querySelector("[data-showreel-wrap]");
  var strip = document.querySelector("[data-showreel-strip]");
  if (!wrap || !strip) return;

  var PROFILE = "https://www.instagram.com/eyadayman__";

  var escapeEl = document.createElement("div");
  function escapeHtml(str) {
    escapeEl.textContent = str == null ? "" : String(str);
    return escapeEl.innerHTML;
  }
  function safeUrl(str) {
    var s = str == null ? "" : String(str);
    if (/^(https?:)?\/\//i.test(s) || s.indexOf("./") === 0 || s.indexOf("/") === 0) return escapeHtml(s);
    return "";
  }

  function load() {
    return fetch("./data/instagram.json", { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        if (data) return data;
        var snap = window.__EYAD_GALLERY_SNAPSHOT__;
        return snap && snap.instagram ? snap.instagram : null;
      });
  }

  load().then(function (data) {
    var posts = data && Array.isArray(data.posts) ? data.posts : [];
    var reels = posts.filter(function (p) { return p.isVideo; });
    if (reels.length === 0) return;

    var playIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

    var cards = reels.map(function (post, i) {
      var num = String(i + 1).padStart(2, "0");
      var title = escapeHtml(post.caption || "@eyadayman__ on Instagram");
      var vidUrl = post.videoUrl ? safeUrl(post.videoUrl) : "";
      var imgUrl = safeUrl(post.image);
      var linkUrl = safeUrl(post.permalink) || PROFILE;
      var media = vidUrl
        ? '<video src="' + vidUrl + '" poster="' + imgUrl + '" muted loop playsinline preload="metadata" data-showreel-video></video>'
        : "";
      return (
        '<a href="' + linkUrl + '" target="_blank" rel="noopener noreferrer" class="showreel-card' + (vidUrl ? "" : " is-still") + '" title="' + title + ' — Watch on Instagram">' +
          '<img class="showreel-poster" src="' + imgUrl + '" alt="" loading="lazy" decoding="async">' +
          media +
          '<span class="showreel-reel-number">Reel ' + num + "</span>" +
          '<span class="showreel-play">' + playIcon + "</span>" +
          '<span class="showreel-caption">' + title + "</span>" +
        "</a>"
      );
    });
    cards.push(
      '<a href="' + PROFILE + '" target="_blank" rel="noopener noreferrer" class="showreel-card showreel-more">' +
        '<span class="showreel-more-label">More reels</span>' +
        '<span class="showreel-more-handle">@eyadayman__ &rarr;</span>' +
      "</a>"
    );
    strip.innerHTML = cards.join("");

    var count = wrap.querySelector("[data-showreel-count]");
    if (count) count.textContent = String(reels.length).padStart(2, "0") + (reels.length === 1 ? " reel" : " reels");
    wrap.classList.add("has-reels");

    // Size each card to its post's real proportions (posts aren't all 9:16)
    // from the cover image, so nothing gets cropped and there's no jump when
    // the video's own metadata arrives.
    strip.querySelectorAll(".showreel-card").forEach(function (card) {
      var img = card.querySelector(".showreel-poster");
      if (!img) return;
      function fit() {
        if (img.naturalWidth && img.naturalHeight) card.style.aspectRatio = img.naturalWidth + " / " + img.naturalHeight;
      }
      if (img.complete) fit(); else img.addEventListener("load", fit);
      img.addEventListener("error", function () { card.classList.add("no-poster"); });
    });

    var videos = Array.prototype.slice.call(strip.querySelectorAll("[data-showreel-video]"));
    videos.forEach(function (v) {
      var card = v.closest(".showreel-card");
      // Expired / blocked Instagram link → keep the cover, drop the dead video.
      v.addEventListener("error", function () { card.classList.add("is-still"); v.remove(); });
      v.addEventListener("playing", function () { card.classList.add("is-playing"); });
      v.addEventListener("pause", function () { card.classList.remove("is-playing"); });
    });

    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function tryPlay(v) { if (v.isConnected) v.play().catch(function () {}); }
    if (!reduceMotion && videos.length && "IntersectionObserver" in window) {
      var playObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) tryPlay(entry.target); else entry.target.pause();
        });
      }, { threshold: 0.35 });
      videos.forEach(function (v) { playObserver.observe(v); });
    } else if (reduceMotion) {
      // Reduced motion: nothing moves on its own; hovering a card plays it.
      videos.forEach(function (v) {
        var card = v.closest(".showreel-card");
        card.addEventListener("mouseenter", function () { tryPlay(v); });
        card.addEventListener("mouseleave", function () { v.pause(); });
      });
    } else {
      videos.forEach(tryPlay);
    }

    // Prev / next arrows — only shown when the row actually overflows.
    var prev = wrap.querySelector("[data-showreel-prev]");
    var next = wrap.querySelector("[data-showreel-next]");
    function updateNav() {
      var max = strip.scrollWidth - strip.clientWidth;
      var overflow = max > 4;
      wrap.classList.toggle("is-scrollable", overflow);
      if (prev) prev.disabled = !overflow || strip.scrollLeft <= 4;
      if (next) next.disabled = !overflow || strip.scrollLeft >= max - 4;
    }
    function step(dir) { strip.scrollBy({ left: dir * Math.max(240, strip.clientWidth * 0.8), behavior: reduceMotion ? "auto" : "smooth" }); }
    if (prev) prev.addEventListener("click", function () { step(-1); });
    if (next) next.addEventListener("click", function () { step(1); });
    strip.addEventListener("scroll", updateNav, { passive: true });
    window.addEventListener("resize", updateNav);
    strip.querySelectorAll("img").forEach(function (img) { img.addEventListener("load", updateNav); });
    updateNav();
  });
})();
