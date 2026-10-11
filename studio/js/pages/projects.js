// EYAD STUDIO — Projects (/studio/projects/).
import { h, formatDate, formatBytes, uid, timecode } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, promptDialog, confirmDialog, contextMenu, progressDialog, alertDialog } from '../core/ui.js';
import { ROUTES } from '../core/shell.js';
import { listProjects, loadProjectBlob, saveProject, renameProject, deleteProject, storageInfo, requestPersist, cleanupOrphanMedia, putMedia, getProject, dbSelfTest } from '../core/db.js';
import { chooseFiles } from '../core/open.js';
import { ACCEPT, downloadBlob, savedToast, sanitizeFilename, detectFile, IS_TOUCH } from '../core/files.js';
// small buttons stay tappable on phones (≥ 44 px)
const SMALL_BTN = IS_TOUCH ? 'studio-btn' : 'studio-btn is-small';
const TAP = IS_TOUCH ? { minHeight: '44px' } : {};
import { readEyad, peekEyad } from '../core/eyad.js';
import { readZip } from '../core/zip.js';
import { page, routeFiles, bindPageDrop, projectUrl, thumbImg } from './common.js';

let all = [];
let filter = 'all', query = '', sort = 'updated';
const grid = h('div', { class: 'hub-grid' });
const countEl = h('span', { class: 'studio-dim studio-small', style: { flex: 'none', whiteSpace: 'nowrap' } });
const storageEl = h('div', { class: 'hub-storage' });
const search = h('input', { class: 'studio-input hub-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search projects', autocomplete: 'off', style: { flex: '1 1 140px', minWidth: '0', width: 'auto' } });
search.addEventListener('input', () => { query = search.value.toLowerCase(); render(); });
const sortSel = h('select', { class: 'studio-input hub-sort', 'aria-label': 'Sort by', style: { flex: '0 1 132px', minWidth: '0', width: 'auto' } }, [['updated', 'Modified'], ['opened', 'Opened'], ['name', 'Name'], ['size', 'Size']].map(([v, l]) => h('option', { value: v, text: l })));
sortSel.addEventListener('change', () => { sort = sortSel.value; render(); });
const FILTERS = [['all', 'All'], ['image', 'Image'], ['vector', 'Vector'], ['3d', '3D'], ['psd', 'PSD projects'], ['video', 'Video'], ['prproj', 'Premiere imports'], ['recent', 'Recent']];
const chips = h('div', { class: 'hub-chips', role: 'tablist' }, FILTERS.map(([k, l]) => h('button', { class: 'hub-chip', type: 'button', role: 'tab', dataset: { f: k }, text: l, onclick: () => { filter = k; render(); } })));

