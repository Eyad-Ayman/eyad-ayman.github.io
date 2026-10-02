// EYAD Studio — home (/studio/). The main screen: a board of floating glass
// cards — a hero with search and open, the five studios, recent work, new
// document sizes and this device. Apps open with a zoom from their icon.
import { h, formatDate, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ROUTES } from '../core/shell.js';
import { listProjects, listRecovery, storageInfo, cleanupOrphanMedia, takeHandoff } from '../core/db.js';
import { ACCEPT } from '../core/files.js';
import { chooseFiles } from '../core/open.js';
import { appIcon, APPS } from '../core/appicons.js';
import { startTour, installGuide, offlineStatus, isStandalone } from '../core/experience.js';
import { page, routeFiles, bindPageDrop, projectUrl, thumbImg } from './common.js';

document.body.classList.add('xp-home');

const hour = new Date().getHours();
const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
const openAny = async (title, accept, media) => { const f = await chooseFiles({ title, accept, multiple: true, media }); if (f.length) routeFiles(f); };
const OPEN_ALL = () => openAny('Open', ACCEPT.imageAll + ',' + ACCEPT.media + ',.prproj,.pdf,.ai,.fig,.glb,.gltf,.obj,.stl,.fbx', 'any');

/** Native-style launch: the icon zooms towards the viewer, then we navigate. */
function launchFrom(el, href) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { location.href = href; return; }
  const r = el.getBoundingClientRect();
  const z = h('div', { class: 'hm-zoom' });
  z.style.setProperty('--x', (r.left + r.width / 2) + 'px'); z.style.setProperty('--y', (r.top + r.height / 2) + 'px');
  document.body.append(z);
  requestAnimationFrame(() => z.classList.add('is-on'));
  setTimeout(() => { location.href = href; }, 260);
  setTimeout(() => z.remove(), 2500); // back/forward cache
}

// ---------------------------------------------------------------- card helper
/** A floating glass card. `d` is its depth: how far it drifts with the pointer. */
const card = (cls, d, ...kids) => h('section', { class: 'hm-card ' + cls, style: { '--d': d, '--fd': (d * -0.7).toFixed(1) + 's' } }, ...kids);
const head = (title, ...right) => h('div', { class: 'hm-card-head' }, h('h2', { text: title }), ...right);
const go = (link, iconEl) => link.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); launchFrom(iconEl(), link.href); });

// ---------------------------------------------------------------- hero
const clock = h('b', { class: 'hm-clock' }), day = h('span', { class: 'hm-day' });
const tick = () => { const n = new Date(); clock.textContent = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); day.textContent = n.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); };
tick(); setInterval(tick, 20000);
const search = h('input', { class: 'hm-search-input', type: 'search', placeholder: 'Search apps, sizes, projects', 'aria-label': 'Search', autocomplete: 'off' });
const hero = card('hm-hero', 6,
  h('div', { class: 'hm-hero-top' }, h('span', { class: 'hm-greet', text: greet }), h('span', { class: 'hm-time' }, clock, day)),
  h('h1', { class: 'hm-title' }, 'What are we ', h('em', { text: 'making' }), ' today?'),
  h('label', { class: 'hm-search' }, icon('search', 16), search, h('kbd', { text: '/' })),
  h('div', { class: 'hm-quick' },
    h('button', { class: 'studio-btn is-primary', type: 'button', onclick: OPEN_ALL }, icon('folder', 15), 'Open a file'),
    h('button', { class: 'studio-btn', type: 'button', onclick: () => openAny('Open PSD', ACCEPT.psd, 'image') }, icon('layers', 15), 'PSD'),
    h('button', { class: 'studio-btn', type: 'button', onclick: () => openAny('Open PDF, .ai or .fig', '.pdf,.ai,.eps,.fig,.svg', 'image') }, icon('vector', 15), 'PDF · AI · SVG'),
    h('a', { class: 'studio-btn', href: ROUTES.image + '?new=1' }, icon('plus', 15), 'Custom size')));

