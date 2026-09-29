// EYAD IMAGE — tools. Every tool here performs a real edit on the document
// and records a reversible history command.
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast } from '../core/ui.js';
import {
  makeCanvas, makeNode, nodeMatrix, localSize, nodeCorners, nodeBounds, hitTest, findNode, isIdentity,
  docToLocal, walk, unionRect, intersectRect, roundRect, effectiveLocked,
} from './doc.js';
import { propCmd, multiPropCmd, pixelCmd, replaceCanvasCmd, compound, treeCmd, selectionCmd, stateCmd } from './history.js';
import { selectionFromRect, selectionFromPath, combine } from './selection.js';
import { drawShape, getScratch, releaseScratch, matrixArgs } from './render.js';
import { getSettings } from '../core/settings.js';
import { EXTRA_TOOLS, EXTRA_DEFAULTS } from './tools2.js';

// ---------------------------------------------------------------- option controls

function optSlider(app, tool, key, label, min, max, step = 1, unit = '') {
  const o = app.opt(tool);
  const out = h('output', { class: 'studio-mono img-opt-val', text: fmt(o[key]) });
  const input = h('input', { class: 'studio-range img-opt-range', type: 'range', min, max, step, value: o[key], 'aria-label': label });
  input.addEventListener('input', () => { o[key] = Number(input.value); out.textContent = fmt(o[key]); app.optionsChanged(tool, key); });
  function fmt(v) { return (step < 1 ? Number(v).toFixed(2) : Math.round(v)) + unit; }
  return h('label', { class: 'img-opt' }, h('span', { class: 'img-opt-label', text: label }), input, out);
}
function optSelect(app, tool, key, label, options) {
  const o = app.opt(tool);
  const sel = h('select', { class: 'studio-input img-opt-select', 'aria-label': label }, options.map(([v, l]) => h('option', { value: v, text: l, selected: o[key] === v })));
  sel.addEventListener('change', () => { o[key] = sel.value; app.optionsChanged(tool, key); });
  return h('label', { class: 'img-opt' }, label ? h('span', { class: 'img-opt-label', text: label }) : null, sel);
}
function optCheck(app, tool, key, label) {
  const o = app.opt(tool);
  const cb = h('input', { type: 'checkbox', checked: !!o[key] });
  cb.addEventListener('change', () => { o[key] = cb.checked; app.optionsChanged(tool, key); });
  return h('label', { class: 'img-opt is-check' }, cb, h('span', { text: label }));
}
function optColor(app, tool, key, label) {
  const o = app.opt(tool);
  const c = h('input', { class: 'studio-color', type: 'color', value: o[key], 'aria-label': label });
  c.addEventListener('input', () => { o[key] = c.value; app.optionsChanged(tool, key); });
  return h('label', { class: 'img-opt' }, h('span', { class: 'img-opt-label', text: label }), c);
}
function optSeg(app, tool, key, items) {
  const o = app.opt(tool);
  const wrap = h('div', { class: 'img-seg', role: 'group' });
  const render = () => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === o[key])));
  for (const [v, ic, label] of items) {
    const b = h('button', { class: 'studio-icon-btn is-small', type: 'button', title: label, 'aria-label': label, dataset: { v } }, icon(ic, 15));
    b.addEventListener('click', () => { o[key] = v; render(); app.optionsChanged(tool, key); });
    wrap.appendChild(b);
  }
  render();
  return wrap;
}
function optButton(label, fn, primary) { return h('button', { class: 'studio-btn is-small' + (primary ? ' is-primary' : ''), type: 'button', text: label, onclick: fn }); }
const sep = () => h('span', { class: 'img-opt-sep' });

export const TOOL_DEFAULTS = {
  ...EXTRA_DEFAULTS,
  move: { autoSelect: true, showTransform: true },
  marquee: { shape: 'rect', mode: 'new', feather: 0 },
  lasso: { mode: 'new', feather: 0 },
  crop: { ratio: 'free' },
  brush: { size: 24, hardness: 0.8, opacity: 1, pressure: true },
  eraser: { size: 40, hardness: 0.9, opacity: 1, pressure: true },
  gradient: { type: 'linear', colors: 'fg-bg', opacity: 1, reverse: false },
  bucket: { tolerance: 32, contiguous: true, sampleAll: false, opacity: 1 },
  clone: { size: 40, hardness: 0.6, opacity: 1, aligned: true, sampleAll: false },
  text: { font: 'Studio Inter', size: 72, weight: 600, align: 'left' },
  shape: { shape: 'rect', fill: '#d02b2a', fillOn: true, stroke: '#111111', strokeOn: false, strokeWidth: 4, radius: 0 },
  pen: { make: 'shape' },
  eyedropper: { sample: 'all' },
  hand: {},
  zoom: {},
};

// ---------------------------------------------------------------- helpers

function modeFromEvent(pt, fallback) {
  if (pt.shift && pt.alt) return 'intersect';
  if (pt.shift) return 'add';
  if (pt.alt) return 'subtract';
  return fallback;
}

function screenDist(view, a, b) { return Math.hypot((a.x - b.x) * view.zoom, (a.y - b.y) * view.zoom); }

/** Selection mask expressed in a layer's local space (same size as its canvas). */
function localSelection(doc, node) {
  if (!doc.selection) return null;
  const { w, h: hh } = localSize(node);
  const c = makeCanvas(w, hh);
  const g = c.getContext('2d');
  g.setTransform(nodeMatrix(node).inverse());
  g.drawImage(doc.selection.mask, 0, 0);
  return c;
}

/** Brush tip stamp cache. */
const stamps = new Map();
function getStamp(r, hardness, color) {
  r = Math.max(0.5, r);
  const key = r.toFixed(1) + '|' + hardness.toFixed(2) + '|' + color;
  let s = stamps.get(key);
  if (s) return s;
  const size = Math.ceil(r * 2) + 2;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const cx = size / 2;
  if (hardness >= 0.99) {
    g.fillStyle = color;
    g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fill();
  } else {
    const grad = g.createRadialGradient(cx, cx, 0, cx, cx, r);
    grad.addColorStop(0, color);
    grad.addColorStop(Math.max(0, Math.min(0.99, hardness)), color);
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  s = { c, half: size / 2 };
  if (stamps.size > 48) stamps.delete(stamps.keys().next().value);
  stamps.set(key, s);
  return s;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); }

/** If a raster layer is untransformed and doesn't cover the document, grow it. */
function maybeExpand(app, node) {
  if (!isIdentity(node)) return null;
  const doc = app.doc;
  const lr = { x: node.x, y: node.y, w: node.canvas.width, h: node.canvas.height };
  const need = unionRect(lr, { x: 0, y: 0, w: doc.width, h: doc.height });
  if (need.x >= lr.x && need.y >= lr.y && need.w <= lr.w && need.h <= lr.h) return null;
  const r = roundRect(need);
  if (r.w * r.h > 120e6) return null;
  const c = makeCanvas(r.w, r.h);
  c.getContext('2d').drawImage(node.canvas, node.x - r.x, node.y - r.y);
  if (node.mask) node.mask = { ...node.mask, x: node.mask.x + (node.x - r.x), y: node.mask.y + (node.y - r.y) };
  return replaceCanvasCmd('Expand layer', node, c, r.x, r.y);
}

// ================================================================= Paint engine (brush, eraser, clone)

class Stroke {
  constructor(app, node, opts, kind) {
    this.app = app; this.node = node; this.opts = opts; this.kind = kind;
    this.expandCmd = maybeExpand(app, node);
    const { w, h: hh } = localSize(node);
    this.buffer = makeCanvas(w, hh);
    this.bctx = this.buffer.getContext('2d');
    this.inv = nodeMatrix(node).inverse();
    const m = nodeMatrix(node);
    this.scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    this.sel = localSelection(app.doc, node);
    this.dirty = null;
    this.last = null;
    this.smoothPt = null;
    this.color = kind === 'eraser' ? '#000000' : app.fg;
    this.dabCanvas = null;
    const self = this;
    app.setLive({
      nodeId: node.id,
      isolate: kind === 'eraser',
      draw(ctx, n) {
        ctx.drawImage(n.canvas, 0, 0);
        const src = self.maskedBuffer();
        ctx.save();
        ctx.globalAlpha *= self.opts.opacity;
        if (kind === 'eraser') ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(src, 0, 0);
        ctx.restore();
        if (src !== self.buffer) releaseScratch(src);
      },
    });
  }

