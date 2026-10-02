// EYAD STUDIO — shared shell: navigation, brand, PWA install, service worker.
import { h } from './dom.js';
import { icon } from './icons.js';
import { applyUiSettings, toggleTheme, resolvedTheme, onSettings } from './settings.js';

export const STUDIO_ROOT = new URL('../../', import.meta.url);       // …/studio/
export const PORTFOLIO_ROOT = new URL('../', STUDIO_ROOT);            // site root

import { windowControls, startTour, autoOfflinePack, installGuide, bugReportDialog, dock as xpDock } from './experience.js';

export const ROUTES = {
  home: new URL('./', STUDIO_ROOT).href,
  image: new URL('./image/', STUDIO_ROOT).href,
  vector: new URL('./vector/', STUDIO_ROOT).href,
  video: new URL('./video/', STUDIO_ROOT).href,
  '3d': new URL('./3d/', STUDIO_ROOT).href,
  camera: new URL('./camera/', STUDIO_ROOT).href,
  templates: new URL('./templates/', STUDIO_ROOT).href,
  projects: new URL('./projects/', STUDIO_ROOT).href,
  settings: new URL('./settings/', STUDIO_ROOT).href,
  help: new URL('./help/', STUDIO_ROOT).href,
  portfolio: PORTFOLIO_ROOT.href,
};

export function brandMark({ app = 'STUDIO' } = {}) {
  return h('a', { class: 'studio-brand', href: ROUTES.home, 'aria-label': 'EYAD ' + app + ' — Studio home' },
    h('span', { class: 'studio-brand-mark', 'aria-hidden': 'true' }),
    h('span', { class: 'studio-brand-word' }, 'EYAD', h('span', { class: 'studio-brand-app', text: app })));
}

export function backToPortfolio({ compact = false } = {}) {
  const a = h('a', { class: 'studio-back' + (compact ? ' is-compact' : ''), href: ROUTES.portfolio, title: 'Back to portfolio' },
    icon('back', 16), h('span', { class: 'studio-back-label', text: 'Portfolio' }));
  a.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    goPortfolio();
  });
  return a;
}

/**
 * Leave the Studio with the reverse of the entry transition: a curtain closes
 * over the Studio, then the portfolio lifts it and returns to where you were.
 * If you came from the portfolio in this tab, go back in history so the
 * browser restores the page instantly with its scroll position intact.
 */
export function goPortfolio() {
  try { sessionStorage.setItem('eyad:return-anim', '1'); } catch (e) { /* ignore */ }
  let back = false;
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    back = !!ref && ref.origin === location.origin && ref.pathname === new URL(ROUTES.portfolio).pathname && history.length > 1;
  } catch (e) { back = false; }
  const go = () => { if (back) history.back(); else location.href = ROUTES.portfolio; };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const c = document.createElement('div');
  c.className = 'studio-curtain' + (reduce ? ' is-fade' : '');
  c.setAttribute('aria-hidden', 'true');
  c.innerHTML = '<div class="studio-curtain-bg"></div><div class="studio-curtain-word">EYAD<br><em>AYMAN</em></div>';
  document.body.appendChild(c);
  requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('is-run')));
  setTimeout(go, reduce ? 180 : 620);
  // If the navigation is cancelled (unsaved-changes prompt), take the curtain away again.
  setTimeout(() => c.remove(), 2500);
}

export function appSwitcher(current) {
  const items = [
    ['image', 'Image', 'image'],
    ['vector', 'Vector', 'vector'],
    ['video', 'Video', 'video'],
    ['3d', '3D', 'cube'],
    ['camera', 'Kamera', 'camera'],
    ['templates', 'Templates', 'grid'],
    ['projects', 'Projects', 'folder'],
    ['settings', 'Settings', 'gear'],
  ];
  return h('nav', { class: 'studio-switcher', 'aria-label': 'Studio apps' },
    items.map(([key, label, ic]) => h('a', {
      class: 'studio-switcher-item' + (current === key ? ' is-active' : ''),
      href: ROUTES[key], 'aria-current': current === key ? 'page' : undefined, title: 'EYAD ' + label,
    }, icon(ic, 15), h('span', { text: label }))));
}

// ---------------------------------------------------------------- PWA

let deferredPrompt = null;
const installListeners = new Set();
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installListeners.forEach((fn) => fn(true));
});
addEventListener('appinstalled', () => { deferredPrompt = null; installListeners.forEach((fn) => fn(false)); });

