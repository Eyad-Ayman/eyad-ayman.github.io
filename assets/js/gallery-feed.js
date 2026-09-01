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
          // Full-bleed spread every few tiles, fashion-editorial style —
          // not just a single hero at the top of the whole gallery.
          var heroClass = i % 7 === 0 ? " tile-hero" : "";
          return (
            '<a href="' + item.url + '" target="_blank" rel="noopener" title="' + title + ' — View on ' + badge + '" class="project-tile gallery-tile gallery-tile-' + item.type + heroClass + '">' +
              '<div class="project-photo"' + (heroClass ? ' data-tile-number="' + index + '"' : "") + '><img src="' + item.image + '" loading="lazy" alt="' + title + '"></div>' +
              '<div class="project-caption"><span class="project-index">N&deg;' + index + " &mdash; " + badge.toUpperCase() + '</span><span class="project-name">' + title + '</span></div>' +
            "</a>"
          );
        })
        .join("");
    }
  );
})();