// ---------------------------------------------------------------- studios
const STUDIOS = [
  ['image', 'Photo & design', 'Layers · PSD · Raw · AI'],
  ['vector', 'Logos & layout', 'Pen · type · PDF · SVG'],
  ['video', 'Edit & colour', 'Timeline · titles · SRT'],
  ['3d', 'Model & render', 'Scenes · lights · camera'],
  ['camera', 'Shoot', 'Film · Y2K · 3D ×4'],
];
const appsGrid = h('nav', { class: 'xp-launch hm-apps', 'aria-label': 'Studios' }, STUDIOS.map(([id, what, sub], i) => {
  const a = APPS[id];
  const ic = h('span', { class: 'hm-icon' }, appIcon(id, 112));
  const link = h('a', { class: 'xp-app hm-app', href: ROUTES[a.route], style: { '--i': i, '--c1': a.c[0], '--c2': a.c[1] }, dataset: { q: (a.name + ' ' + what + ' ' + sub + ' ' + (a.desc || '')).toLowerCase() }, title: a.desc || a.name },
    ic, h('span', { class: 'xp-app-name', text: a.short }), h('span', { class: 'hm-app-what', text: what }), h('span', { class: 'hm-app-sub', text: sub }));
  go(link, () => ic);
  return link;
}));
const MORE = ['templates', 'projects', 'settings', 'help'];
const moreRow = h('div', { class: 'hm-more' }, MORE.map((id) => { const a = APPS[id]; return h('a', { class: 'hm-chip', href: ROUTES[a.route], dataset: { q: (a.name + ' ' + (a.desc || '')).toLowerCase() }, title: a.desc }, appIcon(id, 28), h('span', { text: a.short })); }));
const studios = card('hm-studios', 10, head('Studios', h('span', { class: 'hm-card-note', text: 'Five apps, one project format' })), appsGrid, moreRow);

// ---------------------------------------------------------------- start new
const SIZES = [
  ['image', 'Instagram post', 1080, 1080], ['image', 'Portrait 4:5', 1080, 1350], ['image', 'Story / Reel', 1080, 1920], ['image', 'YouTube thumbnail', 1280, 720],
  ['image', 'A4 poster @300', 2480, 3508], ['vector', 'Logo', 1000, 1000], ['vector', 'Business card', 1050, 600], ['vector', 'Slide 16:9', 1920, 1080],
  ['video', 'Reel 9:16', 1080, 1920], ['video', 'Full HD video', 1920, 1080], ['3d', '3D scene', 1920, 1080], ['camera', 'Take a photo', 1080, 1440],
];
const newUrl = (kind, name, w, hh) => (kind === '3d' || kind === 'camera') ? ROUTES[kind] : `${ROUTES[kind]}?new=1&w=${w}&h=${hh}&name=${encodeURIComponent(name)}`;
const createGrid = h('div', { class: 'xp-quick-grid hm-sizes' }, SIZES.map(([k, name, w, hh]) => {
  const r = w / hh, bw = r >= 1 ? 30 : Math.round(30 * r), bh = r >= 1 ? Math.round(30 / r) : 30;
  return h('a', { class: 'xp-size hm-size', href: newUrl(k, name, w, hh), dataset: { q: (name + ' ' + k).toLowerCase() } },
    h('span', { class: 'hm-size-shape' }, h('i', { style: { width: bw + 'px', height: bh + 'px' } })),
    h('span', { class: 'hm-size-text' }, h('b', { text: name }), h('span', { text: `${APPS[k].short}${k === '3d' || k === 'camera' ? '' : ` · ${w}×${hh}`}` })));
}));
const create = card('hm-create xp-quick', 14, head('Start new', h('a', { class: 'studio-btn is-small', href: ROUTES.templates, text: 'Templates' })), createGrid);

// ---------------------------------------------------------------- continue
const recentBox = h('div', { class: 'xp-recent-list hm-recent' }, h('p', { class: 'studio-dim', text: 'Loading…' }));
const recent = card('hm-continue xp-recent', 8, head('Continue', h('a', { class: 'studio-btn is-small', href: ROUTES.projects, text: 'All projects' })), recentBox);

// ---------------------------------------------------------------- this device
const W = (ic, label) => { const v = h('b', { text: '—' }); const s = h('span', { class: 'sp-w-sub' }); return { el: h('div', { class: 'hm-widget' }, h('span', { class: 'sp-w-ic' }, icon(ic, 16)), h('span', { class: 'sp-w-label', text: label }), v, s), v, s }; };
const wStore = W('hdd', 'Storage'), wOff = W('cloud', 'Offline'), wProj = W('folder', 'Projects');
const installBtn = h('button', { class: 'studio-btn is-primary is-small', type: 'button', onclick: () => installGuide() }, icon('install', 14), h('span', { text: isStandalone() ? 'Installed' : 'Install app' }));
installBtn.disabled = isStandalone();
const recoverBox = h('div', { class: 'xp-recover', hidden: true });
const device = card('hm-device xp-now', 18, head('This device', installBtn),
  h('div', { class: 'hm-widgets' }, wStore.el, wOff.el, wProj.el), recoverBox,
  h('p', { class: 'hm-note studio-dim', text: 'Private by design — nothing is uploaded. Drop files anywhere to open them.' }),
  h('button', { class: 'hm-link', type: 'button', onclick: () => startTour('home', { force: true }) }, icon('compass', 14), 'Take the tour'));

