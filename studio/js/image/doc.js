// EYAD IMAGE — document model.
// Layers are stored bottom → top (index 0 is the bottom layer), like PSD.
import { uid } from '../core/dom.js';

export const BLEND_MODES = [
  ['normal', 'Normal', 'source-over'],
  ['multiply', 'Multiply', 'multiply'],
  ['screen', 'Screen', 'screen'],
  ['overlay', 'Overlay', 'overlay'],
  ['darken', 'Darken', 'darken'],
  ['lighten', 'Lighten', 'lighten'],
  ['color-dodge', 'Color Dodge', 'color-dodge'],
  ['linear-dodge', 'Linear Dodge (Add)', 'lighter'],
  ['color-burn', 'Color Burn', 'color-burn'],
  ['hard-light', 'Hard Light', 'hard-light'],
  ['soft-light', 'Soft Light', 'soft-light'],
  ['difference', 'Difference', 'difference'],
  ['exclusion', 'Exclusion', 'exclusion'],
  ['hue', 'Hue', 'hue'],
  ['saturation', 'Saturation', 'saturation'],
  ['color', 'Color', 'color'],
  ['luminosity', 'Luminosity', 'luminosity'],
];
export const BLEND_IDS = BLEND_MODES.map((b) => b[0]);
export const GCO = Object.fromEntries(BLEND_MODES.map(([id, , op]) => [id, op]));
GCO['pass-through'] = 'source-over';

export const FONTS = [
  ['Studio Inter', 'Inter'],
  ['Studio Oswald', 'Oswald'],
  ['Studio Mono', 'JetBrains Mono'],
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ['Helvetica Neue, Helvetica, Arial, sans-serif', 'Helvetica'],
  ['Georgia, serif', 'Georgia'],
  ['Times New Roman, Times, serif', 'Times New Roman'],
  ['Courier New, monospace', 'Courier New'],
  ['Impact, Haettenschweiler, sans-serif', 'Impact'],
  ['Trebuchet MS, sans-serif', 'Trebuchet MS'],
  ['Verdana, sans-serif', 'Verdana'],
  ['system-ui, sans-serif', 'System UI'],
];

export const MAX_SIDE = 12000;
export const MAX_AREA = 80e6;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export function ctx2d(c, opts) { return c.getContext('2d', opts || { willReadFrequently: false }); }
export function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

export function createDoc({ name = 'Untitled', width = 1920, height = 1080, background = 'white' } = {}) {
  const doc = {
    id: uid('d'),
    name,
    width: Math.round(width),
    height: Math.round(height),
    layers: [],
    activeId: null,
    selection: null,
    guides: [],
    meta: { source: 'new', created: Date.now() },
    projectId: null,
    colorProfile: 'sRGB',
  };
  if (background !== 'transparent') {
    const bg = makeNode('raster', { name: 'Background', width: doc.width, height: doc.height });
    const g = bg.canvas.getContext('2d');
    g.fillStyle = background === 'black' ? '#000000' : background.startsWith('#') ? background : '#ffffff';
    g.fillRect(0, 0, doc.width, doc.height);
    doc.layers.push(bg);
  } else {
    doc.layers.push(makeNode('raster', { name: 'Layer 1', width: doc.width, height: doc.height }));
  }
  doc.activeId = doc.layers[doc.layers.length - 1].id;
  return doc;
}

const BASE = () => ({ visible: true, opacity: 1, blend: 'normal', locked: false, x: 0, y: 0, sx: 1, sy: 1, rot: 0, clip: false, mask: null, maskEnabled: true });

export function makeNode(type, props = {}) {
  const n = { id: uid('n'), type, name: props.name || defaultName(type), ...BASE() };
  if (type === 'raster') {
    n.canvas = props.canvas || makeCanvas(props.width || 1, props.height || 1);
  } else if (type === 'text') {
    Object.assign(n, { text: 'Text', font: 'Studio Inter', size: 72, weight: 600, italic: false, color: '#111111', align: 'left', lineHeight: 1.2, tracking: 0 });
  } else if (type === 'shape') {
    Object.assign(n, { shape: 'rect', w: 100, h: 100, fill: '#d02b2a', fillOn: true, stroke: '#111111', strokeOn: false, strokeWidth: 4, radius: 0, points: null, closed: true });
  } else if (type === 'group') {
    n.children = [];
    n.expanded = true;
    n.blend = 'pass-through';
  }
  for (const [k, v] of Object.entries(props)) if (!['width', 'height'].includes(k)) n[k] = v;
  return n;
}

