import { experienceHelp } from '../core/experience.js';
// EYAD 3D — 3D scene editor (app shell, selection, undo/redo, animation,
// menus, keyboard, drag & drop). Rendering lives in viewport.js, files and
// output in io.js, the side panels in panels.js, the timeline in timeline.js.
import * as THREE from '../../vendor/three/three.module.js';
import { h, clear, isTyping, uid, formatBytes } from '../core/dom.js';
import { toast, createMenubar, menuSheet, commandPalette, saveIndicator, bindKeys, iconButton, isDialogOpen, closeSheet, contextMenu, dialog, promptDialog } from '../core/ui.js';
import { getSettings, onSettings } from '../core/settings.js';
import { bootStudio, brandMark, appSwitcher, backToPortfolio, ROUTES, installButton, themeToggle, goPortfolio } from '../core/shell.js';
import { History } from '../core/history.js';
import { keyLabel } from '../core/dom.js';
import { icon } from './icons.js';
import { Viewport, defaultSettings } from './viewport.js';
import { Panels } from './panels.js';
import { Timeline } from './timeline.js';
import { PRIMITIVES, LIGHTS, createPrimitive, createLight, duplicateObject, disposeObject, isLight, materialsOf, triangleCount, boundsOf } from './objects.js';
import { newAnim, setObjectKey, setCameraKey, sampleObject, sampleCamera, turntableKeys, cameraTurntable, keyIndexAt } from './anim.js';
import * as io from './io.js';

const AUTOKEY_KEY = 'eyad-studio:3d:autokey';
const MODES = [['select', 'Select', 'cursor', 'Q'], ['translate', 'Move', 'move', 'W'], ['rotate', 'Rotate', 'rotate', 'E'], ['scale', 'Scale', 'expand', 'R']];

export class App3D {
  constructor(root) {
    this.root = root;
    this.settings = defaultSettings();
    this.anim = newAnim();
    this.bookmarks = [];
    this.clips = []; // { clip, root, enabled, action }
    this.mixers = new Map();
    this.name = 'Untitled scene';
    this.rec = { projectId: null, created: Date.now(), id: uid('r') };
    this.selected = null;
    this.mode = 'translate';
    this.space = 'world';
    this.uniformScale = true;
    this.time = 0;
    this.playing = false;
    this.autoKey = false;
    try { this.autoKey = localStorage.getItem(AUTOKEY_KEY) === '1'; } catch (e) { /* ignore */ }
    this.mobile = matchMedia('(max-width: 760px) and (orientation: portrait), (max-width: 540px)');
    this.hist = new History({ limit: Math.max(20, getSettings().historyLimit || 60), onChange: () => this.onHistory() });
  }

  get fps() { return this.settings.video.fps || 30; }
  get dirty() { return this.hist.dirty || !!this.forceDirty; }

  // ------------------------------------------------------------ boot / layout
  init() {
    bootStudio();
    const r = this.root;
    this.saveInd = saveIndicator();
    this.menubarEl = h('div', { class: 'img-menubar' });
    this.titleEl = h('button', { class: 'img-m-title', type: 'button', onclick: () => io.renameScene(this) });
    this.undoBtn = iconButton('undo', 'Undo', () => this.undo(), { shortcut: 'Mod+Z' });
    this.redoBtn = iconButton('redo', 'Redo', () => this.redo(), { shortcut: 'Mod+Shift+Z' });
    const top = h('header', { class: 'img-top' },
      h('div', { class: 'img-top-left' },
        h('a', { class: 'studio-icon-btn img-m-only', href: ROUTES.home, 'aria-label': 'Back to Studio' }, icon('chevronLeft', 20)),
        h('div', { class: 'img-d-only' }, brandMark({ app: '3D' })),
        h('div', { class: 'img-d-only img-menubar-wrap' }, this.menubarEl),
        h('div', { class: 'img-m-only img-m-titlewrap' }, this.titleEl)),
      h('div', { class: 'img-top-right' },
        h('div', { class: 'img-d-only' }, this.saveInd.el),
        iconButton('layers', 'Show / hide panels', () => { this.root.classList.toggle('is-panels-collapsed'); }, { cls: 'img-land-only' }),
        this.undoBtn, this.redoBtn,
        iconButton('save', 'Save', () => io.save(this), { shortcut: 'Mod+S', cls: 'img-m-only' }),
        iconButton('dots', 'Menu', () => menuSheet('EYAD 3D', [...this.menus, { label: '← Back to portfolio', action: () => goPortfolio() }]), { cls: 'img-m-only' }),
        h('div', { class: 'img-d-only img-top-apps' }, appSwitcher('3d')),
        iconButton('command', 'Command palette', () => this.palette.show(), { shortcut: 'Mod+K', cls: 'img-d-only' }),
        h('div', { class: 'img-d-only' }, installButton()),
        h('div', { class: 'img-d-only img-theme-wrap' }, themeToggle()),
        h('div', { class: 'img-d-only' }, backToPortfolio({ compact: true }))));
    this.optionsBar = h('div', { class: 'img-options t3-options', role: 'toolbar', 'aria-label': 'Transform options' });
    this.toolbarEl = h('div', { class: 'img-toolbar', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' });
    this.stage = h('div', { class: 'img-stage t3-stage' });
    this.timelineEl = h('div');
    this.statusEl = h('div', { class: 'img-status' });
    this.panelsEl = h('aside', { class: 'img-panels t3-panels', 'aria-label': 'Panels' });
    this.dockEl = h('div', { class: 'img-dock img-m-only' });
    const main = h('div', { class: 'img-main' }, this.toolbarEl, h('div', { class: 'img-center' }, this.stage, this.timelineEl), this.panelsEl);
    clear(r);
    r.append(top, this.optionsBar, main, this.statusEl, this.dockEl);

    if (!this.webglOK()) { this.noWebGL(); return; }
    this.viewport = new Viewport(this, this.stage);
    this.panels = new Panels(this, this.panelsEl);
    this.timeline = new Timeline(this, this.timelineEl);
    this.buildHud();
    this.buildToolbar();
    this.buildOptions();
    this.buildDock();
    this.buildStatus();
    this.menus = this.buildMenus();
    createMenubar(this.menubarEl, this.menus);
    this.palette = commandPalette(() => this.commands());
    this.bindKeys();
    this.bindDrop();
    this.resetScene({ quiet: true });
    this.mobile.addEventListener?.('change', () => { closeSheet(); this.panels.refresh(); });
    onSettings(() => this.viewport.invalidate());
    addEventListener('beforeunload', (e) => { if (!this.leaving && getSettings().warnOnLeave && this.dirty) { io.autosaveNow(this); e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') io.autosaveNow(this); });
    io.startAutosave(this);
    io.boot(this);
  }

  webglOK() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }
  noWebGL() {
    this.stage.appendChild(h('div', { class: 'img-empty' }, h('div', { class: 'img-empty-inner' },
      h('div', { class: 'studio-label', text: 'EYAD 3D' }), h('h1', { class: 'img-empty-title', text: 'WebGL is off' }),
      h('p', { class: 'studio-dim', text: 'This browser or device has WebGL disabled, so 3D scenes cannot be shown. Enable hardware acceleration and reload.' }))));
  }
  onContextLost() { toast('The graphics context was lost — the view will come back when the browser restores it.', { type: 'warn', timeout: 6000 }); }

  buildHud() {
    this.camBtn = h('button', { class: 't3-hud-btn', type: 'button', 'aria-haspopup': 'menu', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.bottom + 4, this.viewMenuItems()); } });
    this.hudTime = h('span', { class: 't3-hud-note studio-mono' });
    this.emptyEl = h('div', { class: 't3-empty' }, h('div', { class: 't3-empty-card' },
      h('div', { class: 'studio-label', text: 'EYAD 3D' }),
      h('h2', { class: 't3-empty-title', text: 'Build a scene' }),
      h('p', { class: 'studio-dim', text: 'Add a shape, or bring in a model — .glb, .gltf, .obj, .stl or .fbx up to 200 MB. Drop files anywhere.' }),
      h('div', { class: 't3-empty-actions' },
        h('button', { class: 'studio-btn is-primary', type: 'button', onclick: () => this.addPrimitive('cube') }, icon('cube', 16), h('span', { text: 'Add a cube' })),
        h('button', { class: 'studio-btn', type: 'button', onclick: () => io.importDialog(this) }, icon('upload', 16), h('span', { text: 'Import model' })),
        h('button', { class: 'studio-btn is-ghost', type: 'button', onclick: () => io.openDialog(this) }, icon('folder', 16), h('span', { text: 'Open project' })))));
    this.stage.append(h('div', { class: 't3-hud' }, this.camBtn, this.hudTime), this.emptyEl);
  }

  buildToolbar() {
    clear(this.toolbarEl);
    for (const [id, label, ic, key] of MODES) {
      const b = h('button', { class: 'img-tool', type: 'button', 'aria-label': label, dataset: { mode: id }, onclick: () => this.setMode(id) }, icon(ic, 19));
      b.title = `${label} (${key})`;
      this.toolbarEl.appendChild(b);
    }
    this.toolbarEl.appendChild(h('div', { class: 'img-toolbar-sep' }));
    for (const p of PRIMITIVES.slice(0, 6)) {
      const b = h('button', { class: 'img-tool', type: 'button', 'aria-label': 'Add ' + p.label, title: 'Add ' + p.label, onclick: () => this.addPrimitive(p.id) }, icon(p.icon, 19));
      this.toolbarEl.appendChild(b);
    }
    const more = h('button', { class: 'img-tool', type: 'button', 'aria-label': 'Add light or more shapes', title: 'Add light or more shapes', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.right + 4, r.top, this.addMenuItems()); } }, icon('bulb', 19));
    this.toolbarEl.append(more, h('div', { class: 'img-toolbar-sep' }),
      h('button', { class: 'img-tool', type: 'button', 'aria-label': 'Import model', title: 'Import model (Ctrl+I)', onclick: () => io.importDialog(this) }, icon('upload', 19)),
      h('button', { class: 'img-tool', type: 'button', 'aria-label': 'Frame selection', title: 'Frame selection (F)', onclick: () => this.frameSelection() }, icon('frame', 19)));
  }

