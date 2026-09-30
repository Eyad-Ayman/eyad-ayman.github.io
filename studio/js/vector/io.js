// EYAD VECTOR — files: new/open/save (.eyad), SVG import, image placing,
// exports (SVG, PNG, WebP, vector PDF), hand-off to Image/Video, autosave.
import { h, uid, formatBytes } from '../core/dom.js';
<<<<<<< HEAD
import { toast, dialog, formDialog, promptDialog, progressDialog, alertDialog, confirmDialog } from '../core/ui.js';
import { showReport } from '../core/docs.js';
import { getSettings } from '../core/settings.js';
import { chooseFiles } from '../core/open.js';
import { detectFile, sanitizeFilename, downloadBlob, LIMITS, baseName, ACCEPT } from '../core/files.js';
=======
import { toast, dialog, formDialog, promptDialog, progressDialog, alertDialog } from '../core/ui.js';
import { getSettings } from '../core/settings.js';
import { chooseFiles } from '../core/open.js';
import { detectFile, sanitizeFilename, downloadBlob, LIMITS, baseName } from '../core/files.js';
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
import { writeEyad, readEyad } from '../core/eyad.js';
import { saveProject, loadProjectBlob, getProject, touchProject, putRecovery, listRecovery, delRecovery, putHandoff, takeHandoff } from '../core/db.js';
import { ROUTES } from '../core/shell.js';
import { createDoc, validateDoc, exportSVG, bounds, unionBounds, transformNode, translate, walk, segments, textBox, apply, I } from './model.js';
import { importSVG } from './pathops.js';
<<<<<<< HEAD
import { FONT_FILES } from '../templates/fonts.js';
=======
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7

const PRESETS = [['Instagram post', 1080, 1080], ['Instagram portrait 4:5', 1080, 1350], ['Story / Reel 9:16', 1080, 1920], ['YouTube thumbnail', 1280, 720], ['Full HD 1920×1080', 1920, 1080], ['Logo', 1000, 1000], ['A4 (96 dpi)', 794, 1123], ['A3 (96 dpi)', 1123, 1587], ['Business card', 1050, 600]];

// ------------------------------------------------------------------ new / open

export async function newDocDialog(app) {
  const v = await formDialog({ title: 'New vector document', ok: 'Create', fields: [
    { key: 'name', label: 'Name', type: 'text', value: 'Untitled vector' },
    { key: 'preset', label: 'Size', type: 'select', value: '0', options: PRESETS.map(([n, w, hh], i) => ({ value: String(i), label: `${n} — ${w}×${hh}` })).concat([{ value: 'custom', label: 'Custom…' }]) },
    { key: 'w', label: 'Width (custom)', type: 'number', value: 1080, min: 1, max: 20000, suffix: 'px' },
    { key: 'h', label: 'Height (custom)', type: 'number', value: 1080, min: 1, max: 20000, suffix: 'px' },
    { key: 'bg', label: 'Background', type: 'select', value: 'white', options: [{ value: 'white', label: 'White' }, { value: 'cream', label: 'Cream' }, { value: 'black', label: 'Black' }, { value: 'none', label: 'Transparent' }] },
  ] });
  if (!v) return;
  if (app.dirty && !(await confirmLeave(app))) return;
  const [w, hh] = v.preset === 'custom' ? [Math.max(1, Math.min(20000, Math.round(v.w))), Math.max(1, Math.min(20000, Math.round(v.h)))] : PRESETS[Number(v.preset)].slice(1);
  app.newDoc(createDoc({ name: sanitizeFilename(v.name, 'Untitled vector'), width: w, height: hh, bg: { white: '#ffffff', cream: '#f3ede1', black: '#0b0b0b', none: null }[v.bg] }));
  updateUrl(app);
}
async function confirmLeave(app) {
  const r = await dialog({ title: 'Unsaved changes', body: h('p', { text: `Save “${app.doc.name}” before continuing?` }), buttons: [{ label: 'Cancel', value: null }, { label: 'Don’t save', value: 'discard' }, { label: 'Save', value: 'save', primary: true }] });
  if (r === 'save') return save(app);
  return r === 'discard';
}

export async function openDialog(app) {
<<<<<<< HEAD
  const files = await chooseFiles({ title: 'Open', accept: ACCEPT.vectorAll, multiple: true, media: 'image' });
=======
  const files = await chooseFiles({ title: 'Open', accept: '.eyad,.svg,image/svg+xml,.png,.jpg,.jpeg,.webp', multiple: true, media: 'image' });
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  if (files.length) handleFiles(app, files);
}
export async function placeImage(app) {
  const files = await chooseFiles({ title: 'Place', accept: '.svg,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif', multiple: true, media: 'image', recent: false });
  if (files.length) handleFiles(app, files, { place: true });
}

