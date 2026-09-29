// EYAD STUDIO — Projects (/studio/projects/).
import { h, formatDate, formatBytes, uid, timecode } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, promptDialog, confirmDialog, contextMenu, progressDialog, alertDialog } from '../core/ui.js';
import { ROUTES } from '../core/shell.js';
import { listProjects, loadProjectBlob, saveProject, renameProject, deleteProject, storageInfo, requestPersist, cleanupOrphanMedia, putMedia, getProject } from '../core/db.js';
import { chooseFiles } from '../core/open.js';
import { pickFiles, ACCEPT, downloadBlob, sanitizeFilename, detectFile } from '../core/files.js';
import { readEyad } from '../core/eyad.js';
import { page, routeFiles, bindPageDrop, projectUrl, thumbImg } from './common.js';

let all = [];
let filter = 'all', query = '', sort = 'updated';
const grid = h('div', { class: 'hub-grid' });
const countEl = h('span', { class: 'studio-dim studio-small' });
const storageEl = h('div', { class: 'hub-storage' });
const search = h('input', { class: 'studio-input hub-search', type: 'search', placeholder: 'Search projects', 'aria-label': 'Search projects' });
search.addEventListener('input', () => { query = search.value.toLowerCase(); render(); });
const sortSel = h('select', { class: 'studio-input hub-sort', 'aria-label': 'Sort' }, [['updated', 'Last modified'], ['opened', 'Recently opened'], ['name', 'Name'], ['size', 'Size']].map(([v, l]) => h('option', { value: v, text: l })));
sortSel.addEventListener('change', () => { sort = sortSel.value; render(); });
const FILTERS = [['all', 'All'], ['image', 'Image'], ['vector', 'Vector'], ['psd', 'PSD projects'], ['video', 'Video'], ['prproj', 'Premiere imports'], ['recent', 'Recent']];
const chips = h('div', { class: 'hub-chips', role: 'tablist' }, FILTERS.map(([k, l]) => h('button', { class: 'hub-chip', type: 'button', role: 'tab', dataset: { f: k }, text: l, onclick: () => { filter = k; render(); } })));

page('projects',
  h('section', { class: 'hub-pagehead' },
    h('div', {}, h('h1', { class: 'studio-page-title' }, 'PROJ', h('em', { text: 'ECTS' })), h('p', { class: 'studio-page-lede', text: 'Everything saved in this browser, as native .eyad projects. Download a project to back it up or move it to another device.' })),
    h('div', { class: 'hub-actions' },
      h('a', { class: 'studio-btn is-primary', href: ROUTES.image + '?new=1' }, icon('image', 16), 'New image'),
      h('a', { class: 'studio-btn', href: ROUTES.video + '?new=1' }, icon('video', 16), 'New video'),
      h('button', { class: 'studio-btn', type: 'button', onclick: importDialog }, icon('upload', 16), 'Import…'))),
  h('div', { class: 'hub-toolbar' }, chips, h('span', { class: 'studio-spacer' }), search, sortSel, countEl),
  grid,
  storageEl);

bindPageDrop('Drop .eyad to add to Projects');

async function load() {
  try { all = await listProjects(); } catch (e) { all = []; grid.replaceChildren(h('div', { class: 'studio-empty' }, h('h3', { text: 'Storage unavailable' }), h('p', { text: e.message }))); return; }
  render();
  renderStorage();
}

