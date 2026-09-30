// Renders the "Hey there!" bio and the Work Experience timeline from
// data/about.json and data/experience.json — edit those two files (plain
// text, no code) to update your bio or add/change a job. The HTML in
// index.html is a same-page fallback shown as-is if either fetch fails,
// so this never leaves the section blank.
(function () {
  "use strict";

  var bioEl = document.querySelector("[data-about-bio]");
  var expEl = document.querySelector("[data-experience-list]");
  if (!bioEl && !expEl) return;

  // Same escaping approach as gallery-feed.js: every value here comes from
  // a JSON file someone may hand-edit, not hand-written markup, so it's
  // treated as untrusted text and escaped before going into innerHTML.
  var escapeEl = document.createElement("div");
  function escapeHtml(str) {
    escapeEl.textContent = str == null ? "" : String(str);
    return escapeEl.innerHTML;
  }

  function safeFetch(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  if (bioEl) {
    safeFetch("./data/about.json").then(function (data) {
      if (!data || !Array.isArray(data.paragraphs) || data.paragraphs.length === 0) return;
      bioEl.innerHTML = data.paragraphs.map(escapeHtml).join("<br><br>");
    });
  }

  if (expEl) {
    safeFetch("./data/experience.json").then(function (data) {
      if (!data || !Array.isArray(data.roles) || data.roles.length === 0) return;
      var ICONS = ["case", "video", "pen", "star"];
      var html = data.roles
        .map(function (role) {
          var icon = ICONS.indexOf(role.icon) !== -1 ? role.icon : "pen";
          var cls = "process-block" + (role.current ? " process-block-current" : "");
          return (
            '<div class="' + cls + '">' +
              '<span class="process-icon process-icon-' + icon + '" aria-hidden="true"></span>' +
              '<div class="small-title">' + escapeHtml(role.period) + "</div>" +
              '<p class="process-detail">' + escapeHtml(role.title) + "</p>" +
              '<p class="process-desc">' + escapeHtml(role.desc) + "</p>" +
            "</div>"
          );
        })
        .join("") + '<div class="divider"></div>';
      expEl.innerHTML = html;
    });
  }
})();
