// EYAD VIDEO — application controller & layout.
import { h, clear, timecode, isTyping, modKey, uid, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, dialog, confirmDialog, createMenubar, menuSheet, contextMenu, closeSheet, commandPalette, saveIndicator, bindKeys, iconButton, isDialogOpen, progressDialog, alertDialog } from '../core/ui.js';
import { getSettings, onSettings, perfLevel } from '../core/settings.js';
import { bootStudio, brandMark, appSwitcher, backToPortfolio, ROUTES, installButton, themeToggle, goPortfolio } from '../core/shell.js';
import { History } from '../core/history.js';
import { pickFiles, ACCEPT, sanitizeFilename } from '../core/files.js';
import { chooseFiles } from '../core/open.js';
import { createProject, activeSeq, mediaById, clipEnd, seqDuration, trackById, linked } from './model.js';
import { MediaStore } from './media.js';
import { Engine } from './engine.js';
import { Timeline } from './timeline.js';
import { MediaBin, SourceMonitor, EffectsPanel, AudioMixer, PropertiesPanel } from './panels.js';
import { buildMenus } from './menus.js';
import * as ops from './ops.js';
import * as io from './io.js';
import { linkMediaDialog, linkLocalFiles, canLinkLocal, reconnectLocal } from './link.js';
import { PROPS, valueAt } from './anim.js';
import { onGenFontLoad } from './gen.js';

