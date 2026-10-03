// EYAD IMAGE — more selection & retouch tools: Magic Wand, Quick Selection,
// Polygonal Lasso and Spot Healing Brush. Same contract as tools.js: every
// tool makes a real, undoable edit.
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast } from '../core/ui.js';
import { makeCanvas } from './doc.js';
import { selectionCmd } from './history.js';
import { selectionFromCanvas, selectionFromPath, combine } from './selection.js';
import { optSlider, optCheck, optSeg, optButton, sep, selectionModeSeg, modeFromEvent, screenDist, floodMask } from './tools.js';

export const EXTRA_DEFAULTS = {
  wand: { tolerance: 32, contiguous: true, sampleAll: true, mode: 'new' },
  quick: { size: 40, tolerance: 40, mode: 'add' },
  aiselect: {},
  polylasso: { mode: 'new', feather: 0 },
  heal: { size: 36 },
};

/** Composite (all layers) or active layer pixels, in document space. */
function samplePixels(app, all) {
  const d = app.doc;
  const c = makeCanvas(d.width, d.height), g = c.getContext('2d', { willReadFrequently: true });
  if (all || !app.active || !app.active.canvas) { app.view.updateComposite(); g.drawImage(app.view.comp, 0, 0); }
  else { const n = app.active; g.drawImage(n.canvas, n.x || 0, n.y || 0); }
  return g.getImageData(0, 0, d.width, d.height);
}

function maskToSelection(doc, mask, W, H, ox = 0, oy = 0) {
  return selectionFromCanvas(doc, (g) => {
    const img = new ImageData(W, H);
    for (let i = 0; i < mask.length; i++) if (mask[i]) img.data[i * 4 + 3] = 255;
    g.putImageData(img, ox, oy);
  });
}

// ================================================================= Magic Wand

const wandTool = {
  id: 'wand', label: 'Magic Wand', icon: 'wand', key: 'W', cursor: 'crosshair',
  hint: 'Click to select similar colours · Shift adds · Alt subtracts',
  options(app) {
    return [selectionModeSeg(app, 'wand'), sep(), optSlider(app, 'wand', 'tolerance', 'Tolerance', 0, 255, 1), optCheck(app, 'wand', 'contiguous', 'Contiguous'), optCheck(app, 'wand', 'sampleAll', 'Sample all layers')];
  },
  down(pt) {
    const app = this.app, doc = app.doc, o = app.opt('wand');
    const x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const img = samplePixels(app, o.sampleAll);
    const mask = floodMask(img.data, doc.width, doc.height, x, y, o.tolerance, o.contiguous);
    const before = doc.selection;
    const after = combine(doc, before, maskToSelection(doc, mask, doc.width, doc.height), modeFromEvent(pt, o.mode));
    doc.selection = after;
    app.commit(selectionCmd(doc, 'Magic Wand', before, after));
  },
};

// ================================================================= Quick Selection

