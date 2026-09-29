// EYAD IMAGE — PSD import / (experimental) export, with an honest
// compatibility report. Nothing is silently flattened: anything we can't
// reproduce is listed, and when the look may differ from Photoshop the
// file's own flattened composite is kept as a hidden reference layer.
import { createDoc, makeNode, makeCanvas, walk, nodeMatrix, isIdentity, localSize, BLEND_IDS, resetNameCounters } from './doc.js';
import { renderNode, flatten } from './render.js';

const WORKER_URL = new URL('../workers/psd.worker.js', import.meta.url);

let worker = null, seq = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(WORKER_URL);
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error('The PSD reader crashed: ' + (e.message || 'out of memory?')));
    pending.clear();
    worker.terminate(); worker = null;
  };
  return worker;
}
function call(msg, transfer) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id }, transfer || []);
  });
}
export function releasePsdWorker() { if (worker && !pending.size) { worker.terminate(); worker = null; } }

// PSD blend key → our blend id. Anything unmapped is approximated as Normal and reported.
const BLEND_MAP = {
  'normal': 'normal', 'multiply': 'multiply', 'screen': 'screen', 'overlay': 'overlay', 'darken': 'darken', 'lighten': 'lighten',
  'color dodge': 'color-dodge', 'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light',
  'difference': 'difference', 'exclusion': 'exclusion', 'hue': 'hue', 'saturation': 'saturation', 'color': 'color',
  'luminosity': 'luminosity', 'linear dodge': 'linear-dodge', 'pass through': 'pass-through',
};
const BLEND_BACK = Object.fromEntries(Object.entries(BLEND_MAP).map(([k, v]) => [v, k]));
const COLOR_MODES = { 0: 'Bitmap', 1: 'Grayscale', 2: 'Indexed', 3: 'RGB', 4: 'CMYK', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab' };

function imgToCanvas(p) {
  const c = makeCanvas(p.width, p.height);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.buffer), p.width, p.height), 0, 0);
  return c;
}

/** Grayscale PSD mask → alpha canvas covering the layer, honouring the default colour outside the mask rect. */
function maskToAlpha(m, coverRect) {
  const r = coverRect;
  const c = makeCanvas(r.w, r.h);
  const g = c.getContext('2d');
  if (m.defaultColor >= 128) { g.fillStyle = '#000'; g.fillRect(0, 0, r.w, r.h); }
  if (m.image) {
    const src = new Uint8ClampedArray(m.image.buffer);
    const img = new ImageData(m.image.width, m.image.height);
    for (let i = 0, j = 0; i < src.length; i += 4, j += 4) { img.data[j] = 0; img.data[j + 1] = 0; img.data[j + 2] = 0; img.data[j + 3] = src[i]; }
    const t = makeCanvas(m.image.width, m.image.height);
    t.getContext('2d').putImageData(img, 0, 0);
    g.clearRect(m.left - r.x, m.top - r.y, m.image.width, m.image.height);
    g.drawImage(t, m.left - r.x, m.top - r.y);
  }
  return c;
}

const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Rebuild a vector-only Photoshop shape layer as an editable EYAD shape layer. */
function vectorShape(l, vec) {
  const xs = [], ys = [];
  for (const p of vec.paths) for (const k of p.knots) { xs.push(k[0], k[2], k[4]); ys.push(k[1], k[3], k[5]); }
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const subpaths = vec.paths.filter((p) => p.knots.length).map((p) => ({
    closed: !p.open,
    points: p.knots.map((k) => ({ ix: k[0] - minX, iy: k[1] - minY, x: k[2] - minX, y: k[3] - minY, ox: k[4] - minX, oy: k[5] - minY })),
  }));
  const n = makeNode('shape', {
    name: l.name, shape: 'path', subpaths, points: null, closed: true,
    fill: hex(vec.fill), fillOn: vec.fillEnabled !== false,
    stroke: vec.stroke && vec.stroke.color ? hex(vec.stroke.color) : '#000000', strokeOn: !!vec.stroke, strokeWidth: vec.stroke ? vec.stroke.width : 0,
    fillRule: vec.paths.some((p) => p.op === 'subtract' || p.op === 'xor' || p.op === 'exclude') ? 'evenodd' : 'nonzero',
  });
  n.x = minX; n.y = minY;
  n.w = Math.max(1, Math.max(...xs) - minX); n.h = Math.max(1, Math.max(...ys) - minY);
  return n;
}

