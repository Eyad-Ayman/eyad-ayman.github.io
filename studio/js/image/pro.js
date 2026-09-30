// EYAD IMAGE — pro colour tools: Camera Raw filter, Levels, Curves, Auto
// Tone/Contrast/Colour and Content-Aware Fill. All processing runs locally in
// the filters worker; every result is one undoable history step.
import { h, clamp } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, dialog, progressDialog } from '../core/ui.js';
import { pixelOp, finishPixelOp } from './ops.js';
import { runFilter } from './filters.js';
import { makeCanvas, nodeMatrix } from './doc.js';
import { pixelCmd } from './history.js';

const need = (app) => { if (!app.doc) { toast('Open or create a document first.'); return false; } return true; };

// ------------------------------------------------------------------ helpers

function downscale(img, max) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  if (s >= 1) return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const src = makeCanvas(img.width, img.height); src.getContext('2d').putImageData(img, 0, 0);
  const w = Math.max(1, Math.round(img.width * s)), hh = Math.max(1, Math.round(img.height * s));
  const c = makeCanvas(w, hh), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, hh);
  return g.getImageData(0, 0, w, hh);
}

export function histogramOf(img) {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  const d = img.data, step = img.width * img.height > 600000 ? 8 : 4;
  for (let i = 0; i < d.length; i += step) {
    if (d[i + 3] < 8) continue;
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++; l[(d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8]++;
  }
  return { r, g, b, l };
}

function drawHistogram(canvas, hist, { mode = 'rgb' } = {}) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = canvas.clientWidth || 256, H = canvas.clientHeight || 90;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  let max = 1;
  for (const ch of [hist.r, hist.g, hist.b, hist.l]) for (let i = 2; i < 254; i++) max = Math.max(max, ch[i]);
  const plot = (ch, color, comp) => {
    g.globalCompositeOperation = comp;
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, H);
    for (let i = 0; i < 256; i++) g.lineTo(i / 255 * W, H - Math.min(1, ch[i] / max) * H * 0.95);
    g.lineTo(W, H); g.closePath(); g.fill();
  };
  if (mode === 'rgb') {
    plot(hist.r, 'rgba(235,60,60,.75)', 'lighter'); plot(hist.g, 'rgba(60,200,90,.75)', 'lighter'); plot(hist.b, 'rgba(70,120,255,.75)', 'lighter');
  } else plot(hist.l, 'rgba(200,200,200,.8)', 'source-over');
  g.globalCompositeOperation = 'source-over';
}

/** Auto settings from a histogram (heuristic, like a one-click "Auto"). */
function autoFromImage(img) {
  const { l } = histogramOf(img);
  let tot = 0; for (let i = 0; i < 256; i++) tot += l[i];
  if (!tot) return {};
  const pct = (p) => { let a = 0; for (let i = 0; i < 256; i++) { a += l[i]; if (a >= tot * p) return i; } return 255; };
  const lo = pct(0.005), hi = pct(0.995), mid = pct(0.5);
  let mean = 0; for (let i = 0; i < 256; i++) mean += i * l[i]; mean /= tot;
  const lin = (v) => Math.pow(v / 255, 2.2);
  const exposure = clamp(Math.log2(lin(118) / Math.max(1e-4, lin(Math.max(8, (mean + mid) / 2)))) * 0.7, -2.5, 2.5);
  return {
    exposure: Math.round(exposure * 100) / 100,
    contrast: clamp(Math.round((170 - (hi - lo)) * 0.25), -20, 35),
    whites: clamp(Math.round((250 - hi) * 0.6), -40, 60),
    blacks: clamp(Math.round((6 - lo) * 0.8), -60, 30),
    highlights: hi > 245 ? -30 : -10,
    shadows: lo < 20 ? 25 : 10,
    vibrance: 18,
  };
}

// ------------------------------------------------------------------ slider rows