const quickTool = {
  id: 'quick', label: 'Quick Selection', icon: 'drop', key: 'W', cursor: 'none', showsCursor: true, wantsCoalesced: true,
  hint: 'Paint over an area — the selection grows to similar colours · Alt subtracts',
  options(app) {
    return [optSeg(app, 'quick', 'mode', [['add', 'plus', 'Add to selection'], ['subtract', 'minus', 'Subtract from selection']]), sep(),
      optSlider(app, 'quick', 'size', 'Size', 4, 400, 1, 'px'), optSlider(app, 'quick', 'tolerance', 'Tolerance', 4, 120, 1)];
  },
  down(pt) {
    const app = this.app, d = app.doc;
    this.img = samplePixels(app, true);
    this.acc = new Uint8Array(d.width * d.height);
    this.mode = pt.alt ? 'subtract' : app.opt('quick').mode;
    this.last = null;
    this.add(pt);
  },
  add(pt) {
    const app = this.app, d = app.doc, o = app.opt('quick');
    if (this.last && screenDist(app.view, this.last, pt) < 4) return;
    this.last = pt;
    const r = Math.max(4, o.size / 2), win = Math.ceil(r * 4);
    const x0 = Math.max(0, Math.floor(pt.x - win)), y0 = Math.max(0, Math.floor(pt.y - win));
    const x1 = Math.min(d.width, Math.ceil(pt.x + win)), y1 = Math.min(d.height, Math.ceil(pt.y + win));
    const W = x1 - x0, H = y1 - y0; if (W <= 0 || H <= 0) return;
    const sub = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) sub.set(this.img.data.subarray(((y0 + y) * d.width + x0) * 4, ((y0 + y) * d.width + x1) * 4), y * W * 4);
    // seed from every pixel under the brush that is similar to the brush centre
    const cx = Math.floor(pt.x) - x0, cy = Math.floor(pt.y) - y0;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;
    const m = floodMask(sub, W, H, cx, cy, o.tolerance, true);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) this.acc[(y0 + y) * d.width + x0 + x] = 1;
    // also include the brush footprint itself
    for (let y = Math.max(0, Math.floor(pt.y - r)); y < Math.min(d.height, pt.y + r); y++) for (let x = Math.max(0, Math.floor(pt.x - r)); x < Math.min(d.width, pt.x + r); x++) if ((x - pt.x) ** 2 + (y - pt.y) ** 2 <= r * r * 0.25) this.acc[y * d.width + x] = 1;
    this.preview = null;
    app.view.requestDraw();
  },
  move(pt) { if (this.acc) this.add(pt); },
  up() {
    const app = this.app, doc = app.doc; if (!this.acc) return;
    const before = doc.selection;
    const after = combine(doc, before, maskToSelection(doc, this.acc, doc.width, doc.height), before ? this.mode : 'new');
    this.acc = null; this.img = null;
    doc.selection = after;
    app.commit(selectionCmd(doc, 'Quick Selection', before, after));
  },
  cancel() { this.acc = null; this.img = null; this.app.view.requestDraw(); },
  overlay(ctx, view) {
    const o = this.app.opt('quick');
    if (this.acc) {
      if (!this.preview) {
        const d = this.app.doc, c = makeCanvas(d.width, d.height), g = c.getContext('2d'), im = g.createImageData(d.width, d.height);
        for (let i = 0; i < this.acc.length; i++) if (this.acc[i]) { im.data[i * 4] = 208; im.data[i * 4 + 1] = 43; im.data[i * 4 + 2] = 42; im.data[i * 4 + 3] = 110; }
        g.putImageData(im, 0, 0); this.preview = c;
      }
      const a = view.docToScreen(0, 0);
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(view.rotation || 0); ctx.scale(view.zoom, view.zoom); ctx.drawImage(this.preview, 0, 0); ctx.restore();
    }
    const hov = view.hover; if (!hov) return;
    const s = view.docToScreen(hov.x, hov.y), r = Math.max(3, o.size / 2 * view.zoom);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y); if (this.mode !== 'subtract' && o.mode !== 'subtract') { ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4); } ctx.stroke();
  },
};

// ================================================================= Polygonal Lasso

