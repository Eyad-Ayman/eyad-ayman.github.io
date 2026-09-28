// EYAD STUDIO — shared shell: navigation, brand, PWA install, service worker.
import { h } from './dom.js';
import { icon } from './icons.js';
import { applyUiSettings, toggleTheme, resolvedTheme, onSettings } from './settings.js';

export const STUDIO_ROOT = new URL('../../', import.meta.url);       // …/studio/
export const PORTFOLIO_ROOT = new URL('../', STUDIO_ROOT);            // site root

export const ROUTES = {
  home: new URL('./', STUDIO_ROOT).href,
  image: new URL('./image/', STUDIO_ROOT).href,
  video: new URL('./video/', STUDIO_ROOT).href,
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
    icon('back', 16), h('span', { class: 'studio-back-label', text: 'Back to portfolio' }));
  return a;
}

export function appSwitcher(current) {
  const items = [
    ['image', 'Image', 'image'],
    ['video', 'Video', 'video'],
    ['projects', 'Projects', 'folder'],
    ['settings', 'Settings', 'gear'],
  ];
  return h('nav', { class: 'studio-switcher', 'aria-label': 'Studio apps' },
    items.map(([key, label, ic]) => h('a', {
      class: 'studio-switcher-item' + (current === key ? ' is-active' : ''),
      href: ROUTES[key], 'aria-current': current === key ? 'page' : undefined,
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
  navigator.serviceWorker.register(swUrl, { scope: STUDIO_ROOT.pathname }).then((reg) => {
    // The portfolio's own service worker clears caches it doesn't own when it
    // updates; ask ours to re-check its shell cache so offline keeps working.
    const sw = reg.active || reg.waiting || reg.installing;
    if (sw && sw.state === 'activated') sw.postMessage({ type: 'ensure-cache' });
  }).catch(() => { /* offline shell is optional */ });
}

/** Common bootstrap for every Studio page. */
export function bootStudio() {
  applyUiSettings();
  registerServiceWorker();
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyUiSettings);
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

/** Header used by the non-editor pages (home, projects, settings, help). */
export function hubHeader(current) {
  return h('header', { class: 'studio-hub-header' },
    h('div', { class: 'studio-hub-header-left' }, brandMark(), appSwitcher(current)),
    h('div', { class: 'studio-hub-header-right' }, installButton(), themeToggle(), backToPortfolio()));
}

/** Navigate to an editor, passing files through IndexedDB hand-off. */
export function editorUrl(kind, params = {}) {
  const u = new URL(kind === 'video' ? ROUTES.video : ROUTES.image);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.href;
}
