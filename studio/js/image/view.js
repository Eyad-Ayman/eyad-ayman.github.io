// EYAD IMAGE — viewport: zoom/pan, compositing cache, overlays and
// pointer/touch gesture routing (pinch-zoom, two-finger pan, long-press,
// double-tap, pen pressure).
import { renderDoc } from './render.js';
import { makeCanvas } from './doc.js';
import { getSettings } from '../core/settings.js';

const ZOOM_STEPS = [0.02, 0.03, 0.05, 0.0625, 0.083, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export class View {
  constructor(app, stage) {
    this.app = app;
    this.stage = stage;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'img-view';
    this.canvas.setAttribute('aria-label', 'Canvas');
    this.canvas.tabIndex = 0;
    stage.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.doc = null;
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.rotation = 0; // view rotation (radians) around the stage centre — display only, never changes pixels
    this.stylusSeen = false;
    this.comp = null; this.compDirty = null;
    this.dpr = 1; this.cssW = 0; this.cssH = 0;
    this.pointers = new Map();
    this.gesture = null;
    this.panning = null;
    this.toolActive = false;
    this.spaceDown = false;
    this.hover = null;
    this.antsPhase = 0;
    this.showGrid = getSettings().showRulersGrid;
    try { this.showRulers = localStorage.getItem('eyad-studio:image:rulers') !== '0'; } catch (e) { this.showRulers = true; }
    this.showGuides = true;
    this.snap = true;
    this.lastTap = null;
    this.frame = 0;

    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.bindPointers();
    this.antsTimer = setInterval(() => {
      if (this.doc && this.doc.selection && document.visibilityState === 'visible') { this.antsPhase = (this.antsPhase + 1) % 16; this.requestDraw(); }
    }, 120);
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cssW = Math.max(1, r.width); this.cssH = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = this.cssW + 'px';
    this.canvas.style.height = this.cssH + 'px';
    if (this.doc && !this.didFit) { this.fit({ max: 1 }); this.didFit = true; }
    this.requestDraw();
  }

  setDoc(doc, state) {
    this.doc = doc;
    this.comp = null;
    if (state && state.zoom) { this.zoom = state.zoom; this.panX = state.panX; this.panY = state.panY; this.didFit = true; }
    else { this.didFit = false; if (this.cssW > 1) { this.fit({ max: 1 }); this.didFit = true; } }
    this.invalidate();
  }
  getState() { return { zoom: this.zoom, panX: this.panX, panY: this.panY }; }

  // ------------------------------------------------------------ coordinates
  // Rotation is applied around the stage centre after zoom/pan. rot/unrot map
  // between the rotated (what you see) and unrotated stage coordinates.
  rot(p) {
    if (!this.rotation) return p;
    const cx = this.cssW / 2, cy = this.cssH / 2, c = Math.cos(this.rotation), s = Math.sin(this.rotation);
    const dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  }
  unrot(p) {
    if (!this.rotation) return p;
    const cx = this.cssW / 2, cy = this.cssH / 2, c = Math.cos(-this.rotation), s = Math.sin(-this.rotation);
    const dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  }
  screenToDoc(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const u = this.unrot({ x: clientX - r.left, y: clientY - r.top });
    return { x: (u.x - this.panX) / this.zoom, y: (u.y - this.panY) / this.zoom };
  }
  docToScreen(x, y) { return this.rot({ x: x * this.zoom + this.panX, y: y * this.zoom + this.panY }); }
  clientToLocal(clientX, clientY) { const r = this.canvas.getBoundingClientRect(); return { x: clientX - r.left, y: clientY - r.top }; }
  setRotation(rad) {
    let a = rad % (Math.PI * 2); if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2;
    // snap to right angles when close
    for (const k of [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI]) if (Math.abs(a - k) < 0.05) a = k;
    this.rotation = Math.abs(a) < 1e-4 ? 0 : a;
    this.changed();
  }
  rotateBy(deg) { this.setRotation(this.rotation + deg * Math.PI / 180); }

  // ------------------------------------------------------------ zoom
  fit({ max = 64 } = {}) {
    if (!this.doc) return;
    const pad = this.cssW < 600 ? 16 : 48;
    const z = Math.min((this.cssW - pad * 2) / this.doc.width, (this.cssH - pad * 2) / this.doc.height, max);
    this.zoom = Math.max(0.01, Math.min(64, z));
    this.center();
    this.changed();
  }
  actualSize() { this.setZoom(1, this.cssW / 2, this.cssH / 2); }
  center() {
    this.panX = Math.round((this.cssW - this.doc.width * this.zoom) / 2);
    this.panY = Math.round((this.cssH - this.doc.height * this.zoom) / 2);
  }
  setZoom(z, cx = this.cssW / 2, cy = this.cssH / 2) {
    z = Math.max(0.01, Math.min(64, z));
    ({ x: cx, y: cy } = this.unrot({ x: cx, y: cy }));
    const dx = (cx - this.panX) / this.zoom, dy = (cy - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = cx - dx * z;
    this.panY = cy - dy * z;
    this.changed();
  }
  zoomStep(dir, cx, cy) {
    const cur = this.zoom;
    let next;
    if (dir > 0) next = ZOOM_STEPS.find((s) => s > cur * 1.01) || 64;
    else next = [...ZOOM_STEPS].reverse().find((s) => s < cur * 0.99) || 0.01;
    this.setZoom(next, cx, cy);
  }
  changed() { this.requestDraw(); this.app.onViewChange && this.app.onViewChange(); }

  // ------------------------------------------------------------ rendering
  invalidate(rect) {
    if (!rect || !this.compDirty) this.compDirty = rect ? { ...rect } : true;
    else if (this.compDirty !== true) {
      const a = this.compDirty;
      const x = Math.min(a.x, rect.x), y = Math.min(a.y, rect.y);
      this.compDirty = { x, y, w: Math.max(a.x + a.w, rect.x + rect.w) - x, h: Math.max(a.y + a.h, rect.y + rect.h) - y };
    }
    if (!rect) this.compDirty = true;
    this.requestDraw();
  }
  requestDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  updateComposite() {
    const doc = this.doc;
    if (!this.comp || this.comp.width !== doc.width || this.comp.height !== doc.height) {
      this.comp = makeCanvas(doc.width, doc.height);
      this.compDirty = true;
    }
    if (!this.compDirty) return;
    const g = this.comp.getContext('2d');
    let rect = this.compDirty === true ? null : this.compDirty;
    if (rect) {
      rect = { x: Math.floor(rect.x) - 2, y: Math.floor(rect.y) - 2, w: Math.ceil(rect.w) + 4, h: Math.ceil(rect.h) + 4 };
      g.clearRect(rect.x, rect.y, rect.w, rect.h);
    } else g.clearRect(0, 0, doc.width, doc.height);
    renderDoc(doc, g, { rect, live: this.app.live, hide: this.app.hidden });
    this.compDirty = null;
  }

  checkerPattern(ctx) {
    const key = getSettings().checker;
    if (this._checker && this._checkerKey === key) return this._checker;
    const c = makeCanvas(16, 16);
    const g = c.getContext('2d');
    const [a, b] = { light: ['#ffffff', '#e6e6e6'], mid: ['#cfcfcf', '#a9a9a9'], dark: ['#3a3a3a', '#2c2c2c'] }[key] || ['#cfcfcf', '#a9a9a9'];
    g.fillStyle = a; g.fillRect(0, 0, 16, 16);
    g.fillStyle = b; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    this._checker = ctx.createPattern(c, 'repeat');
    this._checkerKey = key;
    return this._checker;
  }

  draw() {
    const ctx = this.ctx, doc = this.doc;
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const styles = getComputedStyle(this.stage);
    ctx.clearRect(0, 0, this.cssW, this.cssH); // the pasteboard colour may be translucent (spatial look)
    ctx.fillStyle = styles.getPropertyValue('--st-canvas-bg').trim() || '#070708';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (!doc) return;
    this.updateComposite();
    ctx.save();
    if (this.rotation) { ctx.translate(this.cssW / 2, this.cssH / 2); ctx.rotate(this.rotation); ctx.translate(-this.cssW / 2, -this.cssH / 2); }
    const x = this.panX, y = this.panY, w = doc.width * this.zoom, h = doc.height * this.zoom;
    // shadow + checker
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#888';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.fillStyle = this.checkerPattern(ctx);
    ctx.fillRect(x, y, w, h);
    // composite
    ctx.save();
    ctx.imageSmoothingEnabled = this.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.comp, x, y, w, h);
    ctx.restore();

    if (this.showGrid) this.drawGrid(ctx);
    if (this.showGuides && doc.guides.length) this.drawGuides(ctx);
    if (doc.selection) this.drawSelection(ctx, doc.selection);
    ctx.restore();
    const tool = this.app.tool;
    if (tool && tool.overlay) { ctx.save(); tool.overlay(ctx, this); ctx.restore(); }
    if (this.showRulers && !this.rotation) this.drawRulers(ctx);
  }

  drawRulers(ctx) {
    const T = 18, z = this.zoom, W = this.cssW, H = this.cssH;
    const cs = getComputedStyle(this.stage);
    const bg = cs.getPropertyValue('--st-panel').trim() || 'rgba(30,30,34,.9)', fg = cs.getPropertyValue('--st-dim').trim() || '#aaa';
    // tick spacing: a "nice" step in document pixels that is at least ~50 screen px apart
    const raw = 50 / z, pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= raw) || 10 * pow;
    ctx.save();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, T); ctx.fillRect(0, 0, T, H);
    ctx.fillStyle = fg; ctx.strokeStyle = fg; ctx.globalAlpha = 0.85; ctx.lineWidth = 1;
    ctx.font = '9px ui-monospace, monospace'; ctx.textBaseline = 'top';
    ctx.beginPath();
    const x0 = Math.floor(-this.panX / z / step) * step;
    for (let v = x0; this.panX + v * z < W; v += step / 5) {
      const sx = Math.round(this.panX + v * z) + 0.5; if (sx < T) continue;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      ctx.moveTo(sx, T); ctx.lineTo(sx, major ? 4 : T - 5);
      if (major) ctx.fillText(String(Math.round(v)), sx + 2, 2);
    }
    const y0 = Math.floor(-this.panY / z / step) * step;
    for (let v = y0; this.panY + v * z < H; v += step / 5) {
      const sy = Math.round(this.panY + v * z) + 0.5; if (sy < T) continue;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      ctx.moveTo(T, sy); ctx.lineTo(major ? 4 : T - 5, sy);
      if (major) { ctx.save(); ctx.translate(2, sy + 2); ctx.rotate(Math.PI / 2); ctx.fillText(String(Math.round(v)), 0, -8); ctx.restore(); }
    }
    ctx.stroke();
    // pointer position markers
    if (this.hover) {
      ctx.strokeStyle = '#19c3ff'; ctx.globalAlpha = 1; ctx.beginPath();
      const hx = Math.round(this.panX + this.hover.x * z) + 0.5, hy = Math.round(this.panY + this.hover.y * z) + 0.5;
      ctx.moveTo(hx, 0); ctx.lineTo(hx, T); ctx.moveTo(0, hy); ctx.lineTo(T, hy); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = bg; ctx.fillRect(0, 0, T, T);
    ctx.restore();
  }

  drawGrid(ctx) {
    const doc = this.doc, gs = getSettings().gridSize || 32;
    if (gs * this.zoom < 4) return;
    ctx.save();
    ctx.beginPath();
    for (let gx = gs; gx < doc.width; gx += gs) { const s = Math.round(this.panX + gx * this.zoom) + 0.5; ctx.moveTo(s, this.panY); ctx.lineTo(s, this.panY + doc.height * this.zoom); }
    for (let gy = gs; gy < doc.height; gy += gs) { const s = Math.round(this.panY + gy * this.zoom) + 0.5; ctx.moveTo(this.panX, s); ctx.lineTo(this.panX + doc.width * this.zoom, s); }
    ctx.strokeStyle = 'rgba(120,160,255,.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawGuides(ctx) {
    ctx.save();
    ctx.strokeStyle = '#19c3ff';
    ctx.lineWidth = 1;
    for (const g of this.doc.guides) {
      ctx.beginPath();
      const ext = this.rotation ? Math.hypot(this.cssW, this.cssH) : 0;
      if (g.axis === 'x') { const s = Math.round(this.panX + g.pos * this.zoom) + 0.5; ctx.moveTo(s, -ext); ctx.lineTo(s, this.cssH + ext); }
      else { const s = Math.round(this.panY + g.pos * this.zoom) + 0.5; ctx.moveTo(-ext, s); ctx.lineTo(this.cssW + ext, s); }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSelection(ctx, sel) {
    const segs = sel.segs;
    ctx.save();
    ctx.beginPath();
    const z = this.zoom, px = this.panX, py = this.panY;
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(px + segs[i] * z, py + segs[i + 1] * z);
      ctx.lineTo(px + segs[i + 2] * z, py + segs[i + 3] * z);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this.antsPhase / 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------ input
  bindPointers() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerleave', () => { this.hover = null; this.requestDraw(); });
    c.addEventListener('lostpointercapture', (e) => { if (this.pointers.has(e.pointerId)) this.onUp(e, true); });
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.pointerType !== 'touch') this.app.onContextMenu(this.screenToDoc(e.clientX, e.clientY), e.clientX, e.clientY); });
    c.addEventListener('dblclick', (e) => { this.app.onDoubleTap(this.screenToDoc(e.clientX, e.clientY), e); });
    // Safari trackpad pinch
    c.addEventListener('gesturestart', (e) => { e.preventDefault(); this._gz = this.zoom; });
    c.addEventListener('gesturechange', (e) => { e.preventDefault(); const p = this.clientToLocal(e.clientX, e.clientY); this.setZoom(this._gz * e.scale, p.x, p.y); });
  }

  ptFrom(e) {
    const p = this.screenToDoc(e.clientX, e.clientY);
    if (e.pointerType === 'pen') {
      // pressure curve (Settings ▸ Pen): 50 = linear, lower = soft (light touch goes further), higher = firm
      const st = getSettings(), g = Math.pow(2, ((Number(st.pressureCurve) || 50) - 50) / 30);
      p.pressure = Math.pow(Math.max(0.001, Math.min(1, e.pressure || 0.5)), g);
      if (st.tiltAngle && (e.tiltX || e.tiltY || e.twist)) p.angle = e.twist ? e.twist * Math.PI / 180 : Math.atan2(e.tiltY || 0, e.tiltX || 0);
    } else p.pressure = 1;
    p.type = e.pointerType;
    p.shift = e.shiftKey; p.alt = e.altKey; p.mod = e.ctrlKey || e.metaKey;
    p.clientX = e.clientX; p.clientY = e.clientY;
    return p;
  }

  onDown(e) {
    if (!this.doc) return;
    this.canvas.focus({ preventScroll: true });
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, type: e.pointerType, t: performance.now() });
    clearTimeout(this.longPressTimer);
    if (e.pointerType === 'pen') this.stylusSeen = true;
    // pen eraser end (or eraser barrel button) → Eraser while it touches, like desktop apps
    if (e.pointerType === 'pen' && (e.buttons & 32 || e.button === 5) && getSettings().penEraserTip !== false && this.app.tool && this.app.tool.id !== 'eraser' && !this._eraserFrom) {
      this._eraserFrom = this.app.tool.id; this.app.selectTool('eraser');
    }
    const touches = Array.from(this.pointers.values()).filter((q) => q.type === 'touch');
    // multi-finger tap tracking (2 = undo, 3 = redo)
    if (e.pointerType === 'touch') {
      if (touches.length === 1) this.tap = { n: 1, t: performance.now(), moved: false };
      else if (this.tap) this.tap.n = Math.max(this.tap.n, touches.length);
    }
    const ps = getSettings().penMode;
    const fingerPans = e.pointerType === 'touch' && (ps === 'finger-pan' || (ps !== 'finger-draw' && this.stylusSeen));

    if (e.pointerType === 'touch' && this.pointers.size === 3) { this.gesture = null; this.panning = null; return; }
    if (e.pointerType === 'touch' && this.pointers.size === 2) {
      // second finger → cancel the tool action and start pinch/pan
      if (this.toolActive) { this.app.tool.cancel && this.app.tool.cancel(); this.toolActive = false; }
      this.panning = null;
      const [a, b] = Array.from(this.pointers.values());
      const mid = this.clientToLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), rot: this.rotation, mid: this.unrot(mid), zoom: this.zoom, panX: this.panX, panY: this.panY };
      return;
    }
    if (this.pointers.size > 2) return;

    const tool = this.app.tool;
    if (this.rDown && e.button === 0) {
      const c = this.clientToLocal(e.clientX, e.clientY);
      this.rotating = { a0: Math.atan2(c.y - this.cssH / 2, c.x - this.cssW / 2), rot: this.rotation };
      return;
    }
    if (e.button === 1 || this.spaceDown || fingerPans || (tool && tool.id === 'hand')) {
      this.panning = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2) return;
    if (e.pointerType === 'touch') {
      this.longPressTimer = setTimeout(() => {
        const p = this.pointers.get(e.pointerId);
        if (!p || Math.hypot(p.x - p.sx, p.y - p.sy) > 10 || this.pointers.size !== 1) return;
        if (this.toolActive) { tool.cancel && tool.cancel(); this.toolActive = false; }
        this.longPressed = true;
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (er) { /* ignore */ }
        this.app.onContextMenu(this.screenToDoc(e.clientX, e.clientY), e.clientX, e.clientY);
      }, 550);
    }
    this.longPressed = false;
    if (tool && tool.down) {
      this.toolActive = true;
      tool.down(this.ptFrom(e), e);
    }
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (this.gesture && this.pointers.size >= 2) {
      const [a, b] = Array.from(this.pointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = this.clientToLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
      const g = this.gesture;
      if (this.tap && Math.hypot(a.x - a.sx, a.y - a.sy) + Math.hypot(b.x - b.sx, b.y - b.sy) > 16) this.tap.moved = true;
      const z = Math.max(0.01, Math.min(64, g.zoom * dist / Math.max(1, g.dist)));
      // two-finger rotation (only once the twist is deliberate)
      const dAng = Math.atan2(b.y - a.y, b.x - a.x) - g.ang;
      if (Math.abs(dAng) > 0.12 || g.rotating) { g.rotating = true; this.rotation = g.rot + dAng; }
      // keep the doc point under the original midpoint under the new midpoint
      const um = this.unrot(mid);
      const dx = (g.mid.x - g.panX) / g.zoom, dy = (g.mid.y - g.panY) / g.zoom;
      this.zoom = z;
      this.panX = um.x - dx * z;
      this.panY = um.y - dy * z;
      this.changed();
      return;
    }
    if (this.rotating) {
      const c = this.clientToLocal(e.clientX, e.clientY);
      this.setRotation(this.rotating.rot + Math.atan2(c.y - this.cssH / 2, c.x - this.cssW / 2) - this.rotating.a0);
      return;
    }
    if (this.panning) {
      const c = Math.cos(-this.rotation), s = Math.sin(-this.rotation);
      const dx = e.clientX - this.panning.x, dy = e.clientY - this.panning.y;
      this.panX = this.panning.panX + dx * c - dy * s;
      this.panY = this.panning.panY + dx * s + dy * c;
      this.changed();
      return;
    }
    const pt = this.ptFrom(e);
    this.hover = pt;
    this.app.onPointerHover && this.app.onPointerHover(pt);
    if (this.toolActive && this.app.tool && this.app.tool.move) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (events.length > 1 && this.app.tool.wantsCoalesced) for (const ce of events) this.app.tool.move(this.ptFrom(ce), ce);
      else this.app.tool.move(pt, e);
    } else if (this.app.tool && this.app.tool.hover) {
      this.app.tool.hover(pt, e);
      this.requestDraw();
    } else if (this.app.tool && this.app.tool.showsCursor) this.requestDraw();
  }

  onUp(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longPressTimer);
    if (this.rotating) { this.rotating = null; this.setRotation(this.rotation); return; }
    // two-finger tap → undo, three-finger tap → redo
    if (e.pointerType === 'touch' && this.tap && !this.pointers.size) {
      const tp = this.tap; this.tap = null;
      if (!tp.moved && !cancelled && tp.n >= 2 && performance.now() - tp.t < 350 && getSettings().touchUndoGestures !== false) {
        if (tp.n === 2) this.app.undo(); else this.app.redo();
        this.gesture = null;
        return;
      }
    }
    if (this.gesture) {
      if (this.pointers.size < 2) this.gesture = null;
      return;
    }
    if (this.panning) {
      this.panning = null;
      this.canvas.style.cursor = '';
      this.app.updateCursor && this.app.updateCursor();
      return;
    }
    if (this.longPressed) { this.longPressed = false; this.toolActive = false; return; }
    if (this.toolActive) {
      this.toolActive = false;
      const tool = this.app.tool;
      if (cancelled) { tool.cancel && tool.cancel(); }
      else if (tool.up) tool.up(this.ptFrom(e), e);
    }
    if (this._eraserFrom && e.pointerType === 'pen') { const back = this._eraserFrom; this._eraserFrom = null; setTimeout(() => this.app.selectTool(back), 0); }
    // double-tap (touch)
    if (!cancelled && p && e.pointerType === 'touch' && Math.hypot(p.x - p.sx, p.y - p.sy) < 10 && performance.now() - p.t < 300) {
      const now = performance.now();
      if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30) {
        this.lastTap = null;
        this.app.onDoubleTap(this.screenToDoc(e.clientX, e.clientY), e);
      } else this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  }

  onWheel(e) {
    if (!this.doc) return;
    e.preventDefault();
    const p = this.clientToLocal(e.clientX, e.clientY);
    if (this.rDown) { this.rotateBy((e.deltaY > 0 ? 1 : -1) * 5); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
      this.setZoom(this.zoom * factor, p.x, p.y);
    } else {
      const k = e.deltaMode === 1 ? 20 : 1;
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k, dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      const c = Math.cos(-this.rotation), s = Math.sin(-this.rotation);
      this.panX -= dx * c - dy * s;
      this.panY -= dx * s + dy * c;
      this.changed();
    }
  }

  destroy() { clearInterval(this.antsTimer); }
}
