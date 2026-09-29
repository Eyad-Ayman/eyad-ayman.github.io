// EYAD VECTOR — geometry engine bridge. Paper.js (MIT, vendored) provides the
// robust boolean operations (Pathfinder), curve fitting for the Pencil and
// Brush, and SVG parsing. It only computes geometry — rendering is ours.
import { uid } from '../core/dom.js';
import { makePath, defaultStyle, walk, apply, I, FONTS } from './model.js';

const SRC = new URL('../../vendor/paper/paper-core.min.js', import.meta.url).href;
let P = null, loading = null;

export function paperReady() {
  if (P) return Promise.resolve(P);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC; s.async = true;
      s.onload = () => {
        const pp = window.paper; if (!pp) { reject(new Error('Geometry engine failed to load.')); return; }
        const c = document.createElement('canvas'); c.width = 1; c.height = 1;
        pp.setup(c);
        pp.settings.insertItems = false;
        P = pp; resolve(pp);
      };
      s.onerror = () => { loading = null; reject(new Error('Geometry engine failed to load.')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// ------------------------------------------------------------------ conversion

function spToPaper(sp) {
  const segs = sp.pts.map((p) => new P.Segment(new P.Point(p.x, p.y), p.hi ? new P.Point(p.hi[0] - p.x, p.hi[1] - p.y) : null, p.ho ? new P.Point(p.ho[0] - p.x, p.ho[1] - p.y) : null));
  return new P.Path({ segments: segs, closed: sp.closed, insert: false });
}
export function toPaper(n) {
  if (n.type === 'path') {
    if (n.subpaths.length === 1) { const p = spToPaper(n.subpaths[0]); p.fillRule = n.fillRule; return p; }
    return new P.CompoundPath({ children: n.subpaths.map(spToPaper), fillRule: n.fillRule, insert: false });
  }
  if (n.type === 'group') {
    const parts = n.children.map(toPaper).filter(Boolean);
    if (!parts.length) return null;
    return parts.reduce((a, b) => a.unite(b, { insert: false }));
  }
  return null;
}
function pathToSp(path) {
  const pts = path.segments.map((s) => {
    const x = s.point.x, y = s.point.y;
    const hi = s.handleIn && !s.handleIn.isZero() ? [x + s.handleIn.x, y + s.handleIn.y] : null;
    const ho = s.handleOut && !s.handleOut.isZero() ? [x + s.handleOut.x, y + s.handleOut.y] : null;
    return { x, y, hi, ho, smooth: !!(hi && ho && Math.abs(Math.atan2(y - hi[1], x - hi[0]) - Math.atan2(ho[1] - y, ho[0] - x)) < 0.02) };
  });
  return { closed: path.closed, pts };
}
export function fromPaper(item) {
  if (!item) return [];
  if (item.className === 'CompoundPath') return item.children.filter((c) => c.segments.length).map(pathToSp);
  if (item.className === 'Path') return item.segments.length ? [pathToSp(item)] : [];
  return [];
}

// ------------------------------------------------------------------ pathfinder

/** op: unite | subtract (front shapes from the back one) | intersect | exclude | divide. Nodes in stacking order (bottom first). */
export async function pathfinder(nodes, op) {
  await paperReady();
  const shapes = nodes.map(toPaper).filter(Boolean);
  if (shapes.length < 2) throw new Error('Select two or more shapes.');
  const style = JSON.parse(JSON.stringify(nodes[op === 'subtract' ? 0 : nodes.length - 1].style || defaultStyle()));
  const o = { insert: false };
  if (op === 'divide') {
    let pieces = [shapes[0]];
    for (const s of shapes.slice(1)) {
      const next = [];
      for (const p of pieces) { next.push(p.subtract(s, o), p.intersect(s, o)); }
      let rest = s; for (const p of pieces) rest = rest.subtract(p, o);
      next.push(rest);
      pieces = next.filter((x) => x && !x.isEmpty() && Math.abs(x.area) > 0.5);
    }
    return pieces.map((pc, i) => { const n = makePath(fromPaper(pc), JSON.parse(JSON.stringify(style)), 'Piece ' + (i + 1)); n.fillRule = 'evenodd'; return n; });
  }
  let res;
  if (op === 'unite') res = shapes.reduce((a, b) => a.unite(b, o));
  else if (op === 'subtract') res = shapes.slice(1).reduce((a, b) => a.subtract(b, o), shapes[0]);
  else if (op === 'intersect') res = shapes.reduce((a, b) => a.intersect(b, o));
  else res = shapes.reduce((a, b) => a.exclude(b, o));
  const sps = fromPaper(res);
  if (!sps.length) throw new Error('The result is empty (the shapes may not overlap).');
  const n = makePath(sps, style, { unite: 'Union', subtract: 'Minus Front', intersect: 'Intersection', exclude: 'Exclusion' }[op]);
  n.fillRule = 'nonzero';
  return [n];
}

export async function outlineStroke(n) {
  await paperReady();
  // Paper has no stroke expansion; approximate by offsetting the curve both ways.
  const w = (n.style?.sw || 1) / 2;
  const out = [];
  for (const sp of n.subpaths) {
    const path = spToPaper(sp); path.flatten(Math.max(0.25, w / 6));
    const pts = path.segments.map((s) => s.point);
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L * w, ny = dx / L * w;
      left.push([pts[i].x + nx, pts[i].y + ny]); right.push([pts[i].x - nx, pts[i].y - ny]);
    }
    if (sp.closed) { out.push({ closed: true, pts: left.map(([x, y]) => ({ x, y, hi: null, ho: null })) }, { closed: true, pts: right.reverse().map(([x, y]) => ({ x, y, hi: null, ho: null })) }); }
    else out.push({ closed: true, pts: [...left, ...right.reverse()].map(([x, y]) => ({ x, y, hi: null, ho: null })) });
  }
  const p = makePath(out, { ...JSON.parse(JSON.stringify(n.style)), fill: n.style.stroke, stroke: null }, n.name + ' outline');
  p.fillRule = 'nonzero';
  const simp = toPaper(p); simp.simplify?.(0.4);
  const u = simp.className === 'CompoundPath' ? simp.children.reduce((a, b) => a.unite(b, { insert: false })) : simp;
  p.subpaths = fromPaper(u);
  return p;
}

// ------------------------------------------------------------------ drawing helpers

/** Fit smooth Béziers through freehand points. */
export async function fitCurve(points, { tolerance = 2.5, closed = false } = {}) {
  await paperReady();
  const path = new P.Path({ segments: points.map((p) => new P.Point(p.x, p.y)), insert: false });
  if (closed) path.closed = true;
  path.simplify(tolerance);
  return pathToSp(path);
}

/** Variable-width brush stroke (pen pressure) → filled outline path. */
export async function brushOutline(points, size, minK = 0.15) {
  await paperReady();
  if (points.length < 2) {
    const p = points[0]; const r = size / 2 * (p ? minK + (1 - minK) * p.pressure : 1);
    const c = new P.Path.Circle({ center: [p.x, p.y], radius: Math.max(0.5, r), insert: false });
    return fromPaper(c);
  }
  // smooth pressure a little
  const pr = points.map((p, i) => { let s = 0, c = 0; for (let k = -2; k <= 2; k++) { const q = points[i + k]; if (q) { s += q.pressure; c++; } } return s / c; });
  const L = [], R = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 2)], b = points[Math.min(points.length - 1, i + 2)];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const w = size / 2 * (minK + (1 - minK) * pr[i]);
    const nx = -dy / len * w, ny = dx / len * w;
    L.push(new P.Point(points[i].x + nx, points[i].y + ny)); R.push(new P.Point(points[i].x - nx, points[i].y - ny));
  }
  const first = points[0], last = points[points.length - 1];
  const capPts = (cx, cy, from, to, w) => { const out = []; const a0 = Math.atan2(from.y - cy, from.x - cx); for (let k = 1; k < 8; k++) { const a = a0 + Math.PI * k / 8; out.push(new P.Point(cx + Math.cos(a) * w, cy + Math.sin(a) * w)); } void to; return out; };
  const wEnd = size / 2 * (minK + (1 - minK) * pr[pr.length - 1]), wStart = size / 2 * (minK + (1 - minK) * pr[0]);
  const ring = [...L, ...capPts(last.x, last.y, L[L.length - 1], R[R.length - 1], wEnd), ...R.reverse(), ...capPts(first.x, first.y, R[R.length - 1], L[0], wStart)];
  const path = new P.Path({ segments: ring, closed: true, insert: false });
  path.simplify(Math.max(0.6, size / 20));
  return [pathToSp(path)];
}

