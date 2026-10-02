// EYAD IMAGE — retouching tools like a desktop photo editor: Dodge, Burn,
// Sponge, Blur, Sharpen, Smudge and History Brush, plus the Ruler (measure and
// straighten). Every stroke is a real, undoable pixel edit on the active layer;
// a selection limits where they work, and pen pressure changes size/strength.
import { toast } from '../core/ui.js';
import { getSettings } from '../core/settings.js';
import { makeCanvas, nodeMatrix, localSize, intersectRect, roundRect, unionRect } from './doc.js';
import { pixelCmd, compound, propCmd } from './history.js';
import { optSlider, optSelect, optButton, optCheck, sep, localSelection, maybeExpand } from './tools.js';

export const RETOUCH_DEFAULTS = {
  dodge: { size: 60, hardness: 0.3, strength: 0.35, range: 'midtones', protect: true, pressure: true },
  burn: { size: 60, hardness: 0.3, strength: 0.35, range: 'midtones', protect: true, pressure: true },
  sponge: { size: 60, hardness: 0.3, strength: 0.4, mode: 'saturate', pressure: true },
  blurtool: { size: 50, hardness: 0.4, strength: 0.6, pressure: true },
  sharpentool: { size: 50, hardness: 0.4, strength: 0.4, pressure: true },
  smudge: { size: 40, hardness: 0.4, strength: 0.6, pressure: true },
  historybrush: { size: 50, hardness: 0.5, strength: 1, pressure: true },
  ruler: {},
};

const falloff = (d, hard) => (d >= 1 ? 0 : d <= hard ? 1 : 1 - (d - hard) / (1 - hard + 1e-6));
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Box blur of an RGBA buffer (radius 1–3), used by Blur, Sharpen and Smudge. */
function boxBlur(src, w, h, rad) {
  const out = new Uint8ClampedArray(src.length);
  const n = (rad * 2 + 1) ** 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = -rad; dy <= rad; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); for (let dx = -rad; dx <= rad; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)); const i = (yy * w + xx) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; } }
    const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
  }
  return out;
}

class RetouchStroke {
  constructor(app, node, opts, kind) {
    this.app = app; this.node = node; this.opts = opts; this.kind = kind;
    this.expandCmd = maybeExpand(app, node);
    const { w, h } = localSize(node);
    this.work = makeCanvas(w, h);
    this.wg = this.work.getContext('2d', { willReadFrequently: true });
    this.wg.drawImage(node.canvas, 0, 0);
    this.before = null; // captured lazily per dirty rect at commit (from node.canvas, untouched until then)
    this.inv = nodeMatrix(node).inverse();
    const m = nodeMatrix(node);
    this.scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const sel = localSelection(app.doc, node);
    this.sel = sel ? sel.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data : null;
    this.W = w; this.H = h;
    if (kind === 'historybrush') {
      const snap = app.historySnapshots && app.historySnapshots.get(node.id);
      this.snap = snap && snap.width === w && snap.height === h ? snap.getContext('2d', { willReadFrequently: true }) : null;
    }
    this.dirty = null; this.last = null;
    const self = this;
    app.setLive({ nodeId: node.id, isolate: true, draw(ctx) { ctx.drawImage(self.work, 0, 0); } });
  }

  local(pt) { const p = this.inv.transformPoint(new DOMPoint(pt.x, pt.y)); return { x: p.x, y: p.y, pressure: pt.pressure, type: pt.type }; }

