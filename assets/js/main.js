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
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
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
