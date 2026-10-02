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
import { PRIMITIVES, LIGHTS, createPrimitive, createLight, duplicateObject, disposeObject, isLight, materialsOf, triangleCount, boundsOf, isCam, isEmpty, createCamera, createEmpty, createText, ensureAreaLights, camOf, fovToFocal, modsOf, canModify, buildModGeometry, joinMeshes, toPhysical, editorChildren, kindLabel } from './objects.js';
import { ModalTransform } from './modal.js';
import { NavGizmo } from './navgizmo.js';
import { newAnim, setObjectKey, setCameraKey, sampleObject, sampleCamera, turntableKeys, cameraTurntable, keyIndexAt, orbitKeys } from './anim.js';
import * as io from './io.js';

const AUTOKEY_KEY = 'eyad-studio:3d:autokey';
const MODES = [['select', 'Select', 'cursor', 'Q'], ['translate', 'Move', 'move', 'W'], ['rotate', 'Rotate', 'rotate', 'E'], ['scale', 'Scale', 'expand', 'T']];
const HINT_KEY = 'eyad-studio:3d:hotkeys-hint';
export const SHADING = [['wire', 'Wireframe', 'shWire'], ['solid', 'Solid', 'shSolid'], ['material', 'Material preview', 'shMat'], ['rendered', 'Rendered', 'shRender']];

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
    this.modal = new ModalTransform(this);
    this.nav = new NavGizmo(this);
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
    this.firstRunHint();
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
    this.camViewBtn = h('button', { class: 't3-hud-btn is-icon', type: 'button', 'aria-label': 'View through the active camera', title: 'View through the active camera (Numpad 0 or 0)', onclick: () => this.toggleCameraView() }, icon('camera', 15));
    this.camLockBtn = h('button', { class: 't3-hud-btn is-icon', type: 'button', 'aria-label': 'Lock camera to view', title: 'Lock camera to view — orbiting moves the camera while looking through it', onclick: () => this.setCameraLock(!this.settings.lockCamera) }, icon('lock', 15));
    this.stage.append(h('div', { class: 't3-hud' }, this.camBtn, this.camViewBtn, this.camLockBtn, this.hudTime), this.emptyEl);
  }
  syncHud() {
    if (!this.camViewBtn) return;
    const on = !!this.viewport.viewCam, lock = !!this.settings.lockCamera;
    this.camViewBtn.classList.toggle('is-on', on); this.camViewBtn.setAttribute('aria-pressed', String(on));
    this.camLockBtn.classList.toggle('is-on', lock); this.camLockBtn.setAttribute('aria-pressed', String(lock));
    this.camLockBtn.replaceChildren(icon(lock ? 'lock' : 'unlock', 15));
  }
  firstRunHint() {
    let seen = false;
    try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch (e) { seen = true; }
    if (seen || this.mobile.matches) return;
    const rows = [['G / R / S', 'Move, rotate, scale — then X / Y / Z, type a number, Enter'], ['Shift+A', 'Add menu at the pointer'], ['0', 'Look through the camera'], ['1 / 3 / 7 · 5', 'Front, right, top · perspective'], ['I', 'Insert a keyframe'], ['Z', 'Shading: wireframe … rendered'], ['X · Shift+D · H', 'Delete · duplicate · hide'], ['F12', 'Render image']];
    const close = () => { card.remove(); try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* ignore */ } };
    const card = h('div', { class: 't3-hint', role: 'note' },
      h('div', { class: 't3-hint-head' }, h('strong', { text: 'Quick keys' }), h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Dismiss', onclick: close }, icon('close', 14))),
      h('div', { class: 't3-hint-rows' }, rows.map(([k, t]) => h('div', { class: 't3-hint-row' }, h('kbd', { class: 'studio-kbd', text: k }), h('span', { text: t })))),
      h('div', { class: 't3-hint-foot' }, h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'All shortcuts', onclick: () => { close(); this.shortcutsDialog(); } }), h('button', { class: 'studio-btn is-small is-primary', type: 'button', text: 'Got it', onclick: close })));
    this.stage.appendChild(card);
  }
  setHint(text) { this.hintOverride = text || null; if (this.st) { this.st.hint.textContent = text || (this.mobile.matches ? '' : this.defaultHint()); this.st.hint.classList.toggle('is-op', !!text); } }
  defaultHint() { return 'Drag to orbit · right-drag to pan · scroll to zoom · click to select · G / R / S transform · Shift+A add'; }

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
    this.optionsBar.setAttribute('aria-label', 'Viewport header');
    const menuBtn = (label, items) => h('button', { class: 'studio-btn is-small is-ghost t3-hmenu', type: 'button', 'aria-haspopup': 'menu', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.bottom + 6, items()); } }, h('span', { text: label }), icon('chevronDown', 12));
    const modeSeg = h('div', { class: 'img-seg' }, MODES.map(([id, label, ic, key]) => h('button', { class: 'studio-btn is-small is-ghost t3-mode', type: 'button', title: `${label} gizmo (${key})`, 'aria-label': label, dataset: { mode: id }, onclick: () => this.setMode(id) }, icon(ic, 14), h('span', { class: 't3-hide-m', text: label }))));
    this.spaceBtn = h('button', { class: 'studio-btn is-small is-ghost', type: 'button', title: 'Gizmo orientation: world or local axes (L)', onclick: () => this.setSpace(this.space === 'world' ? 'local' : 'world') });
    this.snapBtn = h('button', { class: 'studio-btn is-small is-ghost t3-snap', type: 'button', title: 'Snapping (hold Shift on the gizmo, Ctrl during G / R / S)', onclick: () => this.setSnap(!this.settings.snap.on) }, icon('snap', 14), h('span', { class: 't3-hide-m', text: 'Snap' }));
    const snapMenu = h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Snap increments', title: 'Snap increments', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, this.snapMenuItems()); } }, icon('chevronDown', 13));
    const shadeSeg = h('div', { class: 'img-seg', role: 'group', 'aria-label': 'Viewport shading' }, SHADING.map(([id, label, ic]) => h('button', { class: 'studio-btn is-small is-ghost t3-shade', type: 'button', title: label + ' (Z)', 'aria-label': label, dataset: { shade: id }, onclick: () => this.setShading(id) }, icon(ic, 15))));
    this.overlayBtn = h('button', { class: 'studio-btn is-small is-ghost t3-snap', type: 'button', title: 'Overlays: grid, axes and helpers (Alt+Z)', 'aria-label': 'Overlays', onclick: () => this.toggleOverlays() }, icon('overlay', 14));
    const overlayMenu = h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Overlay options', title: 'Overlay options', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, this.overlayMenuItems()); } }, icon('chevronDown', 13));
    const renderBtn = h('button', { class: 'studio-btn is-small is-primary', type: 'button', title: 'Render image (F12)', onclick: () => io.renderImageDialog(this) }, icon('render', 14), h('span', { text: 'Render' }));
    const videoBtn = h('button', { class: 'studio-btn is-small', type: 'button', title: 'Render animation (Ctrl+F12)', onclick: () => io.renderVideoDialog(this) }, icon('video', 14), h('span', { class: 't3-hide-s', text: 'Video' }));
    this.optionsBar.append(
      h('div', { class: 'img-opt-tool' }, icon('cube', 16), h('span', { text: 'Object mode' })),
      h('div', { class: 'img-opt-items' },
        h('div', { class: 't3-hmenus' }, menuBtn('View', () => this.viewMenuFull()), menuBtn('Add', () => this.addMenuItems()), menuBtn('Object', () => this.objectOpsItems())),
        h('span', { class: 'img-opt-sep' }), modeSeg, this.spaceBtn, h('div', { class: 't3-pair' }, this.snapBtn, snapMenu),
        h('span', { class: 'img-opt-sep' }), shadeSeg, h('div', { class: 't3-pair' }, this.overlayBtn, overlayMenu),
        h('span', { class: 'img-opt-sep' }), renderBtn, videoBtn));
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
    const sh = this.settings.shading || 'rendered';
    this.root.querySelectorAll('[data-shade]').forEach((b) => { const on = b.dataset.shade === sh; b.classList.toggle('is-primary', on); b.classList.toggle('is-ghost', !on); b.setAttribute('aria-pressed', String(on)); });
    if (this.overlayBtn) { const on = this.settings.overlays?.on !== false; this.overlayBtn.classList.toggle('is-on', on); this.overlayBtn.setAttribute('aria-pressed', String(on)); }
    this.syncHud();
  }

  buildDock() {
    clear(this.dockEl);
    const tools = h('div', { class: 'img-dock-tools' });
    const t = (ic, label, fn, data) => h('button', { class: 'img-dock-tool', type: 'button', 'aria-label': label, dataset: data || {}, onclick: fn }, icon(ic, 22), h('span', { text: label }));
    for (const [id, label, ic] of MODES) tools.appendChild(t(ic, label, () => this.setMode(id), { mode: id }));
    tools.append(
      t('plus', 'Add', () => menuSheet('Add', [{ label: 'Mesh', items: [...PRIMITIVES.map((p) => ({ label: p.label, action: () => this.addPrimitive(p.id) })), { label: 'Text…', action: () => this.addText() }] }, { label: 'Light', items: LIGHTS.map((l) => ({ label: l.label, action: () => this.addLight(l.id) })) }, { label: 'Other', items: [{ label: 'Camera', action: () => this.addCamera() }, { label: 'Empty', action: () => this.addEmpty() }, { label: 'Import model…', action: () => io.importDialog(this) }] }])),
      t('camera', 'Cam view', () => this.toggleCameraView()),
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
    if (k === 'material' && !isLight(this.selected) && !isCam(this.selected) && !materialsOf(this.selected).length) { toast('This object has no material.', { timeout: 1800 }); return; }
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
    const all = this.allObjects();
    const l = all.filter(isLight).length, c = all.filter(isCam).length, n = all.length - l - c;
    this.st.objs.textContent = `${n} object${n === 1 ? '' : 's'} · ${l} light${l === 1 ? '' : 's'}` + (c ? ` · ${c} camera${c === 1 ? '' : 's'}` : '');
    this.st.tris.textContent = `${triangleCount(v.content).toLocaleString()} tris`;
    this.st.sel.textContent = this.selected ? 'Selected: ' + this.selected.name : '';
    this.updateCamLabel();
    this.st.hint.textContent = this.hintOverride || (this.mobile.matches ? '' : this.defaultHint());
    this.emptyEl.hidden = n > 0 || c > 0;
  }
  updateCamLabel() {
    const v = this.viewport; if (!v) return;
    const persp = v.camera.isPerspectiveCamera;
    const lab = v.viewCam ? `Camera · ${v.viewCam.name}` : persp ? `Perspective · ${Math.round(v.persp.fov)}°` : 'Orthographic';
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
  undo() { if (this.viewport.gizmo.dragging) return; this.endOps(); const c = this.hist.undo(); if (c) toast('Undo ' + c.label, { timeout: 900 }); }
  redo() { if (this.viewport.gizmo.dragging) return; this.endOps(); const c = this.hist.redo(); if (c) toast('Redo ' + c.label, { timeout: 900 }); }
  markSaved() { this.hist.markSaved(); this.forceDirty = false; this.updateTitle(); io.updateSaveIndicator(this); }

  /** Apply `redo`, record it, and refresh. */
  exec(label, redo, undo, { panels = true } = {}) {
    this.endOps();
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
    if (this.selected && !this.viewport.inScene(this.selected)) this.select(null, { quiet: true });
    this.syncOptions();
    this.viewport.fitShadows();
    this.viewport.invalidate();
    if (this.mode !== 'select' && this.selected && this.viewport.shownInScene(this.selected)) { if (this.viewport.gizmo.object !== this.selected) this.viewport.attach(this.selected); } else if (!this.selected || !this.viewport.shownInScene(this.selected)) this.viewport.attach(null);
    if (panels) { this.panels.refresh(); this.timeline.update(true); }
    this.updateStatus();
    this.updateTitle();
    io.updateSaveIndicator(this);
  }

  // ------------------------------------------------------------ objects & selection
  allObjects() { return this.viewport.allObjects(); }
  /** Cancel any pointer-following operation (modal transform, pick-a-parent). */
  endOps() { if (this.modal?.busy) this.modal.cancel(); if (this.pickMode) this.cancelPick(); }
  findById(id) { return this.allObjects().find((o) => o.userData.eyadId === id) || null; }

  select(obj, { quiet = false } = {}) {
    if (obj && !this.viewport.inScene(obj)) obj = null;
    if (this.modal?.busy && this.modal.active.o !== obj) this.modal.cancel();
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
    const parent = isLight(obj) ? this.viewport.lights : isCam(obj) ? this.viewport.cams : this.viewport.content;
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
  async addLight(kind) {
    if (kind === 'area') { try { await ensureAreaLights(); } catch (e) { toast('Area lights could not be loaded.', { type: 'error' }); return; } }
    const l = createLight(kind);
    this.addObject(l, { label: 'Add ' + l.name });
    if (!this.settings.shadows && l.castShadow) toast('Scene shadows are off — turn them on in Environment.', { timeout: 2600 });
  }
  /** A new camera at the current view; it becomes the active camera when the scene has none. */
  addCamera() {
    const v = this.viewport;
    const c = createCamera({ name: this.uniqueName('Camera') });
    v.camera.updateMatrixWorld(true);
    if (!v.viewCam) { c.position.copy(v.camera.position); c.quaternion.copy(v.camera.quaternion); if (v.camera.isPerspectiveCamera) c.userData.cam.focal = Math.round(Math.max(8, Math.min(300, fovToFocal(v.persp.fov, 24))) * 10) / 10; else { c.userData.cam.type = 'ortho'; c.userData.cam.orthoScale = Math.round(((v.orthoHalf || 3) / (v.camera.zoom || 1)) * 2 * (v.w / v.h) * 100) / 100; } }
    const prevActive = this.settings.activeCamera, makeActive = !this.activeCamera();
    const prevSel = this.selected;
    this.exec('Add ' + c.name, () => { v.cams.add(c); if (makeActive) this.settings.activeCamera = c.userData.eyadId; this.select(c, { quiet: true }); },
      () => { c.removeFromParent(); this.settings.activeCamera = prevActive; if (this.selected === c) this.select(prevSel && v.inScene(prevSel) ? prevSel : null, { quiet: true }); });
    if (this.mode === 'select') this.setMode('translate');
    toast(`${c.name} added${makeActive ? ' — it is the active camera for renders' : ''}. Press 0 to look through it.`, { timeout: 2600 });
    return c;
  }
  addEmpty() { const e = createEmpty(); e.name = this.uniqueName('Empty'); e.position.copy(this.viewport.orbit.target).setY(0); this.addObject(e, { label: 'Add empty' }); }
  async addText() {
    const v = await promptDialog('Add text', 'Text', 'EYAD', { ok: 'Add', maxLength: 200 });
    if (!v) return;
    try { await document.fonts.load("700 160px 'Studio Oswald'"); } catch (e) { /* falls back to a system font */ }
    this.addObject(createText(v), { label: 'Add text' });
  }
  uniqueName(base) { const names = new Set(this.allObjects().map((o) => o.name)); if (!names.has(base)) return base; for (let i = 2; i < 999; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`; return base; }
  addMenuItems() {
    return [
      { heading: 'Mesh' }, ...PRIMITIVES.map((p) => ({ label: p.label, action: () => this.addPrimitive(p.id) })),
      { label: 'Text…', action: () => this.addText() },
      { heading: 'Light' }, ...LIGHTS.map((l) => ({ label: l.label, action: () => this.addLight(l.id) })),
      { heading: 'Other' },
      { label: 'Camera', action: () => this.addCamera() },
      { label: 'Empty', action: () => this.addEmpty() },
      { separator: true },
      { label: 'Import model…', shortcut: 'Mod+I', action: () => io.importDialog(this) },
    ];
  }
  objectMenuItems(o) {
    return [
      { heading: o.name },
      { label: 'Rename…', action: async () => { const v = await promptDialog('Rename', 'Name', o.name); if (v) this.rename(o, v); } },
      { label: 'Duplicate', shortcut: 'Shift+D', action: () => { this.select(o); this.duplicateSelected(); } },
      { label: o.visible ? 'Hide' : 'Show', shortcut: 'H', action: () => this.setVisible(o, !o.visible) },
      { label: o.userData.eyadLocked ? 'Make selectable' : 'Make unselectable in the view', action: () => this.setLocked(o, !o.userData.eyadLocked) },
      { label: 'Frame', shortcut: 'F', action: () => this.viewport.frame(o.isLight ? null : o) },
      { separator: true },
      { label: 'Set parent…', shortcut: 'Mod+P', action: () => { this.select(o); this.startPick('parent'); } },
      this.hasEditorParent(o) ? { label: 'Clear parent', shortcut: 'Alt+P', action: () => this.clearParent(o) } : null,
      isCam(o) ? { label: 'Look through this camera', action: () => { this.setActiveCamera(o); this.viewport.enterCameraView(o); this.onCamViewChanged(); } } : null,
      isCam(o) && this.settings.activeCamera !== o.userData.eyadId ? { label: 'Set as active camera', action: () => this.setActiveCamera(o) } : null,
      { separator: true },
      { label: 'Key at playhead', shortcut: 'K', action: () => { this.select(o); this.keySelected(); } },
      !o.isLight && !isCam(o) ? { label: 'Spin 360° (turntable)', action: () => { this.select(o); this.turntable('object'); } } : null,
      !o.isLight && !isCam(o) && !isEmpty(o) ? { label: 'Drop to ground', action: () => this.dropToGround(o) } : null,
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
    const within = (n) => { for (let p = n; p; p = p.parent) if (p === o) return true; return false; };
    const entries = this.clips.filter((c) => within(c.root));
    if (this.viewport.viewCam && within(this.viewport.viewCam)) this.viewport.exitCameraView();
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
  duplicateSelected({ grab = false } = {}) {
    const o = this.selected; if (!o) return;
    const c = duplicateObject(o);
    if (c.name.endsWith(' copy')) c.name = this.uniqueName(c.name);
    if (!grab) {
      if (!c.isLight && !isCam(c) && !isEmpty(c)) { const b = boundsOf(o); c.position.x += Math.max(0.3, (b.max.x - b.min.x) * 1.15); }
      else c.position.x += 0.6;
    }
    const clips = this.clips.filter((e) => e.root === o).map((e) => e.clip);
    const parent = o.parent, prevSel = this.selected;
    const entries = clips.map((clip) => ({ clip, root: c, enabled: true }));
    this.exec('Duplicate', () => { parent.add(c); for (const e of entries) this.registerClip(e); this.select(c, { quiet: true }); },
      () => { parent.remove(c); for (const e of entries) this.unregisterClip(e); if (this.selected === c) this.select(prevSel && this.viewport.inScene(prevSel) ? prevSel : null, { quiet: true }); });
    if (grab) this.modal.start('move');
  }
  setLocked(o, v) {
    this.exec(v ? 'Make unselectable' : 'Make selectable', () => { if (v) o.userData.eyadLocked = true; else delete o.userData.eyadLocked; }, () => { if (!v) o.userData.eyadLocked = true; else delete o.userData.eyadLocked; });
  }
  /** X: ask before deleting, at the pointer. */
  deleteMenu() {
    const o = this.selected; if (!o) return;
    const m = this.modal.mouse || { x: innerWidth / 2, y: innerHeight / 2 };
    contextMenu(m.x - 20, m.y - 10, [{ heading: 'Delete?' }, { label: 'Delete ' + o.name, action: () => this.deleteSelected() }]);
  }

  // ------------------------------------------------------------ parenting / joining
  hasEditorParent(o) { return !!(o.parent && o.parent.userData && o.parent.userData.eyadId); }
  homeGroup(o) { const v = this.viewport; return isLight(o) ? v.lights : isCam(o) ? v.cams : v.content; }
  canParent(child, parent) {
    if (!child || !parent || child === parent) return 'Pick a different object as the parent.';
    if (isLight(parent) || isCam(parent)) return 'Lights and cameras cannot be parents — parent to a shape, model or empty instead.';
    for (let p = parent; p; p = p.parent) if (p === child) return 'An object cannot be parented to one of its own children.';
    if (child.parent === parent) return `${child.name} is already a child of ${parent.name}.`;
    return null;
  }
  reparent(child, target, label) {
    const oldParent = child.parent, idx = oldParent.children.indexOf(child), before = this.trOf(child);
    this.exec(label, () => { target.attach(child); }, () => { oldParent.add(child); oldParent.children.splice(oldParent.children.indexOf(child), 1); oldParent.children.splice(Math.min(idx, oldParent.children.length), 0, child); this.setTr(child, before); });
  }
  setParent(child, parent) {
    const err = this.canParent(child, parent);
    if (err) { toast(err, { type: 'warn', timeout: 2600 }); return false; }
    this.reparent(child, parent, 'Set parent');
    toast(`${child.name} now follows ${parent.name}`, { timeout: 1600 });
    return true;
  }
  clearParent(o = this.selected) {
    if (!o) return;
    if (!this.hasEditorParent(o)) { toast(`${o.name} has no parent.`, { timeout: 1500 }); return; }
    this.reparent(o, this.homeGroup(o), 'Clear parent');
  }
  startPick(kind) {
    const o = this.selected;
    if (!o) { toast('Select an object first.', { timeout: 1600 }); return; }
    this.endOps();
    this.pickMode = { kind, o };
    this.root.classList.add('is-picking');
    this.setHint(kind === 'parent' ? `Click the object that should be the parent of ${o.name} (in the view or the outliner) · Esc to cancel` : `Click the mesh to join into ${o.name} · Esc to cancel`);
    toast(kind === 'parent' ? 'Click the parent object' : 'Click the mesh to join', { timeout: 1800 });
  }
  cancelPick() { if (!this.pickMode) return; this.pickMode = null; this.root.classList.remove('is-picking'); this.setHint(null); }
  /** A click in the viewport / outliner while picking. Returns true when it was consumed. */
  onViewportPick(hit) {
    const pm = this.pickMode; if (!pm) return false;
    this.cancelPick();
    if (!hit || !this.viewport.inScene(pm.o)) return true;
    if (pm.kind === 'parent') this.setParent(pm.o, hit);
    else this.join(pm.o, hit);
    return true;
  }
  join(a, b) {
    if (a === b) return;
    if (editorChildren(a).length || editorChildren(b).length) { toast('Clear the children of both objects before joining them.', { type: 'warn' }); return; }
    let mesh;
    try { mesh = joinMeshes(a, b); } catch (e) { toast(e.message || 'These objects cannot be joined.', { type: 'warn', timeout: 4000 }); return; }
    const pa = a.parent, ia = pa.children.indexOf(a), pb = b.parent, ib = pb.children.indexOf(b);
    const put = (par, o, i) => { par.add(o); par.children.splice(par.children.indexOf(o), 1); par.children.splice(Math.min(i, par.children.length), 0, o); };
    this.exec('Join', () => { pb.remove(b); pa.remove(a); put(pa, mesh, ia); this.select(mesh, { quiet: true }); },
      () => { pa.remove(mesh); put(pa, a, ia); put(pb, b, ib); this.select(a, { quiet: true }); });
    toast(`Joined ${b.name} into ${a.name}`, { type: 'ok', timeout: 1600 });
  }

  // ------------------------------------------------------------ modifiers (primitives)
  setMods(o, patch, coalesce) {
    if (!canModify(o)) return;
    const cur = modsOf(o);
    const mods = { ...cur, ...patch, array: { ...cur.array, ...(patch.array || {}) } };
    const before = { g: o.geometry, m: o.userData.eyadMods };
    let g;
    try { g = buildModGeometry(o.userData.eyadPrim, mods); } catch (e) { toast('That modifier setting could not be built.', { type: 'error' }); return; }
    const apply = (gg, mm) => { o.geometry = gg; if (mm) o.userData.eyadMods = mm; else delete o.userData.eyadMods; };
    apply(g, mods);
    const cmd = { label: 'Modifier', after: { g, m: mods }, coalesce: coalesce ? 'mod:' + o.uuid + ':' + coalesce : undefined,
      undo: () => { apply(before.g, before.m); this.afterChange(); }, redo: () => { apply(cmd.after.g, cmd.after.m); this.afterChange(); },
      merge: (next) => { cmd.after.g.dispose?.(); cmd.after = next.after; return true; } };
    this.hist.push(cmd);
    this.afterChange({ panels: !coalesce });
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
  trOf(o) { return { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(), c: o.userData.cam ? JSON.stringify(o.userData.cam) : null }; }
  setTr(o, t) { o.position.copy(t.p); o.quaternion.copy(t.q); o.scale.copy(t.s); if (t.c) o.userData.cam = JSON.parse(t.c); }
  sameTr(a, b) { return a.p.equals(b.p) && a.q.equals(b.q) && a.s.equals(b.s) && a.c === b.c; }
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
  onCameraMoved() { this.updateCamLabel(); if (this.camViewBtn && this.camViewBtn.classList.contains('is-on') !== !!this.viewport.viewCam) this.syncHud(); }
  onCameraEnd() { /* camera moves are not part of undo */ }

  dropToGround(o) {
    this.beginTransform(o);
    const b = boundsOf(o);
    const wp = o.getWorldPosition(new THREE.Vector3()); wp.y -= b.min.y;
    o.position.copy(o.parent.worldToLocal(wp));
    this.commitTransform(o, 'Drop to ground');
  }
  /** Alt+G / Alt+R / Alt+S */
  clearTransform(kind) {
    const o = this.selected; if (!o) return;
    if (this.modal.busy) this.modal.cancel();
    this.beginTransform(o);
    if (kind === 'p') o.position.set(0, 0, 0); else if (kind === 'r') o.quaternion.identity(); else o.scale.set(1, 1, 1);
    this.commitTransform(o, { p: 'Reset location', r: 'Reset rotation', s: 'Reset scale' }[kind]);
  }
  startModal(kind) {
    if (!this.selected) { toast('Select an object first.', { timeout: 1400 }); return; }
    if (this.pickMode) this.cancelPick();
    this.modal.start(kind);
  }
  resetTransform(o) {
    this.beginTransform(o);
    if (o.userData.eyadKind === 'primitive') { o.quaternion.identity(); o.scale.set(1, 1, 1); o.position.set(0, 0, 0); o.updateWorldMatrix(true, true); o.position.y -= boundsOf(o).min.y; }
    else if (o.isLight) { o.position.set(4, 6, 3); o.lookAt(0, 0, 0); }
    else if (isCam(o)) { o.position.set(5, 3.5, 6); o.scale.set(1, 1, 1); o.lookAt(0, 0.6, 0); }
    else if (isEmpty(o)) { o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1); }
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
    if (!o || isLight(o) || isCam(o)) return null;
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
  /** Swap a standard material for a physical one so it can transmit light (glass). */
  enableGlass(m) {
    const o = this.selected; if (!o || !m || m.isMeshPhysicalMaterial) return;
    const p = toPhysical(m);
    if (p === m) { toast('This material type cannot become glass.', { type: 'warn' }); return; }
    const swap = (from, to) => o.traverse((n) => { if (!n.isMesh) return; if (Array.isArray(n.material)) n.material = n.material.map((x) => (x === from ? to : x)); else if (n.material === from) n.material = to; });
    this.exec('Enable transmission', () => swap(m, p), () => swap(p, m));
  }
  setCamProp(o, label, key, value, coalesce) {
    const get = () => camOf(o)[key];
    const set = (v) => { o.userData.cam = { ...camOf(o), [key]: v }; this.viewport.invalidate(); };
    if (coalesce) this.valueCmd(label, get, set, value, 'cam:' + o.uuid + ':' + coalesce);
    else { const b = get(); this.exec(label, () => set(value), () => set(b)); }
  }
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
    const apply = (json) => { this.settings = JSON.parse(json); this.viewport.applySettings(); this.setSnap(this.settings.snap.on); this.syncOptions(); };
    this.viewport.applySettings();
    const cmd = { label, after, coalesce: coalesce ? 'set:' + coalesce : undefined, undo: () => { apply(before); this.afterChange(); }, redo: () => { apply(cmd.after); this.afterChange(); }, merge: (next) => { cmd.after = next.after; return true; } };
    this.hist.push(cmd);
    this.afterChange({ panels: !coalesce });
  }

  // ------------------------------------------------------------ scene cameras, shading, overlays
  cameras() { return this.allObjects().filter(isCam); }
  activeCamera() { const id = this.settings.activeCamera; return id ? this.cameras().find((c) => c.userData.eyadId === id) || null : null; }
  setActiveCamera(o) {
    if (!isCam(o) || this.settings.activeCamera === o.userData.eyadId) return;
    this.changeSettings('Active camera', () => { this.settings.activeCamera = o.userData.eyadId; });
  }
  /** Numpad 0: look through the active camera (the selected camera becomes active first). */
  toggleCameraView() {
    const v = this.viewport;
    if (v.viewCam) { v.exitCameraView(); this.onCamViewChanged(); return; }
    if (isCam(this.selected) && this.settings.activeCamera !== this.selected.userData.eyadId) this.setActiveCamera(this.selected);
    let cam = this.activeCamera() || this.cameras()[0];
    if (!cam) { toast('There is no camera yet — add one from Add ▸ Camera (it starts at the current view).', { timeout: 3200, action: { label: 'Add camera', fn: () => { this.addCamera(); this.toggleCameraView(); } } }); return; }
    if (this.settings.activeCamera !== cam.userData.eyadId) this.setActiveCamera(cam);
    v.enterCameraView(cam);
    this.onCamViewChanged();
  }
  /** Ctrl+Alt+Numpad 0: move the active camera to where the viewport is looking from. */
  cameraToView() {
    const v = this.viewport;
    if (v.viewCam) { toast('Already looking through the camera.', { timeout: 1500 }); return; }
    let cam = (isCam(this.selected) ? this.selected : null) || this.activeCamera() || this.cameras()[0];
    if (!cam) { cam = this.addCamera(); v.enterCameraView(cam); this.onCamViewChanged(); return; }
    this.beginTransform(cam);
    v.camera.updateMatrixWorld(true);
    v.setWorldPose(cam, v.camera.position, v.camera.quaternion);
    this.commitTransform(cam, 'Camera to view');
    if (this.settings.activeCamera !== cam.userData.eyadId) this.setActiveCamera(cam);
    v.enterCameraView(cam);
    this.onCamViewChanged();
  }
  setCameraLock(on) { this.changeSettings('Lock camera to view', () => { this.settings.lockCamera = !!on; }); toast(on ? 'Camera locked to view — orbit, pan and zoom now move the camera while you look through it.' : 'Camera unlocked from the view.', { timeout: 2200 }); }
  onCamViewChanged() { this.updateCamLabel(); this.syncHud(); this.panels.refresh(); }
  onRendered() { this.nav?.draw(); }
  setShading(id) { if ((this.settings.shading || 'rendered') === id) return; this.changeSettings('Viewport shading', () => { this.settings.shading = id; }); }
  shadingMenuItems() { return [{ heading: 'Viewport shading' }, ...SHADING.map(([id, label]) => ({ label, checked: () => (this.settings.shading || 'rendered') === id, action: () => this.setShading(id) }))]; }
  shadingMenu() { const m = this.modal.mouse || { x: innerWidth / 2, y: innerHeight / 2 }; contextMenu(m.x - 30, m.y - 40, this.shadingMenuItems()); }
  toggleOverlays() { this.changeSettings('Overlays', () => { this.settings.overlays.on = !this.settings.overlays.on; }); }
  overlayMenuItems() {
    const s = this.settings, ov = s.overlays;
    return [
      { label: 'Show overlays', shortcut: 'Alt+Z', checked: () => ov.on, action: () => this.toggleOverlays() },
      { separator: true },
      { label: 'Grid', checked: () => s.ground.grid, action: () => this.changeSettings('Grid', () => { s.ground.grid = !s.ground.grid; }) },
      { label: 'World axes', checked: () => ov.axes, action: () => this.changeSettings('Axes', () => { ov.axes = !ov.axes; }) },
      { label: 'Light, camera and empty helpers', checked: () => ov.helpers, action: () => this.changeSettings('Helpers', () => { ov.helpers = !ov.helpers; }) },
    ];
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
    if (v.viewCam) { v.savedView = null; v.exitCameraView({ keep: true }); this.syncHud(); }
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
      { label: 'View through active camera', shortcut: '0', checked: () => !!v.viewCam, action: () => this.toggleCameraView() },
      { label: 'Align active camera to view', shortcut: 'Mod+Alt+0', action: () => this.cameraToView() },
      { label: 'Lock camera to view', checked: () => !!this.settings.lockCamera, action: () => this.setCameraLock(!this.settings.lockCamera) },
      { separator: true },
      { label: 'Perspective', checked: () => !v.viewCam && v.camera.isPerspectiveCamera, action: () => this.setProjection('persp') },
      { label: 'Orthographic', shortcut: '5', checked: () => !v.viewCam && v.camera.isOrthographicCamera, action: () => this.setProjection('ortho') },
      { separator: true },
      { label: 'Front', shortcut: '1', action: () => this.setView('front') },
      { label: 'Right', shortcut: '3', action: () => this.setView('right') },
      { label: 'Top', shortcut: '7', action: () => this.setView('top') },
      { label: 'Back', shortcut: 'Mod+1', action: () => this.setView('back') },
      { label: 'Left', shortcut: 'Mod+3', action: () => this.setView('left') },
      { label: 'Bottom', shortcut: 'Mod+7', action: () => this.setView('bottom') },
      { separator: true },
      { label: 'Frame selected', shortcut: 'F', action: () => this.frameSelection() },
      { label: 'Frame all', shortcut: 'Home', action: () => v.frame(null) },
      ...(this.bookmarks.length ? [{ heading: 'Bookmarks' }, ...this.bookmarks.map((b) => ({ label: b.name, action: () => this.goBookmark(b) }))] : []),
      { separator: true },
      { label: 'Save current view…', action: () => this.addBookmark() },
    ];
  }
  setView(name) { this.viewport.setView(name); this.onCamViewChanged(); }
  viewMenuFull() {
    return [
      ...this.viewMenuItems(),
      { separator: true },
      { label: 'Shading', submenu: () => this.shadingMenuItems().filter((x) => !x.heading) },
      { label: 'Overlays', submenu: () => this.overlayMenuItems() },
    ];
  }
  /** The Object menu (header, menubar and palette). */
  objectOpsItems() {
    const has = () => !!this.selected;
    return [
      { label: 'Move', shortcut: 'G', action: () => this.startModal('move'), enabled: has },
      { label: 'Rotate', shortcut: 'R', action: () => this.startModal('rotate'), enabled: has },
      { label: 'Scale', shortcut: 'S', action: () => this.startModal('scale'), enabled: has },
      { label: 'Clear', submenu: () => [
        { label: 'Location', shortcut: 'Alt+G', action: () => this.clearTransform('p'), enabled: has },
        { label: 'Rotation', shortcut: 'Alt+R', action: () => this.clearTransform('r'), enabled: has },
        { label: 'Scale', shortcut: 'Alt+S', action: () => this.clearTransform('s'), enabled: has },
      ] },
      { separator: true },
      { label: 'Duplicate and move', shortcut: 'Shift+D', action: () => this.duplicateSelected({ grab: true }), enabled: has },
      { label: 'Join with…', shortcut: 'Mod+J', action: () => this.startPick('join'), enabled: has },
      { label: 'Set parent…', shortcut: 'Mod+P', action: () => this.startPick('parent'), enabled: has },
      { label: 'Clear parent', shortcut: 'Alt+P', action: () => this.clearParent(), enabled: () => !!this.selected && this.hasEditorParent(this.selected) },
      { separator: true },
      { label: 'Insert keyframe', shortcut: 'I', action: () => this.keySelected(), enabled: has },
      { label: 'Hide', shortcut: 'H', action: () => this.selected && this.setVisible(this.selected, !this.selected.visible), enabled: has },
      { label: 'Show hidden objects', shortcut: 'Alt+H', action: () => this.showAll() },
      { label: 'Delete', shortcut: 'X', action: () => this.deleteSelected(), enabled: has },
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
  /** Timeline rows: 'obj' = the selection's keys, 'cam' = the active scene camera's (or the legacy viewport-camera track). */
  keysFor(kind) {
    if (kind === 'cam') { const c = this.activeCamera(); return c ? this.anim.tracks[c.userData.eyadId] || [] : this.anim.camera; }
    return this.selected ? this.anim.tracks[this.selected.userData.eyadId] : null;
  }
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
    const cam = this.activeCamera();
    if (cam) { this.animChange('Key ' + cam.name, () => setObjectKey(this.anim, cam, this.time, 0.5 / this.fps)); toast(`Keyed ${cam.name} at ${this.time.toFixed(2)} s`, { timeout: 1200 }); return; }
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
    } else if (this.activeCamera() || kind === 'sceneCamera') {
      // orbit the scene camera around the selection (or the whole scene)
      let cam = this.activeCamera();
      if (!cam) cam = this.addCamera();
      const sel = this.selected && !isCam(this.selected) && !isLight(this.selected) ? this.selected : null;
      const b = sel ? boundsOf(sel) : this.viewport.contentBounds();
      const pivot = b ? b.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0.5, 0);
      this.evaluate(0);
      const id = cam.userData.eyadId;
      this.animChange('Camera orbit', () => { this.anim.tracks[id] = orbitKeys(cam, pivot, 0, d); });
      toast(`${cam.name} orbits ${sel ? sel.name : 'the scene'} once over ${d.toFixed(1)} s — press Space to play, 0 to look through it.`, { timeout: 3200 });
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
      { label: 'Insert keyframe (selection)', shortcut: 'I', action: () => this.keySelected(), enabled: () => !!this.selected },
      { label: 'Key camera', shortcut: 'Shift+K', action: () => this.keyCamera() },
      { label: 'Auto-key', checked: () => this.autoKey, action: () => this.setAutoKey(!this.autoKey) },
      { separator: true },
      { label: 'Spin selection 360° (turntable)', action: () => this.turntable('object'), enabled: () => !!this.selected },
      { label: 'Orbit camera 360°', action: () => this.turntable('camera') },
      { label: 'New orbiting scene camera', action: () => this.turntable('sceneCamera'), enabled: () => !this.activeCamera() },
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
      if (!this.hasAnimation()) toast('Nothing is animated yet — key an object (I), key the camera (Shift+K) or use a turntable.', { timeout: 3200 });
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
    if (!skipCamera && ck && ck.length && !this.viewport.viewCam) {
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
  restoreViewState(s) { this.evaluate(s.time, { skipCamera: true }); if (!this.viewport.viewCam) this.applyView(s.view); }
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
    this.endOps();
    if (v.viewCam) { v.savedView = null; v.exitCameraView({ keep: true }); }
    for (const o of [...v.content.children]) { v.content.remove(o); disposeObject(o); }
    for (const l of [...v.lights.children]) v.lights.remove(l);
    for (const c of [...v.cams.children]) v.cams.remove(c);
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
  loadScene({ name, settings, objects, clips, lights, cameras = [], parents = {}, anim, bookmarks, selectedId = null, projectId = null }) {
    this.playing = false;
    this.clearScene();
    const v = this.viewport;
    this.name = name;
    this.settings = settings;
    this.anim = anim;
    this.bookmarks = bookmarks;
    for (const o of objects) v.content.add(o);
    for (const l of lights) v.lights.add(l);
    for (const c of cameras) v.cams.add(c);
    // lights / cameras parented to content objects are stored with their local transform
    for (const o of [...lights, ...cameras]) {
      const pid = parents[o.userData.eyadId];
      const par = pid ? this.findById(pid) : null;
      if (par && !isLight(par) && !isCam(par)) par.add(o);
    }
    if (settings.activeCamera && !this.activeCamera()) settings.activeCamera = null;
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
    this.syncOptions();
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
        { label: 'Select Gizmo Off', shortcut: 'Q', action: () => this.setMode('select'), checked: () => this.mode === 'select' },
        { label: 'Move Gizmo', shortcut: 'W', action: () => this.setMode('translate'), checked: () => this.mode === 'translate' },
        { label: 'Rotate Gizmo', shortcut: 'E', action: () => this.setMode('rotate'), checked: () => this.mode === 'rotate' },
        { label: 'Scale Gizmo', shortcut: 'T', action: () => this.setMode('scale'), checked: () => this.mode === 'scale' },
        { label: 'Local Axes', shortcut: 'L', action: () => this.setSpace(this.space === 'world' ? 'local' : 'world'), checked: () => this.space === 'local' },
        { label: 'Snapping', action: () => this.setSnap(!this.settings.snap.on), checked: () => this.settings.snap.on },
        { separator: true },
        { label: 'Preferences…', action: () => { location.href = ROUTES.settings; }, icon: 'gear' },
      ] },
      { label: 'Add', items: this.addMenuItems() },
      { label: 'Object', items: this.objectOpsItems() },
      { label: 'View', items: [
        ...this.viewMenuItems().filter((x) => !x.heading && !(typeof x.label === 'string' && x.label === 'Save current view…')),
        { label: 'Save Current View…', action: () => this.addBookmark() },
        { separator: true },
        { label: 'Shading', submenu: () => this.shadingMenuItems().filter((x) => !x.heading) },
        { label: 'Overlays', submenu: () => this.overlayMenuItems() },
        { label: 'Panels', shortcut: 'Tab', action: () => this.root.classList.toggle('is-panels-hidden') },
        { label: 'Full Screen', action: () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); } },
      ] },
      { label: 'Animation', items: this.animMenuItems() },
      { label: 'Render', items: [
        { label: 'Render Image…', shortcut: 'F12', action: () => io.renderImageDialog(this), icon: 'image' },
        { label: 'Render Animation (Video)…', shortcut: 'Mod+F12', action: () => io.renderVideoDialog(this), icon: 'video' },
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
      ['Select', 'Click / tap an object'],
      ['Move / rotate / scale (follows the pointer)', 'G / R / S'],
      ['…then constrain to an axis / plane', 'X Y Z (again = local) / Shift+X Y Z'],
      ['…type an exact value, snap', '0-9 . - / hold Ctrl'],
      ['…confirm / cancel', 'Enter or click / Esc or right-click'],
      ['Reset location / rotation / scale', 'Alt+G / Alt+R / Alt+S'],
      ['Gizmo: off / move / rotate / scale', 'Q / W / E / T'], ['World / local gizmo axes', 'L'], ['Snap the gizmo temporarily', 'Hold Shift while dragging'],
      ['Add menu at the pointer', 'Shift+A'],
      ['Delete (asks first) / delete now', 'X / Delete'], ['Duplicate and move / duplicate', 'Shift+D / ' + keyLabel('Mod+D')], ['Hide / show all', 'H / Alt+H'],
      ['Set parent / clear parent / join', keyLabel('Mod+P') + ' / Alt+P / ' + keyLabel('Mod+J')],
      ['View through camera', '0 or Numpad 0'], ['Align camera to view', keyLabel('Mod+Alt+0')],
      ['Front / right / top (opposite with Ctrl)', '1 / 3 / 7 (top row or numpad)'], ['Perspective ↔ orthographic', '5'],
      ['Frame selected / frame all', 'F or Numpad . / Home or A'],
      ['Shading menu / overlays', 'Z / Alt+Z'],
      ['Insert keyframe / key camera', 'I or K / Shift+K'],
      ['Play / pause', 'Space'], ['Previous / next frame', '← / → or , / .'], ['Go to start / end', 'Shift+← / Shift+→'],
      ['Render image / animation', 'F12 / ' + keyLabel('Mod+F12')],
      ['Undo / redo', keyLabel('Mod+Z') + ' / ' + keyLabel('Mod+Shift+Z')], ['Save', keyLabel('Mod+S')], ['Import model', keyLabel('Mod+I')], ['Export GLB', keyLabel('Mod+E')],
      ['Command palette', keyLabel('Mod+K')],
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
      'Mod+D': () => this.duplicateSelected(), 'Shift+D': () => this.duplicateSelected({ grab: true }), Delete: () => this.deleteSelected(), Backspace: () => this.deleteSelected(), X: () => this.deleteMenu(),
      Q: () => this.setMode('select'), W: () => this.setMode('translate'), E: () => this.setMode('rotate'), T: () => this.setMode('scale'), L: () => this.setSpace(this.space === 'world' ? 'local' : 'world'),
      G: () => this.startModal('move'), R: () => this.startModal('rotate'), S: () => this.startModal('scale'),
      'Alt+G': () => this.clearTransform('p'), 'Alt+R': () => this.clearTransform('r'), 'Alt+S': () => this.clearTransform('s'),
      'Shift+A': () => { const m = this.modal.mouse || { x: innerWidth / 2, y: innerHeight / 2 }; contextMenu(m.x - 10, m.y - 10, this.addMenuItems()); },
      'Mod+P': () => this.startPick('parent'), 'Alt+P': () => this.clearParent(), 'Mod+J': () => this.startPick('join'),
      Z: () => this.shadingMenu(), 'Alt+Z': () => this.toggleOverlays(),
      F: () => this.frameSelection(), A: () => this.viewport.frame(null),
      H: () => this.selected && this.setVisible(this.selected, !this.selected.visible), 'Alt+H': () => this.showAll(),
      1: () => this.setView('front'), 3: () => this.setView('right'), 7: () => this.setView('top'), 'Mod+1': () => this.setView('back'), 'Mod+3': () => this.setView('left'), 'Mod+7': () => this.setView('bottom'),
      5: () => { this.setProjection(this.viewport.camera.isOrthographicCamera ? 'persp' : 'ortho'); this.syncHud(); },
      0: () => this.toggleCameraView(), 'Mod+Alt+0': () => this.cameraToView(),
      Space: () => this.togglePlay(), Home: () => this.viewport.frame(null), End: () => this.setTime(this.anim.duration),
      'Shift+ArrowLeft': () => this.setTime(0), 'Shift+ArrowRight': () => this.setTime(this.anim.duration),
      ArrowLeft: () => this.setTime(this.time - 1 / this.fps), ArrowRight: () => this.setTime(this.time + 1 / this.fps),
      ',': () => this.setTime(this.time - 1 / this.fps), '.': () => this.setTime(this.time + 1 / this.fps),
      K: () => this.keySelected(), I: () => this.keySelected(), 'Shift+K': () => this.keyCamera(),
      F12: () => io.renderImageDialog(this), 'Mod+F12': () => io.renderVideoDialog(this),
      Escape: () => { if (this.pickMode) this.cancelPick(); else if (this.selected) this.select(null); else return false; },
      Tab: (e) => { if (e.target !== document.body && e.target !== this.viewport.canvas) return false; this.root.classList.toggle('is-panels-hidden'); },
      'Mod+K': () => this.palette.show(),
    };
    // the numeric keypad drives the view (handled first, so Numpad . is not "next frame")
    addEventListener('keydown', (e) => {
      if (!/^Numpad(\d|Decimal)$/.test(e.code || '') || isTyping(e) || isDialogOpen() || this.modal.busy) return;
      const mod = e.ctrlKey || e.metaKey, k = e.code.slice(6);
      const run = { 0: () => (mod && e.altKey ? this.cameraToView() : this.toggleCameraView()), 1: () => this.setView(mod ? 'back' : 'front'), 3: () => this.setView(mod ? 'left' : 'right'), 7: () => this.setView(mod ? 'bottom' : 'top'),
        5: () => { this.setProjection(this.viewport.camera.isOrthographicCamera ? 'persp' : 'ortho'); this.syncHud(); }, Decimal: () => this.frameSelection(),
        9: () => { const v = this.viewport, d = v.camera.position.clone().sub(v.orbit.target); if (v.viewCam) v.exitCameraView({ keep: true }); v.camera.position.copy(v.orbit.target).sub(d); v.orbit.update(); v.invalidate(); this.onCamViewChanged(); } }[k];
      if (!run) return;
      e.preventDefault(); e.stopImmediatePropagation();
      run();
    }, true);
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
void formatBytes; void kindLabel;