  maskedBuffer() {
    if (!this.sel) return this.buffer;
    const t = getScratch(this.buffer.width, this.buffer.height);
    const g = t.getContext('2d');
    g.drawImage(this.buffer, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(this.sel, 0, 0);
    return t;
  }

  local(pt) { const p = this.inv.transformPoint(new DOMPoint(pt.x, pt.y)); return { x: p.x, y: p.y, pressure: pt.pressure, type: pt.type }; }

  add(ptDoc) {
    let p = this.local(ptDoc);
    const smooth = getSettings().brushSmoothing || 0;
    if (this.smoothPt && smooth > 0) {
      const k = 1 - Math.min(0.9, smooth);
      p = { ...p, x: this.smoothPt.x + (p.x - this.smoothPt.x) * k, y: this.smoothPt.y + (p.y - this.smoothPt.y) * k };
    }
    this.smoothPt = p;
    // Pen pressure → size / opacity / flow (Settings ▸ Pen, stylus & touch)
    const st = getSettings();
    const isPen = this.opts.pressure && p.type === 'pen';
    const mn = Math.max(0, Math.min(1, (st.pressureMin ?? 15) / 100));
    const f = isPen ? mn + (1 - mn) * Math.max(0.02, Math.min(1, p.pressure)) : 1;
    const r = (this.opts.size / 2) * (isPen && st.pressureSize !== false ? f : 1) / this.scale;
    const a = isPen && (st.pressureOpacity || st.pressureFlow) ? f : 1;
    if (!this.last) { this.dab(p.x, p.y, r, a); this.last = { x: p.x, y: p.y, r, a }; return; }
    const dx = p.x - this.last.x, dy = p.y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(0.5, Math.min(r, this.last.r) * 0.22);
    if (dist < spacing) return;
    const steps = Math.floor(dist / spacing);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.dab(this.last.x + dx * t, this.last.y + dy * t, this.last.r + (r - this.last.r) * t, this.last.a + (a - this.last.a) * t);
    }
    this.last = { x: p.x, y: p.y, r, a };
  }

  dab(x, y, r, alpha = 1) {
    const hard = this.opts.hardness;
    this.bctx.globalAlpha = alpha;
    if (this.kind === 'clone') {
      const src = this.app.cloneState;
      const size = Math.ceil(r * 2) + 2;
      if (!this.dabCanvas || this.dabCanvas.width !== size) this.dabCanvas = makeCanvas(size, size);
      const g = this.dabCanvas.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, size, size);
      g.drawImage(src.snapshot, -(x - src.offLx - size / 2) - src.snapX, -(y - src.offLy - size / 2) - src.snapY);
      g.globalCompositeOperation = 'destination-in';
      const st = getStamp(r, hard, '#000000');
      g.drawImage(st.c, size / 2 - st.half, size / 2 - st.half);
      this.bctx.drawImage(this.dabCanvas, x - size / 2, y - size / 2);
    } else {
      const st = getStamp(r, hard, this.color);
      this.bctx.drawImage(st.c, x - st.half, y - st.half);
    }
    this.bctx.globalAlpha = 1;
    const rect = { x: x - r - 2, y: y - r - 2, w: r * 2 + 4, h: r * 2 + 4 };
    this.dirty = this.dirty ? unionRect(this.dirty, rect) : rect;
    // invalidate in doc space
    const m = nodeMatrix(this.node);
    const pts = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]].map(([a, b]) => m.transformPoint(new DOMPoint(a, b)));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    this.app.invalidate({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }

  commit(label) {
    const node = this.node;
    this.app.setLive(null);
    if (!this.dirty) { if (this.expandCmd) this.expandCmd.undo(); this.app.invalidate(); return; }
    const r = intersectRect(roundRect(this.dirty), { x: 0, y: 0, w: node.canvas.width, h: node.canvas.height });
    if (!r) { if (this.expandCmd) this.expandCmd.undo(); this.app.invalidate(); return; }
    const g = node.canvas.getContext('2d');
    const before = g.getImageData(r.x, r.y, r.w, r.h);
    const src = this.maskedBuffer();
    g.save();
    g.globalAlpha = this.opts.opacity;
    g.globalCompositeOperation = this.kind === 'eraser' ? 'destination-out' : 'source-over';
    g.drawImage(src, 0, 0);
    g.restore();
    if (src !== this.buffer) releaseScratch(src);
    const after = g.getImageData(r.x, r.y, r.w, r.h);
    this.app.commit(compound(label, [this.expandCmd, pixelCmd(label, node, r, before, after)]));
  }

  cancel() {
    this.app.setLive(null);
    if (this.expandCmd) this.expandCmd.undo();
    this.app.invalidate();
  }
}

function paintTool(id, label, ic, key, kind) {
  return {
    id, label, icon: ic, key, cursor: 'none', showsCursor: true, wantsCoalesced: true,
    hint: kind === 'clone' ? 'Alt/Option-click (or "Set source") to choose a source, then paint' : kind === 'eraser' ? 'Drag to erase. Pen pressure changes size.' : 'Drag to paint. Pen pressure changes size. [ and ] change size.',
    options(app) {
      const els = [
        optSlider(app, id, 'size', 'Size', 1, 800, 1, 'px'),
        optSlider(app, id, 'hardness', 'Hardness', 0, 1, 0.01),
        optSlider(app, id, 'opacity', 'Opacity', 0.01, 1, 0.01),
        optCheck(app, id, 'pressure', 'Pressure'),
      ];
      if (kind === 'clone') {
        els.push(sep(), optCheck(app, id, 'aligned', 'Aligned'), optCheck(app, id, 'sampleAll', 'Sample all layers'),
          optButton('Set source', () => { app.cloneState = { ...(app.cloneState || {}), picking: true }; toast('Tap the point to clone from'); }));
      }
      return els;
    },
    async down(pt) {
      const app = this.app;
      if (kind === 'clone' && (pt.alt || app.cloneState?.picking)) {
        app.cloneState = { source: { x: pt.x, y: pt.y }, offset: null };
        toast('Clone source set', { type: 'ok', timeout: 1400 });
        this.stroke = null;
        return;
      }
      if (kind === 'clone' && !app.cloneState?.source) { toast('Set a clone source first: Alt/Option-click, or use "Set source".', { type: 'warn' }); return; }
      const node = await app.ensureRasterTarget(label);
      if (!node || !app.view.toolActive) return;
      this.stroke = new Stroke(app, node, app.opt(id), kind);
      if (kind === 'clone') this.prepareClone(pt, node);
      this.stroke.add(pt);
    },
    prepareClone(pt, node) {
      const app = this.app, cs = app.cloneState, o = app.opt(id);
      if (!cs.offset || !o.aligned) cs.offset = { x: pt.x - cs.source.x, y: pt.y - cs.source.y };
      const a = docToLocal(node, pt.x, pt.y);
      const b = docToLocal(node, pt.x - cs.offset.x, pt.y - cs.offset.y);
      cs.offLx = a.x - b.x; cs.offLy = a.y - b.y;
      if (o.sampleAll && isIdentity(node)) {
        cs.snapshot = makeCanvas(app.doc.width, app.doc.height);
        cs.snapshot.getContext('2d').drawImage(app.view.comp, 0, 0);
        cs.snapX = node.x; cs.snapY = node.y; // composite is in doc space
      } else {
        const c = makeCanvas(node.canvas.width, node.canvas.height);
        c.getContext('2d').drawImage(node.canvas, 0, 0);
        cs.snapshot = c; cs.snapX = 0; cs.snapY = 0;
      }
    },
    move(pt) { if (this.stroke) this.stroke.add(pt); },
    up() { if (this.stroke) { this.stroke.commit(label); this.stroke = null; } },
    cancel() { if (this.stroke) { this.stroke.cancel(); this.stroke = null; } },
    overlay(ctx, view) {
      const hov = view.hover;
      const o = this.app.opt(id);
      if (hov) {
        const s = view.docToScreen(hov.x, hov.y);
        const r = Math.max(2, (o.size / 2) * view.zoom);
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
        if (r < 6) { ctx.beginPath(); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6); ctx.stroke(); }
      }
      if (kind === 'clone' && this.app.cloneState?.source) {
        const cs = this.app.cloneState;
        const src = hov && cs.offset ? { x: hov.x - cs.offset.x, y: hov.y - cs.offset.y } : cs.source;
        const s = view.docToScreen(src.x, src.y);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(s.x - 8, s.y); ctx.lineTo(s.x + 8, s.y); ctx.moveTo(s.x, s.y - 8); ctx.lineTo(s.x, s.y + 8); ctx.stroke();
        ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.strokeStyle = '#d02b2a'; ctx.stroke();
      }
    },
  };
}

