// EYAD STUDIO — tiny design kit used by the template generators.
// Every helper returns plain EYAD VECTOR nodes (see js/vector/model.js), so a
// template is just data: it validates, edits and exports like any other doc.
import { uid } from '../core/dom.js';
import { createDoc, rectPath, ellipsePath, polygonPath, starPath, pt, transformNode, rotateAbout } from '../vector/model.js';

export const INTER = 'Studio Inter', OSW = 'Studio Oswald', MONO = 'Studio Mono', PF = 'Studio Playfair', BB = 'Studio Bebas',
  MS = 'Studio Montserrat', PP = 'Studio Poppins', DMS = 'Studio DM Serif', SG = 'Studio Space Grotesk', CV = 'Studio Caveat',
  AB = 'Studio Archivo Black', GV = 'Studio Great Vibes', CA = 'Studio Cairo';

const K = 0.5522847498;
const deg = (d) => d * Math.PI / 180;

// ------------------------------------------------------------------ paints

export const solid = (c, a = 1) => ({ kind: 'solid', color: c, a });
const stops = (list) => list.map(([o, c, a = 1]) => ({ o, color: c, a }));
/** Linear gradient in bounding-box units (x1,y1 → x2,y2). Default: top → bottom. */
export const lin = (list, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => ({ kind: 'linear', x1, y1, x2, y2, stops: stops(list) });
export const rad = (list, cx = 0.5, cy = 0.5, r = 0.5) => ({ kind: 'radial', x1: cx, y1: cy, x2: cx + r, y2: cy, stops: stops(list) });
export const pat = (name, color, bg = null, scale = 12) => ({ kind: 'pattern', name, color, bg, scale });
const paint = (p) => (p == null ? null : typeof p === 'string' ? solid(p) : p);

function style(o) {
  return { fill: paint(o.fill), stroke: paint(o.stroke), sw: o.sw ?? (o.stroke ? 2 : 0), cap: o.cap || 'round', join: o.join || 'round', dash: o.dash || '', opacity: o.op ?? 1, blend: o.blend || 'normal' };
}
function finish(n, o) {
  if (o.rot) transformNode(n, rotateAbout(deg(o.rot), o.ox ?? 0, o.oy ?? 0));
  return n;
}

// ------------------------------------------------------------------ shapes

export function P(subpaths, o = {}, fallback = 'Shape') {
  const n = { id: uid('n'), type: 'path', name: o.name || fallback, hidden: false, locked: !!o.lock, subpaths, fillRule: o.rule || 'nonzero', style: style(o) };
  return finish(n, o);
}
export const R = (x, y, w, h, o = {}) => P(rectPath(x, y, w, h, o.r || 0), { ox: x + w / 2, oy: y + h / 2, ...o }, 'Rectangle');
export const E = (cx, cy, rx, ry = rx, o = {}) => P(ellipsePath(cx, cy, rx, ry), { ox: cx, oy: cy, ...o }, 'Ellipse');
export const POLY = (points, o = {}) => P([{ closed: o.open ? false : true, pts: points.map(([x, y]) => pt(x, y)) }], o, 'Polygon');
export const NGON = (cx, cy, r, n, o = {}) => P(polygonPath(cx, cy, r, n, deg(o.a ?? -90)), { ox: cx, oy: cy, ...o }, 'Polygon');
export const STAR = (cx, cy, r, n, inner = 0.45, o = {}) => P(starPath(cx, cy, r, n, inner, deg(o.a ?? -90)), { ox: cx, oy: cy, ...o }, 'Star');
export const L = (x1, y1, x2, y2, o = {}) => P([{ closed: false, pts: [pt(x1, y1), pt(x2, y2)] }], { stroke: '#000000', sw: 2, ...o, fill: null }, 'Line');

/** Smooth closed curve through points (Catmull-Rom → Bézier). */
export function smooth(points, o = {}, tension = 1 / 6) {
  const n = points.length;
  const pts = points.map((p, i) => {
    const a = points[(i - 1 + n) % n], b = points[(i + 1) % n];
    const dx = (b[0] - a[0]) * tension, dy = (b[1] - a[1]) * tension;
    return { x: p[0], y: p[1], hi: [p[0] - dx, p[1] - dy], ho: [p[0] + dx, p[1] + dy], smooth: true };
  });
  return P([{ closed: true, pts }], o, 'Blob');
}
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function blob(cx, cy, r, o = {}) {
  const rand = rng(o.seed || 7), n = o.n || 7, v = o.v ?? 0.22, pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, rr = r * (1 - v / 2 + rand() * v); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * (o.sy || 1)]); }
  return smooth(pts, { name: 'Blob', ...o });
}
/** Filled band whose top edge is a smooth wave. */
export function wave(x, y, w, h, amp, periods, o = {}) {
  const steps = periods * 2, seg = w / steps, pts = [];
  for (let i = 0; i <= steps; i++) {
    const px = x + i * seg, py = y + (i % 2 ? amp : -amp);
    pts.push({ x: px, y: py, hi: i ? [px - seg * 0.5, py] : null, ho: i < steps ? [px + seg * 0.5, py] : null, smooth: true });
  }
  pts.push(pt(x + w, y + h), pt(x, y + h));
  return P([{ closed: true, pts }], o, 'Wave');
}
/** Leaf: a lens shape of length `len`, rotated by `a` degrees around its centre. */
export function leaf(cx, cy, len, a, o = {}) {
  const l = len / 2, b = len * (o.fat || 0.28);
  const n = P([{ closed: true, pts: [
    { x: cx - l, y: cy, hi: [cx - l / 2, cy + b], ho: [cx - l / 2, cy - b], smooth: false },
    { x: cx + l, y: cy, hi: [cx + l / 2, cy - b], ho: [cx + l / 2, cy + b], smooth: false },
  ] }], { ...o, rot: 0 }, 'Leaf');
  transformNode(n, rotateAbout(deg(a), cx, cy));
  return n;
}
/** Rectangle with a semicircular top (arch window). */
export function archPts(x, y, w, h) {
  const r = w / 2, k = r * K;
  return [{ closed: true, pts: [
    { x, y: y + h, hi: null, ho: null, smooth: false }, { x: x + w, y: y + h, hi: null, ho: null, smooth: false },
    { x: x + w, y: y + r, hi: null, ho: [x + w, y + r - k], smooth: false },
    { x: x + r, y, hi: [x + r + k, y], ho: [x + r - k, y], smooth: true },
    { x, y: y + r, hi: [x, y + r - k], ho: null, smooth: false },
  ] }];
}
export const ARCH = (x, y, w, h, o = {}) => P(archPts(x, y, w, h), o, 'Arch');
/** Quarter disc of radius s with its centre at corner (cx, cy); q = 0..3 picks the quadrant (0 = bottom-right). */
export function QUARTER(cx, cy, s, q, o = {}) {
  const dirs = [[1, 1], [-1, 1], [-1, -1], [1, -1]][q], [dx, dy] = dirs, k = s * K;
  return P([{ closed: true, pts: [
    pt(cx, cy),
    { x: cx + dx * s, y: cy, hi: null, ho: [cx + dx * s, cy + dy * k], smooth: false },
    { x: cx, y: cy + dy * s, hi: [cx + dx * k, cy + dy * s], ho: null, smooth: false },
  ] }], o, 'Quarter circle');
}
/** Half disc: flat side on the line through (cx,cy); side = 'up'|'down'|'left'|'right' (direction of the bulge). */
export function HALF(cx, cy, s, side, o = {}) {
  const k = s * K;
  const rot = { down: 0, left: 90, up: 180, right: 270 }[side];
  const n = P([{ closed: true, pts: [
    { x: cx - s, y: cy, hi: null, ho: [cx - s, cy + k], smooth: false },
    { x: cx, y: cy + s, hi: [cx - k, cy + s], ho: [cx + k, cy + s], smooth: true },
    { x: cx + s, y: cy, hi: [cx + s, cy + k], ho: null, smooth: false },
  ] }], { ...o, rot: 0 }, 'Half circle');
  if (rot) transformNode(n, rotateAbout(deg(rot), cx, cy));
  return n;
}

