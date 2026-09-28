// EYAD VIDEO — panels: Media bin, Source monitor, Effects, Audio mixer, Properties.
import { h, clear, timecode, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { contextMenu, toast, confirmDialog } from '../core/ui.js';
import { clipDur, clipEnd, trackById, mediaById, audioTracks } from './model.js';
import { EFFECTS, defaultParams, canvasFilterSupported } from './effects.js';
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
    const groups = {};
    for (const [type, def] of Object.entries(EFFECTS)) (groups[def.group] = groups[def.group] || []).push([type, def]);
    this.el.appendChild(h('p', { class: 'studio-dim studio-small', text: 'Select a video clip, then click an effect (or drag it onto a clip).' }));
    if (!canvasFilterSupported()) this.el.appendChild(h('div', { class: 'vp-note is-warn' }, icon('warn', 14), h('span', { text: 'Limited support: this browser can’t preview canvas filters, so colour and blur effects are saved but not shown.' })));
    for (const [g, list] of Object.entries(groups)) {
      this.el.appendChild(h('div', { class: 'vp-fx-group', text: g }));
      for (const [type, def] of list) {
        const b = h('button', { class: 'vp-fx-item', type: 'button', draggable: true, onclick: () => ops.addEffect(app, type) }, icon('fx', 14), h('span', { text: def.label }));
        b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-eyad-effect', type); });
        this.el.appendChild(b);
      }
    }
    this.el.appendChild(h('div', { class: 'vp-fx-group', text: 'Built into every clip' }));
    for (const x of ['Transform (position, scale, rotation)', 'Opacity', 'Crop', 'Speed', 'Fade in / fade out', 'Volume & gain']) this.el.appendChild(h('div', { class: 'vp-fx-item is-static' }, icon('sliders', 14), h('span', { text: x })));
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

export class PropertiesPanel {
  constructor(app) { this.app = app; this.el = h('div', { class: 'vp-props' }); this.key = null; }
  refresh(force) {
    const app = this.app, s = app.seq;
    const ids = s ? [...app.selection] : [];
    const c = ids.length ? s.clips.find((x) => x.id === ids[ids.length - 1]) : null;
    const key = s ? (c ? c.id + JSON.stringify([c.effects.map((e) => e.id + e.enabled), c.trackId, c.linkId]) : 'seq:' + s.id + s.width + s.height + s.fps + s.name) : 'none';
    if (!force && key === this.key && this.el.contains(document.activeElement)) { this.sync(c); return; }
    this.key = key;
    clear(this.el);
    if (!s) return;
    if (!c) { this.seqProps(s); return; }
    this.clipProps(c);
  }
  sync(c) { if (!c) return; for (const f of this.fields || []) f(c); }

  num(c, label, path, { min = -1e5, max = 1e5, step = 1, unit = '', live } = {}) {
    const app = this.app;
    const get = (cl) => path.split('.').reduce((o, k) => o[k], cl);
    const input = h('input', { class: 'studio-input is-num', type: 'number', min, max, step, value: round(get(c)) });
    const range = h('input', { class: 'studio-range', type: 'range', min, max, step, value: get(c) });
    const apply = (v, commit) => {
      v = Math.max(min, Math.min(max, Number(v)));
      if (!Number.isFinite(v)) return;
      const cl = app.seq.clips.find((x) => x.id === c.id); if (!cl) return;
      if (commit) ops.updateClipDeep(app, c.id, path, v, label);
      else { const [a, b] = path.split('.'); if (b) cl[a][b] = v; else cl[a] = v; app.engine.invalidate(); app.timeline.refresh(); }
    };
    input.addEventListener('change', () => { range.value = input.value; apply(input.value, true); });
    range.addEventListener('input', () => { input.value = round(range.value); apply(range.value, false); });
    range.addEventListener('change', () => { const v = range.value; const cl = app.seq.clips.find((x) => x.id === c.id); const [a, b] = path.split('.'); const orig = this._orig; if (orig != null) { if (b) cl[a][b] = orig; else cl[a] = orig; } apply(v, true); this._orig = null; });
    range.addEventListener('pointerdown', () => { this._orig = get(c); });
    (this.fields = this.fields || []).push((cl) => { if (document.activeElement !== input) input.value = round(get(cl)); if (document.activeElement !== range) range.value = get(cl); });
    function round(v) { return Math.round(Number(v) * 100) / 100; }
    return h('div', { class: 'vp-prop' }, h('span', { class: 'vp-prop-label', text: label }), range, input, unit ? h('span', { class: 'studio-faint studio-small', text: unit }) : null);
  }

  section(title, ...kids) { return h('details', { class: 'vp-section', open: true }, h('summary', { text: title }), h('div', { class: 'vp-section-body' }, ...kids)); }

  clipProps(c) {
    const app = this.app, s = app.seq;
    this.fields = [];
    const tr = trackById(s, c.trackId);
    const m = mediaById(app.project, c.mediaId);
    const isV = tr.kind === 'video';
    this.el.append(h('div', { class: 'vp-props-head' },
      h('div', { class: 'vp-props-title', text: c.name }),
      h('div', { class: 'studio-small studio-dim', text: `${tr.name} · ${timecode(c.start, s.fps)} – ${timecode(clipEnd(c), s.fps)} · ${clipDur(c).toFixed(2)} s` }),
      m && m.offline ? h('div', { class: 'vp-note is-warn' }, icon('warn', 14), h('span', { text: 'Media offline: ' + (m.originalPath || m.name) }), h('button', { class: 'studio-btn is-small', type: 'button', text: 'Relink', onclick: () => app.relinkMedia(m) })) : null,
      c.missing ? h('div', { class: 'vp-note is-warn' }, icon('warn', 14), h('span', { text: c.missing })) : null,
      app.selection.size > 1 ? h('div', { class: 'studio-small studio-faint', text: `${app.selection.size} clips selected — showing the last one.` }) : null));
    if (isV) {
      this.el.append(this.section('Transform',
        this.num(c, 'Position X', 'transform.x', { min: -8000, max: 8000 }),
        this.num(c, 'Position Y', 'transform.y', { min: -8000, max: 8000 }),
        this.num(c, 'Scale', 'transform.scale', { min: 1, max: 800, unit: '%' }),
        this.num(c, 'Rotation', 'transform.rotation', { min: -360, max: 360, unit: '°' }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Reset transform', onclick: () => ops.updateClips(app, [c.id], { transform: { x: 0, y: 0, scale: 100, rotation: 0, opacity: c.transform.opacity } }, 'Reset Transform') })));
      this.el.append(this.section('Opacity', this.num(c, 'Opacity', 'transform.opacity', { min: 0, max: 100, unit: '%' })));
      this.el.append(this.section('Crop',
        this.num(c, 'Left', 'crop.l', { min: 0, max: 100, unit: '%' }), this.num(c, 'Top', 'crop.t', { min: 0, max: 100, unit: '%' }),
        this.num(c, 'Right', 'crop.r', { min: 0, max: 100, unit: '%' }), this.num(c, 'Bottom', 'crop.b', { min: 0, max: 100, unit: '%' })));
    }
    this.el.append(this.section('Time',
      this.num(c, 'Speed', 'speed', { min: 0.05, max: 16, step: 0.05, unit: '×' }),
      this.num(c, 'Fade in', 'fadeIn', { min: 0, max: 60, step: 0.1, unit: 's' }),
      this.num(c, 'Fade out', 'fadeOut', { min: 0, max: 60, step: 0.1, unit: 's' })));
    if (!isV) {
      const mute = h('input', { type: 'checkbox', checked: c.muted });
      mute.addEventListener('change', () => ops.updateClips(app, [c.id], { muted: mute.checked }, mute.checked ? 'Mute Clip' : 'Unmute Clip'));
      this.el.append(this.section('Volume & gain', this.num(c, 'Gain', 'volume', { min: -60, max: 24, step: 0.5, unit: 'dB' }), row('Mute clip', mute),
        m && m.peaksNote ? h('p', { class: 'studio-small studio-faint', text: m.peaksNote }) : null));
    }
    if (isV) {
      const fx = this.section('Effects');
      const body = fx.querySelector('.vp-section-body');
      if (!c.effects.length) body.appendChild(h('p', { class: 'studio-small studio-faint', text: 'No effects. Add one from the Effects panel.' }));
      for (const e of c.effects) {
        const def = EFFECTS[e.type];
        if (!def) { body.appendChild(h('div', { class: 'vp-note', text: `Unknown effect “${e.type}” (kept, not rendered).` })); continue; }
        const en = h('input', { type: 'checkbox', checked: e.enabled, 'aria-label': 'Enable ' + def.label });
        en.addEventListener('change', () => ops.setEffect(app, c.id, e.id, { enabled: en.checked }, en.checked ? 'Enable Effect' : 'Disable Effect'));
        const params = def.params.map((p) => {
          const input = h('input', { class: 'studio-range', type: 'range', min: p.min, max: p.max, step: p.step || 1, value: e.params[p.key] ?? p.default });
          const out = h('output', { class: 'studio-mono', text: String(e.params[p.key] ?? p.default) + (p.unit || '') });
          input.addEventListener('input', () => { out.textContent = input.value + (p.unit || ''); const cl = app.seq.clips.find((x) => x.id === c.id); const ef = cl.effects.find((x) => x.id === e.id); ef.params = { ...ef.params, [p.key]: Number(input.value) }; app.engine.invalidate(); });
          let orig = null;
          input.addEventListener('pointerdown', () => { orig = e.params[p.key] ?? p.default; });
          input.addEventListener('keydown', () => { if (orig === null) orig = e.params[p.key] ?? p.default; });
          input.addEventListener('change', () => {
            const cl = app.seq.clips.find((x) => x.id === c.id); const ef = cl && cl.effects.find((x) => x.id === e.id);
            if (ef && orig !== null) ef.params = { ...ef.params, [p.key]: orig };
            orig = null;
            ops.setEffect(app, c.id, e.id, { params: { [p.key]: Number(input.value) } }, def.label);
          });
          return h('div', { class: 'vp-prop' }, h('span', { class: 'vp-prop-label', text: p.label }), input, out);
        });
        body.appendChild(h('div', { class: 'vp-fx-card' + (e.enabled ? '' : ' is-off') },
          h('div', { class: 'vp-fx-card-head' }, en, h('b', { text: def.label }), h('span', { class: 'studio-spacer' }),
            h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Reset ' + def.label, title: 'Reset', onclick: () => ops.setEffect(app, c.id, e.id, { params: defaultParams(e.type) }, 'Reset Effect') }, icon('rotate', 13)),
            h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Remove ' + def.label, title: 'Remove', onclick: () => ops.removeEffect(app, c.id, e.id) }, icon('trash', 13))),
          ...params));
      }
      const add = h('select', { class: 'studio-input', 'aria-label': 'Add effect' }, h('option', { value: '', text: '+ Add effect…' }), Object.entries(EFFECTS).map(([k, d]) => h('option', { value: k, text: d.label })));
      add.addEventListener('change', () => { if (add.value) ops.addEffect(app, add.value); });
      body.appendChild(add);
      this.el.append(fx);
    }
    this.el.append(this.section('Clip',
      h('div', { class: 'vp-kv' }, h('span', { text: 'Source' }), h('span', { text: m ? m.name : (c.missing || '—') })),
      h('div', { class: 'vp-kv' }, h('span', { text: 'Source in/out' }), h('span', { class: 'studio-mono', text: `${c.in.toFixed(2)} – ${c.out.toFixed(2)} s` })),
      h('div', { class: 'studio-row' },
        h('button', { class: 'studio-btn is-small', type: 'button', text: c.enabled === false ? 'Enable clip' : 'Disable clip', onclick: () => ops.updateClips(app, [c.id], { enabled: c.enabled === false }, 'Toggle Clip') }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: c.linkId ? 'Unlink A/V' : 'Link', onclick: () => (c.linkId ? ops.unlink(app) : ops.link(app)) }))));
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
      ...(app.project.meta?.source === 'prproj' ? [this.section('Imported project', h('p', { class: 'studio-small studio-dim', text: `From Premiere project “${app.project.meta.prproj?.file || ''}”. Effects, transitions and proprietary features were not reproduced — see File ▸ Project Import Report.` }))] : []));
    if (s.markers.length) {
      const list = h('div', { class: 'vp-markers' }, s.markers.slice().sort((a, b) => a.time - b.time).map((mk) => h('button', { class: 'vp-marker-item', type: 'button', onclick: () => app.engine.seek(mk.time) }, h('span', { class: 'vp-marker-dot', style: { background: mk.color } }), h('span', { class: 'studio-mono', text: timecode(mk.time, s.fps) }), h('span', { text: mk.name }))));
      this.el.append(this.section('Markers', list));
    }
  }
}

export { formatBytes };
