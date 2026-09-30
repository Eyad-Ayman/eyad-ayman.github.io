// EYAD VECTOR — document model, geometry, SVG rendering and validation.
//
// Paths store absolute anchor + handle positions: { x, y, hi: [x, y]|null, ho: [x, y]|null, smooth }.
// Text and images carry a 2D matrix `tf` (a, b, c, d, e, f) applied to content drawn at the origin.
// Groups own children; their transforms are baked into the children.
import { uid } from '../core/dom.js';
import { num, str, bool, oneOf, color } from '../core/eyad.js';

export const FONTS = [
  ['Studio Inter', 'Inter'], ['Studio Oswald', 'Oswald'], ['Studio Mono', 'Mono'],
  ['Arial', 'Arial'], ['Helvetica', 'Helvetica'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'],
  ['Courier New', 'Courier New'], ['Verdana', 'Verdana'], ['Trebuchet MS', 'Trebuchet MS'], ['Impact', 'Impact'],
];
export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
export const PATTERNS = ['dots', 'lines', 'grid', 'checker', 'diagonal', 'waves'];
export const I = [1, 0, 0, 1, 0, 0];

// ------------------------------------------------------------------ creation

export function createDoc({ name = 'Untitled vector', width = 1080, height = 1080, bg = '#ffffff' } = {}) {
  return { id: uid('d'), name, created: Date.now(), artboards: [{ id: uid('ab'), name: 'Artboard 1', x: 0, y: 0, w: width, h: height, bg }], items: [], meta: { source: 'new' } };
}
export function defaultStyle(o = {}) {
  return { fill: { kind: 'solid', color: '#d02b2a', a: 1 }, stroke: null, sw: 2, cap: 'round', join: 'round', dash: '', opacity: 1, blend: 'normal', ...o };
}
export function makePath(subpaths, style = defaultStyle(), name = 'Path') {
  return { id: uid('n'), type: 'path', name, hidden: false, locked: false, subpaths, fillRule: 'nonzero', style };
}
export const pt = (x, y, hi = null, ho = null) => ({ x, y, hi, ho, smooth: !!(hi || ho) });

const K = 0.5522847498;
export function rectPath(x, y, w, h, r = 0) {
  if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return [{ closed: true, pts: [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)] }];
  const k = r * K;
  return [{ closed: true, pts: [
    { x: x + r, y, hi: [x + r - k, y], ho: null }, { x: x + w - r, y, hi: null, ho: [x + w - r + k, y] },
    { x: x + w, y: y + r, hi: [x + w, y + r - k], ho: null }, { x: x + w, y: y + h - r, hi: null, ho: [x + w, y + h - r + k] },
    { x: x + w - r, y: y + h, hi: [x + w - r + k, y + h], ho: null }, { x: x + r, y: y + h, hi: null, ho: [x + r - k, y + h] },
    { x, y: y + h - r, hi: [x, y + h - r + k], ho: null }, { x, y: y + r, hi: null, ho: [x, y + r - k] },
  ].map((p) => ({ ...p, smooth: false })) }];
}
export function ellipsePath(cx, cy, rx, ry) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  const kx = rx * K, ky = ry * K;
  return [{ closed: true, pts: [
    { x: cx, y: cy - ry, hi: [cx - kx, cy - ry], ho: [cx + kx, cy - ry], smooth: true },
    { x: cx + rx, y: cy, hi: [cx + rx, cy - ky], ho: [cx + rx, cy + ky], smooth: true },
    { x: cx, y: cy + ry, hi: [cx + kx, cy + ry], ho: [cx - kx, cy + ry], smooth: true },
    { x: cx - rx, y: cy, hi: [cx - rx, cy + ky], ho: [cx - rx, cy - ky], smooth: true },
  ] }];
}
export function polygonPath(cx, cy, r, sides, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < sides; i++) { const a = rot + i / sides * Math.PI * 2; pts.push(pt(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); }
  return [{ closed: true, pts }];
}
export function starPath(cx, cy, r, points, inner = 0.45, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) { const a = rot + i / (points * 2) * Math.PI * 2, rr = i % 2 ? r * inner : r; pts.push(pt(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)); }
  return [{ closed: true, pts }];
}
export function arcPath(x0, y0, x1, y1) {
  // quarter-ellipse arc from (x0,y0) to (x1,y1), bulging outward
  const k = K;
  return [{ closed: false, pts: [{ x: x0, y: y0, hi: null, ho: [x0 + (x1 - x0) * k, y0], smooth: false }, { x: x1, y: y1, hi: [x1, y1 - (y1 - y0) * k], ho: null, smooth: false }] }];
}