page('projects',
  h('section', { class: 'hub-pagehead' },
    h('div', {}, h('h1', { class: 'studio-page-title' }, 'Projects'), h('p', { class: 'studio-page-lede', text: 'Everything saved in this browser, as native .eyad projects. Download a project to back it up or move it to another device.' })),
    h('div', { class: 'hub-actions' },
      h('a', { class: 'studio-btn is-primary', href: ROUTES.image + '?new=1' }, icon('image', 16), 'New image'),
      h('a', { class: 'studio-btn', href: ROUTES.video + '?new=1' }, icon('video', 16), 'New video'),
      h('button', { class: 'studio-btn', type: 'button', onclick: importDialog }, icon('upload', 16), 'Import…'))),
  h('div', { class: 'hub-toolbar' }, chips,
    // search + sort + count share one row that takes the full width on phones (margin-left:auto, not a spacer: a spacer wraps and indents it)
    h('div', { class: 'hub-find', style: { display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 300px', maxWidth: '460px', minWidth: '0', marginLeft: 'auto' } }, search, sortSel, countEl)),
  grid,
  storageEl);

bindPageDrop('Drop .eyad to add to Projects');

async function load() {
  try { all = await listProjects(); } catch (e) {
    all = [];
    grid.replaceChildren(h('div', { class: 'studio-empty' }, h('h3', { text: 'Storage unavailable' }), h('p', { text: e.message }),
      h('p', { class: 'studio-dim studio-small', text: 'You can still work: use “Download .eyad” inside each app to keep your projects as files.' })));
    countEl.textContent = '';
    renderStorage();
    return;
  }
  render();
  renderStorage();
}

function render() {
  chips.querySelectorAll('.hub-chip').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.f === filter)));
  let list = all.filter((p) => {
    if (filter === 'image' && p.kind !== 'image') return false;
    if (filter === 'video' && p.kind !== 'video') return false;
    if (filter === 'vector' && p.kind !== 'vector') return false;
    if (filter === '3d' && p.kind !== '3d') return false;
    if (filter === 'psd' && p.source !== 'psd') return false;
    if (filter === 'prproj' && p.source !== 'prproj') return false;
    if (filter === 'recent' && Date.now() - (p.opened || p.updated) > 14 * 86400000) return false;
    return !query || String(p.name || '').toLowerCase().includes(query);
  });
  const by = { updated: (a, b) => b.updated - a.updated, opened: (a, b) => (b.opened || 0) - (a.opened || 0), name: (a, b) => String(a.name).localeCompare(String(b.name)), size: (a, b) => (b.size || 0) - (a.size || 0) }[sort];
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
  const kind = p.kind === 'video' ? 'Video' : p.kind === 'vector' ? 'Vector' : p.kind === '3d' ? '3D' : 'Image';
  const src = { psd: 'PSD', prproj: 'Premiere', image: 'Image file' }[p.source];
  const menuBtn = h('button', { class: 'studio-icon-btn hub-card-menu', type: 'button', style: { minWidth: '44px', minHeight: '44px' }, 'aria-label': 'Project actions for ' + p.name, onclick: (e) => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); menu(p, r.left, r.bottom); } }, icon('dots', 18));
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
    { label: 'Rename…', action: async () => { const n = await promptDialog('Rename project', 'Name', p.name); if (n) { try { await renameProject(p.id, sanitizeFilename(n, p.name)); } catch (e) { toast('Could not rename', { type: 'error', detail: e.message }); } load(); } } },
    { label: 'Duplicate', action: () => duplicate(p) },
    { label: 'Download .eyad', action: () => download(p) },
    { separator: true },
    { label: 'Delete…', action: async () => { if (await confirmDialog('Delete project', `Delete “${p.name}” from this device? This cannot be undone. (Download it first to keep a copy.)`, { ok: 'Delete', danger: true })) { try { await deleteProject(p.id); toast('Project deleted'); } catch (e) { toast('Could not delete', { type: 'error', detail: e.message }); } load(); } } },
  ]);
}

async function duplicate(p) {
  try {
    const blob = await loadProjectBlob(p.id);
    if (!blob) { toast('Project data missing.', { type: 'error' }); return; }
    const full = await getProject(p.id);
    await saveProject({ ...full, id: uid('p'), name: p.name + ' copy', created: Date.now(), opened: 0 }, blob);
    toast('Duplicated', { type: 'ok' });
  } catch (e) { toast('Could not duplicate', { type: 'error', detail: e.message }); }
  load();
}