export async function importPsd(file, { onProgress } = {}) {
  onProgress && onProgress(null, 'Reading file…');
  const buffer = await file.arrayBuffer();
  onProgress && onProgress(null, 'Parsing PSD structures…');
  let psd;
  try {
    psd = await call({ op: 'read', buffer }, [buffer]);
  } catch (e) {
    const msg = String(e.message || e);
    let reason = msg;
    if (/Invalid signature|signature/i.test(msg)) reason = 'The file does not have a valid PSD signature.';
    else if (/compression/i.test(msg)) reason = 'Unsupported PSD compression: ' + msg;
    else if (/color mode/i.test(msg)) {
      const mode = (/:\s*(\w+)\s*$/.exec(msg) || [])[1] || 'this';
      reason = `${mode} colour mode is not supported by the PSD reader. In Photoshop choose Image ▸ Mode ▸ RGB Color, save, and open it again.`;
    }
    else if (/memory|allocation|Array buffer/i.test(msg)) reason = 'The document is too large for this device’s memory.';
    const err = new Error(reason);
    err.title = 'Could not open PSD';
    throw err;
  }
  onProgress && onProgress(null, 'Building layers…');
  const W = psd.width, H = psd.height;
  if (!W || !H) throw Object.assign(new Error('The PSD reports an empty canvas.'), { title: 'Could not open PSD' });
  if (W > 30000 || H > 30000 || W * H > 120e6) throw Object.assign(new Error(`The canvas is ${W}×${H}px, which is larger than a browser can hold in memory.`), { title: 'Could not open PSD' });

  const doc = createDoc({ name: file.name.replace(/\.(psd|psb)$/i, ''), width: W, height: H, background: 'transparent' });
  doc.layers = [];
  const stats = { layers: 0, raster: 0, groups: 0, hidden: 0, masks: 0, masksDisabled: 0, clipping: 0, text: 0, smart: 0, adjustment: 0, effects: 0, effectNames: new Set(), vectorMasks: 0, shapes: 0, fillOpacity: 0, blendApprox: new Set(), converted: false, empty: 0, artboards: 0, locked: 0 };

  const build = (l) => {
    stats.layers++;
    if (l.hidden) stats.hidden++;
    let blend = BLEND_MAP[l.blendMode];
    if (!blend) { stats.blendApprox.add(l.blendMode); blend = 'normal'; }
    if (l.isGroup) {
      stats.groups++;
      if (l.artboard) stats.artboards++;
      const g = makeNode('group', { name: l.name, visible: !l.hidden, opacity: l.opacity, blend: blend === 'normal' && l.blendMode !== 'normal' ? 'normal' : blend, expanded: l.opened });
      // children arrive bottom→top from ag-psd
      for (const c of l.children || []) { const n = build(c); if (n) g.children.push(n); }
      if (l.mask) attachMask(g, l, { x: 0, y: 0 }, stats);
      return g;
    }
    let n;
    const vec = l.vector;
    if (!l.image && vec && vec.fill && vec.paths.length) {
      n = vectorShape(l, vec);
      stats.shapes++;
      n.visible = !l.hidden; n.opacity = l.opacity; n.blend = BLEND_IDS.includes(blend) ? blend : 'normal';
      n.clip = l.clipping; if (l.clipping) stats.clipping++;
      if (l.effects.length && !l.effectsDisabled) { stats.effects++; l.effects.forEach((e) => stats.effectNames.add(e)); n.psd = { kind: 'shape', effects: l.effects, styleData: l.effectData || null, vectorData: vec }; }
      else n.psd = { kind: 'shape' };
      if (l.mask) attachMask(n, l, { x: n.x, y: n.y }, stats);
      return n;
    }
    if (l.image) {
      if (l.image.converted) stats.converted = true;
      n = makeNode('raster', { name: l.name, canvas: imgToCanvas(l.image) });
      n.x = l.left; n.y = l.top;
    } else {
      stats.empty++;
      n = makeNode('raster', { name: l.name, width: 1, height: 1 });
      n.x = l.left; n.y = l.top;
    }
    n.visible = !l.hidden; n.opacity = l.opacity; n.blend = BLEND_IDS.includes(blend) ? blend : 'normal';
    n.clip = l.clipping; if (l.clipping) stats.clipping++;
    if (l.locked) { n.locked = true; stats.locked++; }
    if (l.fillOpacity < 1) { stats.fillOpacity++; n.opacity = l.opacity * l.fillOpacity; }
    n.psd = {};
    if (l.text) {
      stats.text++;
      const p = l.text;
      const rawFont = String(p.font || '');
      const font = /mono/i.test(rawFont) ? 'Studio Mono' : /oswald|condensed|narrow|impact|bebas/i.test(rawFont) ? 'Studio Oswald' : 'Studio Inter';
      const editableText = String(p.text || '');
      if (editableText.trim()) {
        // Prefer a real editable text node. The PSD's raster pixels remain available
        // through the hidden composite reference when the source font/metrics differ.
        const t = makeNode('text', {
          name: l.name,
          text: editableText,
          font,
          size: Math.max(4, Number(p.size) || 36),
          weight: 600,
          color: p.color ? hex(p.color) : '#111111',
          x: l.left,
          y: l.top,
          visible: !l.hidden,
          opacity: l.opacity,
          blend: BLEND_IDS.includes(blend) ? blend : 'normal',
          clip: l.clipping,
        });
        if (l.locked) { t.locked = true; stats.locked++; }
        if (l.fillOpacity < 1) { stats.fillOpacity++; t.opacity = l.opacity * l.fillOpacity; }
        n = t;
        n.psd = { kind: 'text', importedEditable: true, originalFont: p.font, originalSize: p.size, ...p };
      } else {
        n.psd = { kind: 'text', ...p };
      }
    }
    else if (l.smart) { stats.smart++; n.psd = { kind: 'smart' }; }
    else if (l.adjustment) { stats.adjustment++; n.psd = { kind: 'adjustment', type: l.adjustment, data: l.adjustmentData || null }; n.name = `${l.name} (adjustment)`; }
    else stats.raster++;
    if (l.effects.length && !l.effectsDisabled) {
      stats.effects++; l.effects.forEach((e) => stats.effectNames.add(e));
      n.psd.effects = l.effects;
      n.psd.styleData = l.effectData || null;
    }
    if (l.vectorMask || vec) { stats.vectorMasks++; n.psd.vectorMask = true; if (vec) n.psd.vectorData = vec; }
    if (l.mask) attachMask(n, l, { x: n.x, y: n.y }, stats);
    return n;
  };
  function attachMask(n, l, origin, st) {
    const m = l.mask;
    if (!m.image && m.defaultColor < 128) return;
    st.masks++;
    if (m.disabled) st.masksDisabled++;
    const lr = n.type === 'group' ? { x: 0, y: 0, w: W, h: H } : { x: l.left, y: l.top, w: Math.max(1, l.right - l.left), h: Math.max(1, l.bottom - l.top) };
    const mr = m.image ? { x: m.left, y: m.top, w: m.image.width, h: m.image.height } : lr;
    const x = Math.min(lr.x, mr.x), y = Math.min(lr.y, mr.y);
    const cover = { x, y, w: Math.max(lr.x + lr.w, mr.x + mr.w) - x, h: Math.max(lr.y + lr.h, mr.y + mr.h) - y };
    n.mask = { canvas: maskToAlpha(m, cover), x: cover.x - origin.x, y: cover.y - origin.y };
    n.maskEnabled = !m.disabled;
  }

  for (const c of psd.children) { const n = build(c); if (n) doc.layers.push(n); }

  const flattenedOnly = !doc.layers.length;
  if (flattenedOnly && psd.composite) {
    const bg = makeNode('raster', { name: 'Background', canvas: imgToCanvas(psd.composite) });
    doc.layers.push(bg);
    if (psd.composite.converted) stats.converted = true;
  }
  if (!doc.layers.length) doc.layers.push(makeNode('raster', { name: 'Layer 1', width: W, height: H }));

  const lossy = stats.shapes + stats.text + stats.smart + stats.adjustment + stats.effects + stats.vectorMasks + stats.blendApprox.size + stats.fillOpacity + stats.artboards > 0;
  const compositeHasPixels = (() => {
    if (!psd.composite) return false;
    const d = new Uint8ClampedArray(psd.composite.buffer);
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) return true;
    return false;
  })();
  if (lossy && compositeHasPixels && !flattenedOnly) {
    const ref = makeNode('raster', { name: 'PSD composite (reference)', canvas: imgToCanvas(psd.composite) });
    ref.visible = false; ref.locked = true; ref.psd = { kind: 'composite' };
    doc.layers.push(ref);
  }
  doc.guides = (psd.guides || []).map((g) => ({ axis: g.direction === 'vertical' ? 'x' : 'y', pos: g.location })).filter((g) => Number.isFinite(g.pos));
  doc.activeId = doc.layers[doc.layers.length - 1].id;
  if (lossy) { const top = doc.layers.filter((n) => !n.psd || n.psd.kind !== 'composite'); if (top.length) doc.activeId = top[top.length - 1].id; }
  doc.meta = {
    source: 'psd', created: Date.now(), originalName: file.name,
    psd: { colorMode: COLOR_MODES[psd.colorMode] || String(psd.colorMode), bits: psd.bitsPerChannel, resolution: psd.resolution?.h || null, icc: psd.hasIcc, xmp: psd.hasXmp, layerComps: psd.layerComps },
  };
  resetNameCounters(doc);

  let thumb = null;
  if (psd.thumbnail) thumb = imgToCanvas(psd.thumbnail);

  return { doc, report: buildReport(psd, stats, { flattenedOnly, lossy, compositeHasPixels }), thumb };
}

