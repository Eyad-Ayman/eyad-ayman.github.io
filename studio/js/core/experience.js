// EYAD Studio — the layer that makes the Studio feel like one installed
// app suite: window controls, the Dock, the guided tour, bug reports, the
// install guide and the offline pack.
import { h, clear, formatBytes } from './dom.js';
import { icon } from './icons.js';
import { dialog, toast } from './ui.js';
import { getSettings, setSetting } from './settings.js';
import { appIcon, APPS } from './appicons.js';

const ROOT = new URL('../../', import.meta.url);
const route = (k) => (k === 'home' ? ROOT.href : k === 'portfolio' ? new URL('../', ROOT).href : new URL('./' + k + '/', ROOT).href);
export const VERSION = '5.0';
const BUG_MAIL = 'eyad.ayman2019@gmail.com';

export const isStandalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: window-controls-overlay), (display-mode: minimal-ui)').matches || navigator.standalone === true;
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(navigator.userAgent);

// ------------------------------------------------------------------ help menu (all apps)

export function experienceHelp(appId) {
  return [
    { separator: true },
    { label: 'Take the Tour', action: () => startTour(appId, { force: true }), icon: 'compass' },
    { label: 'Report a Bug…', action: () => bugReportDialog(appId), icon: 'bug' },
    { label: 'Install as an App…', action: () => installGuide(), icon: 'install' },
    { label: 'Offline Pack…', action: () => { location.href = route('settings') + '#offline'; }, icon: 'download' },
    { label: 'EYAD Studio Home', shortcut: 'Mod+Alt+0', action: () => { location.href = route('home'); }, icon: 'dock' },
  ];
}

// ------------------------------------------------------------------ window controls (editors)

/** macOS-style window buttons: close → Experience home, minimise → Dock (home), zoom → full screen. */
export function windowControls() {
  const btn = (cls, label, glyph, fn) => h('button', { class: 'xp-wc ' + cls, type: 'button', 'aria-label': label, title: label, onclick: fn }, h('span', { 'aria-hidden': 'true', text: glyph }));
  return h('div', { class: 'xp-wcs', role: 'group', 'aria-label': 'Window' },
    btn('is-close', 'Close — back to EYAD Studio', '×', () => { location.href = route('home'); }),
    btn('is-min', 'Minimise to the Dock', '–', () => { location.href = route('home'); }),
    btn('is-zoom', 'Full screen', '+', () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => toast('Full screen is not available here.'));
    }));
}

// ------------------------------------------------------------------ Dock

const DOCK_APPS = ['image', 'vector', 'video', '3d', 'camera', 'templates'];
export function dock(current = '') {
  const item = (id) => {
    const a = APPS[id];
    return h('a', { class: 'xp-dock-item' + (current === id ? ' is-running' : ''), href: route(a.route), 'aria-label': a.name, 'data-tip': a.name, 'data-app': id }, appIcon(id, 52));
  };
  const el = h('nav', { class: 'xp-dock', 'aria-label': 'Dock' },
    h('div', { class: 'xp-dock-shelf' },
      item('home'), h('span', { class: 'xp-dock-sep', 'aria-hidden': 'true' }),
      DOCK_APPS.map(item),
      h('span', { class: 'xp-dock-sep', 'aria-hidden': 'true' }),
      item('projects'), item('settings')));
  // magnification (pointer only): neighbours grow like a real dock
  const shelf = el.firstChild;
  shelf.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    for (const it of shelf.querySelectorAll('.xp-dock-item')) {
      const r = it.getBoundingClientRect();
      const d = Math.abs(e.clientX - (r.left + r.width / 2));
      const k = Math.max(0, 1 - d / 150);
      it.style.setProperty('--m', (1 + k * 0.45).toFixed(3));
    }
  });
  shelf.addEventListener('pointerleave', () => shelf.querySelectorAll('.xp-dock-item').forEach((it) => it.style.setProperty('--m', '1')));
  return el;
}

// ------------------------------------------------------------------ install

let deferred = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
addEventListener('appinstalled', () => { deferred = null; toast('EYAD Studio is installed. Open it from your apps — it works offline.', { type: 'ok', timeout: 6000 }); });
export const canPromptInstall = () => !!deferred;