export class VideoApp {
  constructor(root) {
    this.root = root;
    this.project = null;
    this.selection = new Set();
    this.clipboard = null;
    this.sourceMediaId = null;
    // phone portrait / phone landscape: both use the touch layout (dock + sheets); see video.css for the same queries
    this.mqPhone = matchMedia('(max-width: 760px) and (orientation: portrait), (max-width: 540px)');
    this.mqLand = matchMedia('(orientation: landscape) and (max-height: 540px) and (min-width: 541px)');
    const self = this;
    this.mobile = { get matches() { return self.mqPhone.matches || self.mqLand.matches; } };
    this.sheetKey = null; this.sheetBig = false;
    this.media = new MediaStore((m) => { this.bin.refresh(); this.timeline.refresh(); this.props.refresh(true); void m; });
    this.history = new History({ limit: 200, onChange: (kind) => this.onHistory(kind) });
    this.media.reconnect = (m) => reconnectLocal(this, m);
    this.monZoom = 'fit';
    this.importExtras = () => [
      { icon: 'cloud', label: 'From a link', sub: 'Google Drive, Dropbox, OneDrive, URL', run: () => { setTimeout(() => linkMediaDialog(this), 60); return null; } },
      canLinkLocal() ? { icon: 'hdd', label: 'Link big files', sub: 'Use from disk without copying', run: () => { setTimeout(() => linkLocalFiles(this), 60); return null; } } : null,
    ].filter(Boolean);
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
    this.leftToggle = iconButton('film', 'Media and effects pane', () => this.togglePane('left'), { cls: 'vid-pane-toggle' });
    this.rightToggle = iconButton('sliders', 'Inspector pane', () => this.togglePane('right'), { cls: 'vid-pane-toggle' });
    this.exportBtn = h('button', { class: 'studio-btn is-small is-primary vid-export', type: 'button', title: 'Export video', 'aria-label': 'Export video', onclick: () => this.exportDialog() }, icon('download', 14), h('span', { text: 'Export' }));
    const top = h('header', { class: 'img-top vid-top' },
      h('div', { class: 'img-top-left' },
        h('a', { class: 'studio-icon-btn img-m-only', href: ROUTES.home, 'aria-label': 'Back to Studio' }, icon('chevronLeft', 20)),
        h('div', { class: 'img-d-only' }, brandMark({ app: 'VIDEO' })),
        h('div', { class: 'img-d-only img-menubar-wrap' }, this.menubarEl),
        h('div', { class: 'img-m-only img-m-titlewrap' }, this.titleEl)),
      h('div', { class: 'img-top-right' },
        h('div', { class: 'img-d-only vid-save-ind' }, this.saveInd.el),
        this.leftToggle, this.rightToggle,
        this.undoBtn, this.redoBtn,
        this.exportBtn,
        iconButton('dots', 'Menu', () => menuSheet('EYAD Video', [{ label: 'Save', action: () => io.save(this), enabled: () => !!this.project }, ...this.menus, { label: 'Back to portfolio', action: () => goPortfolio() }]), { cls: 'img-m-only' }),
        h('div', { class: 'img-d-only img-top-apps' }, appSwitcher('video')),
        iconButton('command', 'Command palette', () => this.palette.show(), { shortcut: 'Mod+K', cls: 'img-d-only vid-palette-btn' }),
        h('div', { class: 'img-d-only vid-install' }, installButton()),
        h('div', { class: 'img-d-only img-theme-wrap' }, themeToggle()),
        h('div', { class: 'img-d-only' }, backToPortfolio({ compact: true }))));

    // panels
    this.bin = new MediaBin(this);
    this.effects = new EffectsPanel(this);
    this.mixer = new AudioMixer(this);
    this.props = new PropertiesPanel(this);
    this.source = new SourceMonitor(this);
    this.engine = new Engine(this);
    onGenFontLoad(() => this.engine.invalidate()); // a title's web font finished loading → repaint
    this.onAIError = (e) => toast('Auto mask could not start: ' + String(e && e.message || e).slice(0, 160), { type: 'error', timeout: 7000 });
    this.timeline = new Timeline(this);

    this.leftTabs = this.tabs([['media', 'Media', this.bin.el], ['effects', 'Effects', this.effects.el], ['audio', 'Audio', this.mixer.el]], 'media', (k) => { if (k === 'audio') this.mixer.refresh(); });
    const left = h('section', { class: 'vid-left vid-panel', 'aria-label': 'Media, effects and audio' }, this.leftTabs.el);
    this.propsHome = h('div', { class: 'vid-panel-body' }, this.props.el);
    const right = h('section', { class: 'vid-right vid-panel', 'aria-label': 'Inspector' }, h('div', { class: 'vid-panel-head' }, h('span', { class: 'studio-label', text: 'Inspector' })), this.propsHome);

    // program monitor
    this.progCanvas = h('canvas', { class: 'vid-program-canvas', 'aria-label': 'Program monitor' });
    this.safeEl = h('div', { class: 'vid-safe', hidden: true, 'aria-hidden': 'true' }, h('div', { class: 'vid-safe-action' }), h('div', { class: 'vid-safe-title' }), h('div', { class: 'vid-safe-cross' }));
    this.progBox = h('div', { class: 'vid-program-box' }, this.progCanvas, this.safeEl);
    this.progScreen = h('div', { class: 'vid-screen' }, this.progBox);
    this.engine.setCanvas(this.progCanvas);
    this.transport = this.buildTransport();
    this.bindMonitor();
    const program = h('div', { class: 'vid-program' }, this.progScreen, this.transport);
    this.monitorTabs = this.tabs([['source', 'Source', this.source.el], ['program', 'Program', program]], 'program', () => this.layoutMonitor());
    const center = h('section', { class: 'vid-center vid-panel', 'aria-label': 'Monitors' }, this.monitorTabs.el);

    this.resizer = h('div', { class: 'vid-resizer', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize timeline', tabIndex: 0 });
    const tl = h('section', { class: 'vid-timeline vid-panel' }, this.timeline.el);
    this.main = h('div', { class: 'vid-main' }, left, center, right, this.resizer, tl);
    this.dock = this.buildDock();
    this.sheetEl = this.buildSheet();
    this.emptyEl = this.buildEmpty();
    clear(this.root);
    this.root.append(top, this.emptyEl, this.main, this.dock, this.sheetEl);
    this.bindResizer();
    this.bindPanelEdges(left, right);
    this.restorePanes();

    let lraf = 0;
    new ResizeObserver(() => { if (!lraf) lraf = requestAnimationFrame(() => { lraf = 0; this.layoutMonitor(); this.positionSheet(); }); }).observe(this.progScreen);
    this.engine.on((kind) => this.onEngine(kind));

    this.menus = buildMenus(this);
    createMenubar(this.menubarEl, this.menus);
    this.palette = commandPalette(() => this.commands());
    this.bindKeys();
    this.bindDrop();
    this.bindViewport();
    addEventListener('beforeunload', (e) => {
      if (this.project && this.history.dirty && getSettings().warnOnLeave) { io.autosaveNow(this); e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') io.autosaveNow(this); });
    for (const mq of [this.mqPhone, this.mqLand]) mq.addEventListener?.('change', () => { closeSheet(); this.closeSheet(true); this.applyMobile(); });
    onSettings(() => { this.timeline.measure(); this.timeline.refresh(); this.layoutMonitor(); });
    this.applyMobile();
    this.showStart(!/[?&](project|new|handoff)=/.test(location.search));
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
    this.scrub = h('div', { class: 'vid-scrub', role: 'slider', 'aria-label': 'Scrub' }, this.scrubFill = h('div', { class: 'vid-scrub-fill' }), this.scrubHead = h('div', { class: 'vid-scrub-head' }));
    let drag = null;
    const seek = (ev) => { if (!this.seq) return; e.seek(Math.max(0, Math.min(1, (ev.clientX - drag.left) / drag.width)) * seqDuration(this.seq)); };
    this.scrub.addEventListener('pointerdown', (ev) => { if (!this.seq) return; const r = this.scrub.getBoundingClientRect(); drag = { left: r.left, width: Math.max(1, r.width) }; this.scrub.setPointerCapture(ev.pointerId); e.pause(); seek(ev); });
    this.scrub.addEventListener('pointermove', (ev) => { if (drag) seek(ev); });
    const endScrub = () => { drag = null; };
    this.scrub.addEventListener('pointerup', endScrub); this.scrub.addEventListener('pointercancel', endScrub);
    this.moreBtn = h('button', { class: 'studio-icon-btn is-small vid-more', type: 'button', 'aria-label': 'More monitor options', title: 'More', onclick: (ev) => this.transportMenu(ev) }, icon('dots', 16));
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
          h('button', { class: 'studio-btn is-small is-ghost vid-io', type: 'button', text: 'In', title: 'Mark in (I)', onclick: () => ops.setIn(this) }),
          h('button', { class: 'studio-btn is-small is-ghost vid-io', type: 'button', text: 'Out', title: 'Mark Out (O)', onclick: () => ops.setOut(this) }),
          this.zoomSel = this.buildZoomSel(),
          this.safeBtn = h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Safe margins', title: 'Safe margins (Title/Action)', 'aria-pressed': 'false', onclick: () => this.toggleSafe() }, icon('scope', 15)),
          this.meterEl = h('div', { class: 'vid-meter', title: 'Audio levels (L / R)', 'aria-hidden': 'true' }, h('span', { class: 'vid-meter-l' }), h('span', { class: 'vid-meter-r' })),
          this.loopBtn, this.rateSel, this.muteBtn, this.volIn,
          this.frameBtn = b('image', 'Export frame', () => import('./export.js').then((m) => m.exportFrame(this))),
          b('fullscreen', 'Fullscreen monitor', () => this.fullscreenMonitor()),
          this.moreBtn)));

  }

  transportMenu(e) {
    const en = this.engine, r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.top - 8, [
      { label: 'Mark in', shortcut: 'I', action: () => ops.setIn(this) },
      { label: 'Mark out', shortcut: 'O', action: () => ops.setOut(this) },
      { label: 'Clear in / out', action: () => ops.clearInOut(this) },
      { separator: true },
      { label: 'Loop playback', checked: () => en.loop, action: () => this.loopBtn.click() },
      { label: 'Mute monitor', checked: () => en.muted, action: () => this.muteBtn.click() },
      { label: 'Playback speed', submenu: ['0.25', '0.5', '1', '1.5', '2'].map((v) => ({ label: v + '×', checked: () => String(en.rate) === v, action: () => { this.rateSel.value = v; en.rate = Number(v); } })) },
      { separator: true },
      { label: 'Monitor zoom', submenu: [['fit', 'Fit'], [0.5, '50%'], [1, '100%'], [2, '200%']].map(([z, l]) => ({ label: l, checked: () => this.monZoom === z, action: () => this.setMonitorZoom(z) })) },
      { label: 'Safe margins', checked: () => !this.safeEl.hidden, action: () => this.toggleSafe() },
      { label: 'Export this frame (PNG)', action: () => import('./export.js').then((m) => m.exportFrame(this)) },
      { label: 'Fullscreen monitor', action: () => this.fullscreenMonitor() },
    ]);
  }

  buildDock() {
    const act = (id, ic, label, fn) => h('button', { class: 'vid-dock-btn', type: 'button', dataset: { act: id }, 'aria-label': label, onclick: fn }, icon(ic, 20), h('span', { text: label }));
    const withClip = (fn) => () => { if (!this.project) return; fn(); };
    this.dockBtns = {};
    const items = [
      act('media', 'film', 'Media', () => this.toggleSheet('media')),
      act('split', 'split', 'Split', withClip(() => ops.splitAtPlayhead(this))),
      act('delete', 'trash', 'Delete', withClip(() => ops.deleteSelected(this))),
      act('text', 'title', 'Text', () => this.toggleSheet('effects', 'gen')),
      act('looks', 'sparkle', 'Looks', () => this.toggleSheet('effects', 'looks')),
      act('effects', 'fx', 'Effects', () => this.toggleSheet('effects', 'effects')),
      act('transitions', 'transition', 'Transitions', () => this.toggleSheet('effects', 'transitions')),
      act('props', 'sliders', 'Props', () => this.toggleSheet('props')),
      act('audio', 'volume', 'Audio', () => this.toggleSheet('audio')),
      act('speed', 'clock', 'Speed', withClip(() => ops.speedDialog(this))),
      act('duplicate', 'duplicate', 'Duplicate', withClip(() => ops.duplicateSelected(this))),
      act('captions', 'captions', 'Captions', () => import('./autocap.js').then((m) => m.captionsSheet(this))),
      act('animate', 'keyframe', 'Animate', () => this.toggleSheet('effects', 'presets')),
    ];
    for (const b of items) this.dockBtns[b.dataset.act] = b;
    return h('nav', { class: 'vid-dock', 'aria-label': 'Editing tools' }, h('div', { class: 'vid-dock-row' }, items));
  }

  // ------------------------------------------------------------ phone sheets
  /** Phones: panels open as a sheet over the timeline only — the monitor, transport and tool dock stay usable. */
  buildSheet() {
    this.sheetTitle = h('div', { class: 'studio-sheet-title' });
    this.sheetBody = h('div', { class: 'studio-sheet-body vid-sheet-body' });
    const handle = h('div', { class: 'vid-sheet-grip', role: 'button', 'aria-label': 'Drag to resize or close' }, h('div', { class: 'studio-sheet-handle' }));
    const head = h('div', { class: 'studio-sheet-head' }, this.sheetTitle,
      h('button', { class: 'studio-icon-btn vid-sheet-max', type: 'button', 'aria-label': 'Expand', title: 'Expand / shrink', onclick: () => this.expandSheet() }, icon('chevronUp', 16)),
      h('button', { class: 'studio-icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => this.closeSheet() }, icon('close', 16)));
    const el = h('section', { class: 'studio-sheet vid-sheet', role: 'dialog', hidden: true }, handle, head, this.sheetBody);
    // drag the grip / header: down closes (or shrinks), up expands
    let st = null;
    const down = (e) => { if (e.target.closest('button')) return; st = { y: e.clientY, dy: 0 }; e.currentTarget.setPointerCapture(e.pointerId); el.style.transition = 'none'; };
    const move = (e) => { if (!st) return; st.dy = e.clientY - st.y; el.style.transform = `translateY(${Math.max(this.sheetBig ? 0 : -24, st.dy)}px)`; };
    const up = () => {
      if (!st) return; const dy = st.dy; st = null; el.style.transition = ''; el.style.transform = '';
      if (dy > 70) { if (this.sheetBig) this.expandSheet(false); else this.closeSheet(); } else if (dy < -40) this.expandSheet(true);
    };
    for (const t of [handle, head]) { t.addEventListener('pointerdown', down); t.addEventListener('pointermove', move); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up); }
    return el;
  }
  sheetMap() { return { media: [this.bin.el, 'Media'], effects: [this.effects.el, 'Effects and titles'], props: [this.props.el, 'Inspector'], audio: [this.mixer.el, 'Audio mixer'] }; }
  toggleSheet(which, bin) {
    if (this.sheetKey === which && (!bin || this.effects.cat === bin)) { this.closeSheet(); return; }
    this.sheet(which, bin);
  }
  sheet(which, bin) {
    const entry = this.sheetMap()[which]; if (!entry) return;
    if (!this.mobile.matches) { // desktop / tablet: the same thing lives in a pane
      if (which === 'props') { this.setPane('right', true); this.props.refresh(true); } else { this.setPane('left', true); this.leftTabs.show(which); }
      if (which === 'effects' && bin) this.effects.open(bin);
      return;
    }
    if (!this.project && which !== 'media') { toast('Start a project first.', { timeout: 1400 }); return; }
    const [el, title] = entry;
    if (this.sheetKey !== which) {
      this.closeSheet(true);
      this.sheetHome = el.parentElement;
      this.sheetBody.appendChild(el);
      this.sheetKey = which;
    }
    if (which === 'audio') this.mixer.refresh();
    if (which === 'props') this.props.refresh(true);
    if (which === 'effects' && bin) this.effects.open(bin);
    this.sheetTitle.textContent = which === 'effects' ? ({ gen: 'Text and titles', looks: 'Looks', transitions: 'Transitions', presets: 'Animate', effects: 'Effects' }[this.effects.cat] || title) : title;
    this.sheetEl.setAttribute('aria-label', title);
    this.sheetEl.hidden = false;
    this.positionSheet();
    this.root.classList.add('is-sheet');
    requestAnimationFrame(() => this.sheetEl.classList.add('is-in'));
    this.markDock();
  }
  closeSheet(now = false) {
    if (!this.sheetKey) return;
    const entry = this.sheetMap()[this.sheetKey];
    if (this.sheetEl.contains(document.activeElement)) document.activeElement.blur();
    if (entry && this.sheetHome) this.sheetHome.appendChild(entry[0]);
    this.sheetKey = null; this.sheetHome = null; this.sheetBig = false;
    this.sheetEl.classList.remove('is-in', 'is-big');
    this.root.classList.remove('is-sheet');
    clearTimeout(this._sheetT);
    if (now) this.sheetEl.hidden = true; else this._sheetT = setTimeout(() => { if (!this.sheetKey) this.sheetEl.hidden = true; }, 240);
    this.markDock();
    this.props.refresh(true);
  }
  expandSheet(on = !this.sheetBig) { this.sheetBig = !!on; this.sheetEl.classList.toggle('is-big', this.sheetBig); this.positionSheet(); }
  markDock() {
    const cat = this.sheetKey === 'effects' ? ({ gen: 'text', looks: 'looks', film: 'looks', transitions: 'transitions', presets: 'animate', textstyles: 'text' }[this.effects.cat] || 'effects') : this.sheetKey;
    for (const [k, b] of Object.entries(this.dockBtns)) b.classList.toggle('is-active', k === cat);
  }
  /** The sheet sits exactly over the timeline: below the transport (portrait) or beside the monitor (landscape). */
  positionSheet() {
    if (!this.sheetKey || !this.mobile.matches) return;
    const st = this.sheetEl.style, px = (v) => Math.max(0, Math.round(v)) + 'px';
    const top = this.root.querySelector('.vid-top').getBoundingClientRect();
    const c = this.main.querySelector('.vid-center').getBoundingClientRect(), d = this.dock.getBoundingClientRect();
    if (this.mqLand.matches) {
      st.left = px((this.sheetBig ? c.left : c.right + 6)); st.top = px(top.bottom + 6); st.right = px(innerWidth - d.left + 6); st.bottom = px(innerHeight - d.bottom);
    } else {
      st.left = px(c.left); st.right = px(innerWidth - c.right); st.top = px((this.sheetBig ? top.bottom : c.bottom) + 6); st.bottom = px(innerHeight - d.top + 6);
    }
  }

  /** Phones: keep the focused field above the on-screen keyboard. */
  bindViewport() {
    const vv = window.visualViewport; if (!vv) return;
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
        const open = kb > 120 && this.mobile.matches;
        this.root.style.setProperty('--vid-kb', (open ? kb : 0) + 'px');
        if (open !== this.root.classList.contains('is-kbd')) {
          this.root.classList.toggle('is-kbd', open);
          const a = document.activeElement;
          if (open && a && this.sheetEl.contains(a)) setTimeout(() => a.scrollIntoView({ block: 'center' }), 60);
        }
      });
    };
    vv.addEventListener('resize', on); vv.addEventListener('scroll', on);
  }