// ------------------------------------------------------------------ text

/**
 * Text node. (x, y) is the first baseline; with `a: 'center'|'right'` and no width,
 * x is the centre / right edge. `wd` turns it into wrapped area text.
 */
export function T(text, x, y, o = {}) {
  // Arabic lines are wrapped in right-to-left marks so trailing punctuation,
  // % signs and digits order correctly inside the (left-to-right) SVG text.
  if (/[\u0600-\u06ff]/.test(text)) text = text.split('\n').map((l) => (/[\u0600-\u06ff]/.test(l) ? '\u200f' + l + '\u200f' : l)).join('\n');
  const n = {
    id: uid('n'), type: 'text', name: o.name || (text.length > 24 ? text.slice(0, 24).replace(/\n/g, ' ') + '…' : text.replace(/\n/g, ' ')).replace(/\u200f/g, ''), hidden: false, locked: false,
    text, font: o.f || INTER, size: o.s || 48, weight: o.w || 400, italic: !!o.it, tracking: o.tr || 0, leading: o.ld || 1.2,
    align: o.a || 'left', width: o.wd || 0, tf: [1, 0, 0, 1, x, y],
    style: style({ fill: o.fill || (o.c === null ? null : o.c || '#111111'), stroke: o.stroke, sw: o.sw, op: o.op }),
  };
  if (o.rot) n.tf = [Math.cos(deg(o.rot)), Math.sin(deg(o.rot)), -Math.sin(deg(o.rot)), Math.cos(deg(o.rot)), x, y];
  return n;
}

