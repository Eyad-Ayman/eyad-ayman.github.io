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

      // Gallery is scoped to banners and video work only. Behance has no
      // project-type field to filter on (the profile scrape only gives
      // title/url/image), so this matches on the title text itself —
      // Instagram posts carry a real isVideo flag instead, so that's used
      // directly rather than guessing from the caption.
      var BANNER_VIDEO_RE = /banner|video|motion/i;

      if (behance && Array.isArray(behance.projects)) {
        behance.projects
          .filter(function (p) { return BANNER_VIDEO_RE.test(p.title || ""); })
          .forEach(function (p) {
            items.push({
              type: "behance",
              image: "./assets/images/behance/" + p.file,
              url: p.url,
              caption: p.title || "Untitled project",
            });
          });
      }

      if (instagram && Array.isArray(instagram.posts) && instagram.posts.length > 0) {
        instagram.posts
          .filter(function (post) { return post.isVideo; })
          .forEach(function (post) {
            items.push({
              type: "instagram",
              image: post.image,
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
          return (
            '<a href="' + item.url + '" target="_blank" rel="noopener" title="' + title + ' — View on ' + badge + '" class="project-tile gallery-tile gallery-tile-' + item.type + '">' +
              '<div class="project-photo"><img src="' + item.image + '" loading="lazy" alt="' + title + '"></div>' +
              '<div class="project-caption"><span class="project-name">' + title + '</span><span class="project-index">[' + item.type + " · " + index + ']</span></div>' +
            "</a>"
          );
        })
        .join("");
    }
  );
})();