export async function handleFiles(app, files, { place = false } = {}) {
  for (const f of files) {
    let info; try { info = await detectFile(f); } catch (e) { toast('Could not read ' + sanitizeFilename(f.name), { type: 'error' }); continue; }
    if (info.kind === 'eyad') { await openEyadFile(app, f); continue; }
    if (info.format === 'svg') { if (f.size > 64e6) { toast('This SVG is too large (over 64 MB).', { type: 'error' }); continue; } await importSVGText(app, await f.text(), baseName(f.name), { place: place || !isBlank(app) }); continue; }
<<<<<<< HEAD
    if (info.kind === 'pdf') { await importPdfFile(app, f, { place: place || !isBlank(app) }); continue; }
    if (info.kind === 'fig' || /\.fig$/i.test(f.name)) { await importFigFile(app, f, { place: place || !isBlank(app) }); continue; }
    if (info.kind === 'image') { await placeRaster(app, f); continue; }
    if (info.kind === 'psd') { toast(`${sanitizeFilename(f.name)} is a PSD — opening it in EYAD IMAGE.`); const id = await putHandoff([f]); location.href = ROUTES.image + '?handoff=' + id; return; }
    if (info.kind === 'video' || info.kind === 'audio' || info.kind === 'prproj') { const id = await putHandoff([f]); location.href = ROUTES.video + '?handoff=' + id; return; }
    if (info.kind === 'model3d') { const id = await putHandoff([f]); location.href = ROUTES['3d'] + '?handoff=' + id; return; }
    await alertDialog('Unsupported file', `“${sanitizeFilename(f.name)}” was not opened.`, { detail: 'EYAD VECTOR opens .eyad vector projects, SVG, PDF, .ai (PDF-compatible), EPS/legacy AI (basic paths) and .fig (experimental), and places PNG / JPEG / WebP / GIF images.' });
=======
    if (info.kind === 'image') { await placeRaster(app, f); continue; }
    if (info.kind === 'psd') { toast(`${sanitizeFilename(f.name)} is a PSD — opening it in EYAD IMAGE.`); const id = await putHandoff([f]); location.href = ROUTES.image + '?handoff=' + id; return; }
    if (info.kind === 'video' || info.kind === 'audio' || info.kind === 'prproj') { const id = await putHandoff([f]); location.href = ROUTES.video + '?handoff=' + id; return; }
    await alertDialog('Unsupported file', `“${sanitizeFilename(f.name)}” was not opened.`, { detail: 'EYAD VECTOR opens .eyad vector projects and SVG, and places PNG / JPEG / WebP / GIF images.' });
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  }
}
const isBlank = (app) => !app.doc.items.length && !app.dirty;

export async function importSVGText(app, text, name = 'Imported SVG', { place = false } = {}) {
  const prog = progressDialog('Importing SVG', { cancellable: false });
  try {
    prog.set(0.3, 'Reading paths, fills, strokes and text…');
    const res = await importSVG(text);
    if (!res.nodes.length) { toast('No drawable shapes were found in this SVG.', { type: 'warn' }); return; }
    if (!place) {
      const doc = createDoc({ name: sanitizeFilename(name, 'Imported SVG'), width: res.width, height: res.height, bg: null });
      doc.items = res.nodes; doc.meta.source = 'svg';
      app.newDoc(doc);
      updateUrl(app);
    } else {
      // centre the placed artwork on the active artboard
      const ab = app.activeArtboard(), b = unionBounds(res.nodes.map(bounds));
      const g = { id: uid('n'), type: 'group', name, hidden: false, locked: false, style: { opacity: 1, blend: 'normal' }, children: res.nodes };
      if (b) transformNode(g, translate(ab.x + ab.w / 2 - (b.x + b.w / 2), ab.y + ab.h / 2 - (b.y + b.h / 2)));
      app.addNode(g, { label: 'Place SVG' });
    }
    toast(`Imported ${res.count} object${res.count === 1 ? '' : 's'} — editable paths, fills, strokes and text.`, { type: 'ok', timeout: 3500 });
  } catch (e) { await alertDialog('SVG import failed', e.message || String(e)); }
  finally { prog.close(); }
}