export async function installGuide() {
  if (isStandalone()) { toast('You are already using the installed app.'); return; }
  if (deferred) {
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) { /* ignore */ }
    deferred = null;
    return;
  }
  const step = (n, text, ic) => h('li', { class: 'xp-step' }, h('span', { class: 'xp-step-n', text: String(n) }), ic ? icon(ic, 18) : null, h('span', { text }));
  let steps;
  const ua = navigator.userAgent;
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|Snapchat|Twitter/i.test(ua);
  const otherIos = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  let note = 'Nothing is installed from a store and no account is needed. After installing, open Settings ▸ Offline pack once to keep every tool available without internet.';
  if (IS_IOS) {
    note = 'iPhone and iPad do not let a website install itself — Apple only allows it through the Share menu, so these taps are the only way. It takes ten seconds and then EYAD opens full screen from your Home Screen, even offline.';
    if (inApp) steps = [step(1, 'You are inside another app’s browser. Tap ⋯ (or the compass icon) and choose “Open in Safari” / “Open in browser”.', 'compass'), step(2, 'In Safari, tap the Share button — the square with an arrow pointing up, in the bar at the bottom.', 'upload'), step(3, 'Scroll down the list and tap “Add to Home Screen”, then “Add” at the top right.', 'plus'), step(4, 'Open EYAD from your Home Screen.', 'star')];
    else if (otherIos) steps = [step(1, 'Tap the Share button — the square with an arrow pointing up, at the right end of the address bar.', 'upload'), step(2, 'Scroll down the list and tap “Add to Home Screen”, then “Add”. (If it is not in the list, open this page in Safari and do the same.)', 'plus'), step(3, 'Open EYAD from your Home Screen — full screen, like an app.', 'star')];
    else steps = [step(1, 'Tap the Share button — the square with an arrow pointing up, in the middle of the bar at the bottom of Safari (on iPad: top right).', 'upload'), step(2, 'Scroll down the list and tap “Add to Home Screen”. Not there? Scroll to the end, tap “Edit Actions” and add it.', 'plus'), step(3, 'Tap “Add” at the top right.', 'check'), step(4, 'Open EYAD from your Home Screen — full screen, like an app, and it keeps working offline.', 'star')];
  }
  else if (IS_ANDROID) steps = [step(1, 'Open the browser menu (⋮ in Chrome, ≡ in Samsung Internet).'), step(2, 'Tap “Install app” or “Add to Home screen”.', 'install'), step(3, 'Open EYAD from your apps. PSD, images and videos can be shared straight into it.', 'star')];
  else steps = [step(1, 'In Chrome or Edge, click the install icon at the right end of the address bar — or open the browser menu ▸ “Install EYAD Studio…”.', 'install'), step(2, 'It opens in its own window with no browser bars, gets a Dock/Start-menu icon, and opens PSD / SVG / video files from your computer.', 'star'), step(3, 'Safari on Mac: File ▸ Add to Dock. Firefox can’t install web apps — use Chrome, Edge or Safari.', 'compass')];
  return dialog({ title: 'Install EYAD Studio', width: 480, body: h('div', { class: 'studio-stack' },
    h('div', { class: 'xp-install-hero' }, appIcon('home', 64), h('div', {}, h('b', { text: 'EYAD Studio' }), h('span', { class: 'studio-dim studio-small', text: 'Image · Vector · Video · 3D · Camera · Templates' }))),
    h('ol', { class: 'xp-steps' }, steps),
    h('p', { class: 'studio-small studio-dim', text: note }),
    IS_IOS ? h('button', { class: 'studio-btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(ROOT.href); toast('Link copied — paste it in Safari.', { type: 'ok' }); } catch (e) { toast(ROOT.href, { timeout: 8000 }); } } }, icon('link', 15), 'Copy the link') : null) });
}

// ------------------------------------------------------------------ diagnostics & bug report

export function getLogs() {
  try { return JSON.parse(sessionStorage.getItem('eyad:log') || '[]'); } catch (e) { return []; }
}
function diagnostics(appId) {
  const s = getSettings();
  const nav = navigator;
  const lines = [
    `EYAD Studio ${VERSION} · app: ${appId || 'studio'} · ${new Date().toISOString()}`,
    `Page: ${location.pathname}${location.search ? ' (with parameters)' : ''}`,
    `Browser: ${nav.userAgent}`,
    `Platform: ${nav.platform || '?'} · touch points: ${nav.maxTouchPoints || 0} · memory: ${nav.deviceMemory || '?'} GB · cores: ${nav.hardwareConcurrency || '?'}`,
    `Screen: ${screen.width}×${screen.height} @${devicePixelRatio}x · window ${innerWidth}×${innerHeight} · installed: ${isStandalone() ? 'yes' : 'no'} · online: ${nav.onLine ? 'yes' : 'no'}`,
    `WebGL: ${(() => { try { return !!document.createElement('canvas').getContext('webgl') ? 'yes' : 'no'; } catch (e) { return 'no'; } })()} · WebGPU: ${'gpu' in nav ? 'yes' : 'no'} · OffscreenCanvas: ${typeof OffscreenCanvas !== 'undefined' ? 'yes' : 'no'} · WebCodecs: ${typeof VideoEncoder !== 'undefined' ? 'yes' : 'no'}`,
    `Settings: theme=${s.theme}/${s.workspaceTheme} scale=${s.uiScale} perf=${s.performance} pen=${s.penMode} desktopUI=${s.forceDesktop}`,
  ];
  const logs = getLogs();
  lines.push('', `Recent errors (${logs.length}):`);
  for (const l of logs.slice(-40)) lines.push(`[${l.t}] ${l.k} ${l.m}${l.s ? ' @ ' + l.s : ''}`);
  return lines.join('\n');
}

export async function bugReportDialog(appId) {
  const what = h('textarea', { class: 'studio-input', rows: 4, maxLength: 3000, placeholder: 'What happened? What did you expect?', 'aria-label': 'What happened' });
  const steps = h('textarea', { class: 'studio-input', rows: 3, maxLength: 2000, placeholder: '1. Opened a PSD from Files…\n2. Tapped Layers…', 'aria-label': 'Steps' });
  const incl = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Include diagnostics' });
  const diag = diagnostics(appId);
  const pre = h('pre', { class: 'xp-diag', text: diag });
  const compose = () => `${what.value.trim() || '(no description)'}\n\nSteps:\n${steps.value.trim() || '(none)'}\n\n${incl.checked ? '---- diagnostics ----\n' + diag : '(diagnostics not included)'}`;
  const subject = () => `[EYAD ${String(appId || 'studio').toUpperCase()} bug] ${what.value.trim().split('\n')[0].slice(0, 70) || 'Report'}`;
  const body = h('div', { class: 'studio-stack xp-bug' },
    h('p', { class: 'studio-dim studio-small', text: `Goes to ${BUG_MAIL} through your own mail app — nothing is sent until you press Send there. No files or images are included.` }),
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'What happened' }), what),
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Steps (optional)' }), steps),
    h('label', { class: 'studio-field is-check' }, incl, h('span', { text: 'Include device info and recent error logs' })),
    h('details', { class: 'xp-details' }, h('summary', { text: 'See exactly what is included' }), pre));
  const v = await dialog({ title: 'Report a bug', body, width: 540, buttons: [
    { label: 'Cancel', value: null }, { label: 'Copy', value: 'copy' }, { label: 'Download .txt', value: 'txt' }, { label: 'Open mail app', value: 'mail', primary: true }] });
  if (!v) return;
  const text = compose();
  if (v === 'copy') { try { await navigator.clipboard.writeText(subject() + '\n\n' + text); toast('Report copied — paste it into an email to ' + BUG_MAIL, { type: 'ok', timeout: 5000 }); } catch (e) { toast('Copy failed — use Download instead.', { type: 'error' }); } return; }
  if (v === 'txt') { const a = h('a', { href: URL.createObjectURL(new Blob([subject() + '\n\n' + text], { type: 'text/plain' })), download: 'eyad-bug-report.txt' }); document.body.appendChild(a); a.click(); a.remove(); return; }
  // mailto: keep the URL short enough for every mail app; the full log can be attached from the .txt
  let mailBody = text;
  if (mailBody.length > 1800) mailBody = mailBody.slice(0, 1780) + '\n…(trimmed — use “Download .txt” for the full log)';
  location.href = `mailto:${BUG_MAIL}?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(mailBody)}`;
}

// ------------------------------------------------------------------ guided tour

const TOURS = {
  home: [
    { sel: '.xp-menubar', title: 'Welcome to EYAD Studio', text: 'A complete creative suite that runs on your device — in the browser or installed as an app. Nothing you open is uploaded.' },
    { sel: '.hm-apps', title: 'Your studios', text: 'IMAGE for photos and layered design, VECTOR for logos, VIDEO for editing, 3D for scenes and models, KAMERA for film looks, Y2K video and 3D photos. Keys 1–5 open them.' },
    { sel: '.hm-continue', title: 'Continue', text: 'Your latest projects, saved on this device. Start new has ready sizes, and / searches everything on this screen.' },
    { sel: '.xp-dock', title: 'The Dock', text: 'Jump between apps any time. Shortcut: Ctrl/⌘ + Alt + 1…6.' },
    { sel: '.xp-menubar-right', title: 'Install & offline', text: 'Install it like a real app (Android, iPhone, Windows, Mac) — then every tool and AI model works without internet.' },
  ],
  image: [
    { sel: '.img-menubar', title: 'Menus', text: 'Everything lives here — Adjustments, Raw Develop, Film Lab, 40+ filters, AI and Generate. Ctrl/⌘ + K searches every command.' },
    { sel: '.img-toolbar', title: 'Tools', text: 'Move, selections, brushes, heal, clone, text, shapes, pen and more. Hover a tool to see its shortcut key.' },
    { sel: '.img-options', title: 'Tool options', text: 'Size, hardness, opacity and pressure for the current tool. With a pen or tablet, pressure controls size and opacity.' },
    { sel: '.img-panels', title: 'Panels', text: 'Colour, Properties, Layers and History. Move them to the left in Settings ▸ Layout if you prefer.' },
    { sel: '.img-main', title: 'Canvas', text: 'Pinch or Ctrl + scroll to zoom, Space + drag to pan, hold R to rotate the view. Two-finger tap undoes on touch screens.' },
  ],
  vector: [
    { sel: '.img-menubar', title: 'Menus', text: 'Open SVG, PDF and .ai artwork as editable paths, combine shapes with the Shape Builder, export SVG / PDF / PNG.' },
    { sel: '.img-toolbar', title: 'Tools', text: 'Pen (P) for curves, Direct Selection (A) for points, Pencil and pressure Brush, shapes, type and gradients.' },
    { sel: '.img-panels', title: 'Appearance & layers', text: 'Fill, stroke, gradients, character settings, alignment and artboards.' },
  ],
  video: [
    { sel: '.img-menubar', title: 'Menus', text: 'Import, titles, transitions, animation presets, captions and export. Add media from Drive / Dropbox links too.' },
    { sel: '.vid-left', title: 'Media & effects', text: 'Your clips, then Titles, Transitions, Presets and Effects — click one or drag it onto a clip.' },
    { sel: '.vid-center', title: 'Program monitor', text: 'Zoom 10–400 %, drag the selected clip to move it, and turn on safe margins with the apostrophe key.' },
    { sel: '.vid-right', title: 'Properties', text: 'Every value can be animated: press the stopwatch to add keyframes at the playhead.' },
    { sel: '.vid-timeline', title: 'Timeline', text: 'J/K/L to shuttle, C razor, Q/W ripple trim, Shift+D default transition, T for a title.' },
  ],
};

export function startTour(appId, { force = false } = {}) {
  const steps = (TOURS[appId] || []).filter((s) => { const el = document.querySelector(s.sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; });
  const key = 'eyad:tour:' + appId;
  if (!steps.length) { if (force) toast('The tour is not available on this screen size.'); return; }
  if (!force && navigator.webdriver) return; // never auto-start under automated testing
  if (!force) { try { if (localStorage.getItem(key)) return; } catch (e) { return; } }
  try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
  let i = 0;
  const hole = h('div', { class: 'xp-tour-hole' });
  const title = h('b'), text = h('p'), count = h('span', { class: 'studio-faint studio-small' });
  const back = h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'Back', onclick: () => go(i - 1) });
  const next = h('button', { class: 'studio-btn is-small is-primary', type: 'button', onclick: () => go(i + 1) });
  const card = h('div', { class: 'xp-tour-card', role: 'dialog', 'aria-live': 'polite' }, title, text,
    h('div', { class: 'xp-tour-foot' }, count, h('span', { class: 'studio-spacer' }), h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'Skip', onclick: () => end() }), back, next));
  const root = h('div', { class: 'xp-tour' }, hole, card);
  document.body.appendChild(root);
  const onKey = (e) => { if (e.key === 'Escape') end(); if (e.key === 'ArrowRight' || e.key === 'Enter') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); };
  addEventListener('keydown', onKey, true);
  const place = () => {
    const s = steps[i], el = document.querySelector(s.sel); if (!el) return;
    const r = el.getBoundingClientRect(), pad = 6;
    Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const cw = Math.min(340, innerWidth - 24);
    card.style.width = cw + 'px';
    const ch = card.offsetHeight || 160;
    let x = r.left + r.width / 2 - cw / 2, y = r.bottom + 14;
    if (y + ch > innerHeight - 12) y = r.top - ch - 14;
    if (y < 12) { y = Math.min(innerHeight - ch - 12, Math.max(12, r.top + 20)); x = r.right + 14 + cw < innerWidth ? r.right + 14 : r.left - cw - 14; }
    card.style.left = Math.max(12, Math.min(innerWidth - cw - 12, x)) + 'px';
    card.style.top = Math.max(12, y) + 'px';
  };
  function go(n) {
    if (n < 0) return;
    if (n >= steps.length) { end(); return; }
    i = n;
    title.textContent = steps[i].title; text.textContent = steps[i].text;
    count.textContent = `${i + 1} of ${steps.length}`;
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Done' : 'Next';
    requestAnimationFrame(place);
    next.focus({ preventScroll: true });
  }
  function end() { removeEventListener('keydown', onKey, true); removeEventListener('resize', place); root.classList.add('is-out'); setTimeout(() => root.remove(), 220); }
  addEventListener('resize', place);
  go(0);
}

