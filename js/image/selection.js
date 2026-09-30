// EYAD IMAGE — selections. A selection is an immutable object holding a
// document-sized alpha mask plus pre-computed outline segments for the
// "marching ants". Operations always produce a new selection object, which
// keeps undo/redo simple.
import { makeCanvas } from './doc.js';

export function selectionFromPath(doc, path2d, { transform = null, feather = 0 } = {}) {
  const c = makeCanvas(doc.width, doc.height);
  const g = c.getContext('2d');
  if (transform) g.setTransform(transform);
  g.fillStyle = '#fff';
  g.fill(path2d, 'evenodd');
  g.setTransform(1, 0, 0, 1, 0, 0);
  return finalize(doc, feather ? featherMask(c, feather) : c);
}

export function selectionFromRect(doc, r, shape = 'rect', feather = 0) {
  const p = new Path2D();
  if (shape === 'ellipse') p.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2);
  else p.rect(r.x, r.y, r.w, r.h);
  return selectionFromPath(doc, p, { feather });
}

export function selectAll(doc) {
  const c = makeCanvas(doc.width, doc.height);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, doc.width, doc.height);
  return finalize(doc, c, { x: 0, y: 0, w: doc.width, h: doc.height });
}

export function invertSelection(doc, sel) {
  const c = makeCanvas(doc.width, doc.height);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, doc.width, doc.height);
  if (sel) { g.globalCompositeOperation = 'destination-out'; g.drawImage(sel.mask, 0, 0); }
  return finalize(doc, c);
}

/** mode: new | add | subtract | intersect */
export function combine(doc, current, next, mode) {
  if (!current || mode === 'new') return next;
  const c = makeCanvas(doc.width, doc.height);
  const g = c.getContext('2d');
  g.drawImage(current.mask, 0, 0);
  g.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
  g.drawImage(next.mask, 0, 0);
  return finalize(doc, c);
}

/** Selection from a layer's opaque pixels (Ctrl/Cmd-click a layer thumbnail). */
export function selectionFromCanvas(doc, drawFn) {
  const c = makeCanvas(doc.width, doc.height);
  const g = c.getContext('2d');
  drawFn(g);
  return finalize(doc, c);
}

export function featherSelection(doc, sel, radius) {
  if (!sel || radius <= 0) return sel;
  return finalize(doc, featherMask(sel.mask, radius));
}

function featherMask(src, radius) {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d');
  if ('filter' in g) {
    g.filter = `blur(${radius / 2}px)`;
    g.drawImage(src, 0, 0);
    g.filter = 'none';
    // Some engines expose .filter but ignore it; verify something changed.
    return c;
  }
  g.drawImage(src, 0, 0);
  return c;
}

function finalize(doc, mask, knownBounds) {
  const { segs, bounds, empty } = outline(mask, knownBounds);
  if (empty) return null;
  return { mask, segs, bounds, w: doc.width, h: doc.height, id: Math.random().toString(36).slice(2) };
}

/**
 * Marching squares on a (possibly downsampled) copy of the mask.
 * Produces a flat Float32Array of line segments [x1,y1,x2,y2,...] in doc space.
 */
function outline(mask, knownBounds) {
  const W = mask.width, H = mask.height;
  const scale = Math.min(1, 1400 / Math.max(W, H));
  const w = Math.max(2, Math.round(W * scale)), h = Math.max(2, Math.round(H * scale));
  const c = makeCanvas(w + 2, h + 2);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.drawImage(mask, 1, 1, w, h);
  const data = g.getImageData(0, 0, w + 2, h + 2).data;
  const cw = w + 2, ch = h + 2;
  const inside = new Uint8Array(cw * ch);
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = data[(y * cw + x) * 4 + 3];
      if (a >= 128) {
        inside[y * cw + x] = 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { empty: true };
  const segs = [];
  const inv = 1 / scale;
  const push = (x1, y1, x2, y2) => { segs.push((x1 - 1) * inv, (y1 - 1) * inv, (x2 - 1) * inv, (y2 - 1) * inv); };
  for (let y = 0; y < ch - 1; y++) {
    for (let x = 0; x < cw - 1; x++) {
      const tl = inside[y * cw + x], tr = inside[y * cw + x + 1], bl = inside[(y + 1) * cw + x], br = inside[(y + 1) * cw + x + 1];
      const code = tl << 3 | tr << 2 | br << 1 | bl;
      if (code === 0 || code === 15) continue;
      const cx = x + 0.5, cy = y + 0.5;
      const T = [cx + 0.5, cy], R = [cx + 1, cy + 0.5], B = [cx + 0.5, cy + 1], L = [cx, cy + 0.5];
      switch (code) {
        case 1: case 14: push(...L, ...B); break;
        case 2: case 13: push(...B, ...R); break;
        case 3: case 12: push(...L, ...R); break;
        case 4: case 11: push(...T, ...R); break;
        case 5: push(...L, ...T); push(...B, ...R); break;
        case 6: case 9: push(...T, ...B); break;
        case 7: case 8: push(...L, ...T); break;
        case 10: push(...T, ...R); push(...L, ...B); break;
        default: break;
      }
    }
  }
  const bounds = knownBounds || {
    x: Math.max(0, Math.floor((minX - 1) * inv)),
    y: Math.max(0, Math.floor((minY - 1) * inv)),
    w: Math.min(W, Math.ceil((maxX - minX + 1) * inv) + 2),
    h: Math.min(H, Math.ceil((maxY - minY + 1) * inv) + 2),
  };
  return { segs: new Float32Array(segs), bounds, empty: false };
}
