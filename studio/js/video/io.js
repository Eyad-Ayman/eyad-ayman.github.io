// EYAD VIDEO — projects: new/open/save, .eyad, .prproj import, media
// hand-off, autosave & crash recovery.
import { h, formatDate, uid, formatBytes } from '../core/dom.js';
import { toast, dialog, formDialog, promptDialog, progressDialog, alertDialog, confirmDialog } from '../core/ui.js';
import { getSettings } from '../core/settings.js';
import { chooseFiles } from '../core/open.js';
import { detectFile, pickFiles, ACCEPT, downloadBlob, sanitizeFilename, LIMITS } from '../core/files.js';
import { writeEyad, readEyad } from '../core/eyad.js';
import { saveProject, loadProjectBlob, touchProject, getProject, putRecovery, listRecovery, delRecovery, putHandoff, takeHandoff, putMedia, getMedia } from '../core/db.js';
import { ROUTES } from '../core/shell.js';
import { showReport } from '../core/docs.js';
import { createProject, createSequence, serializeProject, deserializeProject, seqDuration } from './model.js';

// ================================================================= lifecycle

async function confirmDiscard(app) {
  if (!app.project || !app.history.dirty) return true;
  const v = await dialog({
    title: 'Save changes?', body: h('p', { text: `“${app.project.name}” has unsaved changes.` }),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Don’t save', value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
  });
  if (!v) return false;
  if (v === 'save') return save(app);
  delRecovery(app.project.id).catch(() => {});
  return true;
}

export async function newProject(app, { quiet = false, width = null, height = null, fps: fpsIn = null, name: nameIn = null } = {}) {
  if (!(await confirmDiscard(app))) return false;
  const s = getSettings();
  let name = nameIn || 'Untitled project', w = width || s.videoWidth, hh = height || s.videoHeight, fps = fpsIn || s.videoFps;
  if (!quiet) {
    const v = await formDialog({
      title: 'New video project', ok: 'Create',
      fields: [
        { key: 'name', label: 'Name', type: 'text', value: name, maxLength: 120 },
        { key: 'size', label: 'Frame size', type: 'select', value: `${w}x${hh}`, options: ['3840x2160', '2560x1440', '1920x1080', '1280x720', '1080x1920', '1080x1350', '1080x1080', `${w}x${hh}`].filter((x, i, a) => a.indexOf(x) === i).map((x) => ({ value: x, label: x.replace('x', ' × ') + ({ '1080x1920': ' (vertical / Reels)', '1080x1080': ' (square)', '3840x2160': ' (4K)' }[x] || '') })) },
        { key: 'fps', label: 'Frame rate', type: 'select', value: String(fps), options: ['23.976', '24', '25', '29.97', '30', '50', '60'].map((x) => ({ value: x, label: x + ' fps' })) },
      ],
    });
    if (!v) return false;
    name = sanitizeFilename(v.name || name, 'Untitled project'); [w, hh] = v.size.split('x').map(Number); fps = Number(v.fps);
  }
  app.importReport = null;
  app.setProject(createProject({ name, width: w, height: hh, fps }), { clean: true });
  app.history.savedSeq = app.history.currentSeq;
  app.updateChrome();
  return true;
}

export async function closeProject(app) {
  if (!(await confirmDiscard(app))) return;
  app.engine.pause(); app.engine.releaseAll(); app.media.release();
  app.project = null; app.projectId = null; app.history.clear();
  app.emptyEl.hidden = false;
  app.refreshAll();
  updateUrl(app);
}

export async function renameProject(app) {
  if (!app.project) return;
  const n = await promptDialog('Rename project', 'Name', app.project.name);
  if (n) { app.project.name = sanitizeFilename(n, 'Untitled project'); markDirty(app); app.updateChrome(); }
}

