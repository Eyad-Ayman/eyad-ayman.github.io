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
    clients: "01.5 — Clients",
    studio: "04 — Studio",
    FAQ: "05 — Questions",
    mylinks: "06 — Contact"
  };
  var current = "Home";
  function giza() {
    var ar = window.eyadLang && window.eyadLang() === "ar";
    try {
      var t = new Date().toLocaleTimeString(ar ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" });
      return (ar ? "الجيزة " : "Giza ") + t;
    } catch (e) {
      return ar ? "الجيزة، مصر" : "Giza, EG";
    }
  }
  function label() {
    if (barSection) barSection.textContent = NAMES[current] || giza();
  }

  if (barSection) {
    document.addEventListener("langchange", label);
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

// Phone cover: replay the entrance as the splash lifts (it played unseen
// underneath), and drive the name / portrait depth from the scroll position.
(function () {
  "use strict";
  var home = document.getElementById("Home");
  if (!home) return;
  var intro = document.getElementById("intro-overlay");
  if (intro && "MutationObserver" in window) {
    new MutationObserver(function () {
      if (intro.classList.contains("is-leaving")) home.classList.add("cover-replay");
    }).observe(intro, { attributes: true, attributeFilter: ["class"] });
  }
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var ticking = false;
  function depth() {
    ticking = false;
    if (window.innerWidth > 767) { home.style.removeProperty("--cv"); return; }
    var p = Math.min(1, Math.max(0, window.scrollY / Math.max(1, home.offsetHeight)));
    home.style.setProperty("--cv", p.toFixed(3));
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(depth); }
  }, { passive: true });
  window.addEventListener("resize", depth);
  depth();
})();

// Gallery Index view: every piece as a ruled row (number, title, type,
// source). On a desktop the cover follows the cursor while you hover a
// row; on a phone each row carries a small thumbnail instead.
(function () {
  "use strict";
  var grid = document.querySelector("[data-mixed-gallery]");
  var list = document.querySelector("[data-work-index]");
  var sw = document.querySelector("[data-work-view]");
  if (!grid || !list || !sw) return;

  function build() {
    var tiles = Array.prototype.slice.call(grid.querySelectorAll(".project-tile"));
    tiles.sort(function (a, b) { return (a.__order || 0) - (b.__order || 0); });
    var frag = document.createDocumentFragment();
    tiles.forEach(function (t, i) {
      var media = t.querySelector("img, video");
      var src = media ? (media.tagName === "VIDEO" ? media.getAttribute("poster") : media.getAttribute("src")) : "";
      var nameEl = t.querySelector(".project-name, .gallery-caption");
      var raw = ((nameEl && nameEl.textContent) || t.title || "").trim();
      var parts = raw.split("|");
      var badge = t.querySelector(".project-index");
      var from = badge ? badge.textContent.trim() : (t.classList.contains("gallery-tile-instagram") ? "Instagram" : "Behance");

      var a = document.createElement("a");
      a.href = t.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("data-peek", src || "");
      var num = document.createElement("b");
      num.textContent = String(i + 1).padStart(2, "0");
      var thumb = document.createElement("img");
      thumb.className = "wi-thumb";
      thumb.alt = "";
      thumb.loading = "lazy";
      if (src) thumb.setAttribute("src", src);
      var title = document.createElement("span");
      title.className = "wi-title";
      title.dir = /[؀-ۿ]/.test(parts[0]) ? "rtl" : "ltr";
      title.textContent = parts[0].trim() || from;
      var kind = document.createElement("span");
      kind.className = "wi-kind";
      kind.textContent = (parts[1] || "").trim();
      var source = document.createElement("span");
      source.className = "wi-src";
      source.textContent = from;
      var arrow = document.createElement("i");
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      [num, thumb, title, kind, source, arrow].forEach(function (el) { a.appendChild(el); });
      var li = document.createElement("li");
      li.appendChild(a);
      frag.appendChild(li);
    });
    list.replaceChildren(frag);
  }

  var timer = 0;
  new MutationObserver(function () {
    clearTimeout(timer);
    timer = setTimeout(build, 120);
  }).observe(grid, { childList: true });
  build();

  sw.addEventListener("click", function (e) {
    var b = e.target.closest("[data-view]");
    if (!b) return;
    var showIndex = b.getAttribute("data-view") === "index";
    sw.querySelectorAll("[data-view]").forEach(function (x) { x.classList.toggle("is-on", x === b); });
    grid.classList.toggle("is-off", showIndex);
    list.hidden = !showIndex;
  });

  // cursor preview (mouse only)
  if (!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches)) return;
  var peek = document.createElement("div");
  peek.className = "work-peek";
  peek.setAttribute("aria-hidden", "true");
  var pimg = document.createElement("img");
  pimg.alt = "";
  peek.appendChild(pimg);
  document.body.appendChild(peek);
  var x = 0, y = 0, cx = 0, cy = 0, on = false, raf = 0;
  function step() {
    cx += (x - cx) * 0.2;
    cy += (y - cy) * 0.2;
    // to the right of the row titles, never over them
    var left = Math.max(cx, window.innerWidth * 0.5);
    if (left > window.innerWidth - 330) left = window.innerWidth - 330;
    peek.style.transform = "translate(" + left + "px," + cy + "px)";
    if (on) raf = requestAnimationFrame(step);
  }
  list.addEventListener("pointermove", function (e) {
    x = e.clientX;
    y = e.clientY;
    var a = e.target.closest && e.target.closest("a[data-peek]");
    if (!a || !a.getAttribute("data-peek")) { if (on) { on = false; peek.classList.remove("is-on"); } return; }
    if (pimg.getAttribute("src") !== a.getAttribute("data-peek")) pimg.setAttribute("src", a.getAttribute("data-peek"));
    if (!on) {
      on = true;
      cx = x;
      cy = y;
      peek.classList.add("is-on");
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(step);
    }
  });
  list.addEventListener("pointerleave", function () {
    on = false;
    peek.classList.remove("is-on");
  });
})();