function sliderRow({ label, min, max, step = 1, value = 0, def = 0, track = null, format = null, onInput }) {
  const range = h('input', { class: 'cr-range', type: 'range', min, max, step, value, 'aria-label': label });
  if (track) range.style.setProperty('--cr-track', track);
  const num = h('input', { class: 'cr-num studio-mono', type: 'text', inputmode: 'decimal', value: fmt(value), 'aria-label': label + ' value' });
  function fmt(v) { return format ? format(Number(v)) : (Number(v) > 0 && min < 0 ? '+' : '') + (step < 1 ? Number(v).toFixed(2) : Math.round(v)); }
  const set = (v, fire = true) => { v = clamp(Number(v), min, max); range.value = v; num.value = fmt(v); if (fire) onInput(v); };
  range.addEventListener('input', () => { num.value = fmt(range.value); onInput(Number(range.value)); });
  num.addEventListener('change', () => { const v = parseFloat(num.value); set(Number.isFinite(v) ? v : def); });
  const lab = h('span', { class: 'cr-label', text: label, title: 'Double-click to reset' });
  const row = h('div', { class: 'cr-row' }, lab, num, range);
  lab.addEventListener('dblclick', () => set(def));
  range.addEventListener('dblclick', () => set(def));
  return { el: row, set, get: () => Number(range.value) };
}

const TEMP_TRACK = 'linear-gradient(90deg,#3b78ff,#e9e4d6,#ffb400)';
const TINT_TRACK = 'linear-gradient(90deg,#2fbf55,#e9e4d6,#e03ad8)';
const HUE_TRACK = 'linear-gradient(90deg,#f33,#ff0,#3f3,#0ff,#33f,#f0f,#f33)';
const BANDS = [['Red', '#e8453c'], ['Orange', '#f39433'], ['Yellow', '#f2d23a'], ['Green', '#48b85a'], ['Aqua', '#3fc7d6'], ['Blue', '#3f6fe8'], ['Purple', '#8a4fe0'], ['Magenta', '#e04fb8']];

// ------------------------------------------------------------------ curve editor

