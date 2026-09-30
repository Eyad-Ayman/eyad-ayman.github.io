// EYAD Generate for EYAD IMAGE — generate images, fill a selection from a
// prompt, expand the canvas, remove objects and replace backgrounds.
//
// What runs where (and is said so in the UI):
//   • Text-to-image / Fill with prompt / Expand with prompt / Generate background:
//     the PROMPT TEXT goes to the free public Pollinations.ai service (consent asked
//     once); the user's image is never uploaded. The service only sees words, so
//     generated fills don't "see" the photo.
//   • Remove object: an on-device inpainting model (core/inpaint.js); when it can't be
//     loaded, the local patch-based Content-Aware Fill is used instead (and we say so).
//   • Expand without a prompt: local Content-Aware Fill of the new border — offline.
// Every result lands as a NEW LAYER (with a layer mask where it blends) and is undoable.
import { h, clamp } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, dialog, progressDialog, confirmDialog } from '../core/ui.js';
import {
  generateImage, ensureConsent, GENERATION_STYLES, ASPECTS, sizeForRatio, randomSeed, blobToCanvas,
  getApiKey, setApiKey, resetConsent, hasConsent, SERVICE,
} from '../core/genai.js';
import { removeWithModel, modelStatus, loadInpaintModel, forgetInpaintModel } from '../core/inpaint.js';
import { makeNode, makeCanvas, findNode, MAX_SIDE, MAX_AREA, walk } from './doc.js';
import { pixelCmd, stateCmd, treeCmd, compound } from './history.js';
import { localSelection } from './tools.js';
import { runFilter } from './filters.js';
import { contentAwareFill } from './pro.js';

// ---------------------------------------------------------------- helpers

let cssLoaded = false;
function ensureStyles() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  const href = new URL('../../css/generate.css', import.meta.url).href;
  if (!document.querySelector(`link[href="${href}"]`)) document.head.appendChild(h('link', { rel: 'stylesheet', href }));
}
const need = (app) => { if (!app.doc) { toast('Open or create a document first.'); return false; } return true; };
const layerName = (prompt, prefix = 'Generated') => (prefix + ' · ' + String(prompt).replace(/\s+/g, ' ').trim()).slice(0, 60);
const isAbort = (e) => e && (e.name === 'AbortError' || e.code === 'abort');
const errText = (e) => String(e && e.message || e).split('\n')[0].slice(0, 220);

/** Resample `src` into a w×h canvas: 'cover' fills (centre-crops), 'contain' letterboxes (transparent). */
export function fitCanvas(src, w, hh, mode = 'cover') {
  const c = makeCanvas(w, hh), g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const s = mode === 'cover' ? Math.max(w / src.width, hh / src.height) : Math.min(w / src.width, hh / src.height);
  const dw = src.width * s, dh = src.height * s;
  g.drawImage(src, (w - dw) / 2, (hh - dh) / 2, dw, dh);
  return c;
}

/** Blurred copy of a mask (alpha) — used to feather layer-mask edges. */
function feathered(src, r) {
  const c = makeCanvas(src.width, src.height), g = c.getContext('2d');
  if (r > 0 && 'filter' in g) g.filter = `blur(${r}px)`;
  g.drawImage(src, 0, 0);
  return c;
}

/** Add a raster layer from a canvas at (x, y), optionally with a layer mask; one undo step. */
export function addGeneratedLayer(app, canvas, { x = 0, y = 0, name = 'Generated', mask = null, label = 'Generate Image', below = null } = {}) {
  const n = makeNode('raster', { name, canvas });
  n.x = Math.round(x); n.y = Math.round(y);
  if (mask) { n.mask = { canvas: mask, x: 0, y: 0 }; n.maskEnabled = true; }
  if (below) {
    const f = findNode(app.doc, below.id);
    if (f) return app.insertNode(n, label, { parentArr: f.arr, index: f.index });
  }
  return app.insertNode(n, label);
}

// ---------------------------------------------------------------- the generate dialog

const fitOptions = (app) => {
  const out = [['canvas', 'Fit canvas (' + app.doc.width + ' × ' + app.doc.height + ')']];
  if (app.doc.selection) out.push(['selection', 'Fit selection']);
  return out.concat(ASPECTS.map(([id, label]) => [id, label]));
};

function ratioFor(app, fit) {
  const d = app.doc;
  if (fit === 'canvas') return d.width / d.height;
  if (fit === 'selection' && d.selection) return d.selection.bounds.w / Math.max(1, d.selection.bounds.h);
  const a = ASPECTS.find((x) => x[0] === fit);
  return a ? a[2] : 1;
}

