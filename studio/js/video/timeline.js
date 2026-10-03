// EYAD VIDEO — timeline: tracks, clips, ruler, playhead, markers,
// move / trim / razor / snapping / overwrite edits.
import { h, clear, timecode, clamp } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { contextMenu, toast, promptDialog, dialog } from '../core/ui.js';
import { TRANSITIONS } from './effects.js';
import { keyTimes } from './anim.js';
import { clipEnd, clipDur, srcTime, seqDuration, mediaById, trackById, linked, snapPoints, TICK } from './model.js';
import * as ops from './ops.js';

const HEADER_W = 132;

export class Timeline {
  constructor(app) {
    this.app = app;
    this.pps = 60; // pixels per second
    this.tool = 'select';
    this.snap = true;
    this.el = h('section', { class: 'vt', 'aria-label': 'Timeline' });
    this.toolbar = h('div', { class: 'vt-toolbar' });
    this.scroll = h('div', { class: 'vt-scroll' });
    this.content = h('div', { class: 'vt-content' });
    this.rulerRow = h('div', { class: 'vt-ruler-row' });
    this.corner = h('div', { class: 'vt-corner' });
    this.rulerWrap = h('div', { class: 'vt-ruler' });
    this.ruler = h('canvas', { class: 'vt-ruler-canvas' });
    this.rulerWrap.appendChild(this.ruler);
    this.rulerRow.append(this.corner, this.rulerWrap);
    this.tracksEl = h('div', { class: 'vt-tracks' });
    this.playhead = h('div', { class: 'vt-playhead' }, h('div', { class: 'vt-playhead-grab', title: 'Drag to scrub' }, h('div', { class: 'vt-playhead-head' })));
    this.clipEls = new Map(); this.lanes = new Map();
    this._hw = 0; this._sl = 0; this._cw = 0; this._colors = null;
    this.snapLine = h('div', { class: 'vt-snapline', hidden: true });
    this.inout = h('div', { class: 'vt-inout', hidden: true });
    this.content.append(this.rulerRow, this.tracksEl, this.inout, this.playhead, this.snapLine);
    this.scroll.appendChild(this.content);
    this.el.append(this.toolbar, this.scroll);
    this.buildToolbar();
    this.bind();
    new ResizeObserver(() => { this.measure(); if (this.seq) { this.refresh(); } }).observe(this.scroll);
  }

  /** Header-column width (cached: reading layout every frame is what makes scrubbing janky on phones). */
  get hw() { return this._hw || (this._hw = (this.corner && this.corner.offsetWidth) || HEADER_W); }
  measure() { this._hw = (this.corner && this.corner.offsetWidth) || HEADER_W; this._cw = this.scroll.clientWidth; this._sl = this.scroll.scrollLeft; this._rh = this.rulerWrap.clientHeight || 26; this._colors = null; }
  get seq() { return this.app.seq; }
  get sel() { return this.app.selection; }
  x(t) { return t * this.pps; }
  t(x) { return x / this.pps; }