// ------------------------------------------------------------------ groups & placeholders

export const G = (name, ...kids) => ({ id: uid('n'), type: 'group', name, hidden: false, locked: false, style: { opacity: 1, blend: 'normal' }, children: kids.flat(Infinity).filter(Boolean) });

/** Grey photo frame with an image icon — the user deletes it and places a photo. */
export function PH(x, y, w, h, o = {}) {
  const c = o.c || '#d5d5d2', ic = o.ic || '#a3a39f';
  const s = Math.min(w, h) * (o.icon || 0.12), cx = x + w / 2 + (o.dx || 0), cy = y + h / 2 + (o.dy || 0);
  const frame = o.circle ? E(x + w / 2, y + h / 2, w / 2, h / 2, { fill: c, name: 'Photo area' })
    : o.arch ? ARCH(x, y, w, h, { fill: c, name: 'Photo area' })
      : R(x, y, w, h, { fill: c, r: o.r || 0, name: 'Photo area' });
  return G(o.name || 'Photo placeholder', frame,
    G('Image icon',
      POLY([[cx - s, cy + s * 0.65], [cx - s * 0.3, cy - s * 0.25], [cx + s * 0.12, cy + s * 0.3], [cx + s * 0.45, cy], [cx + s, cy + s * 0.65]], { fill: ic, name: 'Mountains' }),
      E(cx + s * 0.5, cy - s * 0.55, s * 0.22, s * 0.22, { fill: ic, name: 'Sun' })));
}

/** Logo placeholder: a simple mark + wordmark, grouped as "Logo". */
export function LOGO(x, y, o = {}) {
  const c = o.c || '#111111', s = o.s || 30, word = o.text || 'YOUR BRAND', f = o.f || MS;
  const m = s * 1.25;
  const mark = o.mark === 'none' ? null
    : o.mark === 'square' ? G('Mark', R(x, y - m * 0.82, m, m, { fill: c, r: m * 0.22 }), E(x + m / 2, y - m * 0.32, m * 0.22, m * 0.22, { fill: o.bg || '#ffffff' }))
      : G('Mark', E(x + m / 2, y - m * 0.32, m / 2, m / 2, { fill: null, stroke: c, sw: m * 0.14 }), E(x + m / 2, y - m * 0.32, m * 0.14, m * 0.14, { fill: c }));
  return G('Logo', mark, T(word, x + (mark ? m + s * 0.45 : 0), y, { f, s, w: o.w || 800, tr: o.tr ?? 120, c, name: 'Brand name' }));
}

/** Scattered confetti (rects, dots, triangles) inside a box. */
export function confetti(seed, n, [x0, y0, x1, y1], colors, size = 18, avoid = null) {
  const r = rng(seed), out = [];
  for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
    const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0), c = colors[i % colors.length], s = size * (0.6 + r() * 0.8), k = r();
    if (avoid && avoid.some(([a, b, cc, d]) => x > a && x < cc && y > b && y < d)) continue;
    i++;
    if (k < 0.45) out.push(R(x, y, s * 0.5, s * 1.3, { fill: c, r: s * 0.12, rot: r() * 180 }));
    else if (k < 0.75) out.push(E(x, y, s * 0.4, s * 0.4, { fill: c }));
    else out.push(NGON(x, y, s * 0.55, 3, { fill: c, rot: r() * 120 }));
  }
  return G('Confetti', out);
}

export function doc(name, w, h, bg, items) {
  const d = createDoc({ name, width: w, height: h, bg });
  d.items = items.flat(Infinity).filter(Boolean);
  return d;
}
/** Full-bleed background shape (locked so it doesn't get in the way). */
export const BG = (w, h, fill, name = 'Background') => R(0, 0, w, h, { fill, lock: true, name });
