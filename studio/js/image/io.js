// EYAD IMAGE — files: new/open/place, PSD, save to IndexedDB, .eyad,
// export, autosave & crash recovery.
import { h, formatDate, uid } from '../core/dom.js';
import { toast, dialog, formDialog, promptDialog, progressDialog, alertDialog } from '../core/ui.js';
import { getSettings } from '../core/settings.js';
import { chooseFiles } from '../core/open.js';
import { detectFile, pickFiles, ACCEPT, downloadBlob, loadImageFile, sanitizeFilename, LIMITS, baseName } from '../core/files.js';
import { writeEyad, readEyad } from '../core/eyad.js';
import { saveProject, loadProjectBlob, touchProject, getProject, putRecovery, listRecovery, delRecovery, putHandoff, takeHandoff } from '../core/db.js';
import { ROUTES } from '../core/shell.js';
import { createDoc, makeNode, serializeDoc, deserializeDoc, canvasToBlob, MAX_SIDE, MAX_AREA, makeCanvas, estimateBytes } from './doc.js';
import { flatten } from './render.js';
import { placeCanvas } from './ops.js';
// Help dialogs + the import report load on first use.
const docs = () => import('../core/docs.js');
export const supportedFilesDialog = (...a) => docs().then((m) => m.supportedFilesDialog(...a));
export const shortcutsDialog = (...a) => docs().then((m) => m.shortcutsDialog(...a));
export const aboutDialog = (...a) => docs().then((m) => m.aboutDialog(...a));
export const psdCompatDialog = (...a) => docs().then((m) => m.psdCompatDialog(...a));
const showReport = (...a) => docs().then((m) => m.showReport(...a));

// ================================================================= new

const PRESETS = [
  ['custom', 'Custom'],
  ['1920x1080', 'HD 1920 × 1080'],
  ['3840x2160', '4K UHD 3840 × 2160'],
  ['1080x1080', 'Instagram post 1080 × 1080'],
  ['1080x1350', 'Instagram portrait 1080 × 1350'],
  ['1080x1920', 'Story / Reel 1080 × 1920'],
  ['1280x720', 'YouTube thumbnail 1280 × 720'],
  ['2480x3508', 'A4 @ 300 ppi 2480 × 3508'],
  ['3000x3000', 'Album cover 3000 × 3000'],
  ['800x600', 'Web 800 × 600'],
];

export async function newDocDialog(app) {
  const s = getSettings();
  const v = await formDialog({
    title: 'New image', ok: 'Create',
    fields: [
      { key: 'name', label: 'Name', type: 'text', value: 'Untitled-' + (app.records.length + 1), maxLength: 120 },
      { key: 'preset', label: 'Preset', type: 'select', value: 'custom', options: PRESETS.map(([value, label]) => ({ value, label })) },
      { key: 'width', label: 'Width', type: 'number', value: s.imageWidth, min: 1, max: MAX_SIDE, suffix: 'px' },
      { key: 'height', label: 'Height', type: 'number', value: s.imageHeight, min: 1, max: MAX_SIDE, suffix: 'px' },
      { key: 'background', label: 'Background', type: 'select', value: s.imageBackground, options: [{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'transparent', label: 'Transparent' }] },
    ],
    onChange: (vals) => {
      if (vals.preset !== 'custom' && vals.preset !== app._lastPreset) {
        app._lastPreset = vals.preset;
        const [w, hh] = vals.preset.split('x');
        const inputs = document.querySelectorAll('.studio-dialog input[type=number]');
        if (inputs[0]) inputs[0].value = w; if (inputs[1]) inputs[1].value = hh;
      }
    },
  });
  app._lastPreset = null;
  if (!v) return null;
  const W = Math.round(v.width), H = Math.round(v.height);
  if (!(W >= 1 && H >= 1 && W <= MAX_SIDE && H <= MAX_SIDE && W * H <= MAX_AREA)) {
    toast(`Size must be 1–${MAX_SIDE} px per side and at most ${MAX_AREA / 1e6} megapixels.`, { type: 'error' });
    return null;
  }
  if (W * H > 24e6 && app.mobile.matches) toast('Large canvases can exceed a phone’s memory. Consider a smaller size.', { type: 'warn', timeout: 6000 });
  const doc = createDoc({ name: sanitizeFilename(v.name || 'Untitled', 'Untitled'), width: W, height: H, background: v.background });
  app.addDocument(doc);
  return doc;
}