// Visit counter (GoatCounter: no cookies, nothing personal stored). Counts
// page views with where people came from (add ?ref=instagram or
// ?ref=linkedin to the link in each bio so in-app browsers are told apart),
// which sections they reached, and which buttons they pressed.
// Only runs on the live site. Open eyad-ayman.github.io/#nocount once on
// your own phone and computer so your own visits are not counted
// (#count turns it back on).
(function () {
  "use strict";
  var CODE = "eyadayman";
  if (location.hostname !== "eyad-ayman.github.io") return;
  try {
    if (location.hash === "#nocount") localStorage.setItem("gc-skip", "1");
    if (location.hash === "#count") localStorage.removeItem("gc-skip");
    if (localStorage.getItem("gc-skip")) return;
  } catch (e) {}
  var END = "https://" + CODE + ".goatcounter.com/count";

  function send(path, title, isEvent) {
    var q = "?p=" + encodeURIComponent(path) +
      "&t=" + encodeURIComponent(title || "") +
      (isEvent ? "&e=true" : "&r=" + encodeURIComponent(document.referrer) + "&q=" + encodeURIComponent(location.search)) +
      "&rnd=" + Math.random().toString(36).slice(2);
    var img = new Image();
    img.src = END + q;
  }
  send(location.pathname || "/", document.title, false);

  function label(el) { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80); }
  var RULES = [
    [".hero-cta-main", "hire-cover"],
    [".hero-cta-alt", "cv-cover"],
    ["[data-brief-send]", "brief-send"],
    [".whatsapp-button", "whatsapp"],
    [".signoff-cta", "say-hello"],
    [".hire-toast-cta", "hire-toast"],
    ["[data-portal=\"studio\"]", "studio"],
    ["[data-portal=\"store\"]", "store"],
    [".behance-cta-wrap a", "behance-all"],
    [".contact-card", "contact"],
    [".project-tile, .work-index a", "work"],
    [".showreel-card", "reel"],
    ["[data-lang-toggle]", "language"],
    ["#theme-toggle", "theme"],
    [".brief-opts button", "brief-pick"]
  ];
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    for (var i = 0; i < RULES.length; i++) {
      var el = t.closest(RULES[i][0]);
      if (!el) continue;
      var name = RULES[i][1];
      var detail = label(el);
      if (name === "contact") name += "-" + detail.toLowerCase().replace(/[^a-z]+/g, "");
      if (name === "work") detail = (el.getAttribute("title") || detail).replace(/ — View on .*/, "");
      if (name === "brief-pick") detail = el.getAttribute("data-v") || detail;
      send("click-" + name, detail, true);
      return;
    }
  }, true);

  if ("IntersectionObserver" in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var id = en.target.id;
        if (!en.isIntersecting || seen[id]) return;
        seen[id] = true;
        send("reached-" + id, id, true);
        io.unobserve(en.target);
      });
    }, { threshold: 0.25 });
    document.querySelectorAll("[data-nav-section]").forEach(function (s) { if (s.id && s.id !== "Home") io.observe(s); });
  }
})();