// ================================================================= Move / Free transform

const HANDLE = 9;
function transformHandles(node, view) {
  const pts = nodeCorners(node).map((p) => view.docToScreen(p.x, p.y));
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const hs = [
    { hx: -1, hy: -1, p: pts[0] }, { hx: 1, hy: -1, p: pts[1] }, { hx: 1, hy: 1, p: pts[2] }, { hx: -1, hy: 1, p: pts[3] },
    { hx: 0, hy: -1, p: mid(pts[0], pts[1]) }, { hx: 1, hy: 0, p: mid(pts[1], pts[2]) }, { hx: 0, hy: 1, p: mid(pts[2], pts[3]) }, { hx: -1, hy: 0, p: mid(pts[3], pts[0]) },
  ];
  const top = mid(pts[0], pts[1]);
  const c = mid(pts[0], pts[2]);
  const len = Math.hypot(top.x - c.x, top.y - c.y) || 1;
  const rot = { x: top.x + (top.x - c.x) / len * 26, y: top.y + (top.y - c.y) / len * 26 };
  return { pts, hs, rot, top };
}

const moveTool = {
  id: 'move', label: 'Move', icon: 'move', key: 'V', cursor: 'default',
  hint: 'Drag to move · handles scale (Shift keeps proportions) · top knob rotates · arrow keys nudge',
  options(app) {
    return [optCheck(app, 'move', 'autoSelect', 'Auto-select layer'), optCheck(app, 'move', 'showTransform', 'Transform controls'),
      sep(), optButton('Reset transform', () => resetTransform(app))];
  },
  canTransform(node) { return node && node.type !== 'group'; },
  down(pt) {
    const app = this.app, doc = app.doc, view = app.view;
    this.op = null;
    // guides
    if (view.showGuides) {
      for (const g of doc.guides) {
        const d = g.axis === 'x' ? Math.abs((pt.x - g.pos) * view.zoom) : Math.abs((pt.y - g.pos) * view.zoom);
        if (d < 5) { this.op = { kind: 'guide', guide: g, before: doc.guides.map((x) => ({ ...x })) }; return; }
      }
    }
    let node = app.active;
    const o = app.opt('move');
    if (node && o.showTransform && this.canTransform(node) && !app.isLocked(node)) {
      const { hs, rot } = transformHandles(node, view);
      const sp = view.docToScreen(pt.x, pt.y);
      if (Math.hypot(sp.x - rot.x, sp.y - rot.y) < HANDLE + 2) { this.begin('rotate', node, pt); return; }
      for (const hd of hs) if (Math.abs(sp.x - hd.p.x) < HANDLE && Math.abs(sp.y - hd.p.y) < HANDLE) { this.begin('scale', node, pt, hd); return; }
    }
    if (o.autoSelect && !pt.mod) {
      const hit = hitTest(doc, pt.x, pt.y);
      if (hit) { if (hit.id !== doc.activeId) app.setActive(hit.id); node = hit; }
    } else if (pt.mod) {
      const hit = hitTest(doc, pt.x, pt.y); if (hit) { app.setActive(hit.id); node = hit; }
    }
    if (!node) return;
    if (app.isLocked(node)) { toast('This layer is locked.', { type: 'warn', timeout: 1800 }); return; }
    this.begin('move', node, pt);
  },
  begin(kind, node, pt, handle) {
    const targets = node.type === 'group' ? collectLeaves(node) : [node];
    this.op = {
      kind, node, start: pt, handle, targets,
      before: targets.map((n) => ({ n, v: { x: n.x, y: n.y, sx: n.sx, sy: n.sy, rot: n.rot } })),
    };
    if (kind !== 'move') {
      const { w, h: hh } = localSize(node);
      const c = { x: node.x + w / 2, y: node.y + hh / 2 };
      this.op.center = c; this.op.w = w; this.op.h = hh;
      if (kind === 'scale') {
        const th = node.rot * Math.PI / 180;
        const ax = -handle.hx * w / 2 * node.sx, ay = -handle.hy * hh / 2 * node.sy;
        this.op.anchor = { x: c.x + ax * Math.cos(th) - ay * Math.sin(th), y: c.y + ax * Math.sin(th) + ay * Math.cos(th) };
        this.op.th = th;
      } else {
        this.op.a0 = Math.atan2(pt.y - c.y, pt.x - c.x);
      }
    }
  },
  move(pt) {
    const op = this.op; if (!op) return;
    const app = this.app;
    if (op.kind === 'guide') {
      op.guide.pos = Math.round(op.guide.axis === 'x' ? pt.x : pt.y);
      app.view.requestDraw();
      return;
    }
    if (op.kind === 'move') {
      let dx = pt.x - op.start.x, dy = pt.y - op.start.y;
      if (pt.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (app.view.snap) ({ dx, dy } = snapMove(app, op, dx, dy));
      for (const b of op.before) { b.n.x = b.v.x + dx; b.n.y = b.v.y + dy; }
    } else if (op.kind === 'scale') {
      const n = op.node, hd = op.handle, th = op.th;
      const vx = pt.x - op.anchor.x, vy = pt.y - op.anchor.y;
      const qx = vx * Math.cos(-th) - vy * Math.sin(-th), qy = vx * Math.sin(-th) + vy * Math.cos(-th);
      const b = op.before[0].v;
      let sx = hd.hx ? qx / (hd.hx * op.w) : b.sx;
      let sy = hd.hy ? qy / (hd.hy * op.h) : b.sy;
      if (pt.shift && hd.hx && hd.hy) {
        const k = Math.max(Math.abs(sx / b.sx), Math.abs(sy / b.sy));
        sx = b.sx * k * Math.sign(sx || 1); sy = b.sy * k * Math.sign(sy || 1);
      }
      if (Math.abs(sx) < 0.005) sx = 0.005 * Math.sign(sx || 1);
      if (Math.abs(sy) < 0.005) sy = 0.005 * Math.sign(sy || 1);
      const ox = hd.hx * op.w / 2 * sx, oy = hd.hy * op.h / 2 * sy;
      const cx = op.anchor.x + ox * Math.cos(th) - oy * Math.sin(th);
      const cy = op.anchor.y + ox * Math.sin(th) + oy * Math.cos(th);
      n.sx = sx; n.sy = sy; n.x = cx - op.w / 2; n.y = cy - op.h / 2;
    } else if (op.kind === 'rotate') {
      const n = op.node;
      let a = (Math.atan2(pt.y - op.center.y, pt.x - op.center.x) - op.a0) * 180 / Math.PI + op.before[0].v.rot;
      if (pt.shift) a = Math.round(a / 15) * 15;
      n.rot = ((a + 540) % 360) - 180;
    }
    app.invalidate();
    app.refreshProperties();
  },
  up() {
    const op = this.op; this.op = null; if (!op) return;
    const app = this.app;
    if (op.kind === 'guide') {
      const g = op.guide, doc = app.doc;
      const out = g.axis === 'x' ? g.pos < 0 || g.pos > doc.width : g.pos < 0 || g.pos > doc.height;
      if (out) doc.guides = doc.guides.filter((x) => x !== g);
      const before = op.before, after = doc.guides.map((x) => ({ ...x }));
      app.commit({ label: out ? 'Delete Guide' : 'Move Guide', undo: () => { doc.guides = before.map((x) => ({ ...x })); }, redo: () => { doc.guides = after.map((x) => ({ ...x })); } });
      return;
    }
    const entries = op.before.map((b) => ({ node: b.n, before: b.v, after: { x: b.n.x, y: b.n.y, sx: b.n.sx, sy: b.n.sy, rot: b.n.rot } }))
      .filter((e) => ['x', 'y', 'sx', 'sy', 'rot'].some((k) => e.before[k] !== e.after[k]));
    if (!entries.length) return;
    const label = op.kind === 'move' ? 'Move' : op.kind === 'scale' ? 'Scale' : 'Rotate';
    app.commit(entries.length === 1 ? propCmd(label, entries[0].node, entries[0].before, entries[0].after) : multiPropCmd(label, entries));
  },
  cancel() {
    const op = this.op; this.op = null; if (!op || op.kind === 'guide') { if (op) this.app.doc.guides = op.before; this.app.invalidate(); return; }
    for (const b of op.before) Object.assign(b.n, b.v);
    this.app.invalidate();
  },
  hover(pt) {
    const app = this.app, view = app.view, node = app.active;
    let cursor = 'default';
    if (view.showGuides) for (const g of app.doc.guides) {
      const d = g.axis === 'x' ? Math.abs((pt.x - g.pos) * view.zoom) : Math.abs((pt.y - g.pos) * view.zoom);
      if (d < 5) cursor = g.axis === 'x' ? 'ew-resize' : 'ns-resize';
    }
    if (node && app.opt('move').showTransform && this.canTransform(node) && !app.isLocked(node)) {
      const { hs, rot } = transformHandles(node, view);
      const sp = view.docToScreen(pt.x, pt.y);
      if (Math.hypot(sp.x - rot.x, sp.y - rot.y) < HANDLE + 2) cursor = 'grab';
      for (const hd of hs) if (Math.abs(sp.x - hd.p.x) < HANDLE && Math.abs(sp.y - hd.p.y) < HANDLE) {
        const ang = (Math.atan2(hd.hy, hd.hx) * 180 / Math.PI + node.rot + 360) % 180;
        cursor = ang < 22.5 || ang >= 157.5 ? 'ew-resize' : ang < 67.5 ? 'nwse-resize' : ang < 112.5 ? 'ns-resize' : 'nesw-resize';
      }
    }
    app.view.canvas.style.cursor = cursor;
  },
  overlay(ctx, view) {
    const app = this.app, node = app.active;
    if (!node || !node.visible) return;
    if (node.type === 'group') {
      const b = nodeBounds(node); if (!b) return;
      const a = view.docToScreen(b.x, b.y);
      ctx.strokeStyle = '#3d8bfd'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, b.w * view.zoom, b.h * view.zoom);
      return;
    }
    if (!app.opt('move').showTransform) return;
    const { pts, hs, rot, top } = transformHandles(node, view);
    ctx.lineWidth = 1; ctx.strokeStyle = '#3d8bfd';
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
    if (app.isLocked(node)) return;
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rot.x, rot.y); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const hd of hs) { ctx.fillRect(hd.p.x - 4, hd.p.y - 4, 8, 8); ctx.strokeRect(hd.p.x - 4 + 0.5, hd.p.y - 4 + 0.5, 7, 7); }
    ctx.beginPath(); ctx.arc(rot.x, rot.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  },
  onKey(e) {
    const app = this.app, node = app.active;
    const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = map[e.key];
    if (!d || !node || app.isLocked(node)) return false;
    const step = e.shiftKey ? 10 : 1;
    const targets = node.type === 'group' ? collectLeaves(node) : [node];
    const entries = targets.map((n) => ({ node: n, before: { x: n.x, y: n.y }, after: { x: n.x + d[0] * step, y: n.y + d[1] * step } }));
    for (const en of entries) Object.assign(en.node, en.after);
    const cmd = entries.length === 1 ? propCmd('Nudge', node, entries[0].before, entries[0].after, { coalesce: 'nudge' }) : multiPropCmd('Nudge', entries);
    app.commit(cmd);
    return true;
  },
};

