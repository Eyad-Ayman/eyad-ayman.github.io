// EYAD VECTOR — tools. Each tool edits the document through app.change()
// (or begin/end for drags) so every action is a single undo step.
import { h, clamp } from '../core/dom.js';
import { toast } from '../core/ui.js';
import {
  makePath, rectPath, ellipsePath, polygonPath, starPath, arcPath, pt, bounds, unionBounds, segments, splitCubic,
  nearestOnPath, transformNode, translate, scaleAbout, rotateAbout, textBox, apply, I, find, cloneNode,
} from './model.js';
import { fitCurve, brushOutline } from './pathops.js';
import { uid } from '../core/dom.js';

export const TOOL_DEFAULTS = {
  select: {}, direct: {}, pen: {}, pencil: { fidelity: 3 }, brush: { size: 14, taper: true },
  rect: { radius: 0 }, ellipse: {}, polygon: { sides: 6 }, star: { points: 5, inner: 45 }, line: {}, arc: {},
  text: {}, gradient: { kind: 'linear' }, eyedropper: {}, hand: {}, zoom: {}, artboard: {},
};

// ------------------------------------------------------------------ option controls
function optNum(app, tool, key, label, min, max, step = 1, unit = '') {
  const o = app.opt(tool);
  const input = h('input', { class: 'studio-input is-num img-opt-num', type: 'number', min, max, step, value: o[key], 'aria-label': label });
  input.addEventListener('change', () => { o[key] = clamp(Number(input.value) || 0, min, max); input.value = o[key]; app.saveOpts(); });
  return h('label', { class: 'img-opt' }, h('span', { class: 'img-opt-label', text: label }), input, unit ? h('span', { class: 'studio-faint', text: unit }) : null);
}
function optCheck(app, tool, key, label) {
  const o = app.opt(tool);
  const cb = h('input', { type: 'checkbox', checked: !!o[key] });
  cb.addEventListener('change', () => { o[key] = cb.checked; app.saveOpts(); });
  return h('label', { class: 'img-opt is-check' }, cb, h('span', { text: label }));
}
function optSelect(app, tool, key, label, items) {
  const o = app.opt(tool);
  const s = h('select', { class: 'studio-input img-opt-select' }, items.map(([v, l]) => h('option', { value: v, text: l, selected: o[key] === v })));
  s.addEventListener('change', () => { o[key] = s.value; app.saveOpts(); });
  return h('label', { class: 'img-opt' }, h('span', { class: 'img-opt-label', text: label }), s);
}
const note = (t) => h('span', { class: 'img-opt studio-faint', text: t });

const dist = (app, a, b) => Math.hypot((a.x - b.x) * app.view.zoom, (a.y - b.y) * app.view.zoom);
const snap45 = (o, p) => { const dx = p.x - o.x, dy = p.y - o.y, a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(dx, dy); return { x: o.x + Math.cos(a) * l, y: o.y + Math.sin(a) * l }; };

// ================================================================= Selection (V)

