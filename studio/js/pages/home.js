// EYAD Experience — home (/studio/): a desktop for the whole suite.
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

/** A macOS-like window frame. */
const win = (title, cls, ...body) => h('section', { class: 'xp-win ' + cls, 'aria-label': title },
  h('header', { class: 'xp-win-bar' }, h('span', { class: 'xp-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { class: 'xp-win-title', text: title })),
  h('div', { class: 'xp-win-body' }, ...body));

// ---------------------------------------------------------------- launchpad
const LAUNCH = ['image', 'vector', 'video', '3d', 'camera', 'templates', 'projects', 'settings', 'help'];
const search = h('input', { class: 'xp-search', type: 'search', placeholder: 'Search apps, sizes and actions…', 'aria-label': 'Search', autocomplete: 'off' });
const launch = h('nav', { class: 'xp-launch', 'aria-label': 'Apps' }, LAUNCH.map((id) => {
  const a = APPS[id];
  return h('a', { class: 'xp-app', href: ROUTES[a.route], dataset: { q: (a.name + ' ' + (a.desc || '')).toLowerCase() } },
    appIcon(id, 76), h('span', { class: 'xp-app-name', text: a.short }), a.desc ? h('span', { class: 'xp-app-desc', text: a.desc }) : null);
}));

// ---------------------------------------------------------------- quick start
const SIZES = [
  ['image', 'Instagram post', 1080, 1080], ['image', 'Story / Reel', 1080, 1920], ['image', 'YouTube thumbnail', 1280, 720], ['image', 'A4 poster @300', 2480, 3508],
  ['vector', 'Logo', 1000, 1000], ['vector', 'Business card', 1050, 600], ['video', 'Reel 9:16', 1080, 1920], ['video', 'Full HD video', 1920, 1080],
];
const newUrl = (kind, name, w, hh) => `${ROUTES[kind]}?new=1&w=${w}&h=${hh}&name=${encodeURIComponent(name)}`;
const quickGrid = h('div', { class: 'xp-quick-grid' },
  SIZES.map(([k, name, w, hh]) => h('a', { class: 'xp-size', href: newUrl(k, name, w, hh), dataset: { q: (name + ' ' + k).toLowerCase() } },
    h('span', { class: 'xp-size-shape', style: { aspectRatio: `${w} / ${hh}` } }), h('b', { text: name }), h('span', { text: `${APPS[k].short} · ${w} × ${hh}` }))));
const openAny = async (title, accept, media) => { const f = await chooseFiles({ title, accept, multiple: true, media }); if (f.length) routeFiles(f); };
const actions = h('div', { class: 'xp-actions' },
  h('button', { class: 'studio-btn is-primary', type: 'button', onclick: () => openAny('Open', ACCEPT.imageAll + ',' + ACCEPT.media + ',.prproj,.pdf,.ai,.fig,.glb,.gltf,.obj,.stl,.fbx', 'any') }, icon('folder', 15), 'Open…'),
  h('button', { class: 'studio-btn', type: 'button', onclick: () => openAny('Open PSD', ACCEPT.psd, 'image') }, icon('layers', 15), 'PSD'),
  h('button', { class: 'studio-btn', type: 'button', onclick: () => openAny('Open PDF, .ai or .fig', '.pdf,.ai,.eps,.fig,.svg', 'image') }, icon('vector', 15), 'PDF · AI · SVG'),
  h('a', { class: 'studio-btn', href: ROUTES.image + '?new=1' }, icon('plus', 15), 'Custom size'));

search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  for (const el of launch.children) el.hidden = !!q && !el.dataset.q.includes(q);
  for (const el of quickGrid.children) el.hidden = !!q && !el.dataset.q.includes(q);
});
search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = [...launch.children, ...quickGrid.children].find((x) => !x.hidden); if (first) first.click(); } });

