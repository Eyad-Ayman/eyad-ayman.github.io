// EYAD 3D — navigation gizmo: a small axis ball in the corner of the
// viewport. Click an axis to look along it, drag the ball to orbit.
import * as THREE from '../../vendor/three/three.module.js';
import { h } from '../core/dom.js';

const AXES = [
  { n: 'X', v: [1, 0, 0], c: '#e5534b', view: 'right' }, { n: 'Y', v: [0, 1, 0], c: '#57b85f', view: 'top' }, { n: 'Z', v: [0, 0, 1], c: '#4d8ff0', view: 'front' },
  { n: '', v: [-1, 0, 0], c: '#e5534b', view: 'left' }, { n: '', v: [0, -1, 0], c: '#57b85f', view: 'bottom' }, { n: '', v: [0, 0, -1], c: '#4d8ff0', view: 'back' },
];
const SIZE = 92;

export class NavGizmo {
  constructor(app) {
    this.app = app;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas = h('canvas', { class: 't3-nav', width: SIZE * dpr, height: SIZE * dpr, role: 'img', 'aria-label': 'Navigation gizmo — click an axis to look along it, drag to orbit', title: 'Click an axis to look along it · drag to orbit' });
    this.canvas.style.width = SIZE + 'px'; this.canvas.style.height = SIZE + 'px';
    app.stage.appendChild(this.canvas);
    this.pts = [];
    this.hover = -1;
    this.bind();
  }
  bind() {
    const c = this.canvas, app = this.app;
    let drag = null;
    const local = (e) => { const r = c.getBoundingClientRect(); const k = SIZE / (r.width || SIZE); return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
    const hit = (p) => { let best = -1, bd = 13; for (const q of this.pts) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q.i; } } return best; };
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: false, at: hit(local(e)) };
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) { const hv = hit(local(e)); if (hv !== this.hover) { this.hover = hv; this.draw(); } return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      const v = app.viewport;
      if (!drag.moved && v.viewCam) v.exitCameraView({ keep: true });
      drag.moved = true; drag.x = e.clientX; drag.y = e.clientY;
      v.orbit._rotateLeft(dx * 0.012); v.orbit._rotateUp(dy * 0.012);
      v.orbit.update(); v.invalidate();
    });
    const up = (e) => {
      const d = drag; drag = null;
      if (!d) return;
      if (!d.moved && e.type === 'pointerup' && d.at >= 0) app.viewport.setView(AXES[d.at].view);
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (this.hover !== -1) { this.hover = -1; this.draw(); } });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  draw() {
    const cam = this.app.viewport?.camera; if (!cam) return;
    const g = this.canvas.getContext('2d'), d = this.dpr;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    const inv = _q.copy(cam.quaternion).invert();
    const R = SIZE / 2 - 14, cx = SIZE / 2, cy = SIZE / 2;
    const pts = AXES.map((a, i) => { _v.set(a.v[0], a.v[1], a.v[2]).applyQuaternion(inv); return { i, a, x: cx + _v.x * R, y: cy - _v.y * R, z: _v.z }; });
    pts.sort((p, q) => p.z - q.z);
    if (this.hover >= 0) { g.fillStyle = 'rgba(128,128,128,.22)'; g.beginPath(); g.arc(cx, cy, SIZE / 2 - 2, 0, Math.PI * 2); g.fill(); }
    for (const p of pts) {
      const pos = p.i < 3, hot = this.hover === p.i;
      if (pos) { g.strokeStyle = p.a.c; g.lineWidth = 2; g.globalAlpha = 0.55 + 0.45 * Math.max(0, (p.z + 1) / 2); g.beginPath(); g.moveTo(cx, cy); g.lineTo(p.x, p.y); g.stroke(); }
      g.globalAlpha = 0.6 + 0.4 * Math.max(0, (p.z + 1) / 2);
      g.beginPath(); g.arc(p.x, p.y, pos ? 9 : 7, 0, Math.PI * 2);
      if (pos || hot) { g.fillStyle = p.a.c; g.fill(); } else { g.fillStyle = 'rgba(30,30,32,.75)'; g.fill(); g.strokeStyle = p.a.c; g.lineWidth = 1.6; g.stroke(); }
      if (hot) { g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.stroke(); }
      if (pos) { g.globalAlpha = 1; g.fillStyle = '#111'; g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.a.n, p.x, p.y + 0.5); }
    }
    g.globalAlpha = 1;
    this.pts = pts;
  }
}
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
