// EYAD 3D — keyboard-driven modal transform: G / R / S start a move, rotate
// or scale that follows the pointer; X / Y / Z constrain to an axis (press
// again for the object's own axis, Shift+axis for the plane), digits type an
// exact value, Ctrl snaps, Enter / click confirms, Esc / right-click cancels.
import * as THREE from '../../vendor/three/three.module.js';
import { h } from '../core/dom.js';

const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const LABEL = { move: 'Move', rotate: 'Rotate', scale: 'Scale' };
const HINT = 'X / Y / Z axis (again: local) · Shift+X / Y / Z plane · type a value · hold Ctrl to snap · Enter or click to confirm · Esc or right-click to cancel';

export class ModalTransform {
  constructor(app) {
    this.app = app;
    this.active = null;
    this.mouse = null;
    this.el = h('div', { class: 't3-modal', hidden: true, role: 'status', 'aria-live': 'polite' });
    this.text = h('span', { class: 't3-modal-text studio-mono' });
    this.okBtn = h('button', { class: 'studio-btn is-small is-primary', type: 'button', text: 'Confirm', onclick: (e) => { e.stopPropagation(); this.confirm(); } });
    this.noBtn = h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'Cancel', onclick: (e) => { e.stopPropagation(); this.cancel(); } });
    // a real number field for touch (and anyone who prefers typing into a box)
    this.num = h('input', { class: 'studio-input t3-modal-num', type: 'text', inputMode: 'decimal', autocomplete: 'off', 'aria-label': 'Exact value', placeholder: 'Value' });
    this.num.addEventListener('input', () => { const a = this.active; if (!a) return; a.typed = this.num.value.replace(',', '.').replace(/[^0-9.\-]/g, '').slice(0, 12); this.apply(); });
    this.num.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.confirm(); } else if (e.key === 'Escape') { e.preventDefault(); this.cancel(); } });
    this.el.append(this.text, this.num, this.okBtn, this.noBtn);
    app.stage.appendChild(this.el);
    addEventListener('pointermove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; if (this.active) this.onMove(e); }, true);
    addEventListener('pointerdown', (e) => this.onDown(e), true);
    addEventListener('pointerup', (e) => this.onUp(e), true);
    addEventListener('contextmenu', (e) => { if (this.active) { e.preventDefault(); e.stopPropagation(); } }, true);
    addEventListener('keydown', (e) => { if (e.target === this.num) return; this.onKey(e); }, true);
    addEventListener('keyup', (e) => { if (this.active && e.key === 'Control') { this.active.snap = false; this.apply(); } }, true);
    addEventListener('blur', () => { if (this.active) this.cancel(); });
  }

  get busy() { return !!this.active; }

  /** Constrain the running transform to an axis (same axis again switches it off). */
  setAxis(letter) {
    const a = this.active; if (!a) return;
    if (a.axis === letter && !a.plane) { a.axis = null; a.local = false; } else { a.axis = letter; a.plane = false; a.local = false; }
    this.apply();
  }
  focusValue() { if (this.active) { this.num.focus(); this.num.select(); } }

  start(kind, { axis = null } = {}) {
    const app = this.app, o = app.selected, v = app.viewport;
    if (this.active) this.cancel();
    if (!o) return false;
    if (v.gizmo.dragging) return false;
    if (app.playing) app.togglePlay(false);
    if (kind === 'scale' && o.isLight) kind = 'move';
    o.updateWorldMatrix(true, false);
    const pivot = o.getWorldPosition(new THREE.Vector3());
    const r = v.canvas.getBoundingClientRect();
    const pv = pivot.clone().project(v.camera);
    const center = { x: r.left + (pv.x * 0.5 + 0.5) * r.width, y: r.top + (-pv.y * 0.5 + 0.5) * r.height };
    let m = this.mouse;
    if (!m || m.x < r.left || m.x > r.right || m.y < r.top || m.y > r.bottom) m = { x: center.x + 90, y: center.y - 40 };
    app.beginTransform(o);
    app.groupBegin(o);
    this.num.value = '';
    this.active = {
      kind, o, pivot, center, start: { ...m }, cur: { ...m }, axis, plane: false, local: false, typed: '', snap: false, value: 0,
      t0: app.trOf(o), wq0: o.getWorldQuaternion(new THREE.Quaternion()), lastAngle: Math.atan2(m.y - center.y, m.x - center.x), angle: 0,
    };
    v.gizmo.enabled = false;
    this.el.hidden = false;
    app.root.classList.add('is-modal');
    v.setMoving?.(true); v.setMoving?.(false);
    this.apply();
    return true;
  }

  // ---------------------------------------------------------------- events
  onDown(e) {
    const a = this.active; if (!a) return;
    if (this.el.contains(e.target) || e.target.closest?.('.t3-tbar')) return;
    if (document.activeElement === this.num) this.num.blur();
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      // touch: drag to transform, lift to confirm
      a.touch = e.pointerId;
      this.rebase(e);
      return;
    }
    if (e.button === 0) this.confirm(); else this.cancel();
  }
  onUp(e) {
    const a = this.active; if (!a) return;
    if (a.touch !== undefined && e.pointerId === a.touch) { e.stopPropagation(); if (a.moved) this.confirm(); else a.touch = undefined; }
  }
  /** Start measuring from here while keeping what has been applied so far. */
  rebase(e) {
    const a = this.active;
    a.start = { x: e.clientX - (a.cur.x - a.start.x), y: e.clientY - (a.cur.y - a.start.y) };
    a.cur = { x: e.clientX, y: e.clientY };
    a.lastAngle = Math.atan2(a.cur.y - a.center.y, a.cur.x - a.center.x);
  }
  onMove(e) {
    const a = this.active;
    if (a.touch !== undefined && e.pointerId !== a.touch) return;
    a.cur = { x: e.clientX, y: e.clientY };
    if (a.touch !== undefined) a.moved = true;
    a.snap = !!e.ctrlKey || (a.touch !== undefined && !!this.app.settings.snap.on);
    if (a.kind === 'rotate') {
      const ang = Math.atan2(a.cur.y - a.center.y, a.cur.x - a.center.x);
      let d = ang - a.lastAngle;
      if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
      a.angle += d; a.lastAngle = ang;
    }
    this.apply();
  }
  onKey(e) {
    const a = this.active; if (!a) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    const k = e.key;
    if (k === 'Escape') { stop(); this.cancel(); return; }
    if (k === 'Enter' || k === ' ') { stop(); this.confirm(); return; }
    if (k === 'Control') { a.snap = true; this.apply(); return; }
    const code = e.code || '';
    const letter = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : (k.length === 1 ? k.toLowerCase() : '');
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (letter === 'x' || letter === 'y' || letter === 'z')) {
      stop();
      const plane = e.shiftKey;
      if (a.axis === letter && a.plane === plane) { if (!a.local) a.local = true; else { a.axis = null; a.local = false; a.plane = false; } }
      else { a.axis = letter; a.plane = plane; a.local = false; }
      this.apply(); return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (letter === 'g' || letter === 'r' || letter === 's')) {
      stop();
      const kind = { g: 'move', r: 'rotate', s: 'scale' }[letter];
      if (kind !== a.kind) { const m = a.cur; this.cancel(); this.mouse = m; this.start(kind); }
      return;
    }
    const digit = /^(Digit|Numpad)\d$/.test(code) ? code.slice(-1) : (/^\d$/.test(k) ? k : '');
    if (digit && !e.ctrlKey && !e.metaKey) { stop(); a.typed += digit; this.apply(); return; }
    if ((k === '.' || k === ',' || code === 'NumpadDecimal') && !a.typed.includes('.')) { stop(); a.typed += '.'; this.apply(); return; }
    if (k === '-' || code === 'NumpadSubtract') { stop(); a.typed = a.typed.startsWith('-') ? a.typed.slice(1) : '-' + a.typed; this.apply(); return; }
    if (k === 'Backspace') { stop(); a.typed = a.typed.slice(0, -1); this.apply(); return; }
    // swallow everything else so other shortcuts do not fire mid-transform
    if (!['Shift', 'Alt', 'Meta', 'Tab'].includes(k)) stop();
  }

  // ---------------------------------------------------------------- maths
  ray(pt) {
    const v = this.app.viewport, r = v.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((pt.x - r.left) / r.width) * 2 - 1, -((pt.y - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, v.camera);
    return rc.ray;
  }
  axisVec(name) {
    const a = this.active, v = AX[name].clone();
    return a.local ? v.applyQuaternion(a.wq0).normalize() : v;
  }
  onPlane(pt, normal) {
    const a = this.active;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, a.pivot);
    const out = new THREE.Vector3();
    const ray = this.ray(pt);
    if (!ray.intersectPlane(plane, out)) {
      // the ray is (nearly) parallel or points away: use the closest point of a far sample
      ray.at(1e4, out); plane.projectPoint(out, out);
    }
    return out;
  }
  /** Parameter along an axis line through the pivot that is closest to the pointer ray. */
  alongAxis(pt, axis) {
    const a = this.active, ray = this.ray(pt);
    const w = new THREE.Vector3().subVectors(a.pivot, ray.origin);
    const b = axis.dot(ray.direction), d = axis.dot(w), e = ray.direction.dot(w);
    const den = 1 - b * b;
    if (Math.abs(den) < 1e-5) return 0;
    return (b * e - d) / den;
  }
  typedValue() {
    const a = this.active;
    if (!a.typed || a.typed === '-' || a.typed === '.' || a.typed === '-.') return null;
    const n = Number(a.typed);
    return Number.isFinite(n) ? n : null;
  }

  apply() {
    const a = this.active; if (!a) return;
    const app = this.app, v = app.viewport, o = a.o, st = app.settings.snap;
    const typed = this.typedValue();
    const camDir = v.camera.getWorldDirection(new THREE.Vector3());
    app.setTr(o, a.t0);
    let read = '';
    const f = (n, d = 3) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d).replace(/\.?0+$/, '') || '0';
    const axName = a.axis ? (a.plane ? { x: 'YZ', y: 'XZ', z: 'XY' }[a.axis] : a.axis.toUpperCase()) + (a.local ? ' local' : '') : '';
    if (a.kind === 'move') {
      const delta = new THREE.Vector3();
      const sn = (n) => (a.snap ? Math.round(n / st.move) * st.move : n);
      if (a.axis && !a.plane) {
        const ax = this.axisVec(a.axis);
        const val = typed != null ? typed : sn(this.alongAxis(a.cur, ax) - this.alongAxis(a.start, ax));
        delta.copy(ax).multiplyScalar(val);
        a.value = val;
        read = `Move ${axName}: ${f(val)} m`;
      } else if (a.axis && a.plane) {
        const n = this.axisVec(a.axis);
        delta.subVectors(this.onPlane(a.cur, n), this.onPlane(a.start, n));
        if (typed != null) { const others = ['x', 'y', 'z'].filter((k) => k !== a.axis); delta.copy(this.axisVec(others[0])).multiplyScalar(typed); }
        else if (a.snap) delta.set(sn(delta.x), sn(delta.y), sn(delta.z));
        read = `Move ${axName}: ${f(delta.x)}, ${f(delta.y)}, ${f(delta.z)} m`;
      } else {
        if (typed != null) delta.set(typed, 0, 0);
        else { delta.subVectors(this.onPlane(a.cur, camDir), this.onPlane(a.start, camDir)); if (a.snap) delta.set(sn(delta.x), sn(delta.y), sn(delta.z)); }
        read = `Move: ${f(delta.x)}, ${f(delta.y)}, ${f(delta.z)} m`;
      }
      const wp = a.pivot.clone().add(delta);
      o.parent.updateWorldMatrix(true, false);
      o.position.copy(o.parent.worldToLocal(wp));
    } else if (a.kind === 'rotate') {
      const axis = a.axis ? this.axisVec(a.axis) : camDir.clone().negate();
      // screen angles grow clockwise (y is down); turn that into a right-handed angle about the axis
      const facing = axis.dot(camDir) < 0 ? 1 : -1;
      let ang = -a.angle * facing;
      if (typed != null) ang = THREE.MathUtils.degToRad(typed);
      else if (a.snap) { const s = THREE.MathUtils.degToRad(st.rotate || 15); ang = Math.round(ang / s) * s; }
      a.value = THREE.MathUtils.radToDeg(ang);
      const dq = new THREE.Quaternion().setFromAxisAngle(axis, ang);
      const wq = dq.multiply(a.wq0);
      const pq = o.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      o.quaternion.copy(pq.multiply(wq)).normalize();
      read = `Rotate${axName ? ' ' + axName : ''}: ${f(a.value, 1)}°`;
    } else {
      const d0 = Math.max(8, Math.hypot(a.start.x - a.center.x, a.start.y - a.center.y));
      let k = Math.hypot(a.cur.x - a.center.x, a.cur.y - a.center.y) / d0;
      if (typed != null) k = typed;
      else if (a.snap) k = Math.max(st.scale, Math.round(k / st.scale) * st.scale);
      if (!Number.isFinite(k)) k = 1;
      if (Math.abs(k) < 1e-4) k = 1e-4;
      a.value = k;
      const s = a.t0.s.clone();
      if (!a.axis) s.multiplyScalar(k);
      else for (const n of ['x', 'y', 'z']) if (a.plane ? n !== a.axis : n === a.axis) s[n] *= k;
      o.scale.copy(s);
      read = `Scale${axName ? ' ' + axName.replace(' local', '') : ''}: ${f(k)}`;
    }
    if (a.typed) read += `   [${a.typed}]`;
    if (a.snap && typed == null) read += '   snap';
    this.text.textContent = read;
    this.readout = read;
    if (document.activeElement !== this.num && this.num.value !== a.typed) this.num.value = a.typed;
    o.updateMatrixWorld(true);
    app.groupApply();
    app.onModalChange?.();
    v.invalidate();
    app.panels.syncTransform();
    app.setHint(HINT);
  }

  finish() {
    const app = this.app;
    this.active = null;
    this.el.hidden = true;
    app.root.classList.remove('is-modal');
    app.viewport.gizmo.enabled = true;
    if (document.activeElement === this.num) this.num.blur();
    app.setHint(null);
    app.onModalChange?.();
  }
  confirm() {
    const a = this.active; if (!a) return;
    this.finish();
    this.app.commitTransform(a.o, LABEL[a.kind]);
  }
  cancel() {
    const a = this.active; if (!a) return;
    this.app.setTr(a.o, a.t0);
    this.app.groupCancel();
    this.app.trBefore = null;
    this.finish();
    this.app.viewport.invalidate();
    this.app.panels.syncTransform();
  }
}
