// EYAD VIDEO — panels: Media bin, Source monitor, Effects, Audio mixer, Properties.
import { h, clear, timecode, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { contextMenu, toast, confirmDialog } from '../core/ui.js';
import { clipDur, clipEnd, trackById, mediaById, audioTracks } from './model.js';
import { EFFECTS, defaultParams, canvasFilterSupported, TRANSITIONS } from './effects.js';
import { glAvailable } from './gl.js';
import { GEN_TEMPLATES, TITLE_FONTS } from './gen.js';
import { PROPS, PRESETS, EASINGS, valueAt, hasKeys, setKey } from './anim.js';
import { getSettings } from '../core/settings.js';
import * as ops from './ops.js';

// ================================================================= Media bin

export class MediaBin {
  constructor(app) {
    this.app = app;
    this.view = 'grid';
    this.query = '';
    this.el = h('div', { class: 'vp-media' });
    this.search = h('input', { class: 'studio-input vp-search', type: 'search', placeholder: 'Search media', 'aria-label': 'Search media' });
    this.search.addEventListener('input', () => { this.query = this.search.value.toLowerCase(); this.refresh(); });
    this.list = h('div', { class: 'vp-media-list' });
    this.el.append(
      h('div', { class: 'vp-media-bar' },
        this.search,
        h('button', { class: 'studio-btn is-small is-primary', type: 'button', onclick: () => app.importDialog() }, icon('upload', 13), 'Import')),
      this.list);
    this.list.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); this.list.classList.add('is-drop'); } });
    this.list.addEventListener('dragleave', () => this.list.classList.remove('is-drop'));
    this.list.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); this.list.classList.remove('is-drop'); if (e.dataTransfer.files.length) app.importFiles(Array.from(e.dataTransfer.files)); });
  }

  refresh() {
    const app = this.app, p = app.project;
    clear(this.list);
    if (!p) return;
    const items = p.media.filter((m) => !this.query || m.name.toLowerCase().includes(this.query));
    if (!p.media.length) {
      this.list.appendChild(h('div', { class: 'vp-empty' }, icon('film', 26), h('p', { text: 'Import video, audio or images — or drop files here.' }), h('p', { class: 'studio-faint studio-small', text: 'MP4 · WebM · MOV* · MP3 · WAV · AAC* · PNG · JPG' })));
      return;
    }
    const offline = p.media.filter((m) => m.offline).length;
    if (offline) this.list.appendChild(h('div', { class: 'vp-offline-banner' }, icon('warn', 14), h('span', { text: `${offline} file${offline > 1 ? 's' : ''} offline` }), h('button', { class: 'studio-btn is-small', type: 'button', text: 'Relink media', onclick: () => app.relinkDialog() })));
    for (const m of items) this.list.appendChild(this.item(m));
  }

  item(m) {
    const app = this.app;
    const used = app.seq.clips.filter((c) => c.mediaId === m.id).length;
    const thumb = h('div', { class: 'vp-thumb is-' + m.kind + (m.offline ? ' is-offline' : '') });
    if (m.thumb && !m.offline) thumb.style.backgroundImage = `url("${m.thumb}")`;
    else thumb.appendChild(icon(m.kind === 'audio' ? 'music' : m.kind === 'image' ? 'image' : 'film', 22));
    if (m.kind === 'audio' && m.peaks && !m.offline) {
      const c = document.createElement('canvas'); c.width = 120; c.height = 40; c.className = 'vp-thumb-wave';
      const g = c.getContext('2d'); g.fillStyle = 'rgba(255,255,255,.7)';
      for (let x = 0; x < 120; x++) { const i = Math.floor(x / 120 * m.peaks.length); const v = m.peaks[i] || 0; const hh = Math.max(1, v * 36); g.fillRect(x, 20 - hh / 2, 1, hh); }
      thumb.appendChild(c);
    }
    const el = h('div', {
      class: 'vp-item' + (m.offline ? ' is-offline' : '') + (app.sourceMediaId === m.id ? ' is-active' : ''),
      draggable: !m.offline, tabIndex: 0, dataset: { media: m.id }, title: m.offline ? `MEDIA OFFLINE\n${m.originalPath || m.name}` : m.name,
    },
    thumb,
    h('div', { class: 'vp-item-meta' },
      h('div', { class: 'vp-item-name', text: m.name }),
      h('div', { class: 'vp-item-sub' },
        m.offline ? h('span', { class: 'studio-badge', text: 'Media offline' }) : h('span', { text: m.kind === 'image' ? `${m.width}×${m.height}` : timecode(m.duration, app.seq.fps) }),
        !m.offline && m.kind === 'video' ? h('span', { text: `${m.width}×${m.height}` }) : null,
        m.analysing ? h('span', { class: 'studio-faint', text: 'analysing…' }) : null,
        used ? h('span', { class: 'vp-used', text: `${used}×` }) : null)),
    m.offline ? h('button', { class: 'studio-btn is-small vp-relink', type: 'button', text: 'Relink', onclick: (e) => { e.stopPropagation(); app.relinkMedia(m); } }) :
      h('button', { class: 'studio-icon-btn is-small vp-add', type: 'button', title: 'Add at playhead', 'aria-label': 'Add to timeline at playhead', onclick: (e) => { e.stopPropagation(); ops.placeMedia(app, m.id); } }, icon('plus', 15)));
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-eyad-media', m.id); e.dataTransfer.effectAllowed = 'copy'; });
    el.addEventListener('click', () => { if (!m.offline) app.openSource(m.id); });
    el.addEventListener('dblclick', () => { if (!m.offline) { app.openSource(m.id); app.showMonitor('source'); } });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !m.offline) ops.placeMedia(app, m.id); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(m, e.clientX, e.clientY); });
    let lp = 0;
    el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') lp = setTimeout(() => this.menu(m, e.clientX, e.clientY), 550); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, () => clearTimeout(lp)));
    return el;
  }

  menu(m, x, y) {
    const app = this.app;
    contextMenu(x, y, [
      { heading: m.name },
      { label: 'Add to timeline at playhead', action: () => ops.placeMedia(app, m.id), enabled: !m.offline },
      { label: 'Insert at playhead (ripple)', action: () => ops.placeMedia(app, m.id, { mode: 'insert' }), enabled: !m.offline },
      { label: 'Open in Source monitor', action: () => { app.openSource(m.id); app.showMonitor('source'); }, enabled: !m.offline },
      { label: m.offline ? 'Relink…' : 'Replace file…', action: () => app.relinkMedia(m) },
      { separator: true },
      { label: 'Properties', action: () => app.mediaInfo(m) },
      { label: 'Remove from project', action: async () => {
        const used = app.seq.clips.filter((c) => c.mediaId === m.id).length;
        if (used && !(await confirmDialog('Remove media', `“${m.name}” is used by ${used} clip(s) in this sequence. Remove it and those clips?`, { ok: 'Remove', danger: true }))) return;
        app.removeMedia(m);
      } },
    ]);
  }
}

