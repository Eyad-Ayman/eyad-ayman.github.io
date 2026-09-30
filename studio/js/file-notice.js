/* EYAD STUDIO — shown only when a Studio page is opened as a local file
 * (file://). Browsers block modules, workers, fonts and storage there, so the
 * Studio must be served over http(s): GitHub Pages or the local preview. */
/* It also applies the theme before first paint (no flash): the Studio follows
 * the portfolio's own light/dark toggle unless a Studio setting overrides it. */
(function () {
  try {
    var st = JSON.parse(localStorage.getItem('eyad-studio:settings:v2') || '{}') || {};
    var t = st.theme || 'portfolio';
    // Editors (Image / Vector / Video) use a pro dark workspace by default.
<<<<<<< HEAD
    if (/\/studio\/(image|video|vector|3d)\//.test(location.pathname)) {
=======
    if (/\/studio\/(image|video|vector)\//.test(location.pathname)) {
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
      document.documentElement.setAttribute('data-studio-editor', '');
      var ws = st.workspaceTheme || 'dark';
      if (ws === 'dark' || ws === 'light') t = ws;
    }
    if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    else if (t !== 'light' && t !== 'dark') t = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-studio-theme', t);
  } catch (e) { /* storage blocked: light */ }
  // Arriving from the portfolio's "Enter Studio" transition: the portfolio
  // closed a black curtain before navigating; open it here so it reads as one move.
  try {
    if (sessionStorage.getItem('eyad:enter') === '1') {
      sessionStorage.removeItem('eyad:enter');
      document.documentElement.classList.add('eyad-arrive');
      setTimeout(function () { document.documentElement.classList.remove('eyad-arrive'); }, 1400);
    }
  } catch (e) { /* ignore */ }
})();
<<<<<<< HEAD
/* ---- Diagnostics: keep the last errors of this session for “Report a bug”. */
(function () {
  function push(k, m, src) {
    try {
      var a = JSON.parse(sessionStorage.getItem('eyad:log') || '[]');
      a.push({ t: new Date().toISOString().slice(11, 19), k: k, m: String(m || '').slice(0, 300), s: src ? String(src).replace(location.origin, '').slice(0, 160) : '' });
      if (a.length > 120) a = a.slice(-120);
      sessionStorage.setItem('eyad:log', JSON.stringify(a));
    } catch (e) { /* storage blocked */ }
  }
  addEventListener('error', function (e) { if (e && e.message) push('error', e.message, (e.filename || '') + ':' + (e.lineno || 0)); else if (e && e.target && e.target.src) push('load', 'failed to load', e.target.src); }, true);
  addEventListener('unhandledrejection', function (e) { var r = e && e.reason; push('promise', r && (r.message || r) || 'rejected', r && r.stack ? String(r.stack).split('\n')[1] : ''); });
  var ce = console.error;
  console.error = function () { try { push('console', Array.prototype.map.call(arguments, function (x) { return x && x.message ? x.message : String(x); }).join(' ')); } catch (e) { /* ignore */ } return ce.apply(console, arguments); };
})();

/* ---- Phones: optional full desktop interface (Settings ▸ Layout ▸ Desktop interface on phones). */
(function () {
  try {
    var st = JSON.parse(localStorage.getItem('eyad-studio:settings:v2') || '{}') || {};
    if (st.forceDesktop && Math.min(screen.width, screen.height) < 820) {
      var m = document.querySelector('meta[name="viewport"]');
      if (m) m.setAttribute('content', 'width=1280, viewport-fit=cover');
      document.documentElement.classList.add('xp-force-desktop');
    }
  } catch (e) { /* ignore */ }
})();

/* ---- Launch screen: shown when the installed app starts (or always / never, from Settings). */
(function () {
  if (location.protocol === 'file:') return;
  var st = {};
  try { st = JSON.parse(localStorage.getItem('eyad-studio:settings:v2') || '{}') || {}; } catch (e) { /* ignore */ }
  var mode = st.splash || 'installed';
  var standalone = window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: window-controls-overlay), (display-mode: minimal-ui)').matches || navigator.standalone === true;
  var force = /[?&]splash=1\b/.test(location.search);
  if (!force && (mode === 'never' || (mode === 'installed' && !standalone))) return;
  var m = location.pathname.match(/\/studio\/(image|vector|video|3d|camera|templates|projects|settings|help)\//);
  var app = m ? m[1] : 'home';
  var key = 'eyad:splash:' + app;
  try { if (!force && sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
  var INFO = {
    home: ['EYAD', 'EXPERIENCE', '#d02b2a', 'Creative suite'], image: ['EYAD', 'IMAGE', '#ff5a4e', 'Photo & design'], vector: ['EYAD', 'VECTOR', '#f59e0b', 'Vector design'],
    video: ['EYAD', 'VIDEO', '#8b5cf6', 'Video editing'], '3d': ['EYAD', '3D', '#2dd4bf', '3D scenes'], camera: ['EYAD', 'CAMERA', '#e5e5e5', 'Film camera'],
    templates: ['EYAD', 'TEMPLATES', '#e9a23b', 'Design templates'], projects: ['EYAD', 'PROJECTS', '#60a5fa', 'Your work'], settings: ['EYAD', 'SETTINGS', '#9ca3af', 'Preferences'], help: ['EYAD', 'HELP', '#34d399', 'Guides']
  }[app];
  var LINES = ['Initializing workspace…', 'Reading preferences…', 'Loading tools…', 'Preparing brushes and filters…', 'Warming up the GPU…', 'Opening your projects…', 'Almost ready…'];
  var css = '#eyad-splash{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;background:#0b0b0c;color:#f3ede1;font:500 13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;transition:opacity .45s ease;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}'
    + '#eyad-splash.is-out{opacity:0;pointer-events:none}'
    + '#eyad-splash .sp{position:relative;width:min(720px,92vw);aspect-ratio:16/10;max-height:86vh;display:grid;grid-template-columns:1.05fr 1fr;border-radius:14px;overflow:hidden;background:#141416;box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.06)}'
    + '#eyad-splash .art{position:relative;overflow:hidden;background:#0b0b0c}'
    + '#eyad-splash .art i{position:absolute;border-radius:50%;filter:blur(28px);opacity:.9;animation:eyspl 6s ease-in-out infinite alternate}'
    + '#eyad-splash .art i:nth-child(1){width:70%;height:70%;left:-12%;top:-10%;background:var(--c)}'
    + '#eyad-splash .art i:nth-child(2){width:60%;height:60%;right:-18%;bottom:-12%;background:#f3ede1;opacity:.5;animation-delay:-2s}'
    + '#eyad-splash .art i:nth-child(3){width:40%;height:40%;left:30%;top:40%;background:#d02b2a;opacity:.7;animation-delay:-4s}'
    + '#eyad-splash .art b{position:absolute;inset:0;background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 1px,transparent 1px 3px);mix-blend-mode:multiply}'
    + '#eyad-splash .art u{position:absolute;left:18px;bottom:16px;font:700 10px/1 system-ui;letter-spacing:.2em;text-transform:uppercase;text-decoration:none;color:rgba(243,237,225,.7)}'
    + '#eyad-splash .txt{display:flex;flex-direction:column;justify-content:space-between;padding:28px 28px 22px}'
    + '#eyad-splash .mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(#2a2a2e,#070708);display:grid;place-items:center;box-shadow:0 0 0 1px rgba(255,255,255,.12)}'
    + '#eyad-splash .mark span{font:700 22px/1 Oswald,"Studio Oswald",Impact,sans-serif;color:#f3ede1}'
    + '#eyad-splash h1{margin:18px 0 0;font:700 clamp(34px,6vw,56px)/.9 Oswald,"Studio Oswald",Impact,"Arial Narrow",sans-serif;letter-spacing:.01em;text-transform:uppercase}'
    + '#eyad-splash h1 em{display:block;font-style:normal;color:var(--c)}'
    + '#eyad-splash .sub{margin-top:8px;color:rgba(243,237,225,.55);font-size:12px;letter-spacing:.06em;text-transform:uppercase}'
    + '#eyad-splash .st{color:rgba(243,237,225,.7);font-size:12px;min-height:1.4em}'
    + '#eyad-splash .bar{height:2px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;margin:8px 0 14px}'
    + '#eyad-splash .bar i{display:block;height:100%;width:8%;background:var(--c);transition:width .5s ease}'
    + '#eyad-splash small{display:block;color:rgba(243,237,225,.38);font-size:10.5px;line-height:1.5}'
    + '@keyframes eyspl{to{transform:translate(8%,6%) scale(1.12)}}'
    + '@media (max-width:620px),(orientation:portrait) and (max-width:900px){#eyad-splash .sp{grid-template-columns:1fr;grid-template-rows:42% 1fr;aspect-ratio:auto;height:min(560px,84vh)}}'
    + '@media (prefers-reduced-motion:reduce){#eyad-splash .art i{animation:none}}';
  var style = document.createElement('style'); style.textContent = css;
  var root = document.createElement('div'); root.id = 'eyad-splash'; root.setAttribute('role', 'status'); root.setAttribute('aria-label', 'Loading EYAD ' + INFO[1]);
  root.style.setProperty('--c', INFO[2]);
  root.innerHTML = '<div class="sp"><div class="art"><i></i><i></i><i></i><b></b><u>Artwork · Eyad Ayman</u></div><div class="txt"><div><div class="mark"><span>E</span></div><h1>' + INFO[0] + '<em>' + INFO[1] + '</em></h1><div class="sub">' + INFO[3] + ' · EYAD Experience 3.0</div></div><div><div class="st">' + LINES[0] + '</div><div class="bar"><i></i></div><small>© ' + new Date().getFullYear() + ' Eyad Ayman. All rights reserved.<br>Runs on this device — your files are never uploaded.</small></div></div></div>';
  document.documentElement.appendChild(style); document.documentElement.appendChild(root);
  var st2 = root.querySelector('.st'), bar = root.querySelector('.bar i'), n = 0, t0 = Date.now();
  var iv = setInterval(function () { n = Math.min(LINES.length - 1, n + 1); st2.textContent = LINES[n]; bar.style.width = Math.min(92, 8 + n * 14) + '%'; }, 420);
  var gone = false;
  function hide() {
    if (gone) return; gone = true;
    var wait = Math.max(0, 1500 - (Date.now() - t0));
    setTimeout(function () { clearInterval(iv); bar.style.width = '100%'; st2.textContent = 'Ready'; setTimeout(function () { root.classList.add('is-out'); setTimeout(function () { root.remove(); style.remove(); }, 500); }, 180); }, wait);
  }
  window.addEventListener('eyad:ready', hide);
  window.addEventListener('load', function () { setTimeout(hide, 350); });
  setTimeout(hide, 7000);
})();

=======
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
(function () {
  if (location.protocol !== 'file:') return;
  function show() {
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0b0d;color:#ecebe8;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif';
    var inner = document.createElement('div');
    inner.style.cssText = 'max-width:560px';
    var h = document.createElement('h1');
    h.textContent = 'EYAD STUDIO needs to be served, not opened as a file';
    h.style.cssText = 'font-size:24px;margin:0 0 12px;letter-spacing:.02em';
    var p1 = document.createElement('p');
    p1.textContent = 'You opened this page directly from your disk (file://). Browsers block JavaScript modules, workers, fonts and local storage on file pages, so the Studio (and the portfolio gallery feeds) cannot start.';
    var p2 = document.createElement('p');
    p2.textContent = 'To preview on your computer: go to the site folder and double-click “Preview locally (Windows).bat” (Mac/Linux: run local-preview/preview-mac-linux.sh). It opens http://localhost:8080/ in your browser. Once pushed to GitHub Pages it works at https://eyad-ayman.github.io/studio/ with nothing else to do.';
    inner.appendChild(h); inner.appendChild(p1); inner.appendChild(p2);
    box.appendChild(inner);
    document.body.appendChild(box);
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
