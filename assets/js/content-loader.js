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

  // English, or the *_ar fields when the page is switched to Arabic
  // (assets/js/i18n.js). Both files are fetched once and re-rendered on a
  // language switch.
  function lang() { return window.eyadLang ? window.eyadLang() : "en"; }
  function pick(obj, key) {
    return lang() === "ar" && obj[key + "_ar"] ? obj[key + "_ar"] : obj[key];
  }
  var about = null, exp = null;

  function renderBio() {
    if (!bioEl || !about) return;
    var paras = pick(about, "paragraphs");
    if (!Array.isArray(paras) || paras.length === 0) return;
    // first paragraph is the lead, the last one the closing line
    bioEl.innerHTML = paras.map(function (t, i) {
      var cls = i === 0 ? "bio-lead" : i === paras.length - 1 && paras.length > 2 ? "bio-close" : "bio-p";
      return "<p class=\"" + cls + "\">" + escapeHtml(t) + "</p>";
    }).join("");
  }

  function renderExp() {
    if (!expEl || !exp || !Array.isArray(exp.roles) || exp.roles.length === 0) return;
    var ICONS = ["case", "video", "pen", "star"];
    var html = exp.roles
      .map(function (role) {
        var icon = ICONS.indexOf(role.icon) !== -1 ? role.icon : "pen";
        var cls = "process-block" + (role.current ? " process-block-current" : "");
        return (
          '<div class="' + cls + '">' +
            '<span class="process-icon process-icon-' + icon + '" aria-hidden="true"></span>' +
            '<div class="small-title">' + escapeHtml(pick(role, "period")) + "</div>" +
            '<p class="process-detail">' + escapeHtml(pick(role, "title")) + "</p>" +
            '<p class="process-desc">' + escapeHtml(pick(role, "desc")) + "</p>" +
          "</div>"
        );
      })
      .join("") + '<div class="divider"></div>';
    expEl.innerHTML = html;
  }

  if (bioEl) {
    safeFetch("./data/about.json").then(function (data) { about = data; renderBio(); });
  }
  if (expEl) {
    safeFetch("./data/experience.json").then(function (data) { exp = data; renderExp(); });
  }
  document.addEventListener("langchange", function () { renderBio(); renderExp(); });
})();