// ------------------------------------------------------------------ matrices

export const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function invert(m) { const d = m[0] * m[3] - m[1] * m[2] || 1e-9; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; }
export const translate = (x, y) => [1, 0, 0, 1, x, y];
export const scaleAbout = (sx, sy, ox, oy) => [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy];
export function rotateAbout(rad, ox, oy) { const c = Math.cos(rad), s = Math.sin(rad); return [c, s, -s, c, ox - c * ox + s * oy, oy - s * ox - c * oy]; }

/** Bake a matrix into a node (paths: points; text/image: tf; groups: children). */
export function transformNode(n, m) {
  if (n.type === 'path') {
    for (const sp of n.subpaths) for (const p of sp.pts) {
      [p.x, p.y] = apply(m, p.x, p.y);
      if (p.hi) p.hi = apply(m, p.hi[0], p.hi[1]);
      if (p.ho) p.ho = apply(m, p.ho[0], p.ho[1]);
    }
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    if (n.style && n.style.stroke && n.keepStroke !== true) n.style.sw = n.style.sw * (s || 1);
  } else if (n.type === 'group') n.children.forEach((c) => transformNode(c, m));
  else n.tf = mul(m, n.tf || I);
}

// ------------------------------------------------------------------ geometry

function cubicExtrema(p0, p1, p2, p3) {
  const out = [0, 1];
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) out.push(-c / b); }
  else { const d = b * b - 4 * a * c; if (d >= 0) { const s = Math.sqrt(d); out.push((-b + s) / (2 * a), (-b - s) / (2 * a)); } }
  return out.filter((t) => t >= 0 && t <= 1);
}
const cub = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };

export function segments(sp) {
  const out = [], n = sp.pts.length;
  for (let i = 0; i < n - 1 + (sp.closed ? 1 : 0); i++) {
    const a = sp.pts[i], b = sp.pts[(i + 1) % n];
    out.push([a.x, a.y, a.ho ? a.ho[0] : a.x, a.ho ? a.ho[1] : a.y, b.hi ? b.hi[0] : b.x, b.hi ? b.hi[1] : b.y, b.x, b.y, i]);
  }
  return out;
}

let measureCtx = null;
export function fontString(n, size = n.size) { return `${n.italic ? 'italic ' : ''}${n.weight || 400} ${size}px '${n.font}', sans-serif`; }
export function measure(n, text) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = fontString(n);
  const w = measureCtx.measureText(text).width;
  return w + Math.max(0, text.length - 1) * (n.tracking || 0) / 1000 * n.size;
}
/** Text lines after wrapping (area text wraps at n.width). */
export function textLines(n) {
  const paras = String(n.text || '').split('\n');
  if (!(n.width > 0)) return paras;
  const lines = [];
  for (const p of paras) {
    const words = p.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const t = cur + w;
      if (cur && measure(n, t.trimEnd()) > n.width) { lines.push(cur.trimEnd()); cur = w.trimStart(); }
      else cur = t;
    }
    lines.push(cur);
  }
  return lines;
}
export function textBox(n) {
  const lines = textLines(n), lh = n.size * (n.leading || 1.2);
  const w = n.width > 0 ? n.width : Math.max(1, ...lines.map((l) => measure(n, l)));
  let x0 = 0;
  if (!(n.width > 0)) { if (n.align === 'center') x0 = -w / 2; else if (n.align === 'right') x0 = -w; }
  return { x: x0, y: -n.size * 0.82, w, h: lh * (lines.length - 1) + n.size * 1.05, lines, lh };
}