export function switchSequence(app, id) {
  if (!app.project || app.project.activeSeq === id) return;
  app.engine.pause(); app.engine.releaseAll();
  app.project.activeSeq = id;
  app.selection = new Set();
  app.history.clear(); // history is per sequence snapshot
  app.engine.seek(0);
  app.layoutMonitor();
  app.refreshAll();
  requestAnimationFrame(() => app.timeline.fit());
  markDirty(app);
}
export async function newSequence(app) {
  const s = app.seq;
  const n = await promptDialog('New sequence', 'Name', 'Sequence ' + String(app.project.sequences.length + 1).padStart(2, '0'));
  if (!n) return;
  const seq = createSequence({ name: n, width: s.width, height: s.height, fps: s.fps });
  app.project.sequences.push(seq);
  switchSequence(app, seq.id);
}

// ================================================================= open

export async function openDialog(app, kind = 'any') {
  const accept = kind === 'prproj' ? ACCEPT.prproj : '.eyad,.prproj,' + ACCEPT.media;
  const files = await chooseFiles({ title: kind === 'prproj' ? 'Import Premiere project' : 'Open', accept, multiple: kind !== 'prproj', media: 'video', camera: false });
  if (files.length) handleFiles(app, files);
}

export async function handleFiles(app, files) {
  const media = [];
  for (const f of files) {
    let info;
    try { info = await detectFile(f); } catch (e) { toast('Could not read ' + sanitizeFilename(f.name), { type: 'error' }); continue; }
    if (info.kind === 'prproj') await openPrproj(app, f);
    else if (info.kind === 'eyad') await openEyadFile(app, f);
    else if (['video', 'audio', 'image'].includes(info.kind)) media.push(f);
    else if (info.kind === 'psd') {
      toast(`${sanitizeFilename(f.name)} is a PSD — open it in EYAD IMAGE?`, { timeout: 9000, action: { label: 'Open in Image', fn: async () => { const id = await putHandoff([f]); location.href = ROUTES.image + '?handoff=' + id; } } });
    } else {
      await alertDialog('Unsupported file', `“${sanitizeFilename(f.name)}” was not imported.`, { detail: `Detected: ${info.label}. Supported: MP4, WebM, MOV*, MP3, WAV, AAC*, images, .eyad, .prproj.` });
    }
  }
  if (media.length) await app.importFiles(media);
}

async function openPrproj(app, f) {
  if (f.size > LIMITS.prproj) { alertDialog('Could not open project', 'The .prproj file is too large to parse in the browser.'); return; }
  if (!(await confirmDiscard(app))) return;
  const { importPrproj } = await import('./prproj.js');
  const p = progressDialog('Importing ' + sanitizeFilename(f.name), { cancellable: false });
  let res;
  try { res = await importPrproj(f, { onProgress: (fr, t) => p.set(fr, t) }); }
  catch (e) { p.close(); alertDialog('Could not import Premiere project', 'Reason: ' + e.message, { detail: sanitizeFilename(f.name) }); return; }
  p.close();
  app.importReport = res.report;
  app.setProject(res.project, { clean: false });
  const off = res.project.media.filter((m) => m.offline).length;
  const v = await showReport(res.report, off ? [{ label: 'Later', value: 'later' }, { label: `Relink media (${off} offline)`, value: 'relink', primary: true }] : [{ label: 'Continue', value: true, primary: true }]);
  if (v === 'relink') app.relinkDialog();
}

export function showImportReport(app) { if (app.importReport) showReport(app.importReport, [{ label: 'Close', value: true, primary: true }]); }

async function loadFromEyad(app, proj, { projectId = null, recovered = false } = {}) {
  const p = deserializeProject(proj.document);
  // embedded media first, then media stored in this browser
  for (const m of p.media) {
    const path = 'media/' + m.id;
    if (proj.has(path)) {
      const blob = await proj.asset(path, m.mime || '');
      if (blob) {
        await app.media.setBlob(m, blob);
        m.offline = false;
        if (getSettings().storeMedia) { try { await putMedia(m.id, blob); m.stored = true; } catch (e) { m.stored = false; } }
      }
    }
  }
  const missing = await app.media.attachAll(p);
  app.importReport = null;
  app.setProject(p, { projectId, recovered, clean: !recovered });
  if (missing.length) {
    toast(`${missing.length} media file(s) are offline`, { type: 'warn', timeout: 9000, action: { label: 'Relink', fn: () => app.relinkDialog() } });
  }
  return p;
}

