// EYAD 3D — timeline strip: transport, scrubber with key diamonds for the
// selected object and the camera, key / auto-key / turntable controls.
import { h, clamp } from '../core/dom.js';
import { contextMenu } from '../core/ui.js';
import { icon } from './icons.js';
import { EASES } from './anim.js';

export class Timeline {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    host.classList.add('t3-timeline');
    const btn = (ic, label, fn, cls = '') => { const b = h('button', { class: 'studio-icon-btn t3-tl-btn ' + cls, type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(ic, 16)); return b; };
    this.playBtn = btn('play', 'Play (Space)', () => app.togglePlay(), 't3-tl-play');
    this.startBtn = btn('first', 'Go to start (Home)', () => app.setTime(0));
    this.timeEl = h('span', { class: 'studio-mono t3-tl-time' });
    this.track = h('div', { class: 't3-tl-track', role: 'slider', tabindex: '0', 'aria-label': 'Timeline', 'aria-valuemin': '0' });
    this.ruler = h('div', { class: 't3-tl-ruler' });
    this.rowObj = h('div', { class: 't3-tl-row is-obj' });
    this.rowCam = h('div', { class: 't3-tl-row is-cam' });
    this.head = h('div', { class: 't3-tl-head' });
    this.track.append(this.ruler, this.rowObj, this.rowCam, this.head);
    this.keyBtn = h('button', { class: 'studio-btn is-small t3-tl-key', type: 'button', title: 'Key the selected object at the playhead (K)', onclick: () => app.keySelected() }, icon('keyPlus', 14), h('span', { text: 'Key' }));
    this.camBtn = h('button', { class: 'studio-btn is-small t3-tl-key', type: 'button', title: 'Key the camera at the playhead (Shift+K)', onclick: () => app.keyCamera() }, icon('camera', 14), h('span', { text: 'Cam' }));
    this.autoBtn = h('button', { class: 'studio-btn is-small t3-tl-auto', type: 'button', title: 'Auto-key: moving a keyed object records a key at the playhead', onclick: () => app.setAutoKey(!app.autoKey) }, h('span', { class: 't3-rec-dot' }), h('span', { text: 'Auto' }));
    this.moreBtn = btn('dots', 'Animation options', (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.top - 8, app.animMenuItems()); });
    host.append(h('div', { class: 't3-tl-transport' }, this.startBtn, this.playBtn, this.timeEl), this.track, h('div', { class: 't3-tl-tools' }, this.keyBtn, this.camBtn, this.autoBtn, this.moreBtn));
    this.bindTrack();
    new ResizeObserver(() => this.update(true)).observe(this.track);
    this.update(true);
  }

  x2t(clientX) { const r = this.track.getBoundingClientRect(); return clamp((clientX - r.left) / Math.max(1, r.width), 0, 1) * this.app.anim.duration; }

  bindTrack() {
    const app = this.app;
    this.track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const dia = e.target.closest('.t3-dia');
      this.track.setPointerCapture(e.pointerId);
      if (app.playing) app.togglePlay(false);
      if (dia) {
        // drag a key to retime it
        const kind = dia.dataset.kind, idx = Number(dia.dataset.i);
        const keys = kind === 'cam' ? app.anim.camera : app.anim.tracks[app.selected?.userData.eyadId];
        if (!keys || !keys[idx]) return;
        const k = keys[idx];
        let moved = false;
        const x0 = e.clientX;
        app.animBegin();
        const move = (ev) => {
          if (Math.abs(ev.clientX - x0) > 3) moved = true;
          if (!moved) return;
          k.t = Math.round(this.x2t(ev.clientX) * 1000) / 1000;
          keys.sort((a, b) => a.t - b.t);
          app.setTime(k.t);
        };
        const up = () => {
          this.track.removeEventListener('pointermove', move); this.track.removeEventListener('pointerup', up); this.track.removeEventListener('pointercancel', up);
          if (moved) app.animEnd('Move key'); else { app.animCancel(); app.setTime(k.t); }
        };
        this.track.addEventListener('pointermove', move); this.track.addEventListener('pointerup', up); this.track.addEventListener('pointercancel', up);
        return;
      }
      app.setTime(this.x2t(e.clientX));
      const move = (ev) => app.setTime(this.x2t(ev.clientX));
      const up = () => { this.track.removeEventListener('pointermove', move); this.track.removeEventListener('pointerup', up); this.track.removeEventListener('pointercancel', up); };
      this.track.addEventListener('pointermove', move); this.track.addEventListener('pointerup', up); this.track.addEventListener('pointercancel', up);
    });
    this.track.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const dia = e.target.closest('.t3-dia');
      if (!dia) return;
      const kind = dia.dataset.kind, idx = Number(dia.dataset.i);
      const keysRef = () => (kind === 'cam' ? app.anim.camera : app.anim.tracks[app.selected?.userData.eyadId]);
      const k = keysRef()?.[idx]; if (!k) return;
      contextMenu(e.clientX, e.clientY, [
        { heading: `${kind === 'cam' ? 'Camera' : 'Object'} key · ${k.t.toFixed(2)} s` },
        ...EASES.map(([id, label]) => ({ label, checked: () => k.ease === id, action: () => app.animChange('Key easing', () => { k.ease = id; }) })),
        { separator: true },
        { label: 'Delete key', action: () => app.animChange('Delete key', () => { const ks = keysRef(); const i = ks.indexOf(k); if (i >= 0) ks.splice(i, 1); if (kind !== 'cam' && !ks.length) delete app.anim.tracks[app.selected.userData.eyadId]; }) },
      ]);
    });
    this.track.addEventListener('keydown', (e) => {
      const fps = app.fps;
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); app.setTime(app.time + (e.shiftKey ? 1 : 1 / fps)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); app.setTime(app.time - (e.shiftKey ? 1 : 1 / fps)); }
    });
  }

  diamonds(rowEl, keys, kind) {
    const d = this.app.anim.duration;
    const tol = 0.5 / this.app.fps;
    rowEl.replaceChildren(...(keys || []).map((k, i) => {
      const el = h('button', { class: 't3-dia' + (Math.abs(k.t - this.app.time) <= tol ? ' is-now' : ''), type: 'button', tabindex: '-1', title: `${k.t.toFixed(2)} s · ${EASES.find((e) => e[0] === k.ease)?.[1] || ''} — drag to retime, right-click for options`, dataset: { i: String(i), kind } });
      el.style.left = (clamp(k.t / d, 0, 1) * 100) + '%';
      return el;
    }));
  }

  update(full = false) {
    const app = this.app, a = app.anim;
    const t = app.time;
    this.timeEl.textContent = `${t.toFixed(2)} / ${a.duration.toFixed(2)} s`;
    this.head.style.left = (clamp(t / a.duration, 0, 1) * 100) + '%';
    this.track.setAttribute('aria-valuemax', String(a.duration));
    this.track.setAttribute('aria-valuenow', t.toFixed(2));
    this.playBtn.replaceChildren(icon(app.playing ? 'pause' : 'play', 16));
    this.playBtn.title = app.playing ? 'Pause (Space)' : 'Play (Space)';
    if (full || !app.playing) {
      this.diamonds(this.rowObj, app.selected ? a.tracks[app.selected.userData.eyadId] : null, 'obj');
      this.diamonds(this.rowCam, a.camera, 'cam');
      this.rowObj.dataset.label = app.selected ? app.selected.name : 'No selection';
      this.keyBtn.disabled = !app.selected;
      this.autoBtn.classList.toggle('is-on', app.autoKey);
      this.autoBtn.setAttribute('aria-pressed', String(app.autoKey));
      if (full) this.drawRuler();
    }
  }

  drawRuler() {
    const d = this.app.anim.duration;
    const w = this.track.getBoundingClientRect().width || 300;
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find((s) => (w / d) * s >= 46) || 60;
    const ticks = [];
    for (let s = 0; s <= d + 1e-6; s += step) {
      const el = h('span', { class: 't3-tick', text: (Math.round(s * 100) / 100) + 's' });
      el.style.left = (s / d) * 100 + '%';
      ticks.push(el);
    }
    this.ruler.replaceChildren(...ticks);
  }
}
