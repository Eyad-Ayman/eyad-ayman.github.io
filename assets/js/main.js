// Eyad Ayman portfolio — small hand-written behaviors (no framework needed).

(function () {
  "use strict";

  // ---- Console easter egg, for anyone curious enough to open devtools ----
  try {
    console.log(
      "%cHey, nice job opening devtools. %c\nSince you're already snooping around — I'm Eyad, and I'm looking for work.\nWhatsApp: +20 102 294 5880  |  Behance: behance.net/eyad_ayman\n(Also try clicking my name on the homepage 5 times fast.)",
      "color:#d02b2a;font-weight:700;font-size:14px;",
      "color:#666;font-size:12px;"
    );
  } catch (e) {}

  // ---- Dark mode toggle ---------------------------------------------------
  // Applied here (a script tag at the end of body) rather than an inline
  // <script> in <head>, which is the usual way sites avoid a flash of the
  // wrong theme on repeat visits — but that needs 'unsafe-inline' in the
  // CSP's script-src, and this site keeps that locked to 'self' on purpose.
  // A brief flash on a dark-mode return visit is the honest trade-off for
  // not weakening that policy just for cosmetics.
  (function () {
    var root = document.documentElement;
    var toggle = document.getElementById("theme-toggle");
    var label = document.getElementById("theme-toggle-label");
    if (!toggle) return;

    var stored = null;
    try { stored = localStorage.getItem("theme"); } catch (e) {}
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = stored || (prefersDark ? "dark" : "light");

    function apply(t) {
      if (t === "dark") {
        root.setAttribute("data-theme", "dark");
        if (label) label.textContent = "Light";
      } else {
        root.removeAttribute("data-theme");
        if (label) label.textContent = "Dark";
      }
    }
    apply(theme);

    toggle.addEventListener("click", function () {
      theme = theme === "dark" ? "light" : "dark";
      apply(theme);
      try { localStorage.setItem("theme", theme); } catch (e) {}
    });
  })();

  // ---- Install-as-app support (PWA) ----------------------------------------
  // Registers the offline/shell service worker so browsers offer "Add to
  // Home Screen" / "Install app", and the site keeps working (from cache)
  // with no signal. Same-origin script under the CSP's default-src 'self',
  // no extra allowlist entry needed.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    });
  }

  // ---- Hero portrait/video parallax (subtle depth while scrolling) --------
  // The two hero images are deliberately oversized in CSS (height: 128%)
  // so they have room to drift with scroll without ever exposing an edge
  // inside their overflow:hidden holders. Each layer moves a different
  // amount/direction so they read as sitting at different depths, not
  // just sliding together — that's the actual "3D" part.
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var heroPortrait = document.querySelector(".hero-section-images._01");
  var heroVideo = document.querySelector(".hero-section-images._02");
  var heroSection = document.querySelector(".hero-section");
  if (!reduceMotion && heroSection && (heroPortrait || heroVideo) && "requestAnimationFrame" in window) {
    var parallaxTicking = false;
    function applyHeroParallax() {
      parallaxTicking = false;
      var rect = heroSection.getBoundingClientRect();
      // 0 when the hero's top is at the viewport top, growing as it
      // scrolls up past it — only matters while the hero is on screen.
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      var progress = -rect.top; // px scrolled since the hero hit the top
      var clampedPortrait = Math.max(-22, Math.min(22, progress * 0.06));
      var clampedVideo = Math.max(-22, Math.min(22, progress * -0.045));
      if (heroPortrait) heroPortrait.style.setProperty("--parallax-y", clampedPortrait + "px");
      if (heroVideo) heroVideo.style.setProperty("--parallax-y", clampedVideo + "px");
    }
    window.addEventListener(
      "scroll",
      function () {
        if (parallaxTicking) return;
        parallaxTicking = true;
        requestAnimationFrame(applyHeroParallax);
      },
      { passive: true }
    );
    applyHeroParallax();
  }

  // ---- "Keep scrolling" hint while inside the Gallery of Work -------------
  var scrollHint = document.getElementById("gallery-scroll-hint");
  var workSection = document.getElementById("Work");
  if (scrollHint && workSection && "IntersectionObserver" in window) {
    // threshold must be 0, not a ratio like 0.15 — that's a percentage of
    // the ELEMENT, and the Gallery section runs to several thousand
    // pixels tall (49 tiles). On a ~800px phone screen the maximum
    // reachable ratio is under 0.15, so a ratio threshold here would
    // never fire at all — the exact bug already found and fixed once
    // this session for the scroll-reveal system, not repeating it here.
    var hintObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          scrollHint.classList.toggle("is-active", entry.isIntersecting);
        });
      },
      { threshold: 0 }
    );
    hintObserver.observe(workSection);
  }

  // ---- Live Giza local time in the corner readout -------------------------
  var clockEl = document.getElementById("site-readout-clock");
  if (clockEl) {
    var updateClock = function () {
      var time = new Date().toLocaleTimeString("en-GB", {
        timeZone: "Africa/Cairo",
        hour: "2-digit",
        minute: "2-digit",
      });
      clockEl.textContent = "—— GIZA, EG " + time;
    };
    updateClock();
    setInterval(updateClock, 15000);
  }

  // ---- Below-the-fold background videos load only when scrolled to -------
  // Three <video> elements on this page share the same loop.webm. Letting
  // all three autoplay meant the file was fetched three times on load
  // (~840KB of video for a 263KB file) for two clips you can't even see
  // yet. These two now stay on their poster frame until they're near the
  // viewport, then load and play.
  var lazyVideos = Array.prototype.slice.call(document.querySelectorAll("[data-lazy-video]"));
  if (lazyVideos.length) {
    var startVideo = function (v) {
      if (v.dataset.started) return;
      v.dataset.started = "1";
      v.preload = "auto";
      v.load();
      v.play().catch(function () {});
    };
    if ("IntersectionObserver" in window) {
      var videoObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              startVideo(entry.target);
            } else if (entry.target.dataset.started) {
              entry.target.pause();
            }
          });
        },
        { rootMargin: "200px 0px" }
      );
      lazyVideos.forEach(function (v) { videoObserver.observe(v); });
    } else {
      lazyVideos.forEach(startVideo);
    }
  }

  // ---- Opening splash (once per browser session) ------------------------
  var intro = document.getElementById("intro-overlay");
  if (intro) {
    var seen = false;
    try { seen = sessionStorage.getItem("introSeen") === "1"; } catch (e) {}

    if (seen) {
      intro.remove();
    } else {
      var dismissed = false;

      // Film-leader style frame counter ticking up while the sequence plays.
      var counterEl = document.getElementById("intro-frame-counter");
      var counterTimer = null;
      if (counterEl) {
        var frame = 1;
        counterTimer = setInterval(function () {
          frame += Math.floor(Math.random() * 4) + 1;
          counterEl.textContent = String(frame).padStart(3, "0");
        }, 90);
      }

      function dismissIntro() {
        if (dismissed) return;
        dismissed = true;
        if (counterTimer) clearInterval(counterTimer);
        try { sessionStorage.setItem("introSeen", "1"); } catch (e) {}
        intro.classList.add("intro-hidden");
        setTimeout(function () { intro.remove(); }, 750);
      }
      intro.addEventListener("click", dismissIntro);
      setTimeout(dismissIntro, 2400);
    }
  }

  // ---- Scroll-reveal motion (one-time fade/rise per element) -------------
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (revealEls.length && "IntersectionObserver" in window) {
    var revealObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      // threshold must stay 0. A ratio threshold is a percentage of the
      // ELEMENT, so anything taller than viewport/threshold can never
      // reach it: the 6855px gallery on an 812px phone tops out at 11.85%
      // and so stayed invisible forever behind the old 0.12. Firing on any
      // intersection at all is height-independent; rootMargin still holds
      // the reveal until the element is properly on screen.
      { threshold: 0, rootMargin: "0px 0px -60px 0px" }
    );
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  // ---- "Hire me" toast (once per session, dismissible) -------------------
  var hireToast = document.getElementById("hire-toast");
  var hireToastClose = document.getElementById("hire-toast-close");
  if (hireToast) {
    var hireToastSeen = false;
    try { hireToastSeen = sessionStorage.getItem("hireToastSeen") === "1"; } catch (e) {}
    if (!hireToastSeen) {
      var hireShown = false;
      window.addEventListener("scroll", function () {
        if (hireShown) return;
        var scrolled = window.scrollY + window.innerHeight;
        if (scrolled > document.documentElement.scrollHeight * 0.45) {
          hireShown = true;
          hireToast.classList.add("is-visible");
        }
      }, { passive: true });
    }
    if (hireToastClose) {
      hireToastClose.addEventListener("click", function () {
        hireToast.classList.remove("is-visible");
        try { sessionStorage.setItem("hireToastSeen", "1"); } catch (e) {}
      });
    }
  }

  // ---- Hidden easter egg: click the hero name fast enough for confetti ---
  var heroText = document.querySelector(".hero-text");
  var confettiLayer = document.getElementById("confetti-layer");
  var eggToast = document.getElementById("egg-toast");
  if (heroText && confettiLayer && eggToast) {
    var clickTimes = [];
    var confettiColors = ["#d02b2a", "#111", "#ece9e2", "#888"];

    function burstConfetti() {
      for (var i = 0; i < 60; i++) {
        var piece = document.createElement("div");
        piece.className = "confetti-piece";
        piece.style.left = Math.random() * 100 + "vw";
        piece.style.backgroundColor = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        piece.style.animationDuration = 1.8 + Math.random() * 1.4 + "s";
        piece.style.animationDelay = Math.random() * 0.4 + "s";
        confettiLayer.appendChild(piece);
        (function (el) {
          el.addEventListener("animationend", function () { el.remove(); });
        })(piece);
      }
    }

    heroText.style.cursor = "pointer";
    heroText.addEventListener("click", function () {
      var now = Date.now();
      clickTimes.push(now);
      clickTimes = clickTimes.filter(function (t) { return now - t < 2500; });
      if (clickTimes.length >= 5) {
        clickTimes = [];
        burstConfetti();
        eggToast.classList.add("is-visible");
        setTimeout(function () { eggToast.classList.remove("is-visible"); }, 5000);
      }
    });
  }

  // ---- Custom cursor (desktop / fine-pointer only) -----------------------
  if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
    var cursorDot = document.getElementById("cursor-dot");
    var cursorRing = document.getElementById("cursor-ring");
    if (cursorDot && cursorRing) {
      var ringX = 0, ringY = 0;
      document.addEventListener("mousemove", function (e) {
        cursorDot.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px) translate(-50%,-50%)";
        cursorRing.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px) translate(-50%,-50%)";
      });
      document.addEventListener("mouseleave", function () {
        cursorDot.classList.add("is-hidden");
        cursorRing.classList.add("is-hidden");
      });
      document.addEventListener("mouseenter", function () {
        cursorDot.classList.remove("is-hidden");
        cursorRing.classList.remove("is-hidden");
      });
      var hoverTargets = "a, button, .gallery-tile, .project-tile, .tools-launcher-card, .contact-card, input, textarea, select";
      document.addEventListener("mouseover", function (e) {
        if (e.target.closest && e.target.closest(hoverTargets)) {
          cursorDot.classList.add("is-hover");
          cursorRing.classList.add("is-hover");
        }
      });
      document.addEventListener("mouseout", function (e) {
        if (e.target.closest && e.target.closest(hoverTargets)) {
          cursorDot.classList.remove("is-hover");
          cursorRing.classList.remove("is-hover");
        }
      });
    }
  }

  // ---- Mobile nav toggle ---------------------------------------------
  var navbar = document.querySelector(".navbar");
  var menuButton = document.querySelector(".menu-button");
  var navOverlay = document.querySelector(".w-nav-overlay");

  function closeNav() {
    if (navbar) navbar.classList.remove("nav-open");
    if (menuButton) menuButton.setAttribute("aria-expanded", "false");
  }

  if (menuButton && navbar) {
    menuButton.addEventListener("click", function (e) {
      e.preventDefault();
      var open = navbar.classList.toggle("nav-open");
      menuButton.setAttribute("aria-expanded", open ? "true" : "false");
    });

    if (navOverlay) {
      navOverlay.addEventListener("click", closeNav);
    }

    document.querySelectorAll(".nav-menu-wrapper a").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });

    document.addEventListener("keyup", function (e) {
      if (e.key === "Escape") closeNav();
    });
  }

  // ---- Active section highlight in nav ---------------------------------
  var sections = Array.prototype.slice.call(document.querySelectorAll("[data-nav-section]"));
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav-link-big"));
  if (sections.length && navLinks.length && "IntersectionObserver" in window) {
    var sectionObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var id = entry.target.id;
            navLinks.forEach(function (link) {
              link.classList.toggle("is-current-section", link.getAttribute("href") === "#" + id);
            });
          }
        });
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    sections.forEach(function (s) { sectionObserver.observe(s); });
  }

  // ---- Tools modal (one tool at a time, no tab clutter) ------------------
  var toolsModal = document.getElementById("tools-modal");
  var toolFrame = document.getElementById("active-tool-frame");
  var toolTitle = document.getElementById("tools-modal-title");

  document.querySelectorAll("[data-tool-src]").forEach(function (trigger) {
    trigger.addEventListener("click", function () {
      if (!toolsModal || !toolFrame) return;
      var src = trigger.getAttribute("data-tool-src");
      var title = trigger.getAttribute("data-tool-title") || "Tool";
      if (toolFrame.getAttribute("src") !== src) toolFrame.setAttribute("src", src);
      toolFrame.setAttribute("title", title);
      if (toolTitle) toolTitle.textContent = title;
      toolsModal.classList.add("is-open");
    });
  });
  document.querySelectorAll("[data-close-modal]").forEach(function (trigger) {
    trigger.addEventListener("click", function () {
      trigger.closest(".tools-modal").classList.remove("is-open");
    });
  });
  document.querySelectorAll(".tools-modal").forEach(function (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.classList.remove("is-open");
    });
  });
  document.addEventListener("keyup", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".tools-modal.is-open").forEach(function (modal) {
        modal.classList.remove("is-open");
      });
    }
  });
})();