export class CurveEditor {
  constructor({ onChange, histogram = null, channels = true } = {}) {
    this.onChange = onChange;
    this.curves = { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
    this.ch = 'rgb';
    this.hist = histogram;
    this.canvas = h('canvas', { class: 'cr-curve', 'aria-label': 'Tone curve. Drag points; click to add; drag a point off the graph or double-click it to remove.' });
    const seg = h('div', { class: 'img-seg cr-seg' }, ['rgb', 'r', 'g', 'b'].map((c) => h('button', { class: 'studio-btn is-small', type: 'button', dataset: { c }, text: c.toUpperCase(), onclick: () => { this.ch = c; this.sync(); } })));
    this.el = h('div', { class: 'cr-curve-wrap' }, channels ? seg : null, this.canvas, h('div', { class: 'cr-curve-foot studio-faint studio-small', text: 'Click to add a point · drag off the graph to delete' }));
    this.seg = seg;
    this.bind();
    requestAnimationFrame(() => this.draw());
  }
  get value() { return JSON.parse(JSON.stringify(this.curves)); }
  set value(v) { if (v) this.curves = JSON.parse(JSON.stringify(v)); this.draw(); }
  sync() { this.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-primary', b.dataset.c === this.ch)); this.draw(); }
  toXY(e) { const r = this.canvas.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width * 255, 0, 255), clamp((1 - (e.clientY - r.top) / r.height) * 255, 0, 255), (e.clientY - r.top) / r.height, (e.clientX - r.left) / r.width]; }
  bind() {
    const c = this.canvas;
    let drag = -1;
    c.addEventListener('pointerdown', (e) => {
      const [x, y] = this.toXY(e), pts = this.curves[this.ch];
      const r = c.getBoundingClientRect(), tol = 12 / r.width * 255;
      drag = pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < tol);
      if (drag < 0) { pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]); drag = pts.findIndex((p) => p[0] === x && p[1] === y); }
      c.setPointerCapture(e.pointerId);
      this.draw(); this.onChange && this.onChange();
    });
    c.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const [x, y, fy, fx] = this.toXY(e), pts = this.curves[this.ch];
      const off = fy < -0.15 || fy > 1.15 || fx < -0.15 || fx > 1.15;
      if (off && pts.length > 2 && drag > 0 && drag < pts.length - 1) { pts.splice(drag, 1); drag = -1; }
      else {
        const lo = drag > 0 ? pts[drag - 1][0] + 1 : 0, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 1 : 255;
        pts[drag] = [drag === 0 ? Math.min(x, hi) : drag === pts.length - 1 ? Math.max(x, lo) : clamp(x, lo, hi), y];
      }
      this.draw(); this.onChange && this.onChange();
    });
    const end = () => { drag = -1; };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      const [x, y] = this.toXY(e), pts = this.curves[this.ch];
      const i = pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 10);
      if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); this.draw(); this.onChange && this.onChange(); }
    });
  }
  lut(points) {
    // same monotone cubic as the worker, for drawing
    const pts = points.slice().sort((a, b) => a[0] - b[0]), n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    const out = []; let k = 0;
    for (let x = 0; x < 256; x++) {
      if (x <= xs[0]) { out.push(ys[0]); continue; } if (x >= xs[n - 1]) { out.push(ys[n - 1]); continue; }
      while (k < n - 2 && x > xs[k + 1]) k++;
      const hh = xs[k + 1] - xs[k], t = (x - xs[k]) / hh, t2 = t * t, t3 = t2 * t;
      out.push(clamp((2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * hh * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * hh * m[k + 1], 0, 255));
    }
    return out;
  }
  draw() {
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1);
    const W = c.clientWidth || 256, H = c.clientHeight || 256;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#141414'; g.fillRect(0, 0, W, H);
    if (this.hist) {
      const ch = this.ch === 'rgb' ? this.hist.l : this.hist[this.ch];
      let max = 1; for (let i = 3; i < 253; i++) max = Math.max(max, ch[i]);
      g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(0, H);
      for (let i = 0; i < 256; i++) g.lineTo(i / 255 * W, H - Math.min(1, ch[i] / max) * H);
      g.lineTo(W, H); g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * W / 4, 0); g.lineTo(i * W / 4, H); g.moveTo(0, i * H / 4); g.lineTo(W, i * H / 4); g.stroke(); }
    g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.strokeStyle = 'rgba(255,255,255,.18)'; g.stroke();
    const col = { rgb: '#f3ede1', r: '#ff5a5a', g: '#4cd964', b: '#5a8cff' };
    for (const key of ['r', 'g', 'b', 'rgb']) {
      if (key !== this.ch && JSON.stringify(this.curves[key]) === '[[0,0],[255,255]]') continue;
      const l = this.lut(this.curves[key]);
      g.beginPath(); l.forEach((v, x) => { const X = x / 255 * W, Y = H - v / 255 * H; x ? g.lineTo(X, Y) : g.moveTo(X, Y); });
      g.strokeStyle = col[key]; g.globalAlpha = key === this.ch ? 1 : 0.4; g.lineWidth = key === this.ch ? 2 : 1; g.stroke(); g.globalAlpha = 1;
    }
    for (const p of this.curves[this.ch]) { g.beginPath(); g.arc(p[0] / 255 * W, H - p[1] / 255 * H, 4.5, 0, Math.PI * 2); g.fillStyle = '#141414'; g.fill(); g.strokeStyle = col[this.ch]; g.lineWidth = 2; g.stroke(); }
    this.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-primary', b.dataset.c === this.ch));
  }
}

// ------------------------------------------------------------------ Levels & Curves

async function livePixelDialog(app, op, { title, build, width = 420 }) {
  if (!need(app)) return;
  const ctx = await pixelOp(app, op);
  if (!ctx) return;
  const preview = makeCanvas(ctx.W, ctx.H);
  let token = 0, timer = 0;
  const update = (p) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++token;
      try {
        const out = await ctx.run(p);
        if (my !== token) return;
        preview.getContext('2d').putImageData(out, 0, 0);
        app.setLive({ nodeId: ctx.node.id, draw: (c) => c.drawImage(preview, 0, 0) });
      } catch (e) { toast(e.message, { type: 'error' }); }
    }, 70);
  };
  const hist = histogramOf(downscale(ctx.orig, 700));
  const ui = build({ update, hist });
  const v = await dialog({ title, body: ui.el, width, className: 'studio-dialog-adjust', buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: () => ui.values(), primary: true }] });
  clearTimeout(timer); token++;
  if (!v) { app.setLive(null); return; }
  const out = await ctx.run(v);
  finishPixelOp(app, ctx, out, title, op, v);
}