let lastPrompt = '', lastStyle = 'photo', lastVariations = 4;

/**
 * Shared dialog. mode: 'image' (new layer) | 'fill' (selection) | 'background'.
 * onPick(canvas, prompt) places the chosen result; resolves when the dialog closes.
 */
async function generateDialog(app, { mode, title, fixedRatio = null, onPick, onRemove = null, intro = '' }) {
  ensureStyles();
  const ctl = { abort: null };
  const prompt = h('textarea', { class: 'studio-input', rows: 3, maxLength: 1000, placeholder: mode === 'fill' ? 'What should appear in the selection? (leave empty to remove what’s there)' : mode === 'background' ? 'Describe the new background, e.g. “sunlit marble studio, soft shadows”' : 'Describe the image, e.g. “a red vintage bicycle against a pastel wall”', 'aria-label': 'Prompt' });
  prompt.value = lastPrompt;
  const avoid = h('input', { class: 'studio-input', type: 'text', maxLength: 300, placeholder: 'e.g. text, people, blur', 'aria-label': 'Avoid' });
  const style = h('select', { class: 'studio-input', 'aria-label': 'Style' }, GENERATION_STYLES.map((s) => h('option', { value: s.id, text: s.label, selected: s.id === lastStyle })));
  const fit = fixedRatio ? null : h('select', { class: 'studio-input', 'aria-label': 'Shape' }, fitOptions(app).map(([v, l]) => h('option', { value: v, text: l })));
  const seed = h('input', { class: 'studio-input is-num', type: 'number', min: 1, max: 2147483647, value: randomSeed(), 'aria-label': 'Seed' });
  const dice = h('button', { class: 'studio-btn is-small', type: 'button', title: 'New random seed', onclick: () => { seed.value = randomSeed(); } }, h('span', { text: 'Random' }));
  const count = h('select', { class: 'studio-input', 'aria-label': 'Variations' }, [1, 2, 4].map((n) => h('option', { value: n, text: n === 1 ? '1 image' : n + ' variations', selected: n === lastVariations })));
  const status = h('div', { class: 'gen-status', role: 'status', 'aria-live': 'polite' });
  const grid = h('div', { class: 'gen-grid' });
  const go = h('button', { class: 'studio-btn is-primary', type: 'button' }, icon('sparkle', 14), h('span', { text: 'Generate' }));
  const stop = h('button', { class: 'studio-btn', type: 'button', hidden: true, onclick: () => ctl.abort && ctl.abort.abort() }, h('span', { text: 'Stop' }));
  const removeBtn = onRemove ? h('button', { class: 'studio-btn', type: 'button', onclick: () => { closeDlg(null); onRemove(); } }, icon('heal', 14), h('span', { text: 'Remove instead (on this device)' })) : null;
  const field = (label, el) => h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: label }), el);
  const body = h('div', { class: 'gen-form' },
    intro ? h('p', { class: 'gen-note', text: intro }) : null,
    field('Prompt', prompt),
    h('div', { class: 'gen-row' }, field('Style', style), fit ? field('Shape', fit) : null, field('Results', count)),
    h('details', { class: 'gen-details' }, h('summary', { text: 'More options' }),
      h('div', { class: 'gen-row' },
        field('Avoid (added to the prompt)', avoid),
        h('div', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Seed (same seed + prompt ≈ same image)' }), h('div', { class: 'gen-seed' }, seed, dice))),
    ),
    h('div', { class: 'gen-actions' }, go, stop, removeBtn),
    status, grid,
    h('p', { class: 'gen-note' }, h('strong', { text: 'Privacy: ' }), 'only your prompt text is sent to ', SERVICE.name, ' (free, no account; the public service may rate-limit or add a small logo). Your image is not uploaded.'));

  let closeDlg = () => {};
  const setStatus = (t, err = false) => { status.textContent = t || ''; status.classList.toggle('is-error', !!err); };
  const urls = [];

  go.addEventListener('click', async () => {
    const text = prompt.value.trim();
    if (!text) {
      if (onRemove) { closeDlg(null); onRemove(); return; }
      setStatus('Type a prompt first.', true); prompt.focus(); return;
    }
    if (!(await ensureConsent())) { setStatus('Not sent — generation needs your OK to send the prompt.', true); return; }
    lastPrompt = text; lastStyle = style.value; lastVariations = Number(count.value);
    const ratio = fixedRatio || ratioFor(app, fit.value);
    const { width, height } = sizeForRatio(ratio, 1024);
    const n = Number(count.value), base = Math.max(1, Math.round(Number(seed.value)) || randomSeed());
    ctl.abort = new AbortController();
    const signal = ctl.abort.signal;
    go.disabled = true; stop.hidden = false;
    grid.style.setProperty('--gen-ar', String(width / height));
    const cells = Array.from({ length: n }, (_, i) => {
      const cell = h('button', { class: 'gen-thumb is-pending', type: 'button', disabled: true, 'aria-label': 'Generating variation ' + (i + 1) }, h('span', { text: 'Generating…' }));
      grid.prepend(cell); return cell;
    }).reverse();
    let okCount = 0;
    for (let i = 0; i < n; i++) {
      const cell = cells[i], s = base + i;
      setStatus(n > 1 ? `Generating ${i + 1} of ${n}…` : 'Generating…');
      try {
        const blob = await generateImage({ prompt: text, width, height, seed: s, style: style.value, negative: avoid.value, signal, onStatus: (m) => setStatus(n > 1 ? `${m} (${i + 1} of ${n})` : m) });
        const c = await blobToCanvas(blob);
        const url = URL.createObjectURL(blob); urls.push(url);
        cell.replaceChildren(h('img', { src: url, alt: 'Generated: ' + text }), h('em', { text: 'seed ' + s }));
        cell.classList.remove('is-pending'); cell.disabled = false;
        cell.setAttribute('aria-label', 'Use variation ' + (i + 1) + ' (seed ' + s + ')');
        cell.title = 'Click to use this image';
        cell.onclick = () => { closeDlg(null); onPick(c, text, s, fit ? fit.value : null); };
        okCount++;
      } catch (e) {
        if (isAbort(e) || signal.aborted) {
          for (let j = i; j < n; j++) cells[j].remove();
          setStatus('Stopped.'); break;
        }
        cell.classList.remove('is-pending'); cell.classList.add('is-failed');
        cell.replaceChildren(h('span', { text: 'Failed' }));
        setStatus(errText(e), true);
        if (e.code === 'auth' || e.code === 'offline' || e.code === 'network' || e.code === 'rate') { for (let j = i + 1; j < n; j++) cells[j].remove(); break; }
      }
    }
    if (okCount && !signal.aborted) setStatus(okCount === 1 ? 'Click the image to use it.' : 'Click an image to use it. Same prompt + seed gives a similar result.');
    seed.value = base + n;
    go.disabled = false; stop.hidden = true; ctl.abort = null;
  });
  prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go.click(); } });

  await dialog({ title, body, width: 560, buttons: [{ label: 'Close', value: null }], className: 'gen-dialog',
    onOpen: ({ close }) => { closeDlg = close; setTimeout(() => prompt.focus(), 30); } });
  if (ctl.abort) ctl.abort.abort();
  setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000);
}