function collectLeaves(group) { const out = []; walk(group.children, (n) => { if (n.type !== 'group') out.push(n); }); return out; }

function snapMove(app, op, dx, dy) {
  const doc = app.doc, view = app.view;
  const tol = 6 / view.zoom;
  let bounds = null;
  for (const b of op.before) {
    const n = b.n;
    const saved = { x: n.x, y: n.y };
    n.x = b.v.x + dx; n.y = b.v.y + dy;
    const nb = nodeBounds(n);
    Object.assign(n, saved);
    if (nb) bounds = bounds ? unionRect(bounds, nb) : nb;
  }
  if (!bounds) return { dx, dy };
  const xs = [0, doc.width / 2, doc.width, ...doc.guides.filter((g) => g.axis === 'x').map((g) => g.pos)];
  const ys = [0, doc.height / 2, doc.height, ...doc.guides.filter((g) => g.axis === 'y').map((g) => g.pos)];
  const bx = [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w];
  const by = [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h];
  let best = null;
  for (const t of xs) for (const s of bx) { const d = t - s; if (Math.abs(d) < tol && (!best || Math.abs(d) < Math.abs(best))) best = d; }
  if (best !== null) dx += best;
  best = null;
  for (const t of ys) for (const s of by) { const d = t - s; if (Math.abs(d) < tol && (!best || Math.abs(d) < Math.abs(best))) best = d; }
  if (best !== null) dy += best;
  return { dx, dy };
}

export function resetTransform(app) {
  const n = app.active;
  if (!n || n.type === 'group') return;
  const { w, h: hh } = localSize(n);
  const b = nodeBounds(n);
  const before = { x: n.x, y: n.y, sx: n.sx, sy: n.sy, rot: n.rot };
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const after = { sx: 1, sy: 1, rot: 0, x: cx - w / 2, y: cy - hh / 2 };
  Object.assign(n, after);
  app.commit(propCmd('Reset Transform', n, before, after));
}

// ================================================================= Selection tools

const marqueeTool = {
  id: 'marquee', label: 'Rectangular / Elliptical Marquee', icon: 'marquee', key: 'M', cursor: 'crosshair',
  hint: 'Drag to select · Shift adds · Alt subtracts · Shift+M switches rectangle/ellipse',
  options(app) {
    return [
      optSeg(app, 'marquee', 'shape', [['rect', 'marquee', 'Rectangle'], ['ellipse', 'ellipseSel', 'Ellipse']]), sep(),
      selectionModeSeg(app, 'marquee'), sep(),
      optSlider(app, 'marquee', 'feather', 'Feather', 0, 200, 1, 'px'),
    ];
  },
  down(pt) { this.start = pt; this.cur = pt; this.mode = modeFromEvent(pt, this.app.opt('marquee').mode); },
  move(pt) { this.cur = pt; this.app.view.requestDraw(); },
  rect() {
    const a = this.start, b = this.cur;
    let w = b.x - a.x, hh = b.y - a.y;
    if (b.shift && this.mode === this.app.opt('marquee').mode) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = s * Math.sign(w || 1); hh = s * Math.sign(hh || 1); }
    const r = { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + hh), w: Math.abs(w), h: Math.abs(hh) };
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  },
  up() {
    const app = this.app, doc = app.doc;
    const before = doc.selection;
    let after;
    const r = this.rect();
    const o = app.opt('marquee');
    if (r.w < 1 || r.h < 1 || screenDist(app.view, this.start, this.cur) < 3) {
      if (this.mode !== 'new' || !before) { this.start = null; app.view.requestDraw(); return; }
      after = null;
    } else {
      const next = selectionFromRect(doc, r, o.shape, o.feather);
      after = combine(doc, before, next, this.mode);
    }
    this.start = null;
    doc.selection = after;
    app.commit(selectionCmd(doc, after ? 'Marquee' : 'Deselect', before, after));
  },
  cancel() { this.start = null; this.app.view.requestDraw(); },
  overlay(ctx, view) {
    if (!this.start) return;
    const r = this.rect();
    const a = view.docToScreen(r.x, r.y);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.beginPath();
    if (this.app.opt('marquee').shape === 'ellipse') ctx.ellipse(a.x + r.w * view.zoom / 2, a.y + r.h * view.zoom / 2, r.w * view.zoom / 2, r.h * view.zoom / 2, 0, 0, Math.PI * 2);
    else ctx.rect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, r.w * view.zoom, r.h * view.zoom);
    ctx.strokeStyle = '#000'; ctx.stroke(); ctx.lineDashOffset = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
    readout(ctx, view, `${r.w} × ${r.h}`);
  },
};