// ------------------------------------------------------------------ offline pack

export const OFFLINE_CACHE = 'eyad-studio-offline-v1';
const VENDOR = new URL('../../vendor/', import.meta.url);
/** Everything that is not in the always-cached app shell (large, loaded on demand). */
export function offlineManifest() {
  const v = (p) => new URL(p, VENDOR).href;
  return [
    { group: 'AI runtime (on-device selections & cut-outs)', urls: [v('mediapipe/vision_bundle.mjs'), v('mediapipe/wasm/vision_wasm_internal.js'), v('mediapipe/wasm/vision_wasm_internal.wasm'), v('mediapipe/wasm/vision_wasm_nosimd_internal.js'), v('mediapipe/wasm/vision_wasm_nosimd_internal.wasm')] },
    { group: 'Object removal runtime', urls: [v('onnxruntime-web/ort.wasm.min.mjs'), v('onnxruntime-web/ort-wasm-simd-threaded.mjs'), v('onnxruntime-web/ort-wasm-simd-threaded.wasm')] },
    { group: 'PDF & .ai import', urls: [v('pdfjs/pdf.min.mjs'), v('pdfjs/pdf.worker.min.mjs')] },
    { group: '3D engine', urls: [v('three/three.module.js'), v('three/three.core.js'), v('three/addons/loaders/GLTFLoader.js'), v('three/addons/loaders/OBJLoader.js'), v('three/addons/loaders/STLLoader.js'), v('three/addons/loaders/FBXLoader.js'), v('three/addons/controls/OrbitControls.js'), v('three/addons/controls/TransformControls.js'), v('three/addons/environments/RoomEnvironment.js'), v('three/addons/exporters/GLTFExporter.js'), v('three/addons/utils/BufferGeometryUtils.js'), v('three/addons/utils/SkeletonUtils.js'), v('three/addons/libs/fflate.module.js'), v('three/addons/curves/NURBSCurve.js'), v('three/addons/curves/NURBSUtils.js')] },
    { group: 'Design-file import', urls: [v('fflate/fflate.js'), v('fzstd/fzstd.js'), v('kiwi/kiwi-decode.js'), v('paper/paper-core.min.js')] },
  ];
}