// ---------------------------------------------------------------- 1. Generate image → new layer

export async function generateImageDialog(app) {
  if (!need(app)) return;
  await generateDialog(app, {
    mode: 'image', title: 'Generate image',
    intro: 'Creates a new layer from your description.',
    onPick: (c, prompt, seed, fit) => {
      const r = targetRectForPick(app, c, fit);
      addGeneratedLayer(app, fitCanvas(c, r.w, r.h, 'cover'), { x: r.x, y: r.y, name: layerName(prompt), label: 'Generate Image' });
      toast('Added as a new layer — Undo removes it.', { type: 'ok', timeout: 2500 });
    },
  });
}

function targetRectForPick(app, c, fit) {
  const d = app.doc;
  if (fit === 'selection' && d.selection) { const b = d.selection.bounds; return { x: b.x, y: b.y, w: b.w, h: b.h }; }
  if (fit === 'canvas' || !fit) return { x: 0, y: 0, w: d.width, h: d.height };
  // aspect preset: as large as fits inside the canvas, centred
  const s = Math.min(d.width / c.width, d.height / c.height);
  const w = Math.max(1, Math.round(c.width * s)), hh = Math.max(1, Math.round(c.height * s));
  return { x: Math.round((d.width - w) / 2), y: Math.round((d.height - hh) / 2), w, h: hh };
}

// ---------------------------------------------------------------- 2. Fill with prompt (selection)