  buildToolbar() {
    const app = this.app;
    this.toolBtns = {};
    const tb = (id, ic, label, key) => { const b = h('button', { class: 'studio-icon-btn is-small', type: 'button', title: `${label} (${key})`, 'aria-label': label, onclick: () => this.setTool(id) }, icon(ic, 15)); this.toolBtns[id] = b; return b; };
    this.snapBtn = h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Snapping', 'aria-label': 'Snapping', 'aria-pressed': 'true', onclick: () => { this.snap = !this.snap; this.snapBtn.setAttribute('aria-pressed', String(this.snap)); } }, icon('magnet', 15));
    this.zoomSlider = h('input', { class: 'studio-range vt-zoom', type: 'range', min: 0, max: 1000, value: 400, 'aria-label': 'Timeline zoom' });
    this.zoomSlider.addEventListener('input', () => this.setPps(this.sliderToPps(Number(this.zoomSlider.value)), { anchor: 'playhead' }));
    this.tcEl = h('span', { class: 'vt-tc studio-mono' });
    const tbtn = (ic, label, title, fn, cls = '') => h('button', { class: 'studio-icon-btn is-small ' + cls, type: 'button', title, 'aria-label': label, onclick: fn }, icon(ic, 15));
    this.toolbar.append(
      h('span', { class: 'vt-title studio-label', text: 'Timeline' }),
      this.tcEl,
      h('div', { class: 'vt-tools' }, tb('select', 'cursor', 'Selection tool', 'V'), tb('razor', 'scissors', 'Razor tool', 'C'), this.snapBtn),
      h('div', { class: 'vt-tools vt-edit-tools' },
        tbtn('split', 'Split at playhead', 'Split at playhead (S)', () => ops.splitAtPlayhead(app)),
        tbtn('marker', 'Add marker', 'Add marker (M)', () => ops.addMarker(app), 'vt-marker-btn'),
        tbtn('trash', 'Delete selected clips', 'Delete (Del)', () => ops.deleteSelected(app))),
      h('span', { class: 'studio-spacer' }),
      h('button', { class: 'studio-btn is-small is-ghost vt-addtrack', type: 'button', title: 'Add a video track', onclick: () => ops.addTrack(app, 'video') }, icon('plus', 13), h('span', { text: 'Video track' })),
      h('button', { class: 'studio-btn is-small is-ghost vt-addtrack', type: 'button', title: 'Add an audio track', onclick: () => ops.addTrack(app, 'audio') }, icon('plus', 13), h('span', { text: 'Audio track' })),
      tbtn('plus', 'Add track', 'Add a track', (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.bottom + 4, [{ label: 'Add video track', action: () => ops.addTrack(app, 'video') }, { label: 'Add audio track', action: () => ops.addTrack(app, 'audio') }, { label: 'Add marker at playhead', action: () => ops.addMarker(app) }]); }, 'vt-addtrack-m'),
      h('div', { class: 'vt-zoomgrp' },
        tbtn('zoomOut', 'Zoom out', 'Zoom out (−)', () => this.zoomBy(1 / 1.5)),
        this.zoomSlider,
        tbtn('zoomIn', 'Zoom in', 'Zoom in (+)', () => this.zoomBy(1.5)),
        h('button', { class: 'studio-btn is-small is-ghost vt-fit', type: 'button', text: 'Fit', title: 'Zoom to fit the whole sequence (\\)', onclick: () => this.fit() })));
    this.setTool('select');
  }
  setTool(id) {
    this.tool = id;
    for (const [k, b] of Object.entries(this.toolBtns)) b.setAttribute('aria-pressed', String(k === id));
    this.el.dataset.tool = id;
  }

  sliderToPps(v) { return 2 * Math.pow(1000, v / 1000) * (v > 0 ? 1 : 1); } // 2 … 2000 px/s
  ppsToSlider(p) { return Math.round(Math.log(p / 2) / Math.log(1000) * 1000); }
  setPps(p, { anchor = 'playhead', clientX } = {}) {
    p = clamp(p, 2, 2000);
    const sc = this.scroll;
    let ax;
    if (anchor === 'mouse' && clientX != null) ax = Math.max(0, clientX - sc.getBoundingClientRect().left - this.hw);
    else ax = this.x(this.app.engine.time) - sc.scrollLeft;
    const tAt = (sc.scrollLeft + ax) / this.pps;
    this.pps = p;
    this.zoomSlider.value = this.ppsToSlider(p);
    this.refresh();
    sc.scrollLeft = Math.max(0, tAt * p - ax);
    this._sl = sc.scrollLeft;
    this.drawRuler();
    this.updatePlayhead();
  }
  zoomBy(k) { this.setPps(this.pps * k); }
  fit() {
    if (!this.seq) return;
    this.measure();
    const d = Math.max(this.app.mobile && this.app.mobile.matches ? 4 : 10, seqDuration(this.seq));
    const w = this.scroll.clientWidth - this.hw - 28;
    this.setPps(Math.max(2, w / d));
    this.scroll.scrollLeft = 0; this._sl = 0;
    this.drawRuler(); this.updatePlayhead();
  }

  // ------------------------------------------------------------ rendering
  refresh() {
    const s = this.seq; if (!s) return;
    if (!this._cw) this.measure();
    const dur = seqDuration(s);
    const width = Math.max(this._cw, this.hw + this.x(Math.max(dur, 10) + 30));
    this.content.style.width = width + 'px';
    this.laneW = width - this.hw;
    this.clipEls.clear(); this.lanes.clear();
    // long sequences: only build the clips near the visible range (rebuilt as you scroll)
    const many = s.clips.length > 150;
    const span = Math.max(600, this._cw);
    this._win = many ? { a: this._sl - span, b: this._sl + this._cw + span } : null;
    const byTrack = new Map();
    for (const c of s.clips) {
      if (this._win && !this.sel.has(c.id)) { const x0 = this.x(c.start), x1 = x0 + this.x(clipDur(c)); if (x1 < this._win.a || x0 > this._win.b) continue; }
      let l = byTrack.get(c.trackId); if (!l) byTrack.set(c.trackId, l = []); l.push(c);
    }
    const frag = document.createDocumentFragment();
    const vts = s.tracks.filter((t) => t.kind === 'video').slice().reverse();
    const ats = s.tracks.filter((t) => t.kind === 'audio');
    const used = new Set(s.clips.map((c) => c.trackId));
    for (const tr of vts) frag.appendChild(this.trackRow(tr, byTrack.get(tr.id) || [], used.has(tr.id)));
    frag.appendChild(h('div', { class: 'vt-divider' }));
    for (const tr of ats) frag.appendChild(this.trackRow(tr, byTrack.get(tr.id) || [], used.has(tr.id)));
    this.tracksEl.replaceChildren(frag);
    this.updatePlayhead();
    this.updateInOut();
    this.drawRuler();
  }

  trackRow(tr, clips, used) {
    const app = this.app, s = this.seq;
    const isV = tr.kind === 'video';
    const btn = (ic, label, on, fn, cls = '') => h('button', { class: 'vt-tbtn ' + cls, type: 'button', title: label, 'aria-label': label, 'aria-pressed': String(!!on), onclick: fn }, typeof ic === 'string' && ic.length <= 2 ? h('span', { text: ic }) : icon(ic, 13));
    const rename = async () => { const n = await promptDialog('Rename track', 'Name', tr.name); if (n) ops.updateTrack(app, tr, { name: n.slice(0, 40) }, 'Rename Track'); };
    const headMenu = (x, y) => contextMenu(x, y, [
      { heading: tr.name },
      isV ? { label: tr.hidden ? 'Show track' : 'Hide track', action: () => ops.updateTrack(app, tr, { hidden: !tr.hidden }, 'Toggle Track Output') } : { label: tr.mute ? 'Unmute track' : 'Mute track', action: () => ops.updateTrack(app, tr, { mute: !tr.mute }, 'Mute Track') },
      !isV ? { label: tr.solo ? 'Unsolo track' : 'Solo track', action: () => ops.updateTrack(app, tr, { solo: !tr.solo }, 'Solo Track') } : null,
      { label: tr.lock ? 'Unlock track' : 'Lock track', action: () => ops.updateTrack(app, tr, { lock: !tr.lock }, 'Lock Track') },
      { separator: true },
      { label: 'Rename…', action: rename },
      { label: `Add ${isV ? 'video' : 'audio'} track`, action: () => ops.addTrack(app, tr.kind) },
      { label: 'Delete track', action: () => ops.deleteTrack(app, tr), enabled: s.tracks.filter((t) => t.kind === tr.kind).length > 1 },
    ]);
    const head = h('div', { class: 'vt-thead', dataset: { track: tr.id } },
      h('button', { class: 'vt-tname', type: 'button', text: tr.name, title: 'Track options', onclick: (e) => { if (app.mobile && app.mobile.matches) { const r = e.currentTarget.getBoundingClientRect(); headMenu(r.right + 4, r.top); } else rename(); } }),
      h('div', { class: 'vt-tbtns' },
        isV ? btn(tr.hidden ? 'eyeOff' : 'eye', tr.hidden ? 'Show track' : 'Hide track', tr.hidden, () => ops.updateTrack(app, tr, { hidden: !tr.hidden }, 'Toggle Track Output')) : btn('M', 'Mute track', tr.mute, () => ops.updateTrack(app, tr, { mute: !tr.mute }, 'Mute Track'), 'is-mute'),
        !isV ? btn('S', 'Solo track', tr.solo, () => ops.updateTrack(app, tr, { solo: !tr.solo }, 'Solo Track'), 'is-solo is-extra') : null,
        btn(tr.lock ? 'lock' : 'unlock', tr.lock ? 'Unlock track' : 'Lock track', tr.lock, () => ops.updateTrack(app, tr, { lock: !tr.lock }, 'Lock Track'), tr.lock ? 'is-lock' : 'is-lock is-extra')));
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); headMenu(e.clientX, e.clientY); });
    const lane = h('div', { class: 'vt-lane' + (tr.lock ? ' is-locked' : ''), dataset: { track: tr.id, kind: tr.kind }, style: { width: this.laneW + 'px' } });
    this.lanes.set(tr.id, lane);
    for (const c of clips) lane.appendChild(this.clipEl(c, tr));
    for (const mk of s.markers) lane.appendChild(h('div', { class: 'vt-marker-line', style: { left: this.x(mk.time) + 'px', background: mk.color } }));
    return h('div', { class: 'vt-track is-' + tr.kind + (tr.hidden || tr.mute ? ' is-off' : '') + (used ? '' : ' is-empty'), dataset: { track: tr.id } }, head, lane);
  }

  clipEl(c, tr) {
    const app = this.app;
    const m = mediaById(app.project, c.mediaId);
    const offline = !c.gen && (!m || m.offline || !app.media.online(m.id));
    const selected = this.sel.has(c.id);
    const w = Math.max(2, this.x(clipDur(c)));
    const el = h('div', {
      class: 'vt-clip is-' + tr.kind + (selected ? ' is-selected' : '') + (offline ? ' is-offline' : '') + (c.enabled === false ? ' is-disabled' : '') + (m && m.kind === 'image' ? ' is-still' : '') + (c.gen ? ' is-gen is-gen-' + c.gen.type : ''),
      dataset: { clip: c.id }, style: { left: this.x(c.start) + 'px', width: w + 'px' },
      title: `${c.name}\n${timecode(c.start, this.seq.fps)} → ${timecode(clipEnd(c), this.seq.fps)}${c.speed !== 1 ? `\nSpeed ${Math.round(c.speed * 100)}%` : ''}${offline ? '\nMEDIA OFFLINE' : ''}`,
    });
    if (tr.kind === 'video' && m && m.thumb && !offline) {
      el.style.setProperty('--thumb', `url("${m.thumb}")`);
      el.classList.add('has-thumb');
    }
    if (tr.kind === 'audio' && m && m.peaks && !offline) el.appendChild(this.waveform(c, m, w));
    if (c.gen) el.style.setProperty('--gen', c.gen.type === 'color' ? c.gen.color : c.gen.type === 'shape' ? (c.gen.fill || c.gen.stroke) : '#6b4fc8');
    if (c.transIn) el.appendChild(h('div', { class: 'vt-trans is-in', title: 'Transition: ' + (TRANSITIONS[c.transIn.type]?.label || '') + ` (${c.transIn.dur.toFixed(2)} s)`, style: { width: Math.min(w, this.x(c.transIn.dur)) + 'px' } }));
    if (c.transOut) el.appendChild(h('div', { class: 'vt-trans is-out', title: 'Transition: ' + (TRANSITIONS[c.transOut.type]?.label || '') + ` (${c.transOut.dur.toFixed(2)} s)`, style: { width: Math.min(w, this.x(c.transOut.dur)) + 'px' } }));
    if (c.keys && selected) for (const kt of keyTimes(c)) { const kx = this.x(kt / 1); if (kx >= 0 && kx <= w) el.appendChild(h('div', { class: 'vt-key', style: { left: kx + 'px' }, title: 'Keyframe ' + kt.toFixed(2) + ' s' })); }
    if (c.fadeIn > 0) el.appendChild(h('div', { class: 'vt-fade is-in', style: { width: Math.min(w, this.x(c.fadeIn)) + 'px' } }));
    if (c.fadeOut > 0) el.appendChild(h('div', { class: 'vt-fade is-out', style: { width: Math.min(w, this.x(c.fadeOut)) + 'px' } }));
    el.append(
      h('div', { class: 'vt-clip-label' },
        c.linkId ? h('span', { class: 'vt-clip-link', title: 'Linked clip' }, icon('link', 10)) : null,
        c.effects && c.effects.some((e) => e.enabled) ? h('span', { class: 'vt-clip-fx', text: 'fx' }) : null,
        c.keys ? h('span', { class: 'vt-clip-fx is-key', text: '◆' }) : null,
        c.gen ? h('span', { class: 'vt-clip-fx', text: c.gen.type === 'color' ? 'matte' : c.gen.type === 'shape' ? 'shape' : c.gen.type === 'adjust' ? 'adjust' : 'T' }) : null,
        c.speed !== 1 ? h('span', { class: 'vt-clip-fx', text: Math.round(c.speed * 100) + '%' }) : null,
        h('span', { class: 'vt-clip-name', text: offline ? `${c.name} — OFFLINE` : c.name })),
      h('div', { class: 'vt-edge is-l', dataset: { edge: 'l' } }), h('div', { class: 'vt-edge is-r', dataset: { edge: 'r' } }));
    if (w < 40) el.classList.add('is-tiny');
    this.clipEls.set(c.id, el);
    return el;
  }

  waveform(c, m, w) {
    const cw = Math.min(2048, Math.max(1, Math.round(w)));
    const hh = 40;
    const cv = h('canvas', { class: 'vt-wave', width: cw, height: hh });
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,.55)';
    const peaks = m.peaks, pps = m.peaksPerSec || 100;
    const secPerPx = clipDur(c) / cw;
    for (let x = 0; x < cw; x++) {
      const s0 = c.in + x * secPerPx * c.speed, s1 = s0 + secPerPx * c.speed;
      let mx = 0;
      for (let i = Math.floor(s0 * pps), e = Math.max(i + 1, Math.ceil(s1 * pps)); i < e && i < peaks.length; i++) if (peaks[i] > mx) mx = peaks[i];
      const bh = Math.max(1, mx * (hh - 4));
      g.fillRect(x, (hh - bh) / 2, 1, bh);
    }
    cv.style.width = w + 'px';
    return cv;
  }

  updatePlayhead() {
    const t = this.app.engine.time, px = this.x(t);
    this.playhead.style.transform = `translateX(${this.hw + px}px)`;
    const off = px < this._sl - 1; // scrolled out to the left: don't draw over the track headers
    if (off !== this._phOff) { this._phOff = off; this.playhead.style.visibility = off ? 'hidden' : ''; }
    const tc = timecode(t, this.seq ? this.seq.fps : 30);
    if (tc !== this._tc) { this._tc = tc; this.tcEl.textContent = tc; }
  }
  updateInOut() {
    const s = this.seq;
    if (!s || (s.inPoint == null && s.outPoint == null)) { this.inout.hidden = true; return; }
    const a = s.inPoint ?? 0, b = s.outPoint ?? seqDuration(s);
    this.inout.hidden = false;
    this.inout.style.left = this.hw + this.x(a) + 'px';
    this.inout.style.width = Math.max(1, this.x(b - a)) + 'px';
  }
  /** keep the playhead visible while playing */
  follow() {
    const sc = this.scroll, px = this.x(this.app.engine.time);
    const vis = (this._cw || sc.clientWidth) - this.hw;
    if (px < this._sl || px > this._sl + vis - 40) { sc.scrollLeft = Math.max(0, px - vis * 0.15); this._sl = sc.scrollLeft; }
  }

  drawRuler() {
    const s = this.seq; if (!s) return;
    const sc = this.scroll;
    const W = Math.max(1, (this._cw || sc.clientWidth) - this.hw), H = this._rh || 26;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cv = this.ruler;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!this._colors) { const cs = getComputedStyle(this.el); this._colors = { dim: cs.getPropertyValue('--st-faint').trim() || '#777', text: cs.getPropertyValue('--st-dim').trim() || '#aaa', mono: cs.getPropertyValue('--st-mono') || 'monospace' }; }
    const { dim, text, mono } = this._colors;
    const fps = s.fps;
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    const step = steps.find((st) => st * this.pps >= 70) || 3600;
    const minor = step / (step >= 1 ? 5 : 2);
    const t0 = sc.scrollLeft / this.pps, t1 = t0 + W / this.pps;
    g.strokeStyle = dim; g.fillStyle = text; g.font = '10px ' + mono; g.lineWidth = 1;
    g.beginPath();
    for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
      const x = Math.round((t - t0) * this.pps) + 0.5;
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      g.moveTo(x, major ? H - 18 : H - 9); g.lineTo(x, H);
      if (major) g.fillText(step < 1 ? timecode(t, fps).slice(3) : timecode(t, fps).slice(0, 8), x + 3, H - 15);
    }
    g.stroke();
    // markers
    for (const mk of s.markers) {
      const x = (mk.time - t0) * this.pps;
      if (x < -8 || x > W + 8) continue;
      g.fillStyle = mk.color; g.beginPath(); g.moveTo(x - 5, H - 14); g.lineTo(x + 5, H - 14); g.lineTo(x + 5, H - 6); g.lineTo(x, H - 1); g.lineTo(x - 5, H - 6); g.closePath(); g.fill();
    }
  }

  // ------------------------------------------------------------ input
  bind() {
    const sc = this.scroll;
    let sraf = 0;
    sc.addEventListener('scroll', () => {
      this._sl = sc.scrollLeft;
      if (sraf) return;
      sraf = requestAnimationFrame(() => {
        sraf = 0;
        if (this._win && (this._sl < this._win.a + 200 || this._sl + this._cw > this._win.b - 200) && !this.op) this.refresh(); else { this.drawRuler(); this.updatePlayhead(); }
      });
    }, { passive: true });
    sc.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) { e.preventDefault(); this.setPps(this.pps * Math.exp(-e.deltaY * 0.003), { anchor: 'mouse', clientX: e.clientX }); }
    }, { passive: false });
    sc.addEventListener('pointerdown', (e) => this.onDown(e));
    sc.addEventListener('pointermove', (e) => this.onMove(e));
    sc.addEventListener('pointerup', (e) => this.onUp(e));
    sc.addEventListener('pointercancel', () => this.cancel());
    sc.addEventListener('lostpointercapture', () => { if (this.op && this.op.kind === 'scrub') this.op = null; });
    sc.addEventListener('contextmenu', (e) => {
      const cEl = e.target.closest('.vt-clip');
      if (!cEl) return;
      e.preventDefault();
      if (!this.sel.has(cEl.dataset.clip)) this.app.select([cEl.dataset.clip]);
      this.clipMenu(cEl.dataset.clip, e.clientX, e.clientY);
    });
    sc.addEventListener('dblclick', (e) => {
      const mk = this.markerAt(e);
      if (mk) this.editMarker(mk);
    });
    // media drop (from bin or from the OS)
    sc.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; this.dragHint(e); });
    sc.addEventListener('dragleave', () => this.clearDropHint());
    sc.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.clearDropHint();
      const fxType = e.dataTransfer.getData('application/x-eyad-effect'), trType = e.dataTransfer.getData('application/x-eyad-transition');
      if (fxType || trType) {
        const cEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.vt-clip');
        if (!cEl) { toast('Drop it onto a video clip.', { timeout: 1400 }); return; }
        this.app.select([cEl.dataset.clip]);
        if (fxType) ops.addEffect(this.app, fxType);
        else { const r = cEl.getBoundingClientRect(); ops.applyTransition(this.app, trType, { edge: e.clientX < r.left + r.width / 2 ? 'in' : 'out' }); }
        return;
      }
      const pos = this.posFromEvent(e);
      const id = e.dataTransfer.getData('application/x-eyad-media');
      if (id) ops.placeMedia(this.app, id, { time: pos.time, trackId: pos.trackId });
      else if (e.dataTransfer.files && e.dataTransfer.files.length) this.app.importFiles(Array.from(e.dataTransfer.files), { place: { time: pos.time, trackId: pos.trackId } });
    });
    // pinch zoom (touch): two fingers anywhere on the timeline
    this.touches = new Map();
    let praf = 0, ptarget = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    sc.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      e.preventDefault(); this.cancel();
      this.pinch = { d: dist(e.touches), pps: this.pps };
    }, { passive: false });
    sc.addEventListener('touchmove', (e) => {
      if (!this.pinch || e.touches.length < 2) return;
      e.preventDefault();
      ptarget = { pps: this.pinch.pps * dist(e.touches) / this.pinch.d, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 };
      if (!praf) praf = requestAnimationFrame(() => { praf = 0; if (ptarget) this.setPps(ptarget.pps, { anchor: 'mouse', clientX: ptarget.cx }); });
    }, { passive: false });
    const pend = (e) => { if (e.touches.length < 2) this.pinch = null; };
    sc.addEventListener('touchend', pend, { passive: true }); sc.addEventListener('touchcancel', pend, { passive: true });
  }

  posFromEvent(e) {
    const r = this.scroll.getBoundingClientRect();
    const x = e.clientX - r.left + this.scroll.scrollLeft - this.hw;
    const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest('.vt-lane, .vt-thead');
    return { time: Math.max(0, this.t(x)), trackId: lane ? lane.dataset.track : null, x };
  }
  dragHint(e) {
    const p = this.posFromEvent(e);
    this.clearDropHint();
    const lane = p.trackId && this.tracksEl.querySelector(`.vt-lane[data-track="${p.trackId}"]`);
    if (lane) lane.classList.add('is-drop');
    this.showSnap(p.time);
  }
  clearDropHint() { this.tracksEl.querySelectorAll('.is-drop').forEach((l) => l.classList.remove('is-drop')); this.snapLine.hidden = true; }
  showSnap(t) { this.snapLine.hidden = false; this.snapLine.style.transform = `translateX(${this.hw + this.x(t)}px)`; }

  markerAt(e) {
    if (!e.target.closest('.vt-ruler')) return null;
    const p = this.posFromEvent(e);
    return this.seq.markers.find((m) => Math.abs(this.x(m.time - p.time)) < 7) || null;
  }
  async editMarker(mk) {
    const app = this.app;
    const name = h('input', { class: 'studio-input', type: 'text', value: mk.name, maxLength: 200 });
    const col = h('input', { class: 'studio-color', type: 'color', value: mk.color });
    const v = await dialog({ title: 'Marker at ' + timecode(mk.time, this.seq.fps), body: h('div', { class: 'studio-form' }, h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Name' }), name), h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Colour' }), col)),
      buttons: [{ label: 'Delete', value: 'delete', danger: true }, { label: 'Cancel', value: null }, { label: 'Save', value: 'save', primary: true }] });
    if (v === 'delete') ops.edit(app, 'Delete Marker', (s) => { s.markers = s.markers.filter((m) => m.id !== mk.id); });
    else if (v === 'save') ops.edit(app, 'Edit Marker', (s) => { const m = s.markers.find((x) => x.id === mk.id); if (m) { m.name = name.value.slice(0, 200) || 'Marker'; m.color = col.value; } });
  }

  onDown(e) {
    const app = this.app, s = this.seq;
    if (e.button === 2) return;
    if (this.pinch) return;
    const touch = e.pointerType === 'touch';
    this._down = { x: e.clientX, y: e.clientY };
    clearTimeout(this._lp);
    if (e.target.closest('.vt-thead, .vt-corner')) return;
    const onRuler = !!e.target.closest('.vt-ruler, .vt-playhead-grab');
    const clipDiv = e.target.closest('.vt-clip');
    const p = this.posFromEvent(e);
    if (onRuler) {
      const grab = !!e.target.closest('.vt-playhead-grab');
      const mk = grab ? null : this.markerAt(e);
      if (mk) { this.op = { kind: 'marker', mk, t0: mk.time, x0: e.clientX, moved: false }; this.scroll.setPointerCapture(e.pointerId); return; }
      this.op = { kind: 'scrub' };
      this.scroll.setPointerCapture(e.pointerId);
      this.el.classList.add('is-scrubbing');
      app.engine.pause();
      if (!grab) app.engine.seek(this.snapTime(p.time, [], true));
      e.preventDefault();
      return;
    }
    if (!clipDiv) {
      if (e.target.closest('.vt-lane')) {
        if (touch) { this.op = { kind: 'tap', time: p.time, x0: e.clientX, y0: e.clientY }; return; } // a tap seeks; a drag scrolls
        if (!e.shiftKey && this.sel.size) app.select([]);
        if (e.pointerType !== 'touch') { this.op = { kind: 'scrub' }; this.scroll.setPointerCapture(e.pointerId); app.engine.pause(); app.engine.seek(this.snapTime(p.time, [], true)); }
      }
      return;
    }
    const c = s.clips.find((x) => x.id === clipDiv.dataset.clip);
    if (!c) return;
    const tr = trackById(s, c.trackId);
    if (tr.lock) { toast(`Track ${tr.name} is locked.`, { timeout: 1400 }); return; }
    if (this.tool === 'razor') {
      ops.splitClips(app, [c.id], this.snapTime(p.time, [], true), { withLinked: !e.altKey });
      return;
    }
    // selection
    const wasSelected = this.sel.has(c.id);
    if (e.shiftKey || e.ctrlKey || e.metaKey) app.toggleSelect(c.id, !e.altKey);
    else if (!wasSelected) app.select([c.id], { withLinked: !e.altKey });
    if (touch) this._lp = setTimeout(() => { if (this.op && this.op.moved) return; this.cancel(); if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) { /* ignore */ } } this.clipMenu(c.id, e.clientX, e.clientY); }, 520);
    if (touch && !wasSelected) return; // first tap selects; drag once selected
    const edge = e.target.dataset.edge;
    const ids = edge ? [c.id, ...(e.altKey ? [] : linked(s, c).map((x) => x.id))] : [...this.sel];
    const clips = s.clips.filter((x) => ids.includes(x.id) && !trackById(s, x.trackId).lock);
    this.op = {
      kind: edge ? 'trim' : 'move', edge, primary: c, x0: e.clientX, y0: e.clientY, moved: false, alt: e.altKey,
      orig: new Map(clips.map((x) => [x.id, { start: x.start, in: x.in, out: x.out, trackId: x.trackId }])),
    };
    this.scroll.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  snapTime(t, exclude, includePlayhead = false) {
    if (!this.snap) return t;
    const pts = snapPoints(this.seq, exclude, includePlayhead ? -1 : this.app.engine.time);
    const tol = 8 / this.pps;
    let best = null;
    for (const p of pts) if (p >= 0 && Math.abs(p - t) < tol && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
    return best === null ? t : best;
  }

  onMove(e) {
    if (this._down && this._lp && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > 8) { clearTimeout(this._lp); this._lp = 0; }
    if (!this.op || this.pinch) return;
    // one layout pass per frame, however many pointer events arrive
    this._pend = e;
    if (!this._mraf) this._mraf = requestAnimationFrame(() => { this._mraf = 0; const ev = this._pend; this._pend = null; if (ev && this.op) this.doMove(ev); });
  }
  doMove(e) {
    const op = this.op; if (!op) return;
    const app = this.app, s = this.seq;
    if (op.kind === 'tap') return;
    if (op.kind === 'scrub') { app.engine.seek(this.snapTime(this.posFromEvent(e).time, [], true)); return; }
    if (op.kind === 'marker') { op.moved = true; op.mk.time = Math.max(0, op.t0 + (e.clientX - op.x0) / this.pps); this.drawRuler(); return; }
    const dx = e.clientX - op.x0;
    if (!op.moved && Math.abs(dx) < 3 && Math.abs(e.clientY - op.y0) < 3) return;
    if (!op.moved) { op.moved = true; clearTimeout(this._lp); this.el.classList.add('is-dragging'); }
    let dt = dx / this.pps;
    const ids = [...op.orig.keys()];
    if (op.kind === 'move') {
      // snap the primary clip's start or end
      const o = op.orig.get(op.primary.id);
      const dur = clipDur(op.primary);
      const cs = o.start + dt, ce = cs + dur;
      const sStart = this.snapTime(cs, ids), sEnd = this.snapTime(ce, ids);
      let snapped = null;
      if (sStart !== cs) { dt += sStart - cs; snapped = sStart; } else if (sEnd !== ce) { dt += sEnd - ce; snapped = sEnd; }
      const minStart = Math.min(...[...op.orig.values()].map((v) => v.start));
      if (minStart + dt < 0) dt = -minStart;
      // vertical: track change for clips of the primary's kind
      const p = this.posFromEvent(e);
      const ptr = trackById(s, o.trackId);
      const targetTr = p.trackId ? trackById(s, p.trackId) : null;
      const sameKind = s.tracks.filter((t) => t.kind === ptr.kind);
      let dTrack = 0;
      if (targetTr && targetTr.kind === ptr.kind) dTrack = sameKind.indexOf(targetTr) - sameKind.indexOf(ptr);
      for (const [id, v] of op.orig) {
        const c = s.clips.find((x) => x.id === id);
        c.start = v.start + dt;
        const tr = trackById(s, v.trackId);
        if (tr.kind === ptr.kind && dTrack) {
          const list = s.tracks.filter((t) => t.kind === tr.kind);
          const ni = clamp(list.indexOf(tr) + dTrack, 0, list.length - 1);
          c.trackId = list[ni].lock ? v.trackId : list[ni].id;
        } else c.trackId = v.trackId;
      }
      if (snapped !== null) this.showSnap(snapped); else this.snapLine.hidden = true;
    } else {
      // trim
      for (const [id, v] of op.orig) {
        const c = s.clips.find((x) => x.id === id);
        const m = mediaById(app.project, c.mediaId);
        const maxOut = m && m.kind !== 'image' && m.duration ? m.duration : Infinity;
        let d = dt;
        if (id === op.primary.id) {
          const edgeT = op.edge === 'l' ? v.start + d : v.start + (v.out - v.in) / c.speed + d;
          const snapped = this.snapTime(edgeT, [id]);
          d += snapped - edgeT;
          if (snapped !== edgeT) this.showSnap(snapped); else this.snapLine.hidden = true;
          op.dt = d;
        } else d = op.dt ?? d;
        const minDur = 1 / s.fps;
        if (op.edge === 'l') {
          let nin = v.in + d * c.speed;
          if (m && m.kind !== 'image') nin = Math.max(0, nin);
          nin = Math.min(nin, v.out - minDur * c.speed);
          const realD = (nin - v.in) / c.speed;
          if (v.start + realD < 0) { nin = v.in - v.start * c.speed; }
          c.in = nin; c.start = v.start + (nin - v.in) / c.speed;
        } else {
          let nout = v.out + d * c.speed;
          nout = Math.min(maxOut, Math.max(v.in + minDur * c.speed, nout));
          c.out = nout;
        }
      }
    }
    this.liveUpdate(ids);
    app.engine.invalidate();
  }
  /** Move / resize the dragged clips' elements in place (no rebuild while the finger is down). */
  liveUpdate(ids) {
    const s = this.seq;
    for (const id of ids) {
      const c = s.clips.find((x) => x.id === id), el = this.clipEls.get(id);
      if (!c || !el) continue;
      el.style.left = this.x(c.start) + 'px';
      el.style.width = Math.max(2, this.x(clipDur(c))) + 'px';
      const lane = this.lanes.get(c.trackId);
      if (lane && el.parentElement !== lane) lane.appendChild(el);
    }
  }

  onUp() {
    clearTimeout(this._lp); this._lp = 0;
    if (this._pend && this.op) { const ev = this._pend; this._pend = null; this.doMove(ev); }
    this._pend = null;
    const op = this.op; this.op = null;
    this.snapLine.hidden = true;
    this.el.classList.remove('is-scrubbing', 'is-dragging');
    if (!op) return;
    const app = this.app, s = this.seq;
    if (op.kind === 'tap') { if (this.sel.size) app.select([]); app.engine.pause(); app.engine.seek(this.snapTime(op.time, [], true)); return; }
    if (op.kind === 'marker') {
      if (!op.moved) { app.engine.seek(op.mk.time); return; }
      const newT = op.mk.time; op.mk.time = op.t0;
      ops.edit(app, 'Move Marker', (sq) => { const m = sq.markers.find((x) => x.id === op.mk.id); if (m) m.time = newT; });
      return;
    }
    if (op.kind !== 'move' && op.kind !== 'trim') return;
    if (!op.moved) return;
    // capture the new state, restore the old, then apply as one undoable edit
    const after = new Map();
    for (const id of op.orig.keys()) { const c = s.clips.find((x) => x.id === id); after.set(id, { start: c.start, in: c.in, out: c.out, trackId: c.trackId }); Object.assign(c, op.orig.get(id)); }
    ops.edit(app, op.kind === 'move' ? 'Move Clip' : 'Trim Clip', (sq) => {
      for (const [id, v] of after) { const c = sq.clips.find((x) => x.id === id); if (c) Object.assign(c, v); }
      ops.resolve(sq, [...after.keys()]);
    });
  }
  cancel() {
    clearTimeout(this._lp); this._lp = 0; this._pend = null;
    const op = this.op; this.op = null; this.touches.clear();
    this.snapLine.hidden = true; this.el.classList.remove('is-scrubbing', 'is-dragging');
    if (op && op.orig) { for (const [id, v] of op.orig) { const c = this.seq.clips.find((x) => x.id === id); if (c) Object.assign(c, v); } this.refresh(); }
  }

  clipMenu(id, x, y) {
    const app = this.app, s = this.seq;
    const c = s.clips.find((cl) => cl.id === id); if (!c) return;
    const m = mediaById(app.project, c.mediaId);
    const tr = trackById(s, c.trackId);
    contextMenu(x, y, [
      { heading: c.name },
      tr.kind === 'video' && app.mobile && app.mobile.matches ? { label: 'Looks and filters…', action: () => app.showEffects('looks') } : null,
      tr.kind === 'video' && app.mobile && app.mobile.matches ? { label: 'Transitions…', action: () => app.showEffects('transitions') } : null,
      { label: 'Split at playhead', action: () => ops.splitAtPlayhead(app), enabled: app.engine.time > c.start && app.engine.time < clipEnd(c) },
      { label: 'Delete', action: () => ops.deleteSelected(app) },
      { label: 'Ripple delete', action: () => ops.deleteSelected(app, { ripple: true }) },
      { label: 'Duplicate', action: () => ops.duplicateSelected(app) },
      { separator: true },
      { label: c.linkId ? 'Unlink' : 'Link selected', action: () => (c.linkId ? ops.unlink(app) : ops.link(app)) },
      { label: c.enabled === false ? 'Enable clip' : 'Disable clip', action: () => ops.updateClips(app, [c.id], { enabled: c.enabled === false }, c.enabled === false ? 'Enable Clip' : 'Disable Clip') },
      { label: 'Speed / Duration…', action: () => ops.speedDialog(app) },
      { label: 'Apply default transition', shortcut: 'Mod+D', action: () => ops.applyTransition(app, 'dissolve'), enabled: tr.kind === 'video' },
      { label: 'Remove transitions', action: () => ops.removeTransitions(app), enabled: !!(c.transIn || c.transOut) },
      { label: 'Animation presets…', action: () => app.showEffects && app.showEffects('presets'), enabled: tr.kind === 'video' },
      !c.gen && c.mediaId && (tr.kind === 'audio' || c.linkId) ? { label: 'Auto captions from speech…', action: () => import('./autocap.js').then((mod) => mod.autoCaptions(app, { clipId: c.id })) } : null,
      { label: 'Remove all keyframes', action: () => ops.clearKeys(app), enabled: !!c.keys },
      c.gen && (c.gen.type === 'text' || c.gen.type === 'caption') ? { label: 'Edit text…', action: () => ops.editGenText(app, c) } : null,
      { label: 'Rename…', action: async () => { const n = await promptDialog('Rename clip', 'Name', c.name); if (n) ops.updateClips(app, [c.id], { name: n.slice(0, 300) }, 'Rename Clip'); } },
      { separator: true },
      { label: 'Reveal in Media', action: () => app.revealMedia(c.mediaId), enabled: !!m },
      { label: 'Relink media…', action: () => app.relinkMedia(m), enabled: !!m && m.offline },
      { label: 'Properties', action: () => app.showProperties() },
    ]);
  }
}

export { HEADER_W };