export function levelsDialog(app) {
  return livePixelDialog(app, 'levels', {
    title: 'Levels',
    build: ({ update, hist }) => {
      const P = { channel: 'rgb', inBlack: 0, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 };
      const hc = h('canvas', { class: 'cr-hist is-tall' });
      const ch = h('select', { class: 'studio-input' }, [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map(([v, l]) => h('option', { value: v, text: l })));
      ch.addEventListener('change', () => { P.channel = ch.value; drawHistogram(hc, hist, { mode: 'l' }); update(P); });
      const rows = [
        sliderRow({ label: 'Input black', min: 0, max: 253, value: 0, def: 0, onInput: (v) => { P.inBlack = v; update(P); } }),
        sliderRow({ label: 'Midtones (gamma)', min: 0.1, max: 9.99, step: 0.01, value: 1, def: 1, format: (v) => v.toFixed(2), onInput: (v) => { P.gamma = v; update(P); } }),
        sliderRow({ label: 'Input white', min: 2, max: 255, value: 255, def: 255, onInput: (v) => { P.inWhite = Math.max(P.inBlack + 2, v); update(P); } }),
        sliderRow({ label: 'Output black', min: 0, max: 255, value: 0, def: 0, onInput: (v) => { P.outBlack = v; update(P); } }),
        sliderRow({ label: 'Output white', min: 0, max: 255, value: 255, def: 255, onInput: (v) => { P.outWhite = v; update(P); } }),
      ];
      const auto = h('button', { class: 'studio-btn is-small', type: 'button', text: 'Auto', onclick: () => {
        const l = hist.l; let tot = 0; for (const x of l) tot += x;
        let a = 0, lo = 0, hi = 255; for (let i = 0; i < 256; i++) { a += l[i]; if (a > tot * 0.003) { lo = i; break; } }
        a = 0; for (let i = 255; i >= 0; i--) { a += l[i]; if (a > tot * 0.003) { hi = i; break; } }
        rows[0].set(lo); rows[2].set(Math.max(lo + 2, hi));
      } });
      requestAnimationFrame(() => drawHistogram(hc, hist, { mode: 'l' }));
      return { el: h('div', { class: 'cr-dialog-body' }, h('div', { class: 'studio-row' }, h('label', { class: 'studio-field-label', text: 'Channel' }), ch, h('span', { class: 'studio-spacer' }), auto), hc, ...rows.map((r) => r.el)), values: () => ({ ...P }) };
    },
  });
}

export function curvesDialog(app) {
  return livePixelDialog(app, 'curves', {
    title: 'Curves', width: 360,
    build: ({ update, hist }) => {
      const ed = new CurveEditor({ histogram: hist, onChange: () => update(ed.value) });
      const presets = h('select', { class: 'studio-input' }, [['', 'Preset…'], ['contrast', 'Medium contrast'], ['strong', 'Strong contrast'], ['lighter', 'Lighter'], ['darker', 'Darker'], ['fade', 'Faded film'], ['negative', 'Negative']].map(([v, l]) => h('option', { value: v, text: l })));
      presets.addEventListener('change', () => {
        const P = { contrast: [[0, 0], [64, 52], [192, 204], [255, 255]], strong: [[0, 0], [64, 40], [192, 216], [255, 255]], lighter: [[0, 0], [128, 158], [255, 255]], darker: [[0, 0], [128, 100], [255, 255]], fade: [[0, 34], [128, 132], [255, 236]], negative: [[0, 255], [255, 0]] }[presets.value];
        if (P) { ed.value = { ...ed.value, rgb: P }; update(ed.value); }
      });
      return { el: h('div', { class: 'cr-dialog-body' }, presets, ed.el), values: () => ed.value };
    },
  });
}

// ------------------------------------------------------------------ Auto adjustments

export async function autoAdjust(app, kind) {
  if (!need(app)) return;
  const ctx = await pixelOp(app, kind === 'color' ? 'curves' : kind === 'contrast' ? 'levels' : 'cameraRaw');
  if (!ctx) return;
  const small = downscale(ctx.orig, 800);
  let op, params, label;
  if (kind === 'tone') { op = 'cameraRaw'; params = autoFromImage(small); label = 'Auto Tone'; }
  else if (kind === 'contrast') {
    const { l } = histogramOf(small); let tot = 0; for (const x of l) tot += x;
    let a = 0, lo = 0, hi = 255; for (let i = 0; i < 256; i++) { a += l[i]; if (a > tot * 0.001) { lo = i; break; } }
    a = 0; for (let i = 255; i >= 0; i--) { a += l[i]; if (a > tot * 0.001) { hi = i; break; } }
    op = 'levels'; params = { inBlack: lo, inWhite: Math.max(lo + 2, hi), gamma: 1, outBlack: 0, outWhite: 255, channel: 'rgb' }; label = 'Auto Contrast';
  } else {
    // per-channel stretch (white balance by stretching each channel's clip points)
    const hs = histogramOf(small);
    const clip = (ch) => { let tot = 0; for (const x of ch) tot += x; let a = 0, lo = 0, hi = 255; for (let i = 0; i < 256; i++) { a += ch[i]; if (a > tot * 0.002) { lo = i; break; } } a = 0; for (let i = 255; i >= 0; i--) { a += ch[i]; if (a > tot * 0.002) { hi = i; break; } } return [[lo, 0], [Math.max(lo + 2, hi), 255]]; };
    op = 'curves'; params = { rgb: [[0, 0], [255, 255]], r: clip(hs.r), g: clip(hs.g), b: clip(hs.b) }; label = 'Auto Color';
  }
  finishPixelOp(app, ctx, await ctx.run(params), label, op, params);
  toast(label + ' applied', { type: 'ok', timeout: 1400 });
}

// ------------------------------------------------------------------ Content-Aware Fill

export async function contentAwareFill(app, { label = 'Smart Fill', maskCanvas = null } = {}) {
  if (!need(app)) return false;
  const doc = app.doc;
  if (!maskCanvas && !doc.selection) { toast('Select the area to fill first (lasso around the object).', { type: 'warn' }); return false; }
  const ctx = await pixelOp(app, 'inpaint');
  if (!ctx) return false;
  // mask in layer-local space: selection (or given doc-space mask), slightly grown so edges blend
  const node = ctx.node;
  const m = makeCanvas(ctx.W, ctx.H), mg = m.getContext('2d', { willReadFrequently: true });
  mg.setTransform(nodeMatrix(node).inverse());
  mg.drawImage(maskCanvas || doc.selection.mask, 0, 0);
  mg.setTransform(1, 0, 0, 1, 0, 0);
  // grow by 2px so the fill blends past the edge
  const grown = makeCanvas(ctx.W, ctx.H), gg = grown.getContext('2d', { willReadFrequently: true });
  for (let a = 0; a < 16; a++) { const r = 4, t = a / 16 * Math.PI * 2; gg.drawImage(m, Math.round(Math.cos(t) * r), Math.round(Math.sin(t) * r)); }
  gg.drawImage(m, 0, 0);
  const maskData = gg.getImageData(0, 0, ctx.W, ctx.H);
  let area = 0; for (let i = 3; i < maskData.data.length; i += 4) if (maskData.data[i] > 127) area++;
  if (!area) { toast('The selection doesn’t cover this layer.', { type: 'warn' }); return false; }
  const prog = area > 40000 ? progressDialog(label, { cancellable: false }) : null;
  prog && prog.set(0.3, 'Matching texture from the surroundings…');
  try {
    const out = await runFilter('inpaint', ctx.orig, { mask: maskData.data.slice().buffer });
    // blend by the (ungrown) mask so only the filled area changes
    const o = out.data, src = ctx.orig.data, md = mg.getImageData(0, 0, ctx.W, ctx.H).data, gd = maskData.data;
    for (let i = 0; i < o.length; i += 4) {
      const k = Math.max(md[i + 3], gd[i + 3]) / 255;
      if (k >= 1) continue;
      for (let c = 0; c < 4; c++) o[i + c] = src[i + c] + (o[i + c] - src[i + c]) * k;
    }
    ctx.g.putImageData(out, 0, 0);
    app.commit(pixelCmd(label, node, { x: 0, y: 0, w: ctx.W, h: ctx.H }, ctx.orig, out));
    app.invalidate();
    return true;
  } catch (e) { toast(e.message, { type: 'error' }); return false; }
  finally { prog && prog.close(); }
}

// ------------------------------------------------------------------ Camera Raw

const RAW_DEFAULTS = {
  temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
  sharpen: 0, sharpenRadius: 1, nrLum: 0, nrColor: 0,
  distortion: 0, lensVignette: 0, vignette: 0, vignetteMid: 50, grain: 0, grainSize: 1.5,
  rotate: 0, scale: 100,
};

export async function cameraRawDialog(app) {
  if (!need(app)) return;
  const ctx = await pixelOp(app, 'cameraRaw');
  if (!ctx) return;
  const P = JSON.parse(JSON.stringify({ ...RAW_DEFAULTS, ...(app.lastRaw || {}) }));
  P.curve = P.curve || { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
  P.mixer = P.mixer || { hue: Array(8).fill(0), sat: Array(8).fill(0), lum: Array(8).fill(0) };
  P.grading = P.grading || { shH: 220, shS: 0, midH: 30, midS: 0, hiH: 45, hiS: 0, balance: 0 };
  const isMobile = matchMedia('(max-width: 760px)').matches;
  const src = downscale(ctx.orig, isMobile ? 900 : 1400);
  const srcHist = histogramOf(src);
  const view = h('canvas', { class: 'cr-view' });
  const histC = h('canvas', { class: 'cr-hist' });
  const busy = h('span', { class: 'cr-busy', text: '' });
  let showBefore = false, token = 0, timer = 0, lastOut = src;
  const vg = view.getContext('2d');
  const paint = (img) => {
    const r = view.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    view.width = Math.max(1, r.width * dpr); view.height = Math.max(1, r.height * dpr);
    vg.setTransform(1, 0, 0, 1, 0, 0);
    vg.fillStyle = '#0d0d0d'; vg.fillRect(0, 0, view.width, view.height);
    const tmp = makeCanvas(img.width, img.height); tmp.getContext('2d').putImageData(img, 0, 0);
    const s = Math.min(view.width * 0.94 / img.width, view.height * 0.94 / img.height);
    const fw = img.width * s, fh = img.height * s, fx = (view.width - fw) / 2, fy = (view.height - fh) / 2;
    const geo = !showBefore && (P.rotate || P.scale !== 100);
    vg.save();
    vg.beginPath(); vg.rect(fx, fy, fw, fh); vg.clip();
    vg.translate(view.width / 2, view.height / 2);
    if (geo) { vg.rotate(P.rotate * Math.PI / 180); const k = fillScale(img.width, img.height, P.rotate) * P.scale / 100; vg.scale(k, k); }
    vg.imageSmoothingQuality = 'high';
    vg.drawImage(tmp, -fw / 2, -fh / 2, fw, fh);
    vg.restore();
    if (showBefore) { vg.fillStyle = 'rgba(0,0,0,.6)'; vg.fillRect(12, 12, 74, 24); vg.fillStyle = '#fff'; vg.font = '600 12px sans-serif'; vg.fillText('BEFORE', 22, 29); }
  };
  const render = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++token;
      busy.textContent = 'Rendering…';
      try {
        const out = await runFilter('cameraRaw', src, P);
        if (my !== token) return;
        lastOut = out;
        busy.textContent = '';
        if (!showBefore) paint(out);
        drawHistogram(histC, histogramOf(out));
      } catch (e) { busy.textContent = e.message; }
    }, 60);
  };

  // --- controls
  const rows = {};
  const row = (key, label, min, max, opt = {}) => { const r = sliderRow({ label, min, max, value: P[key], def: RAW_DEFAULTS[key] ?? 0, ...opt, onInput: (v) => { P[key] = v; render(); } }); rows[key] = r; return r.el; };
  const section = (title, open, ...content) => {
    const body = h('div', { class: 'cr-sec-body' }, content);
    const head = h('button', { class: 'cr-sec-head', type: 'button', 'aria-expanded': String(open) }, icon('chevronDown', 14), h('span', { text: title }));
    const sec = h('section', { class: 'cr-sec' + (open ? ' is-open' : '') }, head, body);
    head.addEventListener('click', () => { const o = !sec.classList.contains('is-open'); sec.classList.toggle('is-open', o); head.setAttribute('aria-expanded', String(o)); });
    return sec;
  };
  const curve = new CurveEditor({ histogram: srcHist, onChange: () => { P.curve = curve.value; render(); } });
  curve.value = P.curve;
  const mixTab = { cur: 'hue' };
  const mixBody = h('div');
  const mixSeg = h('div', { class: 'img-seg cr-seg' });
  const renderMix = () => {
    mixSeg.replaceChildren(...['hue', 'sat', 'lum'].map((k) => h('button', { class: 'studio-btn is-small' + (mixTab.cur === k ? ' is-primary' : ''), type: 'button', text: { hue: 'Hue', sat: 'Saturation', lum: 'Luminance' }[k], onclick: () => { mixTab.cur = k; renderMix(); } })));
    mixBody.replaceChildren(...BANDS.map(([name, col], i) => sliderRow({ label: name, min: -100, max: 100, value: P.mixer[mixTab.cur][i], def: 0, track: `linear-gradient(90deg, #555, ${col})`, onInput: (v) => { P.mixer[mixTab.cur][i] = v; render(); } }).el));
  };
  renderMix();
  const grade = (hk, sk, label) => h('div', { class: 'cr-grade' }, h('div', { class: 'cr-grade-title', text: label }),
    sliderRow({ label: 'Hue', min: 0, max: 360, value: P.grading[hk], def: 0, track: HUE_TRACK, format: (v) => Math.round(v) + '°', onInput: (v) => { P.grading[hk] = v; render(); } }).el,
    sliderRow({ label: 'Saturation', min: 0, max: 100, value: P.grading[sk], def: 0, onInput: (v) => { P.grading[sk] = v; render(); } }).el);

  const panel = h('div', { class: 'cr-panel' },
    h('div', { class: 'cr-histwrap' }, histC, busy),
    section('Basic', true,
      h('div', { class: 'cr-sub', text: 'White balance' }),
      row('temp', 'Temperature', -100, 100, { track: TEMP_TRACK }), row('tint', 'Tint', -100, 100, { track: TINT_TRACK }),
      h('div', { class: 'cr-sub', text: 'Tone' }),
      row('exposure', 'Exposure', -5, 5, { step: 0.05, format: (v) => (v > 0 ? '+' : '') + v.toFixed(2) }), row('contrast', 'Contrast', -100, 100),
      row('highlights', 'Highlights', -100, 100), row('shadows', 'Shadows', -100, 100), row('whites', 'Whites', -100, 100), row('blacks', 'Blacks', -100, 100),
      h('div', { class: 'cr-sub', text: 'Presence' }),
      row('texture', 'Texture', -100, 100), row('clarity', 'Clarity', -100, 100), row('dehaze', 'Dehaze', -100, 100),
      row('vibrance', 'Vibrance', -100, 100), row('saturation', 'Saturation', -100, 100)),
    section('Curve', false, curve.el),
    section('Detail', false, row('sharpen', 'Sharpening', 0, 150), row('sharpenRadius', 'Radius', 0.5, 3, { step: 0.1, format: (v) => v.toFixed(1) }), row('nrLum', 'Noise reduction', 0, 100), row('nrColor', 'Colour noise reduction', 0, 100)),
    section('Colour mixer', false, mixSeg, mixBody),
    section('Colour grading', false, grade('shH', 'shS', 'Shadows'), grade('midH', 'midS', 'Midtones'), grade('hiH', 'hiS', 'Highlights'),
      sliderRow({ label: 'Balance', min: -100, max: 100, value: P.grading.balance, def: 0, onInput: (v) => { P.grading.balance = v; render(); } }).el),
    section('Optics', false, row('distortion', 'Distortion', -100, 100), row('lensVignette', 'Lens vignetting', -100, 100)),
    section('Geometry', false, row('rotate', 'Straighten', -45, 45, { step: 0.1, format: (v) => v.toFixed(1) + '°' }), row('scale', 'Scale', 50, 150, { format: (v) => Math.round(v) + '%' }),
      h('p', { class: 'studio-faint studio-small', text: 'Straightening crops to fill the frame. For free crops use the Crop tool (C).' })),
    section('Effects', false, row('vignette', 'Vignette', -100, 100), row('vignetteMid', 'Midpoint', 0, 100), row('grain', 'Grain', 0, 100), row('grainSize', 'Grain size', 0.5, 5, { step: 0.1, format: (v) => v.toFixed(1) })));

  const resetAll = () => {
    Object.assign(P, JSON.parse(JSON.stringify(RAW_DEFAULTS)));
    P.curve = { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
    P.mixer = { hue: Array(8).fill(0), sat: Array(8).fill(0), lum: Array(8).fill(0) };
    P.grading = { shH: 220, shS: 0, midH: 30, midS: 0, hiH: 45, hiS: 0, balance: 0 };
    for (const [k, r] of Object.entries(rows)) r.set(P[k], false);
    curve.value = P.curve; renderMix(); render();
  };
  const auto = () => { const a = autoFromImage(src); for (const [k, v] of Object.entries(a)) { P[k] = v; rows[k] && rows[k].set(v, false); } render(); };
  const beforeBtn = h('button', { class: 'studio-btn is-small', type: 'button', title: 'Before / After (Y or \\)', onclick: () => toggleBefore() }, icon('swap', 14), h('span', { text: 'Before / After' }));
  const toggleBefore = (v) => { showBefore = v === undefined ? !showBefore : v; beforeBtn.classList.toggle('is-primary', showBefore); paint(showBefore ? src : lastOut); };

  return new Promise((resolve) => {
    const overlay = h('div', { class: 'cr-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Raw Develop Filter' },
      h('header', { class: 'cr-top' },
        h('div', { class: 'cr-brand' }, icon('aperture', 18), h('span', { text: 'CAMERA RAW' }), h('em', { class: 'studio-faint', text: ctx.node.name })),
        h('div', { class: 'cr-actions' }, beforeBtn,
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Auto', onclick: auto }),
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Reset', onclick: resetAll }),
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Cancel', onclick: () => close(false) }),
          h('button', { class: 'studio-btn is-small is-primary', type: 'button', text: 'OK', onclick: () => close(true) }))),
      h('div', { class: 'cr-main' }, h('div', { class: 'cr-stage' }, view), panel));
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
      if (e.key === 'y' || e.key === 'Y' || e.key === '\\') { e.preventDefault(); toggleBefore(); }
    };
    // press-and-hold the image to compare
    view.addEventListener('pointerdown', () => toggleBefore(true));
    view.addEventListener('pointerup', () => toggleBefore(false));
    view.addEventListener('pointercancel', () => toggleBefore(false));
    document.addEventListener('keydown', onKey, true);
    app.root.appendChild(overlay);
    requestAnimationFrame(() => { overlay.classList.add('is-in'); paint(src); render(); });
    const ro = new ResizeObserver(() => paint(showBefore ? src : lastOut)); ro.observe(view.parentElement);
    async function close(ok) {
      document.removeEventListener('keydown', onKey, true);
      ro.disconnect(); clearTimeout(timer); token++;
      if (!ok) { overlay.remove(); resolve(false); return; }
      const prog = progressDialog('Raw Develop', { cancellable: false });
      prog.set(0.4, 'Developing at full resolution…');
      try {
        let out = await ctx.run(P);
        if (P.rotate || P.scale !== 100) out = straighten(out, P.rotate, P.scale);
        finishPixelOp(app, ctx, out, 'Raw Develop Filter', 'cameraRaw', P);
        app.lastRaw = JSON.parse(JSON.stringify(P));
      } catch (e) { toast(e.message, { type: 'error' }); }
      finally { prog.close(); overlay.remove(); resolve(true); }
    }
  });
}

function fillScale(w, hh, deg) {
  const a = Math.abs(deg * Math.PI / 180), c = Math.cos(a), s = Math.sin(a);
  return Math.max((w * c + hh * s) / w, (w * s + hh * c) / hh);
}
function straighten(img, deg, scalePct) {
  const W = img.width, H = img.height;
  const src = makeCanvas(W, H); src.getContext('2d').putImageData(img, 0, 0);
  const c = makeCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  const k = fillScale(W, H, deg) * scalePct / 100;
  g.imageSmoothingQuality = 'high';
  g.translate(W / 2, H / 2); g.rotate(deg * Math.PI / 180); g.scale(k, k);
  g.drawImage(src, -W / 2, -H / 2);
  return g.getImageData(0, 0, W, H);
}