// ------------------------------------------------------------------ SVG import

function paperColor(c, item) {
  if (!c) return null;
  if (c.type === 'gradient' && c.gradient) {
    const b = item.bounds;
    const o = c.origin, d = c.destination;
    const nx = (p) => (b.width ? (p.x - b.x) / b.width : 0), ny = (p) => (b.height ? (p.y - b.y) / b.height : 0);
    return { kind: c.gradient.radial ? 'radial' : 'linear', x1: nx(o), y1: ny(o), x2: nx(d), y2: ny(d), stops: c.gradient.stops.map((s) => ({ o: s.offset ?? 0, color: s.color.toCSS(true), a: s.color.alpha ?? 1 })) };
  }
  const hex = c.toCSS(true);
  return /^#[0-9a-f]{6}$/i.test(hex) ? { kind: 'solid', color: hex, a: c.alpha ?? 1 } : null;
}
function styleOf(item) {
  return {
    fill: paperColor(item.fillColor, item), stroke: item.strokeColor && item.strokeWidth > 0 ? paperColor(item.strokeColor, item) : null,
    sw: item.strokeWidth || 1, cap: item.strokeCap || 'butt', join: item.strokeJoin || 'miter', dash: (item.dashArray || []).join(' '),
    opacity: item.opacity ?? 1, blend: item.blendMode && item.blendMode !== 'normal' ? item.blendMode : 'normal',
  };
}
function convert(item) {
  if (!item || item.visible === false) return null;
  const cn = item.className;
  if (cn === 'Group' || cn === 'Layer') {
    if (item.clipped) { const kids = item.children.slice(1).map(convert).filter(Boolean); return kids.length ? { id: uid('n'), type: 'group', name: item.name || 'Group', hidden: false, locked: false, style: { opacity: item.opacity ?? 1, blend: 'normal' }, children: kids } : null; }
    const kids = item.children.map(convert).filter(Boolean);
    if (!kids.length) return null;
    return { id: uid('n'), type: 'group', name: item.name || 'Group', hidden: false, locked: false, style: { opacity: item.opacity ?? 1, blend: item.blendMode && item.blendMode !== 'normal' ? item.blendMode : 'normal' }, children: kids };
  }
  if (cn === 'Path' || cn === 'CompoundPath') {
    const sps = fromPaper(item);
    if (!sps.length) return null;
    const n = makePath(sps, styleOf(item), item.name || (cn === 'CompoundPath' ? 'Compound path' : 'Path'));
    n.fillRule = item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
    return n;
  }
  if (cn === 'Shape') return convert(item.toPath(false));
  if (cn === 'PointText') {
    const m = item.matrix;
    const fam = String(item.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
    const font = FONTS.find(([f, l]) => f.toLowerCase() === fam.toLowerCase() || l.toLowerCase() === fam.toLowerCase())?.[0] || 'Arial';
    return { id: uid('n'), type: 'text', name: item.content.slice(0, 24) || 'Text', hidden: false, locked: false, text: item.content, font, size: item.fontSize || 16, weight: Number(item.fontWeight) || (String(item.fontWeight) === 'bold' ? 700 : 400), italic: false, tracking: 0, leading: (item.leading || item.fontSize * 1.2) / (item.fontSize || 16), align: item.justification === 'center' ? 'center' : item.justification === 'right' ? 'right' : 'left', width: 0, tf: [m.a, m.b, m.c, m.d, m.tx, m.ty], style: { ...styleOf(item), stroke: null } };
  }
  if (cn === 'Raster') {
    const src = item.source;
    if (typeof src !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(src)) return null;
    const m = item.matrix, w = item.width, h = item.height;
    return { id: uid('n'), type: 'image', name: 'Image', hidden: false, locked: false, src, w, h, tf: [m.a, m.b, m.c, m.d, m.tx - (m.a * w + m.c * h) / 2, m.ty - (m.b * w + m.d * h) / 2], style: { opacity: item.opacity ?? 1, blend: 'normal' } };
  }
  return null;
}

/** Untrusted SVG text → nodes. Scripts, event handlers, foreign content and external references are removed first. */
export async function importSVG(text) {
  await paperReady();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('This SVG is not valid XML.');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('No <svg> element found.');
  doc.querySelectorAll('script, foreignObject, iframe, object, embed, audio, video, animate, animateTransform, animateMotion, set').forEach((e) => e.remove());
  const all = doc.getElementsByTagName('*');
  for (const el of Array.from(all)) {
    for (const a of Array.from(el.attributes)) {
      const nm = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (nm.startsWith('on')) el.removeAttribute(a.name);
      else if ((nm === 'href' || nm === 'xlink:href') && !(v.startsWith('#') || /^data:image\/(png|jpeg|webp|gif);base64,/.test(v))) el.removeAttribute(a.name);
      else if (/javascript:|url\(\s*['"]?(?!#)/.test(v) && nm !== 'd') el.removeAttribute(a.name);
    }
  }
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const w = parseFloat(svg.getAttribute('width')) || vb[2] || 1080, h = parseFloat(svg.getAttribute('height')) || vb[3] || 1080;
  const clean = new XMLSerializer().serializeToString(svg);
  const item = P.project.importSVG(clean, { expandShapes: true, insert: false, applyMatrix: true });
  const root = convert(item);
  const nodes = !root ? [] : root.type === 'group' && root.style.opacity === 1 ? root.children : [root];
  // Paper applies the root viewBox → width/height mapping itself.
  let count = 0; walk(nodes, () => { count++; });
  return { nodes, width: Math.round(w), height: Math.round(h), count };
}
void apply; void I;