const polyLassoTool = {
  id: 'polylasso', label: 'Polygonal Lasso', icon: 'polygon', key: 'L', cursor: 'crosshair',
  hint: 'Click to add corners · click the first point, double-click or press Enter to close · Esc cancels',
  options(app) { return [selectionModeSeg(app, 'polylasso'), sep(), optSlider(app, 'polylasso', 'feather', 'Feather', 0, 200, 1, 'px'), optButton('Close shape', () => this.finish())]; },
  down(pt) {
    const app = this.app;
    if (!this.pts) { this.pts = [pt]; this.mode = modeFromEvent(pt, app.opt('polylasso').mode); this.hoverPt = pt; app.view.requestDraw(); return; }
    const first = this.pts[0];
    if (this.pts.length > 2 && screenDist(app.view, first, pt) < 10) { this.finish(); return; }
    const last = this.pts[this.pts.length - 1];
    if (screenDist(app.view, last, pt) < 3 && performance.now() - (this.lastT || 0) < 400) { this.finish(); return; }
    this.lastT = performance.now();
    this.pts.push(pt); app.view.requestDraw();
  },
  hover(pt) { this.hoverPt = pt; },
  finish() {
    const app = this.app, doc = app.doc, pts = this.pts; this.pts = null;
    if (!pts || pts.length < 3) { app.view.requestDraw(); return; }
    const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y))); p.closePath();
    const before = doc.selection;
    const after = combine(doc, before, selectionFromPath(doc, p, { feather: app.opt('polylasso').feather }), this.mode);
    doc.selection = after;
    app.commit(selectionCmd(doc, 'Polygonal Lasso', before, after));
  },
  onKey(e) {
    if (!this.pts) return false;
    if (e.key === 'Enter') { this.finish(); return true; }
    if (e.key === 'Escape') { this.pts = null; this.app.view.requestDraw(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { this.pts.pop(); if (!this.pts.length) this.pts = null; this.app.view.requestDraw(); return true; }
    return false;
  },
  cancel() { /* keep points between clicks */ },
  overlay(ctx, view) {
    if (!this.pts) return;
    ctx.beginPath();
    this.pts.forEach((q, i) => { const s = view.docToScreen(q.x, q.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    if (this.hoverPt) { const s = view.docToScreen(this.hoverPt.x, this.hoverPt.y); ctx.lineTo(s.x, s.y); }
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); ctx.lineDashOffset = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.setLineDash([]);
    const f = view.docToScreen(this.pts[0].x, this.pts[0].y);
    ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#d02b2a'; ctx.fill();
  },
};

// ================================================================= Spot Healing Brush

const healTool = {
  id: 'heal', label: 'Spot Heal Brush', icon: 'heal', key: 'J', cursor: 'none', showsCursor: true, wantsCoalesced: true,
  hint: 'Paint over a blemish, object or wire — it is rebuilt from its surroundings (on this device)',
  options(app) { return [optSlider(app, 'heal', 'size', 'Size', 2, 500, 1, 'px')]; },
  down(pt) {
    const d = this.app.doc;
    this.mask = makeCanvas(d.width, d.height);
    this.mg = this.mask.getContext('2d');
    this.mg.fillStyle = '#d02b2a'; this.mg.strokeStyle = '#d02b2a'; this.mg.lineCap = 'round'; this.mg.lineJoin = 'round';
    this.last = pt; this.dab(pt);
  },
  dab(pt) {
    const r = this.app.opt('heal').size / 2;
    this.mg.lineWidth = r * 2;
    this.mg.beginPath(); this.mg.moveTo(this.last.x, this.last.y); this.mg.lineTo(pt.x + 0.01, pt.y); this.mg.stroke();
    this.last = pt; this.app.view.requestDraw();
  },
  move(pt) { if (this.mask) this.dab(pt); },
  async up() {
    const mask = this.mask; this.mask = null;
    if (!mask) return;
    this.app.view.requestDraw();
    const { contentAwareFill } = await import('./pro.js');
    await contentAwareFill(this.app, { label: 'Spot Heal', maskCanvas: mask });
  },
  cancel() { this.mask = null; this.app.view.requestDraw(); },
  overlay(ctx, view) {
    if (this.mask) {
      const a = view.docToScreen(0, 0);
      ctx.save(); ctx.globalAlpha = 0.45; ctx.translate(a.x, a.y); ctx.rotate(view.rotation || 0); ctx.scale(view.zoom, view.zoom);
      ctx.drawImage(this.mask, 0, 0); ctx.restore();
    }
    const hov = view.hover; if (!hov) return;
    const s = view.docToScreen(hov.x, hov.y), r = Math.max(3, this.app.opt('heal').size / 2 * view.zoom);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
  },
};

// Object Selection (AI): the on-device models and their glue code load on first use.
const loadAI = () => import('./ai.js');
const objectSelectTool = {
  id: 'aiselect', label: 'Object Selection (AI)', icon: 'sparkle', key: 'W', cursor: 'crosshair',
  hint: 'Click an object to select it with on-device AI · Shift adds · Alt subtracts',
  options(app) {
    return [h('span', { class: 'img-opt studio-dim', text: 'Click any object' }),
      h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => loadAI().then((m) => m.selectSubject(app)) }, icon('sparkle', 14), h('span', { text: 'Select Subject' })),
      h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => loadAI().then((m) => m.selectSky(app)) }, h('span', { text: 'Select Sky' }))];
  },
  async down(pt) {
    const app = this.app, d = app.doc;
    if (this.busy || pt.x < 0 || pt.y < 0 || pt.x > d.width || pt.y > d.height) return;
    this.busy = { x: pt.x, y: pt.y }; app.view.requestDraw();
    try { const m = await loadAI(); await m.objectSelectAt(app, pt); }
    catch (e) { console.error(e); toast('Object selection could not start. Check your connection and try again.', { type: 'error' }); }
    this.busy = null; app.view.requestDraw();
  },
  overlay(ctx, view) {
    if (!this.busy) return;
    const s = view.docToScreen(this.busy.x, this.busy.y), t = performance.now() / 300;
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x, s.y, 14, t, t + 4.2); ctx.strokeStyle = '#fff'; ctx.stroke();
    view.requestDraw();
  },
};

export const EXTRA_TOOLS = [wandTool, quickTool, polyLassoTool, healTool, objectSelectTool];
void toast;
