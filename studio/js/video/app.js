// EYAD VIDEO — application controller & layout.
import { h, clear, timecode, isTyping, modKey, uid, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, dialog, confirmDialog, createMenubar, menuSheet, openSheet, closeSheet, commandPalette, saveIndicator, bindKeys, iconButton, isDialogOpen, progressDialog, alertDialog } from '../core/ui.js';
import { getSettings, onSettings } from '../core/settings.js';
import { bootStudio, brandMark, appSwitcher, backToPortfolio, ROUTES, installButton, themeToggle } from '../core/shell.js';
import { History } from '../core/history.js';
import { pickFiles, ACCEPT, sanitizeFilename } from '../core/files.js';
import { createProject, activeSeq, mediaById, clipEnd, seqDuration, trackById, linked } from './model.js';
import { MediaStore } from './media.js';
import { Engine } from './engine.js';
import { Timeline } from './timeline.js';
import { MediaBin, SourceMonitor, EffectsPanel, AudioMixer, PropertiesPanel } from './panels.js';
import { buildMenus } from './menus.js';
import * as ops from './ops.js';
import * as io from './io.js';
import { exportFrame } from './export.js';

export class VideoApp {
  constructor(root) {
    this.root = root;
    this.project = null;
    this.selection = new Set();
    this.clipboard = null;
    this.sourceMediaId = null;
    this.mobile = matchMedia('(max-width: 760px)');
    this.media = new MediaStore((m) => { this.bin.refresh(); this.timeline.refresh(); this.props.refresh(true); void m; });
    this.history = new History({ limit: 200, onChange: (kind) => this.onHistory(kind) });
  }

  get seq() { return this.project ? activeSeq(this.project) : null; }