<<<<<<< HEAD
/** Place / open an imported vector document (from PDF, .ai or .fig). */
function adoptImported(app, doc, { place, label }) {
  if (!place) { app.newDoc(doc); updateUrl(app); return; }
  const ab = app.activeArtboard();
  const kids = doc.items;
  const b = unionBounds(kids.map(bounds));
  const g = { id: uid('n'), type: 'group', name: doc.name || label, hidden: false, locked: false, style: { opacity: 1, blend: 'normal' }, children: kids };
  if (b) transformNode(g, translate(ab.x + ab.w / 2 - (b.x + b.w / 2), ab.y + ab.h / 2 - (b.y + b.h / 2)));
  app.addNode(g, { label: 'Place ' + label });
}
function importReport(title, rep, extraRows = []) {
  const rows = [{ status: 'ok', label: rep.summary }];
  for (const a of rep.approximations || []) rows.push({ status: 'part', label: a });
  for (const f of rep.fontSubstitutions || []) rows.push({ status: 'part', label: 'Font substituted: ' + f, detail: 'The original font is not available in the browser; install-free Studio fonts are used instead. Text stays editable.' });
  for (const u of rep.unsupported || []) rows.push({ status: 'no', label: u });
  return { title, intro: 'Imported as editable vectors — paths, fills, strokes, gradients and text. Anything that could not be reproduced is listed below.', rows: rows.concat(extraRows) };
}
async function importPdfFile(app, f, { place }) {
  const prog = progressDialog('Importing ' + sanitizeFilename(f.name), { cancellable: false });
  try {
    const { importPdf, pdfInfo } = await import('./import-pdf.js');
    let pages = 'all';
    try {
      const info = await pdfInfo(f);
      if (info && info.pages > 1) {
        prog.close();
        const v = await formDialog({ title: `${sanitizeFilename(f.name)} has ${info.pages} pages`, ok: 'Import', fields: [
          { key: 'which', label: 'Pages', type: 'select', value: 'all', options: [{ value: 'all', label: `All pages (up to 50, one artboard each)` }, { value: 'first', label: 'First page only' }, { value: 'range', label: 'Page range…' }] },
          { key: 'range', label: 'Range', type: 'text', value: '1-' + Math.min(info.pages, 5), placeholder: 'e.g. 1-3, 6' },
        ] });
        if (!v) return;
        if (v.which === 'first') pages = [1];
        else if (v.which === 'range') pages = parseRange(v.range, info.pages);
      }
    } catch (e) { /* pdfInfo is optional */ }
    const p2 = progressDialog('Converting to vectors', { cancellable: false });
    try {
      const { doc, report } = await importPdf(f, { pages, onProgress: (fr, t) => p2.set(fr, t) });
      adoptImported(app, doc, { place, label: /\.ai$/i.test(f.name) ? 'AI artwork' : 'PDF' });
      p2.close();
      if ((report.approximations || []).length || (report.unsupported || []).length || (report.fontSubstitutions || []).length) showReport(importReport((/\.ai$/i.test(f.name) ? 'Artwork' : 'PDF') + ' import report', report));
      else toast(report.summary, { type: 'ok', timeout: 3500 });
    } finally { p2.close(); }
  } catch (e) { await alertDialog('Could not import ' + sanitizeFilename(f.name), e.message || String(e), { detail: /\.ai$/i.test(f.name) ? 'Tip: in your design app, save the .ai with “Create PDF Compatible File” turned on, or export it as PDF or SVG.' : '' }); }
  finally { prog.close(); }
}
function parseRange(txt, max) {
  const out = new Set();
  for (const part of String(txt).split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (!m) continue;
    const a = Math.max(1, +m[1]), b = Math.min(max, +(m[2] || m[1]));
    for (let i = a; i <= b && out.size < 50; i++) out.add(i);
  }
  return out.size ? [...out] : [1];
}
async function importFigFile(app, f, { place }) {
  const ok = await confirmDialog('Open .fig (experimental)', 'The .fig format is private and changes often. EYAD VECTOR reads frames, shapes, vectors, text, fills, strokes and images from it, but some features may be missing. For a guaranteed result, export SVG or PDF from your design app instead.', { ok: 'Open anyway' });
  if (!ok) return;
  const prog = progressDialog('Reading ' + sanitizeFilename(f.name), { cancellable: false });
  try {
    const { importFig } = await import('./import-fig.js');
    const { doc, report } = await importFig(f, { onProgress: (fr, t) => prog.set(fr, t) });
    adoptImported(app, doc, { place, label: 'design file' });
    prog.close();
    showReport(importReport('.fig import report', report));
  } catch (e) { await alertDialog('Could not open this .fig file', e.message || String(e), { detail: 'Export the frames as SVG or PDF from your design app and open that file here — it always works.' }); }
  finally { prog.close(); }
}

