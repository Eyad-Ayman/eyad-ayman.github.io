// Renders the Projects grid from data/behance.json, which
// .github/workflows/behance-sync.yml keeps in sync with your real
// published Behance projects (checked via a headless browser, since
// Behance has no working public API or RSS feed anymore). The grid's
// static markup already matches this data as a same-page fallback, so
// this only needs to run once new projects are added or removed.

(function () {
  "use strict";

  var grid = document.querySelector("[data-behance-grid]");
  if (!grid) return;

  fetch("./data/behance.json", { cache: "no-store" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data || !Array.isArray(data.projects) || data.projects.length === 0) return;

      grid.innerHTML = data.projects
        .map(function (project, i) {
          var index = String(i + 1).padStart(2, "0");
          var title = (project.title || "Untitled project").replace(/"/g, "&quot;");
          var image = "./assets/images/behance/" + project.file;
          return (
            '<a href="' + project.url + '" target="_blank" rel="noopener" title="' + title + ' — View on Behance" class="project-tile">' +
              '<div class="project-photo"><img src="' + image + '" loading="lazy" alt="' + title + '"></div>' +
              '<div class="project-caption"><span class="project-name">' + title + '</span><span class="project-index">[' + index + ']</span></div>' +
            "</a>"
          );
        })
        .join("");
    })
    .catch(function () {
      // Network hiccup or file missing — keep the fallback markup as-is.
    });
})();
