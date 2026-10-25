// Portfolio additions: Behind The Work reveal/drag, the Studio portal's video
// preview, and the seamless hand-off to the Studio / Store.
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------ Behind The Work
  var track = document.querySelector("[data-btw-track]");
  if (track) {
    var steps = track.querySelectorAll(".btw-step");
    if ("IntersectionObserver" in window && !reduce) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var i = Array.prototype.indexOf.call(steps, e.target);
          e.target.style.transitionDelay = Math.min(i, 5) * 90 + "ms";
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        });
      }, { threshold: 0.2 });
      steps.forEach(function (s) { io.observe(s); });
    } else {
      steps.forEach(function (s) { s.classList.add("is-in"); });
    }
    // Mouse drag to scroll sideways (touch already scrolls natively).
    var down = false, sx = 0, sl = 0, moved = false;
    track.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = true; moved = false; sx = e.clientX; sl = track.scrollLeft;
    });
    window.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - sx;
      if (Math.abs(dx) > 4) { moved = true; track.classList.add("is-dragging"); }
      track.scrollLeft = sl - dx;
    });
    window.addEventListener("pointerup", function () {
      if (!down) return;
      down = false;
      setTimeout(function () { track.classList.remove("is-dragging"); }, 0);
    });
    track.addEventListener("click", function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  }

  // ------------------------------------------------------------ Studio portal preview
  var portal = document.querySelector(".studio-portal");
  var pv = portal && portal.querySelector("[data-sp-video]");
  if (pv && !reduce) {
    var play = function () { pv.play().catch(function () {}); };
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) play(); else pv.pause(); });
      }, { threshold: 0.3 }).observe(portal);
    }
    portal.addEventListener("mouseenter", play);
  }

  // ------------------------------------------------------------ transitions
  // Studio and Store live at madebyeyad.web.app. On click the page dissolves
  // into the exact colour the destination paints first (the Studio's red
  // frame, the Store's paper white), so the hand-off has no visible seam.
  var PORTAL_COLOR = { studio: "#f4260f", store: "#ecebe6" };

  function veil(color) {
    var old = document.querySelector(".eyad-veil");
    if (old) old.remove();
    var v = document.createElement("div");
    v.className = "eyad-veil";
    v.setAttribute("aria-hidden", "true");
    v.style.background = color;
    document.body.appendChild(v);
    return v;
  }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[data-portal]");
    if (!a || a.target === "_blank") return;
    e.preventDefault();
    var href = a.href;
    var v = veil(PORTAL_COLOR[a.getAttribute("data-portal")] || PORTAL_COLOR.studio);
    requestAnimationFrame(function () { requestAnimationFrame(function () { v.classList.add("is-on"); }); });
    setTimeout(function () { location.href = href; }, reduce ? 120 : 380);
  });

  // The back button restores this page from the back/forward cache with the
  // veil still over it — dissolve it away.
  window.addEventListener("pageshow", function () {
    var v = document.querySelector(".eyad-veil");
    if (!v) return;
    v.classList.add("is-off");
    setTimeout(function () { v.remove(); }, 450);
  });
})();
