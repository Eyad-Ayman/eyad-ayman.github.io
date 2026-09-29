// Portfolio additions: Behind The Work reveal/drag, the Studio portal's video
// preview, and the cinematic portfolio <-> EYAD STUDIO transition.
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function ss(key, val) {
    try {
      if (val === undefined) return sessionStorage.getItem(key);
      if (val === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, val);
    } catch (e) { return null; }
    return null;
  }

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
  function curtain(cls) {
    var old = document.querySelector(".eyad-curtain");
    if (old) old.remove();
    var c = document.createElement("div");
    c.className = "eyad-curtain " + (cls || "");
    c.setAttribute("aria-hidden", "true");
    c.innerHTML = '<div class="eyad-curtain-bg"></div><div class="eyad-curtain-word"></div><div class="eyad-curtain-bar"></div>';
    document.body.appendChild(c);
    return c;
  }

  function isStudioLink(a) {
    if (!a || !a.href) return false;
    try {
      var u = new URL(a.href, location.href);
      return u.origin === location.origin && /\/studio\/(index\.html)?$/.test(u.pathname);
    } catch (e) { return false; }
  }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[data-studio-link], a[href$='studio/']");
    if (!a || a.target === "_blank" || !isStudioLink(a)) return;
    e.preventDefault();
    var href = a.href;
    ss("eyad:return", JSON.stringify({ y: window.scrollY, t: Date.now() }));
    ss("eyad:enter", "1");
    if (reduce) {
      var f = curtain("is-fade");
      requestAnimationFrame(function () { f.classList.add("is-run"); });
      setTimeout(function () { location.href = href; }, 190);
      return;
    }
    var c = curtain();
    c.querySelector(".eyad-curtain-word").innerHTML = "EYAD<br><em>STUDIO</em>";
    // Fly the clicked card's artwork up to fill the screen before the curtain closes.
    var src = a.querySelector("img");
    if (src && src.complete && src.naturalWidth) {
      var r = src.getBoundingClientRect();
      var im = document.createElement("img");
      im.className = "eyad-curtain-img";
      im.src = src.currentSrc || src.src;
      im.alt = "";
      im.style.cssText = "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;";
      c.insertBefore(im, c.querySelector('.eyad-curtain-word'));
      requestAnimationFrame(function () {
        im.style.transition = "all .55s cubic-bezier(.7,0,.2,1)";
        im.style.left = "0px"; im.style.top = "0px"; im.style.width = "100vw"; im.style.height = "100vh";
        im.style.opacity = "0.35";
      });
    }
    requestAnimationFrame(function () { requestAnimationFrame(function () { c.classList.add("is-run"); }); });
    setTimeout(function () { location.href = href; }, 720);
  });

  // Coming back from the Studio: lift the curtain and return to where you were.
  function arrive(persisted) {
    var stale = document.querySelector(".eyad-curtain");
    if (stale) stale.remove();
    if (ss("eyad:return-anim") !== "1") return;
    ss("eyad:return-anim", null);
    var saved = null;
    try { saved = JSON.parse(ss("eyad:return") || "null"); } catch (e) { saved = null; }
    if (!persisted && saved && Date.now() - saved.t < 6 * 3600e3) {
      var y = saved.y;
      // Content above (gallery, reels) loads async; restore now and once more after it settles.
      window.scrollTo(0, y);
      setTimeout(function () { window.scrollTo(0, y); }, 400);
    }
    if (reduce) return;
    var c = curtain("is-lift");
    c.querySelector(".eyad-curtain-word").remove();
    requestAnimationFrame(function () { requestAnimationFrame(function () { c.classList.add("is-go"); }); });
    setTimeout(function () { c.remove(); }, 900);
  }
  window.addEventListener("pageshow", function (e) { arrive(e.persisted); });
})();