function selectionModeSeg(app, tool) {
  return optSeg(app, tool, 'mode', [['new', 'select', 'New selection'], ['add', 'plus', 'Add to selection (Shift)'], ['subtract', 'minus', 'Subtract (Alt)'], ['intersect', 'mask', 'Intersect (Shift+Alt)']]);
}

function readout(ctx, view, text) {
  const hov = view.hover; if (!hov) return;
  const s = view.docToScreen(hov.x, hov.y);
  ctx.setLineDash([]);
  ctx.font = '11px ' + 'ui-monospace, monospace';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(20,20,23,.9)'; ctx.fillRect(s.x + 14, s.y + 14, w, 18);
  ctx.fillStyle = '#fff'; ctx.fillText(text, s.x + 19, s.y + 27);
}

const lassoTool = {
  id: 'lasso', label: 'Lasso', icon: 'lasso', key: 'L', cursor: 'crosshair', wantsCoalesced: true,
  hint: 'Draw around an area; release to close the selection',
  options(app) { return [selectionModeSeg(app, 'lasso'), sep(), optSlider(app, 'lasso', 'feather', 'Feather', 0, 200, 1, 'px')]; },
  down(pt) { this.pts = [pt]; this.mode = modeFromEvent(pt, this.app.opt('lasso').mode); },
  move(pt) { if (!this.pts) return; const l = this.pts[this.pts.length - 1]; if (screenDist(this.app.view, l, pt) >= 2) { this.pts.push(pt); this.app.view.requestDraw(); } },
  up() {
    const app = this.app, doc = app.doc, pts = this.pts; this.pts = null;
    if (!pts) return;
    const before = doc.selection;
    let after = null;
    if (pts.length > 2) {
      const p = new Path2D();
      pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
      p.closePath();
      after = combine(doc, before, selectionFromPath(doc, p, { feather: app.opt('lasso').feather }), this.mode);
    } else if (this.mode !== 'new') { app.view.requestDraw(); return; }
    if (!before && !after) { app.view.requestDraw(); return; }
    doc.selection = after;
    app.commit(selectionCmd(doc, after ? 'Lasso' : 'Deselect', before, after));
  },
  cancel() { this.pts = null; this.app.view.requestDraw(); },
  overlay(ctx, view) {
    if (!this.pts) return;
    ctx.beginPath();
    this.pts.forEach((q, i) => { const s = view.docToScreen(q.x, q.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.lineDashOffset = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
  },
};

// ================================================================= Crop

const RATIOS = { free: null, original: 'doc', '1:1': 1, '4:5': 4 / 5, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16 };
const cropTool = {
  id: 'crop', label: 'Crop', icon: 'crop', key: 'C', cursor: 'crosshair',
  hint: 'Drag edges or corners · drag inside to move · Enter applies · Esc cancels',
  options(app) {
    this.readoutEl = h('span', { class: 'studio-mono studio-dim' });
    const el = [
      optSelect(app, 'crop', 'ratio', 'Ratio', [['free', 'Free'], ['original', 'Original'], ['1:1', '1 : 1'], ['4:5', '4 : 5'], ['3:2', '3 : 2'], ['16:9', '16 : 9'], ['9:16', '9 : 16']]),
      this.readoutEl, sep(),
      optButton('Cancel', () => this.reset()), optButton('Apply crop', () => this.apply(), true),
    ];
    this.updateReadout();
    return el;
  },
  activate() { this.reset(); },
  optionChanged(key) { if (key === 'ratio') { this.constrain(); this.app.view.requestDraw(); } },
  reset() {
    const d = this.app.doc; if (!d) return;
    this.r = { x: 0, y: 0, w: d.width, h: d.height };
    this.updateReadout();
    this.app.view.requestDraw();
  },
  ratio() { const v = RATIOS[this.app.opt('crop').ratio]; return v === 'doc' ? this.app.doc.width / this.app.doc.height : v; },
  constrain(anchorH) {
    const k = this.ratio(); if (!k || !this.r) return;
    const r = this.r;
    if (anchorH === 'h') r.w = r.h * k; else r.h = r.w / k;
  },
  updateReadout() { if (this.readoutEl && this.r) this.readoutEl.textContent = `${Math.round(Math.abs(this.r.w))} × ${Math.round(Math.abs(this.r.h))} px`; },
  hitHandle(pt) {
    const v = this.app.view, r = this.r; if (!r) return null;
    const s = v.docToScreen(pt.x, pt.y), a = v.docToScreen(r.x, r.y), b = v.docToScreen(r.x + r.w, r.y + r.h);
    const near = (p, q) => Math.abs(p - q) < 10;
    const hx = near(s.x, a.x) ? -1 : near(s.x, b.x) ? 1 : (s.x > a.x && s.x < b.x ? 0 : null);
    const hy = near(s.y, a.y) ? -1 : near(s.y, b.y) ? 1 : (s.y > a.y && s.y < b.y ? 0 : null);
    if (hx === null || hy === null) return null;
    if (hx === 0 && hy === 0) return { move: true };
    return { hx, hy };
  },
  down(pt) {
    if (!this.r) this.reset();
    const hit = this.hitHandle(pt);
    this.drag = { start: pt, r0: { ...this.r }, hit: hit || { create: true } };
  },
  move(pt) {
    const d = this.drag; if (!d) return;
    const dx = pt.x - d.start.x, dy = pt.y - d.start.y, r0 = d.r0;
    let r;
    if (d.hit.move) r = { ...r0, x: r0.x + dx, y: r0.y + dy };
    else if (d.hit.create) r = { x: Math.min(d.start.x, pt.x), y: Math.min(d.start.y, pt.y), w: Math.abs(dx), h: Math.abs(dy) };
    else {
      r = { ...r0 };
      if (d.hit.hx === -1) { r.x = r0.x + dx; r.w = r0.w - dx; }
      if (d.hit.hx === 1) r.w = r0.w + dx;
      if (d.hit.hy === -1) { r.y = r0.y + dy; r.h = r0.h - dy; }
      if (d.hit.hy === 1) r.h = r0.h + dy;
      if (r.w < 0) { r.x += r.w; r.w = -r.w; }
      if (r.h < 0) { r.y += r.h; r.h = -r.h; }
    }
    this.r = r;
    const k = this.ratio();
    if (k) { if (d.hit.hx === 0) this.r.w = this.r.h * k; else this.r.h = this.r.w / k; }
    this.updateReadout();
    this.app.view.requestDraw();
  },
  up() { this.drag = null; if (this.r && (this.r.w < 1 || this.r.h < 1)) this.reset(); },
  cancel() { this.drag = null; },
  hover(pt) {
    const hit = this.hitHandle(pt);
    let c = 'crosshair';
    if (hit?.move) c = 'move';
    else if (hit) c = hit.hx && hit.hy ? (hit.hx === hit.hy ? 'nwse-resize' : 'nesw-resize') : hit.hx ? 'ew-resize' : 'ns-resize';
    this.app.view.canvas.style.cursor = c;
  },
  onKey(e) {
    if (e.key === 'Enter') { this.apply(); return true; }
    if (e.key === 'Escape') { this.reset(); return true; }
    return false;
  },
  apply() {
    const app = this.app, doc = app.doc, r = this.r;
    if (!r) return;
    const R = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
    if (R.x === 0 && R.y === 0 && R.w === doc.width && R.h === doc.height) { toast('Crop area matches the canvas — nothing to crop.'); return; }
    app.commit(stateCmd(doc, 'Crop', () => {
      doc.width = R.w; doc.height = R.h;
      walk(doc.layers, (n) => { if (n.type !== 'group') { n.x -= R.x; n.y -= R.y; } });
      for (const g of doc.guides) g.pos -= g.axis === 'x' ? R.x : R.y;
      doc.selection = null;
    }));
    app.docResized();
    this.reset();
  },
  overlay(ctx, view) {
    const r = this.r; if (!r) return;
    const a = view.docToScreen(r.x, r.y), W = r.w * view.zoom, H = r.h * view.zoom;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.rect(0, 0, view.cssW, view.cssH); ctx.rect(a.x, a.y, W, H); ctx.fill('evenodd');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) { ctx.moveTo(a.x + W * i / 3, a.y); ctx.lineTo(a.x + W * i / 3, a.y + H); ctx.moveTo(a.x, a.y + H * i / 3); ctx.lineTo(a.x + W, a.y + H * i / 3); }
    ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    const L = 14;
    for (const [x, y, sx, sy] of [[a.x, a.y, 1, 1], [a.x + W, a.y, -1, 1], [a.x, a.y + H, 1, -1], [a.x + W, a.y + H, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x + L * sx, y); ctx.lineTo(x, y); ctx.lineTo(x, y + L * sy); ctx.stroke();
    }
  },
};

// ================================================================= Gradient & bucket

const gradientTool = {
  id: 'gradient', label: 'Gradient', icon: 'gradient', key: 'G', group: 'fill', cursor: 'crosshair',
  hint: 'Drag to draw a gradient (Shift snaps to 45°)',
  options(app) {
    return [
      optSeg(app, 'gradient', 'type', [['linear', 'gradient', 'Linear'], ['radial', 'ellipseSel', 'Radial']]),
      optSelect(app, 'gradient', 'colors', 'Colors', [['fg-bg', 'Foreground → Background'], ['fg-transparent', 'Foreground → Transparent']]),
      optCheck(app, 'gradient', 'reverse', 'Reverse'),
      optSlider(app, 'gradient', 'opacity', 'Opacity', 0.01, 1, 0.01),
    ];
  },
  async down(pt) {
    const node = await this.app.ensureRasterTarget('Gradient');
    if (!node || !this.app.view.toolActive) return;
    this.node = node; this.start = pt; this.end = pt;
    this.expandCmd = maybeExpand(this.app, node);
    this.sel = localSelection(this.app.doc, node);
    const self = this;
    this.app.setLive({ nodeId: node.id, draw(ctx, n) { ctx.drawImage(n.canvas, 0, 0); ctx.save(); ctx.globalAlpha *= self.app.opt('gradient').opacity; const b = self.buffer(); if (b) ctx.drawImage(b, 0, 0); ctx.restore(); } });
  },
  move(pt) {
    if (!this.node) return;
    let p = pt;
    if (pt.shift) {
      const dx = pt.x - this.start.x, dy = pt.y - this.start.y;
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(dx, dy);
      p = { ...pt, x: this.start.x + Math.cos(a) * d, y: this.start.y + Math.sin(a) * d };
    }
    this.end = p; this._buf = null;
    this.app.invalidate();
  },
  buffer() {
    if (this._buf) return this._buf;
    const n = this.node, o = this.app.opt('gradient');
    const { w, h: hh } = localSize(n);
    const c = makeCanvas(w, hh), g = c.getContext('2d');
    const a = docToLocal(n, this.start.x, this.start.y), b = docToLocal(n, this.end.x, this.end.y);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) return null;
    let c1 = this.app.fg, c2 = o.colors === 'fg-bg' ? this.app.bg : hexA(this.app.fg, 0);
    if (o.reverse) [c1, c2] = [c2, c1];
    const grad = o.type === 'radial' ? g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y)) : g.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, c1.startsWith('#') ? c1 : c1); grad.addColorStop(1, c2);
    g.fillStyle = grad; g.fillRect(0, 0, w, hh);
    if (this.sel) { g.globalCompositeOperation = 'destination-in'; g.drawImage(this.sel, 0, 0); }
    this._buf = c;
    return c;
  },
  up() {
    const n = this.node; if (!n) return;
    const buf = this.buffer();
    this.app.setLive(null);
    this.node = null;
    if (!buf) { if (this.expandCmd) this.expandCmd.undo(); this.app.invalidate(); return; }
    const g = n.canvas.getContext('2d');
    const r = { x: 0, y: 0, w: n.canvas.width, h: n.canvas.height };
    const before = g.getImageData(0, 0, r.w, r.h);
    g.save(); g.globalAlpha = this.app.opt('gradient').opacity; g.drawImage(buf, 0, 0); g.restore();
    const after = g.getImageData(0, 0, r.w, r.h);
    this._buf = null;
    this.app.commit(compound('Gradient', [this.expandCmd, pixelCmd('Gradient', n, r, before, after)]));
  },
  cancel() { if (this.node) { this.app.setLive(null); if (this.expandCmd) this.expandCmd.undo(); this.node = null; this._buf = null; this.app.invalidate(); } },
  overlay(ctx, view) {
    if (!this.node) return;
    const a = view.docToScreen(this.start.x, this.start.y), b = view.docToScreen(this.end.x, this.end.y);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke(); }
  },
};

