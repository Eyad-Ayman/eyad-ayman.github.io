// "Catch The Palette" — a tiny canvas game, reached via the homepage
// easter egg (click "EYAD AYMAN" 5 times fast). Not linked from the main
// nav on purpose — it's a hidden bonus, not a core feature of the site.
(function () {
  "use strict";

  var modal = document.getElementById("game-modal");
  var openBtn = document.getElementById("egg-toast-play");
  var closeBtn = document.getElementById("game-modal-close");
  var canvas = document.getElementById("game-canvas");
  var scoreEl = document.getElementById("game-score");
  var livesEl = document.getElementById("game-lives");
  var overScreen = document.getElementById("game-over-screen");
  var finalScoreEl = document.getElementById("game-final-score");
  var bestScoreEl = document.getElementById("game-best-score");
  var retryBtn = document.getElementById("game-retry");

  if (!modal || !canvas) return;
  var ctx = canvas.getContext("2d");

  var W = canvas.width;
  var H = canvas.height;
  var PADDLE_W = 74;
  var PADDLE_H = 14;

  var paddleX = W / 2 - PADDLE_W / 2;
  var drops = [];
  var score = 0;
  var lives = 3;
  var running = false;
  var rafId = null;
  var spawnTimer = 0;
  var spawnInterval = 70; // frames between spawns, decreases over time
  var frame = 0;

  var colors = ["#d02b2a", "#111111", "#888888"];

  function bestScore() {
    var v = 0;
    try { v = parseInt(localStorage.getItem("catchPaletteBest") || "0", 10) || 0; } catch (e) {}
    return v;
  }
  function saveBest(v) {
    try { localStorage.setItem("catchPaletteBest", String(v)); } catch (e) {}
  }

  function resetGame() {
    paddleX = W / 2 - PADDLE_W / 2;
    drops = [];
    score = 0;
    lives = 3;
    spawnTimer = 0;
    spawnInterval = 70;
    frame = 0;
    scoreEl.textContent = "0";
    livesEl.textContent = "3";
    overScreen.classList.remove("is-visible");
  }

  function spawnDrop() {
    var isRed = Math.random() < 0.65; // most drops are the "correct" red accent
    drops.push({
      x: 16 + Math.random() * (W - 32),
      y: -16,
      r: 10,
      speed: 2 + Math.random() * 1.5 + frame / 1800,
      color: isRed ? colors[0] : colors[Math.floor(1 + Math.random() * 2)],
      isRed: isRed
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // paper-ish backdrop
    ctx.fillStyle = "#ece9e2";
    ctx.fillRect(0, 0, W, H);

    // paddle
    ctx.fillStyle = "#111";
    ctx.fillRect(paddleX, H - 34, PADDLE_W, PADDLE_H);

    // drops
    drops.forEach(function (d) {
      ctx.beginPath();
      ctx.rect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
    });
  }

  function update() {
    frame++;
    spawnTimer++;
    if (spawnTimer >= spawnInterval) {
      spawnTimer = 0;
      spawnDrop();
      if (spawnInterval > 30) spawnInterval -= 0.6;
    }

    for (var i = drops.length - 1; i >= 0; i--) {
      var d = drops[i];
      d.y += d.speed;

      var paddleTop = H - 34;
      var hitsPaddle =
        d.y + d.r >= paddleTop &&
        d.y - d.r <= paddleTop + PADDLE_H &&
        d.x + d.r >= paddleX &&
        d.x - d.r <= paddleX + PADDLE_W;

      if (hitsPaddle) {
        drops.splice(i, 1);
        if (d.isRed) {
          score += 10;
          scoreEl.textContent = String(score);
        } else {
          loseLife();
        }
        continue;
      }

      if (d.y - d.r > H) {
        drops.splice(i, 1);
        if (d.isRed) loseLife();
      }
    }
  }

  function loseLife() {
    lives--;
    livesEl.textContent = String(lives);
    if (lives <= 0) {
      endGame();
    }
  }

  function endGame() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    var best = bestScore();
    if (score > best) {
      best = score;
      saveBest(best);
    }
    finalScoreEl.textContent = String(score);
    bestScoreEl.textContent = String(best);
    overScreen.classList.add("is-visible");
  }

  function loop() {
    if (!running) return;
    update();
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function startGame() {
    resetGame();
    running = true;
    loop();
  }

  function pointerToPaddle(clientX) {
    var rect = canvas.getBoundingClientRect();
    var scale = W / rect.width;
    var x = (clientX - rect.left) * scale;
    paddleX = Math.max(0, Math.min(W - PADDLE_W, x - PADDLE_W / 2));
  }

  canvas.addEventListener("mousemove", function (e) {
    pointerToPaddle(e.clientX);
  });
  canvas.addEventListener(
    "touchmove",
    function (e) {
      if (e.touches && e.touches[0]) {
        pointerToPaddle(e.touches[0].clientX);
        e.preventDefault();
      }
    },
    { passive: false }
  );

  if (openBtn) {
    openBtn.addEventListener("click", function () {
      var eggToast = document.getElementById("egg-toast");
      if (eggToast) eggToast.classList.remove("is-visible");
      modal.classList.add("is-open");
      startGame();
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      modal.classList.remove("is-open");
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    });
  }
  modal.addEventListener("click", function (e) {
    if (e.target === modal) {
      modal.classList.remove("is-open");
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }
  });
  if (retryBtn) {
    retryBtn.addEventListener("click", startGame);
  }
  document.addEventListener("keyup", function (e) {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      modal.classList.remove("is-open");
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }
  });

  draw();
})();