// ================================================================= open

export async function openDialog(app, kind = 'any') {
  const accept = kind === 'psd' ? ACCEPT.psd : ACCEPT.imageAll;
  const files = await chooseFiles({ title: kind === 'psd' ? 'Open PSD' : 'Open', accept, multiple: true, media: 'image' });
  if (files.length) handleFiles(app, files);
}

export async function placeDialog(app) {
  if (!app.doc) return;
  const files = await chooseFiles({ title: 'Place as layer', accept: ACCEPT.image + ',' + ACCEPT.psd, multiple: true, media: 'image', recent: false });
  for (const f of files) await placeFile(app, f);
}

async function placeFile(app, f) {
  const info = await detectFile(f);
  if (info.kind === 'image') {
    if (f.size > LIMITS.image) { toast(`${f.name} is too large to place.`, { type: 'error' }); return; }
    try { placeCanvas(app, await loadImageFile(f), baseName(f.name)); if (info.format === 'gif') toast('GIF placed using its first frame.', { timeout: 3000 }); }
    catch (e) { toast(e.message, { type: 'error', detail: f.name }); }
  } else if (info.kind === 'psd') {
    // place a PSD as its flattened composite
    const { importPsd } = await import('./psd.js');
    const p = progressDialog('Placing ' + sanitizeFilename(f.name), { cancellable: false });
    try {
      const { doc } = await importPsd(f, { onProgress: (fr, t) => p.set(fr, t) });
      placeCanvas(app, flatten(doc), baseName(f.name));
      toast('PSD placed as a flattened layer. Use File ▸ Open PSD to keep its layers.', { timeout: 4500 });
    } catch (e) { toast(e.message, { type: 'error', detail: f.name }); }
    finally { p.close(); }
  } else toast(`${sanitizeFilename(f.name)} can’t be placed (${info.label}).`, { type: 'warn' });
}

/** Central file router for open/drop/handoff. */
export async function handleFiles(app, files, { dropped = false } = {}) {
  const imgs = [];
  const forVideo = [];
  for (const f of files) {
    let info;
    try { info = await detectFile(f); } catch (e) { toast('Could not read ' + sanitizeFilename(f.name), { type: 'error' }); continue; }
    if (info.kind === 'psd') await openPsd(app, f);
    else if (info.kind === 'eyad') await openEyadFile(app, f);
    else if (info.kind === 'image') imgs.push({ f, info });
    else if (info.kind === 'lut') { if (app.doc) { const m = await import('./filmlab.js'); await m.colorLookupDialog(app, f); } else toast('Open an image first, then load the .cube LUT (Image ▸ Adjustments ▸ Color Lookup).', { timeout: 6000 }); }
    else if (info.kind === 'pdf' || info.kind === 'fig') { const id = await putHandoff([f]); location.href = ROUTES.vector + '?handoff=' + id; return; }
    else if (info.kind === 'model3d') { const id = await putHandoff([f]); location.href = ROUTES['3d'] + '?handoff=' + id; return; }
    else if (info.kind === 'video' || info.kind === 'audio' || info.kind === 'prproj') forVideo.push(f);
    else {
      await alertDialog('Unsupported file', `“${sanitizeFilename(f.name)}” was not opened.`, { detail: `Detected: ${info.label}. See Help ▸ Supported Files.` });
    }
  }
  if (forVideo.length) {
    toast(forVideo.length === 1 ? `${sanitizeFilename(forVideo[0].name)} belongs in EYAD VIDEO.` : `${forVideo.length} media files belong in EYAD VIDEO.`, {
      timeout: 10000,
      action: { label: 'Open in Video', fn: async () => { const id = await putHandoff(forVideo); location.href = ROUTES.video + '?handoff=' + id; } },
    });
  }
  if (!imgs.length) return;
  let mode = 'open';
  if (app.doc && dropped) {
    mode = await dialog({
      title: imgs.length > 1 ? `${imgs.length} images` : sanitizeFilename(imgs[0].f.name),
      body: h('p', { text: 'Open as a new document, or place into the current document as a new layer?' }),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Place as layer', value: 'place' }, { label: 'Open image', value: 'open', primary: true }],
    });
    if (!mode) return;
  }
  for (const { f, info } of imgs) {
    if (f.size > LIMITS.image) { toast(`${sanitizeFilename(f.name)} is larger than ${LIMITS.image / 1048576} MB.`, { type: 'error' }); continue; }
    if (mode === 'place') { await placeFile(app, f); continue; }
    try {
      const c = await loadImageFile(f);
      const doc = createDoc({ name: baseName(f.name), width: c.width, height: c.height, background: 'transparent' });
      doc.layers[0].canvas = c;
      doc.layers[0].name = 'Background';
      doc.meta.source = 'image';
      doc.meta.originalName = sanitizeFilename(f.name);
      app.addDocument(doc);
      if (/\.(psd|psb)$/i.test(f.name)) toast(`“${sanitizeFilename(f.name)}” is not a real Photoshop file — it is a ${info.label} renamed to .psd. Opened as a flat image (no layers).`, { type: 'warn', timeout: 8000 });
      if (info.format === 'gif') toast('GIF opened using its first frame (animation is not imported).', { timeout: 4000 });
      if (info.format === 'svg') toast('SVG rasterised at ' + c.width + ' × ' + c.height + ' px.', { timeout: 3000 });
    } catch (e) {
      alertDialog('Could not open image', e.message, { detail: sanitizeFilename(f.name) });
    }
  }
}