function render() {
  chips.querySelectorAll('.hub-chip').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.f === filter)));
  let list = all.filter((p) => {
    if (filter === 'image' && p.kind !== 'image') return false;
    if (filter === 'video' && p.kind !== 'video') return false;
    if (filter === 'vector' && p.kind !== 'vector') return false;
    if (filter === 'psd' && p.source !== 'psd') return false;
    if (filter === 'prproj' && p.source !== 'prproj') return false;
    if (filter === 'recent' && Date.now() - (p.opened || p.updated) > 14 * 86400000) return false;
    return !query || p.name.toLowerCase().includes(query);
  });
  const by = { updated: (a, b) => b.updated - a.updated, opened: (a, b) => (b.opened || 0) - (a.opened || 0), name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => (b.size || 0) - (a.size || 0) }[sort];
  list = list.sort(by);
  countEl.textContent = `${list.length} of ${all.length}`;
  if (!list.length) {
    grid.replaceChildren(h('div', { class: 'studio-empty' }, icon('folder', 28), h('h3', { text: all.length ? 'Nothing matches' : 'No projects yet' }),
      h('p', { text: all.length ? 'Try another filter or search.' : 'Create something, or import an .eyad file you downloaded earlier.' })));
    return;
  }
  grid.replaceChildren(...list.map(card));
}

function card(p) {
  const kind = p.kind === 'video' ? 'Video' : p.kind === 'vector' ? 'Vector' : 'Image';
  const src = { psd: 'PSD', prproj: 'Premiere', image: 'Image file' }[p.source];
  const menuBtn = h('button', { class: 'studio-icon-btn hub-card-menu', type: 'button', 'aria-label': 'Project actions for ' + p.name, onclick: (e) => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); menu(p, r.left, r.bottom); } }, icon('dots', 18));
  const a = h('a', { class: 'hub-card', href: projectUrl(p) },
    thumbImg(p),
    h('div', { class: 'hub-card-meta' },
      h('div', { class: 'hub-card-name', text: p.name, title: p.name }),
      h('div', { class: 'hub-card-sub' },
        h('span', { class: 'studio-badge is-muted', text: kind }),
        src ? h('span', { class: 'studio-badge', text: src }) : null,
        h('span', { text: p.kind === 'video' ? `${p.width}×${p.height} · ${timecode(p.duration || 0, 30).slice(0, 8)}` : `${p.width}×${p.height}` })),
      h('div', { class: 'hub-card-sub studio-faint' }, h('span', { text: 'Modified ' + formatDate(p.updated) }), h('span', { text: formatBytes(p.size || 0) }))),
    menuBtn);
  a.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(p, e.clientX, e.clientY); });
  return a;
}

function menu(p, x, y) {
  contextMenu(x, y, [
    { heading: p.name },
    { label: 'Open', action: () => { location.href = projectUrl(p); } },
    { label: 'Rename…', action: async () => { const n = await promptDialog('Rename project', 'Name', p.name); if (n) { await renameProject(p.id, sanitizeFilename(n, p.name)); load(); } } },
    { label: 'Duplicate', action: () => duplicate(p) },
    { label: 'Download .eyad', action: () => download(p) },
    { separator: true },
    { label: 'Delete…', action: async () => { if (await confirmDialog('Delete project', `Delete “${p.name}” from this device? This cannot be undone. (Download it first to keep a copy.)`, { ok: 'Delete', danger: true })) { await deleteProject(p.id); toast('Project deleted'); load(); } } },
  ]);
}

async function duplicate(p) {
  const blob = await loadProjectBlob(p.id);
  if (!blob) { toast('Project data missing.', { type: 'error' }); return; }
  const full = await getProject(p.id);
  await saveProject({ ...full, id: uid('p'), name: p.name + ' copy', created: Date.now(), opened: 0 }, blob);
  toast('Duplicated', { type: 'ok' });
  load();
}

async function download(p) {
  const blob = await loadProjectBlob(p.id);
  if (!blob) { toast('Project data missing.', { type: 'error' }); return; }
  downloadBlob(blob, sanitizeFilename(p.name) + '.eyad');
  if (p.kind === 'video') toast('Video media is not included in this quick download — open the project and use File ▸ Download .eyad to include media.', { timeout: 7000 });
}

