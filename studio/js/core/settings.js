// EYAD STUDIO — application settings (small, so kept in localStorage;
// projects and media live in IndexedDB).

const KEY = 'eyad-studio:settings:v2';
const OLD_KEY = 'eyad-studio:settings:v1';
const PORTFOLIO_THEME_KEY = 'theme'; // the portfolio's own light/dark toggle (same origin)

export const DEFAULTS = {
  theme: 'portfolio',       // portfolio (follow the portfolio's toggle) | light | dark | system
  workspaceTheme: 'dark',   // editors (Image / Vector / Video): dark (pro workspace) | light | match (same as theme)
  density: 'comfortable',   // comfortable | compact
  uiScale: 100,             // 80 | 90 | 100 | 110 | 125 | 150
  performance: 'auto',      // auto | quality | balanced | performance
  // Pen & touch
  penMode: 'auto',          // auto (stylus draws, finger pans once a stylus is seen) | finger-draw | finger-pan
  pressureSize: true,
  pressureOpacity: false,
  pressureFlow: false,
  pressureMin: 15,          // % of size/opacity at the lightest touch
  touchUndoGestures: true,  // two-finger tap = undo, three-finger tap = redo
  reduceMotion: false,
  tooltips: true,
<<<<<<< HEAD
  // EYAD Experience (look & layout)
  accent: '#d02b2a',        // accent colour
  corners: 'rounded',       // rounded (macOS-like) | soft | sharp
  translucency: true,       // frosted menus, dialogs and bars
  panelSide: 'right',       // right | left  (editors' panel column)
  toolbarSide: 'left',      // left | right  (tools column)
  forceDesktop: false,      // phones: show the full desktop interface (zoomed out)
  splash: 'installed',      // installed | always | never — app launch screen
  tourDone: false,
  // Pen tablet
  pressureCurve: 50,        // 0 soft … 100 firm (gamma on pen pressure)
  penEraserTip: true,       // the pen's eraser end switches to the Eraser
  tiltAngle: false,         // brush angle follows pen tilt / twist
=======
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  // Saving
  autosave: true,           // write recovery snapshots
  autosaveProjects: true,   // also update already-saved projects automatically
  autosaveSeconds: 20,
  warnOnLeave: true,
  // Image
  imageWidth: 1920,
  imageHeight: 1080,
  imageBackground: 'white', // white | black | transparent
  historyLimit: 60,
  brushSmoothing: 0.35,
  showRulersGrid: false,
  gridSize: 32,
  checker: 'mid',           // light | mid | dark
  // Video
  videoWidth: 1920,
  videoHeight: 1080,
  videoFps: 30,
  snapping: true,
  storeMedia: true,         // keep imported media in browser storage with the project
  stillDuration: 5,
  transitionDuration: 0.5,
};

let cache = null;
const listeners = new Set();

function read() {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      // migrate v1 preferences, but let the theme follow the portfolio by default
      const old = localStorage.getItem(OLD_KEY);
      if (old) { const o = JSON.parse(old) || {}; delete o.theme; raw = JSON.stringify(o); }
    }
    const obj = raw ? JSON.parse(raw) : {};
    return { ...DEFAULTS, ...(obj && typeof obj === 'object' ? obj : {}) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function getSettings() {
  if (!cache) cache = read();
  return cache;
}

export function setSetting(key, value) {
  const s = getSettings();
  if (!(key in DEFAULTS)) return;
  s[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage full / blocked */ }
  listeners.forEach((fn) => fn(key, value, s));
  applyUiSettings();
}

export function resetSettings() {
  cache = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  listeners.forEach((fn) => fn(null, null, cache));
  applyUiSettings();
}

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Applies theme/density/motion to the Studio root element only. */
export function applyUiSettings() {
  const s = getSettings();
  const root = document.querySelector('.studio-app');
  if (!root) return;
  const theme = resolvedTheme();
  root.dataset.theme = theme;
  root.dataset.density = s.density;
  root.style.setProperty('--st-scale', String((Number(s.uiScale) || 100) / 100));
  root.classList.toggle('studio-reduce-motion', !!s.reduceMotion);
  root.classList.toggle('studio-no-tips', !s.tooltips);
<<<<<<< HEAD
  // EYAD Experience look & layout
  const acc = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#d02b2a';
  if (acc.toLowerCase() !== '#d02b2a') { root.style.setProperty('--st-accent', acc); root.style.setProperty('--st-accent-hi', acc); root.style.setProperty('--st-accent-soft', `color-mix(in srgb, ${acc} 13%, transparent)`); }
  else { root.style.removeProperty('--st-accent'); root.style.removeProperty('--st-accent-hi'); root.style.removeProperty('--st-accent-soft'); }
  root.dataset.corners = s.corners || 'rounded';
  root.classList.toggle('xp-glass', s.translucency !== false);
  root.dataset.panels = s.panelSide === 'left' ? 'left' : 'right';
  root.dataset.tools = s.toolbarSide === 'right' ? 'right' : 'left';
=======
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f3ede1' : '#121110');
  document.documentElement.dataset.studioTheme = theme;
}

export const isEditorPage = () => document.documentElement.hasAttribute('data-studio-editor');

/** Effective performance level: quality | balanced | performance. */
export function perfLevel() {
  const p = getSettings().performance;
  if (p && p !== 'auto') return p;
  return matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4) ? 'performance' : 'balanced';
}

/** light | dark, after resolving "portfolio" and "system". */
export function resolvedTheme() {
  const ws = getSettings().workspaceTheme;
  if (isEditorPage() && (ws === 'dark' || ws === 'light')) return ws;
  const t = getSettings().theme;
  if (t === 'light' || t === 'dark') return t;
  if (t === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  let p = null;
  try { p = localStorage.getItem(PORTFOLIO_THEME_KEY); } catch (e) { /* ignore */ }
  return p === 'dark' ? 'dark' : 'light'; // the portfolio defaults to light
}

/** Flip light/dark. In "portfolio" mode this also flips the portfolio's own toggle, so both stay in sync. */
export function toggleTheme() {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
  const run = () => {
    if (isEditorPage() && getSettings().workspaceTheme !== 'match') { setSetting('workspaceTheme', next); return; }
    if (getSettings().theme === 'portfolio') {
      try { localStorage.setItem(PORTFOLIO_THEME_KEY, next); } catch (e) { /* ignore */ }
      applyUiSettings();
      listeners.forEach((fn) => fn('theme', 'portfolio', getSettings()));
    } else setSetting('theme', next);
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(run);
  else run();
}

// Keep in sync across Studio tabs.
addEventListener('storage', (e) => {
  if (e.key === PORTFOLIO_THEME_KEY) { applyUiSettings(); listeners.forEach((fn) => fn('theme', null, getSettings())); return; }
  if (e.key === KEY) { cache = read(); listeners.forEach((fn) => fn(null, null, cache)); applyUiSettings(); }
});