/** Axis-aligned bounds in document space: { x, y, w, h } (null when empty). */
export function bounds(n) {
  if (n.type === 'group') return unionBounds(n.children.filter((c) => !c.hidden).map(bounds));
  if (n.type === 'path') {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sp of n.subpaths) {
      if (sp.pts.length === 1) { const p = sp.pts[0]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      for (const s of segments(sp)) {
        for (const t of cubicExtrema(s[0], s[2], s[4], s[6])) { const v = cub(s[0], s[2], s[4], s[6], t); x0 = Math.min(x0, v); x1 = Math.max(x1, v); }
        for (const t of cubicExtrema(s[1], s[3], s[5], s[7])) { const v = cub(s[1], s[3], s[5], s[7], t); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
      }
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const b = n.type === 'text' ? textBox(n) : { x: 0, y: 0, w: n.w, h: n.h };
  const cs = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => apply(n.tf || I, x, y));
  const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
export function unionBounds(list) {
  const bs = list.filter(Boolean);
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 };
}

/** Split cubic at t → [left, right] (each 8 numbers). */
export function splitCubic(s, t) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = s, L = (a, b) => a + (b - a) * t;
  const ax = L(x0, x1), ay = L(y0, y1), bx = L(x1, x2), by = L(y1, y2), cx = L(x2, x3), cy = L(y2, y3);
  const dx = L(ax, bx), dy = L(ay, by), ex = L(bx, cx), ey = L(by, cy), fx = L(dx, ex), fy = L(dy, ey);
  return [[x0, y0, ax, ay, dx, dy, fx, fy], [fx, fy, ex, ey, cx, cy, x3, y3]];
}
/** Closest point on a path: { sub, seg, t, x, y, d }. */
export function nearestOnPath(n, x, y) {
  let best = null;
  n.subpaths.forEach((sp, si) => {
    for (const s of segments(sp)) {
      for (let k = 0; k <= 40; k++) {
        const t = k / 40, px = cub(s[0], s[2], s[4], s[6], t), py = cub(s[1], s[3], s[5], s[7], t), d = Math.hypot(px - x, py - y);
        if (!best || d < best.d) best = { sub: si, seg: s[8], t, x: px, y: py, d };
      }
    }
  });
  return best;
}

// ------------------------------------------------------------------ SVG output

export function pathD(n, m = null) {
  const P = (x, y) => { const q = m ? apply(m, x, y) : [x, y]; return r(q[0]) + ' ' + r(q[1]); };
  let d = '';
  for (const sp of n.subpaths) {
    if (!sp.pts.length) continue;
    d += 'M' + P(sp.pts[0].x, sp.pts[0].y);
    for (const s of segments(sp)) {
      const isLine = s[2] === s[0] && s[3] === s[1] && s[4] === s[6] && s[5] === s[7];
      d += isLine ? 'L' + P(s[6], s[7]) : 'C' + P(s[2], s[3]) + ' ' + P(s[4], s[5]) + ' ' + P(s[6], s[7]);
    }
    if (sp.closed) d += 'Z';
  }
  return d;
}
const r = (v) => String(Math.round(v * 100) / 100);
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function paintDef(p, id) {
  if (!p || p.kind === 'solid') return '';
  if (p.kind === 'pattern') {
    const s = Math.max(2, p.scale || 12), fg = esc(p.color || '#000000'), bg = p.bg ? `<rect width="${s}" height="${s}" fill="${esc(p.bg)}"/>` : '';
    const body = {
      dots: `<circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.22}" fill="${fg}"/>`,
      lines: `<rect width="${s}" height="${s * 0.3}" fill="${fg}"/>`,
      grid: `<path d="M0 0H${s}V${s}" fill="none" stroke="${fg}" stroke-width="${s * 0.1}"/>`,
      checker: `<rect width="${s / 2}" height="${s / 2}" fill="${fg}"/><rect x="${s / 2}" y="${s / 2}" width="${s / 2}" height="${s / 2}" fill="${fg}"/>`,
      diagonal: `<path d="M0 ${s}L${s} 0M${-s / 2} ${s / 2}L${s / 2} ${-s / 2}M${s / 2} ${s * 1.5}L${s * 1.5} ${s / 2}" stroke="${fg}" stroke-width="${s * 0.15}"/>`,
      waves: `<path d="M0 ${s / 2}Q${s / 4} ${s * 0.2} ${s / 2} ${s / 2}T${s} ${s / 2}" fill="none" stroke="${fg}" stroke-width="${s * 0.1}"/>`,
    }[p.name] || '';
    return `<pattern id="${id}" width="${s}" height="${s}" patternUnits="userSpaceOnUse">${bg}${body}</pattern>`;
  }
  const stops = (p.stops || []).map((s) => `<stop offset="${r(s.o)}" stop-color="${esc(s.color)}" stop-opacity="${r(s.a ?? 1)}"/>`).join('');
  if (p.kind === 'radial') return `<radialGradient id="${id}" cx="${r(p.x1 ?? 0.5)}" cy="${r(p.y1 ?? 0.5)}" r="${r(Math.hypot((p.x2 ?? 1) - (p.x1 ?? 0.5), (p.y2 ?? 0.5) - (p.y1 ?? 0.5)) || 0.5)}">${stops}</radialGradient>`;
  return `<linearGradient id="${id}" x1="${r(p.x1 ?? 0)}" y1="${r(p.y1 ?? 0)}" x2="${r(p.x2 ?? 1)}" y2="${r(p.y2 ?? 0)}">${stops}</linearGradient>`;
}
function paintAttr(p, id) {
  if (!p) return 'none';
  if (p.kind === 'solid') return esc(p.color);
  return `url(#${id})`;
}
function styleAttrs(n, defs) {
  const s = n.style || {};
  const fid = 'pf-' + n.id, sid = 'ps-' + n.id;
  const fd = paintDef(s.fill, fid), sd = paintDef(s.stroke, sid);
  if (fd) defs.push(fd); if (sd) defs.push(sd);
  let a = ` fill="${paintAttr(s.fill, fid)}"`;
  if (s.fill && s.fill.kind === 'solid' && (s.fill.a ?? 1) < 1) a += ` fill-opacity="${r(s.fill.a)}"`;
  if (s.stroke) {
    a += ` stroke="${paintAttr(s.stroke, sid)}" stroke-width="${r(s.sw)}" stroke-linecap="${s.cap || 'butt'}" stroke-linejoin="${s.join || 'miter'}"`;
    if (s.stroke.kind === 'solid' && (s.stroke.a ?? 1) < 1) a += ` stroke-opacity="${r(s.stroke.a)}"`;
    if (s.dash) a += ` stroke-dasharray="${esc(s.dash)}"`;
  }
  if ((s.opacity ?? 1) < 1) a += ` opacity="${r(s.opacity)}"`;
  if (s.blend && s.blend !== 'normal') a += ` style="mix-blend-mode:${s.blend}"`;
  return a;
}
const mtx = (m) => `matrix(${m.map(r).join(' ')})`;

/** SVG markup for a list of nodes. `opts.ids` adds data-id attributes for hit testing. */
export function renderNodes(items, defs, opts = {}) {
  let out = '';
  for (const n of items) {
    if (n.hidden) continue;
    const idA = opts.ids ? ` data-id="${n.id}"${n.locked ? ' pointer-events="none"' : ''}` : '';
    if (n.type === 'group') {
      const s = n.style || {};
      out += `<g${idA}${(s.opacity ?? 1) < 1 ? ` opacity="${r(s.opacity)}"` : ''}${s.blend && s.blend !== 'normal' ? ` style="mix-blend-mode:${s.blend}"` : ''}>${renderNodes(n.children, defs, opts)}</g>`;
    } else if (n.type === 'path') {
      out += `<path${idA} d="${pathD(n)}"${n.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${styleAttrs(n, defs)}/>`;
    } else if (n.type === 'text') {
      const b = textBox(n);
      const anchor = n.width > 0 ? 'start' : n.align === 'center' ? 'middle' : n.align === 'right' ? 'end' : 'start';
      const ls = n.tracking ? ` letter-spacing="${r(n.tracking / 1000 * n.size)}"` : '';
      const tsp = b.lines.map((l, i) => {
        let x = 0;
        if (n.width > 0) { if (n.align === 'center') x = n.width / 2; else if (n.align === 'right') x = n.width; }
        return `<tspan x="${r(x)}" y="${r(i * b.lh)}">${esc(l) || ' '}</tspan>`;
      }).join('');
      const anch = n.width > 0 && n.align !== 'left' ? ` text-anchor="${n.align === 'center' ? 'middle' : 'end'}"` : anchor !== 'start' ? ` text-anchor="${anchor}"` : '';
      out += `<text${idA} transform="${mtx(n.tf || I)}" font-family="${esc(n.font)}, sans-serif" font-size="${r(n.size)}" font-weight="${n.weight || 400}"${n.italic ? ' font-style="italic"' : ''}${ls}${anch} xml:space="preserve"${styleAttrs(n, defs)}>${tsp}</text>`;
      if (opts.ids) out += `<rect data-id="${n.id}" transform="${mtx(n.tf || I)}" x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" fill="transparent"${n.locked ? ' pointer-events="none"' : ''}/>`;
    } else if (n.type === 'image') {
      const s = n.style || {};
      out += `<image${idA} href="${esc(n.src)}" width="${r(n.w)}" height="${r(n.h)}" transform="${mtx(n.tf || I)}" preserveAspectRatio="none"${(s.opacity ?? 1) < 1 ? ` opacity="${r(s.opacity)}"` : ''}${s.blend && s.blend !== 'normal' ? ` style="mix-blend-mode:${s.blend}"` : ''}/>`;
    }
  }
  return out;
}

/** Standalone SVG for an artboard (or the given bounds). */
export function exportSVG(doc, ab, { fonts = '' } = {}) {
  const defs = [];
  const body = renderNodes(doc.items, defs);
  const bg = ab.bg ? `<rect x="${r(ab.x)}" y="${r(ab.y)}" width="${r(ab.w)}" height="${r(ab.h)}" fill="${esc(ab.bg)}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${r(ab.w)}" height="${r(ab.h)}" viewBox="${r(ab.x)} ${r(ab.y)} ${r(ab.w)} ${r(ab.h)}">\n<title>${esc(doc.name)} — ${esc(ab.name)}</title>\n<!-- Made with EYAD VECTOR -->\n${fonts ? `<style>${fonts}</style>` : ''}<defs>${defs.join('')}</defs>\n${bg}${body}\n</svg>\n`;
}

// ------------------------------------------------------------------ tree helpers

export function walk(items, fn, parent = null) { for (const n of items) { fn(n, parent); if (n.type === 'group') walk(n.children, fn, n); } }
export function find(doc, id) {
  let out = null;
  const rec = (items, parent) => { for (let i = 0; i < items.length && !out; i++) { const n = items[i]; if (n.id === id) out = { node: n, list: items, index: i, parent }; else if (n.type === 'group') rec(n.children, n); } };
  rec(doc.items, null);
  return out;
}
export function topLevelOf(doc, id) {
  for (const n of doc.items) { if (n.id === id) return n; let hit = false; if (n.type === 'group') walk(n.children, (c) => { if (c.id === id) hit = true; }); if (hit) return n; }
  return null;
}
export function cloneNode(n) {
  const c = JSON.parse(JSON.stringify(n));
  const re = (x) => { x.id = uid('n'); if (x.type === 'group') x.children.forEach(re); };
  re(c);
  return c;
}

// ------------------------------------------------------------------ validation (untrusted .eyad / JSON)

const paint = (p) => {
  if (!p || typeof p !== 'object') return null;
  if (p.kind === 'solid') return { kind: 'solid', color: color(p.color, '#000000'), a: num(p.a, 1, 0, 1) };
  if (p.kind === 'linear' || p.kind === 'radial') return { kind: p.kind, x1: num(p.x1, 0, -10, 10), y1: num(p.y1, 0, -10, 10), x2: num(p.x2, 1, -10, 10), y2: num(p.y2, 0, -10, 10), stops: (Array.isArray(p.stops) ? p.stops : []).slice(0, 32).map((s) => ({ o: num(s.o, 0, 0, 1), color: color(s.color, '#000000'), a: num(s.a, 1, 0, 1) })) };
  if (p.kind === 'pattern') return { kind: 'pattern', name: oneOf(p.name, PATTERNS, 'dots'), color: color(p.color, '#000000'), bg: p.bg ? color(p.bg, '#ffffff') : null, scale: num(p.scale, 12, 2, 400) };
  return null;
};
const cleanStyle = (s = {}) => ({ fill: paint(s.fill), stroke: paint(s.stroke), sw: num(s.sw, 1, 0, 1000), cap: oneOf(s.cap, ['butt', 'round', 'square'], 'round'), join: oneOf(s.join, ['miter', 'round', 'bevel'], 'round'), dash: /^[\d.\s,]*$/.test(String(s.dash || '')) ? String(s.dash || '').slice(0, 60) : '', opacity: num(s.opacity, 1, 0, 1), blend: oneOf(s.blend, BLENDS, 'normal') });
const cleanMat = (m) => (Array.isArray(m) && m.length === 6 ? m.map((v, i) => num(v, I[i], -1e6, 1e6)) : [...I]);
const cleanPt = (p) => ({ x: num(p.x), y: num(p.y), hi: Array.isArray(p.hi) ? [num(p.hi[0]), num(p.hi[1])] : null, ho: Array.isArray(p.ho) ? [num(p.ho[0]), num(p.ho[1])] : null, smooth: bool(p.smooth) });
let budget = 0;
function cleanNode(n, depth = 0) {
  if (!n || typeof n !== 'object' || ++budget > 200000 || depth > 40) return null;
  const base = { id: uid('n'), name: str(n.name, 'Item', 120), hidden: bool(n.hidden), locked: bool(n.locked) };
  if (n.type === 'group') return { ...base, type: 'group', style: { opacity: num(n.style?.opacity, 1, 0, 1), blend: oneOf(n.style?.blend, BLENDS, 'normal') }, children: (Array.isArray(n.children) ? n.children : []).map((c) => cleanNode(c, depth + 1)).filter(Boolean) };
  if (n.type === 'path') return { ...base, type: 'path', fillRule: oneOf(n.fillRule, ['nonzero', 'evenodd'], 'nonzero'), style: cleanStyle(n.style), subpaths: (Array.isArray(n.subpaths) ? n.subpaths : []).slice(0, 5000).map((sp) => ({ closed: bool(sp.closed), pts: (Array.isArray(sp.pts) ? sp.pts : []).slice(0, 100000).map(cleanPt) })).filter((sp) => sp.pts.length) };
  if (n.type === 'text') return { ...base, type: 'text', text: str(n.text, '', 20000), font: FONTS.some(([f]) => f === n.font) ? n.font : 'Studio Inter', size: num(n.size, 48, 1, 2000), weight: num(n.weight, 400, 100, 900), italic: bool(n.italic), tracking: num(n.tracking, 0, -500, 2000), leading: num(n.leading, 1.2, 0.5, 5), align: oneOf(n.align, ['left', 'center', 'right'], 'left'), width: num(n.width, 0, 0, 1e5), tf: cleanMat(n.tf), style: cleanStyle(n.style) };
  if (n.type === 'image') {
    const src = typeof n.src === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(n.src) ? n.src : null;
    if (!src) return null;
    return { ...base, type: 'image', src, w: num(n.w, 1, 0, 1e5), h: num(n.h, 1, 0, 1e5), tf: cleanMat(n.tf), style: { opacity: num(n.style?.opacity, 1, 0, 1), blend: oneOf(n.style?.blend, BLENDS, 'normal') } };
  }
  return null;
}
export function validateDoc(d) {
  budget = 0;
  if (!d || typeof d !== 'object') throw new Error('Not a vector document.');
  const doc = createDoc({ name: str(d.name, 'Untitled vector', 120) });
  doc.id = typeof d.id === 'string' ? d.id.slice(0, 40) : doc.id;
  doc.created = num(d.created, Date.now());
  const abs = (Array.isArray(d.artboards) ? d.artboards : []).slice(0, 100).map((a, i) => ({ id: uid('ab'), name: str(a.name, 'Artboard ' + (i + 1), 80), x: num(a.x), y: num(a.y), w: num(a.w, 1080, 1, 20000), h: num(a.h, 1080, 1, 20000), bg: a.bg ? color(a.bg, '#ffffff') : null }));
  if (abs.length) doc.artboards = abs;
  doc.items = (Array.isArray(d.items) ? d.items : []).map((n) => cleanNode(n)).filter(Boolean);
  doc.meta = { source: oneOf(d.meta?.source, ['new', 'svg', 'eyad', 'image'], 'eyad') };
  return doc;
}