export async function openPsd(app, f) {
  if (f.size > LIMITS.psd) { alertDialog('Could not open PSD', `Reason: the file is ${Math.round(f.size / 1048576)} MB — larger than the ${LIMITS.psd / 1048576} MB browser limit.`); return; }
  const { importPsd } = await import('./psd.js');
  const p = progressDialog('Opening ' + sanitizeFilename(f.name), { cancellable: false });
  let res;
  try {
    res = await importPsd(f, { onProgress: (fr, t) => p.set(fr, t) });
  } catch (e) {
    p.close();
    alertDialog(e.title || 'Could not open PSD', 'Reason: ' + e.message, { detail: sanitizeFilename(f.name) });
    return;
  }
  p.close();
  app.addDocument(res.doc, { meta: { thumb: res.thumb } });
  await showReport(res.report, [{ label: 'Open document', value: true, primary: true }]);
}

async function openEyadFile(app, f) {
  if (f.size > LIMITS.eyad) { toast('Project is too large.', { type: 'error' }); return; }
  const p = progressDialog('Opening ' + sanitizeFilename(f.name), { cancellable: false });
  p.set(null, 'Reading project…');
  try {
    const proj = await readEyad(f);
    if (proj.manifest.kind === 'video') {
      p.close();
      const id = await putHandoff([f]);
      toast('This is a video project — opening EYAD VIDEO…', { timeout: 2000 });
      setTimeout(() => { location.href = ROUTES.video + '?handoff=' + id; }, 600);
      return;
    }
    const doc = await deserializeDoc(proj.document, proj.asset);
    p.close();
    app.addDocument(doc, { meta: { created: proj.manifest.created } });
    toast('Opened ' + doc.name, { type: 'ok', timeout: 1800 });
  } catch (e) {
    p.close();
    alertDialog('Could not open project', e.message, { detail: sanitizeFilename(f.name) });
  }
}

export async function openProject(app, id) {
  const existing = app.records.findIndex((r) => r.projectId === id);
  if (existing >= 0) { app.switchTo(existing); return; }
  const p = progressDialog('Opening project', { cancellable: false });
  p.set(null, 'Loading from this device…');
  try {
    const blob = await loadProjectBlob(id);
    if (!blob) throw new Error('This project was not found in local storage. It may have been deleted.');
    const proj = await readEyad(blob);
    if (proj.manifest.kind !== 'image') { p.close(); location.href = ROUTES.video + '?project=' + encodeURIComponent(id); return; }
    const doc = await deserializeDoc(proj.document, proj.asset);
    doc.projectId = id;
    const meta = await getProject(id).catch(() => null);
    if (meta && meta.name) doc.name = meta.name; // renamed in Projects
    p.close();
    const rec = app.addDocument(doc, { projectId: id, meta: { created: proj.manifest.created } });
    rec.history.markSaved();
    touchProject(id);
    app.refresh();
  } catch (e) {
    p.close();
    alertDialog('Could not open project', e.message);
  }
}

// ================================================================= save