const shell = h('div', { class: 'hm-shell hm-board' }, hero, studios, recent, create, device);

// cards drift a little with the pointer — the "floating" feel (mouse only)
if (matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let raf = 0, px = 0, py = 0;
  addEventListener('pointermove', (e) => {
    px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; shell.style.setProperty('--px', px.toFixed(3)); shell.style.setProperty('--py', py.toFixed(3)); });
  }, { passive: true });
}

addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea, select, .studio-dialog')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const n = +e.key; if (n >= 1 && n <= STUDIOS.length) { appsGrid.children[n - 1].click(); return; }
  if (e.key === '/') { e.preventDefault(); search.focus(); }
});

let recentCards = [];
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  for (const el of [...appsGrid.children, ...moreRow.children, ...createGrid.children, ...recentCards]) el.classList.toggle('is-dim', !!q && !el.dataset.q.includes(q));
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { search.value = ''; search.dispatchEvent(new Event('input')); search.blur(); return; }
  if (e.key !== 'Enter' || !search.value.trim()) return;
  const a = [...appsGrid.children, ...moreRow.children, ...createGrid.children, ...recentCards].find((x) => !x.classList.contains('is-dim'));
  if (a) a.click();
});

page('home', shell);
bindPageDrop();

(async () => {
  const q = new URLSearchParams(location.search);
  if (q.get('handoff')) {
    history.replaceState(null, '', location.pathname);
    const files = await takeHandoff(q.get('handoff')).catch(() => null);
    if (files && files.length) { routeFiles(files); return; }
  }
  cleanupOrphanMedia();
  let projects = [];
  try { projects = await listProjects(); } catch (e) { projects = null; }
  const recent = projects ? projects.sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated)).slice(0, 10) : [];
  if (recent.length) {
    recentCards = recent.slice(0, 6).map((p) => { const k = APPS[p.kind] ? p.kind : 'image'; return h('a', { class: 'hm-proj', href: projectUrl(p), dataset: { q: (p.name + ' ' + k).toLowerCase() }, title: p.name },
      h('span', { class: 'hm-proj-media' }, thumbImg(p), appIcon(k, 26)),
      h('b', { text: p.name }), h('span', { text: `${APPS[k].short}${p.source === 'psd' ? ' · PSD' : ''} · ${formatDate(p.updated)}` })); });
    recentBox.replaceChildren(...recentCards);
  } else {
    recentBox.replaceChildren(h('div', { class: 'hm-empty' }, appIcon('projects', 56), h('div', {}, h('b', { text: projects ? 'No projects yet' : 'Storage is unavailable' }),
      h('span', { class: 'studio-dim', text: projects ? 'Everything you save lands here, ready to pick up where you left off.' : 'This browser blocks local storage (private mode?). You can still download your work as .eyad files.' }))));
  }
  try {
    const rec = await listRecovery();
    if (rec.length) {
      recoverBox.hidden = false;
      recoverBox.replaceChildren(icon('warn', 15), h('span', { text: `Unsaved work found: ${rec.map((r) => r.name).slice(0, 3).join(', ')}` }),
        ...([...new Set(rec.map((r) => r.kind))].filter((k) => ROUTES[k]).map((k) => h('a', { class: 'studio-btn is-small', href: ROUTES[k], text: 'Restore in ' + (APPS[k] || APPS.image).short }))));
    }
  } catch (e) { /* ignore */ }
  const s = await storageInfo().catch(() => null);
  const off = await offlineStatus().catch(() => null);
  wStore.v.textContent = s ? formatBytes(s.usage) : '—'; wStore.s.textContent = s && s.quota ? 'of ' + formatBytes(s.quota) + ' available' : '';
  wOff.v.textContent = !off || !off.supported ? 'Not supported' : off.done ? 'Ready' : `${off.have}/${off.total}`; wOff.s.textContent = off && off.done ? 'Every tool works without internet' : 'Downloads in the background after install';
  wProj.v.textContent = projects ? String(projects.length) : '—'; wProj.s.textContent = 'Saved on this device';
  setTimeout(() => { if (!document.querySelector('.studio-scrim')) startTour('home'); }, 1800);
})();