export async function offlineStatus() {
  if (!('caches' in window)) return { supported: false };
  const c = await caches.open(OFFLINE_CACHE);
  let have = 0, total = 0;
  for (const g of offlineManifest()) for (const u of g.urls) { total++; if (await c.match(u)) have++; }
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  return { supported: true, have, total, done: have === total, usage: est && est.usage, quota: est && est.quota };
}

/** Download and keep every on-demand part. onProgress(done, total, label). */
export async function downloadOfflinePack(onProgress = () => {}) {
  if (!('caches' in window)) throw new Error('This browser has no offline storage (Cache Storage).');
  try { await navigator.storage?.persist?.(); } catch (e) { /* ignore */ }
  const c = await caches.open(OFFLINE_CACHE);
  const all = offlineManifest().flatMap((g) => g.urls.map((u) => [g.group, u]));
  let n = 0, failed = 0;
  for (const [group, u] of all) {
    onProgress(n, all.length, group);
    if (!(await c.match(u))) {
      try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, r); else failed++; } catch (e) { failed++; }
    }
    n++;
  }
  onProgress(n, all.length, 'Done');
  // AI models: whatever the Studio can reach (self-hosted studio/models/ first, then the model host)
  let models = 0;
  try {
    const ai = await import('./ai.js');
    if (ai.cacheAllModels) models = await ai.cacheAllModels((label) => onProgress(n, all.length, label));
  } catch (e) { /* models are optional */ }
  return { files: all.length - failed, failed, models };
}