  // ------------------------------------------------------------ start screen
  buildEmpty() {
    const tile = (cls, ic, title, sub, fn) => h('button', { class: 'vid-start-tile ' + cls, type: 'button', onclick: fn }, h('span', { class: 'vid-start-ic' }, icon(ic, 20)), h('span', { class: 'vid-start-tx' }, h('b', { text: title }), h('small', { text: sub })));
    this.recentEl = h('div', { class: 'vid-start-recent' });
    return h('div', { class: 'vid-empty vid-start' },
      h('div', { class: 'img-empty-inner vid-start-card' },
        h('div', { class: 'vid-start-head' },
          h('p', { class: 'studio-label', text: 'EYAD Video' }),
          h('h1', { class: 'img-empty-title vid-start-title', text: 'Cut something.' }),
          h('p', { class: 'studio-dim vid-start-sub', text: 'A timeline editor that runs on this device. Nothing is uploaded.' })),
        h('div', { class: 'img-empty-actions vid-start-actions' },
          tile('is-primary', 'plus', 'New project', 'Pick a frame size and start', () => io.newProject(this)),
          tile('', 'upload', 'Import media', 'Video, audio or photos', async () => { await io.newProject(this, { quiet: true }); if (this.project) this.importDialog(); }),
          tile('', 'folder', 'Open .eyad / .prproj', 'A saved or Premiere project', () => io.openDialog(this)),
          tile('', 'captions', 'Import SRT / VTT', 'Subtitles become caption clips', () => import('./captions.js').then((m) => m.importCaptions(this)))),
        h('div', { class: 'vid-start-recent-wrap' },
          h('div', { class: 'vid-start-recent-head' }, h('span', { class: 'studio-label', text: 'Recent projects' }), h('a', { class: 'studio-btn is-small is-ghost', href: ROUTES.projects }, icon('folder', 14), 'Projects')),
          this.recentEl),
        h('p', { class: 'studio-dim studio-small img-empty-hint vid-start-hint', text: 'You can also drop MP4, WebM, MOV, MP3, WAV, images, an .eyad project or a Premiere .prproj anywhere on this page.' })));
  }