/** Layer placed over the selection's bounding box, masked (feathered) by the selection. */
export function placeInSelection(app, c, prompt, { label = 'Fill with Prompt', feather = null } = {}) {
  const d = app.doc, sel = d.selection;
  if (!sel) throw new Error('No selection');
  const b = sel.bounds;
  const x = clamp(Math.floor(b.x), 0, d.width - 1), y = clamp(Math.floor(b.y), 0, d.height - 1);
  const w = Math.max(1, Math.min(d.width - x, Math.ceil(b.w))), hh = Math.max(1, Math.min(d.height - y, Math.ceil(b.h)));
  const layer = fitCanvas(c, w, hh, 'cover');
  const m = makeCanvas(w, hh);
  m.getContext('2d').drawImage(sel.mask, -x, -y);
  const f = feather == null ? clamp(Math.round(Math.min(w, hh) * 0.02), 1, 16) : feather;
  return addGeneratedLayer(app, layer, { x, y, name: layerName(prompt, 'Fill'), mask: f ? feathered(m, f) : m, label });
}

export async function fillWithPrompt(app) {
  if (!need(app)) return;
  if (!app.doc.selection) { toast('First select the area to fill (Marquee, Lasso or Object Selection).', { type: 'warn', timeout: 5000 }); return; }
  const b = app.doc.selection.bounds;
  await generateDialog(app, {
    mode: 'fill', title: 'Fill with prompt', fixedRatio: b.w / Math.max(1, b.h),
    intro: 'Generates an image for the selected area and adds it as a new masked layer. The service only reads your words — it can’t see the photo — so mention lighting and angle to help it match. Leave the prompt empty to remove what’s selected instead.',
    onPick: (c, prompt) => {
      if (!app.doc.selection) { toast('The selection was cleared — make it again.', { type: 'warn' }); return; }
      placeInSelection(app, c, prompt);
      toast('Added as a masked layer — paint on its mask to refine, or Undo.', { type: 'ok', timeout: 3500 });
    },
    onRemove: () => removeSelection(app),
  });
}

// ---------------------------------------------------------------- 3. Remove (on-device model → local fallback)

const LS_DL = 'eyad-inpaint-download-ok';
async function okToDownload(st) {
  if (st.state !== 'remote') return true;
  try { if (localStorage.getItem(LS_DL) === 'yes') return true; } catch (e) { /* ignore */ }
  const ok = await confirmDialog('Download the removal model?',
    `Better object removal uses ${st.label}, a ${st.size} model that runs on this device. It downloads once from Hugging Face (your image is not uploaded) and then works offline. Otherwise the quick local Smart Fill is used.`,
    { ok: 'Download & remove', cancel: 'Use quick fill' });
  if (ok) { try { localStorage.setItem(LS_DL, 'yes'); } catch (e) { /* ignore */ } }
  return !!ok;
}