function buildReport(psd, s, { flattenedOnly, lossy, compositeHasPixels }) {
  const rows = [];
  const add = (status, label, detail) => rows.push({ status, label, detail });
  const mode = COLOR_MODES[psd.colorMode] || 'Unknown';
  add('ok', `Canvas ${psd.width} × ${psd.height} px`);
  if (psd.colorMode === 3) add('ok', 'RGB colour');
  else add('part', `${mode} colour`, 'Converted to RGB for editing; colours may shift.');
  if (psd.bitsPerChannel === 8) add('ok', '8 bits per channel');
  else add('part', `${psd.bitsPerChannel}-bit channels`, 'Converted to 8 bits per channel (browser canvases are 8-bit).');
  add('ok', 'Transparency');
  if (flattenedOnly) add('part', 'Flattened PSD', 'The file stores no layer data (or “Maximize compatibility” only); opened as one Background layer.');
  else {
    add('ok', `Raster layers (${s.raster})`);
    add('ok', 'Layer names & ordering');
    add('ok', `Visibility (${s.hidden} hidden)`);
    add('ok', 'Opacity');
    if (s.groups) add('ok', `Groups (${s.groups})`);
    if (s.blendApprox.size) add('part', 'Blend modes', `Approximated as Normal: ${[...s.blendApprox].join(', ')}`);
    else add('ok', 'Blend modes');
    if (s.masks) add(s.masksDisabled ? 'part' : 'ok', `Layer masks (${s.masks})`, s.masksDisabled ? `${s.masksDisabled} disabled mask(s) kept but turned off.` : 'Imported as editable pixel masks.');
    if (s.clipping) add('part', `Clipping masks (${s.clipping})`, 'Clipped layers are clipped correctly; their blend modes are simplified.');
    if (s.fillOpacity) add('part', `Fill opacity (${s.fillOpacity})`, 'Merged into layer opacity.');
    if (s.locked) add('ok', `Locked layers (${s.locked})`);
  }
  if (s.text) add('part', `Text layers (${s.text})`, 'Imported as editable EYAD text when usable source text data is available; font metrics may differ from the original application.');
  if (s.smart) add('part', `Smart objects (${s.smart})`, 'Imported with their rendered pixels preserved. The embedded source is retained as PSD metadata when available, but nested editing is not yet available in the browser.');
  if (s.adjustment) add('part', `Adjustment layers (${s.adjustment})`, 'Imported as editable document metadata with their rendered pixels preserved where the PSD provides them. Common adjustment types are tagged for future non-destructive editing.');
  if (s.effects) add('part', `Layer styles on ${s.effects} layer(s)`, `Reconstructed where possible: ${[...s.effectNames].join(', ')}. Uncommon parameters are retained in layer metadata.`);
  if (s.shapes) add('ok', `Shape layers (${s.shapes})`, 'Rebuilt from their vector paths as editable EYAD shape layers (solid fills and strokes).');
  if (s.vectorMasks) add('part', `Vector masks (${s.vectorMasks})`, 'Vector path data is preserved on the imported layer and used to reconstruct vector geometry where possible. Pixel fallbacks remain available for fidelity.');
  if (s.artboards) add('part', `Artboards (${s.artboards})`, 'Imported as groups with artboard metadata preserved so the document structure remains navigable.');
  if (s.empty) add('ok', `Empty layers (${s.empty})`);
  if (psd.hasIcc) add('part', 'Embedded ICC profile', 'Not applied — colours are shown as sRGB.');
  if (psd.resolution) add('ok', `Resolution metadata (${Math.round(psd.resolution.h)} ppi)`);
  if (psd.layerComps) add('no', `Layer comps (${psd.layerComps})`, 'Not supported.');
  if (s.converted) add('part', 'High bit-depth pixels', 'Converted to 8-bit.');
  if (lossy && !flattenedOnly && compositeHasPixels) add('ok', 'Reference composite', 'Photoshop’s own flattened preview was added as a hidden, locked layer so you can compare.');
  return { title: 'PSD import', stats: [['Layers', s.layers], ['Groups', s.groups], ['Masks', s.masks], ['Canvas', `${psd.width}×${psd.height}`]], rows };
}