let counters = { raster: 1, text: 1, shape: 1, group: 1 };
function defaultName(type) {
  const base = { raster: 'Layer', text: 'Text', shape: 'Shape', group: 'Group' }[type] || 'Layer';
  return `${base} ${++counters[type]}`;
}
export function resetNameCounters(doc) {
  counters = { raster: 1, text: 1, shape: 1, group: 1 };
  walk(doc.layers, (n) => { counters[n.type] = (counters[n.type] || 1) + 1; });
}

// ---------------------------------------------------------------- tree

export function walk(nodes, fn, parent = null) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (fn(n, parent, i, nodes) === false) return false;
    if (n.type === 'group' && walk(n.children, fn, n) === false) return false;
  }
  return true;
}

export function findNode(doc, id) {
  let found = null;
  walk(doc.layers, (n, parent, index, arr) => {
    if (n.id === id) { found = { node: n, parent, index, arr }; return false; }
    return true;
  });
  return found;
}

export function allNodes(doc) { const out = []; walk(doc.layers, (n) => { out.push(n); }); return out; }
export function leaves(nodes) { const out = []; walk(nodes, (n) => { if (n.type !== 'group') out.push(n); }); return out; }

export function isAncestor(a, b) {
  // true if node a contains node b
  if (a.type !== 'group') return false;
  let hit = false;
  walk(a.children, (n) => { if (n === b) { hit = true; return false; } return true; });
  return hit;
}

/** Effective visibility / lock considering parents. */
export function pathTo(doc, id) {
  const path = [];
  const rec = (nodes, stack) => {
    for (const n of nodes) {
      if (n.id === id) { path.push(...stack, n); return true; }
      if (n.type === 'group' && rec(n.children, [...stack, n])) return true;
    }
    return false;
  };
  rec(doc.layers, []);
  return path;
}
export function effectiveVisible(doc, node) { return pathTo(doc, node.id).every((n) => n.visible); }
export function effectiveLocked(doc, node) { return pathTo(doc, node.id).some((n) => n.locked); }

// ---------------------------------------------------------------- geometry

export function localSize(node) {
  switch (node.type) {
    case 'raster': return { w: node.canvas.width, h: node.canvas.height };
    case 'text': { const l = layoutText(node); return { w: l.w, h: l.h }; }
    case 'shape': return { w: Math.max(1, node.w), h: Math.max(1, node.h) };
    default: return { w: 1, h: 1 };
  }
}

/** Layer → document matrix. */
export function nodeMatrix(node) {
  const { w, h } = localSize(node);
  const m = new DOMMatrix();
  m.translateSelf(node.x + w / 2, node.y + h / 2);
  if (node.rot) m.rotateSelf(node.rot);
  if (node.sx !== 1 || node.sy !== 1) m.scaleSelf(node.sx, node.sy);
  m.translateSelf(-w / 2, -h / 2);
  return m;
}

export function isIdentity(node) { return node.rot === 0 && node.sx === 1 && node.sy === 1; }

export function nodeCorners(node) {
  const { w, h } = localSize(node);
  const m = nodeMatrix(node);
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
}

export function nodeBounds(node) {
  if (node.type === 'group') {
    let b = null;
    for (const c of node.children) {
      if (!c.visible) continue;
      const cb = nodeBounds(c);
      if (!cb) continue;
      b = b ? unionRect(b, cb) : cb;
    }
    return b;
  }
  const pts = nodeCorners(node);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export function intersectRect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), bt = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || bt <= y) return null;
  return { x, y, w: r - x, h: bt - y };
}
export function roundRect(r) {
  const x = Math.floor(r.x), y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

export function docToLocal(node, x, y) {
  const p = nodeMatrix(node).inverse().transformPoint(new DOMPoint(x, y));
  return { x: p.x, y: p.y };
}

/** Topmost visible, unlocked leaf layer under the point. */
export function hitTest(doc, x, y, { includeLocked = false } = {}) {
  const list = [];
  walk(doc.layers, (n) => { list.push(n); });
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (n.type === 'group') continue;
    if (!effectiveVisible(doc, n)) continue;
    if (!includeLocked && effectiveLocked(doc, n)) continue;
    const p = docToLocal(n, x, y);
    const { w, h } = localSize(n);
    if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) continue;
    if (n.type === 'raster') {
      try {
        const px = n.canvas.getContext('2d').getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
        if (px[3] < 12) continue;
      } catch (e) { /* ignore */ }
    }
    return n;
  }
  return null;
}

// ---------------------------------------------------------------- text