  buildOptions() {
    clear(this.optionsBar);
    const modeSeg = h('div', { class: 'img-seg' }, MODES.map(([id, label, ic, key]) => h('button', { class: 'studio-btn is-small is-ghost t3-mode', type: 'button', title: `${label} (${key})`, 'aria-label': label, dataset: { mode: id }, onclick: () => this.setMode(id) }, icon(ic, 14), h('span', { class: 't3-hide-s', text: label }))));
    this.spaceBtn = h('button', { class: 'studio-btn is-small is-ghost', type: 'button', title: 'Gizmo orientation: world or local axes (L)', onclick: () => this.setSpace(this.space === 'world' ? 'local' : 'world') });
    this.snapBtn = h('button', { class: 'studio-btn is-small is-ghost t3-snap', type: 'button', title: 'Snapping (hold Shift to snap temporarily)', onclick: () => this.setSnap(!this.settings.snap.on) }, icon('snap', 14), h('span', { text: 'Snap' }));
    const snapMenu = h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Snap increments', title: 'Snap increments', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, this.snapMenuItems()); } }, icon('chevronDown', 13));
    const renderBtn = h('button', { class: 'studio-btn is-small is-primary', type: 'button', title: 'Render image (Ctrl+Shift+E)', onclick: () => io.renderImageDialog(this) }, icon('render', 14), h('span', { text: 'Render' }));
    const videoBtn = h('button', { class: 'studio-btn is-small', type: 'button', title: 'Render video (Ctrl+Shift+V)', onclick: () => io.renderVideoDialog(this) }, icon('video', 14), h('span', { class: 't3-hide-s', text: 'Video' }));
    this.optionsBar.append(
      h('div', { class: 'img-opt-tool' }, icon('cube', 16), h('span', { text: 'Transform' })),
      h('div', { class: 'img-opt-items' }, modeSeg, h('span', { class: 'img-opt-sep' }), this.spaceBtn, this.snapBtn, snapMenu, h('span', { class: 'img-opt-sep' }), renderBtn, videoBtn));
    this.syncOptions();
  }
  syncOptions() {
    this.root.querySelectorAll('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === this.mode;
      b.classList.toggle('is-active', on);
      if (b.classList.contains('t3-mode')) { b.classList.toggle('is-primary', on); b.classList.toggle('is-ghost', !on); b.setAttribute('aria-pressed', String(on)); }
    });
    if (this.spaceBtn) this.spaceBtn.replaceChildren(icon(this.space === 'world' ? 'globe' : 'local', 14), h('span', { text: this.space === 'world' ? 'World' : 'Local' }));
    if (this.snapBtn) { this.snapBtn.classList.toggle('is-on', this.settings.snap.on); this.snapBtn.setAttribute('aria-pressed', String(this.settings.snap.on)); }
  }

  buildDock() {
    clear(this.dockEl);
    const tools = h('div', { class: 'img-dock-tools' });
    const t = (ic, label, fn, data) => h('button', { class: 'img-dock-tool', type: 'button', 'aria-label': label, dataset: data || {}, onclick: fn }, icon(ic, 22), h('span', { text: label }));
    for (const [id, label, ic] of MODES) tools.appendChild(t(ic, label, () => this.setMode(id), { mode: id }));
    tools.append(
      t('plus', 'Add', () => menuSheet('Add', [{ label: 'Shapes', items: PRIMITIVES.map((p) => ({ label: p.label, action: () => this.addPrimitive(p.id) })) }, { label: 'Lights', items: LIGHTS.map((l) => ({ label: l.label, action: () => this.addLight(l.id) })) }, { label: 'Import model…', action: () => io.importDialog(this) }])),
      t('upload', 'Import', () => io.importDialog(this)),
      t('frame', 'Frame', () => this.frameSelection()),
      t('render', 'Render', () => io.renderImageDialog(this)),
      t('video', 'Video', () => io.renderVideoDialog(this)),
      t('snap', 'Snap', () => this.setSnap(!this.settings.snap.on), { snap: '1' }));
    const row = h('div', { class: 'img-dock-panels' },
      [['outliner', 'layers', 'Objects'], ['object', 'move', 'Transform'], ['material', 'palette', 'Material'], ['scene', 'sun', 'Scene'], ['camera', 'camera', 'Camera']].map(([k, ic, label]) =>
        h('button', { class: 'img-dock-panel', type: 'button', onclick: () => this.openPanel(k) }, icon(ic, 18), h('span', { text: label }))));
    this.dockEl.append(tools, row);
  }
  openPanel(k) {
    if ((k === 'object' || k === 'material') && !this.selected) { toast('Select an object first — tap it in the view or in Objects.', { timeout: 2200 }); return; }
    if (k === 'material' && !isLight(this.selected) && !materialsOf(this.selected).length) { toast('This object has no material.', { timeout: 1800 }); return; }
    this.panels.sheet(k);
  }

  buildStatus() {
    this.st = { objs: h('span', { class: 'studio-mono' }), tris: h('span', { class: 'studio-mono' }), sel: h('span', { class: 'img-status-layer' }), cam: h('span', { class: 'studio-mono' }), hint: h('span', { class: 'img-status-hint' }) };
    this.saveIndStatus = saveIndicator();
    this.statusEl.append(this.st.objs, this.st.tris, this.st.sel, this.st.cam, this.st.hint, h('span', { class: 'studio-spacer' }), h('span', { class: 'img-m-hide' }, this.saveIndStatus.el));
  }
  updateStatus() {
    if (!this.st) return;
    const v = this.viewport;
    const n = v.content.children.length, l = v.lights.children.length;
    this.st.objs.textContent = `${n} object${n === 1 ? '' : 's'} · ${l} light${l === 1 ? '' : 's'}`;
    this.st.tris.textContent = `${triangleCount(v.content).toLocaleString()} tris`;
    this.st.sel.textContent = this.selected ? 'Selected: ' + this.selected.name : '';
    this.updateCamLabel();
    this.st.hint.textContent = this.mobile.matches ? '' : 'Drag to orbit · right-drag / two fingers to pan · scroll or pinch to zoom · click to select';
    this.emptyEl.hidden = n > 0;
  }
  updateCamLabel() {
    const v = this.viewport; if (!v) return;
    const persp = v.camera.isPerspectiveCamera;
    const lab = persp ? `Perspective · ${Math.round(v.persp.fov)}°` : 'Orthographic';
    this.camBtn.replaceChildren(icon(persp ? 'persp' : 'ortho', 14), h('span', { text: lab }), icon('chevronDown', 12));
    if (this.st) this.st.cam.textContent = lab;
  }
  updateTitle() {
    const n = this.name || 'Untitled scene';
    if (this.titleEl) this.titleEl.textContent = n + (this.dirty ? ' •' : '');
    document.title = n + ' — EYAD 3D';
  }

  // ------------------------------------------------------------ modes / snapping
  setMode(m) {
    this.mode = m;
    if (m === 'select') this.viewport.attach(null);
    else { this.viewport.gizmo.setMode(m); this.viewport.attach(this.selected); }
    this.syncOptions();
  }
  setSpace(s) { this.space = s; this.viewport.gizmo.setSpace(s); this.syncOptions(); }
  setSnap(on, { temp = false } = {}) {
    const g = this.viewport.gizmo, s = this.settings.snap;
    if (!temp) s.on = on;
    const use = on;
    g.setTranslationSnap(use ? s.move : null);
    g.setRotationSnap(use ? THREE.MathUtils.degToRad(s.rotate) : null);
    g.setScaleSnap(use ? s.scale : null);
    if (!temp) { this.syncOptions(); this.root.querySelectorAll('[data-snap]').forEach((b) => b.classList.toggle('is-active', on)); }
  }
  snapMenuItems() {
    const s = this.settings.snap;
    const pick = (key, v) => () => { s[key] = v; this.setSnap(true); };
    return [
      { heading: 'Move' }, ...[0.05, 0.1, 0.25, 0.5, 1].map((v) => ({ label: v + ' m', checked: () => s.move === v, action: pick('move', v) })),
      { heading: 'Rotate' }, ...[5, 15, 45, 90].map((v) => ({ label: v + '°', checked: () => s.rotate === v, action: pick('rotate', v) })),
      { heading: 'Scale' }, ...[0.05, 0.1, 0.25, 0.5].map((v) => ({ label: '×' + v, checked: () => s.scale === v, action: pick('scale', v) })),
    ];
  }

  // ------------------------------------------------------------ history
  onHistory() {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = !this.hist.canUndo;
    this.redoBtn.disabled = !this.hist.canRedo;
    this.updateTitle();
    io.updateSaveIndicator(this);
  }
  undo() { if (this.viewport.gizmo.dragging) return; const c = this.hist.undo(); if (c) toast('Undo ' + c.label, { timeout: 900 }); }
  redo() { if (this.viewport.gizmo.dragging) return; const c = this.hist.redo(); if (c) toast('Redo ' + c.label, { timeout: 900 }); }
  markSaved() { this.hist.markSaved(); this.forceDirty = false; this.updateTitle(); io.updateSaveIndicator(this); }

  /** Apply `redo`, record it, and refresh. */
  exec(label, redo, undo, { panels = true } = {}) {
    redo();
    this.hist.push({ label, redo: () => { redo(); this.afterChange(); }, undo: () => { undo(); this.afterChange(); } });
    this.afterChange({ panels });
  }
  /** A single value change that coalesces while a slider / colour picker is dragged. */
  valueCmd(label, get, set, value, coalesce) {
    const before = get();
    set(value);
    const cmd = { label, before, after: value, coalesce, undo: () => { set(cmd.before); this.afterChange(); }, redo: () => { set(cmd.after); this.afterChange(); }, merge: (next) => { cmd.after = next.after; return true; } };
    this.hist.push(cmd);
    this.afterChange({ panels: false });
  }
  afterChange({ panels = true } = {}) {
    if (this.selected && !this.selected.parent) this.select(null, { quiet: true });
    this.viewport.fitShadows();
    this.viewport.invalidate();
    if (this.mode !== 'select' && this.selected?.visible) { if (this.viewport.gizmo.object !== this.selected) this.viewport.attach(this.selected); } else if (!this.selected?.visible) this.viewport.attach(null);
    if (panels) { this.panels.refresh(); this.timeline.update(true); }
    this.updateStatus();
    this.updateTitle();
    io.updateSaveIndicator(this);
  }

  // ------------------------------------------------------------ objects & selection
  allObjects() { return [...this.viewport.content.children, ...this.viewport.lights.children]; }
  findById(id) { return this.allObjects().find((o) => o.userData.eyadId === id) || null; }

  select(obj, { quiet = false } = {}) {
    if (obj && !obj.parent) obj = null;
    this.selected = obj || null;
    if (this.mode !== 'select') this.viewport.attach(this.selected);
    this.viewport.invalidate();
    if (quiet) return;
    this.panels.refresh();
    this.timeline.update(true);
    this.updateStatus();
    if (obj) requestAnimationFrame(() => this.panelsEl.querySelector('.t3-out-row.is-on')?.scrollIntoView({ block: 'nearest' }));
  }

  addObject(obj, { label = 'Add', clips = [], select = true } = {}) {
    const parent = isLight(obj) ? this.viewport.lights : this.viewport.content;
    const entries = clips.map((clip) => ({ clip, root: obj, enabled: true }));
    const prevSel = this.selected;
    let durBefore = this.anim.duration, durAfter = durBefore;
    if (entries.length) {
      const maxDur = Math.max(...entries.map((e) => e.clip.duration || 0));
      if (maxDur > durBefore && !this.hasKeys()) durAfter = Math.min(600, Math.round(maxDur * 100) / 100);
    }
    this.exec(label, () => {
      parent.add(obj);
      for (const e of entries) this.registerClip(e);
      this.anim.duration = durAfter;
      if (select) this.select(obj, { quiet: true });
    }, () => {
      parent.remove(obj);
      for (const e of entries) this.unregisterClip(e);
      this.anim.duration = durBefore;
      if (this.selected === obj) this.select(prevSel && prevSel.parent ? prevSel : null, { quiet: true });
    });
    if (durAfter !== durBefore) toast(`Timeline set to ${durAfter.toFixed(2)} s to fit the model's animation.`, { timeout: 2600 });
    if (entries.length) this.evaluate(this.time);
  }
  addPrimitive(kind) {
    const m = createPrimitive(kind);
    // don't stack new shapes exactly inside each other
    const n = this.viewport.content.children.filter((o) => o.userData.eyadKind === 'primitive').length;
    if (n) { const a = n * 2.39996; m.position.x = Math.round(Math.cos(a) * Math.min(3, 0.9 + n * 0.35) * 100) / 100; m.position.z = Math.round(Math.sin(a) * Math.min(3, 0.9 + n * 0.35) * 100) / 100; }
    this.addObject(m, { label: 'Add ' + m.name });
    if (this.mode === 'select') this.setMode('translate');
  }
  addLight(kind) {
    const l = createLight(kind);
    this.addObject(l, { label: 'Add ' + l.name });
    if (!this.settings.shadows && l.castShadow) toast('Scene shadows are off — turn them on in Environment.', { timeout: 2600 });
  }
  addMenuItems() {
    return [
      { heading: 'Shapes' }, ...PRIMITIVES.map((p) => ({ label: p.label, action: () => this.addPrimitive(p.id) })),
      { heading: 'Lights' }, ...LIGHTS.map((l) => ({ label: l.label, action: () => this.addLight(l.id) })),
      { separator: true },
      { label: 'Import model…', shortcut: 'Mod+I', action: () => io.importDialog(this) },
    ];
  }
  objectMenuItems(o) {
    return [
      { heading: o.name },
      { label: 'Rename…', action: async () => { const v = await promptDialog('Rename', 'Name', o.name); if (v) this.rename(o, v); } },
      { label: 'Duplicate', shortcut: 'Mod+D', action: () => { this.select(o); this.duplicateSelected(); } },
      { label: o.visible ? 'Hide' : 'Show', shortcut: 'H', action: () => this.setVisible(o, !o.visible) },
      { label: 'Frame', shortcut: 'F', action: () => this.viewport.frame(o.isLight ? null : o) },
      { separator: true },
      { label: 'Key at playhead', shortcut: 'K', action: () => { this.select(o); this.keySelected(); } },
      !o.isLight ? { label: 'Spin 360° (turntable)', action: () => { this.select(o); this.turntable('object'); } } : null,
      !o.isLight ? { label: 'Drop to ground', action: () => this.dropToGround(o) } : null,
      { label: 'Reset transform', action: () => this.resetTransform(o) },
      { separator: true },
      { label: 'Delete', shortcut: 'Delete', action: () => { this.select(o); this.deleteSelected(); } },
    ].filter(Boolean);
  }

  deleteSelected() {
    const o = this.selected; if (!o) return;
    const parent = o.parent, idx = parent.children.indexOf(o);
    const id = o.userData.eyadId;
    const track = this.anim.tracks[id];
    const entries = this.clips.filter((c) => c.root === o);
    this.exec('Delete ' + o.name, () => {
      parent.remove(o);
      delete this.anim.tracks[id];
      for (const e of entries) this.unregisterClip(e);
      this.select(null, { quiet: true });
    }, () => {
      parent.add(o);
      parent.children.splice(parent.children.indexOf(o), 1); parent.children.splice(idx, 0, o);
      if (track) this.anim.tracks[id] = track;
      for (const e of entries) this.registerClip(e);
      this.select(o, { quiet: true });
    });
  }
  duplicateSelected() {
    const o = this.selected; if (!o) return;
    const c = duplicateObject(o);
    if (!c.isLight) { const b = boundsOf(o); c.position.x += Math.max(0.3, (b.max.x - b.min.x) * 1.15); }
    else c.position.x += 0.6;
    const clips = this.clips.filter((e) => e.root === o).map((e) => e.clip);
    this.addObject(c, { label: 'Duplicate', clips });
  }
  rename(o, name) {
    const before = o.name, after = String(name).slice(0, 120);
    this.exec('Rename', () => { o.name = after; }, () => { o.name = before; });
  }
  setVisible(o, v) {
    this.exec(v ? 'Show' : 'Hide', () => { o.visible = v; }, () => { o.visible = !v; });
  }
  setMeshFlag(o, key, v) {
    const meshes = []; o.traverse((n) => { if (n.isMesh) meshes.push([n, n[key]]); });
    this.exec(key === 'castShadow' ? 'Cast shadows' : 'Receive shadows', () => { for (const [m] of meshes) m[key] = v; }, () => { for (const [m, was] of meshes) m[key] = was; });
  }
  setClipEnabled(c, v) {
    this.exec(v ? 'Enable clip' : 'Disable clip', () => { c.enabled = v; if (c.action) c.action.enabled = v; this.evaluate(this.time); }, () => { c.enabled = !v; if (c.action) c.action.enabled = !v; this.evaluate(this.time); });
  }

  // ------------------------------------------------------------ transforms
  trOf(o) { return { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }; }
  setTr(o, t) { o.position.copy(t.p); o.quaternion.copy(t.q); o.scale.copy(t.s); }
  sameTr(a, b) { return a.p.equals(b.p) && a.q.equals(b.q) && a.s.equals(b.s); }
  beginTransform(o) { if (!this.trBefore || this.trBefore.o !== o) this.trBefore = { o, t: this.trOf(o), anim: JSON.stringify(this.anim) }; }
  commitTransform(o, label) {
    const b = this.trBefore; this.trBefore = null;
    if (!b || b.o !== o) return;
    const after = this.trOf(o);
    if (this.sameTr(b.t, after)) return;
    const id = o.userData.eyadId;
    const keys = this.anim.tracks[id];
    const tol = 0.5 / this.fps;
    let keyed = false;
    if (this.autoKey || (keys && keyIndexAt(keys, this.time, tol) >= 0)) { setObjectKey(this.anim, o, this.time, tol); keyed = true; }
    else if (keys && keys.length && !this.warnedKeys) { this.warnedKeys = true; toast('This object is animated — press K to key the change, or turn on Auto-key. Otherwise it returns to its keys when the timeline moves.', { type: 'warn', timeout: 6000 }); }
    const animBefore = b.anim, animAfter = JSON.stringify(this.anim);
    const cmd = {
      label: keyed ? label + ' (keyed)' : label,
      undo: () => { this.setTr(o, b.t); if (keyed) this.anim = JSON.parse(animBefore); this.afterChange(); },
      redo: () => { this.setTr(o, after); if (keyed) this.anim = JSON.parse(animAfter); this.afterChange(); },
    };
    this.hist.push(cmd);
    this.afterChange();
  }
  onGizmoStart() { if (this.selected) this.beginTransform(this.selected); if (this.playing) this.togglePlay(false); }
  onGizmoChange() { this.panels.syncTransform(); }
  onGizmoEnd() { if (this.selected) this.commitTransform(this.selected, { translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[this.mode] || 'Transform'); }
  onCameraMoved() { this.updateCamLabel(); }
  onCameraEnd() { /* camera moves are not part of undo */ }

  dropToGround(o) {
    this.beginTransform(o);
    const b = boundsOf(o);
    o.position.y -= b.min.y;
    this.commitTransform(o, 'Drop to ground');
  }
  resetTransform(o) {
    this.beginTransform(o);
    if (o.userData.eyadKind === 'primitive') { o.quaternion.identity(); o.scale.set(1, 1, 1); o.position.set(0, 0, 0); o.updateWorldMatrix(true, true); o.position.y -= boundsOf(o).min.y; }
    else if (o.isLight) { o.position.set(4, 6, 3); o.lookAt(0, 0, 0); }
    else { o.quaternion.identity(); o.position.set(0, 0, 0); o.updateWorldMatrix(true, true); o.position.y -= boundsOf(o).min.y; }
    this.commitTransform(o, 'Reset transform');
  }
  aimLightAtSelection(l) {
    const b = this.viewport.contentBounds();
    const c = b ? b.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    this.beginTransform(l);
    l.lookAt(c);
    this.commitTransform(l, 'Aim light');
  }
  frameSelection() { this.viewport.frame(this.selected && !this.selected.isLight ? this.selected : null); }

  // ------------------------------------------------------------ materials & lights
  selectedMaterial() {
    const o = this.selected;
    if (!o || isLight(o)) return null;
    const mats = materialsOf(o);
    if (!mats.length) return null;
    return mats[Math.min(this.panels.matOwner === o ? this.panels.matIndex : 0, mats.length - 1)];
  }
  setMaterialProp(m, label, key, value, coalesce) {
    const isColor = key === 'color' || key === 'emissive';
    const get = () => (isColor ? '#' + m[key].getHexString() : m[key]);
    const set = (v) => {
      if (isColor) m[key].set(v);
      else m[key] = v;
      if (key === 'opacity') {
        if (m.userData.eyadBaseTransparent === undefined) m.userData.eyadBaseTransparent = !!m.transparent;
        const want = v < 1 || m.userData.eyadBaseTransparent;
        if (m.transparent !== want) { m.transparent = want; m.needsUpdate = true; }
      }
      if (key === 'flatShading' || key === 'side' || key === 'wireframe') m.needsUpdate = true;
      this.viewport.invalidate();
    };
    if (coalesce) this.valueCmd(label, get, set, value, 'mat:' + m.uuid + ':' + coalesce);
    else this.exec(label, () => set(value), (() => { const b = get(); return () => set(b); })());
  }
  setMaterialMap(tex) {
    const m = this.selectedMaterial();
    if (!m) { toast('Select an object with a material first.', { type: 'warn' }); return; }
    const before = { map: m.map, color: '#' + m.color.getHexString() };
    const whiten = !!tex && !before.map;
    this.exec(tex ? 'Set texture' : 'Remove texture', () => { m.map = tex; if (whiten) m.color.set('#ffffff'); m.needsUpdate = true; }, () => { m.map = before.map; m.color.set(before.color); m.needsUpdate = true; });
  }
  pickTexture() { return io.pickTexture(this); }
  setLightProp(l, label, key, value, coalesce) {
    const isColor = key === 'color' || key === 'groundColor';
    const get = () => (isColor ? '#' + l[key].getHexString() : l[key]);
    const set = (v) => { if (isColor) l[key].set(v); else l[key] = v; this.viewport.invalidate(); };
    if (coalesce) this.valueCmd(label, get, set, value, 'light:' + l.uuid + ':' + coalesce);
    else { const b = get(); this.exec(label, () => set(value), () => set(b)); }
  }

  // ------------------------------------------------------------ scene settings
  changeSettings(label, fn, coalesce) {
    const before = JSON.stringify(this.settings);
    fn();
    const after = JSON.stringify(this.settings);
    if (before === after) return;
    const apply = (json) => { this.settings = JSON.parse(json); this.viewport.applySettings(); this.setSnap(this.settings.snap.on); };
    this.viewport.applySettings();
    const cmd = { label, after, coalesce: coalesce ? 'set:' + coalesce : undefined, undo: () => { apply(before); this.afterChange(); }, redo: () => { apply(cmd.after); this.afterChange(); }, merge: (next) => { cmd.after = next.after; return true; } };
    this.hist.push(cmd);
    this.afterChange({ panels: !coalesce });
  }

  // ------------------------------------------------------------ camera
  setProjection(t) { this.viewport.setProjection(t); this.updateCamLabel(); this.panels.refresh(); }
  setFov(f) { const p = this.viewport.persp; p.fov = f; p.updateProjectionMatrix(); this.viewport.invalidate(); this.updateCamLabel(); }
  viewState() {
    const v = this.viewport;
    return { type: v.camera.isOrthographicCamera ? 'ortho' : 'persp', pos: v.camera.position.toArray(), target: v.orbit.target.toArray(), fov: v.persp.fov, zoom: v.camera.zoom, orthoHalf: v.orthoHalf || 3 };
  }
  applyView(s, { animate = false } = {}) {
    const v = this.viewport;
    if ((s.type === 'ortho') !== v.camera.isOrthographicCamera) v.setProjection(s.type);
    const to = { pos: new THREE.Vector3().fromArray(s.pos), target: new THREE.Vector3().fromArray(s.target), fov: s.fov, zoom: s.zoom };
    if (s.type === 'ortho') { v.orthoHalf = s.orthoHalf || 3; v.updateProjection(v.camera, v.w / v.h); }
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      v.camera.position.copy(to.pos); v.orbit.target.copy(to.target); v.persp.fov = to.fov; v.persp.updateProjectionMatrix(); v.camera.zoom = to.zoom; v.camera.updateProjectionMatrix(); v.orbit.update(); v.invalidate(); this.updateCamLabel();
      return;
    }
    this.tween = { t0: performance.now(), dur: 450, from: { pos: v.camera.position.clone(), target: v.orbit.target.clone(), fov: v.persp.fov, zoom: v.camera.zoom }, to };
  }
  runTween() {
    const tw = this.tween; if (!tw) return false;
    const v = this.viewport;
    const u = Math.min(1, (performance.now() - tw.t0) / tw.dur), e = u * u * (3 - 2 * u);
    v.camera.position.lerpVectors(tw.from.pos, tw.to.pos, e);
    v.orbit.target.lerpVectors(tw.from.target, tw.to.target, e);
    v.persp.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * e; v.persp.updateProjectionMatrix();
    v.camera.zoom = tw.from.zoom + (tw.to.zoom - tw.from.zoom) * e; v.camera.updateProjectionMatrix();
    v.camera.lookAt(v.orbit.target);
    if (u >= 1) { this.tween = null; v.orbit.update(); this.updateCamLabel(); }
    return true;
  }
  async addBookmark() {
    const name = await promptDialog('Save view', 'Name', 'View ' + (this.bookmarks.length + 1), { ok: 'Save' });
    if (!name) return;
    const b = { id: uid('b'), name: name.slice(0, 60), ...this.viewState() };
    this.exec('Save view', () => { this.bookmarks.push(b); }, () => { this.bookmarks.splice(this.bookmarks.indexOf(b), 1); });
  }
  goBookmark(b) { this.applyView(b, { animate: true }); }
  updateBookmark(b) {
    const before = { ...b }, after = { ...b, ...this.viewState() };
    this.exec('Update view', () => Object.assign(b, after), () => Object.assign(b, before));
    toast(`“${b.name}” updated to the current view`, { timeout: 1500 });
  }
  deleteBookmark(b) {
    const i = this.bookmarks.indexOf(b);
    this.exec('Delete view', () => { this.bookmarks.splice(i, 1); }, () => { this.bookmarks.splice(i, 0, b); });
  }
  viewMenuItems() {
    const v = this.viewport;
    return [
      { heading: 'Camera' },
      { label: 'Perspective', checked: () => v.camera.isPerspectiveCamera, action: () => this.setProjection('persp') },
      { label: 'Orthographic', shortcut: '5', checked: () => v.camera.isOrthographicCamera, action: () => this.setProjection('ortho') },
      { separator: true },
      { label: 'Front', shortcut: '1', action: () => v.setView('front') },
      { label: 'Right', shortcut: '3', action: () => v.setView('right') },
      { label: 'Top', shortcut: '7', action: () => v.setView('top') },
      { label: 'Back', action: () => v.setView('back') },
      { separator: true },
      { label: 'Frame selection', shortcut: 'F', action: () => this.frameSelection() },
      { label: 'Frame all', shortcut: 'A', action: () => v.frame(null) },
      ...(this.bookmarks.length ? [{ heading: 'Bookmarks' }, ...this.bookmarks.map((b) => ({ label: b.name, action: () => this.goBookmark(b) }))] : []),
      { separator: true },
      { label: 'Save current view…', action: () => this.addBookmark() },
    ];
  }

  // ------------------------------------------------------------ clips (glTF animations)
  registerClip(e) {
    if (!this.clips.includes(e)) this.clips.push(e);
    let mixer = this.mixers.get(e.root);
    if (!mixer) { mixer = new THREE.AnimationMixer(e.root); this.mixers.set(e.root, mixer); }
    e.action = mixer.clipAction(e.clip);
    e.action.enabled = e.enabled;
    e.action.play();
  }
  unregisterClip(e) {
    const i = this.clips.indexOf(e); if (i >= 0) this.clips.splice(i, 1);
    const mixer = this.mixers.get(e.root);
    if (mixer) { mixer.uncacheAction(e.clip); if (!this.clips.some((c) => c.root === e.root)) { mixer.stopAllAction(); this.mixers.delete(e.root); } }
    e.action = null;
  }

  // ------------------------------------------------------------ animation
  hasKeys() { return this.anim.camera.length > 0 || Object.values(this.anim.tracks).some((k) => k.length); }
  hasAnimation() { return this.hasKeys() || this.clips.some((c) => c.enabled); }
  animBegin() { if (!this.animPending) this.animPending = JSON.stringify(this.anim); }
  animCancel() { this.animPending = null; }
  animEnd(label) {
    const before = this.animPending; this.animPending = null;
    if (!before) return;
    const after = JSON.stringify(this.anim);
    if (after === before) return;
    this.hist.push({ label, undo: () => { this.anim = JSON.parse(before); this.afterChange(); }, redo: () => { this.anim = JSON.parse(after); this.afterChange(); } });
    this.afterChange();
  }
  animChange(label, fn) { this.animBegin(); fn(); this.animEnd(label); }
  keySelected() {
    const o = this.selected;
    if (!o) { toast('Select an object to key it.', { timeout: 1600 }); return; }
    this.animChange('Key ' + o.name, () => setObjectKey(this.anim, o, this.time, 0.5 / this.fps));
    toast(`Keyed ${o.name} at ${this.time.toFixed(2)} s`, { timeout: 1200 });
  }
  keyCamera() {
    this.animChange('Key camera', () => setCameraKey(this.anim, this.viewport.camera, this.viewport.orbit.target, this.time, 0.5 / this.fps));
    toast(`Keyed the camera at ${this.time.toFixed(2)} s`, { timeout: 1200 });
  }
  turntable(kind) {
    const d = this.anim.duration;
    if (kind === 'object') {
      const o = this.selected; if (!o) { toast('Select an object to spin.', { timeout: 1600 }); return; }
      this.evaluate(0);
      const id = o.userData.eyadId;
      const had = this.anim.tracks[id]?.length || 0;
      this.animChange('Spin ' + o.name, () => { this.anim.tracks[id] = turntableKeys(o, 0, d); });
      toast(`${o.name} spins 360° over ${d.toFixed(1)} s${had ? ` (replaced ${had} key${had > 1 ? 's' : ''})` : ''} — press Space to play.`, { timeout: 2600 });
    } else {
      const had = this.anim.camera.length;
      this.animChange('Camera orbit', () => { this.anim.camera = cameraTurntable(this.viewport.camera, this.viewport.orbit.target, 0, d); });
      toast(`Camera orbits once over ${d.toFixed(1)} s${had ? ' (replaced camera keys)' : ''} — press Space to play.`, { timeout: 2600 });
    }
    this.setTime(0);
  }
  clearKeys(kind) {
    if (kind === 'camera') this.animChange('Clear camera keys', () => { this.anim.camera = []; });
    else if (this.selected) { const id = this.selected.userData.eyadId; this.animChange('Clear keys', () => { delete this.anim.tracks[id]; }); }
  }
  setAutoKey(v) {
    this.autoKey = !!v;
    try { localStorage.setItem(AUTOKEY_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ }
    this.timeline.update(true); this.panels.refresh();
  }
  animMenuItems() {
    return [
      { label: () => (this.playing ? 'Pause' : 'Play'), shortcut: 'Space', action: () => this.togglePlay() },
      { label: 'Go to start', shortcut: 'Home', action: () => this.setTime(0) },
      { separator: true },
      { label: 'Key selection', shortcut: 'K', action: () => this.keySelected(), enabled: () => !!this.selected },
      { label: 'Key camera', shortcut: 'Shift+K', action: () => this.keyCamera() },
      { label: 'Auto-key', checked: () => this.autoKey, action: () => this.setAutoKey(!this.autoKey) },
      { separator: true },
      { label: 'Spin selection 360° (turntable)', action: () => this.turntable('object'), enabled: () => !!this.selected },
      { label: 'Orbit camera 360°', action: () => this.turntable('camera') },
      { separator: true },
      { label: 'Loop playback', checked: () => this.anim.loop, action: () => this.animChange('Loop', () => { this.anim.loop = !this.anim.loop; }) },
      { label: 'Duration…', action: async () => { const v = await promptDialog('Timeline duration', 'Seconds', String(this.anim.duration)); const n = Number(v); if (v && Number.isFinite(n) && n > 0) this.animChange('Duration', () => { this.anim.duration = Math.min(600, Math.max(0.1, n)); }); } },
      { label: 'Clear selection keys', action: () => this.clearKeys('object'), enabled: () => !!(this.selected && this.anim.tracks[this.selected.userData.eyadId]) },
      { label: 'Clear camera keys', action: () => this.clearKeys('camera'), enabled: () => this.anim.camera.length > 0 },
      { separator: true },
      { label: 'Animation panel', action: () => (this.mobile.matches ? this.panels.sheet('anim') : this.panels.focus('anim')) },
    ];
  }
  togglePlay(force) {
    const on = force === undefined ? !this.playing : !!force;
    if (on === this.playing) return;
    this.playing = on;
    if (on) {
      if (this.time >= this.anim.duration - 1e-6) this.time = 0;
      this.lastTick = performance.now();
      if (!this.hasAnimation()) toast('Nothing is animated yet — key an object (K), key the camera (Shift+K) or use a turntable.', { timeout: 3200 });
    } else this.panels.refresh();
    this.timeline.update(true);
  }
  setTime(t) {
    this.time = Math.max(0, Math.min(this.anim.duration, t));
    this.evaluate(this.time);
    this.timeline.update();
    this.hudTime.textContent = '';
  }
  /** Apply keyframes / clips at time t. */
  evaluate(t, { cameraKeys = null, skipCamera = false } = {}) {
    for (const [root, mixer] of this.mixers) if (root.parent) mixer.setTime(t);
    for (const o of this.allObjects()) { const k = this.anim.tracks[o.userData.eyadId]; if (k && k.length) sampleObject(k, t, o); }
    const ck = cameraKeys || this.anim.camera;
    if (!skipCamera && ck && ck.length) {
      const s = sampleCamera(ck, t);
      const v = this.viewport;
      v.orbit.target.copy(s.target);
      v.camera.position.copy(s.pos);
      v.camera.lookAt(s.target);
      if (s.fov != null && v.camera.isPerspectiveCamera) { v.persp.fov = s.fov; v.persp.updateProjectionMatrix(); }
      if (v.camera.isOrthographicCamera) { v.camera.zoom = s.zoom; v.camera.updateProjectionMatrix(); }
    }
    this.viewport.invalidate();
    this.panels.syncTransform();
  }
  captureViewState() { return { time: this.time, view: this.viewState() }; }
  restoreViewState(s) { this.evaluate(s.time, { skipCamera: true }); this.applyView(s.view); }
  makeCameraTurntable(dur) { return cameraTurntable(this.viewport.camera, this.viewport.orbit.target, 0, dur); }

  /** Called by the viewport every frame; returns true when a redraw is needed. */
  tick() {
    let busy = this.runTween();
    if (this.playing) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastTick) / 1000);
      this.lastTick = now;
      let t = this.time + dt;
      const d = this.anim.duration;
      if (t >= d) { if (this.anim.loop) t = d > 0 ? t % d : 0; else { t = d; this.playing = false; this.panels.refresh(); } }
      this.time = t;
      this.evaluate(t);
      this.timeline.update(!this.playing);
      busy = true;
    }
    return busy;
  }

  // ------------------------------------------------------------ whole scene
  clearScene() {
    const v = this.viewport;
    for (const o of [...v.content.children]) { v.content.remove(o); disposeObject(o); }
    for (const l of [...v.lights.children]) v.lights.remove(l);
    for (const e of [...this.clips]) this.unregisterClip(e);
    this.mixers.clear();
    this.selected = null;
    v.attach(null);
  }
  resetScene({ quiet = false } = {}) {
    this.loadScene({ name: 'Untitled scene', settings: defaultSettings(), objects: [], clips: [], lights: [createLight('directional', { name: 'Key light' })], anim: newAnim(), bookmarks: [], projectId: null });
    if (!quiet) toast('New scene', { timeout: 1000 });
  }
  /** Replace everything (open project / new scene). Not undoable; clears history. */
  loadScene({ name, settings, objects, clips, lights, anim, bookmarks, selectedId = null, projectId = null }) {
    this.playing = false;
    this.clearScene();
    const v = this.viewport;
    this.name = name;
    this.settings = settings;
    this.anim = anim;
    this.bookmarks = bookmarks;
    for (const o of objects) v.content.add(o);
    for (const l of lights) v.lights.add(l);
    for (const clip of clips) {
      const nodeNames = clip.tracks.map((t) => THREE.PropertyBinding.parseTrackName(t.name).nodeName);
      const root = objects.find((o) => nodeNames.every((n) => !n || THREE.PropertyBinding.findNode(o, n))) || null;
      if (root) this.registerClip({ clip, root, enabled: true });
    }
    // camera
    const c = settings.camera;
    v.setProjection(c.type);
    v.persp.fov = c.fov; v.persp.updateProjectionMatrix();
    if (c.type === 'ortho') v.orthoHalf = c.orthoHalf || 3;
    v.camera.position.fromArray(c.pos);
    v.orbit.target.fromArray(c.target);
    v.camera.zoom = c.zoom || 1;
    v.updateProjection(v.camera, v.w / v.h);
    v.orbit.update();
    v.applySettings();
    this.setSnap(settings.snap.on);
    this.rec = { projectId, created: Date.now(), id: uid('r') };
    this.hist.clear();
    this.forceDirty = false;
    this.time = 0;
    this.select(selectedId ? this.findById(selectedId) : null, { quiet: true });
    if (this.hasAnimation()) this.evaluate(0, { skipCamera: true });
    this.afterChange();
    this.updateCamLabel();
  }

  // ------------------------------------------------------------ menus / commands
  buildMenus() {
    const has = () => !!this.selected;
    return [
      { label: 'File', items: [
        { label: 'New Scene', shortcut: 'Mod+Alt+N', action: () => io.newScene(this), icon: 'plus' },
        { label: 'Open… (.eyad / model)', shortcut: 'Mod+O', action: () => io.openDialog(this), icon: 'folder' },
        { label: 'Import Model… (.glb .gltf .obj .stl .fbx)', shortcut: 'Mod+I', action: () => io.importDialog(this), icon: 'upload' },
        { separator: true },
        { label: 'Save', shortcut: 'Mod+S', action: () => io.save(this), icon: 'save' },
        { label: 'Save As…', shortcut: 'Mod+Shift+S', action: () => io.saveAs(this) },
        { label: 'Download .eyad Project', action: () => io.downloadEyad(this), icon: 'download' },
        { label: 'Export GLB…', shortcut: 'Mod+E', action: () => io.exportGLB(this), icon: 'download' },
        { separator: true },
        { label: 'Rename Scene…', action: () => io.renameScene(this) },
        { label: 'Browse Projects', action: () => { location.href = ROUTES.projects; } },
        { label: 'Back to Portfolio', action: () => goPortfolio() },
      ] },
      { label: 'Edit', items: [
        { label: () => 'Undo' + (this.hist.canUndo ? ' ' + this.hist.stack[this.hist.index].label : ''), shortcut: 'Mod+Z', action: () => this.undo(), enabled: () => this.hist.canUndo, icon: 'undo' },
        { label: () => 'Redo' + (this.hist.canRedo ? ' ' + this.hist.stack[this.hist.index + 1].label : ''), shortcut: 'Mod+Shift+Z', action: () => this.redo(), enabled: () => this.hist.canRedo, icon: 'redo' },
        { separator: true },
        { label: 'Duplicate', shortcut: 'Mod+D', action: () => this.duplicateSelected(), enabled: has },
        { label: 'Delete', shortcut: 'Delete', action: () => this.deleteSelected(), enabled: has },
        { label: 'Hide / Show', shortcut: 'H', action: () => this.selected && this.setVisible(this.selected, !this.selected.visible), enabled: has },
        { label: 'Show All', shortcut: 'Alt+H', action: () => this.showAll() },
        { label: 'Deselect', shortcut: 'Esc', action: () => this.select(null), enabled: has },
        { separator: true },
        { label: 'Move', shortcut: 'W', action: () => this.setMode('translate'), checked: () => this.mode === 'translate' },
        { label: 'Rotate', shortcut: 'E', action: () => this.setMode('rotate'), checked: () => this.mode === 'rotate' },
        { label: 'Scale', shortcut: 'R', action: () => this.setMode('scale'), checked: () => this.mode === 'scale' },
        { label: 'Local Axes', shortcut: 'L', action: () => this.setSpace(this.space === 'world' ? 'local' : 'world'), checked: () => this.space === 'local' },
        { label: 'Snapping', action: () => this.setSnap(!this.settings.snap.on), checked: () => this.settings.snap.on },
        { separator: true },
        { label: 'Preferences…', action: () => { location.href = ROUTES.settings; }, icon: 'gear' },
      ] },
      { label: 'Add', items: this.addMenuItems().filter((x) => !x.heading).map((x) => x) },
      { label: 'View', items: [
        ...this.viewMenuItems().filter((x) => !x.heading),
        { separator: true },
        { label: 'Grid', checked: () => this.settings.ground.grid, action: () => this.changeSettings('Grid', () => { this.settings.ground.grid = !this.settings.ground.grid; }) },
        { label: 'Panels', shortcut: 'Tab', action: () => this.root.classList.toggle('is-panels-hidden') },
        { label: 'Full Screen', action: () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); } },
      ] },
      { label: 'Animation', items: this.animMenuItems() },
      { label: 'Render', items: [
        { label: 'Render Image…', shortcut: 'Mod+Shift+E', action: () => io.renderImageDialog(this), icon: 'image' },
        { label: 'Render Video…', shortcut: 'Mod+Shift+V', action: () => io.renderVideoDialog(this), icon: 'video' },
        { separator: true },
        { label: 'Send Still to EYAD IMAGE…', action: () => io.renderImageDialog(this, { dest: 'image' }), icon: 'image' },
        { label: 'Send Video to EYAD VIDEO…', action: () => io.renderVideoDialog(this, { dest: 'video' }), icon: 'video' },
        { separator: true },
        { label: 'Export GLB…', action: () => io.exportGLB(this) },
      ] },
      { label: 'Help', items: [
        { label: 'Keyboard Shortcuts', action: () => this.shortcutsDialog() },
        { label: 'Supported 3D Files', action: () => this.filesDialog() },
        { label: 'Studio Help', action: () => { location.href = ROUTES.help; } },
        ...experienceHelp('3d'),
      ] },
    ];
  }
  showAll() {
    const hidden = this.allObjects().filter((o) => !o.visible);
    if (!hidden.length) return;
    this.exec('Show all', () => hidden.forEach((o) => { o.visible = true; }), () => hidden.forEach((o) => { o.visible = false; }));
  }
  commands() {
    const out = [];
    const walk = (items, group) => {
      for (const it of items) {
        if (!it || it.separator || it.heading) continue;
        const label = typeof it.label === 'function' ? it.label() : it.label;
        const sub = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
        if (sub) walk(sub, group + ' › ' + label);
        else if (it.action && (it.enabled === undefined || (typeof it.enabled === 'function' ? it.enabled() : it.enabled))) out.push({ label, group, shortcut: it.shortcut, run: it.action, icon: it.icon });
      }
    };
    for (const m of this.menus) walk(m.items, m.label);
    return out;
  }
  shortcutsDialog() {
    const rows = [
      ['Orbit / pan / zoom', 'Drag · right-drag or Shift-drag · scroll (touch: one finger · two fingers · pinch)'],
      ['Select', 'Click / tap an object'], ['Select / Move / Rotate / Scale', 'Q / W / E / R'], ['World / local axes', 'L'], ['Snap temporarily', 'Hold Shift while dragging'],
      ['Frame selection / all', 'F / A'], ['Front / right / top view', '1 / 3 / 7'], ['Perspective ↔ orthographic', '5'],
      ['Duplicate / delete', keyLabel('Mod+D') + ' / Delete'], ['Hide / show all', 'H / Alt+H'],
      ['Play / pause', 'Space'], ['Previous / next frame', ', / .'], ['Key selection / key camera', 'K / Shift+K'],
      ['Undo / redo', keyLabel('Mod+Z') + ' / ' + keyLabel('Mod+Shift+Z')], ['Save', keyLabel('Mod+S')], ['Import model', keyLabel('Mod+I')], ['Export GLB', keyLabel('Mod+E')],
      ['Render image / video', keyLabel('Mod+Shift+E') + ' / ' + keyLabel('Mod+Shift+V')], ['Command palette', keyLabel('Mod+K')],
    ];
    return dialog({ title: 'EYAD 3D shortcuts', width: 560, body: h('div', { class: 't3-shortcuts' }, rows.map(([a, b]) => h('div', { class: 't3-sc-row' }, h('span', { text: a }), h('kbd', { class: 'studio-kbd', text: b })))) });
  }
  filesDialog() {
    const rows = [
      ['.glb / .gltf', 'glTF 2.0 — meshes, PBR materials, textures, skins and animation clips. .gltf files must embed their data. Draco / Meshopt / KTX2-compressed files are not supported.'],
      ['.obj', 'Wavefront OBJ geometry (materials from .mtl files are not read; a neutral material is used).'],
      ['.stl', 'Binary or ASCII STL — treated as Z-up and turned upright.'],
      ['.fbx', 'FBX 7.x binary / ASCII — geometry, materials and animation. Textures referenced as separate files are not loaded.'],
      ['.eyad', 'EYAD 3D projects (scene, lights, keyframes, views). Image, vector and video projects open in their own editors.'],
      ['Images', 'PNG / JPEG / WebP dropped while a material is selected become its colour texture.'],
    ];
    return dialog({ title: 'Supported 3D files', width: 600, body: h('div', { class: 't3-shortcuts' }, rows.map(([a, b]) => h('div', { class: 't3-sc-row is-wide' }, h('strong', { text: a }), h('span', { class: 'studio-dim', text: b })))) });
  }

  bindKeys() {
    const map = {
      'Mod+Z': () => this.undo(), 'Mod+Shift+Z': () => this.redo(), 'Mod+Y': () => this.redo(),
      'Mod+S': () => io.save(this), 'Mod+Shift+S': () => io.saveAs(this), 'Mod+O': () => io.openDialog(this), 'Mod+I': () => io.importDialog(this), 'Mod+E': () => io.exportGLB(this), 'Mod+Alt+N': () => io.newScene(this),
      'Mod+Shift+E': () => io.renderImageDialog(this), 'Mod+Shift+V': () => io.renderVideoDialog(this),
      'Mod+D': () => this.duplicateSelected(), Delete: () => this.deleteSelected(), Backspace: () => this.deleteSelected(),
      Q: () => this.setMode('select'), W: () => this.setMode('translate'), E: () => this.setMode('rotate'), R: () => this.setMode('scale'), L: () => this.setSpace(this.space === 'world' ? 'local' : 'world'),
      F: () => this.frameSelection(), A: () => this.viewport.frame(null),
      H: () => this.selected && this.setVisible(this.selected, !this.selected.visible), 'Alt+H': () => this.showAll(),
      1: () => this.viewport.setView('front'), 3: () => this.viewport.setView('right'), 7: () => this.viewport.setView('top'), 5: () => this.setProjection(this.viewport.camera.isOrthographicCamera ? 'persp' : 'ortho'),
      Space: () => this.togglePlay(), Home: () => this.setTime(0), End: () => this.setTime(this.anim.duration),
      ',': () => this.setTime(this.time - 1 / this.fps), '.': () => this.setTime(this.time + 1 / this.fps),
      K: () => this.keySelected(), 'Shift+K': () => this.keyCamera(),
      Escape: () => { if (this.selected) this.select(null); else return false; },
      Tab: (e) => { if (e.target !== document.body && e.target !== this.viewport.canvas) return false; this.root.classList.toggle('is-panels-hidden'); },
      'Mod+K': () => this.palette.show(),
    };
    bindKeys(map);
    // hold Shift to snap while dragging the gizmo
    addEventListener('keydown', (e) => { if (e.key === 'Shift' && !this.settings.snap.on && !isTyping(e) && !isDialogOpen()) this.setSnap(true, { temp: true }); });
    addEventListener('keyup', (e) => { if (e.key === 'Shift' && !this.settings.snap.on) this.setSnap(false, { temp: true }); });
    addEventListener('blur', () => { if (!this.settings.snap.on) this.setSnap(false, { temp: true }); });
  }

  bindDrop() {
    const overlay = h('div', { class: 'studio-drop' }, h('div', { class: 'studio-drop-label', text: 'Drop 3D models, textures or .eyad' }));
    this.root.appendChild(overlay);
    let depth = 0;
    addEventListener('dragenter', (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) { depth++; overlay.classList.add('is-on'); e.preventDefault(); } });
    addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('is-on'); });
    addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault(); });
    addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth = 0; overlay.classList.remove('is-on'); io.handleFiles(this, Array.from(e.dataTransfer.files)); });
    addEventListener('paste', (e) => {
      if (isTyping(e)) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) { e.preventDefault(); io.handleFiles(this, files); }
    });
  }
}
void formatBytes;
