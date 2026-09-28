// EYAD STUDIO — home (/studio/).
import { h, formatDate, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ROUTES } from '../core/shell.js';
import { listProjects, listRecovery, storageInfo, cleanupOrphanMedia } from '../core/db.js';
import { pickFiles, ACCEPT } from '../core/files.js';
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
    h('p', { class: 'studio-page-lede', text: 'My own image and video editor, built into my portfolio. Layers, brushes and PSD import; a real timeline with trims, effects and Premiere project import. Everything runs in your browser — your files never leave this device.' }),
    h('div', { class: 'hub-actions' },
      h('a', { class: 'studio-btn is-primary', href: ROUTES.image + '?new=1' }, icon('image', 16), 'New image'),
      h('a', { class: 'studio-btn', href: ROUTES.image + '?psd=1' }, icon('layers', 16), 'Open PSD'),
      h('a', { class: 'studio-btn', href: ROUTES.video + '?new=1' }, icon('video', 16), 'New video'),
      h('button', { class: 'studio-btn is-ghost', type: 'button', onclick: async () => { const f = await pickFiles({ accept: ACCEPT.imageAll + ',' + ACCEPT.media + ',.prproj', multiple: true }); if (f.length) routeFiles(f); } }, icon('upload', 16), 'Open any file…'))),
  notice,
  h('section', { class: 'hub-apps', 'aria-label': 'Studio apps' },
    tile(ROUTES.image, 'image', 'IMAGE', 'Layered image editor: 15 working tools, masks, blend modes, adjustments & filters, real PSD import, PNG/JPEG/WebP and experimental PSD export.', ['Layers', 'PSD', 'Brush', 'Text', 'Filters']),
    tile(ROUTES.video, 'video', 'VIDEO', 'Timeline editor: multiple video & audio tracks, trim, split, snapping, markers, effects, fades, waveforms, WebM/MP4 & WAV export, .prproj import with relinking.', ['Timeline', 'Effects', 'Audio', '.prproj']),
    tile(ROUTES.projects, 'folder', 'PROJECTS', 'Every project saved on this device, in the native .eyad format. Open, rename, duplicate, download or import.', ['.eyad', 'Local', 'Recent']),
    tile(ROUTES.settings, 'gear', 'SETTINGS', 'Theme, autosave & recovery, default sizes, storage management.', ['Autosave', 'Theme', 'Storage'])),
  h('section', { class: 'studio-section' },
    h('div', { class: 'studio-section-head' }, h('h2', { class: 'studio-section-title', text: 'Recent projects' }), h('a', { class: 'studio-btn is-small is-ghost', href: ROUTES.projects, text: 'All projects →' })),
    recentList),
  h('section', { class: 'hub-drop', 'aria-label': 'Drop files' },
    icon('upload', 22), h('div', {}, h('b', { text: 'Drop files anywhere on this page' }), h('p', { class: 'studio-dim studio-small', text: 'PSD, PNG, JPG, WebP, GIF, SVG → EYAD IMAGE · MP4, WebM, MOV*, MP3, WAV, .prproj → EYAD VIDEO · .eyad → the right editor' })), storage));

bindPageDrop();

(async () => {
  cleanupOrphanMedia();
  let projects = [];
  try { projects = await listProjects(); } catch (e) { recentList.replaceChildren(h('p', { class: 'studio-dim', text: 'Local storage is unavailable in this browser (private mode?). Projects can still be downloaded as .eyad files.' })); }
  const recent = projects.sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated)).slice(0, 8);
  if (!recent.length && projects !== null) recentList.replaceChildren(h('div', { class: 'studio-empty' }, h('h3', { text: 'No projects yet' }), h('p', { text: 'Create an image or a video — saved projects appear here.' })));
  else recentList.replaceChildren(...recent.map((p) => h('a', { class: 'hub-card', href: projectUrl(p) },
    thumbImg(p),
    h('div', { class: 'hub-card-meta' },
      h('div', { class: 'hub-card-name', text: p.name }),
      h('div', { class: 'hub-card-sub' }, h('span', { class: 'studio-badge is-muted', text: p.kind === 'video' ? 'Video' : p.source === 'psd' ? 'PSD' : 'Image' }), h('span', { text: formatDate(p.updated) }))))));
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