let measureCtx = null;
export function fontString(n, scale = 1) {
  const fam = n.font.includes(',') ? n.font : `'${n.font.replace(/'/g, '')}'`;
  return `${n.italic ? 'italic ' : ''}${n.weight} ${n.size * scale}px ${fam}`;
}
export function layoutText(n) {
  const key = [n.text, n.font, n.size, n.weight, n.italic, n.lineHeight, n.tracking, n.align].join('|');
  if (n._layout && n._layout.key === key) return n._layout;
  if (!measureCtx) measureCtx = makeCanvas(1, 1).getContext('2d');
  measureCtx.font = fontString(n);
  if ('letterSpacing' in measureCtx) measureCtx.letterSpacing = (n.tracking || 0) + 'px';
  const lines = String(n.text || '').split('\n');
  const widths = lines.map((l) => measureCtx.measureText(l || ' ').width);
  const lh = n.size * n.lineHeight;
  const w = Math.max(4, Math.ceil(Math.max(...widths) + Math.abs(n.size * 0.08)));
  const h = Math.max(4, Math.ceil(lh * lines.length + n.size * 0.12));
  n._layout = { key, lines, widths, lh, w, h };
  return n._layout;
}

// ---------------------------------------------------------------- serialization

const NODE_KEYS = ['id', 'type', 'name', 'visible', 'opacity', 'blend', 'locked', 'x', 'y', 'sx', 'sy', 'rot', 'clip', 'maskEnabled',
  'text', 'font', 'size', 'weight', 'italic', 'color', 'align', 'lineHeight', 'tracking',
  'shape', 'w', 'h', 'fill', 'fillOn', 'stroke', 'strokeOn', 'strokeWidth', 'radius', 'points', 'closed', 'subpaths', 'fillRule',
  'expanded', 'psd', 'artboard'];

export function canvasToBlob(c, type = 'image/png', q) {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image (the canvas may be too large for this device).'))), type, q));
}

export async function serializeDoc(doc) {
  const assets = [];
  const ser = async (n) => {
    const o = {};
    for (const k of NODE_KEYS) if (n[k] !== undefined) o[k] = n[k];
    if (n.type === 'raster') {
      const path = `assets/${n.id}.png`;
      assets.push({ path, blob: await canvasToBlob(n.canvas) });
      o.asset = path;
    }
    if (n.mask) {
      const path = `assets/${n.id}-mask.png`;
      assets.push({ path, blob: await canvasToBlob(n.mask.canvas) });
      o.mask = { asset: path, x: n.mask.x, y: n.mask.y };
    }
    if (n.type === 'group') o.children = await Promise.all(n.children.map(ser));
    return o;
  };
  const json = {
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    activeId: doc.activeId,
    guides: doc.guides,
    meta: doc.meta,
    layers: await Promise.all(doc.layers.map(ser)),
  };
  return { json, assets };
}

async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = makeCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  return c;
}