async function openEyadFile(app, f) {
  if (f.size > LIMITS.eyad) { toast('Project is too large.', { type: 'error' }); return; }
  const p = progressDialog('Opening ' + sanitizeFilename(f.name), { cancellable: false });
  p.set(null, 'Reading project…');
  try {
    const proj = await readEyad(f);
    if (proj.manifest.kind === 'image') {
      p.close();
      const id = await putHandoff([f]);
      toast('This is an image project — opening EYAD IMAGE…', { timeout: 2000 });
      setTimeout(() => { location.href = ROUTES.image + '?handoff=' + id; }, 600);
      return;
    }
    p.close();
    if (!(await confirmDiscard(app))) return;
    await loadFromEyad(app, proj);
    toast('Opened ' + app.project.name, { type: 'ok', timeout: 1600 });
  } catch (e) {
    p.close();
    alertDialog('Could not open project', e.message, { detail: sanitizeFilename(f.name) });
  }
}

export async function openProject(app, id) {
  if (app.projectId === id) return;
  if (!(await confirmDiscard(app))) return;
  const p = progressDialog('Opening project', { cancellable: false });
  p.set(null, 'Loading from this device…');
  try {
    const blob = await loadProjectBlob(id);
    if (!blob) throw new Error('This project was not found in local storage.');
    const proj = await readEyad(blob);
    if (proj.manifest.kind !== 'video') { p.close(); location.href = ROUTES.image + '?project=' + encodeURIComponent(id); return; }
    p.close();
    await loadFromEyad(app, proj, { projectId: id });
    const meta = await getProject(id).catch(() => null);
    if (meta && meta.name && app.project) { app.project.name = meta.name; app.updateChrome(); }
    touchProject(id);
  } catch (e) { p.close(); alertDialog('Could not open project', e.message); }
}

// ================================================================= save

function projectJson(app) {
  const j = serializeProject(app.project);
  for (const m of j.media) { delete m.analysing; delete m.relinkedDuration; }
  return j;
}

async function thumbBlob(app) {
  const s = app.seq;
  const c = document.createElement('canvas');
  const k = Math.min(1, 360 / Math.max(s.width, s.height));
  c.width = Math.max(1, Math.round(s.width * k)); c.height = Math.max(1, Math.round(s.height * k));
  try { app.engine.drawFrame(c.getContext('2d'), c.width, c.height, app.engine.time); } catch (e) { /* ignore */ }
  return new Promise((r) => c.toBlob((b) => r(b), 'image/png'));
}

export async function buildEyad(app, { embedMedia = false, onProgress } = {}) {
  const assets = [];
  if (embedMedia) {
    let i = 0;
    for (const m of app.project.media) {
      i++;
      if (m.offline) continue;
      const r = app.media.rt.get(m.id);
      const blob = r ? r.blob : await getMedia(m.id);
      if (blob) { onProgress && onProgress(i / app.project.media.length, 'Packing ' + m.name); assets.push({ path: 'media/' + m.id, blob, compress: false }); }
    }
  }
  const thumb = await thumbBlob(app);
  const blob = await writeEyad({ kind: 'video', name: app.project.name, document: projectJson(app), assets, thumb, created: app.project.created });
  return { blob, thumb };
}

export async function save(app, { silent = false } = {}) {
  if (!app.project) return false;
  if (!app.projectId) return saveAs(app);
  return writeProject(app, { silent });
}
export async function saveAs(app) {
  if (!app.project) return false;
  const name = await promptDialog('Save project', 'Project name', app.project.name, { ok: 'Save' });
  if (!name) return false;
  app.project.name = sanitizeFilename(name, 'Untitled project');
  const old = app.projectId;
  app.projectId = uid('p');
  const ok = await writeProject(app, {});
  if (!ok) app.projectId = old;
  updateUrl(app);
  return ok;
}

