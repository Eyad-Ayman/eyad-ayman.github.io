// Portfolio-deck behaviour (styles in deck.css): the running header,
// progress bars under the sideways strips, and touch stand-ins for the
// hover effects.
(function () {
  "use strict";

  var touch = window.matchMedia && window.matchMedia("(hover: none)").matches;
  var hasIO = "IntersectionObserver" in window;

  // ------------------------------------------------------------ focus = hover
  // On a touch screen nothing is ever hovered, so the colour reveals never
  // played. Whatever crosses the middle band of the screen gets .is-focus.
  if (touch && hasIO) {
    var FOCUS = ".project-tile, .collage-tile, .about-sliced, .btw-step, .studio-portal, .showreel-card, .contact-map";
    var focusIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.target.classList.toggle("is-focus", e.isIntersecting); });
    }, { rootMargin: "-38% 0px -38% 0px" });
    var watchFocus = function (scope) {
      scope.querySelectorAll(FOCUS).forEach(function (el) {
        if (el.__mFocus) return;
        el.__mFocus = true;
        focusIO.observe(el);
      });
    };
    watchFocus(document);
    // The gallery and the reels are rendered later by their own scripts.
    ["[data-mixed-gallery]", "[data-showreel-strip]"].forEach(function (sel) {
      var host = document.querySelector(sel);
      if (host) new MutationObserver(function () { watchFocus(host); }).observe(host, { childList: true, subtree: true });
    });
  }

  // ------------------------------------------------------------ running header
  // "Portfolio" plus the section you're in, like the top line of a printed
  // portfolio page; Giza time while you're on the cover. It frosts over as
  // soon as the page moves.
  var bar = document.getElementById("m-bar");
  var barSection = document.getElementById("m-bar-section");
  var NAMES = {
    About: "01 — About",
    Work: "02 — Work",
    Motion: "03 — Motion",
    studio: "04 — Studio",
    FAQ: "05 — Questions",
    mylinks: "06 — Contact"
  };
  var current = "Home";
  function giza() {
    try {
      return "Giza " + new Date().toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "Giza, EG";
    }
  }
  function label() {
    if (barSection) barSection.textContent = NAMES[current] || giza();
  }

  if (barSection) {
    label();
    setInterval(function () { if (!NAMES[current]) label(); }, 15000);
    if (hasIO) {
      var sectionIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          current = e.target.id;
          label();
        });
      }, { rootMargin: "-40% 0px -59% 0px" });
      document.querySelectorAll("[data-nav-section]").forEach(function (s) { sectionIO.observe(s); });
    }
  }

  if (bar) {
    var ticking = false;
    var onScroll = function () {
      ticking = false;
      bar.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(onScroll);
    }, { passive: true });
    onScroll();
  }

  // ------------------------------------------------------------ strip progress
  // A thin bar under each sideways strip shows how far along you are,
  // standing in for the desktop arrows.
  function stripProgress(strip) {
    var track = document.createElement("div");
    track.className = "m-strip-progress";
    track.setAttribute("aria-hidden", "true");
    var fill = document.createElement("i");
    track.appendChild(fill);
    strip.parentNode.insertBefore(track, strip.nextSibling);
    var update = function () {
      var max = strip.scrollWidth - strip.clientWidth;
      track.hidden = max < 4;
      if (max < 4) return;
      var visible = strip.clientWidth / strip.scrollWidth;
      fill.style.width = visible * 100 + "%";
      fill.style.transform = "translateX(" + (strip.scrollLeft / max) * (1 / visible - 1) * 100 + "%)";
    };
    strip.addEventListener("scroll", update, { passive: true });
    strip.addEventListener("load", update, true);
    window.addEventListener("resize", update);
    new MutationObserver(update).observe(strip, { childList: true });
    update();
  }
  document.querySelectorAll("[data-showreel-strip], [data-btw-track]").forEach(stripProgress);
})();

// Copy protection: no selecting, right-click, dragging or copy shortcuts.
// Anything that still reaches the clipboard carries the credit instead.
(function () {
  "use strict";
  var CREDIT = "© Eyad Ayman — eyad-ayman.github.io";
  ["contextmenu", "dragstart", "selectstart"].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); });
  });
  ["copy", "cut"].forEach(function (type) {
    document.addEventListener(type, function (e) {
      e.preventDefault();
      if (e.clipboardData) e.clipboardData.setData("text/plain", CREDIT);
    });
  });
  // Ctrl/Cmd + A, C, X, S, U, P and the devtools shortcuts.
  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase();
    var mod = e.ctrlKey || e.metaKey;
    if (k === "f12" ||
        (mod && ["a", "c", "x", "s", "u", "p"].indexOf(k) !== -1) ||
        (mod && e.shiftKey && ["i", "j", "c"].indexOf(k) !== -1)) {
      e.preventDefault();
    }
  });
  // Drop any selection that slips through (e.g. long-press on some phones).
  document.addEventListener("selectionchange", function () {
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges();
  });
})();
