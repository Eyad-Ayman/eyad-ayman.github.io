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
            videoUrl: post.isVideo ? (post.videoUrl || null) : null,
            url: post.permalink,
            caption: post.caption || "@eyadayman__ on Instagram",
          });
        });
      }

      if (items.length === 0) return; // keep the static Behance-only fallback

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
          return (
            '<a href="' + item.url + '" target="_blank" rel="noopener" title="' + title + ' — View on ' + badge + '" class="project-tile gallery-tile gallery-tile-' + item.type + '">' +
              '<div class="project-photo">' + media + "</div>" +
              '<div class="project-caption"><span class="project-name">' + title + '</span><span class="project-index">[' + item.type + " · " + index + ']</span></div>' +
            "</a>"
          );
        })
        .join("");

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