  add(ptDoc) {
    const p = this.local(ptDoc);
    const st = getSettings();
    const isPen = this.opts.pressure && p.type === 'pen';
    const mn = Math.max(0, Math.min(1, (st.pressureMin ?? 15) / 100));
    const f = isPen ? mn + (1 - mn) * Math.max(0.02, Math.min(1, p.pressure)) : 1;
    const r = Math.max(1, (this.opts.size / 2) * f / this.scale);
    if (!this.last) { this.dab(p.x, p.y, r, f, null); this.last = { x: p.x, y: p.y, r, f }; return; }
    const dx = p.x - this.last.x, dy = p.y - this.last.y, dist = Math.hypot(dx, dy);
    const spacing = Math.max(1, r * (this.kind === 'smudge' ? 0.12 : 0.3));
    if (dist < spacing) return;
    const steps = Math.floor(dist / spacing);
    let prev = { x: this.last.x, y: this.last.y };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, cx = this.last.x + dx * t, cy = this.last.y + dy * t;
      this.dab(cx, cy, this.last.r + (r - this.last.r) * t, this.last.f + (f - this.last.f) * t, prev);
      prev = { x: cx, y: cy };
    }
    this.last = { x: p.x, y: p.y, r, f };
  }

  dab(cx, cy, r, f, prev) {
    const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(this.W, Math.ceil(cx + r + 1)), y1 = Math.min(this.H, Math.ceil(cy + r + 1));
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const img = this.wg.getImageData(x0, y0, w, h), d = img.data;
    const o = this.opts, kind = this.kind;
    const strength = o.strength * (this.opts.pressure ? f : 1);
    let aux = null;
    if (kind === 'blurtool' || kind === 'sharpentool') aux = boxBlur(d, w, h, r > 30 ? 2 : 1);
    if (kind === 'smudge' && prev) {
      const px = Math.round(prev.x - cx), py = Math.round(prev.y - cy);
      const sx = x0 + px, sy = y0 + py;
      const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy);
      const cw = Math.min(this.W, sx + w) - cx0, ch = Math.min(this.H, sy + h) - cy0;
      if (cw > 0 && ch > 0) {
        const src = this.wg.getImageData(cx0, cy0, cw, ch).data;
        aux = new Uint8ClampedArray(d);
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          const tx = cx0 - sx + x, ty = cy0 - sy + y; const di = (ty * w + tx) * 4, si = (y * cw + x) * 4;
          aux[di] = src[si]; aux[di + 1] = src[si + 1]; aux[di + 2] = src[si + 2]; aux[di + 3] = src[si + 3];
        }
      }
    }
    let hist = null;
    if (kind === 'historybrush') { if (!this.snap) return; hist = this.snap.getImageData(x0, y0, w, h).data; }
    const hard = o.hardness;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dd = Math.hypot(x0 + x + 0.5 - cx, y0 + y + 0.5 - cy) / r;
        let wgt = falloff(dd, hard) * strength;
        if (wgt <= 0) continue;
        const i = (y * w + x) * 4;
        if (this.sel) { wgt *= this.sel[((y0 + y) * this.W + (x0 + x)) * 4 + 3] / 255; if (wgt <= 0) continue; }
        const R = d[i], G = d[i + 1], B = d[i + 2];
        if (kind === 'dodge' || kind === 'burn') {
          const L = lum(R, G, B) / 255;
          const band = o.range === 'shadows' ? Math.max(0, 1 - L * 2.2) : o.range === 'highlights' ? Math.max(0, L * 2.2 - 1.2) : 1 - Math.abs(L - 0.5) * 1.6;
          const k = wgt * 0.18 * Math.max(0.05, band);
          if (kind === 'dodge') {
            if (o.protect) { const m = 1 + k * 1.2; d[i] = R * m + (255 - R) * k * 0.35; d[i + 1] = G * m + (255 - G) * k * 0.35; d[i + 2] = B * m + (255 - B) * k * 0.35; }
            else { d[i] = R + (255 - R) * k; d[i + 1] = G + (255 - G) * k; d[i + 2] = B + (255 - B) * k; }
          } else {
            const m = 1 - k; d[i] = R * m; d[i + 1] = G * m; d[i + 2] = B * m;
            if (o.protect) { const l2 = lum(d[i], d[i + 1], d[i + 2]); const sat = 1 - k * 0.4; d[i] = l2 + (d[i] - l2) * sat; d[i + 1] = l2 + (d[i + 1] - l2) * sat; d[i + 2] = l2 + (d[i + 2] - l2) * sat; }
          }
        } else if (kind === 'sponge') {
          const L = lum(R, G, B), k = wgt * 0.12 * (o.mode === 'saturate' ? 1 : -1);
          d[i] = L + (R - L) * (1 + k); d[i + 1] = L + (G - L) * (1 + k); d[i + 2] = L + (B - L) * (1 + k);
        } else if (kind === 'blurtool') {
          const k = wgt * 0.5; d[i] += (aux[i] - R) * k; d[i + 1] += (aux[i + 1] - G) * k; d[i + 2] += (aux[i + 2] - B) * k; d[i + 3] += (aux[i + 3] - d[i + 3]) * k;
        } else if (kind === 'sharpentool') {
          const k = wgt * 0.35; d[i] = R + (R - aux[i]) * k; d[i + 1] = G + (G - aux[i + 1]) * k; d[i + 2] = B + (B - aux[i + 2]) * k;
        } else if (kind === 'smudge') {
          if (!aux) continue;
          const k = wgt * 0.85; d[i] += (aux[i] - R) * k; d[i + 1] += (aux[i + 1] - G) * k; d[i + 2] += (aux[i + 2] - B) * k; d[i + 3] += (aux[i + 3] - d[i + 3]) * k;
        } else if (kind === 'historybrush') {
          const k = Math.min(1, wgt); d[i] += (hist[i] - R) * k; d[i + 1] += (hist[i + 1] - G) * k; d[i + 2] += (hist[i + 2] - B) * k; d[i + 3] += (hist[i + 3] - d[i + 3]) * k;
        }
      }
    }
    this.wg.putImageData(img, x0, y0);
    const rect = { x: x0, y: y0, w, h };
    this.dirty = this.dirty ? unionRect(this.dirty, rect) : rect;
    const m = nodeMatrix(this.node);
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([a, b]) => m.transformPoint(new DOMPoint(a, b)));
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    this.app.invalidate({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }

  commit(label) {
    const node = this.node;
    this.app.setLive(null);
    if (!this.dirty) { if (this.expandCmd) this.expandCmd.undo(); this.app.invalidate(); return; }
    const r = intersectRect(roundRect(this.dirty), { x: 0, y: 0, w: node.canvas.width, h: node.canvas.height });
    if (!r) { this.app.invalidate(); return; }
    const g = node.canvas.getContext('2d');
    const before = g.getImageData(r.x, r.y, r.w, r.h);
    const after = this.wg.getImageData(r.x, r.y, r.w, r.h);
    g.putImageData(after, r.x, r.y);
    this.app.commit(compound(label, [this.expandCmd, pixelCmd(label, node, r, before, after)]));
  }

  cancel() { this.app.setLive(null); if (this.expandCmd) this.expandCmd.undo(); this.app.invalidate(); }
}