const HANDLES = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const selectTool = {
  id: 'select', label: 'Selection', icon: 'cursor', key: 'V', cursor: 'default',
  hint: 'Click or drag a box to select · drag to move (Alt duplicates) · handles scale · knob rotates · double-click edits',
<<<<<<< HEAD
  options(app) { return [note('Align & Shape Builder are in the right panel'), h('button', { class: 'studio-btn is-small', type: 'button', text: 'Group', onclick: () => app.cmd('group') }), h('button', { class: 'studio-btn is-small', type: 'button', text: 'Ungroup', onclick: () => app.cmd('ungroup') })]; },
=======
  options(app) { return [note('Align & Pathfinder are in the right panel'), h('button', { class: 'studio-btn is-small', type: 'button', text: 'Group', onclick: () => app.cmd('group') }), h('button', { class: 'studio-btn is-small', type: 'button', text: 'Ungroup', onclick: () => app.cmd('ungroup') })]; },
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  handleAt(app, p) {
    const b = app.selBounds(); if (!b) return null;
    const s0 = app.view.toScreen(b.x, b.y), s1 = app.view.toScreen(b.x + b.w, b.y + b.h);
    const W = s1.x - s0.x, H = s1.y - s0.y;
    for (let i = 0; i < HANDLES.length; i++) { const [fx, fy] = HANDLES[i]; if (Math.hypot(p.sx - (s0.x + W * fx), p.sy - (s0.y + H * fy)) < 9) return { kind: 'scale', i, fx, fy }; }
    if (Math.hypot(p.sx - (s0.x + W / 2), p.sy - (s0.y - 26)) < 10) return { kind: 'rotate' };
    return null;
  },
  down(p, e) {
    const app = this.app;
    const hd = app.sel.size ? this.handleAt(app, p) : null;
    const b = app.selBounds();
    if (hd) { this.drag = { ...hd, start: p, bounds: b, snap: app.snapshotSel() }; app.begin(); return; }
    const hit = app.hit(e);
    if (hit) {
      if (p.shift) { app.sel.has(hit.id) ? app.sel.delete(hit.id) : app.sel.add(hit.id); app.selectionChanged(); return; }
      if (!app.sel.has(hit.id)) { app.sel = new Set([hit.id]); app.selectionChanged(); }
      app.begin();
      if (p.alt) { app.duplicateSelection({ inPlace: true, record: false }); }
      this.drag = { kind: 'move', start: p, bounds: app.selBounds(), snap: app.snapshotSel() };
      return;
    }
    if (!p.shift && app.sel.size) { app.sel = new Set(); app.selectionChanged(); }
    this.marquee = { a: p, b: p };
  },
  move(p) {
    const app = this.app, d = this.drag;
    if (this.marquee) { this.marquee.b = p; app.renderOverlay(); return; }
    if (!d) return;
    let m;
    if (d.kind === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (p.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const sn = app.snapMove(d.bounds, dx, dy); dx = sn.dx; dy = sn.dy; this.guides = sn.guides;
      m = translate(dx, dy);
    } else if (d.kind === 'rotate') {
      const c = { x: d.bounds.x + d.bounds.w / 2, y: d.bounds.y + d.bounds.h / 2 };
      let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(d.start.y - c.y, d.start.x - c.x);
      if (p.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      m = rotateAbout(a, c.x, c.y); this.angle = a;
    } else {
      const bb = d.bounds, ax = p.alt ? bb.x + bb.w / 2 : bb.x + bb.w * (1 - d.fx), ay = p.alt ? bb.y + bb.h / 2 : bb.y + bb.h * (1 - d.fy);
      const hx = bb.x + bb.w * d.fx, hy = bb.y + bb.h * d.fy;
      let sx = d.fx === 0.5 ? 1 : (p.x - ax) / ((hx - ax) || 1e-6), sy = d.fy === 0.5 ? 1 : (p.y - ay) / ((hy - ay) || 1e-6);
      if (p.shift && d.fx !== 0.5 && d.fy !== 0.5) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx) * s; sy = Math.sign(sy) * s; }
      if (Math.abs(sx) < 1e-3) sx = 1e-3; if (Math.abs(sy) < 1e-3) sy = 1e-3;
      m = scaleAbout(sx, sy, ax, ay);
    }
    app.restoreSel(d.snap, m);
    app.render();
  },
  up() {
    const app = this.app;
    if (this.marquee) {
      const { a, b } = this.marquee; this.marquee = null;
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      if (r.w * app.view.zoom > 3 || r.h * app.view.zoom > 3) {
        for (const n of app.doc.items) {
          if (n.hidden || n.locked) continue;
          const bb = bounds(n); if (!bb) continue;
          if (bb.x < r.x + r.w && bb.x + bb.w > r.x && bb.y < r.y + r.h && bb.y + bb.h > r.y) app.sel.add(n.id);
        }
        app.selectionChanged();
      }
      app.renderOverlay();
      return;
    }
    if (this.drag) { const k = this.drag.kind; this.drag = null; this.guides = null; app.end(k === 'move' ? 'Move' : k === 'rotate' ? 'Rotate' : 'Scale'); }
  },
  dbl(p, e) {
    const app = this.app, hit = app.hit(e, true);
    if (!hit) return;
    if (hit.type === 'text') app.editText(hit);
    else if (hit.type === 'path') { app.sel = new Set([hit.id]); app.setTool('direct'); }
  },
  overlay(app) {
    let s = '';
    if (this.marquee) { const a = app.view.toScreen(this.marquee.a.x, this.marquee.a.y), b = app.view.toScreen(this.marquee.b.x, this.marquee.b.y); s += `<rect class="vo-marquee" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}"/>`; }
    if (this.guides) for (const g of this.guides) { const a = app.view.toScreen(g[0], g[1]), b = app.view.toScreen(g[2], g[3]); s += `<line class="vo-smart" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`; }
    return s + app.selectionOverlay({ handles: true });
  },
};

// ================================================================= Direct selection (A)