async function writeProject(app, { silent }) {
  if (app.saving) return app.saving;
  const seq = app.history.currentSeq;
  app.saving = (async () => {
    app.saveState = 'saving'; updateSaveIndicator(app);
    try {
      // make sure every online media file is persisted locally
      const unstored = app.project.media.filter((m) => !m.stored && !m.offline);
      if (unstored.length && getSettings().storeMedia) {
        for (const m of unstored) { const r = app.media.rt.get(m.id); if (r) { try { await putMedia(m.id, r.blob); m.stored = true; } catch (e) { /* quota */ } } }
      }
      const { blob, thumb } = await buildEyad(app);
      const s = app.seq;
      await saveProject({ id: app.projectId, name: app.project.name, kind: 'video', source: app.project.meta?.source || 'eyad', created: app.project.created, width: s.width, height: s.height, duration: seqDuration(s), thumb, mediaIds: app.project.media.map((m) => m.id) }, blob);
      if (app.history.currentSeq === seq) app.history.savedSeq = seq;
      app.dirtyMeta = false;
      app.recovered = false;
      app.saveState = 'saved';
      await delRecovery(app.project.id);
      app.autosavedSeq = seq;
      if (!silent) toast('Saved to Projects on this device', { type: 'ok', timeout: 1600, detail: app.project.media.some((m) => !m.stored) ? 'Some media is not stored in the browser and will need relinking.' : '' });
      return true;
    } catch (e) {
      app.saveState = 'error';
      toast('Save failed', { type: 'error', detail: e.message || 'Storage may be full.' });
      return false;
    } finally { app.saving = null; app.updateChrome(); }
  })();
  return app.saving;
}

export async function downloadEyad(app) {
  if (!app.project) return;
  const online = app.project.media.filter((m) => !m.offline);
  const total = online.reduce((a, m) => a + (m.size || 0), 0);
  const v = await formDialog({
    title: 'Download .eyad project', ok: 'Download',
    fields: [{ key: 'embed', label: 'Include media files', type: 'checkbox', value: total < 1.5e9, hint: online.length ? `${online.length} file(s), about ${formatBytes(total)}. Without media, the project opens with media offline until relinked.` : 'No online media.' }],
  });
  if (!v) return;
  const p = progressDialog('Packing project', { cancellable: false });
  try {
    const { blob } = await buildEyad(app, { embedMedia: v.embed, onProgress: (f, t) => p.set(f, t) });
    downloadBlob(blob, sanitizeFilename(app.project.name) + '.eyad');
  } catch (e) { toast('Could not create the project file', { type: 'error', detail: e.message }); }
  finally { p.close(); }
}

// ================================================================= autosave

let timer = 0, running = false;
export function startAutosave(app) { clearInterval(timer); timer = setInterval(() => autosaveNow(app), Math.max(5, getSettings().autosaveSeconds) * 1000); }
export function markDirty(app) { app.dirtyMeta = true; if (app.history.savedSeq === app.history.currentSeq && app.project) app.history.savedSeq = -2; app.updateChrome && updateSaveIndicator(app); }
export async function autosaveNow(app) {
  const s = getSettings();
  if (!s.autosave || running || !app.project || app.engine.exporting) return;
  if (!app.history.dirty) return;
  if (app.autosavedSeq === app.history.currentSeq && !app.dirtyMeta) return;
  running = true;
  try {
    if (app.projectId && s.autosaveProjects) await writeProject(app, { silent: true });
    else {
      const seq = app.history.currentSeq;
      const { blob } = await buildEyad(app);
      await putRecovery({ id: app.project.id, kind: 'video', name: app.project.name, projectId: app.projectId, blob, mediaIds: app.project.media.map((m) => m.id) });
      app.autosavedSeq = seq; app.dirtyMeta = false;
      app.recoveryAt = Date.now();
    }
  } catch (e) { console.warn('Autosave failed', e); }
  finally { running = false; updateSaveIndicator(app); }
}

