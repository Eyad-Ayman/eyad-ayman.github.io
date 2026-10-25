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
  // Form fields (the project brief) keep normal typing, selecting and pasting.
  function inField(t) { return t && t.closest && t.closest("input, textarea, [contenteditable]"); }
  ["contextmenu", "dragstart", "selectstart"].forEach(function (type) {
    document.addEventListener(type, function (e) { if (!inField(e.target)) e.preventDefault(); });
  });
  ["copy", "cut"].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (inField(e.target)) return;
      e.preventDefault();
      if (e.clipboardData) e.clipboardData.setData("text/plain", CREDIT);
    });
  });
  // Ctrl/Cmd + A, C, X, S, U, P and the devtools shortcuts.
  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase();
    var mod = e.ctrlKey || e.metaKey;
    if (inField(e.target) && k !== "f12" && !e.shiftKey) return;
    if (k === "f12" ||
        (mod && ["a", "c", "x", "s", "u", "p"].indexOf(k) !== -1) ||
        (mod && e.shiftKey && ["i", "j", "c"].indexOf(k) !== -1)) {
      e.preventDefault();
    }
  });
  // Drop any selection that slips through (e.g. long-press on some phones).
  document.addEventListener("selectionchange", function () {
    if (inField(document.activeElement)) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges();
  });
})();

// Behind The Work: step through the poster being made. Plays on its own
// while in view; picking a step stops the autoplay on that step.
(function () {
  "use strict";
  var studio = document.querySelector("[data-btw-studio]");
  if (!studio) return;
  var app = studio.querySelector(".btw-app");
  var btns = Array.prototype.slice.call(studio.querySelectorAll("[data-btw-go]"));
  var layers = Array.prototype.slice.call(studio.querySelectorAll(".btw-layers [data-l]"));
  var status = studio.querySelector("[data-btw-status]");
  var STATUS = ["", "Moodboard", "Sketching", "Cutout + layers", "Colour grade", "Timeline", "Exported ✓"];
  var step = 1, timer = 0, visible = false, paused = false;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function show(n) {
    step = n;
    app.setAttribute("data-step", String(n));
    btns.forEach(function (b, i) {
      b.classList.remove("is-on");
      if (i + 1 === n) { void b.offsetWidth; b.classList.add("is-on"); }
    });
    layers.forEach(function (l) {
      var at = +l.getAttribute("data-l");
      l.classList.toggle("is-on", at <= n);
      l.classList.toggle("is-active", at === n);
    });
    if (status) status.textContent = STATUS[n];
  }
  function schedule() {
    clearTimeout(timer);
    if (paused || !visible || reduce) return;
    timer = setTimeout(function () { show(step % btns.length + 1); schedule(); }, 3600);
  }
  btns.forEach(function (b) {
    b.addEventListener("click", function () {
      paused = true;
      studio.classList.add("is-paused");
      clearTimeout(timer);
      show(+b.getAttribute("data-btw-go"));
    });
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; schedule(); }, { threshold: 0.35 }).observe(studio);
  }
  if (reduce) studio.classList.add("is-paused");
  show(1);
})();

// Status bar / browser chrome colour follows the page: whatever colour sits
// just under the running header becomes the theme colour (Chrome, older
// Safari) and, on phones, the header band itself (Safari 26 tints the status
// bar from a fixed element at the top of the page).
(function () {
  "use strict";
  var meta = document.querySelector("meta[name=theme-color]");
  var bar = document.getElementById("m-bar");
  if (!document.elementsFromPoint) return;
  var SKIP = ".m-bar, .navbar, .hire-toast, .cursor-dot, .cursor-ring, .intro-overlay, .scroll-hint, .egg-toast, .confetti-layer";
  function opaque(c) {
    var m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var v = m[1].split(",").map(parseFloat);
    if (v.length > 3 && v[3] < 0.9) return null;
    return v;
  }
  function sample(y) {
    var els = document.elementsFromPoint(window.innerWidth / 2, y);
    for (var i = 0; i < els.length; i++) {
      if (els[i].closest(SKIP)) continue;
      for (var el = els[i]; el && el !== document.documentElement; el = el.parentElement) {
        var v = opaque(getComputedStyle(el).backgroundColor);
        if (v) return v;
      }
    }
    return opaque(getComputedStyle(document.body).backgroundColor) || [243, 237, 225];
  }
  var last = "", ticking = false;
  function update() {
    ticking = false;
    var h = bar ? bar.getBoundingClientRect().height : 0;
    var v = sample(Math.max(1, h + 1));
    var col = "rgb(" + Math.round(v[0]) + ", " + Math.round(v[1]) + ", " + Math.round(v[2]) + ")";
    if (col === last) return;
    last = col;
    if (meta) meta.setAttribute("content", col);
    if (!bar) return;
    if (window.innerWidth < 768) {
      var lum = (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255;
      bar.style.backgroundColor = col;
      bar.style.color = lum < 0.55 ? "#f3ede1" : "#0b0b0b";
      bar.classList.add("is-sampled");
    } else {
      bar.style.backgroundColor = "";
      bar.style.color = "";
      bar.classList.remove("is-sampled");
    }
  }
  function queue() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", function () { last = ""; queue(); });
  window.addEventListener("load", function () { last = ""; queue(); });
  new MutationObserver(function () { last = ""; queue(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  update();
})();

// Project brief: pick what you need, when and the budget; it becomes a
// ready-to-send WhatsApp message.
(function () {
  "use strict";
  var brief = document.querySelector("[data-brief]");
  if (!brief) return;
  var send = brief.querySelector("[data-brief-send]");
  var nameEl = brief.querySelector("[data-brief-name]");
  var picked = {};
  brief.querySelectorAll(".brief-opts").forEach(function (group) {
    group.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      group.querySelectorAll("button").forEach(function (x) { x.classList.toggle("is-on", x === b && !b.classList.contains("is-on")); });
      picked[group.getAttribute("data-q")] = b.classList.contains("is-on") ? b.getAttribute("data-v") : "";
      build();
    });
  });
  function build() {
    var who = nameEl && nameEl.value.trim();
    var msg = "Hi Eyad" + (who ? ", this is " + who : "") + ". I found your portfolio";
    msg += picked.need ? " and I need " + picked.need + "." : " and I would like to work with you.";
    if (picked.when) msg += " Timeline: " + picked.when + ".";
    if (picked.budget) msg += " Budget: " + picked.budget + ".";
    send.href = "https://wa.me/201022945880?text=" + encodeURIComponent(msg);
    brief.classList.toggle("is-ready", !!picked.need);
  }
  if (nameEl) nameEl.addEventListener("input", build);
  build();
})();