// ---------------------------------------------------------------- status widget
const statusRows = h('div', { class: 'xp-status' });
const installBtn = h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => installGuide() }, icon('install', 14), h('span', { text: isStandalone() ? 'Installed' : 'Install app' }));
installBtn.disabled = isStandalone();
const recoverBox = h('div', { class: 'xp-recover', hidden: true });

// ---------------------------------------------------------------- recent
const recentList = h('div', { class: 'xp-recent-list' }, h('p', { class: 'studio-dim studio-small', text: 'Loading…' }));

page('home',
  h('div', { class: 'xp-desktop' },
    h('section', { class: 'xp-hero' },
      h('p', { class: 'xp-kicker', text: greet + ' — let’s make something.' }),
      h('h1', { class: 'xp-title' }, 'EYAD', h('em', { text: 'EXPERIENCE' })),
      h('p', { class: 'xp-lede', text: 'Eyad Ayman’s creative suite: photo editing, vector design, video, 3D, a film camera and templates — in one place. Runs on your device, installs like an app, works offline. Your files never leave it.' }),
      h('div', { class: 'xp-searchwrap' }, icon('search', 16), search)),
    win('Status', 'xp-now',
      h('div', { class: 'xp-now-top' }, appIcon('home', 46), h('div', {}, h('b', { text: 'EYAD Experience 3.0' }), h('span', { class: 'studio-dim studio-small', text: isStandalone() ? 'Running as an installed app' : 'Running in the browser' }))),
      statusRows, recoverBox,
      h('div', { class: 'xp-now-actions' }, installBtn,
        h('button', { class: 'studio-btn is-small is-ghost', type: 'button', onclick: () => startTour('home', { force: true }) }, icon('compass', 14), h('span', { text: 'Take the tour' })))),
    launch,
    win('Start something new', 'xp-quick', quickGrid, actions),
    win('Recent', 'xp-recent', recentList)),
  h('section', { class: 'hub-drop', 'aria-label': 'Drop files' },
    icon('upload', 22), h('div', {}, h('b', { text: 'Drop files anywhere' }), h('p', { class: 'studio-dim studio-small', text: 'PSD, images → IMAGE · SVG, PDF, .ai, .fig → VECTOR · video, audio, .prproj → VIDEO · .glb .obj .stl .fbx → 3D · .eyad → the right app' }))));

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
  try { projects = await listProjects(); } catch (e) { recentList.replaceChildren(h('p', { class: 'studio-dim', text: 'Local storage is unavailable in this browser (private mode?). Projects can still be downloaded as .eyad files.' })); projects = null; }
  if (projects) {
    const recent = projects.sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated)).slice(0, 6);
    if (!recent.length) recentList.replaceChildren(h('div', { class: 'xp-empty' }, h('b', { text: 'No projects yet' }), h('span', { class: 'studio-dim studio-small', text: 'Everything you save appears here.' })));
    else recentList.replaceChildren(...recent.map((p) => h('a', { class: 'xp-recent-row', href: projectUrl(p) },
      thumbImg(p),
      h('div', { class: 'xp-recent-meta' }, h('b', { text: p.name }), h('span', { class: 'studio-dim studio-small', text: `${(APPS[p.kind] || APPS.image).short}${p.source === 'psd' ? ' · PSD' : ''} · ${formatDate(p.updated)}` })))),
      h('a', { class: 'xp-recent-all', href: ROUTES.projects, text: 'All projects →' }));
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
  const row = (ic, label, value) => h('div', { class: 'xp-status-row' }, icon(ic, 14), h('span', { text: label }), h('b', { text: value }));
  statusRows.replaceChildren(
    row('hdd', 'Storage', s ? `${formatBytes(s.usage)}${s.quota ? ' of ' + formatBytes(s.quota) : ''}` : '—'),
    row('cloud', 'Offline pack', !off || !off.supported ? 'not supported' : off.done ? 'ready — works offline' : `${off.have}/${off.total} parts · see Settings`),
    row('folder', 'Projects', projects ? String(projects.length) : '—'));
  setTimeout(() => { if (!document.querySelector('.studio-scrim')) startTour('home'); }, 1800);
})();