// ================================================================= Source monitor

export class SourceMonitor {
  constructor(app) {
    this.app = app;
    this.mediaId = null;
    this.inPt = null; this.outPt = null;
    this.video = h('video', { class: 'vp-src-video', playsinline: true, preload: 'auto' });
    this.video.playsInline = true;
    this.img = h('img', { class: 'vp-src-img', alt: '' });
    this.empty = h('div', { class: 'vp-src-empty', text: 'Select media in the bin to preview it here.' });
    this.screen = h('div', { class: 'vp-src-screen' }, this.video, this.img, this.empty);
    this.bar = h('div', { class: 'vp-src-scrub' }, this.range = h('div', { class: 'vp-src-range' }), this.head = h('div', { class: 'vp-src-head' }));
    this.tc = h('span', { class: 'studio-mono vp-tc' });
    this.playBtn = h('button', { class: 'studio-icon-btn', type: 'button', 'aria-label': 'Play source', onclick: () => this.toggle() }, icon('play', 16));
    this.el = h('div', { class: 'vp-source' }, this.screen, this.bar,
      h('div', { class: 'vp-transport' }, this.tc, h('span', { class: 'studio-spacer' }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Mark In', title: 'Mark In (I)', onclick: () => this.mark('in') }),
        this.playBtn,
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Mark Out', title: 'Mark Out (O)', onclick: () => this.mark('out') }),
        h('span', { class: 'studio-spacer' }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Insert', title: 'Insert at playhead (ripple)', onclick: () => this.place('insert') }),
        h('button', { class: 'studio-btn is-small is-primary', type: 'button', text: 'Overwrite', title: 'Overwrite at playhead', onclick: () => this.place('overwrite') })));
    this.video.addEventListener('timeupdate', () => this.update());
    this.video.addEventListener('play', () => this.update());
    this.video.addEventListener('pause', () => this.update());
    this.video.addEventListener('error', () => { if (this.mediaId) toast('This file can’t be previewed by the browser.', { type: 'error' }); });
    const seek = (e) => { const r = this.bar.getBoundingClientRect(); const m = mediaById(app.project, this.mediaId); if (!m || m.kind === 'image') return; this.video.currentTime = Math.max(0, Math.min(m.duration, (e.clientX - r.left) / r.width * m.duration)); this.update(); };
    let drag = false;
    this.bar.addEventListener('pointerdown', (e) => { drag = true; this.bar.setPointerCapture(e.pointerId); seek(e); });
    this.bar.addEventListener('pointermove', (e) => { if (drag) seek(e); });
    this.bar.addEventListener('pointerup', () => { drag = false; });
  }
  load(id) {
    const m = mediaById(this.app.project, id);
    if (!m || m.offline) return;
    this.mediaId = id; this.inPt = null; this.outPt = null;
    const url = this.app.media.urlFor(id);
    this.empty.hidden = true;
    if (m.kind === 'image') { this.video.hidden = true; this.video.removeAttribute('src'); this.img.hidden = false; this.img.src = url; }
    else { this.img.hidden = true; this.video.hidden = false; this.video.src = url; this.video.muted = false; }
    this.update();
  }
  unload() { this.mediaId = null; this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.img.removeAttribute('src'); this.empty.hidden = false; this.video.hidden = true; this.img.hidden = true; this.update(); }
  toggle() { if (!this.mediaId || this.video.hidden) return; if (this.video.paused) this.video.play().catch(() => {}); else this.video.pause(); }
  mark(which) {
    const m = mediaById(this.app.project, this.mediaId); if (!m || m.kind === 'image') return;
    const t = this.video.currentTime;
    if (which === 'in') { this.inPt = t; if (this.outPt != null && this.outPt <= t) this.outPt = null; } else { this.outPt = t; if (this.inPt != null && this.inPt >= t) this.inPt = null; }
    this.update();
  }
  place(mode) {
    if (!this.mediaId) { toast('Select media in the bin first.'); return; }
    const m = mediaById(this.app.project, this.mediaId);
    const srcIn = m.kind === 'image' ? 0 : (this.inPt ?? 0);
    const srcOut = m.kind === 'image' ? null : (this.outPt ?? m.duration);
    ops.placeMedia(this.app, this.mediaId, { srcIn, srcOut, mode });
  }
  update() {
    const m = mediaById(this.app.project, this.mediaId);
    const fps = this.app.seq ? this.app.seq.fps : 30;
    if (!m || m.kind === 'image') { this.tc.textContent = m ? `${m.width} × ${m.height} still` : '—'; this.head.style.left = '0'; this.range.hidden = true; return; }
    const t = this.video.currentTime || 0, d = m.duration || 1;
    this.tc.textContent = `${timecode(t, fps)} / ${timecode(d, fps)}`;
    this.head.style.left = (t / d * 100) + '%';
    const a = this.inPt ?? 0, b = this.outPt ?? d;
    this.range.hidden = this.inPt == null && this.outPt == null;
    this.range.style.left = (a / d * 100) + '%'; this.range.style.width = ((b - a) / d * 100) + '%';
    this.playBtn.replaceChildren(icon(this.video.paused ? 'play' : 'pause', 16));
  }
}

// ================================================================= Effects

export class EffectsPanel {
  constructor(app) {
    this.app = app;
    this.el = h('div', { class: 'vp-effects' });
    const search = h('input', { class: 'studio-input vp-fx-search', type: 'search', placeholder: 'Search effects, transitions, titles…', 'aria-label': 'Search effects' });
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      for (const b of this.el.querySelectorAll('.vp-fx-item')) b.hidden = !!q && !b.textContent.toLowerCase().includes(q);
      for (const d of this.el.querySelectorAll('.vp-fx-bin')) { if (q) d.open = true; d.hidden = !!q && ![...d.querySelectorAll('.vp-fx-item')].some((b) => !b.hidden); }
    });
    this.el.appendChild(search);
    const bin = (key, title, items, open = false) => {
      const d = h('details', { class: 'vp-fx-bin', open, dataset: { bin: key } }, h('summary', { text: title }), h('div', { class: 'vp-fx-bin-body' }, items));
      this.el.appendChild(d); return d;
    };
    const item = (ic, label, fn, drag) => {
      const b = h('button', { class: 'vp-fx-item', type: 'button', draggable: !!drag, onclick: fn }, icon(ic, 14), h('span', { text: label }));
      if (drag) b.addEventListener('dragstart', (e) => { e.dataTransfer.setData(drag[0], drag[1]); });
      return b;
    };
    // Titles & graphics
    bin('gen', 'Titles & graphics', Object.entries(GEN_TEMPLATES).map(([k, t]) => item(t.gen.type === 'color' ? 'image' : t.gen.type === 'shape' ? 'rect' : 'title', t.label, () => ops.addGenerated(app, k))), true);
    // Video transitions
    const tg = {};
    for (const [k, t] of Object.entries(TRANSITIONS)) (tg[t.group] = tg[t.group] || []).push(item('transition', t.label, () => ops.applyTransition(app, k), ['application/x-eyad-transition', k]));
    bin('transitions', 'Video transitions', Object.entries(tg).map(([g, list]) => [h('div', { class: 'vp-fx-group', text: g }), list]), true);
    // Presets
    const pg = {};
    for (const [k, p] of Object.entries(PRESETS)) (pg[p.group] = pg[p.group] || []).push(item('keyframe', p.label, () => ops.applyPreset(app, k)));
    bin('presets', 'Animation presets', Object.entries(pg).map(([g, list]) => [h('div', { class: 'vp-fx-group', text: g }), list]));
    // Video effects
    const groups = {};
    for (const [type, def] of Object.entries(EFFECTS)) (groups[def.group] = groups[def.group] || []).push(item('fx', def.label, () => ops.addEffect(app, type), ['application/x-eyad-effect', type]));
    bin('effects', 'Video effects', [
      h('p', { class: 'studio-dim studio-small', text: 'Select a clip, then click an effect or drag it onto a clip. Every parameter can be keyframed (stopwatch in Properties).' }),
      !glAvailable() && !canvasFilterSupported() ? h('div', { class: 'vp-note is-warn' }, icon('warn', 14), h('span', { text: 'This browser has neither WebGL nor canvas filters — effects are saved but not previewed.' })) : null,
      Object.entries(groups).map(([g, list]) => [h('div', { class: 'vp-fx-group', text: g }), list])], true);
    bin('builtin', 'Built into every clip', ['Motion (position, scale, rotation, anchor)', 'Opacity & blur', 'Crop', 'Speed & fades', 'Volume, EQ, compressor, pan'].map((x) => h('div', { class: 'vp-fx-item is-static' }, icon('sliders', 14), h('span', { text: x }))));
  }
  open(which) {
    const d = this.el.querySelector(`[data-bin="${which}"]`);
    if (d) { d.open = true; d.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
  refresh() {}
}

// ================================================================= Audio mixer

export class AudioMixer {
  constructor(app) { this.app = app; this.el = h('div', { class: 'vp-mixer' }); }
  refresh() {
    const app = this.app, s = app.seq;
    clear(this.el);
    if (!s) return;
    for (const tr of audioTracks(s)) {
      const val = h('output', { class: 'studio-mono', text: fmt(tr.volume) });
      const slider = h('input', { class: 'vp-fader', type: 'range', min: -60, max: 12, step: 0.5, value: tr.volume, 'aria-label': tr.name + ' volume', orient: 'vertical' });
      slider.addEventListener('input', () => { val.textContent = fmt(Number(slider.value)); const t = s.tracks.find((x) => x.id === tr.id); t.volume = Number(slider.value); app.engine.invalidate(); });
      slider.addEventListener('change', () => { const v = Number(slider.value); const t = s.tracks.find((x) => x.id === tr.id); t.volume = this._v0 ?? tr.volume; ops.edit(app, 'Track Volume', (sq) => { sq.tracks.find((x) => x.id === tr.id).volume = v; }); this._v0 = null; });
      slider.addEventListener('pointerdown', () => { this._v0 = tr.volume; });
      this.el.appendChild(h('div', { class: 'vp-strip' },
        h('div', { class: 'vp-strip-name', text: tr.name }),
        slider, val,
        h('div', { class: 'vp-strip-btns' },
          h('button', { class: 'vt-tbtn is-mute', type: 'button', 'aria-pressed': String(tr.mute), title: 'Mute', onclick: () => ops.updateTrack(app, tr, { mute: !tr.mute }, 'Mute Track') }, h('span', { text: 'M' })),
          h('button', { class: 'vt-tbtn is-solo', type: 'button', 'aria-pressed': String(tr.solo), title: 'Solo', onclick: () => ops.updateTrack(app, tr, { solo: !tr.solo }, 'Solo Track') }, h('span', { text: 'S' })))));
    }
    const mv = h('input', { class: 'vp-fader', type: 'range', min: 0, max: 1, step: 0.01, value: app.engine.volume, 'aria-label': 'Monitor volume' });
    mv.addEventListener('input', () => app.engine.setVolume(Number(mv.value)));
    this.el.appendChild(h('div', { class: 'vp-strip is-master' }, h('div', { class: 'vp-strip-name', text: 'Monitor' }), mv, h('output', { class: 'studio-mono', text: 'out' })));
    function fmt(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + ' dB'; }
  }
}

// ================================================================= Properties (effect controls)

function row(label, input, extra) { return h('label', { class: 'vp-prop' }, h('span', { class: 'vp-prop-label', text: label }), input, extra || null); }
const round = (v) => Math.round(Number(v) * 100) / 100;

/** Getter/setter for an animatable property, including effect parameters (fx:<id>:<param>). */
function access(prop) {
  if (prop.startsWith('fx:')) {
    const [, eid, p] = prop.split(':');
    const eff = (cl) => (cl.effects || []).find((x) => x.id === eid);
    return {
      get: (cl) => { const e = eff(cl); return e ? (e.params[p] ?? defaultParams(e.type)[p] ?? 0) : 0; },
      set: (cl, v) => { const e = eff(cl); if (e) e.params = { ...e.params, [p]: v }; },
    };
  }
  return PROPS[prop];
}

export class PropertiesPanel {
  constructor(app) { this.app = app; this.el = h('div', { class: 'vp-props' }); this.key = null; this.cid = null; }
  refresh(force) {
    const app = this.app, s = app.seq;
    const ids = s ? [...app.selection] : [];
    const c = ids.length ? s.clips.find((x) => x.id === ids[ids.length - 1]) : null;
    const key = s ? (c ? c.id + JSON.stringify([c.effects.map((e) => e.id + e.enabled), c.trackId, c.linkId, Object.keys(c.keys || {}), c.gen && c.gen.type, !!(c.gen && c.gen.bg), !!(c.gen && c.gen.color2), c.transIn && c.transIn.type, c.transOut && c.transOut.type, !!(c.audioFx && c.audioFx.comp)]) : 'seq:' + s.id + s.width + s.height + s.fps + s.name) : 'none';
    if (!force && key === this.key && this.el.contains(document.activeElement)) { this.sync(); return; }
    if (this._busy) return;
    if (this.el.contains(document.activeElement)) {
      // commit a pending field edit first (its change event may itself refresh the panel)
      this._busy = true;
      try { document.activeElement.blur(); } finally { this._busy = false; }
      return this.refresh(true);
    }
    const scroll = this.el.parentElement ? this.el.parentElement.scrollTop : 0;
    this.key = key;
    this.cid = c ? c.id : null;
    clear(this.el);
    this.fields = [];
    if (!s) return;
    if (!c) { this.seqProps(s); return; }
    this.clipProps(c);
    if (this.el.parentElement && key.startsWith(this._lastId || '\u0000')) this.el.parentElement.scrollTop = scroll;
    this._lastId = c.id;
  }
  clip() { return this.cid && this.app.seq ? this.app.seq.clips.find((x) => x.id === this.cid) : null; }
  sync() { const c = this.clip(); if (!c) return; for (const f of this.fields || []) f(c); }
  /** playhead moved: animated values change */
  onTime() { const c = this.clip(); if (c && c.keys) this.sync(); }

  /** Plain (non-animatable) numeric field bound to a clip path. */
  num(c, label, path, { min = -1e5, max = 1e5, step = 1, unit = '' } = {}) {
    const app = this.app;
    const get = (cl) => path.split('.').reduce((o, k) => o[k], cl);
    const input = h('input', { class: 'studio-input is-num', type: 'number', min, max, step, value: round(get(c)) });
    const range = h('input', { class: 'studio-range', type: 'range', min, max, step, value: get(c) });
    const put = (cl, v) => { const [a, b] = path.split('.'); if (b) cl[a][b] = v; else cl[a] = v; };
    let orig = null;
    const commit = (v) => {
      v = Math.max(min, Math.min(max, Number(v))); if (!Number.isFinite(v)) return;
      const cl = this.clip(); if (cl && orig !== null) put(cl, orig); orig = null;
      ops.updateClipDeep(app, c.id, path, v, label);
    };
    input.addEventListener('change', () => { range.value = input.value; commit(input.value); });
    range.addEventListener('pointerdown', () => { orig = get(this.clip()); });
    range.addEventListener('input', () => { const cl = this.clip(); if (!cl) return; if (orig === null) orig = get(cl); input.value = round(range.value); put(cl, Number(range.value)); app.engine.invalidate(); });
    range.addEventListener('change', () => commit(range.value));
    this.fields.push((cl) => { if (document.activeElement !== input) input.value = round(get(cl)); if (document.activeElement !== range) range.value = get(cl); });
    return h('div', { class: 'vp-prop' }, h('span', { class: 'vp-prop-label', text: label }), range, input, unit ? h('span', { class: 'studio-faint studio-small', text: unit }) : null);
  }

  /** Animatable property row: stopwatch · slider · value · keyframe navigator. */
  anim(c, prop, label, { min = -1e5, max = 1e5, step = 1, unit = '' } = {}) {
    const app = this.app;
    const acc = access(prop);
    const lt = () => app.engine.time - c.start;
    const shown = (cl) => valueAt(cl, prop, lt(), acc.get(cl));
    const animated = hasKeys(c, prop);
    const input = h('input', { class: 'studio-input is-num', type: 'number', min, max, step, value: round(shown(c)) });
    const range = h('input', { class: 'studio-range', type: 'range', min, max, step, value: shown(c) });
    const watch = h('button', { class: 'vp-watch' + (animated ? ' is-on' : ''), type: 'button', title: animated ? 'Stop animating (removes all keyframes)' : 'Animate — creates a keyframe at the playhead', 'aria-label': 'Toggle animation for ' + label, 'aria-pressed': String(animated), onclick: () => ops.toggleAnimate(app, c.id, prop) }, icon('clock', 13));
    const keyBtn = h('button', { class: 'vp-keybtn', type: 'button', title: 'Add / remove keyframe at playhead', 'aria-label': 'Add or remove keyframe for ' + label, onclick: () => ops.addOrRemoveKey(app, c.id, prop) }, h('span', { class: 'vp-diamond' }));
    const nav = (dir) => h('button', { class: 'vp-keynav', type: 'button', title: dir < 0 ? 'Previous keyframe' : 'Next keyframe', 'aria-label': (dir < 0 ? 'Previous' : 'Next') + ' keyframe', onclick: () => {
      const cl = this.clip(); const ks = cl && cl.keys && cl.keys[prop]; if (!ks) return;
      const t = app.engine.time, ts = ks.map((k) => cl.start + k.t);
      const target = dir > 0 ? ts.find((x) => x > t + 1e-3) : [...ts].reverse().find((x) => x < t - 1e-3);
      if (target != null) app.engine.seek(target);
    } }, h('span', { text: dir < 0 ? '‹' : '›' }));
    let snap = null;
    const live = (v) => {
      const cl = this.clip(); if (!cl) return;
      if (snap === null) snap = { v: acc.get(cl), keys: cl.keys ? structuredClone(cl.keys) : undefined };
      if (hasKeys(cl, prop)) setKey(cl, prop, Math.max(0, Math.min(clipDur(cl), lt())), v); else acc.set(cl, v);
      app.engine.invalidate();
    };
    const commit = (v) => {
      v = Math.max(min, Math.min(max, Number(v))); if (!Number.isFinite(v)) return;
      const cl = this.clip(); if (cl && snap) { acc.set(cl, snap.v); cl.keys = snap.keys; } snap = null;
      ops.setProp(app, c.id, prop, v, label);
    };
    input.addEventListener('change', () => { range.value = input.value; commit(input.value); });
    range.addEventListener('input', () => { input.value = round(range.value); live(Number(range.value)); });
    range.addEventListener('change', () => commit(range.value));
    const onKey = (cl) => !!(cl.keys && cl.keys[prop] && cl.keys[prop].some((k) => Math.abs(k.t - lt()) < 1 / 60));
    keyBtn.classList.toggle('is-on', onKey(c));
    this.fields.push((cl) => {
      if (document.activeElement !== input) input.value = round(shown(cl));
      if (document.activeElement !== range && snap === null) range.value = shown(cl);
      keyBtn.classList.toggle('is-on', onKey(cl));
    });
    return h('div', { class: 'vp-prop is-anim' + (animated ? ' is-animated' : '') }, watch, h('span', { class: 'vp-prop-label', text: label }), range, input,
      h('span', { class: 'vp-keys' }, animated ? nav(-1) : null, keyBtn, animated ? nav(1) : null), unit ? h('span', { class: 'studio-faint studio-small vp-unit', text: unit }) : null);
  }

  section(title, ...kids) { return h('details', { class: 'vp-section', open: true }, h('summary', { text: title }), h('div', { class: 'vp-section-body' }, ...kids)); }

  sel(value, options, onchange, label) {
    const s = h('select', { class: 'studio-input', 'aria-label': label || '' }, options.map(([v, t]) => h('option', { value: v, text: t, selected: String(v) === String(value) })));
    s.addEventListener('change', () => onchange(s.value));
    return s;
  }
  colorIn(value, onchange, label) {
    const i = h('input', { class: 'studio-color', type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff', 'aria-label': label || 'Colour' });
    i.addEventListener('input', () => onchange(i.value));
    return i;
  }
  check(value, onchange, label) {
    const i = h('input', { type: 'checkbox', checked: !!value, 'aria-label': label || '' });
    i.addEventListener('change', () => onchange(i.checked));
    return i;
  }
  genNum(c, label, key, { min = 0, max = 1000, step = 1 } = {}) {
    const i = h('input', { class: 'studio-input is-num', type: 'number', min, max, step, value: round(c.gen[key]) });
    i.addEventListener('change', () => { const v = Math.max(min, Math.min(max, Number(i.value))); if (Number.isFinite(v)) ops.updateGen(this.app, c.id, { [key]: v }); });
    return row(label, i);
  }

  clipProps(c) {
    const app = this.app, s = app.seq;
    const tr = trackById(s, c.trackId);
    const m = mediaById(app.project, c.mediaId);
    const isV = tr.kind === 'video';
    const animatedCount = c.keys ? Object.keys(c.keys).length : 0;
    this.el.append(h('div', { class: 'vp-props-head' },
      h('div', { class: 'vp-props-title', text: c.name }),
      h('div', { class: 'studio-small studio-dim', text: `${tr.name} · ${timecode(c.start, s.fps)} – ${timecode(clipEnd(c), s.fps)} · ${clipDur(c).toFixed(2)} s` }),
      m && m.offline ? h('div', { class: 'vp-note is-warn' }, icon('warn', 14), h('span', { text: 'Media offline: ' + (m.originalPath || m.name) }), h('button', { class: 'studio-btn is-small', type: 'button', text: 'Relink', onclick: () => app.relinkMedia(m) })) : null,
      c.missing ? h('div', { class: 'vp-note is-warn' }, icon('warn', 14), h('span', { text: c.missing })) : null,
      app.selection.size > 1 ? h('div', { class: 'studio-small studio-faint', text: `${app.selection.size} clips selected — showing the last one.` }) : null));
    if (isV) {
      const easing = animatedCount ? h('div', { class: 'vp-prop' }, h('span', { class: 'vp-prop-label', text: 'Easing here' }),
        this.sel('', [['', 'Set easing at playhead…'], ...EASINGS], (e) => { if (e) for (const p of Object.keys(c.keys)) ops.setKeyEase(app, c.id, p, e); }, 'Keyframe easing')) : null;
      this.el.append(this.section('Motion',
        this.anim(c, 'x', 'Position X', { min: -4000, max: 4000 }),
        this.anim(c, 'y', 'Position Y', { min: -4000, max: 4000 }),
        this.anim(c, 'scale', 'Scale', { min: 0, max: 800, unit: '%' }),
        this.anim(c, 'rotation', 'Rotation', { min: -720, max: 720, unit: '°' }),
        this.anim(c, 'ax', 'Anchor X', { min: -4000, max: 4000 }),
        this.anim(c, 'ay', 'Anchor Y', { min: -4000, max: 4000 }),
        easing,
        h('div', { class: 'studio-row' },
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Reset', onclick: () => ops.updateClips(app, [c.id], (cl) => ({ transform: { x: 0, y: 0, scale: 100, rotation: 0, ax: 0, ay: 0, opacity: cl.transform.opacity }, keys: cl.keys ? Object.fromEntries(Object.entries(cl.keys).filter(([k]) => !['x', 'y', 'scale', 'rotation', 'ax', 'ay'].includes(k))) : undefined }), 'Reset Motion') }),
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Fit to frame', onclick: () => this.fitClip(c, 'fit') }),
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Fill frame', onclick: () => this.fitClip(c, 'fill') }))));
      this.el.append(this.section('Opacity & blur',
        this.anim(c, 'opacity', 'Opacity', { min: 0, max: 100, unit: '%' }),
        this.anim(c, 'blur', 'Blur', { min: 0, max: 100, step: 0.5, unit: 'px' })));
      if (c.gen) this.genProps(c);
      if (!c.gen || c.gen.type !== 'color') this.el.append(this.section('Crop',
        this.anim(c, 'cropL', 'Left', { min: 0, max: 100, step: 0.5, unit: '%' }), this.anim(c, 'cropT', 'Top', { min: 0, max: 100, step: 0.5, unit: '%' }),
        this.anim(c, 'cropR', 'Right', { min: 0, max: 100, step: 0.5, unit: '%' }), this.anim(c, 'cropB', 'Bottom', { min: 0, max: 100, step: 0.5, unit: '%' })));
      // transitions
      const tOpts = [['', 'None'], ...Object.entries(TRANSITIONS).map(([k, t]) => [k, t.label])];
      const tRow = (which, label) => {
        const cur = c[which];
        const dur = h('input', { class: 'studio-input is-num', type: 'number', min: 0.04, max: 10, step: 0.05, value: cur ? round(cur.dur) : 0.5, disabled: !cur, 'aria-label': label + ' duration' });
        dur.addEventListener('change', () => ops.setTransition(app, c.id, which, { dur: Math.max(0.04, Math.min(clipDur(c), Number(dur.value) || 0.5)) }));
        return h('div', { class: 'vp-prop' }, h('span', { class: 'vp-prop-label', text: label }), this.sel(cur ? cur.type : '', tOpts, (v) => ops.setTransition(app, c.id, which, v ? { type: v, dur: Math.min(cur ? cur.dur : (getSettings().transitionDuration || 0.5), clipDur(c) / 2) } : null), label), dur, h('span', { class: 'studio-faint studio-small', text: 's' }));
      };
      this.el.append(this.section('Transitions', tRow('transIn', 'In'), tRow('transOut', 'Out'),
        h('p', { class: 'studio-small studio-faint', text: 'A clip that touches the previous one cross-fades into it; a free edge fades from/to the background.' })));
      // presets
      this.el.append(this.section('Animate',
        h('div', { class: 'vp-presets' }, Object.entries(PRESETS).filter(([, p]) => !p.text || (c.gen && (c.gen.type === 'text' || c.gen.type === 'caption'))).map(([k, p]) => h('button', { class: 'studio-btn is-small', type: 'button', text: p.label, onclick: () => ops.applyPreset(app, k) }))),
        animatedCount ? h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: `Remove all keyframes (${animatedCount} propert${animatedCount === 1 ? 'y' : 'ies'})`, onclick: () => ops.clearKeys(app) }) : null));
    }
    this.el.append(this.section('Time',
      this.num(c, 'Speed', 'speed', { min: 0.05, max: 16, step: 0.05, unit: '×' }),
      h('div', { class: 'vp-presets' }, [0.25, 0.5, 1, 1.5, 2, 4].map((sp) => h('button', { class: 'studio-btn is-small' + (Math.abs(c.speed - sp) < 1e-3 ? ' is-active' : ''), type: 'button', text: sp + '×', onclick: () => ops.setSpeed(app, sp) }))),
      this.num(c, 'Fade in', 'fadeIn', { min: 0, max: 60, step: 0.1, unit: 's' }),
      this.num(c, 'Fade out', 'fadeOut', { min: 0, max: 60, step: 0.1, unit: 's' })));
    if (!isV) this.audioProps(c, m);
    if (isV) this.effectProps(c);
    this.el.append(this.section('Clip',
      h('div', { class: 'vp-kv' }, h('span', { text: 'Source' }), h('span', { text: c.gen ? 'Generated (' + c.gen.type + ')' : m ? m.name : (c.missing || '—') })),
      !c.gen ? h('div', { class: 'vp-kv' }, h('span', { text: 'Source in/out' }), h('span', { class: 'studio-mono', text: `${c.in.toFixed(2)} – ${c.out.toFixed(2)} s` })) : null,
      c.gen ? this.num(c, 'Duration', 'out', { min: 0.1, max: 3600, step: 0.1, unit: 's' }) : null,
      h('div', { class: 'studio-row' },
        h('button', { class: 'studio-btn is-small', type: 'button', text: c.enabled === false ? 'Enable clip' : 'Disable clip', onclick: () => ops.updateClips(app, [c.id], { enabled: c.enabled === false }, 'Toggle Clip') }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: c.linkId ? 'Unlink A/V' : 'Link', onclick: () => (c.linkId ? ops.unlink(app) : ops.link(app)) }))));
  }

  fitClip(c, mode) {
    const app = this.app, s = app.seq, m = mediaById(app.project, c.mediaId);
    if (!m || !m.width || !m.height) { toast('Fit/fill needs a video or image clip.'); return; }
    const fit = Math.min(s.width / m.width, s.height / m.height), fill = Math.max(s.width / m.width, s.height / m.height);
    // the engine already fits media to the frame at 100 %
    const v = mode === 'fit' ? 100 : Math.round(fill / fit * 1000) / 10;
    ops.setProp(app, c.id, 'scale', v, mode === 'fit' ? 'Fit to Frame' : 'Fill Frame');
  }

  genProps(c) {
    const app = this.app, g = c.gen;
    const up = (patch) => ops.updateGen(app, c.id, patch);
    if (g.type === 'text' || g.type === 'caption') {
      const ta = h('textarea', { class: 'studio-input vp-textarea', rows: 3, maxLength: 5000, 'aria-label': 'Text' });
      ta.value = g.text;
      ta.addEventListener('input', () => up({ text: ta.value.slice(0, 5000) }));
      const weight = this.sel(g.weight, [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']], (v) => up({ weight: Number(v) }), 'Weight');
      this.el.append(this.section(g.type === 'caption' ? 'Caption' : 'Text',
        ta,
        row('Font', this.sel(g.font, TITLE_FONTS, (v) => up({ font: v }), 'Font')),
        row('Weight', weight),
        this.genNum(c, 'Size', 'size', { min: 4, max: 2000 }),
        row('Align', this.sel(g.align, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], (v) => up({ align: v }), 'Align')),
        row('Colour', this.colorIn(g.color, (v) => up({ color: v }), 'Text colour')),
        row('Italic', this.check(g.italic, (v) => up({ italic: v }), 'Italic')),
        row('Shadow', this.check(g.shadow, (v) => up({ shadow: v }), 'Shadow')),
        row('Stroke', this.colorIn(g.stroke, (v) => up({ stroke: v }), 'Stroke colour')),
        this.genNum(c, 'Stroke width', 'strokeW', { min: 0, max: 200 }),
        row('Background', this.check(!!g.bg, (v) => up({ bg: v ? '#000000' : null }), 'Background box')),
        g.bg ? row('Box colour', this.colorIn(g.bg, (v) => up({ bg: v }), 'Box colour')) : null,
        g.bg ? this.genNum(c, 'Box padding', 'bgPad', { min: 0, max: 400 }) : null,
        this.genNum(c, 'Line height', 'lineH', { min: 0.5, max: 4, step: 0.05 }),
        this.anim(c, 'tracking', 'Tracking', { min: -200, max: 2000 }),
        this.anim(c, 'reveal', 'Type on', { min: 0, max: 100, unit: '%' })));
    } else if (g.type === 'shape') {
      this.el.append(this.section('Shape',
        row('Shape', this.sel(g.shape, [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle'], ['line', 'Line']], (v) => up({ shape: v }), 'Shape')),
        this.genNum(c, 'Width', 'w', { min: 1, max: 20000 }), this.genNum(c, 'Height', 'h', { min: 1, max: 20000 }),
        row('Fill', this.colorIn(g.fill || '#ffffff', (v) => up({ fill: v }), 'Fill')),
        row('Stroke', this.colorIn(g.stroke, (v) => up({ stroke: v }), 'Stroke')),
        this.genNum(c, 'Stroke width', 'strokeW', { min: 0, max: 500 }),
        this.genNum(c, 'Corner radius', 'radius', { min: 0, max: 5000 })));
    } else {
      this.el.append(this.section('Matte',
        row('Colour', this.colorIn(g.color, (v) => up({ color: v }), 'Colour')),
        row('Gradient', this.check(!!g.color2, (v) => up({ color2: v ? '#000000' : null }), 'Gradient')),
        g.color2 ? row('Colour 2', this.colorIn(g.color2, (v) => up({ color2: v }), 'Second colour')) : null,
        g.color2 ? this.genNum(c, 'Angle', 'angle', { min: -360, max: 360 }) : null));
    }
  }

  audioProps(c, m) {
    const app = this.app;
    const mute = this.check(c.muted, (v) => ops.updateClips(app, [c.id], { muted: v }, v ? 'Mute Clip' : 'Unmute Clip'), 'Mute clip');
    this.el.append(this.section('Volume', this.anim(c, 'volume', 'Level', { min: -60, max: 24, step: 0.5, unit: 'dB' }), row('Mute clip', mute),
      m && m.peaksNote ? h('p', { class: 'studio-small studio-faint', text: m.peaksNote }) : null));
    const fx = c.audioFx || { low: 0, mid: 0, high: 0, comp: false, threshold: -24, ratio: 4, pan: 0 };
    const slider = (label, key, min, max, step, unit) => {
      const r = h('input', { class: 'studio-range', type: 'range', min, max, step, value: fx[key] });
      const o = h('output', { class: 'studio-mono', text: fx[key] + unit });
      r.addEventListener('input', () => { o.textContent = r.value + unit; });
      r.addEventListener('change', () => ops.setAudioFx(app, c.id, { [key]: Number(r.value) }));
      return h('div', { class: 'vp-prop' }, h('span', { class: 'vp-prop-label', text: label }), r, o);
    };
    this.el.append(this.section('Audio effects',
      h('div', { class: 'vp-fx-group', text: 'Parametric EQ' }),
      slider('Low (180 Hz)', 'low', -24, 24, 0.5, ' dB'), slider('Mid (1.4 kHz)', 'mid', -24, 24, 0.5, ' dB'), slider('High (6 kHz)', 'high', -24, 24, 0.5, ' dB'),
      h('div', { class: 'vp-fx-group', text: 'Dynamics' }),
      row('Compressor', this.check(fx.comp, (v) => ops.setAudioFx(app, c.id, { comp: v }), 'Compressor')),
      fx.comp ? slider('Threshold', 'threshold', -60, 0, 1, ' dB') : null, fx.comp ? slider('Ratio', 'ratio', 1, 20, 0.5, ':1') : null,
      h('div', { class: 'vp-fx-group', text: 'Panner' }),
      slider('Pan', 'pan', -100, 100, 1, ''),
      h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'Reset audio effects', onclick: () => ops.updateClips(app, [c.id], { audioFx: undefined }, 'Reset Audio Effects') })));
  }

  effectProps(c) {
    const app = this.app;
    const fx = this.section('Effects');
    const body = fx.querySelector('.vp-section-body');
    if (!c.effects.length) body.appendChild(h('p', { class: 'studio-small studio-faint', text: 'No effects. Add one below or from the Effects panel.' }));
    c.effects.forEach((e, i) => {
      const def = EFFECTS[e.type];
      if (!def) { body.appendChild(h('div', { class: 'vp-note', text: `Unknown effect “${e.type}” (kept, not rendered).` })); return; }
      const en = this.check(e.enabled, (v) => ops.setEffect(app, c.id, e.id, { enabled: v }, v ? 'Enable Effect' : 'Disable Effect'), 'Enable ' + def.label);
      const move = (d) => ops.edit(app, 'Reorder Effect', (seq) => { const cl = seq.clips.find((x) => x.id === c.id); const j = i + d; if (!cl || j < 0 || j >= cl.effects.length) return false; const a = cl.effects; [a[i], a[j]] = [a[j], a[i]]; });
      body.appendChild(h('div', { class: 'vp-fx-card' + (e.enabled ? '' : ' is-off') },
        h('div', { class: 'vp-fx-card-head' }, en, h('b', { text: def.label }), h('span', { class: 'studio-spacer' }),
          i > 0 ? h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Move up', 'aria-label': 'Move ' + def.label + ' up', onclick: () => move(-1) }, icon('chevronUp', 13)) : null,
          h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Reset ' + def.label, title: 'Reset', onclick: () => ops.setEffect(app, c.id, e.id, { params: defaultParams(e.type) }, 'Reset Effect') }, icon('rotate', 13)),
          h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Remove ' + def.label, title: 'Remove', onclick: () => ops.removeEffect(app, c.id, e.id) }, icon('trash', 13))),
        def.ai ? h('p', { class: 'studio-small studio-faint', text: 'Runs an on-device people-segmentation model (downloaded once, then cached). Preview may lag on slow phones; export uses full quality.' }) : null,
        ...def.params.map((p) => (def.options && def.options[p.key]
          ? h('div', { class: 'vp-prop' }, h('span', { class: 'vp-prop-label', text: p.label }),
            this.sel(e.params[p.key] ?? p.default, def.options[p.key](), (v) => ops.setEffect(app, c.id, e.id, { params: { [p.key]: Number(v) } }, def.label), p.label))
          : this.anim(c, `fx:${e.id}:${p.key}`, p.label, { min: p.min, max: p.max, step: p.step || 1, unit: p.unit || '' })))));
    });
    const add = h('select', { class: 'studio-input', 'aria-label': 'Add effect' }, h('option', { value: '', text: '+ Add effect…' }), Object.entries(EFFECTS).map(([k, d]) => h('option', { value: k, text: d.group + ' › ' + d.label })));
    add.addEventListener('change', () => { if (add.value) ops.addEffect(app, add.value); });
    body.appendChild(add);
    this.el.append(fx);
  }

  seqProps(s) {
    const app = this.app;
    this.el.append(h('div', { class: 'vp-props-head' }, h('div', { class: 'vp-props-title', text: s.name }), h('div', { class: 'studio-small studio-dim', text: 'Sequence — select a clip to edit its properties.' })),
      this.section('Sequence',
        h('div', { class: 'vp-kv' }, h('span', { text: 'Frame size' }), h('span', { class: 'studio-mono', text: `${s.width} × ${s.height}` })),
        h('div', { class: 'vp-kv' }, h('span', { text: 'Frame rate' }), h('span', { class: 'studio-mono', text: `${s.fps} fps` })),
        h('div', { class: 'vp-kv' }, h('span', { text: 'Duration' }), h('span', { class: 'studio-mono', text: timecode(ops.seqDuration(s), s.fps) })),
        h('div', { class: 'vp-kv' }, h('span', { text: 'Clips' }), h('span', { text: String(s.clips.length) })),
        h('div', { class: 'vp-kv' }, h('span', { text: 'Markers' }), h('span', { text: String(s.markers.length) })),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Sequence settings…', onclick: () => ops.sequenceSettings(app) })),
      this.section('Quick add',
        h('div', { class: 'vp-presets' }, Object.entries(GEN_TEMPLATES).map(([k, t]) => h('button', { class: 'studio-btn is-small', type: 'button', text: '+ ' + t.label, onclick: () => ops.addGenerated(app, k) })))),
      ...(app.project.meta?.source === 'prproj' ? [this.section('Imported project', h('p', { class: 'studio-small studio-dim', text: `From Premiere project “${app.project.meta.prproj?.file || ''}”. Effects, transitions and proprietary features were not reproduced — see File ▸ Project Import Report.` }))] : []));
    if (s.markers.length) {
      const list = h('div', { class: 'vp-markers' }, s.markers.slice().sort((a, b) => a.time - b.time).map((mk) => h('button', { class: 'vp-marker-item', type: 'button', onclick: () => app.engine.seek(mk.time) }, h('span', { class: 'vp-marker-dot', style: { background: mk.color } }), h('span', { class: 'studio-mono', text: timecode(mk.time, s.fps) }), h('span', { text: mk.name }))));
      this.el.append(this.section('Markers', list));
    }
  }
}

export { formatBytes };