/** Remove what's selected on the active pixel layer. Uses the on-device model when possible. */
export async function removeSelection(app, { label = 'Remove Object' } = {}) {
  if (!need(app)) return false;
  const d = app.doc;
  if (!d.selection) { toast('First select what to remove — Object Selection (click it), the Lasso, or paint with the Spot Heal Brush (J).', { type: 'warn', timeout: 7000 }); app.selectTool && app.selectTool('aiselect'); return false; }
  const st = await modelStatus();
  const useModel = st.state !== 'unsupported' && st.state !== 'error' && await okToDownload(st);
  if (!useModel) return contentAwareFill(app, { label });
  const node = await app.ensureRasterTarget(label);
  if (!node) return false;
  const mask = localSelection(d, node);
  if (!mask) return false;
  const ctl = new AbortController();
  const prog = progressDialog(label);
  prog.onCancel(() => ctl.abort());
  prog.set(null, 'Starting on-device removal…');
  let out;
  try {
    out = await removeWithModel(node.canvas, mask, { signal: ctl.signal, onProgress: (f, t) => prog.set(f, t) });
  } catch (e) {
    prog.close();
    if (ctl.signal.aborted || isAbort(e)) return false;
    toast('On-device removal model unavailable (' + errText(e) + ') — used Smart Fill instead.', { type: 'warn', timeout: 7000 });
    return contentAwareFill(app, { label });
  }
  prog.close();
  const r = out._changed || { x: 0, y: 0, w: node.canvas.width, h: node.canvas.height };
  const g = node.canvas.getContext('2d', { willReadFrequently: true });
  const before = g.getImageData(r.x, r.y, r.w, r.h);
  g.clearRect(r.x, r.y, r.w, r.h);
  g.drawImage(out, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  const after = g.getImageData(r.x, r.y, r.w, r.h);
  app.commit(pixelCmd(label, node, r, before, after));
  node._dirtyThumb = true;
  app.invalidate();
  toast('Removed on this device — Undo to compare.', { type: 'ok', timeout: 2500 });
  return true;
}

// ---------------------------------------------------------------- 4. Generative expand

/** Pure geometry: new size + where the old canvas lands. sides = {top,right,bottom,left} px. */
export function expandGeometry(W, H, { mode = 'pixels', sides = {}, ratio = 16 / 9, anchor = 'c' } = {}) {
  if (mode === 'pixels') {
    const t = Math.max(0, Math.round(sides.top || 0)), r = Math.max(0, Math.round(sides.right || 0)), b = Math.max(0, Math.round(sides.bottom || 0)), l = Math.max(0, Math.round(sides.left || 0));
    return { W: W + l + r, H: H + t + b, dx: l, dy: t };
  }
  let NW = W, NH = H;
  if (W / H < ratio) NW = Math.round(H * ratio); else NH = Math.round(W / ratio);
  const fx = anchor.includes('l') ? 0 : anchor.includes('r') ? 1 : 0.5;
  const fy = anchor.includes('t') ? 0 : anchor.includes('b') ? 1 : 0.5;
  // anchor = where the ORIGINAL sits; the new area goes on the other side(s)
  return { W: NW, H: NH, dx: Math.round((NW - W) * fx), dy: Math.round((NH - H) * fy) };
}

/** Local fill of everything outside the original rect (content-aware, offline). */
async function localExpandFill(orig, geo) {
  const { W, H, dx, dy } = geo;
  const s = Math.min(1, Math.sqrt(6e6 / (W * H)));
  const w = Math.max(1, Math.round(W * s)), hh = Math.max(1, Math.round(H * s));
  const c = makeCanvas(w, hh), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(orig, dx * s, dy * s, orig.width * s, orig.height * s);
  const m = makeCanvas(w, hh), mg = m.getContext('2d', { willReadFrequently: true });
  mg.fillStyle = '#000'; mg.fillRect(0, 0, w, hh);
  const inset = 1; // overlap a pixel so rounding never leaves a seam
  mg.clearRect(Math.ceil(dx * s) + inset, Math.ceil(dy * s) + inset, Math.floor(orig.width * s) - 2 * inset, Math.floor(orig.height * s) - 2 * inset);
  const img = g.getImageData(0, 0, w, hh);
  const out = await runFilter('inpaint', img, { mask: mg.getImageData(0, 0, w, hh).data.slice().buffer });
  g.putImageData(out, 0, 0);
  return s === 1 ? c : fitCanvas(c, W, H, 'cover');
}

/** Build the expand layer: fill everywhere, the original softly blended back near its edges, and a mask that hides it deep inside. */
export function composeExpandLayer(fill, orig, geo, featherPx) {
  const { W, H, dx, dy } = geo, F = Math.max(1, Math.round(featherPx));
  const layer = makeCanvas(W, H), g = layer.getContext('2d');
  g.drawImage(fill, 0, 0, W, H);
  // Only feather the sides that actually got new area; untouched sides run to the edge.
  const ow = orig.width, oh = orig.height, out = 3 * F;
  const grew = { l: dx > 0, t: dy > 0, r: W - (dx + ow) > 0, b: H - (dy + oh) > 0 };
  const rectIn = (k) => {
    const x0 = grew.l ? dx + k : dx - out, y0 = grew.t ? dy + k : dy - out;
    const x1 = grew.r ? dx + ow - k : dx + ow + out, y1 = grew.b ? dy + oh - k : dy + oh + out;
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  };
  // original, faded out toward the grown edges, over the fill → soft seam
  const soft = makeCanvas(W, H), sg = soft.getContext('2d');
  if ('filter' in sg) sg.filter = `blur(${F / 2}px)`;
  sg.fillStyle = '#000';
  const r1 = rectIn(F); sg.fillRect(r1.x, r1.y, r1.w, r1.h);
  sg.filter = 'none';
  const o2 = makeCanvas(W, H), og = o2.getContext('2d');
  og.drawImage(orig, dx, dy);
  og.globalCompositeOperation = 'destination-in'; og.drawImage(soft, 0, 0);
  g.drawImage(o2, 0, 0);
  // layer mask: visible in the new area + the blend band; hidden deep inside (the real layers show there)
  const mask = makeCanvas(W, H), mg = mask.getContext('2d');
  mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H);
  const r2 = rectIn(Math.ceil(F * 2.5));
  if (r2.w > 1 && r2.h > 1) mg.clearRect(r2.x, r2.y, r2.w, r2.h);
  return { layer, mask };
}