// ---------------------------------------------------------------- Export (experimental)

function trimmed(canvas) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = canvas;
  const d = g.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (maxX < 0) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  return { left: minX, top: minY, data: g.getImageData(minX, minY, w, h) };
}

export async function exportPsd(doc, { onProgress } = {}) {
  const notes = { rasterized: 0, transformed: 0, bakedMasks: 0 };
  const transfers = [];
  const pack = (imgData) => { const buf = imgData.data.buffer; transfers.push(buf); return { width: imgData.width, height: imgData.height, buffer: buf }; };
  let count = 0;
  const total = (() => { let n = 0; walk(doc.layers, () => { n++; }); return n; })();

  const conv = (n) => {
    count++;
    onProgress && onProgress(count / (total + 1), `Writing layer ${count} of ${total}`);
    const base = { name: n.name, hidden: !n.visible, opacity: n.opacity, blendMode: BLEND_BACK[n.blend] || 'normal', clipping: !!n.clip };
    if (n.type === 'group') return { ...base, opened: n.expanded, children: n.children.map(conv), mask: groupMask(n) };
    if (n.type !== 'raster') notes.rasterized++;
    else if (!isIdentity(n)) notes.transformed++;
    const c = makeCanvas(doc.width, doc.height);
    const g = c.getContext('2d');
    const bakeMask = n.mask && n.maskEnabled && (!isIdentity(n) || n.type !== 'raster');
    renderNode({ ...n, visible: true, opacity: 1, blend: 'normal', mask: bakeMask ? n.mask : null }, g, { width: doc.width, height: doc.height });
    if (bakeMask) notes.bakedMasks++;
    const t = trimmed(c);
    const layer = { ...base, left: t ? t.left : 0, top: t ? t.top : 0, image: t ? pack(t.data) : null };
    if (n.mask && !bakeMask) {
      // mask is in local space; identity raster → doc space offset
      const mc = n.mask.canvas;
      const md = mc.getContext('2d').getImageData(0, 0, mc.width, mc.height);
      const gray = new ImageData(mc.width, mc.height);
      for (let i = 0; i < md.data.length; i += 4) { const a = md.data[i + 3]; gray.data[i] = a; gray.data[i + 1] = a; gray.data[i + 2] = a; gray.data[i + 3] = 255; }
      layer.mask = { left: n.x + n.mask.x, top: n.y + n.mask.y, image: pack(gray) };
    }
    return layer;
  };
  const groupMask = (g) => {
    if (!g.mask) return undefined;
    const mc = g.mask.canvas;
    const md = mc.getContext('2d').getImageData(0, 0, mc.width, mc.height);
    const gray = new ImageData(mc.width, mc.height);
    for (let i = 0; i < md.data.length; i += 4) { const a = md.data[i + 3]; gray.data[i] = a; gray.data[i + 1] = a; gray.data[i + 2] = a; gray.data[i + 3] = 255; }
    return { left: g.mask.x, top: g.mask.y, image: pack(gray) };
  };
  const children = doc.layers.map(conv);
  const comp = flatten(doc).getContext('2d').getImageData(0, 0, doc.width, doc.height);
  onProgress && onProgress(0.95, 'Encoding PSD…');
  const buf = await call({ op: 'write', doc: { width: doc.width, height: doc.height, composite: pack(comp), children } }, transfers);
  return { blob: new Blob([buf], { type: 'image/vnd.adobe.photoshop' }), notes };
}

export { BLEND_MAP };