  /** Start screen on / off. While it is on, the editor behind it is not rendered at all. */
  showStart(on) {
    this.emptyEl.hidden = !on;
    this.root.classList.toggle('is-start', !!on);
    if (on) { this.closeSheet(true); this.loadRecent(); } else if (this._recentUrls) { this._recentUrls.forEach((u) => URL.revokeObjectURL(u)); this._recentUrls = null; }
    this.exportBtn.disabled = !!on;
  }
  async loadRecent() {
    const el = this.recentEl; if (!el) return;
    let list = [];
    try { const { listProjects } = await import('../core/db.js'); list = (await listProjects()).filter((p) => p.kind === 'video').slice(0, 6); } catch (e) { list = []; }
    if (this.emptyEl.hidden) return;
    if (this._recentUrls) this._recentUrls.forEach((u) => URL.revokeObjectURL(u));
    this._recentUrls = [];
    clear(el);
    if (!list.length) { el.appendChild(h('p', { class: 'studio-faint studio-small vid-start-none', text: 'Projects you save appear here.' })); return; }
    const fmt = (d) => { const m = Math.floor((d || 0) / 60), s = Math.round((d || 0) % 60); return m + ':' + String(s).padStart(2, '0'); };
    for (const p of list) {
      const th = h('span', { class: 'vid-start-thumb' });
      if (p.thumb instanceof Blob) { const u = URL.createObjectURL(p.thumb); this._recentUrls.push(u); th.style.backgroundImage = `url("${u}")`; } else th.appendChild(icon('film', 18));
      el.appendChild(h('button', { class: 'vid-start-proj', type: 'button', title: p.name, onclick: () => io.openProject(this, p.id) }, th,
        h('span', { class: 'vid-start-tx' }, h('b', { text: p.name }), h('small', { text: [p.width && p.height ? `${p.width} × ${p.height}` : '', fmt(p.duration)].filter(Boolean).join(' · ') }))));
    }
  }