const directTool = {
  id: 'direct', label: 'Direct Selection', icon: 'select', key: 'A', cursor: 'default',
  hint: 'Click anchors (Shift adds) · drag anchors or handles (Alt breaks the pair) · Delete removes anchors',
  options(app) { return [h('button', { class: 'studio-btn is-small', type: 'button', text: 'Corner', onclick: () => app.cmd('anchorCorner') }), h('button', { class: 'studio-btn is-small', type: 'button', text: 'Smooth', onclick: () => app.cmd('anchorSmooth') }), note('Pen tool adds/deletes anchors')]; },
  targets(app) { return app.selNodesDeep().filter((n) => n.type === 'path'); },
  handleHit(app, p) {
    for (const n of this.targets(app)) n.subpaths.forEach((sp, si) => sp.pts.forEach((q, pi) => {
      if (!app.anchorSel.has(`${n.id}:${si}:${pi}`) && !this.neighbourOfSel(app, n, si, pi)) return;
      for (const hk of ['hi', 'ho']) if (q[hk] && dist(app, { x: q[hk][0], y: q[hk][1] }, p) < 7) this._h = this._h || { n, si, pi, hk };
    }));
    const r = this._h; this._h = null; return r;
  },
  neighbourOfSel(app, n, si, pi) { const len = n.subpaths[si].pts.length; return app.anchorSel.has(`${n.id}:${si}:${(pi + 1) % len}`) || app.anchorSel.has(`${n.id}:${si}:${(pi - 1 + len) % len}`); },
  anchorHit(app, p) {
    let best = null;
    for (const n of this.targets(app)) n.subpaths.forEach((sp, si) => sp.pts.forEach((q, pi) => { const d = dist(app, q, p); if (d < 8 && (!best || d < best.d)) best = { n, si, pi, d }; }));
    return best;
  },
  down(p, e) {
    const app = this.app;
    const hh = this.handleHit(app, p);
    if (hh) { app.begin(); this.drag = { kind: 'handle', ...hh, start: p }; return; }
    const ah = this.anchorHit(app, p);
    if (ah) {
      const key = `${ah.n.id}:${ah.si}:${ah.pi}`;
      if (p.shift) { app.anchorSel.has(key) ? app.anchorSel.delete(key) : app.anchorSel.add(key); app.renderOverlay(); return; }
      if (!app.anchorSel.has(key)) app.anchorSel = new Set([key]);
      app.begin(); this.drag = { kind: 'anchors', start: p, last: p }; app.renderOverlay();
      return;
    }
    const hit = app.hit(e, true);
    if (hit && hit.type === 'path') {
      if (!app.sel.has(hit.id)) { app.sel = p.shift ? new Set([...app.sel, hit.id]) : new Set([hit.id]); app.anchorSel = new Set(); app.selectionChanged(); }
      // drag the whole path
      app.begin(); hit.subpaths.forEach((sp, si) => sp.pts.forEach((q, pi) => app.anchorSel.add(`${hit.id}:${si}:${pi}`)));
      this.drag = { kind: 'anchors', start: p, last: p, temp: true };
      return;
    }
    if (hit) { app.sel = new Set([hit.id]); app.selectionChanged(); return; }
    this.marquee = { a: p, b: p };
    if (!p.shift) { app.anchorSel = new Set(); }
  },
  move(p) {
    const app = this.app, d = this.drag;
    if (this.marquee) { this.marquee.b = p; app.renderOverlay(); return; }
    if (!d) return;
    if (d.kind === 'handle') {
      const q = d.n.subpaths[d.si].pts[d.pi];
      q[d.hk] = [p.x, p.y];
      const other = d.hk === 'hi' ? 'ho' : 'hi';
      if (q.smooth && !p.alt && q[other]) { const L = Math.hypot(q[other][0] - q.x, q[other][1] - q.y), a = Math.atan2(q.y - p.y, q.x - p.x); q[other] = [q.x + Math.cos(a) * L, q.y + Math.sin(a) * L]; }
      if (p.alt) q.smooth = false;
    } else {
      let dx = p.x - d.last.x, dy = p.y - d.last.y; d.last = p;
      for (const key of app.anchorSel) {
        const [id, si, pi] = key.split(':'); const f = find(app.doc, id); if (!f) continue;
        const q = f.node.subpaths[+si]?.pts[+pi]; if (!q) continue;
        q.x += dx; q.y += dy; if (q.hi) q.hi = [q.hi[0] + dx, q.hi[1] + dy]; if (q.ho) q.ho = [q.ho[0] + dx, q.ho[1] + dy];
      }
    }
    app.render();
  },
  up() {
    const app = this.app;
    if (this.marquee) {
      const { a, b } = this.marquee; this.marquee = null;
      const r = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
      let targets = this.targets(app);
      if (!targets.length) { targets = []; for (const n of app.doc.items) if (n.type === 'path' && !n.locked && !n.hidden) targets.push(n); }
      const hitIds = new Set();
      for (const n of targets) n.subpaths.forEach((sp, si) => sp.pts.forEach((q, pi) => { if (q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1) { app.anchorSel.add(`${n.id}:${si}:${pi}`); hitIds.add(n.id); } }));
      if (hitIds.size) { app.sel = new Set([...app.sel, ...hitIds]); app.selectionChanged(false); }
      app.renderOverlay(); return;
    }
    if (this.drag) { const t = this.drag.temp; this.drag = null; if (t) app.anchorSel = new Set(); app.end('Edit Path'); }
  },
  onKey(e) {
    const app = this.app;
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.anchorSel.size) { app.cmd('deleteAnchors'); return true; }
    return false;
  },
  overlay(app) {
    let s = '';
    for (const n of this.targets(app)) {
      s += `<path class="vo-path" d="${app.screenD(n)}"/>`;
      n.subpaths.forEach((sp, si) => sp.pts.forEach((q, pi) => {
        const key = `${n.id}:${si}:${pi}`, on = app.anchorSel.has(key), a = app.view.toScreen(q.x, q.y);
        if (on || this.neighbourOfSel(app, n, si, pi)) for (const hk of ['hi', 'ho']) if (q[hk]) { const hp = app.view.toScreen(q[hk][0], q[hk][1]); s += `<line class="vo-handle-line" x1="${a.x}" y1="${a.y}" x2="${hp.x}" y2="${hp.y}"/><circle class="vo-handle" cx="${hp.x}" cy="${hp.y}" r="3.5"/>`; }
        s += `<rect class="vo-anchor${on ? ' is-on' : ''}" x="${a.x - 3.5}" y="${a.y - 3.5}" width="7" height="7"/>`;
      }));
    }
    if (this.marquee) { const a = app.view.toScreen(this.marquee.a.x, this.marquee.a.y), b = app.view.toScreen(this.marquee.b.x, this.marquee.b.y); s += `<rect class="vo-marquee" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}"/>`; }
    return s;
  },
};

