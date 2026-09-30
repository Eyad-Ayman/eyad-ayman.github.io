<<<<<<< HEAD
// EYAD Experience — home (/studio/): a desktop for the whole suite.
=======
// EYAD STUDIO — home (/studio/).
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
import { h, formatDate, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ROUTES } from '../core/shell.js';
import { listProjects, listRecovery, storageInfo, cleanupOrphanMedia, takeHandoff } from '../core/db.js';
<<<<<<< HEAD
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
=======
import { pickFiles, ACCEPT } from '../core/files.js';
import { chooseFiles } from '../core/open.js';
import { page, routeFiles, bindPageDrop, projectUrl, thumbImg } from './common.js';

const tile = (href, ic, name, desc, tags) => h('a', { class: 'hub-app', href },
  h('div', { class: 'hub-app-top' }, h('span', { class: 'hub-app-icon' }, icon(ic, 22)), icon('arrowUpRight', 18, 'hub-app-go')),
  h('div', { class: 'hub-app-name' }, 'EYAD', h('span', { text: ' ' + name })),
  h('p', { class: 'hub-app-desc', text: desc }),
  h('div', { class: 'hub-tags' }, tags.map((t) => h('span', { class: 'hub-tag', text: t }))));

const recentList = h('div', { class: 'hub-recent' });
const notice = h('div', { class: 'hub-notice', hidden: true });
const storage = h('span', { class: 'studio-faint studio-small' });

page('home',
  h('section', { class: 'hub-hero' },
    h('p', { class: 'studio-label', text: 'Eyad Ayman · Creative software' }),
    h('h1', { class: 'studio-page-title hub-title' }, 'EYAD', h('em', { text: ' STUDIO' })),
    h('p', { class: 'studio-page-lede', text: 'My own creative suite, built into my portfolio: IMAGE, VECTOR and VIDEO. Desktop-class tools in the browser — on a computer, a tablet with a pencil, or a phone. Everything runs on your device; your files never leave it.' }),
    h('div', { class: 'hub-actions' },
      h('a', { class: 'studio-btn is-primary', href: ROUTES.image + '?new=1' }, icon('image', 16), 'New image'),
      h('button', { class: 'studio-btn', type: 'button', onclick: async () => { const f = await chooseFiles({ title: 'Open PSD', accept: ACCEPT.psd, multiple: true, media: 'image' }); if (f.length) routeFiles(f); } }, icon('layers', 16), 'Open PSD'),
      h('a', { class: 'studio-btn', href: ROUTES.vector + '?new=1' }, icon('vector', 16), 'New vector'),
      h('a', { class: 'studio-btn', href: ROUTES.video + '?new=1' }, icon('video', 16), 'New video'),
      h('button', { class: 'studio-btn is-ghost', type: 'button', onclick: async () => { const f = await chooseFiles({ title: 'Open any file', accept: ACCEPT.imageAll + ',' + ACCEPT.media + ',.prproj', multiple: true }); if (f.length) routeFiles(f); } }, icon('upload', 16), 'Open any file…'))),
  notice,
  h('section', { class: 'hub-apps', 'aria-label': 'Studio apps' },
    tile(ROUTES.image, 'image', 'IMAGE', 'Photoshop-style editor: layers, masks, 20+ tools, Camera Raw, Levels & Curves, 30+ filters, content-aware fill, on-device AI selections, real PSD import & export.', ['PSD', 'Camera Raw', 'AI', 'Pen pressure']),
    tile(ROUTES.vector, 'vector', 'VECTOR', 'Illustrator-style design: Pen & Bézier editing, pencil, pressure brush, shapes, type, gradients & patterns, Pathfinder, artboards, SVG import, SVG/PDF export.', ['Pen', 'Pathfinder', 'SVG', 'PDF']),
    tile(ROUTES.video, 'video', 'VIDEO', 'Premiere-style timeline: tracks, trims, keyframe animation, titles, transitions, GPU colour grading & scopes, captions, linked media, .prproj import.', ['Keyframes', 'Titles', 'Colour', '.prproj']),
    tile(ROUTES.projects, 'folder', 'PROJECTS', 'Every project saved on this device, in the native .eyad format. Open, rename, duplicate, download or import.', ['.eyad', 'Local', 'Recent']),
    tile(ROUTES.settings, 'gear', 'SETTINGS', 'Workspace theme, UI scale, performance, pen pressure & gestures, autosave, storage.', ['Pen', 'Theme', 'Storage'])),
  h('section', { class: 'studio-section' },
    h('div', { class: 'studio-section-head' }, h('h2', { class: 'studio-section-title', text: 'Recent projects' }), h('a', { class: 'studio-btn is-small is-ghost', href: ROUTES.projects, text: 'All projects →' })),
    recentList),
  h('section', { class: 'hub-drop', 'aria-label': 'Drop files' },
    icon('upload', 22), h('div', {}, h('b', { text: 'Drop files anywhere on this page' }), h('p', { class: 'studio-dim studio-small', text: 'PSD, PNG, JPG, WebP, GIF, SVG → EYAD IMAGE · MP4, WebM, MOV*, MP3, WAV, .prproj → EYAD VIDEO · .eyad → the right editor' })), storage));
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7

bindPageDrop();

(async () => {
<<<<<<< HEAD
=======
  // Files shared to the installed app (Android share sheet) land here.
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  const q = new URLSearchParams(location.search);
  if (q.get('handoff')) {
    history.replaceState(null, '', location.pathname);
    const files = await takeHandoff(q.get('handoff')).catch(() => null);
    if (files && files.length) { routeFiles(files); return; }
  }
  cleanupOrphanMedia();
  let projects = [];
<<<<<<< HEAD
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
=======
  try { projects = await listProjects(); } catch (e) { recentList.replaceChildren(h('p', { class: 'studio-dim', text: 'Local storage is unavailable in this browser (private mode?). Projects can still be downloaded as .eyad files.' })); }
  const recent = projects.sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated)).slice(0, 8);
  if (!recent.length && projects !== null) recentList.replaceChildren(h('div', { class: 'studio-empty' }, h('h3', { text: 'No projects yet' }), h('p', { text: 'Create an image or a video — saved projects appear here.' })));
  else recentList.replaceChildren(...recent.map((p) => h('a', { class: 'hub-card', href: projectUrl(p) },
    thumbImg(p),
    h('div', { class: 'hub-card-meta' },
      h('div', { class: 'hub-card-name', text: p.name }),
      h('div', { class: 'hub-card-sub' }, h('span', { class: 'studio-badge is-muted', text: p.kind === 'video' ? 'Video' : p.kind === 'vector' ? 'Vector' : p.source === 'psd' ? 'PSD' : 'Image' }), h('span', { text: formatDate(p.updated) }))))));
  try {
    const rec = await listRecovery();
    if (rec.length) {
      notice.hidden = false;
      notice.replaceChildren(icon('warn', 16), h('span', { text: `Unsaved work was found (${rec.map((r) => r.name).join(', ')}).` }),
        ...(['image', 'video'].filter((k) => rec.some((r) => r.kind === k)).map((k) => h('a', { class: 'studio-btn is-small', href: k === 'image' ? ROUTES.image : ROUTES.video, text: `Restore in EYAD ${k.toUpperCase()}` }))));
    }
  } catch (e) { /* ignore */ }
  const s = await storageInfo().catch(() => null);
  if (s) storage.textContent = `${formatBytes(s.usage)} used${s.quota ? ' of ' + formatBytes(s.quota) : ''}${s.persisted ? ' · persistent' : ''}`;
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
})();
