// Renders one mixed "Gallery of Work" grid combining your real Behance
// projects (data/behance.json) and your real Instagram posts
// (data/instagram.json) as a single interleaved set of tiles. The
// static markup in index.html is a same-page fallback (Behance only)
// in case this fetch fails, so this only needs to run once new data
// is added on either side.
//
// Behance stays in sync automatically via .github/workflows/behance-sync.yml.
// Instagram needs data/instagram.json populated — see INSTAGRAM_SETUP.md —
// until then this just shows Behance alone, same as before.

(function () {
  "use strict";

  var grid = document.querySelector("[data-mixed-gallery]");
  if (!grid) return;

  function safeFetch(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  Promise.all([safeFetch("./data/behance.json"), safeFetch("./data/instagram.json")]).then(
    function (results) {
      var behance = results[0];
      var instagram = results[1];

      var items = [];

      if (behance && Array.isArray(behance.projects)) {
        behance.projects.forEach(function (p) {
          items.push({
            type: "behance",
            image: "./assets/images/behance/" + p.file,
            url: p.url,
            caption: p.title || "Untitled project",
          });
        });
      }

      if (instagram && Array.isArray(instagram.posts) && instagram.posts.length > 0) {
        instagram.posts.forEach(function (post) {
          items.push({
            type: "instagram",
            image: post.image,
            isVideo: !!post.isVideo,
            videoUrl: post.isVideo ? (post.videoUrl || null) : null,
            url: post.permalink,
            caption: post.caption || "@eyadayman__ on Instagram",
          });
        });
      }

      if (items.length === 0) {
        // Keep the static Behance-only fallback markup as-is, but still
        // reveal its tiles — they never get touched by the code below.
        grid.querySelectorAll(".project-tile").forEach(function (t) {
          t.classList.add("tile-visible");
        });
        return;
      }

      // Interleave Instagram posts evenly through the Behance projects
      // instead of just concatenating, so it reads as one mixed set
      // rather than "Behance, then Instagram stapled on the end".
      var behanceItems = items.filter(function (i) { return i.type === "behance"; });
      var instaItems = items.filter(function (i) { return i.type === "instagram"; });
      var mixed = [];
      var ratio = instaItems.length > 0 ? Math.ceil(behanceItems.length / instaItems.length) : Infinity;
      var bi = 0, ii = 0;
      while (bi < behanceItems.length || ii < instaItems.length) {
        for (var k = 0; k < ratio && bi < behanceItems.length; k++) {
          mixed.push(behanceItems[bi++]);
        }
        if (ii < instaItems.length) mixed.push(instaItems[ii++]);
      }

      grid.innerHTML = mixed
        .map(function (item, i) {
          var index = String(i + 1).padStart(2, "0");
          var title = item.caption.replace(/"/g, "&quot;");
          var badge = item.type === "instagram" ? "Instagram" : "Behance";
          // Real Instagram Reels play automatically right in the grid
          // (muted + loop, same as Instagram/TikTok grid previews — browsers
          // require muted for unattended autoplay) instead of sitting as a
          // static thumbnail. Behance covers stay images since the profile
          // scrape only ever gives a cover photo, never the video file.
          //
          // Some Instagram videos come back from the API with no direct
          // media_url at all (an Instagram-side inconsistency, not
          // something we can request around) — Instagram's own embed for
          // those requires a click and drags in its own branded UI, which
          // doesn't belong on this site, so those just stay a thumbnail.
          var media = item.videoUrl
            ? '<video src="' + item.videoUrl + '" poster="' + item.image + '" muted loop playsinline preload="metadata" data-autoplay-video></video>'
            : '<img src="' + item.image + '" loading="lazy" alt="' + title + '">';
          // Small play-icon badge marks every video post as a video —
          // both the ones playing live and the ones stuck as a thumbnail
          // (no direct file from Instagram to actually play) — same
          // convention Instagram's own grid uses. Not a fake "click to
          // play" control, just a label.
          var playBadge = item.isVideo
            ? '<span class="project-play-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>'
            : "";
          return (
            '<a href="' + item.url + '" target="_blank" rel="noopener" title="' + title + ' — View on ' + badge + '" class="project-tile gallery-tile gallery-tile-' + item.type + '">' +
              '<div class="project-photo">' + media + playBadge + "</div>" +
              '<div class="project-caption"><span class="project-name">' + title + '</span><span class="project-index">[' + item.type + " · " + index + ']</span></div>' +
            "</a>"
          );
        })
        .join("");

      // Tiles cascade in one at a time as they scroll into view, instead
      // of the whole grid fading in as one flat block — a staggered delay
      // based on each tile's position in the grid, capped so a big batch
      // scrolling in at once doesn't take forever to finish revealing.
      var tiles = grid.querySelectorAll(".project-tile");
      if (tiles.length && "IntersectionObserver" in window) {
        var revealObserver = new IntersectionObserver(
          function (entries, observer) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              var i = Array.prototype.indexOf.call(tiles, entry.target);
              var delay = Math.min(i % 6, 5) * 70;
              entry.target.style.transitionDelay = delay + "ms";
              entry.target.classList.add("tile-visible");
              observer.unobserve(entry.target);
            });
          },
          { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
        );
        tiles.forEach(function (t) { revealObserver.observe(t); });
      } else {
        tiles.forEach(function (t) { t.classList.add("tile-visible"); });
      }

      // Auto-play every Reel once it scrolls into view instead of all of
      // them at once on page load — same result (no hover/click needed),
      // far less bandwidth/CPU if there end up being a lot of them.
      var videos = grid.querySelectorAll("[data-autoplay-video]");
      if (videos.length && "IntersectionObserver" in window) {
        var playObserver = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) {
                entry.target.play().catch(function () {});
              } else {
                entry.target.pause();
              }
            });
          },
          { threshold: 0.35 }
        );
        videos.forEach(function (v) { playObserver.observe(v); });
      } else {
        videos.forEach(function (v) { v.play().catch(function () {}); });
      }

      // Moving the mouse off a tile stops that video immediately, on top
      // of the scroll-based autoplay above.
      videos.forEach(function (v) {
        v.addEventListener("mouseleave", function () { v.pause(); });
        v.addEventListener("mouseenter", function () {
          var r = v.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) v.play().catch(function () {});
        });
      });
    }
  );
})();
