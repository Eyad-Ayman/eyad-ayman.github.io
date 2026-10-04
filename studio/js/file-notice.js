/* EYAD STUDIO — shown only when a Studio page is opened as a local file
 * (file://). Browsers block modules, workers, fonts and storage there, so the
 * Studio must be served over http(s): GitHub Pages or the local preview. */
/* It also applies the theme before first paint (no flash): the Studio follows
 * the portfolio's own light/dark toggle unless a Studio setting overrides it. */
(function () {
  try {
    var st = JSON.parse(localStorage.getItem('eyad-studio:settings:v2') || '{}') || {};
    var t = st.theme || 'portfolio';
    // Editors follow the colour mode (Settings ▸ Look ▸ Editors), or keep the dark glass workspace.
    var look = st.editorLook === 'studio' ? 'studio' : 'theme';
    document.documentElement.setAttribute('data-editor-look', look);
    if (/\/studio\/(image|video|vector|3d)\//.test(location.pathname)) {
      document.documentElement.setAttribute('data-studio-editor', '');
      if (look === 'theme') t = ({ night: 1, cobalt: 1, forest: 1 })[st.poster] ? 'dark' : 'light';
      else { var ws = st.workspaceTheme || 'dark'; if (ws === 'dark' || ws === 'light') t = ws; }
    }
    if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    else if (t !== 'light' && t !== 'dark') t = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-studio-theme', t);
    // home / hub colour mode (poster look)
    document.documentElement.setAttribute('data-poster', /^[a-z]{2,12}$/.test(st.poster || '') ? st.poster : 'signal');
    var FRAME = { signal: '#f4260f', night: '#0b0b0b', redroom: '#f4260f', ink: '#0d0d0d', cobalt: '#0d0d0d', sun: '#ff7a1a', forest: '#1f3a2e', lime: '#0d0d0d', blush: '#d0142c', royal: '#1b3fd6', mono: '#ffffff', clay: '#8c2f1b' };
    window.__eyadBar = function () {
      var cam = /\/studio\/camera\//.test(location.pathname), studioLook = document.documentElement.getAttribute('data-editor-look') === 'studio' && /\/studio\/(image|video|vector|3d)\//.test(location.pathname);
      var col = cam ? '#000000' : studioLook ? '#0b0b10' : (FRAME[document.documentElement.getAttribute('data-poster')] || '#f4260f');
      var m = document.querySelector('meta[name="theme-color"]');
      if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
      m.setAttribute('content', col);
    };
    window.__eyadBar();
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
/* ---- The real visible height. iPhone Safari's bars and the installed app make 100vh / fixed inset:0 taller than
 * what is on screen, which cut the bottom of the editors and the camera. Every full-screen layout uses --app-h. */
(function () {
  var de = document.documentElement, last = 0;
  var standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
  var ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function set() {
    var hgt = window.innerHeight || de.clientHeight;
    // Installed on iPhone: the page covers the whole screen (viewport-fit=cover), but innerHeight is often
    // reported short or stale right after launch / rotation. The screen size is the truth there.
    if (ios && standalone && window.screen) {
      var sw = screen.width, sh = screen.height, land = window.innerWidth > window.innerHeight;
      var full = land ? Math.min(sw, sh) : Math.max(sw, sh);
      if (full && Math.abs(full - hgt) < 140) hgt = full;
    }
    if (!hgt || hgt === last) return; last = hgt;
    de.style.setProperty('--app-h', hgt + 'px');
  }
  set();
  window.addEventListener('resize', set);
  window.addEventListener('orientationchange', function () { setTimeout(set, 60); setTimeout(set, 400); });
  window.addEventListener('pageshow', set);
  document.addEventListener('DOMContentLoaded', set);
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

/* ---- Opening animation: the EYAD® poster. Red sheet, the name rises letter by letter, then the sheet lifts
 * like a curtain. Shown when the installed app starts and once per browser session (Settings can turn it off). */
(function () {
  if (location.protocol === 'file:') return;
  var st = {};
  try { st = JSON.parse(localStorage.getItem('eyad-studio:settings:v2') || '{}') || {}; } catch (e) { /* ignore */ }
  var mode = st.splash || 'installed';
  var standalone = window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: window-controls-overlay), (display-mode: minimal-ui)').matches || navigator.standalone === true;
  var force = /[?&]splash=1\b/.test(location.search);
  if (!force && (mode === 'never' || navigator.webdriver)) return;
  var m = location.pathname.match(/\/studio\/(image|vector|video|3d|camera|templates|projects|settings|help)\//);
  var app = m ? m[1] : 'home';
  // once per session in the browser; once per app per session when installed (or "always")
  var key = (standalone || mode === 'always') ? 'eyad:splash:' + app : 'eyad:splash:any';
  try { if (!force && sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
  var NAMES = { home: 'Studio', image: 'Image', vector: 'Vector', video: 'Video', '3d': '3D', camera: 'Kamera', templates: 'Templates', projects: 'Projects', settings: 'Settings', help: 'Help' };
  var base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/js\/file-notice\.js.*$/, '') : '/studio/';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var css = '@font-face{font-family:"Splash AB";font-display:block;src:url("' + base + 'fonts/archivo-black-latin-400-normal.woff2") format("woff2")}'
    + '#eyad-splash{position:fixed;inset:0;z-index:2147483600;background:#f4260f;color:#0d0d0d;display:grid;grid-template-rows:auto 1fr auto;padding:calc(16px + env(safe-area-inset-top,0px)) 20px calc(16px + env(safe-area-inset-bottom,0px));overflow:hidden;transition:transform .55s cubic-bezier(.7,0,.2,1);font:400 10.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-transform:uppercase;letter-spacing:.05em}'
    + '#eyad-splash.is-out{transform:translateY(-101%)}'
    + '#eyad-splash .r{display:flex;justify-content:space-between;gap:12px}'
    + '#eyad-splash .w{align-self:center;justify-self:center;display:flex;font:400 min(31vw,46vh)/.8 "Splash AB",Impact,"Arial Black",sans-serif;letter-spacing:-.075em;overflow:hidden;padding:.04em .04em .02em 0}'
    + '#eyad-splash .w span{display:block;transform:translateY(105%);animation:eyup .6s cubic-bezier(.2,.8,.2,1) forwards}'
    + '#eyad-splash .w span:nth-child(2){animation-delay:.07s}#eyad-splash .w span:nth-child(3){animation-delay:.14s}#eyad-splash .w span:nth-child(4){animation-delay:.21s}'
    + '#eyad-splash .w sup{font-size:.1em;letter-spacing:0;align-self:flex-start;margin:.5em 0 0 .6em;opacity:0;animation:eyfade .3s .55s forwards}'
    + '#eyad-splash .b{height:2px;background:rgba(13,13,13,.25);margin-bottom:10px;overflow:hidden}#eyad-splash .b i{display:block;height:100%;width:100%;background:#0d0d0d;transform:translateX(-100%);animation:eybar 1.1s cubic-bezier(.4,0,.2,1) forwards}'
    + '@keyframes eyup{to{transform:none}}@keyframes eyfade{to{opacity:1}}@keyframes eybar{to{transform:none}}'
    + '@media (prefers-reduced-motion:reduce){#eyad-splash .w span,#eyad-splash .w sup,#eyad-splash .b i{animation:none;transform:none;opacity:1}#eyad-splash{transition:opacity .3s}#eyad-splash.is-out{transform:none;opacity:0}}';
  var style = document.createElement('style'); style.textContent = css;
  var root = document.createElement('div'); root.id = 'eyad-splash'; root.setAttribute('role', 'status'); root.setAttribute('aria-label', 'Opening EYAD ' + NAMES[app]);
  function row(a, b2) { var r = document.createElement('div'); r.className = 'r'; var x = document.createElement('span'); x.textContent = a; var y = document.createElement('span'); y.textContent = b2; r.appendChild(x); r.appendChild(y); return r; }
  var w = document.createElement('div'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
  'EYAD'.split('').forEach(function (ch) { var sp = document.createElement('span'); sp.textContent = ch; w.appendChild(sp); });
  var sup = document.createElement('sup'); sup.textContent = '®'; w.appendChild(sup);
  var foot = document.createElement('div'); var bar = document.createElement('div'); bar.className = 'b'; bar.appendChild(document.createElement('i')); foot.appendChild(bar);
  foot.appendChild(row('Made by Eyad Ayman — Cairo', 'Runs on your device'));
  root.appendChild(row('EYAD®Studio', NAMES[app] + ' — vol. 5')); root.appendChild(w); root.appendChild(foot);
  document.documentElement.appendChild(style); document.documentElement.appendChild(root);
  var gone = false, t0 = Date.now(), MIN = reduce ? 300 : 1150;
  function hide() {
    if (gone) return; gone = true;
    setTimeout(function () { root.classList.add('is-out'); setTimeout(function () { root.remove(); style.remove(); }, 600); }, Math.max(0, MIN - (Date.now() - t0)));
  }
  window.addEventListener('eyad:ready', hide);
  window.addEventListener('load', hide);
  setTimeout(hide, 3000);
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