/** Resize canvas + add the fill layer on top, as ONE undo step. */
function commitExpand(app, geo, layerCanvas, maskCanvas, name) {
  const d = app.doc, { W, H, dx, dy } = geo;
  const resize = stateCmd(d, 'Canvas Size', () => {
    walk(d.layers, (n) => { if (n.type !== 'group') { n.x += dx; n.y += dy; } });
    d.width = W; d.height = H;
    for (const g of d.guides) g.pos += g.axis === 'x' ? dx : dy;
    d.selection = null;
  });
  const n = makeNode('raster', { name, canvas: layerCanvas });
  n.mask = { canvas: maskCanvas, x: 0, y: 0 }; n.maskEnabled = true;
  const add = treeCmd(d, 'Add Expand Layer', () => { d.layers.push(n); d.activeId = n.id; });
  app.selectedIds = new Set([n.id]);
  app.commit(compound('Generative Expand', [resize, add], { resized: true }));
  app.docResized();
  return n;
}

export async function expandDialog(app) {
  if (!need(app)) return;
  ensureStyles();
  const d = app.doc;
  let mode = 'aspect', anchor = 'c';
  const num = (v, label) => h('input', { class: 'studio-input is-num', type: 'number', min: 0, max: MAX_SIDE, value: v, 'aria-label': label });
  const top = num(0, 'Top'), right = num(Math.round(d.width * 0.25), 'Right'), bottom = num(0, 'Bottom'), left = num(Math.round(d.width * 0.25), 'Left');
  const ratio = h('select', { class: 'studio-input', 'aria-label': 'Target shape' }, ASPECTS.map(([id, l, r]) => h('option', { value: String(r), text: l, selected: id === (d.width >= d.height ? '16:9' : '9:16') })));
  const anchorSel = h('select', { class: 'studio-input', 'aria-label': 'Keep the image at' }, [['c', 'Centre'], ['l', 'Left'], ['r', 'Right'], ['t', 'Top'], ['b', 'Bottom']].map(([v, l]) => h('option', { value: v, text: l })));
  anchorSel.addEventListener('change', () => { anchor = anchorSel.value; upd(); });
  const prompt = h('textarea', { class: 'studio-input', rows: 2, maxLength: 1000, placeholder: 'Optional — describe the scene to generate around it. Empty = extend from the image on this device.', 'aria-label': 'Prompt' });
  const style = h('select', { class: 'studio-input', 'aria-label': 'Style' }, GENERATION_STYLES.map((s) => h('option', { value: s.id, text: s.label, selected: s.id === 'photo' })));
  const info = h('div', { class: 'gen-note' });
  const pxBox = h('div', { class: 'gen-sides', hidden: true }, [['Top', top], ['Right', right], ['Bottom', bottom], ['Left', left]].map(([l, el]) => h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: l }), el)));
  const aspBox = h('div', { class: 'gen-row' }, h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Target shape' }), ratio), h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Keep the image at' }), anchorSel));
  const segBtn = (id, text) => h('button', { class: 'studio-btn is-small' + (id === mode ? ' is-on' : ''), type: 'button', dataset: { mode: id }, text, onclick: (e) => { mode = id; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget)); pxBox.hidden = mode !== 'pixels'; aspBox.hidden = mode !== 'aspect'; upd(); } });
  const seg = h('div', { class: 'gen-seg', role: 'group', 'aria-label': 'Expand by' }, segBtn('aspect', 'To a shape'), segBtn('pixels', 'By pixels'));
  const geoNow = () => expandGeometry(d.width, d.height, { mode, ratio: Number(ratio.value), anchor, sides: { top: +top.value, right: +right.value, bottom: +bottom.value, left: +left.value } });
  const upd = () => {
    const g = geoNow();
    const bad = g.W > MAX_SIDE || g.H > MAX_SIDE || g.W * g.H > MAX_AREA;
    info.textContent = (g.W === d.width && g.H === d.height) ? 'Nothing to add at this shape — the image already fits it.' : `New size ${g.W} × ${g.H} px${bad ? ' — too large' : ''}. ` + (prompt.value.trim() ? 'The new area will be generated from your prompt (text only is sent to ' + SERVICE.name + ').' : 'The new area is filled from the image’s own edges, on this device (works offline).');
  };
  [top, right, bottom, left, ratio].forEach((el) => el.addEventListener('input', upd));
  prompt.addEventListener('input', upd);
  upd();
  const body = h('div', { class: 'gen-form' },
    h('div', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Expand' }), seg),
    aspBox, pxBox,
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Prompt (optional)' }), prompt),
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Style (with a prompt)' }), style),
    info);
  const ok = await dialog({ title: 'Generative expand', body, width: 480, className: 'gen-dialog', buttons: [{ label: 'Cancel', value: false }, { label: 'Expand', value: true, primary: true }] });
  if (!ok) return;
  const geo = geoNow();
  if (geo.W === d.width && geo.H === d.height) { toast('Nothing to expand.'); return; }
  if (geo.W > MAX_SIDE || geo.H > MAX_SIDE || geo.W * geo.H > MAX_AREA) { toast(`That would be ${geo.W} × ${geo.H} px — over the ${MAX_SIDE} px / ${MAX_AREA / 1e6} MP limit.`, { type: 'error' }); return; }
  return runExpand(app, geo, { prompt: prompt.value.trim(), style: style.value });
}