export function installButton() {
  const b = h('button', { class: 'studio-btn is-ghost is-small studio-install', type: 'button', hidden: true, onclick: async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
    deferredPrompt = null;
    b.hidden = true;
  } }, icon('install', 15), h('span', { text: 'Install app' }));
  const update = (avail) => { b.hidden = !avail; };
  installListeners.add(update);
  update(!!deferredPrompt);
  return b;
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  const swUrl = new URL('./sw.js', STUDIO_ROOT);
  // A new version took over while this page was open: offer a reload (never forced — there may be unsaved work).
  const hadController = !!navigator.serviceWorker.controller;
  let told = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || told) return; told = true;
    import('./ui.js').then(({ toast }) => toast('EYAD Studio was updated.', { timeout: 0, action: { label: 'Reload', fn: () => location.reload() } })).catch(() => {});
  });
  navigator.serviceWorker.register(swUrl, { scope: STUDIO_ROOT.pathname, updateViaCache: 'none' }).then((reg) => {
    reg.update().catch(() => {});
    // The portfolio's own service worker clears caches it doesn't own when it
    // updates; ask ours to re-check its shell cache so offline keeps working.
    const sw = reg.active || reg.waiting || reg.installing;
    if (sw && sw.state === 'activated') sw.postMessage({ type: 'ensure-cache' });
  }).catch(() => { /* offline shell is optional */ });
}

/** Common bootstrap for every Studio page. */
export function bootStudio() {
  applyUiSettings();
  // Ctrl/Cmd + Alt + 1 / 2 / 3 → Image / Vector / Video (plain Ctrl+1 stays "100%" like desktop editors)
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return;
    const to = { Digit1: 'image', Digit2: 'vector', Digit3: 'video', Digit4: '3d', Digit5: 'camera', Digit6: 'templates', Digit0: 'home' }[e.code];
    if (!to || location.href.startsWith(ROUTES[to])) return;
    e.preventDefault();
    location.href = ROUTES[to];
  });
  registerServiceWorker();
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyUiSettings);
  // EYAD Studio: window buttons on every editor, first-run tour, offline pack after install
  const app = (location.pathname.match(/\/studio\/(image|vector|video|3d)\//) || [])[1];
  if (app) {
    const inject = () => {
      const left = document.querySelector('.img-top-left');
      if (!left) return false;
      if (!left.querySelector('.xp-wcs')) left.prepend(windowControls());
      return true;
    };
    if (!inject()) { const mo = new MutationObserver(() => { if (inject()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 8000); }
    setTimeout(() => { if (!document.querySelector('.studio-scrim, .xp-tour') && innerWidth > 760) startTour(app); }, 2600);
  }
  if (document.body.classList.contains('is-hub') || app) {
    // Ctrl/Cmd + Alt + 0 → EYAD Studio home
    addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'Digit0') { e.preventDefault(); location.href = ROUTES.home; } });
  }
  document.documentElement.classList.toggle('xp-standalone', matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches || navigator.standalone === true);
  autoOfflinePack();
  import('./fonts.js').then((m) => m.loadUserFonts()).catch(() => {});
  requestAnimationFrame(() => dispatchEvent(new Event('eyad:ready')));
}

/** "Dark" / "Light" toggle — same wording as the portfolio nav, kept in sync with it. */
export function themeToggle() {
  const label = h('span');
  const b = h('button', { class: 'studio-theme-toggle', type: 'button', onclick: () => toggleTheme() }, h('span', { class: 'studio-theme-dot', 'aria-hidden': 'true' }), label);
  const sync = () => { const dark = resolvedTheme() === 'dark'; label.textContent = dark ? 'Light' : 'Dark'; b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); };
  sync();
  onSettings(sync);
  return b;
}

/** Header used by the non-editor pages (home, projects, settings, help): the EYAD Studio menu bar. */
export function hubHeader(current) {
  const clock = h('span', { class: 'xp-clock studio-mono', 'aria-hidden': 'true' });
  const tick = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 20000);
  const net = h('span', { class: 'xp-net', title: navigator.onLine ? 'Online' : 'Offline — everything already downloaded keeps working' });
  const upd = () => { net.classList.toggle('is-off', !navigator.onLine); net.title = navigator.onLine ? 'Online' : 'Offline — everything already downloaded keeps working'; net.replaceChildren(icon(navigator.onLine ? 'cloud' : 'wifiOff', 14)); };
  upd(); addEventListener('online', upd); addEventListener('offline', upd);
  const install = h('button', { class: 'xp-bar-btn', type: 'button', onclick: () => installGuide(), hidden: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true }, icon('install', 14), h('span', { text: 'Install' }));
  return h('header', { class: 'studio-hub-header xp-menubar' },
    h('div', { class: 'studio-hub-header-left' }, brandMark({ app: 'STUDIO' }), appSwitcher(current)),
    h('div', { class: 'studio-hub-header-right xp-menubar-right' },
      net, install,
      h('button', { class: 'xp-bar-btn', type: 'button', title: 'Report a bug', 'aria-label': 'Report a bug', onclick: () => bugReportDialog(current) }, icon('bug', 14)),
      themeToggle(), clock, backToPortfolio()));
}

export { xpDock };

/** Navigate to an editor, passing files through IndexedDB hand-off. */
export function editorUrl(kind, params = {}) {
  const u = new URL(ROUTES[kind] || ROUTES.image);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.href;
}