// ================================================================= Pen (P)

const penTool = {
  id: 'pen', label: 'Pen', icon: 'pen', key: 'P', cursor: 'crosshair',
  hint: 'Click for corners, drag for curves · click the first point to close · Enter/Esc finishes · on a selected path: click a segment to add, an anchor to delete, Alt-click to convert',
  options() { return [note('Shift snaps to 45°')]; },
  down(p) {
    const app = this.app;
    if (!this.draw) {
      // editing an existing selected path?
      for (const n of app.selNodesDeep().filter((x) => x.type === 'path')) {
        let hitA = null;
        n.subpaths.forEach((sp, si) => sp.pts.forEach((q, pi) => { if (!hitA && dist(app, q, p) < 7) hitA = { si, pi }; }));
        if (hitA) {
          const sp = n.subpaths[hitA.si];
          const isEnd = !sp.closed && (hitA.pi === 0 || hitA.pi === sp.pts.length - 1);
          if (p.alt) { app.change('Convert Anchor', () => { const q = sp.pts[hitA.pi]; if (q.hi || q.ho) { q.hi = q.ho = null; q.smooth = false; } else { const a = sp.pts[(hitA.pi - 1 + sp.pts.length) % sp.pts.length], b = sp.pts[(hitA.pi + 1) % sp.pts.length]; const dx = (b.x - a.x) / 6, dy = (b.y - a.y) / 6; q.hi = [q.x - dx, q.y - dy]; q.ho = [q.x + dx, q.y + dy]; q.smooth = true; } }); return; }
          if (isEnd) { // continue drawing from this end
            if (hitA.pi === 0) { sp.pts.reverse().forEach((q) => { const t = q.hi; q.hi = q.ho; q.ho = t; }); }
            app.begin(); this.draw = { node: n, si: hitA.si, existing: true }; return;
          }
          app.change('Delete Anchor', () => { sp.pts.splice(hitA.pi, 1); if (sp.pts.length < 2) n.subpaths.splice(hitA.si, 1); if (!n.subpaths.length) app.removeNode(n.id); });
          return;
        }
        const near = nearestOnPath(n, p.x, p.y);
        if (near && near.d * app.view.zoom < 6) {
          app.change('Add Anchor', () => {
            const sp = n.subpaths[near.sub], s = segments(sp).find((x) => x[8] === near.seg);
            const [l, r] = splitCubic(s, near.t);
            const A = sp.pts[near.seg], B = sp.pts[(near.seg + 1) % sp.pts.length];
            A.ho = [l[2], l[3]]; B.hi = [r[4], r[5]];
            const straight = l[2] === l[0] && l[3] === l[1] && r[4] === r[6] && r[5] === r[7];
            sp.pts.splice(near.seg + 1, 0, { x: l[6], y: l[7], hi: straight ? null : [l[4], l[5]], ho: straight ? null : [r[2], r[3]], smooth: !straight });
            if (straight) { A.ho = null; B.hi = null; }
          });
          return;
        }
      }
      // start a new path
      app.begin();
      const n = makePath([{ closed: false, pts: [pt(p.x, p.y)] }], app.newStyle(true), 'Path');
      app.addNode(n, { select: true, record: false });
      this.draw = { node: n, si: 0 };
      this.dragging = { i: 0, from: p };
      return;
    }
    const sp = this.draw.node.subpaths[this.draw.si];
    if (sp.pts.length >= 2 && dist(app, sp.pts[0], p) < 8) { sp.closed = true; this.dragging = { i: 0, from: sp.pts[0], closing: true }; app.render(); return; }
    let q = p;
    if (p.shift) q = snap45(sp.pts[sp.pts.length - 1], p);
    sp.pts.push(pt(q.x, q.y));
    this.dragging = { i: sp.pts.length - 1, from: q };
    app.render();
  },
  move(p) {
    const app = this.app;
    this.hoverPt = p;
    if (this.draw && this.dragging) {
      const sp = this.draw.node.subpaths[this.draw.si], q = sp.pts[this.dragging.i], f = this.dragging.from;
      if (dist(app, f, p) > 2) {
        const dx = p.x - q.x, dy = p.y - q.y;
        if (this.dragging.closing) { q.hi = [q.x - dx, q.y - dy]; if (!q.ho) q.ho = [q.x + dx, q.y + dy]; }
        else { q.ho = [q.x + dx, q.y + dy]; q.hi = [q.x - dx, q.y - dy]; }
        q.smooth = true;
        app.render();
      }
    }
    app.renderOverlay();
  },
  hover(p) { this.hoverPt = p; this.app.renderOverlay(); },
  up() {
    this.dragging = null;
    if (this.draw && this.draw.node.subpaths[this.draw.si].closed) this.finish();
  },
  finish() {
    const app = this.app, d = this.draw; this.draw = null; this.dragging = null;
    if (!d) return;
    const sp = d.node.subpaths[d.si];
    if (!d.existing && sp.pts.length < 2) { app.removeNode(d.node.id); app.cancelChange(); app.render(); return; }
    if (!sp.closed && !d.existing) { d.node.style.fill = null; if (!d.node.style.stroke) d.node.style.stroke = { kind: 'solid', color: app.defFill.color || '#111111', a: 1 }; }
    app.end(d.existing ? 'Extend Path' : 'Pen');
    app.render();
  },
  onKey(e) { if (this.draw && (e.key === 'Enter' || e.key === 'Escape')) { this.finish(); return true; } return false; },
  deactivate() { if (this.draw) this.finish(); },
  overlay(app) {
    let s = '';
    for (const n of app.selNodesDeep().filter((x) => x.type === 'path')) {
      s += `<path class="vo-path" d="${app.screenD(n)}"/>`;
      n.subpaths.forEach((sp) => sp.pts.forEach((q, i) => { const a = app.view.toScreen(q.x, q.y); s += `<rect class="vo-anchor${this.draw && i === sp.pts.length - 1 ? ' is-on' : ''}" x="${a.x - 3.5}" y="${a.y - 3.5}" width="7" height="7"/>`; for (const hk of ['hi', 'ho']) if (q[hk] && this.draw) { const hp = app.view.toScreen(q[hk][0], q[hk][1]); s += `<line class="vo-handle-line" x1="${a.x}" y1="${a.y}" x2="${hp.x}" y2="${hp.y}"/><circle class="vo-handle" cx="${hp.x}" cy="${hp.y}" r="3"/>`; } }));
    }
    if (this.draw && this.hoverPt && !this.dragging) {
      const sp = this.draw.node.subpaths[this.draw.si], last = sp.pts[sp.pts.length - 1];
      const a = app.view.toScreen(last.x, last.y), c = app.view.toScreen(last.ho ? last.ho[0] : last.x, last.ho ? last.ho[1] : last.y), b = app.view.toScreen(this.hoverPt.x, this.hoverPt.y);
      s += `<path class="vo-rubber" d="M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}"/>`;
      if (sp.pts.length >= 2 && dist(app, sp.pts[0], this.hoverPt) < 8) { const f = app.view.toScreen(sp.pts[0].x, sp.pts[0].y); s += `<circle class="vo-close" cx="${f.x}" cy="${f.y}" r="7"/>`; }
    }
    return s;
  },
};