/** The current document as an .eyad blob (for opening it in another window). */
export async function eyadBlobFor(app) { return (await buildEyad(app, app.rec)).blob; }

async function buildEyad(app, rec) {
  const { json, assets } = await serializeDoc(rec.doc);
  const thumb = await canvasToBlob(thumbCanvas(rec.doc));
  const blob = await writeEyad({ kind: 'image', name: rec.doc.name, document: json, assets, thumb, created: rec.created });
  return { blob, thumb };
}

function thumbCanvas(doc, max = 360) {
  const s = Math.min(1, max / Math.max(doc.width, doc.height));
  const c = makeCanvas(Math.max(1, Math.round(doc.width * s)), Math.max(1, Math.round(doc.height * s)));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(flatten(doc), 0, 0, c.width, c.height);
  return c;
}

export async function save(app, { silent = false } = {}) {
  const rec = app.rec; if (!rec) return false;
  if (!rec.projectId) return saveAs(app);
  return writeProject(app, rec, { silent });
}

export async function saveAs(app) {
  const rec = app.rec; if (!rec) return false;
  const name = await promptDialog('Save project', 'Project name', rec.doc.name, { ok: 'Save' });
  if (!name) return false;
  rec.doc.name = sanitizeFilename(name, 'Untitled');
  const oldId = rec.projectId;
  rec.projectId = uid('p');
  rec.doc.projectId = rec.projectId;
  const ok = await writeProject(app, rec, {});
  if (!ok) { rec.projectId = oldId; rec.doc.projectId = oldId; }
  updateUrl(app);
  return ok;
}

async function writeProject(app, rec, { silent }) {
  if (rec.saving) return rec.saving;
  const seq = rec.history.currentSeq;
  rec.saving = (async () => {
    rec.saveState = 'saving'; updateSaveIndicator(app);
    try {
      const { blob, thumb } = await buildEyad(app, rec);
      await saveProject({ id: rec.projectId, name: rec.doc.name, kind: 'image', source: rec.doc.meta.source, created: rec.created, width: rec.doc.width, height: rec.doc.height, thumb }, blob);
      if (rec.history.currentSeq === seq) rec.history.savedSeq = seq;
      rec.recovered = false;
      rec.saveState = 'saved';
      rec.savedAt = Date.now();
      await delRecovery(rec.id);
      rec.autosavedSeq = seq;
      if (!silent) toast('Saved to Projects on this device', { type: 'ok', timeout: 1600 });
      return true;
    } catch (e) {
      rec.saveState = 'error';
      toast('Save failed', { type: 'error', detail: e.message || 'Storage may be full.' });
      return false;
    } finally {
      rec.saving = null;
      app.refresh();
    }
  })();
  return rec.saving;
}

export async function downloadEyad(app) {
  const rec = app.rec; if (!rec) return;
  const p = progressDialog('Preparing .eyad', { cancellable: false });
  p.set(null, 'Packing layers…');
  try {
    const { blob } = await buildEyad(app, rec);
    downloadBlob(blob, sanitizeFilename(rec.doc.name) + '.eyad');
  } catch (e) { toast('Could not create the project file', { type: 'error', detail: e.message }); }
  finally { p.close(); }
}

// ================================================================= export

export async function exportDialog(app) {
  const d = app.doc; if (!d) return;
  const v = await formDialog({
    title: 'Export as', ok: 'Export',
    fields: [
      { key: 'name', label: 'File name', type: 'text', value: d.name },
      { key: 'format', label: 'Format', type: 'select', value: 'png', options: [{ value: 'png', label: 'PNG (lossless, transparency)' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }] },
      { key: 'quality', label: 'Quality', type: 'range', min: 10, max: 100, value: 90, unit: '%', hint: 'JPEG and WebP only' },
      { key: 'scale', label: 'Scale', type: 'select', value: '1', options: [['0.25', '25%'], ['0.5', '50%'], ['1', '100%'], ['2', '200%']].map(([value, label]) => ({ value, label })) },
      { key: 'matte', label: 'JPEG background', type: 'color', value: '#ffffff' },
    ],
  });
  if (!v) return;
  await doExport(app, v.format, { name: v.name, quality: v.quality / 100, scale: Number(v.scale), matte: v.matte });
}

export function quickExport(app, format) { return doExport(app, format, { name: app.doc.name, quality: 0.92, scale: 1, matte: '#ffffff' }); }