const bucketTool = {
  id: 'bucket', label: 'Paint Bucket', icon: 'bucket', key: 'G', group: 'fill', cursor: 'crosshair',
  hint: 'Click to fill similar colours with the foreground colour',
  options(app) {
    return [
      optSlider(app, 'bucket', 'tolerance', 'Tolerance', 0, 255, 1),
      optCheck(app, 'bucket', 'contiguous', 'Contiguous'),
      optCheck(app, 'bucket', 'sampleAll', 'Sample all layers'),
      optSlider(app, 'bucket', 'opacity', 'Opacity', 0.01, 1, 0.01),
    ];
  },
  async down(pt) {
    const app = this.app;
    const node = await app.ensureRasterTarget('Paint Bucket');
    if (!node) return;
    const o = app.opt('bucket');
    const expandCmd = maybeExpand(app, node);
    const W = node.canvas.width, H = node.canvas.height;
    const p = docToLocal(node, pt.x, pt.y);
    const sx = Math.floor(p.x), sy = Math.floor(p.y);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) { if (expandCmd) expandCmd.undo(); toast('Click inside the layer to fill.', { type: 'warn' }); return; }
    const g = node.canvas.getContext('2d', { willReadFrequently: true });
    const img = g.getImageData(0, 0, W, H);
    let sample = img.data;
    if (o.sampleAll && isIdentity(node)) {
      const t = makeCanvas(W, H), tg = t.getContext('2d', { willReadFrequently: true });
      tg.drawImage(app.view.comp, -node.x, -node.y);
      sample = tg.getImageData(0, 0, W, H).data;
    }
    const mask = floodMask(sample, W, H, sx, sy, o.tolerance, o.contiguous);
    let selData = null;
    const sel = localSelection(app.doc, node);
    if (sel) selData = sel.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const [r, gg, b] = hexToRgb(app.fg);
    const d = img.data;
    const before = g.getImageData(0, 0, W, H);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!mask[i]) continue;
      let a = o.opacity;
      if (selData) a *= selData[i * 4 + 3] / 255;
      if (a <= 0) continue;
      const k = i * 4, da = d[k + 3] / 255;
      const oa = a + da * (1 - a);
      d[k] = (r * a + d[k] * da * (1 - a)) / oa; d[k + 1] = (gg * a + d[k + 1] * da * (1 - a)) / oa; d[k + 2] = (b * a + d[k + 2] * da * (1 - a)) / oa; d[k + 3] = oa * 255;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) { if (expandCmd) expandCmd.undo(); return; }
    g.putImageData(img, 0, 0);
    const rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    const bImg = new ImageData(rect.w, rect.h), aImg = g.getImageData(rect.x, rect.y, rect.w, rect.h);
    for (let y = 0; y < rect.h; y++) bImg.data.set(before.data.subarray(((rect.y + y) * W + rect.x) * 4, ((rect.y + y) * W + rect.x + rect.w) * 4), y * rect.w * 4);
    app.commit(compound('Paint Bucket', [expandCmd, pixelCmd('Paint Bucket', node, rect, bImg, aImg)]));
  },
};

