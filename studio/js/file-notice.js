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
    if (/\/studio\/(image|video|vector|3d)\//.test(location.pathname)) {
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
  var NAMES = { home: 'Studio', image: 'Image', vector: 'Vector', video: 'Video', '3d': '3D', camera: 'Camera', templates: 'Templates', projects: 'Projects', settings: 'Settings', help: 'Help' };
  var SUBS = { home: 'Creative suite', image: 'Photo & design', vector: 'Vector design', video: 'Video editing', '3d': '3D scenes', camera: 'Film camera', templates: 'Design templates', projects: 'Your work', settings: 'Preferences', help: 'Guides' };
  var INFO = ['EYAD', NAMES[app], '#9ec2ff', SUBS[app]];
  var base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/js\/file-notice\.js.*$/, '') : '/studio/';
  var dark = document.documentElement.getAttribute('data-studio-theme') !== 'light';
  var wall = base + 'img/wall-' + (dark ? 'dark' : 'light') + '.webp';
  var ink = dark ? '#f5f5f7' : '#1c1c1f', dim = dark ? 'rgba(245,245,247,.6)' : 'rgba(28,28,31,.58)';
  var LINES = ['Initializing workspace…', 'Reading preferences…', 'Loading tools…', 'Preparing brushes and filters…', 'Warming up the GPU…', 'Opening your projects…', 'Almost ready…'];
  var css = '#eyad-splash{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;overflow:hidden;background:' + (dark ? '#16171b' : '#dcdde1') + ' url("' + wall + '") center/cover;color:' + ink + ';font:500 13px/1.4 "Studio Inter",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;transition:opacity .5s ease,transform .5s ease;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}'
    + '#eyad-splash.is-out{opacity:0;transform:scale(1.03);pointer-events:none}'
    + '#eyad-splash .arc{position:absolute;left:50%;top:50%;width:0;height:0}'
    + '#eyad-splash .arc i{position:absolute;width:86px;height:86px;margin:-43px;border-radius:26px;background:var(--g);box-shadow:0 18px 40px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.45);transform:rotate(var(--a)) translateY(-300px) rotate(calc(-1 * var(--a)));opacity:0;animation:eyarc .9s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:var(--d)}'
    + '#eyad-splash .sp{position:relative;width:min(420px,88vw);padding:30px 30px 22px;border-radius:34px;background:' + (dark ? 'rgba(40,40,46,.42)' : 'rgba(255,255,255,.45)') + ';-webkit-backdrop-filter:blur(40px) saturate(1.8);backdrop-filter:blur(40px) saturate(1.8);box-shadow:0 30px 80px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,' + (dark ? '.22' : '.8') + '),inset 0 0 0 1px rgba(255,255,255,' + (dark ? '.1' : '.45') + ');text-align:center;animation:eyin .7s cubic-bezier(.2,.8,.2,1)}'
    + '#eyad-splash .mark{width:58px;height:58px;margin:0 auto;border-radius:19px;display:grid;place-items:center;background:linear-gradient(135deg,#f5f6fa,#9ea4b4 30%,#fdfdff 48%,#6e7382 62%,#d9dce6 80%,#8a90a0);box-shadow:0 10px 24px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.8)}'
    + '#eyad-splash .mark span{font:800 30px/1 "Studio Inter",Inter,system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.35)}'
    + '#eyad-splash h1{margin:16px 0 0;font:600 30px/1.1 "Studio Inter",Inter,system-ui,sans-serif;letter-spacing:-.02em}'
    + '#eyad-splash h1 em{font-style:normal;font-weight:300;opacity:.75}'
    + '#eyad-splash .sub{margin-top:4px;color:' + dim + ';font-size:13px}'
    + '#eyad-splash .st{margin-top:22px;color:' + dim + ';font-size:12px;min-height:1.4em}'
    + '#eyad-splash .bar{height:5px;margin:8px auto 16px;width:70%;border-radius:5px;overflow:hidden;background:' + (dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)') + '}'
    + '#eyad-splash .bar i{display:block;height:100%;width:8%;border-radius:5px;background:linear-gradient(90deg,#9ae8ff,#e9b8ff,#ffe69a);transition:width .5s ease}'
    + '#eyad-splash small{display:block;color:' + dim + ';opacity:.8;font-size:10.5px;line-height:1.5}'
    + '@keyframes eyarc{from{opacity:0;transform:rotate(var(--a)) translateY(-240px) rotate(calc(-1 * var(--a))) scale(.6)}to{opacity:1}}'
    + '@keyframes eyin{from{opacity:0;transform:translateY(14px) scale(.97)}}'
    + '@media (max-width:620px){#eyad-splash .arc i{width:58px;height:58px;margin:-29px;border-radius:18px;transform:rotate(var(--a)) translateY(-230px) rotate(calc(-1 * var(--a)))}}'
    + '@media (prefers-reduced-motion:reduce){#eyad-splash .arc i,#eyad-splash .sp{animation:none;opacity:1}}';
  var G = ['linear-gradient(135deg,#ff9a8b,#ff6a88)', 'linear-gradient(135deg,#b7f0ff,#e9b8ff,#fff3b0)', 'linear-gradient(135deg,#ffb6d8,#f49ac1)', 'linear-gradient(135deg,#2b2b30,#0a0a0c)', 'linear-gradient(135deg,#e9ebee,#9ea2a8)', 'linear-gradient(135deg,#f6cf3e,#e8402f)', 'linear-gradient(135deg,#eef1f6,#c8d3e6)', 'linear-gradient(135deg,#a4a4a0,#6d6d69)', 'linear-gradient(135deg,#7cb8ff,#3a5bd8)'];
  var arc = ''; for (var k = 0; k < 9; k++) arc += '<i style="--a:' + (-80 + k * 20) + 'deg;--g:' + G[k] + ';--d:' + (k * 0.06).toFixed(2) + 's"></i>';
  var style = document.createElement('style'); style.textContent = css;
  var root = document.createElement('div'); root.id = 'eyad-splash'; root.setAttribute('role', 'status'); root.setAttribute('aria-label', 'Loading EYAD ' + INFO[1]);
  root.style.setProperty('--c', INFO[2]);
  root.innerHTML = '<div class="arc">' + arc + '</div><div class="sp"><div class="mark"><span>E</span></div><h1>' + INFO[0] + ' <em>' + INFO[1] + '</em></h1><div class="sub">' + INFO[3] + ' · EYAD Studio 4.0</div><div class="st">' + LINES[0] + '</div><div class="bar"><i></i></div><small>© ' + new Date().getFullYear() + ' Eyad Ayman · Runs on this device — your files are never uploaded.</small></div>';
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