async function doExport(app, format, { name, quality, scale, matte }) {
  const d = app.doc;
  const W = Math.max(1, Math.round(d.width * scale)), H = Math.max(1, Math.round(d.height * scale));
  if (W * H > MAX_AREA * 1.5) { toast('Export size is too large.', { type: 'error' }); return; }
  const src = flatten(d);
  const c = makeCanvas(W, H), g = c.getContext('2d');
  if (format === 'jpeg') { g.fillStyle = matte; g.fillRect(0, 0, W, H); }
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, W, H);
  const type = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[format];
  try {
    const blob = await canvasToBlob(c, type, quality);
    if (format === 'webp' && blob.type !== 'image/webp') { toast('This browser can’t encode WebP — exported PNG instead.', { type: 'warn' }); downloadBlob(blob, sanitizeFilename(name) + '.png'); return; }
    downloadBlob(blob, sanitizeFilename(name) + '.' + (format === 'jpeg' ? 'jpg' : format));
    toast(`Exported ${W} × ${H} ${format.toUpperCase()}`, { type: 'ok', timeout: 1800 });
  } catch (e) { toast('Export failed', { type: 'error', detail: e.message }); }
}

export async function exportPsdDialog(app) {
  const d = app.doc; if (!d) return;
  const ok = await showReport({
    title: 'Experimental PSD Export',
    intro: 'This writes a real layered PSD, but it is not a complete Photoshop round-trip. Check the result in Photoshop before relying on it.',
    rows: [
      { status: 'ok', label: 'Canvas size and flattened composite' },
      { status: 'ok', label: 'Pixel layers, names, order, visibility, opacity' },
      { status: 'ok', label: 'Groups and blend modes' },
      { status: 'ok', label: 'Layer masks on untransformed pixel layers' },
      { status: 'part', label: 'Text and shape layers', detail: 'Rasterised (not editable in Photoshop).' },
      { status: 'part', label: 'Transformed layers', detail: 'Scale and rotation are baked into the pixels.' },
      { status: 'no', label: 'Adjustment layers, layer styles, smart objects', detail: 'Not written (EYAD IMAGE does not create them).' },
    ],
  }, [{ label: 'Cancel', value: false }, { label: 'Export PSD', value: true, primary: true }]);
  if (!ok) return;
  if (estimateBytes(d) > 900e6) { toast('This document is too large to export as PSD in the browser.', { type: 'error' }); return; }
  const { exportPsd } = await import('./psd.js');
  const p = progressDialog('Exporting PSD', { cancellable: false });
  try {
    const { blob, notes } = await exportPsd(d, { onProgress: (f, t) => p.set(f, t) });
    downloadBlob(blob, sanitizeFilename(d.name) + '.psd');
    const extra = [notes.rasterized ? `${notes.rasterized} text/shape layer(s) rasterised` : '', notes.transformed ? `${notes.transformed} transformed layer(s) baked` : ''].filter(Boolean).join(' · ');
    toast('Experimental PSD exported', { type: 'ok', detail: extra, timeout: 5000 });
  } catch (e) {
    toast('PSD export failed', { type: 'error', detail: e.message });
  } finally { p.close(); }
}

// ================================================================= autosave & recovery

let autosaveTimer = 0, running = false;
export function startAutosave(app) {
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => autosaveNow(app), Math.max(5, getSettings().autosaveSeconds) * 1000);
}
export function scheduleAutosave(app) {
  const rec = app.rec; if (!rec) return;
  rec.saveState = rec.history.dirty ? 'dirty' : 'saved';
  updateSaveIndicator(app);
}
export async function autosaveNow(app) {
  const s = getSettings();
  if (!s.autosave || running) return;
  running = true;
  try {
    for (const rec of app.records) {
      if (!rec.history.dirty && !rec.recovered) continue;
      if (rec.autosavedSeq === rec.history.currentSeq && !rec.recovered) continue;
      if (app.view.toolActive) continue; // don't serialise mid-stroke
      const seq = rec.history.currentSeq;
      if (rec.projectId && s.autosaveProjects) {
        await writeProject(app, rec, { silent: true });
      } else {
        const { blob } = await buildEyad(app, rec);
        await putRecovery({ id: rec.id, kind: 'image', name: rec.doc.name, projectId: rec.projectId, blob, created: rec.created });
        rec.autosavedSeq = seq;
        rec.recoveryAt = Date.now();
      }
    }
  } catch (e) {
    console.warn('Autosave failed', e);
  } finally {
    running = false;
    updateSaveIndicator(app);
  }
}
export function dropRecovery(rec) { delRecovery(rec.id).catch(() => {}); }