// ================================================================= Pencil (N) & Brush (B)

function freehand(id, label, icon, key, kind) {
  return {
    id, label, icon, key, cursor: 'crosshair', wantsCoalesced: true,
    hint: kind === 'brush' ? 'Paint strokes — pen pressure controls width (Apple Pencil, Wacom, S Pen…)' : 'Draw freely; the line is smoothed into editable curves',
    options(app) { return kind === 'brush' ? [optNum(app, 'brush', 'size', 'Size', 1, 400, 1, 'px'), optCheck(app, 'brush', 'taper', 'Taper ends (mouse/touch)')] : [optNum(app, 'pencil', 'fidelity', 'Smoothness', 0.5, 20, 0.5)]; },
    down(p) { this.pts = [{ x: p.x, y: p.y, pressure: p.type === 'pen' ? p.pressure : 0.75, t: performance.now() }]; this.app.renderOverlay(); },
    move(p) { if (!this.pts) return; const l = this.pts[this.pts.length - 1]; if (dist(this.app, l, p) < 1.5) return; this.pts.push({ x: p.x, y: p.y, pressure: p.type === 'pen' ? p.pressure : 0.75 }); this.app.renderOverlay(); },
    async up(p) {
      const app = this.app, pts = this.pts; this.pts = null;
      if (!pts) return;
      if (kind === 'pencil') {
        if (pts.length < 2) { app.renderOverlay(); return; }
        const closed = pts.length > 8 && dist(app, pts[0], pts[pts.length - 1]) < 12;
        const sp = await fitCurve(pts, { tolerance: app.opt('pencil').fidelity / app.view.zoom * 1.2, closed });
        const st = app.newStyle(false); st.fill = closed ? st.fill : null; if (!st.stroke) st.stroke = { kind: 'solid', color: '#111111', a: 1 }; st.sw = st.sw || 2;
        app.addNode(makePath([sp], st, 'Pencil'), { select: true, label: 'Pencil' });
      } else {
        const o = app.opt('brush');
        if (o.taper && pts.every((q) => q.pressure === 0.75)) {
          const n = pts.length; pts.forEach((q, i) => { const t = Math.min(i, n - 1 - i) / Math.max(1, Math.min(8, n / 3)); q.pressure = 0.2 + 0.8 * Math.min(1, t); });
        }
        const sps = await brushOutline(pts, o.size / 1, 0.12);
        const color = app.defStroke?.color || app.defFill?.color || '#111111';
        app.addNode(makePath(sps, { fill: { kind: 'solid', color, a: 1 }, stroke: null, sw: 1, cap: 'round', join: 'round', dash: '', opacity: 1, blend: 'normal' }, 'Brush stroke'), { select: true, label: 'Brush' });
      }
      void p;
    },
    cancel() { this.pts = null; },
    overlay(app) {
      if (!this.pts) return '';
      const d = this.pts.map((q, i) => { const s = app.view.toScreen(q.x, q.y); return (i ? 'L' : 'M') + s.x + ' ' + s.y; }).join('');
      const w = kind === 'brush' ? app.opt('brush').size * app.view.zoom : 1.5;
      return `<path class="vo-ink" d="${d}" stroke-width="${w}"/>`;
    },
  };
}