async function download(p) {
  let blob = null;
  try { blob = await loadProjectBlob(p.id); } catch (e) { toast('Could not read the project', { type: 'error', detail: e.message }); return; }
  if (!blob) { toast('Project data missing.', { type: 'error' }); return; }
  // reading from storage takes milliseconds, so the tap is still fresh for the share sheet on iPhone
  const r = await savedToast(downloadBlob(blob, sanitizeFilename(p.name) + '.eyad'), 'Project file downloaded.');
  if (p.kind === 'video' && r && r.status !== 'cancelled') toast('Video media is not included in this quick download — open the project and use File ▸ Download .eyad to include media.', { timeout: 7000 });
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
      const peek = await peekEyad(f);
      if (peek && peek.kind === '3d') {
        // 3D scenes are stored exactly as they are (the 3D app reads its own document)
        let thumb = null;
        try { const e = (await readZip(f)).get('thumb.png'); thumb = e ? await e.blob('image/png') : null; } catch (x) { /* no thumbnail */ }
        await saveProject({ id: uid('p'), name: sanitizeFilename(peek.name || f.name.replace(/\.eyad$/i, ''), 'Imported scene'), kind: '3d', source: 'new', created: peek.created, thumb }, f.slice(0, f.size, 'application/octet-stream'));
        toast('Imported ' + sanitizeFilename(f.name), { type: 'ok' });
        continue;
      }
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
      toast('Imported ' + sanitizeFilename(f.name), { type: 'ok' });
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

let selfTest = null;
async function renderStorage({ retest = false } = {}) {
  if (!selfTest || retest) selfTest = await dbSelfTest().catch((e) => ({ ok: false, reason: e.message }));
  const s = await storageInfo({ detail: true }).catch(() => null);
  const t = selfTest;
  const line = (ic, attrs, ...kids) => h('div', { class: 'hub-storage-info', ...attrs, style: { display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-start', gap: '8px' } },
    h('span', { style: { flex: 'none', display: 'inline-flex', paddingTop: '2px' } }, icon(ic, 16)), h('span', { style: { minWidth: '0' } }, ...kids));
  const lines = [];
  lines.push(line(t.ok ? 'check' : 'warn', { dataset: { storage: t.ok ? 'ok' : 'bad' } },
    h('strong', { text: t.ok ? 'Storage works on this device.' : 'Storage is not working on this device.' }), t.ok ? null : ' ' + (t.reason || '')));
  if (t.ok && t.blobs === 'buffer') lines.push(line('info', {}, 'This device cannot keep files in storage the fast way, so a compatibility mode is used. Very large projects may save slowly.'));
  if (t.note) lines.push(line('warn', {}, t.note));
  if (t.ok && s && s.estimate) lines.push(line('info', {}, `Studio data here: ${formatBytes(s.usage)}${s.quota ? ` of about ${formatBytes(s.quota)}` : ''}.`));
  if (t.ok) {
    let keep = '';
    if (s && s.persisted === true) keep = 'Protected: the browser will not clear it on its own.';
    else if (s && s.ios && !s.installed) keep = 'Safari deletes the data of sites that were not opened for 7 days. Add the Studio to your Home Screen (Share ▸ Add to Home Screen) and download projects you care about as .eyad files.';
    else if (s && s.ios) keep = 'Installed on the Home Screen, so Safari’s 7-day clean-up does not apply. Still download projects you care about as .eyad files.';
    else keep = 'Not protected: the browser may clear it when the device runs low on space. Download projects you care about as .eyad files.';
    lines.push(line(s && s.persisted === true ? 'check' : 'info', { dataset: { persist: s && s.persisted === true ? 'yes' : 'no' } }, keep));
  }
  const canAsk = t.ok && !!(navigator.storage && navigator.storage.persist) && !(s && s.persisted === true);
  storageEl.replaceChildren(
    h('div', { class: 'hub-storage-lines', style: { display: 'grid', gap: '8px', flex: '1 1 260px', minWidth: '0' } }, lines),
    h('div', { class: 'hub-actions' },
      canAsk ? h('button', { class: SMALL_BTN, style: TAP, type: 'button', text: 'Protect my data', onclick: async () => { const ok = await requestPersist(); toast(ok ? 'The browser will keep Studio data.' : 'The browser declined — add the Studio to the Home Screen / install it, then try again.', { type: ok ? 'ok' : 'warn', timeout: 5000 }); renderStorage(); } }) : null,
      h('button', { class: SMALL_BTN, style: TAP, type: 'button', text: 'Test storage', onclick: async () => { await renderStorage({ retest: true }); toast(selfTest.ok ? 'Storage works on this device.' : 'Storage is not working.', { type: selfTest.ok ? 'ok' : 'error', detail: selfTest.ok ? '' : selfTest.reason }); } }),
      h('button', { class: SMALL_BTN, style: TAP, type: 'button', text: 'Clean up unused media', onclick: async () => { const n = await cleanupOrphanMedia(); toast(n ? `Removed ${n} unused media file(s)` : 'Nothing to clean up', { type: 'ok' }); renderStorage(); } })));
}

load();