export function updateSaveIndicator(app) {
  const rec = app.rec;
  const inds = [app.saveInd].filter(Boolean);
  const el2 = app.saveIndStatus;
  let state = 'idle', text = 'No document';
  if (rec) {
    if (rec.saving) { state = 'saving'; text = 'Saving…'; }
    else if (rec.saveState === 'error') { state = 'error'; text = 'Save failed'; }
    else if (rec.recovered && rec.history.dirty) { state = 'recovered'; text = 'Recovered project — save to keep'; }
    else if (rec.history.dirty) { state = 'dirty'; text = rec.recoveryAt ? `Unsaved changes · recovery copy ${new Date(rec.recoveryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Unsaved changes'; }
    else if (rec.projectId) { state = 'saved'; text = 'Saved'; }
    else { state = 'idle'; text = 'Not saved yet'; }
  }
  for (const ind of inds) ind.set(state, text);
  if (el2) { el2.dataset.state = state; const l = el2.querySelector('.studio-save-label'); if (l) l.textContent = text; }
}

async function offerRecovery(app) {
  let entries;
  try { entries = await listRecovery('image'); } catch (e) { return; }
  if (!entries.length) return;
  const list = h('div', { class: 'studio-stack' },
    h('p', { text: 'EYAD IMAGE closed before these documents were saved. Restore them?' }),
    h('ul', { class: 'studio-list' }, entries.map((e) => h('li', { text: `${e.name} — ${formatDate(e.time)}` }))));
  const v = await dialog({ title: 'Recovered Project', body: list, dismissable: false, buttons: [{ label: 'Discard', value: 'discard', danger: true }, { label: 'Restore', value: 'restore', primary: true }] });
  for (const e of entries) {
    if (v === 'restore') {
      try {
        const proj = await readEyad(e.blob);
        const doc = await deserializeDoc(proj.document, proj.asset);
        doc.id = e.id; // keep the same recovery slot
        const rec = app.addDocument(doc, { projectId: e.projectId || null, recovered: true, meta: { created: e.created } });
        rec.id = e.id;
      } catch (err) {
        toast('A recovered document could not be restored', { type: 'error', detail: err.message });
        await delRecovery(e.id);
      }
    } else await delRecovery(e.id);
  }
  if (v === 'restore') toast('Recovered — save to keep your work.', { type: 'ok' });
}

// ================================================================= boot / URL

export function updateUrl(app) {
  const u = new URL(location.href);
  ['handoff', 'new', 'psd', 'open'].forEach((k) => u.searchParams.delete(k));
  if (app.rec && app.rec.projectId) u.searchParams.set('project', app.rec.projectId); else u.searchParams.delete('project');
  history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
}

export async function boot(app) {
  const q = new URLSearchParams(location.search);
  await offerRecovery(app);
  if (q.get('project')) await openProject(app, q.get('project'));
  if (q.get('handoff')) {
    const files = await takeHandoff(q.get('handoff'));
    if (files && files.length) await handleFiles(app, files);
  }
  const qw = Math.round(Number(q.get('w'))), qh = Math.round(Number(q.get('h')));
  if (q.get('new') && qw > 0 && qh > 0 && qw <= MAX_SIDE && qh <= MAX_SIDE && qw * qh <= MAX_AREA) {
    app.addDocument(createDoc({ name: sanitizeFilename(q.get('name') || 'Untitled', 'Untitled'), width: qw, height: qh, background: ['white', 'black', 'transparent'].includes(q.get('bg')) ? q.get('bg') : 'white' }));
  } else if (q.get('new')) await newDocDialog(app);
  if (q.get('psd')) await openDialog(app, 'psd');
  if (q.get('open')) await openDialog(app);
  // PWA file handling (installed app opened with a file)
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const files = [];
      for (const hnd of params.files) { try { files.push(await hnd.getFile()); } catch (e) { /* ignore */ } }
      if (files.length) handleFiles(app, files);
    });
  }
  updateUrl(app);
}