export function floodMask(data, W, H, sx, sy, tol, contiguous) {
  const mask = new Uint8Array(W * H);
  const i0 = (sy * W + sx) * 4;
  const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2], a0 = data[i0 + 3];
  const match = (i) => {
    const k = i * 4;
    return Math.abs(data[k] - r0) <= tol && Math.abs(data[k + 1] - g0) <= tol && Math.abs(data[k + 2] - b0) <= tol && Math.abs(data[k + 3] - a0) <= tol;
  };
  if (!contiguous) { for (let i = 0; i < W * H; i++) if (match(i)) mask[i] = 1; return mask; }
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(), x0 = stack.pop();
    let x = x0;
    while (x >= 0 && !mask[y * W + x] && match(y * W + x)) x--;
    x++;
    let up = false, down = false;
    while (x < W && !mask[y * W + x] && match(y * W + x)) {
      mask[y * W + x] = 1;
      if (y > 0) { const m = !mask[(y - 1) * W + x] && match((y - 1) * W + x); if (m && !up) { stack.push(x, y - 1); up = true; } else if (!m) up = false; }
      if (y < H - 1) { const m = !mask[(y + 1) * W + x] && match((y + 1) * W + x); if (m && !down) { stack.push(x, y + 1); down = true; } else if (!m) down = false; }
      x++;
    }
  }
  return mask;
}

// ================================================================= Text

