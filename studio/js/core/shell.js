// EYAD STUDIO — shared shell: navigation, brand, PWA install, service worker.
import { h } from './dom.js';
import { icon } from './icons.js';
import { applyUiSettings, toggleTheme, resolvedTheme, onSettings } from './settings.js';

export const STUDIO_ROOT = new URL('../../', import.meta.url);       // …/studio/
export const PORTFOLIO_ROOT = new URL('../', STUDIO_ROOT);            // site root

export const ROUTES = {
  home: new URL('./', STUDIO_ROOT).href,
  image: new URL('./image/', STUDIO_ROOT).href,
  vector: new URL('./vector/', STUDIO_ROOT).href,
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
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const b = h('button', { class: 'studio-btn is-ghost is-small studio-install', type: 'button', hidden: true, onclick: async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
      deferredPrompt = null;
      b.hidden = true;
      return;
    }
    const body = h('div', { class: 'studio-stack' },
      h('p', { text: ios ? 'On iPhone or iPad, open this site in Safari, tap Share, then choose “Add to Home Screen”.' : 'Use your browser’s Install / Add to Home Screen command. EYAD STUDIO is a PWA and works as a standalone app when the browser supports installation.' }),
      h('p', { class: 'studio-dim studio-small', text: 'The editor remains browser-based and can cache its shell for offline use after the first visit.' }));
    import('./ui.js').then(({ dialog }) => dialog({ title:'Install EYAD STUDIO', body, width:400, buttons:[{label:'Done',value:true,primary:true}] }));
  } }, icon('install', 15), h('span', { text: 'Install app' }));
  const update = (avail) => { b.hidden = !avail && !ios; };
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
  // Ctrl/Cmd + Alt + 1 / 2 / 3 → Image / Vector / Video (plain Ctrl+1 stays "100%" like desktop editors)
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return;
    const to = { Digit1: 'image', Digit2: 'vector', Digit3: 'video' }[e.code];
    if (!to || location.href.startsWith(ROUTES[to])) return;
    e.preventDefault();
    location.href = ROUTES[to];
  });
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