=======
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
async function placeRaster(app, f) {
  if (f.size > LIMITS.image) { toast(`${sanitizeFilename(f.name)} is too large to place.`, { type: 'error' }); return; }
  const url = URL.createObjectURL(f);
  try {
    const img = new Image(); img.src = url; await img.decode();
    let w = img.naturalWidth || 512, hh = img.naturalHeight || 512;
    const max = 4096, s = Math.min(1, max / Math.max(w, hh));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(hh * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const png = /png|gif|webp/.test(f.type) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
    const ab = app.activeArtboard();
    const fit = Math.min(1, ab.w * 0.8 / c.width, ab.h * 0.8 / c.height);
    w = c.width * fit; hh = c.height * fit;
    app.addNode({ id: uid('n'), type: 'image', name: baseName(f.name), hidden: false, locked: false, src: png, w: c.width, h: c.height, tf: [fit, 0, 0, fit, ab.x + (ab.w - w) / 2, ab.y + (ab.h - hh) / 2], style: { opacity: 1, blend: 'normal' } }, { label: 'Place Image' });
  } catch (e) { toast('That image could not be decoded.', { type: 'error' }); }
  finally { URL.revokeObjectURL(url); }
}

async function openEyadFile(app, file) {
  try {
    const proj = await readEyad(file);
    if (proj.manifest.kind !== 'vector') {
      toast(`This is an ${proj.manifest.kind} project — opening it in EYAD ${proj.manifest.kind.toUpperCase()}.`);
      const id = await putHandoff([file]); location.href = (proj.manifest.kind === 'video' ? ROUTES.video : ROUTES.image) + '?handoff=' + id; return;
    }
    const doc = validateDoc(proj.document);
    if (app.dirty && !(await confirmLeave(app))) return;
    app.newDoc(doc);
    updateUrl(app);
  } catch (e) { await alertDialog('Could not open project', e.message || String(e)); }
}

export async function openProject(app, id) {
  try {
    const meta = await getProject(id);
    const blob = await loadProjectBlob(id);
    if (!meta || !blob) { toast('That project is no longer in this browser.', { type: 'warn' }); return; }
    const proj = await readEyad(blob);
    const doc = validateDoc(proj.document);
    doc.name = meta.name || doc.name;
    app.newDoc(doc, { projectId: id });
    touchProject(id).catch(() => {});
    app.markSaved();
  } catch (e) { await alertDialog('Could not open project', e.message || String(e)); }
}

// ------------------------------------------------------------------ save

async function buildEyad(app) {
  const doc = JSON.parse(JSON.stringify({ ...app.doc, meta: app.doc.meta }));
  const thumb = await renderPNG(app, app.doc.artboards[0], { max: 360 }).catch(() => null);
  const blob = await writeEyad({ kind: 'vector', name: app.doc.name, document: doc, thumb, created: app.rec.created });
  return { blob, thumb };
}
export async function save(app, { silent = false } = {}) {
  if (!app.rec.projectId) return saveAs(app);
  return writeProject(app, { silent });
}
export async function saveAs(app) {
  const name = await promptDialog('Save project', 'Project name', app.doc.name, { ok: 'Save' });
  if (!name) return false;
  app.doc.name = sanitizeFilename(name, 'Untitled vector');
  app.rec.projectId = uid('p');
  const ok = await writeProject(app, {});
  updateUrl(app);
  return ok;
}
async function writeProject(app, { silent }) {
  try {
    app.saveState = 'saving'; updateSaveIndicator(app);
    const { blob, thumb } = await buildEyad(app);
    const ab = app.doc.artboards[0];
    await saveProject({ id: app.rec.projectId, name: app.doc.name, kind: 'vector', source: app.doc.meta?.source || 'new', created: app.rec.created, width: ab.w, height: ab.h, thumb }, blob);
    app.markSaved();
    app.saveState = 'saved';
    delRecovery(app.rec.id).catch(() => {});
    if (!silent) toast('Saved to Projects on this device', { type: 'ok', timeout: 1600 });
    app.updateTitle();
    return true;
  } catch (e) { app.saveState = 'error'; toast('Save failed', { type: 'error', detail: e.message || 'Storage may be full.' }); return false; }
  finally { updateSaveIndicator(app); }
}
export async function downloadEyad(app) {
  const { blob } = await buildEyad(app);
  downloadBlob(blob, sanitizeFilename(app.doc.name) + '.eyad');
}
export async function renameDoc(app) {
  const v = await promptDialog('Rename document', 'Name', app.doc.name);
  if (!v) return;
  app.change('Rename', () => { app.doc.name = sanitizeFilename(v, 'Untitled vector'); });
  app.updateTitle();
}
export function updateSaveIndicator(app) {
  const state = app.saveState === 'saving' ? 'saving' : app.saveState === 'error' ? 'error' : app.dirty ? 'dirty' : app.rec.projectId ? 'saved' : 'idle';
  if (app.saveInd) app.saveInd.set(state);
  if (app.saveIndStatus) app.saveIndStatus.set(state);
}
export function updateUrl(app) {
  const u = new URL(location.href);
  ['handoff', 'new', 'open'].forEach((k) => u.searchParams.delete(k));
  if (app.rec.projectId) u.searchParams.set('project', app.rec.projectId); else u.searchParams.delete('project');
  history.replaceState(null, '', u.pathname + u.search);
}

// ------------------------------------------------------------------ autosave / recovery

export function startAutosave(app) {
  const tick = () => { autosaveNow(app); setTimeout(tick, Math.max(5, getSettings().autosaveSeconds || 20) * 1000); };
  setTimeout(tick, 15000);
}
export async function autosaveNow(app) {
  if (!app.dirty || !getSettings().autosave) return;
  const n = app.undoStack.length;
  if (app.autosavedAt === n) return;
  try {
    if (app.rec.projectId && getSettings().autosaveProjects) { await writeProject(app, { silent: true }); app.autosavedAt = n; return; }
    const blob = new Blob([JSON.stringify(app.doc)], { type: 'application/json' });
    await putRecovery({ id: app.rec.id, kind: 'vector', name: app.doc.name, projectId: app.rec.projectId, blob, created: app.rec.created });
    app.autosavedAt = n;
  } catch (e) { /* storage full: next tick retries */ }
}
async function offerRecovery(app) {
  let entries = [];
  try { entries = await listRecovery('vector'); } catch (e) { return; }
  if (!entries.length) return;
  const e = entries[0];
  const v = await dialog({ title: 'Recovered project', body: h('div', { class: 'studio-stack' }, h('p', { text: `EYAD VECTOR closed before “${e.name}” was saved. Restore it?` }), h('p', { class: 'studio-dim studio-small', text: formatBytes(e.blob?.size || 0) + ' · ' + new Date(e.time).toLocaleString() })), buttons: [{ label: 'Discard', value: 'discard', danger: true }, { label: 'Restore', value: 'restore', primary: true }] });
  if (v === 'restore') {
    try { const doc = validateDoc(JSON.parse(await e.blob.text())); app.newDoc(doc, { projectId: e.projectId || null }); app.dirtyFlag = true; app.updateTitle(); toast('Recovered — save to keep your work.', { type: 'ok' }); }
    catch (err) { toast('The recovery copy was damaged.', { type: 'error' }); }
  }
  await delRecovery(e.id).catch(() => {});
  for (const x of entries.slice(1)) delRecovery(x.id).catch(() => {});
}

export async function boot(app) {
  const q = new URLSearchParams(location.search);
  await offerRecovery(app);
  if (q.get('project')) await openProject(app, q.get('project'));
  if (q.get('handoff')) { const files = await takeHandoff(q.get('handoff')); if (files && files.length) await handleFiles(app, files); }
<<<<<<< HEAD
  const qw = Math.round(Number(q.get('w'))), qh = Math.round(Number(q.get('h')));
  if (q.get('new') && qw > 0 && qh > 0 && qw <= 20000 && qh <= 20000) { app.newDoc(createDoc({ name: sanitizeFilename(q.get('name') || 'Untitled vector', 'Untitled vector'), width: qw, height: qh, bg: '#ffffff' })); updateUrl(app); }
  else if (q.get('new')) await newDocDialog(app);
  if (q.get('open')) await openDialog(app);
=======
  if (q.get('new')) await newDocDialog(app);
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  if ('launchQueue' in window) window.launchQueue.setConsumer(async (params) => { const files = []; for (const hnd of params.files || []) { try { files.push(await hnd.getFile()); } catch (e) { /* ignore */ } } if (files.length) handleFiles(app, files); });
  updateUrl(app);
}

// ------------------------------------------------------------------ export

let fontCss = null;
async function embeddedFonts(doc) {
  const used = new Set(); walk(doc.items, (n) => { if (n.type === 'text') used.add(n.font); });
  const want = [...used].filter((f) => f.startsWith('Studio '));
  if (!want.length) return '';
  if (!fontCss) fontCss = {};
<<<<<<< HEAD
  const files = FONT_FILES;
  let css = '';
  for (const fam of want) for (const [w, file, italic, range] of files[fam] || []) {
=======
  const files = { 'Studio Inter': [[400, 'inter-latin-400-normal'], [500, 'inter-latin-500-normal'], [600, 'inter-latin-600-normal'], [700, 'inter-latin-700-normal']], 'Studio Oswald': [[500, 'oswald-latin-500-normal'], [600, 'oswald-latin-600-normal'], [700, 'oswald-latin-700-normal']], 'Studio Mono': [[400, 'jetbrains-mono-latin-400-normal']] };
  let css = '';
  for (const fam of want) for (const [w, file] of files[fam] || []) {
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
    const key = file;
    if (!fontCss[key]) {
      const buf = await (await fetch(new URL(`../../fonts/${file}.woff2`, import.meta.url))).arrayBuffer();
      let bin = ''; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      fontCss[key] = btoa(bin);
    }
<<<<<<< HEAD
    css += `@font-face{font-family:'${fam}';font-weight:${w};font-style:${italic ? 'italic' : 'normal'};${range ? `unicode-range:${range};` : ''}src:url(data:font/woff2;base64,${fontCss[key]}) format('woff2');}`;
=======
    css += `@font-face{font-family:'${fam}';font-weight:${w};src:url(data:font/woff2;base64,${fontCss[key]}) format('woff2');}`;
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  }
  return css;
}
export async function svgFor(app, ab, { embedFonts = false } = {}) {
  return exportSVG(app.doc, ab, { fonts: embedFonts ? await embeddedFonts(app.doc) : '' });
}
export async function renderPNG(app, ab, { scale = 1, max = 0, type = 'image/png', quality = 0.92, transparent = false } = {}) {
  const svg = await svgFor(app, transparent ? { ...ab, bg: null } : ab, { embedFonts: true });
  let s = scale; if (max) s = Math.min(max / ab.w, max / ab.h);
  const W = Math.max(1, Math.round(ab.w * s)), H = Math.max(1, Math.round(ab.h * s));
  if (W * H > 120e6) throw new Error('That export would be too large for the browser.');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (type === 'image/jpeg') { g.fillStyle = ab.bg || '#ffffff'; g.fillRect(0, 0, W, H); }
    g.drawImage(img, 0, 0, W, H);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Export failed'))), type, quality));
  } finally { URL.revokeObjectURL(url); }
}

export async function exportDialog(app) {
  const abs = app.doc.artboards;
  const v = await formDialog({ title: 'Export', ok: 'Export', fields: [
    { key: 'fmt', label: 'Format', type: 'select', value: 'svg', options: [{ value: 'svg', label: 'SVG (vector)' }, { value: 'pdf', label: 'PDF (vector)' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }, { value: 'jpg', label: 'JPEG' }] },
    { key: 'which', label: 'Artboards', type: 'select', value: 'active', options: [{ value: 'active', label: 'Active artboard' }, { value: 'all', label: `All artboards (${abs.length})` }] },
    { key: 'scale', label: 'Scale (PNG/WebP/JPEG)', type: 'select', value: '2', options: [['0.5', '0.5×'], ['1', '1×'], ['2', '2×'], ['3', '3×'], ['4', '4×']].map(([value, label]) => ({ value, label })) },
    { key: 'transparent', label: 'Transparent background (PNG/WebP)', type: 'checkbox', value: false },
  ] });
  if (!v) return;
  const list = v.which === 'all' ? abs : [app.activeArtboard()];
  const prog = progressDialog('Exporting', { cancellable: false });
  try {
    if (v.fmt === 'pdf') { prog.set(0.5, 'Writing PDF…'); downloadBlob(await buildPDF(app, list), sanitizeFilename(app.doc.name) + '.pdf'); }
    else for (let i = 0; i < list.length; i++) {
      const ab = list[i]; prog.set(i / list.length, ab.name);
      const nm = sanitizeFilename(app.doc.name) + (list.length > 1 ? '-' + sanitizeFilename(ab.name) : '');
      if (v.fmt === 'svg') downloadBlob(new Blob([await svgFor(app, ab)], { type: 'image/svg+xml' }), nm + '.svg');
      else { const type = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' }[v.fmt]; downloadBlob(await renderPNG(app, ab, { scale: Number(v.scale), type, transparent: v.transparent }), nm + '.' + v.fmt); }
      await new Promise((r) => setTimeout(r, 250));
    }
    toast('Exported', { type: 'ok', timeout: 1400 });
  } catch (e) { toast(e.message || 'Export failed', { type: 'error' }); }
  finally { prog.close(); }
}
export async function quickExport(app, fmt) {
  const ab = app.activeArtboard(), nm = sanitizeFilename(app.doc.name);
  try {
    if (fmt === 'svg') downloadBlob(new Blob([await svgFor(app, ab)], { type: 'image/svg+xml' }), nm + '.svg');
    else if (fmt === 'pdf') downloadBlob(await buildPDF(app, [ab]), nm + '.pdf');
    else downloadBlob(await renderPNG(app, ab, { scale: 2 }), nm + '.png');
  } catch (e) { toast(e.message || 'Export failed', { type: 'error' }); }
}

export async function sendTo(app, where) {
  const ab = app.activeArtboard();
  try {
    const blob = await renderPNG(app, ab, { scale: where === 'video' ? Math.min(2, 1920 / Math.max(ab.w, ab.h)) : 1, transparent: true });
    const file = new File([blob], sanitizeFilename(app.doc.name + '-' + ab.name) + '.png', { type: 'image/png' });
    const id = await putHandoff([file]);
    location.href = (where === 'video' ? ROUTES.video : ROUTES.image) + '?handoff=' + id;
  } catch (e) { toast(e.message || 'Could not render the artboard.', { type: 'error' }); }
}

// ------------------------------------------------------------------ PDF (vector)

/**
 * Minimal PDF 1.4 writer: paths (fills, strokes, dashes, opacity), solid
 * colours, linear/radial gradients (axial/radial shadings), text (Helvetica
 * family, Latin), and placed images (JPEG). One page per artboard.
 */
async function buildPDF(app, boards) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalogId = add(null), pagesId = add(null);
  const fontIds = { regular: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), bold: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'), mono: add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'), serif: add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>') };
  const pageIds = [];
  const f = (v) => (Math.round(v * 1000) / 1000).toString();
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const pdfStr = (s) => '(' + Array.from(s).map((ch) => { const c = ch.charCodeAt(0); if (ch === '(' || ch === ')' || ch === '\\') return '\\' + ch; if (c < 32 || c > 255) return '?'; return ch; }).join('') + ')';
  for (const ab of boards) {
    const gs = new Map(), shadings = [], images = [];
    const gsName = (fa, sa) => { const k = f(fa) + '/' + f(sa); if (!gs.has(k)) gs.set(k, { name: 'GS' + gs.size, fa, sa }); return gs.get(k).name; };
    let c = `1 0 0 -1 0 ${f(ab.h * 0.75)} cm 0.75 0 0 0.75 0 0 cm 1 0 0 1 ${f(-ab.x)} ${f(-ab.y)} cm\n`;
    c += `q ${f(ab.x)} ${f(ab.y)} ${f(ab.w)} ${f(ab.h)} re W n\n`;
    if (ab.bg) { const [r, g, b] = rgb(ab.bg); c += `${f(r)} ${f(g)} ${f(b)} rg ${f(ab.x)} ${f(ab.y)} ${f(ab.w)} ${f(ab.h)} re f\n`; }
    const pathOps = (n) => {
      let s = '';
      for (const sp of n.subpaths) {
        if (!sp.pts.length) continue;
        s += `${f(sp.pts[0].x)} ${f(sp.pts[0].y)} m `;
        for (const sg of segments(sp)) s += `${f(sg[2])} ${f(sg[3])} ${f(sg[4])} ${f(sg[5])} ${f(sg[6])} ${f(sg[7])} c `;
        if (sp.closed) s += 'h ';
      }
      return s;
    };
    const emit = async (n, op = 1) => {
      if (n.hidden) return;
      const st = n.style || {}, o = op * (st.opacity ?? 1);
      if (n.type === 'group') { for (const k of n.children) await emit(k, o); return; }
      if (n.type === 'image') {
        const jpg = await toJPEG(n.src);
        const id = add(null);
        objs[id - 1] = { stream: jpg.bytes, dict: `<< /Type /XObject /Subtype /Image /Width ${jpg.w} /Height ${jpg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.bytes.length} >>` };
        const nm = 'Im' + images.length; images.push([nm, id]);
        const m = n.tf || I;
        c += `q /${gsName(o, o)} gs ${m.map(f).join(' ')} cm ${f(n.w)} 0 0 ${f(-n.h)} 0 ${f(n.h)} cm /${nm} Do Q\n`;
        return;
      }
      const fill = st.fill, stroke = st.stroke;
      const fa = o * (fill?.a ?? 1), sa = o * (stroke?.a ?? 1);
      c += `q /${gsName(fa, sa)} gs\n`;
      if (n.type === 'path') {
        const ops = pathOps(n), even = n.fillRule === 'evenodd';
        if (fill) {
          if (fill.kind === 'linear' || fill.kind === 'radial') {
            const b = bounds(n);
            const sh = shadingFor(fill, b); const nm = 'Sh' + shadings.length; shadings.push([nm, add(sh)]);
            c += `q ${ops} W${even ? '*' : ''} n /${nm} sh Q\n`;
          } else {
            const col = fill.kind === 'solid' ? fill.color : fill.color || '#000000';
            const [r, g, b] = rgb(col); c += `${f(r)} ${f(g)} ${f(b)} rg ${ops} f${even ? '*' : ''}\n`;
          }
        }
        if (stroke) {
          const col = stroke.kind === 'solid' ? stroke.color : stroke.stops?.[0]?.color || stroke.color || '#000000';
          const [r, g, b] = rgb(col);
          c += `${f(r)} ${f(g)} ${f(b)} RG ${f(st.sw || 1)} w ${{ butt: 0, round: 1, square: 2 }[st.cap] ?? 0} J ${{ miter: 0, round: 1, bevel: 2 }[st.join] ?? 0} j ${st.dash ? `[${st.dash.split(/[\s,]+/).filter(Boolean).map(Number).map(f).join(' ')}] 0 d` : ''} ${ops} S\n`;
        }
      } else if (n.type === 'text') {
        const col = fill?.kind === 'solid' ? fill.color : fill?.stops?.[0]?.color || '#000000';
        const [r, g, b] = rgb(col);
        const tb = textBox(n);
        const font = n.font === 'Studio Mono' || n.font === 'Courier New' ? 'mono' : /Georgia|Times/.test(n.font) ? 'serif' : n.weight >= 600 ? 'bold' : 'regular';
        const m = n.tf || I;
        c += `${f(r)} ${f(g)} ${f(b)} rg ${m.map(f).join(' ')} cm\n`;
        tb.lines.forEach((line, i) => {
          const w = measureHelv(line, n.size, n.tracking);
          let x = 0;
          if (n.width > 0) { if (n.align === 'center') x = (n.width - w) / 2; else if (n.align === 'right') x = n.width - w; }
          else if (n.align === 'center') x = -w / 2; else if (n.align === 'right') x = -w;
          c += `BT /F${font} ${f(n.size)} Tf ${n.tracking ? f(n.tracking / 1000 * n.size) + ' Tc ' : ''}1 0 0 -1 ${f(x)} ${f(i * tb.lh)} Tm ${pdfStr(line)} Tj ET\n`;
        });
      }
      c += 'Q\n';
    };
    for (const n of app.doc.items) await emit(n);
    c += 'Q\n';
    const bytes = new TextEncoder().encode(c);
    const contentId = add({ stream: bytes, dict: `<< /Length ${bytes.length} >>` });
    const gsDict = [...gs.values()].map((g) => `/${g.name} << /Type /ExtGState /ca ${f(g.fa)} /CA ${f(g.sa)} >>`).join(' ');
    const res = `<< /Font << /Fregular ${fontIds.regular} 0 R /Fbold ${fontIds.bold} 0 R /Fmono ${fontIds.mono} 0 R /Fserif ${fontIds.serif} 0 R >> /ExtGState << ${gsDict} >> /Shading << ${shadings.map(([nm, id]) => `/${nm} ${id} 0 R`).join(' ')} >> /XObject << ${images.map(([nm, id]) => `/${nm} ${id} 0 R`).join(' ')} >> >>`;
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f(ab.w * 0.75)} ${f(ab.h * 0.75)}] /Resources ${res} /Contents ${contentId} 0 R >>`));
  }
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
  // serialise
  const enc = new TextEncoder();
  const parts = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let len = parts[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(len);
    let chunk;
    if (o && o.stream) chunk = [enc.encode(`${i + 1} 0 obj\n${o.dict}\nstream\n`), o.stream, enc.encode('\nendstream\nendobj\n')];
    else chunk = [enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`)];
    for (const cpart of chunk) { parts.push(cpart); len += cpart.length; }
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info << /Producer (EYAD VECTOR) /Title ${pdfTitle(app.doc.name)} >> >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(enc.encode(xref));
  return new Blob(parts, { type: 'application/pdf' });
}
function pdfTitle(s) { return '(' + String(s).replace(/[()\\]/g, '').replace(/[^\x20-\x7e]/g, '?') + ')'; }
function shadingFor(p, b) {
  const f = (v) => (Math.round(v * 1000) / 1000).toString();
  const stops = [...p.stops].sort((a, c) => a.o - c.o);
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(f).join(' '); };
  const fns = [], bounds2 = [], encode = [];
  for (let i = 0; i < stops.length - 1; i++) { fns.push(`<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(stops[i].color)}] /C1 [${rgb(stops[i + 1].color)}] /N 1 >>`); if (i) bounds2.push(f(stops[i].o)); encode.push('0 1'); }
  const fn = fns.length === 1 ? fns[0] : `<< /FunctionType 3 /Domain [${f(stops[0].o)} ${f(stops[stops.length - 1].o)}] /Functions [${fns.join(' ')}] /Bounds [${bounds2.join(' ')}] /Encode [${encode.join(' ')}] >>`;
  const X = (u) => b.x + u * b.w, Y = (v) => b.y + v * b.h;
  if (p.kind === 'radial') { const r = Math.hypot((p.x2 - p.x1) * b.w, (p.y2 - p.y1) * b.h) || Math.max(b.w, b.h) / 2; return `<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [${f(X(p.x1))} ${f(Y(p.y1))} 0 ${f(X(p.x1))} ${f(Y(p.y1))} ${f(r)}] /Function ${fn} /Extend [true true] >>`; }
  return `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${f(X(p.x1))} ${f(Y(p.y1))} ${f(X(p.x2))} ${f(Y(p.y2))}] /Function ${fn} /Extend [true true] >>`;
}
function measureHelv(s, size, tracking = 0) {
  const c = document.createElement('canvas').getContext('2d'); c.font = `${size}px Helvetica, Arial, sans-serif`;
  return c.measureText(s).width + Math.max(0, s.length - 1) * tracking / 1000 * size;
}
async function toJPEG(src) {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
}
void apply;