  applyMobile() {
    const phone = this.mqPhone.matches, land = this.mqLand.matches;
    this.root.classList.toggle('is-mobile', phone || land);
    this.root.classList.toggle('is-land', land);
    if (phone || land) { this.monitorTabs.show('program'); }
    this.timeline.measure();
    this.layoutMonitor();
    if (this.project) { this.timeline.refresh(); requestAnimationFrame(() => { this.timeline.measure(); this.timeline.refresh(); this.layoutMonitor(); }); }
  }

  // ------------------------------------------------------------ side panes (desktop / tablet)
  restorePanes() {
    let st = {};
    try { st = JSON.parse(localStorage.getItem('eyad-studio:video:panes') || '{}') || {}; } catch (e) { st = {}; }
    this.panes = { left: st.left !== false, right: st.right !== false };
    this.applyPanes();
  }
  applyPanes() {
    this.root.dataset.left = this.panes.left ? 'open' : 'closed';
    this.root.dataset.right = this.panes.right ? 'open' : 'closed';
    this.leftToggle.setAttribute('aria-pressed', String(this.panes.left));
    this.rightToggle.setAttribute('aria-pressed', String(this.panes.right));
  }
  setPane(side, open) {
    if (this.panes[side] === open) return;
    this.panes[side] = open;
    this.applyPanes();
    try { localStorage.setItem('eyad-studio:video:panes', JSON.stringify(this.panes)); } catch (e) { /* ignore */ }
    this.timeline.measure(); this.layoutMonitor(); this.timeline.refresh();
  }
  togglePane(side) { this.setPane(side, !this.panes[side]); }

  exportDialog() { if (!this.project) return; import('./export.js').then((m) => m.exportVideoDialog(this)); }