/** Expand the canvas to `geo` and fill the new area (prompt → generated scene; else local fill). */
export async function runExpand(app, geo, { prompt = '', style = 'photo', signal } = {}) {
  const d = app.doc;
  app.view.updateComposite();
  const orig = makeCanvas(d.width, d.height);
  orig.getContext('2d').drawImage(app.view.comp, 0, 0);
  const F = clamp(Math.round(Math.min(d.width, d.height) * 0.03), 4, 64);
  let fill;
  if (prompt) {
    if (!(await ensureConsent())) return false;
    const ctl = new AbortController();
    const prog = progressDialog('Generative expand');
    prog.onCancel(() => ctl.abort());
    prog.set(null, 'Generating the surroundings…');
    try {
      const { width, height } = sizeForRatio(geo.W / geo.H, 1024);
      const blob = await generateImage({ prompt, style, width, height, signal: signal || ctl.signal, onStatus: (m) => prog.set(null, m) });
      fill = fitCanvas(await blobToCanvas(blob), geo.W, geo.H, 'cover');
    } catch (e) {
      prog.close();
      if (!isAbort(e)) toast(errText(e), { type: 'error', timeout: 7000 });
      return false;
    }
    prog.close();
  } else {
    const prog = progressDialog('Generative expand', { cancellable: false });
    prog.set(null, 'Extending the image on this device…');
    try { fill = await localExpandFill(orig, geo); }
    catch (e) { prog.close(); toast(errText(e), { type: 'error' }); return false; }
    prog.close();
  }
  const { layer, mask } = composeExpandLayer(fill, orig, geo, prompt ? F : Math.max(2, Math.round(F / 3)));
  commitExpand(app, geo, layer, mask, prompt ? layerName(prompt, 'Expand') : 'Expand fill');
  toast(prompt ? 'Canvas expanded with a generated layer (masked, feathered). Undo reverts both.' : 'Canvas expanded and filled on this device. Undo reverts both.', { type: 'ok', timeout: 3500 });
  return true;
}

// ---------------------------------------------------------------- 5. Generate background

export async function generateBackground(app) {
  if (!need(app)) return;
  const node = app.active;
  if (!node || node.type === 'group') { toast('Select the photo layer first.', { type: 'warn' }); return; }
  const d = app.doc;
  await generateDialog(app, {
    mode: 'background', title: 'Generate background', fixedRatio: d.width / d.height,
    intro: 'Keeps the subject of the selected layer (found on this device) and puts a generated background behind it on a new layer.',
    onPick: async (c, prompt) => {
      if (!findNode(app.doc, node.id)) return;
      app.setActive(node.id);
      const { removeBackground } = await import('./ai.js');
      await removeBackground(app);
      const bg = addGeneratedLayer(app, fitCanvas(c, app.doc.width, app.doc.height, 'cover'), { name: layerName(prompt, 'Background'), label: 'Generate Background', below: node });
      if (!node.mask) toast('No subject was masked, so the new background is hidden under the photo — mask the photo layer to reveal it.', { type: 'warn', timeout: 7000 });
      return bg;
    },
  });
}

// ---------------------------------------------------------------- panel (AI dock)