// ================================================================= Shapes

function shapeTool(id, label, icon, key, build, opts) {
  return {
    id, label, icon, key, cursor: 'crosshair',
    hint: 'Drag to draw · Shift constrains · Alt draws from the centre · click for an exact size',
    options: opts || (() => [note('Shift = square / circle · Alt = from centre')]),
    down(p) { this.start = p; this.app.begin(); this.node = null; },
    move(p) {
      if (!this.start) return;
      const app = this.app, a = this.start;
      let x0 = a.x, y0 = a.y, w = p.x - a.x, hh = p.y - a.y;
      if (p.shift && id !== 'line') { const s = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * s; hh = Math.sign(hh || 1) * s; }
      if (p.alt) { x0 -= w; y0 -= hh; w *= 2; hh *= 2; }
      let q = p; if (id === 'line' && p.shift) q = snap45(a, p);
      const sps = id === 'line' ? [{ closed: false, pts: [pt(a.x, a.y), pt(q.x, q.y)] }] : build(app, x0, y0, w, hh);
      if (!this.node) { this.node = makePath(sps, app.newStyle(id !== 'line' && id !== 'arc'), label); if (id === 'line' || id === 'arc') { this.node.style.fill = null; if (!this.node.style.stroke) this.node.style.stroke = { kind: 'solid', color: '#111111', a: 1 }; } app.addNode(this.node, { select: true, record: false }); }
      else this.node.subpaths = sps;
      app.render();
    },
    up(p) {
      const app = this.app;
      if (!this.node) {
        const s = 100 / app.view.zoom * app.view.zoom; void s;
        const sps = id === 'line' ? [{ closed: false, pts: [pt(p.x, p.y), pt(p.x + 100, p.y)] }] : build(app, p.x - 50, p.y - 50, 100, 100);
        const n = makePath(sps, app.newStyle(id !== 'line' && id !== 'arc'), label);
        if (id === 'line' || id === 'arc') { n.style.fill = null; if (!n.style.stroke) n.style.stroke = { kind: 'solid', color: '#111111', a: 1 }; }
        app.addNode(n, { select: true, record: false });
      }
      this.start = null; this.node = null;
      app.end(label);
    },
  };
}
const rectTool = shapeTool('rect', 'Rectangle', 'rect', 'M', (app, x, y, w, hh) => rectPath(x, y, w, hh, app.opt('rect').radius), (app) => [optNum(app, 'rect', 'radius', 'Corner radius', 0, 5000, 1, 'px'), note('Shift = square · Alt = from centre')]);
const ellipseTool = shapeTool('ellipse', 'Ellipse', 'ellipse', 'L', (app, x, y, w, hh) => ellipsePath(x + w / 2, y + hh / 2, w / 2, hh / 2));
const polygonTool = shapeTool('polygon', 'Polygon', 'polygon', '', (app, x, y, w, hh) => { const r = Math.max(Math.abs(w), Math.abs(hh)) / 2; return polygonPath(x + w / 2, y + hh / 2, r, Math.max(3, app.opt('polygon').sides)); }, (app) => [optNum(app, 'polygon', 'sides', 'Sides', 3, 64)]);
const starTool = shapeTool('star', 'Star', 'star', '', (app, x, y, w, hh) => { const r = Math.max(Math.abs(w), Math.abs(hh)) / 2; return starPath(x + w / 2, y + hh / 2, r, Math.max(3, app.opt('star').points), app.opt('star').inner / 100); }, (app) => [optNum(app, 'star', 'points', 'Points', 3, 64), optNum(app, 'star', 'inner', 'Inner radius', 5, 95, 1, '%')]);
const lineTool = shapeTool('line', 'Line', 'line', '\\', () => []);
const arcTool = shapeTool('arc', 'Arc', 'loop', '', (app, x, y, w, hh) => arcPath(x, y, x + w, y + hh));