  // ------------------------------------------------------------ layout
  init() {
    bootStudio();
    this.saveInd = saveIndicator();
    this.menubarEl = h('div', { class: 'img-menubar' });
    this.undoBtn = iconButton('undo', 'Undo', () => this.undo(), { shortcut: 'Mod+Z' });
    this.redoBtn = iconButton('redo', 'Redo', () => this.redo(), { shortcut: 'Mod+Shift+Z' });
    this.titleEl = h('button', { class: 'img-m-title', type: 'button', onclick: () => io.renameProject(this) });
    const top = h('header', { class: 'img-top vid-top' },
      h('div', { class: 'img-top-left' },
        h('a', { class: 'studio-icon-btn img-m-only', href: ROUTES.home, 'aria-label': 'Back to Studio' }, icon('chevronLeft', 20)),
        h('div', { class: 'img-d-only' }, brandMark({ app: 'VIDEO' })),
        h('div', { class: 'img-d-only img-menubar-wrap' }, this.menubarEl),
        h('div', { class: 'img-m-only img-m-titlewrap' }, this.titleEl)),
      h('div', { class: 'img-top-right' },
        h('div', { class: 'img-d-only' }, this.saveInd.el),
        this.undoBtn, this.redoBtn,
        iconButton('save', 'Save', () => io.save(this), { shortcut: 'Mod+S', cls: 'img-m-only' }),
        iconButton('dots', 'Menu', () => menuSheet('EYAD VIDEO', [...this.menus, { label: '← Back to portfolio', action: () => { location.href = ROUTES.portfolio; } }]), { cls: 'img-m-only' }),
        h('div', { class: 'img-d-only img-top-apps' }, appSwitcher('video')),
        iconButton('command', 'Command palette', () => this.palette.show(), { shortcut: 'Mod+K', cls: 'img-d-only' }),
        h('div', { class: 'img-d-only' }, installButton()),
        h('div', { class: 'img-d-only img-theme-wrap' }, themeToggle()),
        h('div', { class: 'img-d-only' }, backToPortfolio({ compact: true }))));

    // panels
    this.bin = new MediaBin(this);
    this.effects = new EffectsPanel(this);
    this.mixer = new AudioMixer(this);
    this.props = new PropertiesPanel(this);
    this.source = new SourceMonitor(this);
    this.engine = new Engine(this);
    this.timeline = new Timeline(this);

    this.leftTabs = this.tabs([['media', 'Media', this.bin.el], ['effects', 'Effects', this.effects.el], ['audio', 'Audio', this.mixer.el]], 'media', (k) => { if (k === 'audio') this.mixer.refresh(); });
    const left = h('section', { class: 'vid-left vid-panel', 'aria-label': 'Media, effects and audio' }, this.leftTabs.el);
    const right = h('section', { class: 'vid-right vid-panel', 'aria-label': 'Properties' }, h('div', { class: 'vid-panel-head' }, h('span', { class: 'studio-label', text: 'Properties' })), h('div', { class: 'vid-panel-body' }, this.props.el));

    // program monitor
    this.progCanvas = h('canvas', { class: 'vid-program-canvas', 'aria-label': 'Program monitor' });
    this.progBox = h('div', { class: 'vid-program-box' }, this.progCanvas);
    this.progScreen = h('div', { class: 'vid-screen' }, this.progBox);
    this.engine.setCanvas(this.progCanvas);
    this.transport = this.buildTransport();
    const program = h('div', { class: 'vid-program' }, this.progScreen, this.transport);
    this.monitorTabs = this.tabs([['source', 'Source', this.source.el], ['program', 'Program', program]], 'program', () => this.layoutMonitor());
    const center = h('section', { class: 'vid-center vid-panel', 'aria-label': 'Monitors' }, this.monitorTabs.el);

    this.resizer = h('div', { class: 'vid-resizer', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize timeline', tabIndex: 0 });
    const tl = h('section', { class: 'vid-timeline vid-panel' }, this.timeline.el);
    this.main = h('div', { class: 'vid-main' }, left, center, right, this.resizer, tl);
    this.dock = this.buildDock();
    this.emptyEl = this.buildEmpty();
    clear(this.root);
    this.root.append(top, this.main, this.dock, this.emptyEl);
    this.bindResizer();

    new ResizeObserver(() => this.layoutMonitor()).observe(this.progScreen);
    this.engine.on((kind) => this.onEngine(kind));

    this.menus = buildMenus(this);
    createMenubar(this.menubarEl, this.menus);
    this.palette = commandPalette(() => this.commands());
    this.bindKeys();
    this.bindDrop();
    addEventListener('beforeunload', (e) => {
      if (this.project && this.history.dirty && getSettings().warnOnLeave) { io.autosaveNow(this); e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') io.autosaveNow(this); });
    this.mobile.addEventListener?.('change', () => { closeSheet(); this.applyMobile(); });
    onSettings(() => { this.timeline.refresh(); this.engine.invalidate(); });
    this.applyMobile();
    io.startAutosave(this);
    io.boot(this);
  }

  tabs(list, initial, onSwitch) {
    const bar = h('div', { class: 'vid-tabs', role: 'tablist' });
    const body = h('div', { class: 'vid-tabbody' });
    const btns = {}, panes = {};
    for (const [k, label, el] of list) {
      btns[k] = h('button', { class: 'vid-tab', type: 'button', role: 'tab', text: label, onclick: () => show(k) });
      panes[k] = h('div', { class: 'vid-tabpane', role: 'tabpanel' }, el);
      bar.appendChild(btns[k]); body.appendChild(panes[k]);
    }
    let current = null;
    const show = (k) => {
      current = k;
      for (const key of Object.keys(btns)) { btns[key].classList.toggle('is-active', key === k); btns[key].setAttribute('aria-selected', String(key === k)); panes[key].hidden = key !== k; }
      onSwitch && onSwitch(k);
    };
    show(initial);
    return { el: h('div', { class: 'vid-tabs-wrap' }, bar, body), show, get current() { return current; }, panes };
  }

  buildTransport() {
    const e = this.engine;
    this.tcEl = h('span', { class: 'studio-mono vid-tc', text: '00:00:00:00' });
    this.durEl = h('span', { class: 'studio-mono vid-dur', text: '00:00:00:00' });
    this.playBtn = h('button', { class: 'vid-play', type: 'button', 'aria-label': 'Play', title: 'Play / pause (Space)', onclick: () => e.toggle() }, icon('play', 20));
    this.loopBtn = h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Loop In/Out', title: 'Loop (In/Out range)', 'aria-pressed': 'false', onclick: () => { e.loop = !e.loop; this.loopBtn.setAttribute('aria-pressed', String(e.loop)); } }, icon('loop', 15));
    this.rateSel = h('select', { class: 'studio-input vid-rate', 'aria-label': 'Playback speed' }, ['0.25', '0.5', '1', '1.5', '2'].map((v) => h('option', { value: v, text: v + '×', selected: v === '1' })));
    this.rateSel.addEventListener('change', () => { e.rate = Number(this.rateSel.value); });
    this.muteBtn = h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Mute monitor', title: 'Mute monitor', onclick: () => { e.setMuted(!e.muted); this.muteBtn.replaceChildren(icon(e.muted ? 'mute' : 'volume', 15)); } }, icon('volume', 15));
    this.volIn = h('input', { class: 'studio-range vid-vol', type: 'range', min: 0, max: 1, step: 0.01, value: 1, 'aria-label': 'Monitor volume' });
    this.volIn.addEventListener('input', () => e.setVolume(Number(this.volIn.value)));
    const b = (ic, label, fn, key) => h('button', { class: 'studio-icon-btn', type: 'button', 'aria-label': label, title: key ? `${label} (${key})` : label, onclick: fn }, icon(ic, 17));
    this.scrub = h('div', { class: 'vid-scrub' }, this.scrubFill = h('div', { class: 'vid-scrub-fill' }), this.scrubHead = h('div', { class: 'vid-scrub-head' }));
    let drag = false;
    const seek = (ev) => { const r = this.scrub.getBoundingClientRect(); e.pause(); e.seek((ev.clientX - r.left) / r.width * seqDuration(this.seq)); };
    this.scrub.addEventListener('pointerdown', (ev) => { drag = true; this.scrub.setPointerCapture(ev.pointerId); seek(ev); });
    this.scrub.addEventListener('pointermove', (ev) => { if (drag) seek(ev); });
    this.scrub.addEventListener('pointerup', () => { drag = false; });
    return h('div', { class: 'vid-transport' },
      this.scrub,
      h('div', { class: 'vid-transport-row' },
        h('div', { class: 'vid-transport-l' }, this.tcEl, h('span', { class: 'studio-faint', text: '/' }), this.durEl),
        h('div', { class: 'vid-transport-c' },
          b('skipStart', 'Go to start', () => e.seek(0), 'Home'),
          b('stepBack', 'Previous frame', () => e.step(-1), '←'),
          this.playBtn,
          b('stepFwd', 'Next frame', () => e.step(1), '→'),
          b('skipEnd', 'Go to end', () => e.seek(seqDuration(this.seq)), 'End')),
        h('div', { class: 'vid-transport-r' },
          h('button', { class: 'studio-btn is-small is-ghost vid-io', type: 'button', text: 'In', title: 'Mark In (I)', onclick: () => ops.setIn(this) }),
          h('button', { class: 'studio-btn is-small is-ghost vid-io', type: 'button', text: 'Out', title: 'Mark Out (O)', onclick: () => ops.setOut(this) }),
          this.loopBtn, this.rateSel, this.muteBtn, this.volIn,
          b('image', 'Export frame', () => exportFrame(this)),
          b('fullscreen', 'Fullscreen monitor', () => this.fullscreenMonitor()))));
  }

  buildDock() {
    const act = (ic, label, fn) => h('button', { class: 'img-dock-panel', type: 'button', onclick: fn }, icon(ic, 18), h('span', { text: label }));
    return h('div', { class: 'vid-dock img-m-only' },
      act('film', 'Media', () => this.sheet('media')),
      act('plus', 'Import', () => this.importDialog()),
      act('split', 'Split', () => ops.splitAtPlayhead(this)),
      act('trash', 'Delete', () => ops.deleteSelected(this)),
      act('fx', 'Effects', () => this.sheet('effects')),
      act('sliders', 'Props', () => this.sheet('props')),
      act('volume', 'Audio', () => this.sheet('audio')));
  }

  sheet(which) {
    const map = { media: [this.bin.el, 'Media'], effects: [this.effects.el, 'Effects'], props: [this.props.el, 'Properties'], audio: [this.mixer.el, 'Audio mixer'] };
    const [el, title] = map[which];
    const home = el.parentElement;
    if (which === 'audio') this.mixer.refresh();
    if (which === 'props') this.props.refresh(true);
    openSheet({ title, content: el, onClose: () => { if (home) home.appendChild(el); } });
  }

  buildEmpty() {
    return h('div', { class: 'vid-empty' },
      h('div', { class: 'img-empty-inner' },
        h('p', { class: 'studio-label', text: 'EYAD VIDEO' }),
        h('h1', { class: 'img-empty-title', text: 'Cut something.' }),
        h('div', { class: 'img-empty-actions' },
          h('button', { class: 'studio-btn is-primary', type: 'button', onclick: () => io.newProject(this) }, icon('plus', 16), 'New project'),
          h('button', { class: 'studio-btn', type: 'button', onclick: () => io.openDialog(this) }, icon('folder', 16), 'Open .eyad / .prproj'),
          h('button', { class: 'studio-btn', type: 'button', onclick: async () => { await io.newProject(this, { quiet: true }); this.importDialog(); } }, icon('upload', 16), 'Import media'),
          h('a', { class: 'studio-btn is-ghost', href: ROUTES.projects }, icon('folder', 16), 'Projects')),
        h('p', { class: 'studio-dim studio-small img-empty-hint', text: 'Drop MP4, WebM, MOV, MP3, WAV, images, an .eyad project or a Premiere .prproj anywhere. Nothing is uploaded.' })));
  }

  applyMobile() {
    this.root.classList.toggle('is-mobile', this.mobile.matches);
    if (this.mobile.matches) { this.monitorTabs.show('program'); }
    this.layoutMonitor();
  }

  bindResizer() {
    let st = null;
    const set = (hpx) => { const v = Math.max(140, Math.min(innerHeight - 220, hpx)); this.root.style.setProperty('--vid-tl', v + 'px'); this.layoutMonitor(); };
    this.resizer.addEventListener('pointerdown', (e) => { st = { y: e.clientY, h: this.timeline.el.parentElement.getBoundingClientRect().height }; this.resizer.setPointerCapture(e.pointerId); });
    this.resizer.addEventListener('pointermove', (e) => { if (st) set(st.h - (e.clientY - st.y)); });
    this.resizer.addEventListener('pointerup', () => { st = null; this.timeline.refresh(); });
    this.resizer.addEventListener('keydown', (e) => { const cur = this.timeline.el.parentElement.getBoundingClientRect().height; if (e.key === 'ArrowUp') set(cur + 20); if (e.key === 'ArrowDown') set(cur - 20); });
  }

  layoutMonitor() {
    const s = this.seq; if (!s) return;
    const r = this.progScreen.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const k = Math.min(r.width / s.width, r.height / s.height);
    const w = Math.max(1, Math.floor(s.width * k)), hh = Math.max(1, Math.floor(s.height * k));
    this.progBox.style.width = w + 'px'; this.progBox.style.height = hh + 'px';
    const dpr = Math.min(2, devicePixelRatio || 1);
    const pw = Math.min(s.width, Math.round(w * dpr)), ph = Math.round(pw * s.height / s.width);
    if (this.progCanvas.width !== pw || this.progCanvas.height !== ph) { this.progCanvas.width = pw; this.progCanvas.height = ph; }
    this.engine.invalidate();
  }

  fullscreenMonitor() {
    const el = this.progScreen;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (el.requestFullscreen) el.requestFullscreen().then(() => setTimeout(() => this.layoutMonitor(), 100)).catch(() => toast('Fullscreen is not available.'));
    else if (this.progCanvas.webkitEnterFullscreen) this.progCanvas.webkitEnterFullscreen();
    else toast('Fullscreen is not supported by this browser.');
  }
  showMonitor(which) { this.monitorTabs.show(which); }

  // ------------------------------------------------------------ project lifecycle
  setProject(p, { projectId = null, recovered = false, clean = true } = {}) {
    this.engine.pause();
    this.engine.releaseAll();
    if (this.project) this.media.release();
    this.project = p;
    this.projectId = projectId;
    this.recovered = recovered;
    this.selection = new Set();
    this.history.clear();
    if (!clean || recovered) this.history.savedSeq = -1;
    this.source.unload();
    this.emptyEl.hidden = true;
    this.engine.seek(0);
    this.layoutMonitor();
    this.timeline.refresh();
    requestAnimationFrame(() => this.timeline.fit());
    this.refreshAll();
    io.updateUrl(this);
  }

  replaceSeq(snapshot) {
    const p = this.project;
    const i = p.sequences.findIndex((s) => s.id === snapshot.id);
    if (i >= 0) p.sequences[i] = snapshot; else p.sequences.push(snapshot);
    for (const id of [...this.selection]) if (!snapshot.clips.some((c) => c.id === id)) this.selection.delete(id);
  }

  onHistory(kind) {
    if (kind === 'undo' || kind === 'redo') { this.changed(true); }
    this.updateChrome();
  }

  changed(force = false) {
    this.engine.invalidate();
    this.timeline.refresh();
    this.bin.refresh();
    this.props.refresh(force);
    if (this.leftTabs.current === 'audio') this.mixer.refresh();
    this.updateChrome();
    io.markDirty(this);
  }

  refreshAll() { this.timeline.refresh(); this.bin.refresh(); this.props.refresh(true); this.mixer.refresh(); this.updateChrome(); this.onEngine('time'); }

  updateChrome() {
    const p = this.project;
    this.undoBtn.disabled = !this.history.canUndo;
    this.redoBtn.disabled = !this.history.canRedo;
    const dirty = p && this.history.dirty;
    this.titleEl.textContent = p ? p.name + (dirty ? ' •' : '') : 'EYAD VIDEO';
    document.title = (p ? p.name + (dirty ? ' •' : '') + ' — ' : '') + 'EYAD VIDEO';
    io.updateSaveIndicator(this);
  }

  undo() { this.engine.pause(); this.history.undo(); }
  redo() { this.engine.pause(); this.history.redo(); }

  onEngine(kind) {
    const e = this.engine, s = this.seq;
    if (!s) return;
    if (kind === 'play' || kind === 'pause' || kind === 'rate') {
      this.playBtn.replaceChildren(icon(e.playing && e.rate > 0 ? 'pause' : 'play', 20));
      this.playBtn.setAttribute('aria-label', e.playing ? 'Pause' : 'Play');
      if (kind === 'rate' && e.rate !== 1 && e.playing) toast(`Shuttle ${e.rate > 0 ? '▶' : '◀'} ${Math.abs(e.rate)}×`, { timeout: 700 });
    }
    const d = seqDuration(s);
    this.tcEl.textContent = timecode(e.time, s.fps);
    this.durEl.textContent = timecode(d, s.fps);
    const f = d ? e.time / d : 0;
    this.scrubFill.style.width = (f * 100) + '%';
    this.scrubHead.style.left = (f * 100) + '%';
    this.timeline.updatePlayhead();
    if (e.playing) this.timeline.follow();
  }

  // ------------------------------------------------------------ selection
  select(ids, { withLinked = false } = {}) {
    const s = this.seq;
    const set = new Set(ids);
    if (withLinked) for (const id of ids) { const c = s.clips.find((x) => x.id === id); if (c) for (const l of linked(s, c)) set.add(l.id); }
    this.selection = set;
    this.timeline.refresh();
    this.props.refresh(true);
  }
  toggleSelect(id, withLinked) {
    const s = this.seq, c = s.clips.find((x) => x.id === id);
    const group = [id, ...(withLinked && c ? linked(s, c).map((x) => x.id) : [])];
    if (this.selection.has(id)) group.forEach((g) => this.selection.delete(g)); else group.forEach((g) => this.selection.add(g));
    this.timeline.refresh();
    this.props.refresh(true);
  }
  showProperties() { if (this.mobile.matches) this.sheet('props'); else this.props.refresh(true); }

  // ------------------------------------------------------------ media
  async importDialog() {
    if (!this.project) await io.newProject(this, { quiet: true });
    const files = await pickFiles({ accept: ACCEPT.media + ',.eyad,.prproj', multiple: true });
    if (files.length) io.handleFiles(this, files);
  }

  async importFiles(files, { place = null } = {}) {
    if (!this.project) await io.newProject(this, { quiet: true });
    const p = this.project;
    const prog = files.length > 1 || files.some((f) => f.size > 50e6) ? progressDialog('Importing media', { cancellable: false }) : null;
    const added = [];
    const errors = [];
    let i = 0;
    for (const f of files) {
      i++;
      prog && prog.set((i - 1) / files.length, `Reading ${sanitizeFilename(f.name)} (${formatBytes(f.size)})`);
      try {
        const m = await this.media.importFile(f, { onStatus: (t) => prog && prog.set(null, t) });
        p.media.push(m);
        added.push(m);
        if (m.kind !== 'image') {
          m.analysing = this.media.analyse(m).finally(() => { m.analysing = null; io.markDirty(this); this.bin.refresh(); });
        }
      } catch (e) {
        errors.push(`${sanitizeFilename(f.name)} — ${e.message}`);
      }
    }
    prog && prog.close();
    this.bin.refresh();
    io.markDirty(this);
    if (errors.length) alertDialog(errors.length === files.length ? 'Could not import media' : 'Some files were not imported', 'Unsupported or unreadable files:', { list: errors });
    if (added.length) toast(`Imported ${added.length} file${added.length > 1 ? 's' : ''}`, { type: 'ok', timeout: 1600 });
    if (place && added.length) {
      let t = place.time;
      for (const m of added) { const ids = await ops.placeMedia(this, m.id, { time: t, trackId: place.trackId }); if (ids && ids.length) t = Math.max(...this.seq.clips.filter((c) => ids.includes(c.id)).map(clipEnd)); }
    } else if (added.length === 1 && !this.seq.clips.length) {
      // first media into an empty sequence: match sequence to the clip like pro NLEs offer
      const m = added[0];
      if (m.kind === 'video' && m.width && m.height && (m.width !== this.seq.width || m.height !== this.seq.height)) {
        const ok = await confirmDialog('Match sequence settings?', `“${m.name}” is ${m.width} × ${m.height}. Change the sequence (${this.seq.width} × ${this.seq.height}) to match it?`, { ok: 'Match', cancel: 'Keep' });
        if (ok) { ops.edit(this, 'Match Sequence', (s) => { s.width = m.width; s.height = m.height; }); this.layoutMonitor(); }
      }
      if (this.mobile.matches) ops.placeMedia(this, m.id, { time: 0 });
    }
    return added;
  }

  async relinkMedia(m) {
    if (!m) return;
    const files = await pickFiles({ accept: m.kind === 'audio' ? ACCEPT.audio + ',' + ACCEPT.video : m.kind === 'image' ? ACCEPT.image : ACCEPT.video });
    if (!files.length) return;
    try {
      const warnings = await this.media.relink(m, files[0]);
      this.engine.releaseAll();
      this.changed();
      toast(`Relinked “${m.name}”`, { type: 'ok', detail: warnings.join(' ') || '', timeout: warnings.length ? 7000 : 2500 });
    } catch (e) { alertDialog('Could not relink', e.message); }
  }

  async relinkDialog() {
    const p = this.project; if (!p) return;
    const off = p.media.filter((m) => m.offline);
    if (!off.length) { toast('All media is online.'); return; }
    const list = h('div', { class: 'vid-relink-list' });
    const render = () => {
      clear(list);
      for (const m of p.media.filter((x) => x.originalPath || x.offline)) {
        list.appendChild(h('div', { class: 'vid-relink-row' + (m.offline ? ' is-offline' : ' is-ok') },
          h('div', { class: 'vid-relink-meta' }, h('b', { text: m.name }), h('small', { text: m.originalPath || '' })),
          m.offline ? h('span', { class: 'studio-badge', text: 'Media offline' }) : h('span', { class: 'studio-badge is-ok', text: 'Online' }),
          m.offline ? h('button', { class: 'studio-btn is-small', type: 'button', text: 'Relink', onclick: async () => { await this.relinkMedia(m); render(); } }) : null));
      }
    };
    render();
    const folderBtn = h('button', { class: 'studio-btn', type: 'button', onclick: async () => {
      const files = await pickFiles({ accept: ACCEPT.media, multiple: true });
      let n = 0;
      for (const f of files) {
        const m = p.media.find((x) => x.offline && x.name.toLowerCase() === sanitizeFilename(f.name).toLowerCase());
        if (!m) continue;
        try { await this.media.relink(m, f); n++; } catch (e) { /* reported below */ }
      }
      this.engine.releaseAll(); this.changed(); render();
      toast(n ? `Relinked ${n} file(s) by name` : 'No selected file matched an offline name.', { type: n ? 'ok' : 'warn' });
    } }, icon('folder', 14), 'Select several files (match by name)…');
    await dialog({ title: 'Relink media', width: 620, body: h('div', { class: 'studio-stack' },
      h('p', { class: 'studio-dim', text: 'Browsers can’t open files by their original path, so choose each file on this device. Nothing is uploaded.' }), folderBtn, list),
    buttons: [{ label: 'Done', value: true, primary: true }] });
  }

  removeMedia(m) {
    const p = this.project;
    ops.edit(this, 'Remove Media', (s) => { s.clips = s.clips.filter((c) => c.mediaId !== m.id); });
    p.media = p.media.filter((x) => x.id !== m.id);
    this.media.release([m.id]);
    if (this.sourceMediaId === m.id) { this.source.unload(); this.sourceMediaId = null; }
    this.changed();
  }

  mediaInfo(m) {
    const kv = (k, v) => h('div', { class: 'vp-kv' }, h('span', { text: k }), h('span', { text: v }));
    dialog({ title: m.name, width: 460, body: h('div', { class: 'studio-stack' },
      kv('Type', m.kind + (m.mime ? ` (${m.mime})` : '')),
      m.kind !== 'audio' ? kv('Frame size', m.width ? `${m.width} × ${m.height}` : 'unknown') : null,
      m.kind !== 'image' ? kv('Duration', m.duration ? m.duration.toFixed(3) + ' s' : 'unknown') : null,
      kv('Audio', m.kind === 'image' ? '—' : m.hasAudio ? 'yes' : 'no'),
      kv('Size', m.size ? formatBytes(m.size) : '—'),
      kv('Stored in browser', m.stored ? 'yes' : 'no'),
      kv('Status', m.offline ? 'MEDIA OFFLINE' : 'online'),
      m.originalPath ? kv('Original path', m.originalPath) : null) });
  }

  openSource(id) { this.sourceMediaId = id; this.source.load(id); this.bin.refresh(); if (!this.mobile.matches && this.monitorTabs.current !== 'source') { /* keep program visible unless asked */ } }
  revealMedia(id) { this.leftTabs.show('media'); if (this.mobile.matches) this.sheet('media'); const el = this.bin.el.querySelector(`[data-media="${id}"]`); if (el) { el.scrollIntoView({ block: 'nearest' }); el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 900); } }

  // ------------------------------------------------------------ clipboard
  copyClips(cut = false) {
    const s = this.seq; const sel = s.clips.filter((c) => this.selection.has(c.id));
    if (!sel.length) return;
    const t0 = Math.min(...sel.map((c) => c.start));
    this.clipboard = sel.map((c) => ({ ...structuredClone(c), start: c.start - t0 }));
    if (cut) ops.deleteSelected(this); else toast(`Copied ${sel.length} clip(s)`, { timeout: 1000 });
  }
  pasteClips() {
    if (!this.clipboard) return;
    const t = this.engine.time, ids = [];
    ops.edit(this, 'Paste', (s) => {
      const links = new Map();
      for (const c of this.clipboard) {
        if (!trackById(s, c.trackId)) continue;
        const n = { ...structuredClone(c), id: uid('c'), start: c.start + t };
        if (c.linkId) { if (!links.has(c.linkId)) links.set(c.linkId, uid('L')); n.linkId = links.get(c.linkId); }
        s.clips.push(n); ids.push(n.id);
      }
      ops.resolve(s, ids);
    });
    this.select(ids);
  }

  // ------------------------------------------------------------ input
  bindKeys() {
    const e = this.engine;
    const need = (fn) => (ev) => { if (!this.project) return false; return fn(ev); };
    bindKeys({
      Space: need(() => e.toggle()), K: need(() => e.shuttle(0)), L: need(() => e.shuttle(1)), J: need(() => e.shuttle(-1)),
      I: need(() => ops.setIn(this)), O: need(() => ops.setOut(this)), 'Alt+X': need(() => ops.clearInOut(this)),
      V: need(() => this.timeline.setTool('select')), C: need(() => this.timeline.setTool('razor')), S: need(() => ops.splitAtPlayhead(this)),
      M: need(() => ops.addMarker(this)), 'Shift+M': need(() => ops.jumpMarker(this, 1)), 'Mod+Shift+M': need(() => ops.jumpMarker(this, -1)),
      ArrowLeft: need(() => e.step(-1)), ArrowRight: need(() => e.step(1)), 'Shift+ArrowLeft': need(() => e.step(-5)), 'Shift+ArrowRight': need(() => e.step(5)),
      ArrowUp: need(() => ops.jumpEdit(this, -1)), ArrowDown: need(() => ops.jumpEdit(this, 1)), Home: need(() => e.seek(0)), End: need(() => e.seek(seqDuration(this.seq))),
      Delete: need(() => ops.deleteSelected(this)), Backspace: need(() => ops.deleteSelected(this)), 'Shift+Delete': need(() => ops.deleteSelected(this, { ripple: true })), 'Shift+Backspace': need(() => ops.deleteSelected(this, { ripple: true })),
      '=': need(() => this.timeline.zoomBy(1.5)), Plus: need(() => this.timeline.zoomBy(1.5)), 'Shift+Plus': need(() => this.timeline.zoomBy(1.5)), '-': need(() => this.timeline.zoomBy(1 / 1.5)), '\\': need(() => this.timeline.fit()),
      'Mod+Z': () => this.undo(), 'Mod+Shift+Z': () => this.redo(), 'Mod+Y': () => this.redo(),
      'Mod+S': need(() => io.save(this)), 'Mod+Shift+S': need(() => io.saveAs(this)), 'Mod+O': () => io.openDialog(this), 'Mod+N': () => io.newProject(this), 'Mod+I': () => this.importDialog(),
      'Mod+M': need(() => import('./export.js').then((m) => m.exportVideoDialog(this))),
      'Mod+C': need(() => this.copyClips()), 'Mod+X': need(() => this.copyClips(true)), 'Mod+V': need(() => this.pasteClips()),
      'Mod+A': need(() => this.select(this.seq.clips.map((c) => c.id))), 'Mod+Shift+A': need(() => this.select([])), 'Mod+D': need(() => ops.duplicateSelected(this)),
      'Mod+L': need(() => (this.seq.clips.some((c) => this.selection.has(c.id) && c.linkId) ? ops.unlink(this) : ops.link(this))),
      'Mod+R': need(() => ops.speedDialog(this)), F: need(() => this.fullscreenMonitor()),
    });
  }

  bindDrop() {
    const overlay = h('div', { class: 'studio-drop' }, h('div', { class: 'studio-drop-label', text: 'Drop to import' }));
    this.root.appendChild(overlay);
    let depth = 0;
    addEventListener('dragenter', (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) { depth++; overlay.classList.add('is-on'); } });
    addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('is-on'); });
    addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault(); });
    addEventListener('drop', (e) => {
      depth = 0; overlay.classList.remove('is-on');
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      io.handleFiles(this, Array.from(e.dataTransfer.files));
    });
  }

  commands() {
    const out = [];
    const walk = (items, group) => {
      for (const it of items) {
        if (!it || it.separator || it.heading) continue;
        const sub = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
        const label = typeof it.label === 'function' ? it.label() : it.label;
        if (sub) walk(sub, group + ' › ' + label);
        else if (it.action && (it.enabled === undefined || (typeof it.enabled === 'function' ? it.enabled() : it.enabled))) out.push({ label, group, shortcut: it.shortcut, run: it.action, icon: it.icon });
      }
    };
    for (const m of this.menus) walk(m.items, m.label);
    out.unshift(
      { label: 'New Video Project', group: 'Studio', icon: 'video', run: () => io.newProject(this) },
      { label: 'Import Media…', group: 'Studio', icon: 'upload', run: () => this.importDialog(), shortcut: 'Mod+I' },
      { label: 'Open Project…', group: 'Studio', icon: 'folder', run: () => io.openDialog(this) },
      { label: 'New Image', group: 'Studio', icon: 'image', run: () => { location.href = ROUTES.image + '?new=1'; } },
      { label: 'Open PSD', group: 'Studio', icon: 'layers', run: () => { location.href = ROUTES.image + '?psd=1'; } },
      { label: 'Settings', group: 'Studio', icon: 'gear', run: () => { location.href = ROUTES.settings; } },
      { label: 'Back to Portfolio', group: 'Studio', icon: 'back', run: () => { location.href = ROUTES.portfolio; } },
    );
    return out;
  }
}

export { isTyping, modKey, mediaById };