/** Quietly fetch the offline pack the first time the installed app runs on Wi-Fi / unmetered data. */
/** iPhone/iPad, not installed yet: say once how to add EYAD to the Home Screen (it cannot be done automatically). */
export function installHint() {
  if (!IS_IOS || isStandalone() || navigator.webdriver) return;
  try { if (localStorage.getItem('eyad:ios-hint')) return; } catch (e) { return; }
  setTimeout(() => {
    if (document.querySelector('.studio-scrim, .xp-tour, .studio-sheet')) return;
    try { localStorage.setItem('eyad:ios-hint', '1'); } catch (e) { /* ignore */ }
    toast('Install EYAD on your iPhone: Share ▸ Add to Home Screen.', { timeout: 14000, action: { label: 'Show me', fn: () => installGuide() } });
  }, 9000);
}

export function autoOfflinePack() {
  if (!isStandalone()) return;
  try { if (localStorage.getItem('eyad:offline-auto')) return; } catch (e) { return; }
  const conn = navigator.connection;
  if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;
  // Never download the big pack on our own: it made the first launch crawl on phones. Offer it once instead.
  setTimeout(async () => {
    try {
      const st = await offlineStatus(); if (!st.supported || st.done) { localStorage.setItem('eyad:offline-auto', '1'); return; }
      localStorage.setItem('eyad:offline-auto', '1');
      toast('Use EYAD without internet? Download the offline pack (AI models and engines).', { timeout: 12000, action: { label: 'Download', fn: async () => {
        const t = toast('Downloading the offline pack…', { timeout: 0 });
        try {
          const r = await downloadOfflinePack((d, n) => t.set && t.set(`Downloading the offline pack… ${Math.round(d / n * 100)}%`));
          t.close && t.close();
          toast(r.failed ? `Offline pack: ${r.files} parts saved, ${r.failed} will download when needed.` : 'Every tool now works offline.', { type: 'ok', timeout: 5000 });
        } catch (e) { t.close && t.close(); toast('The offline pack could not be downloaded. Try again from Settings.', { type: 'error' }); }
      } } });
    } catch (e) { /* ask again next launch */ }
  }, 20000);
}

export { route as experienceRoute, formatBytes, clear, setSetting };
