// Renders the "Feeds From Instagram" grid from data/instagram.json, which
// .github/workflows/instagram-sync.yml keeps in sync with the real
// Instagram API. Shows only real, live posts — see INSTAGRAM_SETUP.md.

(function () {
  "use strict";

  var grid = document.querySelector("[data-instagram-grid]");
  if (!grid) return;

  fetch("./data/instagram.json", { cache: "no-store" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      var posts = data && Array.isArray(data.posts) ? data.posts : [];
      if (posts.length === 0) return; // leave the "not connected yet" placeholder as-is

      grid.innerHTML = posts
        .map(function (post) {
          var caption = (post.caption || "View on Instagram").replace(/"/g, "&quot;");
          return (
            '<a href="' + post.permalink + '" target="_blank" rel="noopener" class="gallery-tile">' +
              '<img src="' + post.image + '" loading="lazy" alt="' + caption + '">' +
              (post.isVideo ? '<span class="insta-video-badge" aria-hidden="true">&#9654;</span>' : "") +
              '<span class="gallery-caption">' + caption + "</span>" +
            "</a>"
          );
        })
        .join("");
    })
    .catch(function () {
      // Network hiccup or file missing — keep the placeholder as-is.
    });
})();