/** History Brush source: the layer as it was when the tool was first used (or after "Snapshot"). */
function takeSnapshot(app, node, quiet) {
  if (!node || !node.canvas) return;
  app.historySnapshots = app.historySnapshots || new Map();
  const c = makeCanvas(node.canvas.width, node.canvas.height);
  c.getContext('2d').drawImage(node.canvas, 0, 0);
  app.historySnapshots.set(node.id, c);
  if (!quiet) toast('Snapshot taken — the History Brush paints this state back.', { type: 'ok', timeout: 2200 });
}

function retouchTool(id, label, ic, key, hint) {
  return {
    id, label, icon: ic, key, cursor: 'none', showsCursor: true, wantsCoalesced: true, hint,
    options(app) {
      const els = [optSlider(app, id, 'size', 'Size', 1, 800, 1, 'px'), optSlider(app, id, 'hardness', 'Hardness', 0, 1, 0.01), optSlider(app, id, 'strength', id === 'dodge' || id === 'burn' ? 'Exposure' : 'Strength', 0.01, 1, 0.01)];
      if (id === 'dodge' || id === 'burn') els.push(optSelect(app, id, 'range', 'Range', [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']]), optCheck(app, id, 'protect', 'Protect tones'));
      if (id === 'sponge') els.push(optSelect(app, id, 'mode', 'Mode', [['saturate', 'Saturate'], ['desaturate', 'Desaturate']]));
      if (id === 'historybrush') els.push(sep(), optButton('Snapshot', () => takeSnapshot(app, app.active)));
      els.push(optCheck(app, id, 'pressure', 'Pressure'));
      return els;
    },
    async down(pt) {
      const app = this.app;
      const node = await app.ensureRasterTarget(label);
      if (!node || !app.view.toolActive) return;
      if (id === 'historybrush' && !(app.historySnapshots && app.historySnapshots.get(node.id))) {
        takeSnapshot(app, node, true);
        toast('History Brush: snapshot of this layer taken now. Edit it, then paint with this brush to bring the original back.', { timeout: 5200 });
        this.stroke = null; return;
      }
      this.stroke = new RetouchStroke(app, node, app.opt(id), id);
      this.stroke.add(pt);
    },
    move(pt) { if (this.stroke) this.stroke.add(pt); },
    up() { if (this.stroke) { this.stroke.commit(label); this.stroke = null; } },
    cancel() { if (this.stroke) { this.stroke.cancel(); this.stroke = null; } },
    overlay(ctx, view) {
      const hov = view.hover; if (!hov) return;
      const s = view.docToScreen(hov.x, hov.y), r = Math.max(2, (this.app.opt(id).size / 2) * view.zoom);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
    },
  };
}

// ================================================================= Ruler (measure & straighten)
const rulerTool = {
  id: 'ruler', label: 'Ruler', icon: 'ruler', key: 'I', cursor: 'crosshair',
  hint: 'Drag to measure distance and angle · Straighten Layer rotates the active layer so the line is level',
  options(app) {
    const m = app.ruler;
    const info = m ? `L: ${Math.round(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y))} px · A: ${(-Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x) * 180 / Math.PI).toFixed(1)}° · W: ${Math.round(m.b.x - m.a.x)} · H: ${Math.round(m.b.y - m.a.y)}` : 'Drag across the image to measure';
    return [
      Object.assign(document.createElement('span'), { className: 'studio-mono img-opt-label', textContent: info }),
      sep(),
      optButton('Straighten Layer', () => straighten(app), true),
      optButton('Clear', () => { app.ruler = null; app.refreshOptions && app.refreshOptions(); app.view.requestDraw(); }),
    ];
  },
  down(pt) { this.app.ruler = { a: { x: pt.x, y: pt.y }, b: { x: pt.x, y: pt.y } }; this.drag = true; },
  move(pt) {
    if (!this.drag) return;
    let b = { x: pt.x, y: pt.y };
    if (pt.shift) { const a = this.app.ruler.a, ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(b.x - a.x, b.y - a.y); b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len }; }
    this.app.ruler.b = b; this.app.view.requestDraw();
  },
  up() { this.drag = false; this.app.refreshOptions && this.app.refreshOptions(); },
  overlay(ctx, view) {
    const m = this.app.ruler; if (!m) return;
    const a = view.docToScreen(m.a.x, m.a.y), b = view.docToScreen(m.b.x, m.b.y);
    ctx.save();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#fff'; ctx.stroke();
    for (const p of [a, b]) { ctx.beginPath(); ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); ctx.stroke(); }
    const len = Math.round(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y)), ang = (-Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x) * 180 / Math.PI).toFixed(1);
    const label = `${len} px · ${ang}°`;
    ctx.font = '600 12px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const mx = (a.x + b.x) / 2 + 10, my = (a.y + b.y) / 2 - 12;
    ctx.fillStyle = 'rgba(20,20,24,.8)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(mx - 6, my - 14, tw + 12, 22, 11) : ctx.rect(mx - 6, my - 14, tw + 12, 22); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, mx, my + 1);
    ctx.restore();
  },
};
function straighten(app) {
  const m = app.ruler, node = app.active;
  if (!m || !node) { toast('Draw a line along something that should be level first.', { type: 'warn' }); return; }
  let ang = Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x) * 180 / Math.PI;
  // level to the nearest horizontal or vertical
  if (ang > 45 && ang <= 135) ang -= 90; else if (ang < -45 && ang >= -135) ang += 90; else if (ang > 135) ang -= 180; else if (ang < -135) ang += 180;
  if (Math.abs(ang) < 0.05) { toast('Already level.'); return; }
  const before = { rot: node.rot || 0 }, after = { rot: (node.rot || 0) - ang };
  Object.assign(node, after);
  app.commit(propCmd('Straighten', node, before, after));
  app.ruler = null; app.invalidate(); app.refresh();
  toast(`Straightened by ${(-ang).toFixed(1)}° — crop the edges with the Crop tool.`, { type: 'ok' });
}

export const RETOUCH_TOOLS = [
  retouchTool('dodge', 'Dodge', 'dodge', 'O', 'Paint to lighten · choose Shadows / Midtones / Highlights'),
  retouchTool('burn', 'Burn', 'burn', 'O', 'Paint to darken · choose Shadows / Midtones / Highlights'),
  retouchTool('sponge', 'Sponge', 'sponge', 'O', 'Paint to saturate or desaturate colour'),
  retouchTool('blurtool', 'Blur Tool', 'blurTool', 'R', 'Paint to soften detail'),
  retouchTool('sharpentool', 'Sharpen Tool', 'sharpenTool', 'R', 'Paint to crisp up detail'),
  retouchTool('smudge', 'Smudge', 'smudge', 'R', 'Drag to push pixels like wet paint'),
  retouchTool('historybrush', 'History Brush', 'historyBrush', 'Y', 'Paints the layer back to its snapshot (taken on first use, or with Snapshot)'),
  rulerTool,
];