export async function deserializeDoc(json, getAsset) {
  const { num, str, bool, oneOf, color } = await import('../core/eyad.js');
  const width = Math.round(num(json.width, 1920, 1, MAX_SIDE));
  const height = Math.round(num(json.height, 1080, 1, MAX_SIDE));
  const doc = createDoc({ name: str(json.name, 'Untitled', 200), width, height, background: 'transparent' });
  doc.layers = [];
  doc.guides = Array.isArray(json.guides) ? json.guides.filter((g) => g && (g.axis === 'x' || g.axis === 'y')).map((g) => ({ axis: g.axis, pos: num(g.pos) })).slice(0, 200) : [];
  doc.meta = { ...(json.meta && typeof json.meta === 'object' ? json.meta : {}), source: str(json.meta?.source, 'eyad', 20) };
  let count = 0;
  const de = async (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 40 || ++count > 5000) return null;
    const type = oneOf(o.type, ['raster', 'text', 'shape', 'group'], null);
    if (!type) return null;
    const n = makeNode(type, {});
    n.id = str(o.id, n.id, 64);
    n.name = str(o.name, n.name, 200);
    n.visible = bool(o.visible, true); n.locked = bool(o.locked, false); n.clip = bool(o.clip, false);
    n.opacity = num(o.opacity, 1, 0, 1);
    n.blend = oneOf(o.blend, [...BLEND_IDS, 'pass-through'], type === 'group' ? 'pass-through' : 'normal');
    n.x = num(o.x); n.y = num(o.y); n.sx = num(o.sx, 1, -100, 100) || 1; n.sy = num(o.sy, 1, -100, 100) || 1; n.rot = num(o.rot, 0, -3600, 3600);
    n.maskEnabled = bool(o.maskEnabled, true);
    if (o.psd && typeof o.psd === 'object') n.psd = JSON.parse(JSON.stringify(o.psd));
    if (type === 'raster') {
      const blob = o.asset ? await getAsset(str(o.asset, '', 200), 'image/png') : null;
      n.canvas = blob ? await blobToCanvas(blob) : makeCanvas(width, height);
    } else if (type === 'text') {
      n.text = str(o.text, '', 20000); n.font = str(o.font, 'Studio Inter', 200); n.size = num(o.size, 72, 1, 4000);
      n.weight = num(o.weight, 600, 100, 900); n.italic = bool(o.italic); n.color = color(o.color, '#111111');
      n.align = oneOf(o.align, ['left', 'center', 'right'], 'left'); n.lineHeight = num(o.lineHeight, 1.2, 0.5, 5); n.tracking = num(o.tracking, 0, -100, 500);
    } else if (type === 'shape') {
      n.shape = oneOf(o.shape, ['rect', 'ellipse', 'path'], 'rect'); n.w = num(o.w, 100, 1, 1e5); n.h = num(o.h, 100, 1, 1e5);
      n.fill = color(o.fill, '#d02b2a'); n.fillOn = bool(o.fillOn, true); n.stroke = color(o.stroke, '#111111'); n.strokeOn = bool(o.strokeOn, false);
      n.strokeWidth = num(o.strokeWidth, 4, 0, 1000); n.radius = num(o.radius, 0, 0, 1e5); n.closed = bool(o.closed, true);
      const pt = (p) => ({ x: num(p && p.x), y: num(p && p.y), ix: num(p && p.ix, num(p && p.x)), iy: num(p && p.iy, num(p && p.y)), ox: num(p && p.ox, num(p && p.x)), oy: num(p && p.oy, num(p && p.y)) });
      n.points = Array.isArray(o.points) ? o.points.slice(0, 5000).map(pt) : null;
      n.subpaths = Array.isArray(o.subpaths) ? o.subpaths.slice(0, 500).filter((sp) => sp && Array.isArray(sp.points)).map((sp) => ({ closed: bool(sp.closed, true), points: sp.points.slice(0, 5000).map(pt) })) : undefined;
      n.fillRule = oneOf(o.fillRule, ['nonzero', 'evenodd'], 'nonzero');
    } else if (type === 'group') {
      n.expanded = bool(o.expanded, true);
      if (o.artboard && typeof o.artboard === 'object') n.artboard = { x: num(o.artboard.x, 0, -1e5, 1e5), y: num(o.artboard.y, 0, -1e5, 1e5), w: num(o.artboard.w, 100, 1, 30000), h: num(o.artboard.h, 100, 1, 30000), bg: o.artboard.bg ? color(o.artboard.bg, '#ffffff') : null };
      n.children = [];
      if (Array.isArray(o.children)) for (const c of o.children) { const cn = await de(c, depth + 1); if (cn) n.children.push(cn); }
    }
    if (o.mask && o.mask.asset) {
      const blob = await getAsset(str(o.mask.asset, '', 200), 'image/png');
      if (blob) n.mask = { canvas: await blobToCanvas(blob), x: num(o.mask.x), y: num(o.mask.y) };
    }
    return n;
  };
  if (Array.isArray(json.layers)) for (const o of json.layers) { const n = await de(o, 0); if (n) doc.layers.push(n); }
  if (!doc.layers.length) doc.layers.push(makeNode('raster', { name: 'Layer 1', width, height }));
  const act = findNode(doc, json.activeId);
  doc.activeId = act ? act.node.id : doc.layers[doc.layers.length - 1].id;
  resetNameCounters(doc);
  return doc;
}

/** Deep clone for Duplicate (new ids, copied pixels). */
export function cloneNode(n, keepName = false) {
  const c = { ...n, id: uid('n') };
  delete c._layout; delete c._thumb;
  if (!keepName) c.name = n.name + ' copy';
  if (n.type === 'raster') c.canvas = cloneCanvas(n.canvas);
  if (n.mask) c.mask = { ...n.mask, canvas: cloneCanvas(n.mask.canvas) };
  if (n.points) c.points = n.points.map((p) => ({ ...p }));
  if (n.subpaths) c.subpaths = n.subpaths.map((sp) => ({ closed: sp.closed, points: sp.points.map((p) => ({ ...p })) }));
  if (n.type === 'group') c.children = n.children.map((ch) => cloneNode(ch, true));
  return c;
}

export function estimateBytes(doc) {
  let b = 0;
  walk(doc.layers, (n) => { if (n.canvas) b += n.canvas.width * n.canvas.height * 4; if (n.mask) b += n.mask.canvas.width * n.mask.canvas.height * 4; });
  return b;
}
