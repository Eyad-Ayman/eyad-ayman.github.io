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
  var NAMES = { home: 'Studio', image: 'Image', vector: 'Vector', video: 'Video', '3d': '3D', camera: 'Kamera', templates: 'Templates', projects: 'Projects', settings: 'Settings', help: 'Help' };
  var dark = document.documentElement.getAttribute('data-studio-theme') !== 'light';
  var ink = dark ? '#f5f5f7' : '#16161a', dim = dark ? 'rgba(245,245,247,.55)' : 'rgba(22,22,26,.55)';
  // The launch screen is only the brand, briefly — it never waits on fake steps.
  var css = '#eyad-splash{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;background:' + (dark ? '#0b0b10' : '#ececf0') + ';color:' + ink + ';transition:opacity .35s ease;font-family:"Studio Inter",Inter,system-ui,-apple-system,"Segoe UI",sans-serif}'
    + '#eyad-splash.is-out{opacity:0;pointer-events:none}'
    + '#eyad-splash .in{display:grid;justify-items:center;gap:18px;animation:eyin .5s cubic-bezier(.2,.8,.2,1) both}'
    + '#eyad-splash .mark{width:84px;height:84px;border-radius:26px;background:linear-gradient(#fff,#fff) 24px 23px/36px 8px no-repeat,linear-gradient(#fff,#fff) 24px 38px/23px 8px no-repeat,linear-gradient(#fff,#fff) 24px 53px/36px 8px no-repeat,linear-gradient(145deg,#ff6a4d,#e8261f 55%,#b3121a);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 18px 40px -10px rgba(232,38,31,.6)}'
    + '#eyad-splash b{font:700 30px/1 "Studio Oswald",Oswald,Impact,"Arial Narrow",sans-serif;letter-spacing:.06em}'
    + '#eyad-splash b em{font:500 12px/1 "Studio Inter",Inter,system-ui,sans-serif;letter-spacing:.3em;margin-left:10px;color:' + dim + ';font-style:normal;vertical-align:middle}'
    + '#eyad-splash i{display:block;width:120px;height:3px;border-radius:3px;overflow:hidden;background:' + (dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)') + '}'
    + '#eyad-splash i::after{content:"";display:block;width:40%;height:100%;border-radius:3px;background:#ff3b2f;animation:eybar .9s ease-in-out infinite alternate}'
    + '@keyframes eybar{from{transform:translateX(-20%)}to{transform:translateX(170%)}}'
    + '@keyframes eyin{from{opacity:0;transform:scale(.94)}}'
    + '@media (prefers-reduced-motion:reduce){#eyad-splash .in,#eyad-splash i::after{animation:none}}';
  var style = document.createElement('style'); style.textContent = css;
  var root = document.createElement('div'); root.id = 'eyad-splash'; root.setAttribute('role', 'status'); root.setAttribute('aria-label', 'Opening EYAD ' + NAMES[app]);
  var inner = document.createElement('div'); inner.className = 'in';
  var mark = document.createElement('div'); mark.className = 'mark';
  var word = document.createElement('b'); word.textContent = 'EYAD'; var em = document.createElement('em'); em.textContent = NAMES[app].toUpperCase(); word.appendChild(em);
  inner.appendChild(mark); inner.appendChild(word); inner.appendChild(document.createElement('i')); root.appendChild(inner);
  document.documentElement.appendChild(style); document.documentElement.appendChild(root);
  var gone = false, t0 = Date.now();
  function hide() {
    if (gone) return; gone = true;
    setTimeout(function () { root.classList.add('is-out'); setTimeout(function () { root.remove(); style.remove(); }, 380); }, Math.max(0, 450 - (Date.now() - t0)));
  }
  window.addEventListener('eyad:ready', hide);
  document.addEventListener('DOMContentLoaded', function () { setTimeout(hide, 900); });
  window.addEventListener('load', hide);
  setTimeout(hide, 2500);
})();

/* ---- Start-up watchdog: if the app never reports ready (a script failed to load, or an old browser), say so
 * instead of leaving a dead screen. Shows the first error so it can be reported. */
(function () {
  if (location.protocol === 'file:') return;
  var ready = false, firstErr = '';
  window.addEventListener('eyad:ready', function () { ready = true; });
  window.addEventListener('error', function (e) { if (!firstErr) firstErr = (e && e.message) ? e.message + (e.filename ? ' — ' + String(e.filename).split('/').slice(-2).join('/') + ':' + (e.lineno || 0) : '') : (e && e.target && e.target.src ? 'Could not load ' + String(e.target.src).split('/').slice(-2).join('/') : ''); }, true);
  window.addEventListener('unhandledrejection', function (e) { if (!firstErr && e && e.reason) firstErr = String(e.reason && e.reason.message || e.reason).slice(0, 200); });
  function show() {
    if (ready || document.getElementById('eyad-boot-fail')) return;
    var box = document.createElement('div'); box.id = 'eyad-boot-fail'; box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483000;max-width:520px;margin:0 auto;padding:16px 18px;border-radius:22px;background:#17171c;color:#f5f5f7;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.12)';
    var t = document.createElement('b'); t.textContent = 'EYAD Studio is taking too long to start'; t.style.display = 'block';
    var p = document.createElement('div'); p.style.cssText = 'opacity:.75;margin:4px 0 12px;font-size:13px;word-break:break-word';
    p.textContent = firstErr ? 'Error: ' + firstErr : (navigator.onLine === false ? 'You are offline and this screen is not saved on the device yet.' : 'The connection may be slow, or this browser is too old (Safari 16+, Chrome 110+).');
    var r = document.createElement('button'); r.type = 'button'; r.textContent = 'Reload';
    r.style.cssText = 'height:38px;padding:0 18px;border:0;border-radius:999px;background:#f5f5f7;color:#111;font:600 14px system-ui;margin-right:8px';
    r.onclick = function () { try { if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(function (l) { l.forEach(function (x) { x.update(); }); }); } catch (e) { /* ignore */ } location.reload(); };
    var w = document.createElement('button'); w.type = 'button'; w.textContent = 'Keep waiting';
    w.style.cssText = 'height:38px;padding:0 18px;border:0;border-radius:999px;background:rgba(255,255,255,.12);color:#f5f5f7;font:600 14px system-ui';
    w.onclick = function () { box.remove(); setTimeout(show, 15000); };
    box.appendChild(t); box.appendChild(p); box.appendChild(r); box.appendChild(w);
    (document.body || document.documentElement).appendChild(box);
    window.addEventListener('eyad:ready', function () { box.remove(); });
  }
  setTimeout(show, 12000);
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