export function updateSaveIndicator(app) {
  let state = 'idle', text = 'No project';
  if (app.project) {
    if (app.saving) { state = 'saving'; text = 'Saving…'; }
    else if (app.saveState === 'error') { state = 'error'; text = 'Save failed'; }
    else if (app.recovered && app.history.dirty) { state = 'recovered'; text = 'Recovered project — save to keep'; }
    else if (app.history.dirty) { state = 'dirty'; text = app.recoveryAt ? `Unsaved changes · recovery copy ${new Date(app.recoveryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Unsaved changes'; }
    else if (app.projectId) { state = 'saved'; text = 'Saved'; }
    else { state = 'idle'; text = 'Not saved yet'; }
  }
  app.saveInd.set(state, text);
}

async function offerRecovery(app) {
  let entries;
  try { entries = await listRecovery('video'); } catch (e) { return false; }
  if (!entries.length) return false;
  const e = entries[0];
  const v = await dialog({
    title: 'Recovered Project', dismissable: false,
    body: h('div', { class: 'studio-stack' }, h('p', { text: 'EYAD VIDEO closed before this project was saved. Restore it?' }), h('ul', { class: 'studio-list' }, entries.map((x) => h('li', { text: `${x.name} — ${formatDate(x.time)}` })))),
    buttons: [{ label: 'Discard', value: 'discard', danger: true }, { label: 'Restore', value: 'restore', primary: true }],
  });
  if (v === 'restore') {
    try {
      const proj = await readEyad(e.blob);
      await loadFromEyad(app, proj, { projectId: e.projectId || null, recovered: true });
      toast('Recovered — save to keep your work.', { type: 'ok' });
    } catch (err) { toast('The recovered project could not be restored', { type: 'error', detail: err.message }); }
    for (const x of entries.slice(1)) await delRecovery(x.id);
    return true;
  }
  for (const x of entries) await delRecovery(x.id);
  return false;
}

export function updateUrl(app) {
  const u = new URL(location.href);
  ['handoff', 'new', 'import'].forEach((k) => u.searchParams.delete(k));
  if (app.projectId) u.searchParams.set('project', app.projectId); else u.searchParams.delete('project');
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}

export async function boot(app) {
  const q = new URLSearchParams(location.search);
  const restored = await offerRecovery(app);
  if (!restored) {
    if (q.get('project')) await openProject(app, q.get('project'));
    else if (q.get('new')) {
      const qw = Math.round(Number(q.get('w'))), qh = Math.round(Number(q.get('h')));
      if (qw >= 16 && qh >= 16 && qw <= 8192 && qh <= 8192) await newProject(app, { quiet: true, width: qw - (qw % 2), height: qh - (qh % 2), name: q.get('name') ? sanitizeFilename(q.get('name'), 'Untitled project') : null });
      else await newProject(app);
    }
  }
  if (q.get('handoff')) {
    const files = await takeHandoff(q.get('handoff'));
    if (files && files.length) await handleFiles(app, files);
  }
  if (q.get('import')) await app.importDialog();
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const files = [];
      for (const hnd of params.files) { try { files.push(await hnd.getFile()); } catch (e) { /* ignore */ } }
      if (files.length) handleFiles(app, files);
    });
  }
  if (!app.project) app.emptyEl.hidden = false;
  updateUrl(app);
}

export function prprojInfoDialog() {
  return showReport({
    title: 'Premiere project compatibility',
    intro: 'EYAD VIDEO reads the XML inside .prproj files and rebuilds what it can. It never claims more: every import shows a report for that file, and media starts offline until you relink it on this device.',
    rows: [
      { status: 'ok', label: 'Sequence metadata', detail: 'Name, frame size, frame rate.' },
      { status: 'ok', label: 'Track structure', detail: 'Video and audio tracks, lock and mute state.' },
      { status: 'ok', label: 'Clip timing', detail: 'Timeline position, in/out points, speed.' },
      { status: 'ok', label: 'Media references', detail: 'Original file names and paths, shown as MEDIA OFFLINE with Relink.' },
      { status: 'part', label: 'Markers', detail: 'Read on a best-effort basis (storage varies by version).' },
      { status: 'part', label: 'Effects & transitions', detail: 'Detected and listed, not reproduced.' },
      { status: 'part', label: 'Audio processing', detail: 'Volume, pan and audio effects use defaults.' },
      { status: 'no', label: 'Proprietary features', detail: 'Lumetri, Essential Graphics, nested/multicam sequences, dynamic links, captions, proxies.' },
    ],
  }, [{ label: 'OK', value: true, primary: true }]);
}

export { confirmDiscard };