// ================================================================= Type (T)

const textTool = {
  id: 'text', label: 'Type', icon: 'text', key: 'T', cursor: 'text',
  hint: 'Click for point text · drag a box for area text (wraps) · click text to edit',
  options(app) { return [note('Font, size, tracking and leading are in Character')]; },
  down(p, e) {
    const app = this.app, hit = app.hit(e, true);
    if (hit && hit.type === 'text') { app.editText(hit); return; }
    this.start = p;
  },
  move(p) { if (this.start) { this.box = p; this.app.renderOverlay(); } },
  up(p) {
    const app = this.app; if (!this.start) return;
    const a = this.start; this.start = null;
    const area = this.box && dist(app, a, p) > 12; this.box = null;
    const ch = app.charDefaults;
    const n = { id: uid('n'), type: 'text', name: 'Text', hidden: false, locked: false, text: '', font: ch.font, size: ch.size, weight: ch.weight, italic: false, tracking: ch.tracking, leading: ch.leading, align: ch.align, width: area ? Math.abs(p.x - a.x) : 0, tf: [1, 0, 0, 1, area ? Math.min(a.x, p.x) : a.x, (area ? Math.min(a.y, p.y) : a.y) + (area ? ch.size * 0.85 : 0)], style: { fill: { kind: 'solid', color: app.defFill?.color || '#111111', a: 1 }, stroke: null, sw: 1, cap: 'round', join: 'round', dash: '', opacity: 1, blend: 'normal' } };
    app.editText(n, { isNew: true });
  },
  overlay(app) {
    if (!this.start || !this.box) return '';
    const a = app.view.toScreen(this.start.x, this.start.y), b = app.view.toScreen(this.box.x, this.box.y);
    return `<rect class="vo-marquee" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}"/>`;
  },
};

// ================================================================= Gradient (G)

const gradientTool = {
  id: 'gradient', label: 'Gradient', icon: 'gradient', key: 'G', cursor: 'crosshair',
  hint: 'Select shapes, then drag across them to set the gradient direction',
  options(app) { return [optSelect(app, 'gradient', 'kind', 'Type', [['linear', 'Linear'], ['radial', 'Radial']]), note('Edit stops in Appearance ▸ Fill')]; },
  down(p) { if (!this.app.sel.size) { toast('Select one or more shapes first.', { type: 'warn' }); return; } this.a = p; this.app.begin(); },
  move(p) {
    if (!this.a) return;
    const app = this.app, kind = app.opt('gradient').kind;
    for (const n of app.selNodesDeep()) {
      if (!n.style || n.type === 'image' || n.type === 'group') continue;
      const b = bounds(n); if (!b) continue;
      const f = (q) => [(q.x - b.x) / (b.w || 1), (q.y - b.y) / (b.h || 1)];
      const [x1, y1] = f(this.a), [x2, y2] = f(p);
      const prev = n.style.fill && n.style.fill.kind !== 'solid' && n.style.fill.stops ? n.style.fill.stops : [{ o: 0, color: n.style.fill?.color || app.defFill?.color || '#d02b2a', a: 1 }, { o: 1, color: '#111111', a: 1 }];
      n.style.fill = { kind, x1, y1, x2, y2, stops: prev };
    }
    app.render(); this.b = p; app.renderOverlay();
  },
  up() { if (this.a) { this.a = null; this.b = null; this.app.end('Gradient'); } },
  overlay(app) { if (!this.a || !this.b) return ''; const a = app.view.toScreen(this.a.x, this.a.y), b = app.view.toScreen(this.b.x, this.b.y); return `<line class="vo-grad" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><circle class="vo-handle" cx="${a.x}" cy="${a.y}" r="5"/><rect class="vo-anchor is-on" x="${b.x - 4}" y="${b.y - 4}" width="8" height="8"/>`; },
};