  /** Drag the inner edges of the side panels to resize them (saved in this browser). */
  bindPanelEdges(left, right) {
    const KEY = 'eyad-studio:video:panels';
    let st0 = {};
    try { st0 = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { st0 = {}; }
    const apply = () => { for (const [k, v] of Object.entries({ '--vid-lw': st0.l, '--vid-rw': st0.r })) { if (v) this.root.style.setProperty(k, v + 'px'); else this.root.style.removeProperty(k); } this.layoutMonitor(); };
    apply();
    for (const [el, side] of [[left, 'l'], [right, 'r']]) {
      const edge = h('div', { class: 'vid-edge', role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to resize (double-click resets)' });
      let d = null;
      edge.addEventListener('pointerdown', (e) => { d = { x: e.clientX, w: el.getBoundingClientRect().width, mirror: this.root.dataset.panels === 'left' }; edge.setPointerCapture(e.pointerId); edge.classList.add('is-drag'); });
      edge.addEventListener('pointermove', (e) => { if (!d) return; let dx = e.clientX - d.x; if ((side === 'r') !== d.mirror) dx = -dx; st0[side] = Math.max(180, Math.min(560, Math.round(d.w + dx))); apply(); });
      edge.addEventListener('pointerup', () => { if (!d) return; d = null; edge.classList.remove('is-drag'); try { localStorage.setItem(KEY, JSON.stringify(st0)); } catch (e) { /* ignore */ } });
      edge.addEventListener('dblclick', () => { delete st0[side]; apply(); try { localStorage.setItem(KEY, JSON.stringify(st0)); } catch (e) { /* ignore */ } });
      el.appendChild(edge);
    }
  }

  bindResizer() {
    let st = null;
    const set = (hpx) => { const v = Math.max(140, Math.min(innerHeight - 220, hpx)); this.root.style.setProperty('--vid-tl', v + 'px'); this.layoutMonitor(); };
    this.resizer.addEventListener('pointerdown', (e) => { st = { y: e.clientY, h: this.timeline.el.parentElement.getBoundingClientRect().height }; this.resizer.setPointerCapture(e.pointerId); });
    this.resizer.addEventListener('pointermove', (e) => { if (st) set(st.h - (e.clientY - st.y)); });
    this.resizer.addEventListener('pointerup', () => { st = null; this.timeline.refresh(); });
    this.resizer.addEventListener('keydown', (e) => { const cur = this.timeline.el.parentElement.getBoundingClientRect().height; if (e.key === 'ArrowUp') set(cur + 20); if (e.key === 'ArrowDown') set(cur - 20); });
  }

  buildZoomSel() {
    const sel = h('select', { class: 'studio-input vid-zoom', 'aria-label': 'Monitor zoom', title: 'Monitor zoom (Shift+= / Shift+-; Shift+0 fits)' },
      [['fit', 'Fit'], ['0.1', '10%'], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%'], ['2', '200%'], ['4', '400%']].map(([v, t]) => h('option', { value: v, text: t, selected: v === 'fit' })));
    sel.addEventListener('change', () => this.setMonitorZoom(sel.value === 'fit' ? 'fit' : Number(sel.value)));
    return sel;
  }
  setMonitorZoom(z) {
    const s = this.seq; if (!s) return;
    if (z !== 'fit') z = Math.max(0.05, Math.min(8, z));
    this.monZoom = z;
    const opt = [...this.zoomSel.options].find((o) => o.value === String(z));
    if (!opt && z !== 'fit') { this.zoomSel.appendChild(h('option', { value: String(z), text: Math.round(z * 100) + '%' })); }
    this.zoomSel.value = String(z);
    this.progScreen.classList.toggle('is-zoomed', z !== 'fit');
    this.layoutMonitor();
    if (z !== 'fit') requestAnimationFrame(() => { const sc = this.progScreen; sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2; sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2; });
  }
  zoomMonitorBy(f) {
    const s = this.seq; if (!s) return;
    const cur = this.monZoom === 'fit' ? this.progCanvas.clientWidth / s.width : this.monZoom;
    this.setMonitorZoom(Math.round(cur * f * 100) / 100);
  }
  toggleSafe() { this.safeEl.hidden = !this.safeEl.hidden; this.safeBtn.setAttribute('aria-pressed', String(!this.safeEl.hidden)); }

  /** Program monitor: drag the selected clip to move it; pinch / Ctrl+wheel zooms; two-finger / middle drag pans. */
  bindMonitor() {
    const scr = this.progScreen;
    let op = null;
    const pts = new Map();
    scr.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.zoomMonitorBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    scr.addEventListener('pointerdown', (e) => {
      if (!this.project) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        if (op && op.kind === 'move') this.cancelMonitorMove(op);
        const [a, b] = [...pts.values()];
        op = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: this.monZoom === 'fit' ? this.progCanvas.clientWidth / this.seq.width : this.monZoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, sl: scr.scrollLeft, st: scr.scrollTop };
        return;
      }
      if (e.button === 1 || (e.button === 0 && this.spaceHeld)) { op = { kind: 'pan', x: e.clientX, y: e.clientY, sl: scr.scrollLeft, st: scr.scrollTop }; scr.setPointerCapture(e.pointerId); e.preventDefault(); return; }
      if (e.button !== 0) return;
      const c = this.monitorTarget(e);
      if (!c) return;
      if (!this.selection.has(c.id)) this.select([c.id]);
      const t = this.engine.time;
      op = { kind: 'move', id: c.id, x: e.clientX, y: e.clientY, k: this.seq.width / this.progCanvas.clientWidth, x0: valueAt(c, 'x', t - c.start, c.transform.x), y0: valueAt(c, 'y', t - c.start, c.transform.y), snap: { tx: { ...c.transform }, keys: c.keys ? structuredClone(c.keys) : undefined }, moved: false };
      scr.setPointerCapture(e.pointerId);
    });
    scr.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!op) return;
      if (op.kind === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.setMonitorZoom(Math.max(0.1, Math.min(8, op.z0 * d / Math.max(1, op.d0))));
        scr.scrollLeft = op.sl - ((a.x + b.x) / 2 - op.cx); scr.scrollTop = op.st - ((a.y + b.y) / 2 - op.cy);
        return;
      }
      if (op.kind === 'pan') { scr.scrollLeft = op.sl - (e.clientX - op.x); scr.scrollTop = op.st - (e.clientY - op.y); return; }
      if (op.kind === 'move') {
        const dx = (e.clientX - op.x) * op.k, dy = (e.clientY - op.y) * op.k;
        if (!op.moved && Math.hypot(e.clientX - op.x, e.clientY - op.y) < 3) return;
        op.moved = true;
        const c = this.seq.clips.find((x) => x.id === op.id); if (!c) return;
        let nx = op.x0 + dx, ny = op.y0 + dy;
        if (!e.altKey) { const sn = 12 * op.k; if (Math.abs(nx) < sn) nx = 0; if (Math.abs(ny) < sn) ny = 0; }
        op.nx = Math.round(nx); op.ny = Math.round(ny);
        c.transform = { ...op.snap.tx }; c.keys = op.snap.keys ? structuredClone(op.snap.keys) : undefined;
        const lt = Math.max(0, this.engine.time - c.start);
        for (const [p, v] of [['x', op.nx], ['y', op.ny]]) { if (c.keys && c.keys[p]) { const ks = c.keys[p]; const near = ks.find((q) => Math.abs(q.t - lt) < 1 / 120); if (near) near.v = v; else { ks.push({ t: lt, v, e: 'smooth' }); ks.sort((a, b) => a.t - b.t); } } else PROPS[p].set(c, v); }
        this.engine.invalidate();
      }
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (!op) return;
      if (op.kind === 'move') {
        const c = this.seq.clips.find((x) => x.id === op.id);
        if (c) { c.transform = op.snap.tx; c.keys = op.snap.keys; }
        if (op.moved && c) ops.moveClipTo(this, op.id, op.nx, op.ny);
      }
      if (op.kind === 'pinch' && pts.size) return;
      op = null;
    };
    scr.addEventListener('pointerup', end);
    scr.addEventListener('pointercancel', (e) => { if (op && op.kind === 'move') this.cancelMonitorMove(op); pts.delete(e.pointerId); op = null; });
    addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && e.target === document.body) this.spaceHeld = true; });
    addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceHeld = false; });
  }
  cancelMonitorMove(op) { const c = this.seq.clips.find((x) => x.id === op.id); if (c) { c.transform = op.snap.tx; c.keys = op.snap.keys; } this.engine.invalidate(); }
  /** Top-most visible video clip under the pointer (by its rough bounds), preferring the selection. */
  monitorTarget(e) {
    const s = this.seq, t = this.engine.time;
    const vis = s.clips.filter((c) => c.enabled !== false && t >= c.start && t < clipEnd(c) && trackById(s, c.trackId).kind === 'video' && !trackById(s, c.trackId).hidden && !trackById(s, c.trackId).lock);
    if (!vis.length) return null;
    const sel = vis.find((c) => this.selection.has(c.id));
    if (sel) return sel;
    const order = s.tracks.filter((tr) => tr.kind === 'video').map((tr) => tr.id);
    vis.sort((a, b) => order.indexOf(a.trackId) - order.indexOf(b.trackId));
    return vis[vis.length - 1];
  }

  layoutMonitor() {
    const s = this.seq; if (!s) return;
    const ar = (s.width / s.height).toFixed(4);
    if (ar !== this._ar) { this._ar = ar; this.root.style.setProperty('--vid-ar', ar); }
    const r = this.progScreen.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const k = this.monZoom === 'fit' ? Math.min(r.width / s.width, r.height / s.height) : this.monZoom;
    const w = Math.max(1, Math.floor(s.width * k)), hh = Math.max(1, Math.floor(s.height * k));
    this.progBox.style.width = w + 'px'; this.progBox.style.height = hh + 'px';
    // preview resolution: honour Settings ▸ Performance (phones default to "performance")
    const perf = perfLevel();
    const dpr = Math.min(perf === 'performance' ? 1.5 : 2, devicePixelRatio || 1);
    const cap = perf === 'performance' ? 960 : perf === 'balanced' ? 1920 : 4096;
    const pw = Math.max(2, Math.min(s.width, cap, Math.round(w * dpr))), ph = Math.max(2, Math.round(pw * s.height / s.width));
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
    this.showStart(false);
    this.engine.seek(0);
    this.layoutMonitor();
    this.timeline.refresh();
    requestAnimationFrame(() => { this.layoutMonitor(); this.timeline.fit(); });
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
    if (kind === 'undo' || kind === 'redo') { this.changed(true); this.layoutMonitor(); } // (frame size may have changed)
    this.updateChrome();
  }

  changed(force = false) {
    this.engine.invalidate();
    this.timeline.refresh();
    this.bin.refresh();
    this.props.refresh(force);
    if (this.leftTabs.current === 'audio' || this.sheetKey === 'audio') this.mixer.refresh();
    this.updateChrome();
    io.markDirty(this);
  }

  refreshAll() { this.timeline.refresh(); this.bin.refresh(); this.props.refresh(true); this.mixer.refresh(); this.updateChrome(); this.onEngine('time'); }

  updateChrome() {
    const p = this.project;
    this.undoBtn.disabled = !this.history.canUndo;
    this.exportBtn.disabled = !p;
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
    this.scrubFill.style.transform = `scaleX(${f})`;
    this.scrubHead.style.left = (f * 100) + '%';
    if (kind === 'time' && !e.playing) this.props.onTime();
    if (this.meterEl) {
      const [l, r] = e.playing ? e.levels() : [0, 0];
      const db = (v) => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-5, v)) + 60) / 60));
      this.meterEl.style.setProperty('--l', db(l)); this.meterEl.style.setProperty('--r', db(r));
      this.meterEl.classList.toggle('is-clip', l > 0.99 || r > 0.99);
    }
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
  showEffects(bin) { this.sheet('effects', bin); }
  /** After an edit that has settings worth seeing. On phones: open the inspector sheet, unless another sheet is being browsed. */
  showProperties(force) {
    if (!this.mobile.matches) { this.props.refresh(true); return; }
    if (!force && this.sheetKey && this.sheetKey !== 'props') { this.props.refresh(true); return; }
    this.sheet('props');
    if (force) requestAnimationFrame(() => { const ta = this.sheetBody && this.sheetBody.querySelector('textarea'); if (ta) { const sec = ta.closest('.vp-section') || ta; this.sheetBody.scrollTop = Math.max(0, sec.offsetTop - 8); } });
  }

  // ------------------------------------------------------------ media
  async importDialog() {
    if (!this.project) await io.newProject(this, { quiet: true });
    const files = await chooseFiles({ title: 'Import media', accept: ACCEPT.media + ',.eyad,.prproj', multiple: true, media: 'any', extras: this.importExtras ? this.importExtras() : [] });
    if (files.length) io.handleFiles(this, files);
  }

  async ensureProject() { if (!this.project) await io.newProject(this, { quiet: true }); }

  async importFiles(files, { place = null, store = true } = {}) {
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
        const m = await this.media.importFile(f, { onStatus: (t) => prog && prog.set(null, t), store });
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
  revealMedia(id) { this.sheet('media'); const el = this.bin.el.querySelector(`[data-media="${id}"]`); if (el) { el.scrollIntoView({ block: 'nearest' }); el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 900); } }

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
      '=': need(() => this.timeline.zoomBy(1.5)), Plus: need(() => this.timeline.zoomBy(1.5)), '-': need(() => this.timeline.zoomBy(1 / 1.5)), '\\': need(() => this.timeline.fit()),
      'Mod+Z': () => this.undo(), 'Mod+Shift+Z': () => this.redo(), 'Mod+Y': () => this.redo(),
      'Mod+S': need(() => io.save(this)), 'Mod+Shift+S': need(() => io.saveAs(this)), 'Mod+O': () => io.openDialog(this), 'Mod+N': () => io.newProject(this), 'Mod+I': () => this.importDialog(),
      'Mod+M': need(() => import('./export.js').then((m) => m.exportVideoDialog(this))),
      'Mod+C': need(() => this.copyClips()), 'Mod+X': need(() => this.copyClips(true)), 'Mod+V': need(() => this.pasteClips()),
      'Mod+A': need(() => this.select(this.seq.clips.map((c) => c.id))), 'Mod+Shift+A': need(() => this.select([])), 'Mod+D': need(() => ops.duplicateSelected(this)),
      'Mod+L': need(() => (this.seq.clips.some((c) => this.selection.has(c.id) && c.linkId) ? ops.unlink(this) : ops.link(this))),
      'Mod+R': need(() => ops.speedDialog(this)), F: need(() => this.fullscreenMonitor()),
      'Shift+D': need(() => ops.applyTransition(this, 'dissolve')), 'Mod+Shift+D': need(() => ops.applyTransition(this, 'dipBlack')),
      T: need(() => ops.addGenerated(this, 'title')), 'Shift+T': need(() => ops.addGenerated(this, 'lower')),
      Q: need(() => ops.rippleTrim(this, 'start')), W: need(() => ops.rippleTrim(this, 'end')),
      A: need(() => ops.selectForward(this, true)), 'Shift+A': need(() => ops.selectForward(this, false)),
      'Alt+ArrowLeft': need(() => ops.nudge(this, -1)), 'Alt+ArrowRight': need(() => ops.nudge(this, 1)),
      'Shift+K': need(() => ops.jumpKey(this, 1)), 'Alt+K': need(() => ops.jumpKey(this, -1)),
      'Shift+=': need(() => this.zoomMonitorBy(1.25)), 'Shift+-': need(() => this.zoomMonitorBy(0.8)), 'Shift+0': need(() => this.setMonitorZoom('fit')),
      'Shift+Plus': need(() => this.zoomMonitorBy(1.25)), 'Shift+_': need(() => this.zoomMonitorBy(0.8)), 'Shift+)': need(() => this.setMonitorZoom('fit')),
      'Mod+U': need(() => linkMediaDialog(this)), "'": need(() => this.toggleSafe()),
'Mod+E': need(() => import('./export.js').then((m) => m.exportVideoDialog(this))),
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
      { label: 'Back to Portfolio', group: 'Studio', icon: 'back', run: () => goPortfolio() },
    );
    return out;
  }
}

export { isTyping, modKey, mediaById };
