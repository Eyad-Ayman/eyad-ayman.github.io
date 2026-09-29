// EYAD STUDIO — home (/studio/).
import { h, formatDate, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ROUTES } from '../core/shell.js';
import { listProjects, listRecovery, storageInfo, cleanupOrphanMedia, takeHandoff } from '../core/db.js';
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

bindPageDrop();

(async () => {
  // Files shared to the installed app (Android share sheet) land here.
  const q = new URLSearchParams(location.search);
  if (q.get('handoff')) {
    history.replaceState(null, '', location.pathname);
    const files = await takeHandoff(q.get('handoff')).catch(() => null);
    if (files && files.length) { routeFiles(files); return; }
  }
  cleanupOrphanMedia();
  let projects = [];
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
})();