// ================================================================= Eyedropper, Hand, Zoom, Artboard

const eyedropperTool = {
  id: 'eyedropper', label: 'Eyedropper', icon: 'eyedropper', key: 'I', cursor: 'crosshair',
  hint: 'Click an object to copy its appearance to the selection (or to the defaults)',
  options() { return []; },
  down(p, e) {
    const app = this.app, src = app.hit(e, true);
    if (!src || !src.style) return;
    const st = JSON.parse(JSON.stringify(src.style));
    const targets = app.selNodesDeep().filter((n) => n.id !== src.id && n.style && n.type !== 'image');
    if (!targets.length) { app.defFill = st.fill && st.fill.kind === 'solid' ? st.fill : app.defFill; app.defStroke = st.stroke && st.stroke.kind === 'solid' ? st.stroke : app.defStroke; app.panels.refresh(); toast('Colours picked up as the new defaults', { timeout: 1400 }); return; }
    app.change('Eyedropper', () => { for (const n of targets) n.style = n.type === 'group' ? n.style : { ...JSON.parse(JSON.stringify(st)) }; });
  },
};
const handTool = { id: 'hand', label: 'Hand', icon: 'hand', key: 'H', cursor: 'grab', hint: 'Drag to pan · Space temporarily switches to Hand', options: () => [], pan: true };
const zoomTool = {
  id: 'zoom', label: 'Zoom', icon: 'zoom', key: 'Z', cursor: 'zoom-in', hint: 'Click to zoom in · Alt-click to zoom out',
  options: () => [],
  down(p) { const app = this.app; app.view.zoomAt(p.alt ? 1 / 1.6 : 1.6, p.sx, p.sy); },
};
const artboardTool = {
  id: 'artboard', label: 'Artboard', icon: 'artboard', key: 'Shift+O', cursor: 'crosshair',
  hint: 'Drag to create an artboard · drag an artboard to move it · click to make it active',
  options(app) { return [h('button', { class: 'studio-btn is-small', type: 'button', text: 'Artboards panel', onclick: () => app.panels.focus('artboards') })]; },
  down(p) {
    const app = this.app;
    const ab = [...app.doc.artboards].reverse().find((a) => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h);
    app.begin();
    if (ab) { app.activeAB = ab.id; this.drag = { ab, start: p, x: ab.x, y: ab.y }; }
    else { this.create = { a: p, ab: null }; }
    app.render();
  },
  move(p) {
    const app = this.app;
    if (this.drag) { this.drag.ab.x = Math.round(this.drag.x + p.x - this.drag.start.x); this.drag.ab.y = Math.round(this.drag.y + p.y - this.drag.start.y); app.render(); }
    if (this.create) {
      const a = this.create.a;
      if (!this.create.ab && dist(app, a, p) > 6) { this.create.ab = { id: uid('ab'), name: 'Artboard ' + (app.doc.artboards.length + 1), x: 0, y: 0, w: 1, h: 1, bg: '#ffffff' }; app.doc.artboards.push(this.create.ab); app.activeAB = this.create.ab.id; }
      if (this.create.ab) Object.assign(this.create.ab, { x: Math.round(Math.min(a.x, p.x)), y: Math.round(Math.min(a.y, p.y)), w: Math.max(1, Math.round(Math.abs(p.x - a.x))), h: Math.max(1, Math.round(Math.abs(p.y - a.y))) });
      app.render();
    }
  },
  up() {
    const app = this.app;
    const moved = this.drag && (this.drag.ab.x !== this.drag.x || this.drag.ab.y !== this.drag.y);
    const created = this.create && this.create.ab;
    this.drag = null; this.create = null;
    if (moved || created) app.end(created ? 'New Artboard' : 'Move Artboard'); else app.cancelChange();
    app.panels.refresh();
  },
};

export function createTools() {
  return [selectTool, directTool, penTool, freehand('pencil', 'Pencil', 'pencil', 'N', 'pencil'), freehand('brush', 'Brush', 'brush', 'B', 'brush'),
    rectTool, ellipseTool, polygonTool, starTool, lineTool, arcTool, textTool, gradientTool, eyedropperTool, artboardTool, handTool, zoomTool];
}
void textBox; void apply; void I; void unionBounds; void cloneNode; void transformNode;