async function importDialog() {
  const files = await chooseFiles({ title: 'Import', accept: '.eyad,' + ACCEPT.imageAll + ',' + ACCEPT.media + ',.prproj', multiple: true, recent: false });
  if (files.length) handle(files);
}

async function handle(files) {
  const eyads = [], others = [];
  for (const f of files) ((await detectFile(f)).kind === 'eyad' ? eyads : others).push(f);
  for (const f of eyads) {
    const prog = progressDialog('Importing ' + sanitizeFilename(f.name), { cancellable: false });
    try {
      const proj = await readEyad(f);
      const d = proj.document;
      let mediaIds = [];
      if (proj.manifest.kind === 'video' && Array.isArray(d.media)) {
        for (const m of d.media) {
          if (!m || typeof m.id !== 'string') continue;
          mediaIds.push(m.id);
          if (proj.has('media/' + m.id)) { prog.set(null, 'Storing ' + (m.name || 'media')); await putMedia(m.id, await proj.asset('media/' + m.id, m.mime || '')); m.stored = true; }
        }
      }
      const thumb = await proj.thumb();
      // re-pack only the document (media now lives in browser storage)
      const { writeEyad } = await import('../core/eyad.js');
      const assets = [];
      for (const path of proj.entries()) if (path.startsWith('assets/')) assets.push({ path, blob: await proj.asset(path) });
      const blob = await writeEyad({ kind: proj.manifest.kind, name: proj.manifest.name || d.name, document: d, assets, thumb, created: proj.manifest.created });
      await saveProject({ id: uid('p'), name: sanitizeFilename(proj.manifest.name || d.name || f.name.replace(/\.eyad$/i, ''), 'Imported project'), kind: proj.manifest.kind, source: d.meta?.source || 'eyad', created: proj.manifest.created, width: d.width || d.sequences?.[0]?.width || 0, height: d.height || d.sequences?.[0]?.height || 0, thumb, mediaIds }, blob);
      toast('Imported ' + f.name, { type: 'ok' });
    } catch (e) { alertDialog('Could not import project', e.message, { detail: sanitizeFilename(f.name) }); }
    finally { prog.close(); }
  }
  if (eyads.length) load();
  if (others.length) routeFiles(others);
}

addEventListener('drop', (e) => {
  // .eyad drops are imported here; everything else is routed by the shared handler
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  const files = Array.from(e.dataTransfer.files);
  if (files.every((f) => /\.eyad$/i.test(f.name))) { e.stopImmediatePropagation(); e.preventDefault(); document.querySelector('.studio-drop')?.classList.remove('is-on'); handle(files); }
}, true);

async function renderStorage() {
  const s = await storageInfo().catch(() => null);
  storageEl.replaceChildren(
    h('div', { class: 'hub-storage-info' }, icon('info', 16),
      h('span', { text: s ? `This browser is using ${formatBytes(s.usage)}${s.quota ? ` of about ${formatBytes(s.quota)}` : ''} for Studio data.` : 'Storage usage is not available in this browser.' }),
      s && !s.persisted ? h('span', { class: 'studio-faint', text: 'Browsers may clear non-persistent storage when space runs low.' }) : s ? h('span', { class: 'studio-badge is-ok', text: 'Persistent' }) : null),
    h('div', { class: 'hub-actions' },
      s && !s.persisted ? h('button', { class: 'studio-btn is-small', type: 'button', text: 'Make storage persistent', onclick: async () => { const ok = await requestPersist(); toast(ok ? 'Storage is now persistent' : 'The browser declined — install the Studio app or bookmark it to improve the chance.', { type: ok ? 'ok' : 'warn', timeout: 5000 }); renderStorage(); } }) : null,
      h('button', { class: 'studio-btn is-small', type: 'button', text: 'Clean up unused media', onclick: async () => { const n = await cleanupOrphanMedia(); toast(n ? `Removed ${n} unused media file(s)` : 'Nothing to clean up', { type: 'ok' }); renderStorage(); } })));
}

load();