/** DOM element listing the generative actions, the removal model status and privacy notes. */
export function generatePanel(app, { onAction = () => {} } = {}) {
  ensureStyles();
  const item = (ic, title, desc, fn, badge) => h('button', { class: 'ai-item', type: 'button', onclick: () => { onAction(); fn(); } },
    h('span', { class: 'ai-item-icon' }, icon(ic, 18)),
    h('span', { class: 'ai-item-text' }, h('strong', {}, title, badge ? h('em', { class: 'ai-badge', text: badge }) : null), h('span', { text: desc })));
  const dot = h('i', { class: 'gen-dot' });
  const mText = h('span', { text: 'Checking the removal model…' });
  const mBtn = h('button', { class: 'studio-btn is-small', type: 'button', hidden: true });
  const refreshModel = async () => {
    const st = await modelStatus();
    dot.className = 'gen-dot' + (st.state === 'ready' || st.state === 'cached' ? ' is-ok' : st.state === 'loading' ? ' is-busy' : st.state === 'error' || st.state === 'unsupported' ? ' is-err' : '');
    mText.textContent = st.label + ': ' + ({ ready: 'ready, on this device', cached: 'downloaded — works offline', remote: `not downloaded (${st.size}, once)`, loading: st.message || 'loading…', error: 'unavailable — ' + (st.message || '') + ' (quick fill is used)', unsupported: st.message }[st.state] || st.state);
    mBtn.hidden = !(st.state === 'remote' || st.state === 'cached' || st.state === 'ready' || st.state === 'error');
    mBtn.textContent = st.state === 'remote' || st.state === 'error' ? 'Download' : 'Delete download';
    mBtn.onclick = async () => {
      if (st.state === 'remote' || st.state === 'error') {
        mBtn.disabled = true;
        try { await loadInpaintModel({ onProgress: (f, t) => { mText.textContent = t || 'Downloading…'; } }); try { localStorage.setItem(LS_DL, 'yes'); } catch (e) { /* ignore */ } }
        catch (e) { toast('Couldn’t get the removal model: ' + errText(e), { type: 'error', timeout: 6000 }); }
        mBtn.disabled = false;
      } else { await forgetInpaintModel(); try { localStorage.removeItem(LS_DL); } catch (e) { /* ignore */ } }
      refreshModel();
    };
  };
  refreshModel();
  const keyIn = h('input', { class: 'studio-input', type: 'password', autocomplete: 'off', placeholder: 'Optional personal Pollinations key', value: getApiKey(), 'aria-label': 'Pollinations key' });
  const consentBtn = h('button', { class: 'studio-btn is-small', type: 'button', text: 'Ask again before sending prompts', hidden: !hasConsent(), onclick: () => { resetConsent(); consentBtn.hidden = true; toast('You’ll be asked before the next prompt is sent.'); } });
  return h('div', { class: 'ai-panel gen-panel' },
    h('p', { class: 'ai-lede', text: 'Generate with a free public service (only your words are sent) or edit on this device (nothing leaves it).' }),
    h('div', { class: 'ai-group', text: 'Generate' }),
    item('sparkle', 'Generate image…', 'Text → a new layer (4 variations, styles, seed)', () => generateImageDialog(app), 'Online'),
    item('wand', 'Fill with prompt…', 'Generate into the selection as a masked layer', () => fillWithPrompt(app), 'Online'),
    item('image', 'Generate background…', 'Keep the subject, generate what’s behind it', () => generateBackground(app), 'Online'),
    item('expand', 'Generative expand…', 'Extend the canvas; empty prompt = fill on this device', () => expandDialog(app), 'Local / Online'),
    h('div', { class: 'ai-group', text: 'Remove' }),
    item('heal', 'Remove object', 'Erase the selection with the on-device model', () => removeSelection(app), 'On device'),
    h('div', { class: 'gen-model' }, dot, mText, mBtn),
    h('div', { class: 'ai-group', text: 'Privacy' }),
    h('p', { class: 'gen-note' }, h('strong', { text: 'Online tools ' }), 'send only the prompt text (plus style words, size and seed) to ', SERVICE.name, '. Free, no account; the public service may rate-limit, be unavailable or add a small logo. ',
      h('strong', { text: 'Your images are never uploaded. ' }), 'Remove object and Expand without a prompt run entirely on this device.'),
    h('details', { class: 'gen-details' }, h('summary', { text: 'Advanced' }),
      h('div', { class: 'studio-stack' },
        h('p', { class: 'gen-note', text: 'If the free anonymous tier stops working, you can paste your own Pollinations key. It is stored only in this browser and sent only to gen.pollinations.ai with your prompts.' }),
        h('div', { class: 'gen-seed' }, keyIn,
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Save', onclick: () => { setApiKey(keyIn.value); toast(keyIn.value.trim() ? 'Key saved on this device.' : 'Key removed.'); } }),
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Clear', onclick: () => { keyIn.value = ''; setApiKey(''); toast('Key removed.'); } })),
        consentBtn)));
}

/** Open the panel as a dialog (desktop) or bottom sheet (phones) — for a menu item / toolbar button. */
export function openGeneratePanel(app) {
  let close = () => {};
  const body = generatePanel(app, { onAction: () => close() });
  if (app.mobile && app.mobile.matches) {
    import('../core/ui.js').then(({ openSheet }) => { const s = openSheet({ title: 'EYAD Generate', content: body }); close = () => s.close(); });
  } else {
    dialog({ title: 'EYAD Generate', body, width: 460, buttons: [], onOpen: ({ close: c }) => { close = () => c(null); } });
  }
}