const textTool = {
  id: 'text', label: 'Text', icon: 'text', key: 'T', cursor: 'text',
  hint: 'Click to add text · click a text layer to edit · Ctrl/Cmd+Enter or Esc to finish',
  options(app) {
    const { FONTS } = app.consts;
    const o = app.opt('text');
    const apply = (key) => { const n = app.active; if (n && n.type === 'text' && !app.isLocked(n)) { const before = { [key]: n[key] }; n[key] = o[key]; app.commit(propCmd('Text ' + key, n, before, { [key]: o[key] }, { coalesce: 'text-' + key })); app.textEditor?.sync(); } };
    const fontSel = h('select', { class: 'studio-input img-opt-select', 'aria-label': 'Font' }, FONTS.map(([v, l]) => h('option', { value: v, text: l, selected: o.font === v })));
    fontSel.addEventListener('change', () => { o.font = fontSel.value; apply('font'); });
    const size = h('input', { class: 'studio-input is-num img-opt-num', type: 'number', min: 1, max: 4000, value: o.size, 'aria-label': 'Size' });
    size.addEventListener('change', () => { o.size = Math.max(1, Math.min(4000, Number(size.value) || 72)); apply('size'); });
    const weight = h('select', { class: 'studio-input img-opt-select', 'aria-label': 'Weight' }, [[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']].map(([v, l]) => h('option', { value: v, text: l, selected: o.weight === v })));
    weight.addEventListener('change', () => { o.weight = Number(weight.value); apply('weight'); });
    const align = optSeg(app, 'text', 'align', [['left', 'alignLeft', 'Align left'], ['center', 'alignCenter', 'Center'], ['right', 'alignRight', 'Align right']]);
    align.addEventListener('click', () => apply('align'));
    return [h('label', { class: 'img-opt' }, fontSel), h('label', { class: 'img-opt' }, size, h('span', { class: 'studio-dim', text: 'px' })), h('label', { class: 'img-opt' }, weight), align,
      h('span', { class: 'studio-dim studio-small', text: 'Colour = foreground colour' })];
  },
  down(pt) {
    const app = this.app;
    if (app.textEditor) { app.closeTextEditor(); return; }
    const hit = hitTest(app.doc, pt.x, pt.y);
    if (hit && hit.type === 'text') { app.setActive(hit.id); app.openTextEditor(hit, false); return; }
    const o = app.opt('text');
    const n = makeNode('text', { text: '', font: o.font, size: o.size, weight: o.weight, align: o.align, color: app.fg, x: Math.round(pt.x), y: Math.round(pt.y - o.size * 0.8) });
    app.openTextEditor(n, true);
  },
};

// ================================================================= Shape

const shapeTool = {
  id: 'shape', label: 'Shape', icon: 'shape', key: 'U', cursor: 'crosshair',
  hint: 'Drag to draw a shape layer · Shift constrains',
  options(app) {
    return [
      optSeg(app, 'shape', 'shape', [['rect', 'rect', 'Rectangle'], ['ellipse', 'ellipse', 'Ellipse'], ['line', 'line', 'Line']]), sep(),
      optCheck(app, 'shape', 'fillOn', 'Fill'), optColor(app, 'shape', 'fill', ''),
      optCheck(app, 'shape', 'strokeOn', 'Stroke'), optColor(app, 'shape', 'stroke', ''),
      optSlider(app, 'shape', 'strokeWidth', 'Width', 0, 200, 1, 'px'),
      optSlider(app, 'shape', 'radius', 'Radius', 0, 500, 1, 'px'),
    ];
  },
  down(pt) { this.start = pt; this.cur = pt; },
  move(pt) { this.cur = pt; this.app.view.requestDraw(); },
  geom() {
    const a = this.start, b = this.cur, o = this.app.opt('shape');
    let w = b.x - a.x, hh = b.y - a.y;
    if (o.shape === 'line') {
      if (b.shift) { const ang = Math.round(Math.atan2(hh, w) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(w, hh); w = Math.cos(ang) * d; hh = Math.sin(ang) * d; }
      return { line: true, x1: a.x, y1: a.y, x2: a.x + w, y2: a.y + hh };
    }
    if (b.shift) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = s * Math.sign(w || 1); hh = s * Math.sign(hh || 1); }
    return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + hh), w: Math.abs(w), h: Math.abs(hh) };
  },
  makeNode() {
    const o = this.app.opt('shape'), g = this.geom();
    if (g.line) {
      const x = Math.min(g.x1, g.x2), y = Math.min(g.y1, g.y2);
      const pts = [{ x: g.x1 - x, y: g.y1 - y }, { x: g.x2 - x, y: g.y2 - y }].map((p) => ({ ...p, ix: p.x, iy: p.y, ox: p.x, oy: p.y }));
      return makeNode('shape', { shape: 'path', points: pts, closed: false, x, y, w: Math.max(1, Math.abs(g.x2 - g.x1)), h: Math.max(1, Math.abs(g.y2 - g.y1)), fillOn: false, strokeOn: true, stroke: o.strokeOn ? o.stroke : o.fill, strokeWidth: Math.max(1, o.strokeWidth), name: 'Line' });
    }
    return makeNode('shape', { shape: o.shape, x: Math.round(g.x), y: Math.round(g.y), w: Math.max(1, Math.round(g.w)), h: Math.max(1, Math.round(g.h)), fill: o.fill, fillOn: o.fillOn, stroke: o.stroke, strokeOn: o.strokeOn, strokeWidth: o.strokeWidth, radius: o.radius, name: o.shape === 'ellipse' ? 'Ellipse' : 'Rectangle' });
  },
  up() {
    const app = this.app;
    if (!this.start) return;
    if (screenDist(app.view, this.start, this.cur) < 3) { this.start = null; app.view.requestDraw(); return; }
    const n = this.makeNode();
    this.start = null;
    app.insertNode(n, 'Add ' + n.name);
  },
  cancel() { this.start = null; this.app.view.requestDraw(); },
  overlay(ctx, view) {
    if (!this.start) return;
    const n = this.makeNode();
    ctx.save();
    ctx.setTransform(view.dpr * view.zoom, 0, 0, view.dpr * view.zoom, view.dpr * (view.panX + n.x * view.zoom), view.dpr * (view.panY + n.y * view.zoom));
    ctx.globalAlpha = 0.85;
    drawShape(n, ctx);
    ctx.restore();
    const g = this.geom();
    readout(ctx, view, g.line ? `${Math.round(Math.hypot(g.x2 - g.x1, g.y2 - g.y1))} px` : `${Math.round(g.w)} × ${Math.round(g.h)}`);
  },
};

// ================================================================= Pen

const penTool = {
  id: 'pen', label: 'Pen', icon: 'pen', key: 'P', cursor: 'crosshair',
  hint: 'Click to add points, drag for curves · click the first point to close · Enter finishes · Esc cancels',
  options(app) {
    return [
      optSelect(app, 'pen', 'make', 'Make', [['shape', 'Shape layer'], ['selection', 'Selection']]), sep(),
      optButton('Cancel path', () => this.reset()), optButton('Finish path', () => this.finish(false), true),
    ];
  },
  reset() { this.pts = null; this.drag = null; this.app.view.requestDraw(); },
  deactivate() { if (this.pts && this.pts.length > 1) this.finish(false); else this.reset(); },
  down(pt) {
    if (!this.pts) this.pts = [];
    const v = this.app.view;
    if (this.pts.length > 2 && screenDist(v, pt, this.pts[0]) < 8) { this.finish(true); return; }
    const p = { x: pt.x, y: pt.y, ix: pt.x, iy: pt.y, ox: pt.x, oy: pt.y };
    this.pts.push(p);
    this.drag = p;
    v.requestDraw();
  },
  move(pt) {
    const p = this.drag; if (!p) return;
    p.ox = pt.x; p.oy = pt.y; p.ix = 2 * p.x - pt.x; p.iy = 2 * p.y - pt.y;
    this.app.view.requestDraw();
  },
  up() { this.drag = null; },
  cancel() { this.drag = null; },
  onKey(e) {
    if (e.key === 'Enter') { this.finish(false); return true; }
    if (e.key === 'Escape') { this.reset(); return true; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && this.pts?.length) { this.pts.pop(); this.app.view.requestDraw(); return true; }
    return false;
  },
  finish(closed) {
    const app = this.app, pts = this.pts;
    this.pts = null; this.drag = null;
    if (!pts || pts.length < 2) { app.view.requestDraw(); return; }
    const o = app.opt('pen');
    if (o.make === 'selection') {
      const p = new Path2D();
      p.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) p.bezierCurveTo(pts[i - 1].ox, pts[i - 1].oy, pts[i].ix, pts[i].iy, pts[i].x, pts[i].y);
      const a = pts[pts.length - 1], b = pts[0];
      p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y);
      p.closePath();
      const doc = app.doc, before = doc.selection, after = selectionFromPath(doc, p);
      doc.selection = after;
      app.commit(selectionCmd(doc, 'Path to Selection', before, after));
      return;
    }
    const xs = pts.flatMap((p) => [p.x, p.ix, p.ox]), ys = pts.flatMap((p) => [p.y, p.iy, p.oy]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const rel = pts.map((p) => ({ x: p.x - minX, y: p.y - minY, ix: p.ix - minX, iy: p.iy - minY, ox: p.ox - minX, oy: p.oy - minY }));
    const so = app.opt('shape');
    const n = makeNode('shape', {
      shape: 'path', points: rel, closed, x: minX, y: minY, w: Math.max(1, Math.max(...xs) - minX), h: Math.max(1, Math.max(...ys) - minY),
      fill: so.fill, fillOn: closed && so.fillOn, stroke: so.strokeOn || !closed ? so.stroke : so.fill, strokeOn: !closed || so.strokeOn, strokeWidth: Math.max(1, so.strokeWidth), name: 'Path',
    });
    app.insertNode(n, 'Pen Path');
  },
  overlay(ctx, view) {
    const pts = this.pts; if (!pts || !pts.length) return;
    const S = (x, y) => view.docToScreen(x, y);
    ctx.beginPath();
    const a0 = S(pts[0].x, pts[0].y); ctx.moveTo(a0.x, a0.y);
    for (let i = 1; i < pts.length; i++) {
      const o = S(pts[i - 1].ox, pts[i - 1].oy), ii = S(pts[i].ix, pts[i].iy), p = S(pts[i].x, pts[i].y);
      ctx.bezierCurveTo(o.x, o.y, ii.x, ii.y, p.x, p.y);
    }
    if (view.hover && !this.drag) { const hv = S(view.hover.x, view.hover.y); const l = pts[pts.length - 1]; const o = S(l.ox, l.oy); ctx.bezierCurveTo(o.x, o.y, hv.x, hv.y, hv.x, hv.y); }
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d8bfd'; ctx.stroke();
    for (const p of pts) {
      const s = S(p.x, p.y), i = S(p.ix, p.iy), o = S(p.ox, p.oy);
      if (Math.hypot(i.x - s.x, i.y - s.y) > 1) {
        ctx.beginPath(); ctx.moveTo(i.x, i.y); ctx.lineTo(o.x, o.y); ctx.strokeStyle = 'rgba(61,139,253,.7)'; ctx.lineWidth = 1; ctx.stroke();
        for (const q of [i, o]) { ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#3d8bfd'; ctx.fill(); }
      }
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#3d8bfd'; ctx.fillRect(s.x - 3.5, s.y - 3.5, 7, 7); ctx.strokeRect(s.x - 3.5, s.y - 3.5, 7, 7);
    }
  },
};

// ================================================================= Eyedropper, hand, zoom

const eyedropperTool = {
  id: 'eyedropper', label: 'Eyedropper', icon: 'eyedropper', key: 'I', cursor: 'crosshair',
  hint: 'Click to pick the foreground colour · Alt/Option picks the background colour',
  options(app) { return [optSelect(app, 'eyedropper', 'sample', 'Sample', [['all', 'All layers'], ['layer', 'Current layer']])]; },
  pick(pt) {
    const app = this.app, doc = app.doc;
    const x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    let px;
    if (app.opt('eyedropper').sample === 'layer' && app.active && app.active.type === 'raster') {
      const l = docToLocal(app.active, pt.x, pt.y);
      const c = app.active.canvas;
      if (l.x < 0 || l.y < 0 || l.x >= c.width || l.y >= c.height) return;
      px = c.getContext('2d').getImageData(Math.floor(l.x), Math.floor(l.y), 1, 1).data;
    } else px = app.view.comp.getContext('2d').getImageData(x, y, 1, 1).data;
    if (px[3] === 0) return;
    const hex = rgbToHex(px[0], px[1], px[2]);
    if (pt.alt) app.setBg(hex); else app.setFg(hex);
    this.last = { hex, pt };
    app.view.requestDraw();
  },
  down(pt) { this.pick(pt); },
  move(pt) { this.pick(pt); },
  up() { this.last = null; this.app.view.requestDraw(); },
  overlay(ctx, view) {
    if (!this.last || !view.hover) return;
    const s = view.docToScreen(view.hover.x, view.hover.y);
    ctx.beginPath(); ctx.arc(s.x, s.y - 44, 22, 0, Math.PI * 2);
    ctx.fillStyle = this.last.hex; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  },
};

const handTool = { id: 'hand', label: 'Hand', icon: 'hand', key: 'H', cursor: 'grab', hint: 'Drag to pan · Space temporarily switches to Hand', options: () => [] };

const zoomTool = {
  id: 'zoom', label: 'Zoom', icon: 'zoom', key: 'Z', cursor: 'zoom-in',
  hint: 'Click to zoom in · Alt/Option-click zooms out · drag left/right to scrub',
  options(app) {
    return [optButton('100%', () => app.view.actualSize()), optButton('Fit screen', () => app.view.fit()), optButton('Zoom in', () => app.view.zoomStep(1)), optButton('Zoom out', () => app.view.zoomStep(-1))];
  },
  down(pt, e) { this.start = { x: e.clientX, y: e.clientY, zoom: this.app.view.zoom, local: this.app.view.clientToLocal(e.clientX, e.clientY) }; this.moved = false; },
  move(pt, e) {
    if (!this.start) return;
    const dx = e.clientX - this.start.x;
    if (Math.abs(dx) > 4) this.moved = true;
    if (this.moved) this.app.view.setZoom(this.start.zoom * Math.exp(dx / 150), this.start.local.x, this.start.local.y);
  },
  up(pt, e) {
    if (this.start && !this.moved) this.app.view.zoomStep(pt.alt ? -1 : 1, this.start.local.x, this.start.local.y);
    this.start = null;
  },
};

export function createTools() {
  return [
    moveTool, marqueeTool, lassoTool, cropTool,
    paintTool('brush', 'Brush', 'brush', 'B', 'brush'),
    paintTool('eraser', 'Eraser', 'eraser', 'E', 'eraser'),
    gradientTool, bucketTool,
    paintTool('clone', 'Clone Stamp', 'clone', 'S', 'clone'),
    textTool, shapeTool, penTool, eyedropperTool, handTool, zoomTool,
    ...EXTRA_TOOLS,
  ];
}

export { optSlider, optSelect, optCheck, optSeg, optButton, sep, selectionModeSeg, modeFromEvent, screenDist };
export { localSelection, maybeExpand, getStamp, treeCmd as _treeCmd, findNode as _findNode, effectiveLocked as _effectiveLocked, matrixArgs as _matrixArgs };
