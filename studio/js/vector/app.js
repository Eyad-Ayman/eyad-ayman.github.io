// EYAD VECTOR — Illustrator-style vector editor (app shell, view, history,
// selection, commands). Rendering is plain SVG generated from the model.
import { h, clear, isTyping, modKey, uid, clamp } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, confirmDialog, createMenubar, menuSheet, commandPalette, saveIndicator, bindKeys, iconButton, isDialogOpen, formDialog, openSheet, closeSheet } from '../core/ui.js';
import { getSettings, onSettings } from '../core/settings.js';
import { bootStudio, brandMark, appSwitcher, backToPortfolio, ROUTES, installButton, themeToggle, goPortfolio } from '../core/shell.js';
import {
  createDoc, renderNodes, bounds, unionBounds, find, topLevelOf, cloneNode, transformNode, translate, scaleAbout, rotateAbout,
  pathD, apply, walk, textBox, fontString, defaultStyle, FONTS,
} from './model.js';
import { createTools, TOOL_DEFAULTS } from './tools.js';
import { Panels } from './panels.js';
import { buildMenus } from './menus.js';
import * as io from './io.js';

const OPTS_KEY = 'eyad-studio:vector-tool-options:v1';
const NS = 'http://www.w3.org/2000/svg';
// compact = phones, portrait and landscape: panels become sheets, tools move to a dock / rail
const COMPACT_MQ = '(max-width: 760px) and (orientation: portrait), (max-width: 540px), (orientation: landscape) and (max-height: 540px)';
const LAND_MQ = '(orientation: landscape) and (max-height: 540px) and (min-width: 541px)';
const TOUCH_MQ = '(pointer: coarse), (hover: none)';

class View {
  constructor(app, stage) {
    this.app = app; this.stage = stage;
    this.zoom = 1; this.panX = 0; this.panY = 0; this.inset = { b: 0, r: 0 };
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'vec-svg');
    this.svg.innerHTML = '<defs class="vec-defs"></defs><g class="vec-world"><g class="vec-boards"></g><g class="vec-content"></g><g class="vec-grid"></g></g><g class="vec-overlay"></g>';
    stage.appendChild(this.svg);
    this.world = this.svg.querySelector('.vec-world');
    this.defs = this.svg.querySelector('.vec-defs');
    this.content = this.svg.querySelector('.vec-content');
    this.boards = this.svg.querySelector('.vec-boards');
    this.gridG = this.svg.querySelector('.vec-grid');
    this.overlay = this.svg.querySelector('.vec-overlay');
    new ResizeObserver(() => {
      const had = this.w, ow = this.w, oh = this.h; this.measure();
      if (!this.w || !this.h) return;
      // still showing the fitted view (nobody zoomed or panned)? fit again — rotation, panels, sheets. Otherwise keep the centre.
      if (!had || this.isFitted()) this.fitArtboard();
      else { this.panX += (this.w - ow) / 2; this.panY += (this.h - oh) / 2; this.apply(); }
    }).observe(stage);
    this.measure();
  }
  measure() { const r = this.stage.getBoundingClientRect(); this.w = r.width; this.h = r.height; this.left = r.left; this.top = r.top; }
  apply() { this.world.setAttribute('transform', `matrix(${this.zoom} 0 0 ${this.zoom} ${this.panX} ${this.panY})`); this.app.renderOverlay(); this.app.updateStatus(); this.app.drawGrid(); }
  toDoc(cx, cy) { const r = this.svg.getBoundingClientRect(); return { x: (cx - r.left - this.panX) / this.zoom, y: (cy - r.top - this.panY) / this.zoom }; }
  toScreen(x, y) { return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY }; }
  zoomAt(k, sx = this.w / 2, sy = this.h / 2) {
    const z = clamp(this.zoom * k, 0.02, 64);
    const dx = (sx - this.panX) / this.zoom, dy = (sy - this.panY) / this.zoom;
    this.zoom = z; this.panX = sx - dx * z; this.panY = sy - dy * z; this.apply();
  }
  fitRect(b, pad = 48) {
    if (!b || !this.w) return;
    pad = Math.min(this.w, this.h) < 600 ? 14 : pad;
    // phones float the tool options over the top of the canvas: keep the artboard (and its label) clear of them
    const top = this.app.root.dataset.vec && this.app.root.dataset.vec !== 'wide' ? 66 : 10;
    // an open panel sheet covers part of the canvas (bottom in portrait, right in landscape): fit into what is left
    const ib = Math.min(this.inset.b, this.h * 0.7), ir = Math.min(this.inset.r, this.w * 0.7);
    const w = this.w - ir, hh = this.h - top - ib;
    this.zoom = clamp(Math.min((w - pad * 2) / b.w, (hh - pad * 2) / b.h), 0.02, 64);
    this.panX = (w - b.w * this.zoom) / 2 - b.x * this.zoom; this.panY = top + (hh - b.h * this.zoom) / 2 - b.y * this.zoom; this.apply();
    this.fit = [this.zoom, this.panX, this.panY];
  }
  /** A sheet opened / closed: re-fit only if the user has not zoomed or panned away from the fitted view. */
  setInset(b, r) { const was = this.isFitted(); this.inset = { b: Math.max(0, b), r: Math.max(0, r) }; if (was) this.fitArtboard(); }
  isFitted() { const f = this.fit; return !!f && Math.abs(f[0] - this.zoom) < 1e-6 && Math.abs(f[1] - this.panX) < 0.5 && Math.abs(f[2] - this.panY) < 0.5; }
  fitArtboard() { const a = this.app.activeArtboard(); if (a) this.fitRect(a); }
  fitAll() { const a = this.app.doc; if (!a) return; this.fitRect(unionBounds([...a.artboards.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })), ...a.items.map(bounds)])); }
}

export class VectorApp {
  constructor(root) {
    this.root = root;
    this.doc = null;
    this.sel = new Set();
    this.anchorSel = new Set();
    this.undoStack = []; this.redoStack = [];
    this.savedIndex = 0;
    this.mobile = matchMedia(COMPACT_MQ);
    this.land = matchMedia(LAND_MQ);
    this.touch = matchMedia(TOUCH_MQ);
    this.coarse = this.touch.matches; // the last pointer was a finger: bigger handles and hit areas
    this.toolOpts = this.loadOpts();
    this.tools = createTools();
    for (const t of this.tools) t.app = this;
    this.tool = null;
    this.defFill = { kind: 'solid', color: '#d02b2a', a: 1 };
    this.defStroke = null;
    this.defSW = 2;
    this.charDefaults = { font: 'Studio Oswald', size: 96, weight: 700, tracking: 0, leading: 1.1, align: 'left' };
    this.clipboard = null;
    this.outline = false;
    this.showGrid = false; this.snapGrid = false; this.smartGuides = true;
    this.activeAB = null;
    this.rec = { projectId: null, created: Date.now() };
  }

  // ------------------------------------------------------------ options
  opt(id) { if (!this.toolOpts[id]) this.toolOpts[id] = { ...(TOOL_DEFAULTS[id] || {}) }; return this.toolOpts[id]; }
  loadOpts() { let s = {}; try { s = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') || {}; } catch (e) { s = {}; } const o = {}; for (const [k, v] of Object.entries(TOOL_DEFAULTS)) { o[k] = { ...v }; if (s[k]) for (const kk of Object.keys(v)) if (typeof s[k][kk] === typeof v[kk]) o[k][kk] = s[k][kk]; } return o; }
  saveOpts() { try { localStorage.setItem(OPTS_KEY, JSON.stringify(this.toolOpts)); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------ boot / layout
  init() {
    bootStudio();
    const r = this.root;
    this.saveInd = saveIndicator();
    this.menubarEl = h('div', { class: 'img-menubar' });
    this.titleEl = h('button', { class: 'img-m-title', type: 'button', onclick: () => io.renameDoc(this) });
    this.undoBtn = iconButton('undo', 'Undo', () => this.undo(), { shortcut: 'Mod+Z' });
    this.redoBtn = iconButton('redo', 'Redo', () => this.redo(), { shortcut: 'Mod+Shift+Z' });
    const top = h('header', { class: 'img-top vec-top' },
      h('div', { class: 'img-top-left' },
        h('a', { class: 'studio-icon-btn vec-m-only', href: ROUTES.home, 'aria-label': 'Back to Studio' }, icon('chevronLeft', 20)),
        h('div', { class: 'vec-d-only' }, brandMark({ app: 'VECTOR' })),
        h('div', { class: 'vec-d-only img-menubar-wrap' }, this.menubarEl),
        h('div', { class: 'vec-m-only img-m-titlewrap' }, this.titleEl)),
      h('div', { class: 'img-top-right' },
        h('div', { class: 'vec-d-only' }, this.saveInd.el),
        this.undoBtn, this.redoBtn,
        iconButton('save', 'Save', () => io.save(this), { shortcut: 'Mod+S', cls: 'vec-m-only' }),
        iconButton('dots', 'Menu', () => menuSheet('EYAD VECTOR', [...this.menus, { label: '← Back to portfolio', action: () => goPortfolio() }]), { cls: 'vec-m-only' }),
        h('div', { class: 'vec-d-only img-top-apps' }, appSwitcher('vector')),
        iconButton('command', 'Command palette', () => this.palette.show(), { shortcut: 'Mod+K', cls: 'vec-d-only' }),
        h('div', { class: 'vec-d-only' }, installButton()),
        h('div', { class: 'vec-d-only img-theme-wrap' }, themeToggle()),
        h('div', { class: 'vec-d-only' }, backToPortfolio({ compact: true }))));
    this.optionsBar = h('div', { class: 'img-options vec-options', role: 'toolbar', 'aria-label': 'Tool options' });
    this.toolbarEl = h('div', { class: 'img-toolbar vec-toolbar', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' });
    this.stage = h('div', { class: 'img-stage vec-stage' });
    this.statusEl = h('div', { class: 'img-status vec-status' });
    this.panelsEl = h('aside', { class: 'img-panels vec-panels', 'aria-label': 'Panels' });
    this.dockEl = h('nav', { class: 'img-dock vec-dock', 'aria-label': 'Tools and panels' });
    const main = h('div', { class: 'img-main vec-main' }, this.toolbarEl, h('div', { class: 'img-center vec-center' }, this.stage), this.panelsEl);
    clear(r);
    r.append(top, this.optionsBar, main, this.statusEl, this.dockEl);
    this.applyLayout();
    this.view = new View(this, this.stage);
    this.panels = new Panels(this, this.panelsEl);
    this.buildToolbar();
    this.buildDock();
    this.menus = buildMenus(this);
    createMenubar(this.menubarEl, this.menus);
    this.palette = commandPalette(() => this.commands());
    this.bindPointers();
    this.bindKeys();
    this.bindDrop();
    this.newDoc(createDoc(), { fit: true, quiet: true });
    this.setTool('select');
    const relayout = () => { closeSheet(); this.applyLayout(); this.panels.build(); this.renderOptions(); this.renderOverlay(); };
    for (const mq of [this.mobile, this.land, this.touch]) mq.addEventListener?.('change', relayout);
    onSettings(() => this.render());
    addEventListener('beforeunload', (e) => { if (getSettings().warnOnLeave && this.dirty) { io.autosaveNow(this); e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') io.autosaveNow(this); });
    io.startAutosave(this);
    io.boot(this);
  }

  /** Which layout is live: 'wide' (desktop / tablet), 'port' (phone portrait) or 'land' (phone landscape). */
  layout() { return this.mobile.matches ? (this.land.matches ? 'land' : 'port') : 'wide'; }
  applyLayout() {
    this.root.dataset.vec = this.layout(); this.root.classList.toggle('is-touch', this.touch.matches || this.mobile.matches);
    // portrait sheets sit on top of the dock (tools and panel buttons stay reachable): tell the CSS how tall it is
    if (!this.dockRO) { this.dockRO = new ResizeObserver(() => { const hh = this.dockEl.offsetHeight; this.root.style.setProperty('--vec-dock-h', (hh ? Math.round(hh + (parseFloat(getComputedStyle(this.root).paddingBottom) || 0)) : 0) + 'px'); }); this.dockRO.observe(this.dockEl); }
  }
  /** Handle / hit-area scale: fingers get bigger targets than a mouse or a pen. */
  get hk() { return this.coarse ? 1.75 : 1; }

  buildToolbar() {
    clear(this.toolbarEl);
    const order = ['select', 'direct', null, 'pen', 'pencil', 'brush', null, 'rect', 'ellipse', 'polygon', 'star', 'line', 'arc', null, 'text', 'gradient', 'eyedropper', null, 'artboard', 'hand', 'zoom'];
    for (const id of order) {
      if (!id) { this.toolbarEl.appendChild(h('div', { class: 'img-toolbar-sep' })); continue; }
      const t = this.tools.find((x) => x.id === id);
      const b = h('button', { class: 'img-tool', type: 'button', 'aria-label': t.label, dataset: { tool: id }, onclick: () => this.setTool(id) }, icon(t.icon, 19));
      b.title = t.label + (t.key ? ` (${t.key})` : '');
      this.toolbarEl.appendChild(b);
    }
    this.toolbarEl.appendChild(h('div', { class: 'img-toolbar-sep' }));
    this.swatchEl = h('div', { class: 'vec-swatches' });
    this.toolbarEl.appendChild(this.swatchEl);
    this.renderSwatches();
  }
  renderSwatches() {
    const paint = (p) => (!p ? 'none' : p.kind === 'solid' ? p.color : p.kind === 'pattern' ? p.color : `linear-gradient(90deg, ${(p.stops || []).map((s) => s.color).join(',')})`);
    const f = this.selNodesDeep()[0]?.style || { fill: this.defFill, stroke: this.defStroke };
    clear(this.swatchEl);
    const fill = h('button', { class: 'vec-sw is-fill' + (f.fill ? '' : ' is-none'), type: 'button', title: 'Fill (Appearance panel)', onclick: () => this.panels.focus('appearance') });
    fill.style.background = paint(f.fill);
    const stroke = h('button', { class: 'vec-sw is-stroke' + (f.stroke ? '' : ' is-none'), type: 'button', title: 'Stroke', onclick: () => this.panels.focus('appearance') });
    stroke.style.borderColor = f.stroke && f.stroke.kind === 'solid' ? f.stroke.color : 'var(--st-line-2)';
    const swap = h('button', { class: 'vec-sw-swap', type: 'button', title: 'Swap fill and stroke (Shift+X)', onclick: () => this.cmd('swapFillStroke') }, icon('swap', 11));
    this.swatchEl.append(stroke, fill, swap);
  }
  buildDock() {
    clear(this.dockEl);
    const tools = h('div', { class: 'img-dock-tools' });
    for (const id of ['select', 'direct', 'pen', 'brush', 'pencil', 'rect', 'ellipse', 'star', 'polygon', 'line', 'arc', 'text', 'gradient', 'eyedropper', 'artboard', 'hand', 'zoom']) {
      const t = this.tools.find((x) => x.id === id);
      tools.appendChild(h('button', { class: 'img-dock-tool', type: 'button', 'aria-label': t.label, dataset: { tool: id }, onclick: () => this.setTool(id) }, icon(t.icon, 22), h('span', { text: t.label.split(' ')[0] })));
    }
    const row = h('div', { class: 'img-dock-panels' },
      [['appearance', 'palette', 'Style'], ['character', 'text', 'Font'], ['layers', 'layers', 'Layers'], ['align', 'alignCenter', 'Align'], ['pathfinder', 'union', 'Shapes'], ['artboards', 'artboard', 'Boards']].map(([k, ic, label]) =>
        h('button', { class: 'img-dock-panel', type: 'button', 'aria-label': label, dataset: { panel: k }, onclick: () => (this.panels.sheetKey === k ? closeSheet() : this.panels.sheet(k)) }, icon(ic, 19), h('span', { text: label }))));
    this.dockEl.append(tools, row);
  }

  // ------------------------------------------------------------ tools
  setTool(id) {
    const t = this.tools.find((x) => x.id === id); if (!t) return;
    if (this.tool && this.tool !== t && this.tool.deactivate) this.tool.deactivate();
    this.tool = t;
    this.root.querySelectorAll('.img-tool, .img-dock-tool').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === id));
    this.stage.style.cursor = t.cursor || 'default';
    if (this.mobile.matches) this.dockEl.querySelector('.img-dock-tool.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (id !== 'direct') this.anchorSel = new Set();
    this.renderOptions();
    this.renderOverlay();
    this.updateStatus();
  }
  renderOptions() {
    clear(this.optionsBar);
    const t = this.tool;
    const items = h('div', { class: 'img-opt-items' }, t.options ? t.options(this) : []);
    this.optionsBar.append(h('div', { class: 'img-opt-tool' }, icon(t.icon, 16), h('span', { text: t.label })), items);
    // phones float the bar over the canvas and drop the hints: with no real control left it is hidden
    this.optionsBar.classList.toggle('is-bare', !items.querySelector('button, input, select'));
  }

  // ------------------------------------------------------------ document
  newDoc(doc, { fit = true, quiet = false, projectId = null } = {}) {
    this.doc = doc;
    this.sel = new Set(); this.anchorSel = new Set();
    this.undoStack = []; this.redoStack = []; this.savedIndex = 0; this.dirtyFlag = false;
    this.activeAB = doc.artboards[0]?.id || null;
    this.rec = { projectId, created: doc.created || Date.now(), id: this.rec?.id && quiet ? this.rec.id : uid('r') };
    this.render();
    if (fit) requestAnimationFrame(() => this.view.fitArtboard());
    this.panels.refresh();
    this.updateTitle();
  }
  activeArtboard() { return this.doc.artboards.find((a) => a.id === this.activeAB) || this.doc.artboards[0]; }
  get dirty() { return this.dirtyFlag; }

  // ------------------------------------------------------------ history (document snapshots)
  snapshot() { return JSON.stringify({ artboards: this.doc.artboards, items: this.doc.items, name: this.doc.name }); }
  begin() { if (!this.pending) this.pending = this.snapshot(); }
  cancelChange() { this.pending = null; }
  end(label) {
    const before = this.pending; this.pending = null;
    if (!before) return;
    const after = this.snapshot();
    if (after === before) return;
    this.undoStack.push({ label, before, after, sel: [...this.sel] });
    if (this.undoStack.length > 150) { this.undoStack.shift(); this.savedIndex--; }
    this.redoStack = [];
    this.dirtyFlag = true;
    this.afterChange();
  }
  change(label, fn) { this.begin(); fn(); this.end(label); this.render(); }
  restore(json) {
    const d = JSON.parse(json);
    this.doc.artboards = d.artboards; this.doc.items = d.items; this.doc.name = d.name;
    this.sel = new Set([...this.sel].filter((id) => find(this.doc, id)));
    this.anchorSel = new Set();
    if (!this.doc.artboards.some((a) => a.id === this.activeAB)) this.activeAB = this.doc.artboards[0]?.id;
  }
  undo() { if (this.tool && this.tool.draw) { this.tool.finish(); } const e = this.undoStack.pop(); if (!e) return; this.redoStack.push(e); this.restore(e.before); this.dirtyFlag = this.undoStack.length !== this.savedIndex; this.afterChange(); toast('Undo ' + e.label, { timeout: 900 }); }
  redo() { const e = this.redoStack.pop(); if (!e) return; this.undoStack.push(e); this.restore(e.after); this.dirtyFlag = this.undoStack.length !== this.savedIndex; this.afterChange(); }
  markSaved() { this.savedIndex = this.undoStack.length; this.dirtyFlag = false; io.updateSaveIndicator(this); }
  afterChange() { this.render(); this.panels.refresh(); this.renderSwatches(); this.updateTitle(); io.updateSaveIndicator(this); }

  // ------------------------------------------------------------ nodes
  addNode(n, { select = true, record = true, label = 'Add', index = null } = {}) {
    const fn = () => { if (index == null) this.doc.items.push(n); else this.doc.items.splice(index, 0, n); if (select) { this.sel = new Set([n.id]); } };
    if (record) this.change(label, fn); else { fn(); this.render(); }
    this.panels.refresh();
  }
  removeNode(id) { const f = find(this.doc, id); if (f) f.list.splice(f.index, 1); this.sel.delete(id); }
  selNodes() { return this.doc ? this.doc.items.filter((n) => this.sel.has(n.id)) : []; }
  selNodesDeep() { if (!this.doc) return []; const out = []; walk(this.doc.items, (n) => { if (this.sel.has(n.id)) out.push(n); }); return out; }
  selBounds() { return unionBounds(this.selNodesDeep().map(bounds)); }
  snapshotSel() { return this.selNodesDeep().map((n) => ({ id: n.id, json: JSON.stringify(n) })); }
  restoreSel(snap, m) {
    for (const s of snap) { const f = find(this.doc, s.id); if (!f) continue; const n = JSON.parse(s.json); transformNode(n, m); f.list[f.index] = n; }
  }
  selectionChanged(clearAnchors = true) { if (clearAnchors) this.anchorSel = new Set(); this.renderOverlay(); this.panels.refresh(); this.renderSwatches(); this.updateStatus(); }
  hit(e, deep = false) {
    const el = e && e.target && e.target.closest ? e.target.closest('[data-id]') : null;
    if (!el) return null;
    const id = el.getAttribute('data-id');
    const f = find(this.doc, id); if (!f || f.node.locked) return null;
    if (deep) return f.node;
    // selected deep nodes stay selectable directly
    if (this.sel.has(id)) return f.node;
    return topLevelOf(this.doc, id);
  }
  newStyle(fillable = true) {
    const st = defaultStyle({ fill: fillable ? JSON.parse(JSON.stringify(this.defFill || null)) : null, stroke: this.defStroke ? JSON.parse(JSON.stringify(this.defStroke)) : null, sw: this.defSW });
    return st;
  }
  duplicateSelection({ inPlace = false, record = true, offset = 12 } = {}) {
    const fn = () => {
      const copies = [];
      for (const n of this.selNodes()) { const c = cloneNode(n); if (!inPlace) transformNode(c, translate(offset, offset)); const i = this.doc.items.indexOf(n); this.doc.items.splice(i + 1 + copies.filter(() => false).length, 0, c); copies.push(c); }
      if (copies.length) this.sel = new Set(copies.map((c) => c.id));
    };
    if (record) this.change('Duplicate', fn); else fn();
  }

  // ------------------------------------------------------------ rendering
  render() {
    if (!this.doc) return;
    const defs = [];
    const editing = this.textEditing ? this.textEditing.id : null;
    const items = editing ? filterOut(this.doc.items, editing) : this.doc.items;
    this.view.content.innerHTML = renderNodes(items, defs, { ids: true });
    this.view.defs.innerHTML = defs.join('');
    this.view.content.classList.toggle('is-outline', this.outline);
    let b = '';
    for (const a of this.doc.artboards) {
      const on = a.id === this.activeAB;
      b += `<rect class="vec-ab-shadow" x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}"/>`;
      b += `<rect class="vec-ab${on ? ' is-active' : ''}" x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" fill="${a.bg || 'url(#vec-checker)'}"/>`;
    }
    this.view.boards.innerHTML = `<defs><pattern id="vec-checker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#fff"/><rect width="8" height="8" fill="#e8e8e8"/><rect x="8" y="8" width="8" height="8" fill="#e8e8e8"/></pattern></defs>` + b;
    this.renderOverlay();
  }
  drawGrid() {
    if (!this.showGrid) { this.view.gridG.innerHTML = ''; return; }
    const ab = this.activeArtboard(), g = getSettings().gridSize || 32;
    if (!ab || g * this.view.zoom < 5) { this.view.gridG.innerHTML = ''; return; }
    let d = '';
    for (let x = ab.x + g; x < ab.x + ab.w; x += g) d += `M${x} ${ab.y}V${ab.y + ab.h}`;
    for (let y = ab.y + g; y < ab.y + ab.h; y += g) d += `M${ab.x} ${y}H${ab.x + ab.w}`;
    this.view.gridG.innerHTML = `<path d="${d}" class="vec-gridlines" stroke-width="${1 / this.view.zoom}"/>`;
  }
  screenD(n) { const z = this.view.zoom; return pathD(n, [z, 0, 0, z, this.view.panX, this.view.panY]); }
  selectionOverlay({ handles = false } = {}) {
    let s = '';
    for (const n of this.selNodesDeep()) {
      if (n.type === 'path') s += `<path class="vo-path" d="${this.screenD(n)}"/>`;
      else { const b = bounds(n); if (b) { const a = this.view.toScreen(b.x, b.y); s += `<rect class="vo-box" x="${a.x}" y="${a.y}" width="${b.w * this.view.zoom}" height="${b.h * this.view.zoom}"/>`; } }
    }
    const b = this.selBounds();
    if (b && handles) {
      const a = this.view.toScreen(b.x, b.y), W = b.w * this.view.zoom, H = b.h * this.view.zoom;
      s += `<rect class="vo-bbox" x="${a.x}" y="${a.y}" width="${W}" height="${H}"/>`;
      const k = this.hk, ro = 26 * (k > 1 ? 1.4 : 1), hs = 4 * k;
      s += `<line class="vo-rotline" x1="${a.x + W / 2}" y1="${a.y}" x2="${a.x + W / 2}" y2="${a.y - ro}"/><circle class="vo-rot" cx="${a.x + W / 2}" cy="${a.y - ro}" r="${5 * k}"/>`;
      for (const [fx, fy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) s += `<rect class="vo-h" x="${a.x + W * fx - hs}" y="${a.y + H * fy - hs}" width="${hs * 2}" height="${hs * 2}" rx="${k > 1 ? 3 : 0}"/>`;
    }
    return s;
  }
  renderOverlay() {
    if (!this.view || !this.doc) return;
    let s = '';
    // artboard labels
    for (const a of this.doc.artboards) { const p = this.view.toScreen(a.x, a.y); s += `<text class="vo-ablabel${a.id === this.activeAB ? ' is-active' : ''}" x="${p.x}" y="${p.y - 7}">${escapeXml(a.name)}</text>`; }
    if (this.tool && this.tool.overlay) s += this.tool.overlay(this) || '';
    else s += this.selectionOverlay({ handles: false });
    this.view.overlay.innerHTML = s;
  }
  updateTitle() { const n = this.doc?.name || 'Untitled'; this.titleEl.textContent = n + (this.dirty ? ' •' : ''); document.title = n + ' — EYAD VECTOR'; }
  updateStatus() {
    if (!this.statusEl || !this.doc) return;
    if (!this.st) {
      this.st = { zoom: h('span', { class: 'studio-mono' }), ab: h('span', { class: 'studio-mono' }), sel: h('span'), pos: h('span', { class: 'studio-mono img-status-pos' }), hint: h('span', { class: 'img-status-hint' }) };
      this.saveIndStatus = saveIndicator();
      this.statusEl.append(this.st.zoom, this.st.ab, this.st.pos, this.st.sel, this.st.hint, h('span', { class: 'studio-spacer' }), h('span', { class: 'img-m-hide' }, this.saveIndStatus.el));
    }
    const ab = this.activeArtboard();
    this.st.zoom.textContent = Math.round(this.view.zoom * 100) + '%';
    this.st.ab.textContent = ab ? `${ab.name} · ${ab.w} × ${ab.h} px` : '';
    const n = this.sel.size; this.st.sel.textContent = n ? `${n} selected` : '';
    this.st.hint.textContent = this.tool?.hint || '';
    this.undoBtn.disabled = !this.undoStack.length; this.redoBtn.disabled = !this.redoStack.length;
  }

  // ------------------------------------------------------------ smart guides / snapping
  snapMove(b, dx, dy) {
    if (!b || !this.smartGuides) return { dx, dy, guides: null };
    const tol = 6 / this.view.zoom, guides = [];
    const xs = [], ys = [];
    const selIds = new Set(this.selNodesDeep().map((n) => n.id));
    for (const a of this.doc.artboards) { xs.push(a.x, a.x + a.w / 2, a.x + a.w); ys.push(a.y, a.y + a.h / 2, a.y + a.h); }
    for (const n of this.doc.items) { if (selIds.has(n.id) || n.hidden) continue; const bb = bounds(n); if (!bb) continue; xs.push(bb.x, bb.x + bb.w / 2, bb.x + bb.w); ys.push(bb.y, bb.y + bb.h / 2, bb.y + bb.h); }
    const mx = [b.x + dx, b.x + b.w / 2 + dx, b.x + b.w + dx], my = [b.y + dy, b.y + b.h / 2 + dy, b.y + b.h + dy];
    let bx = null, by = null;
    for (const v of xs) for (const m of mx) if (Math.abs(v - m) < tol && (bx === null || Math.abs(v - m) < Math.abs(bx.d))) bx = { d: v - m, v };
    for (const v of ys) for (const m of my) if (Math.abs(v - m) < tol && (by === null || Math.abs(v - m) < Math.abs(by.d))) by = { d: v - m, v };
    if (this.snapGrid) { const g = getSettings().gridSize || 32; if (!bx) { const t = Math.round((b.x + dx) / g) * g; bx = { d: t - (b.x + dx), v: t }; } if (!by) { const t = Math.round((b.y + dy) / g) * g; by = { d: t - (b.y + dy), v: t }; } }
    if (bx) { dx += bx.d; guides.push([bx.v, -1e5, bx.v, 1e5]); }
    if (by) { dy += by.d; guides.push([-1e5, by.v, 1e5, by.v]); }
    return { dx, dy, guides };
  }

  // ------------------------------------------------------------ pointer input
  bindPointers() {
    const svg = this.view.svg;
    const ptOf = (e) => { const d = this.view.toDoc(e.clientX, e.clientY); const r = svg.getBoundingClientRect(); return { ...d, sx: e.clientX - r.left, sy: e.clientY - r.top, pressure: e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.75, type: e.pointerType, shift: e.shiftKey, alt: e.altKey, mod: e.ctrlKey || e.metaKey }; };
    this.pointers = new Map();
    let pan = null, gesture = null, active = false, stylusSeen = false;
    svg.addEventListener('pointerdown', (e) => {
      if (this.textEditing) this.commitText();
      const coarse = e.pointerType === 'touch';
      if (coarse !== this.coarse) { this.coarse = coarse; this.renderOverlay(); }
      svg.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      if (e.pointerType === 'pen') stylusSeen = true;
      if (e.pointerType === 'touch' && this.pointers.size === 2) {
        if (active) { this.tool.cancel?.(); this.cancelChange(); active = false; this.render(); }
        const [a, b] = [...this.pointers.values()];
        gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.view.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, px: this.view.panX, py: this.view.panY };
        return;
      }
      const pm = getSettings().penMode;
      const fingerPan = e.pointerType === 'touch' && (pm === 'finger-pan' || (pm !== 'finger-draw' && stylusSeen));
      if (e.button === 1 || this.spaceDown || this.tool.pan || fingerPan) { pan = { x: e.clientX, y: e.clientY, px: this.view.panX, py: this.view.panY }; this.stage.style.cursor = 'grabbing'; return; }
      if (e.button !== 0) return;
      e.preventDefault();
      active = true;
      this.tool.down && this.tool.down(ptOf(e), e);
    });
    svg.addEventListener('pointermove', (e) => {
      const p0 = this.pointers.get(e.pointerId); if (p0) { p0.x = e.clientX; p0.y = e.clientY; }
      if (gesture && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()]; const r = svg.getBoundingClientRect();
        const z = clamp(gesture.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, gesture.d), 0.02, 64);
        const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top, omx = gesture.mx - r.left, omy = gesture.my - r.top;
        const dx = (omx - gesture.px) / gesture.z, dy = (omy - gesture.py) / gesture.z;
        this.view.zoom = z; this.view.panX = mx - dx * z; this.view.panY = my - dy * z; this.view.apply();
        return;
      }
      if (pan) { this.view.panX = pan.px + e.clientX - pan.x; this.view.panY = pan.py + e.clientY - pan.y; this.view.apply(); return; }
      const p = ptOf(e);
      if (this.st) this.st.pos.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
      if (active) {
        const evs = e.getCoalescedEvents && this.tool.wantsCoalesced ? e.getCoalescedEvents() : [];
        if (evs.length > 1) for (const ce of evs) this.tool.move && this.tool.move(ptOf(ce), ce); else this.tool.move && this.tool.move(p, e);
      } else if (this.tool.hover) this.tool.hover(p, e);
    });
    const up = (e, cancel) => {
      this.pointers.delete(e.pointerId);
      if (gesture) { if (this.pointers.size < 2) gesture = null; return; }
      if (pan) { pan = null; this.stage.style.cursor = this.tool.cursor || 'default'; return; }
      if (!active) return;
      active = false;
      if (cancel) { this.tool.cancel?.(); this.cancelChange(); this.render(); return; }
      this.tool.up && this.tool.up(ptOf(e), e);
    };
    svg.addEventListener('pointerup', (e) => up(e, false));
    svg.addEventListener('pointercancel', (e) => up(e, true));
    svg.addEventListener('dblclick', (e) => this.tool.dbl && this.tool.dbl(ptOf(e), e));
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || e.altKey) this.view.zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022)), e.clientX - r.left, e.clientY - r.top);
      else { this.view.panX -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; this.view.panY -= e.shiftKey && !e.deltaX ? 0 : e.deltaY; this.view.apply(); }
    }, { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------ text editing
  editText(n, { isNew = false } = {}) {
    if (this.textEditing) this.commitText();
    const b = textBox(n);
    const tf = n.tf || [1, 0, 0, 1, 0, 0];
    const org = this.view.toScreen(...apply(tf, b.x, b.y));
    const sc = Math.hypot(tf[0], tf[1]) * this.view.zoom;
    const ta = h('textarea', { class: 'vec-text-editor', spellcheck: false, value: n.text });
    Object.assign(ta.style, { left: org.x + 'px', top: org.y + 'px', font: fontString(n, n.size * sc), lineHeight: (n.leading || 1.2), letterSpacing: (n.tracking || 0) / 1000 * n.size * sc + 'px', textAlign: n.align, color: n.style?.fill?.color || '#111', width: (n.width > 0 ? n.width * sc : Math.max(80, b.w * sc + 40)) + 'px', minHeight: n.size * sc * 1.3 + 'px' });
    this.stage.appendChild(ta);
    this.textEditing = { id: n.id, node: n, ta, isNew };
    if (!isNew) this.begin();
    this.render();
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; if (!(n.width > 0)) ta.style.width = Math.max(80, ta.scrollWidth + 20) + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.commitText(); } e.stopPropagation(); });
    ta.addEventListener('blur', () => setTimeout(() => this.textEditing && this.textEditing.ta === ta && this.commitText(), 50));
    requestAnimationFrame(() => { ta.focus(); ta.select(); grow(); });
  }
  commitText() {
    const t = this.textEditing; if (!t) return;
    this.textEditing = null;
    const val = t.ta.value;
    t.ta.remove();
    if (t.isNew) {
      if (val.trim()) { t.node.text = val; t.node.name = val.slice(0, 24); this.addNode(t.node, { label: 'Type' }); this.setTool('select'); }
      else this.render();
      return;
    }
    const f = find(this.doc, t.id);
    if (f) { if (val.trim()) { f.node.text = val; f.node.name = val.slice(0, 24); } else f.list.splice(f.index, 1); }
    this.end('Edit Text'); this.render();
  }

  // ------------------------------------------------------------ commands
  cmd(name, arg) { return import('./commands.js').then((m) => m.run(this, name, arg)); }
  commands() {
    const out = [];
    const walkMenu = (items, group) => {
      for (const it of items) {
        if (!it || it.separator) continue;
        const label = typeof it.label === 'function' ? it.label() : it.label;
        const sub = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
        if (sub) walkMenu(sub, group + ' › ' + label);
        else if (it.action && (it.enabled === undefined || (typeof it.enabled === 'function' ? it.enabled() : it.enabled))) out.push({ label, group, shortcut: it.shortcut, run: it.action, icon: it.icon });
      }
    };
    for (const m of this.menus) walkMenu(m.items, m.label);
    for (const t of this.tools) out.push({ label: t.label + ' Tool', group: 'Tools', shortcut: t.key, run: () => this.setTool(t.id), icon: t.icon });
    return out;
  }

  bindKeys() {
    const tool = (id) => () => this.setTool(id);
    const map = {
      'Mod+Z': () => this.undo(), 'Mod+Shift+Z': () => this.redo(), 'Mod+Y': () => this.redo(),
      'Mod+S': () => io.save(this), 'Mod+Shift+S': () => io.saveAs(this), 'Mod+O': () => io.openDialog(this), 'Mod+N': () => io.newDocDialog(this),
      'Mod+Alt+Shift+E': () => io.exportDialog(this), 'Mod+Shift+P': () => io.placeImage(this),
      'Mod+C': () => this.cmd('copy'), 'Mod+X': () => this.cmd('cut'), 'Mod+V': () => this.cmd('paste'), 'Mod+F': () => this.cmd('pasteFront'), 'Mod+B': () => this.cmd('pasteBack'),
      'Mod+D': () => this.duplicateSelection(), 'Mod+A': () => this.cmd('selectAll'), 'Mod+Shift+A': () => this.cmd('deselect'),
      'Mod+G': () => this.cmd('group'), 'Mod+Shift+G': () => this.cmd('ungroup'), 'Mod+8': () => this.cmd('makeCompound'), 'Mod+Alt+Shift+8': () => this.cmd('releaseCompound'),
      'Mod+2': () => this.cmd('lock'), 'Mod+Alt+2': () => this.cmd('unlockAll'), 'Mod+3': () => this.cmd('hide'), 'Mod+Alt+3': () => this.cmd('showAll'),
      'Mod+]': () => this.cmd('arrange', 'up'), 'Mod+[': () => this.cmd('arrange', 'down'), 'Mod+Shift+]': () => this.cmd('arrange', 'top'), 'Mod+Shift+[': () => this.cmd('arrange', 'bottom'),
      'Mod+=': () => this.view.zoomAt(1.25), 'Mod+Plus': () => this.view.zoomAt(1.25), 'Mod+-': () => this.view.zoomAt(0.8), 'Mod+0': () => this.view.fitArtboard(), 'Mod+Alt+0': () => this.view.fitAll(), 'Mod+1': () => this.view.zoomAt(1 / this.view.zoom),
      'Mod+Y': () => { this.outline = !this.outline; this.render(); }, "Mod+'": () => { this.showGrid = !this.showGrid; this.drawGrid(); }, "Mod+Shift+'": () => { this.snapGrid = !this.snapGrid; toast(this.snapGrid ? 'Snap to grid on' : 'Snap to grid off', { timeout: 900 }); }, 'Mod+U': () => { this.smartGuides = !this.smartGuides; toast(this.smartGuides ? 'Smart guides on' : 'Smart guides off', { timeout: 900 }); },
      'Mod+Shift+O': () => this.cmd('outlineStroke'), 'Mod+J': () => this.cmd('join'),
      Delete: () => this.cmd('delete'), Backspace: () => this.cmd('delete'),
      V: tool('select'), A: tool('direct'), P: tool('pen'), N: tool('pencil'), B: tool('brush'), M: tool('rect'), L: tool('ellipse'), '\\': tool('line'),
      T: tool('text'), G: tool('gradient'), I: tool('eyedropper'), H: tool('hand'), Z: tool('zoom'), 'Shift+O': tool('artboard'),
      D: () => this.cmd('defaultColors'), 'Shift+X': () => this.cmd('swapFillStroke'), '/': () => this.cmd('noneFill'),
      Tab: (e) => { if (e.target !== document.body) return false; this.root.classList.toggle('is-panels-hidden'); },
      F: () => { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {}); },
      ArrowLeft: (e) => this.nudge(-1, 0, e), ArrowRight: (e) => this.nudge(1, 0, e), ArrowUp: (e) => this.nudge(0, -1, e), ArrowDown: (e) => this.nudge(0, 1, e),
      'Shift+ArrowLeft': (e) => this.nudge(-10, 0, e), 'Shift+ArrowRight': (e) => this.nudge(10, 0, e), 'Shift+ArrowUp': (e) => this.nudge(0, -10, e), 'Shift+ArrowDown': (e) => this.nudge(0, 10, e),
      'Mod+K': () => this.palette.show(),
    };
    bindKeys(map, { when: () => !this.textEditing });
    document.addEventListener('keydown', (e) => {
      if (isTyping(e) || isDialogOpen() || this.textEditing) return;
      if (e.key === ' ' && !e.repeat) { this.spaceDown = true; this.stage.style.cursor = 'grab'; e.preventDefault(); return; }
      if (this.tool && this.tool.onKey && !modKey(e) && this.tool.onKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Escape') { if (this.panels.sheetKey) closeSheet(); else if (this.sel.size) { this.sel = new Set(); this.selectionChanged(); } }
    }, true);
    document.addEventListener('keyup', (e) => { if (e.key === ' ') { this.spaceDown = false; this.stage.style.cursor = this.tool.cursor || 'default'; } });
  }
  nudge(dx, dy) {
    if (!this.sel.size) return false;
    if (this.tool.id === 'direct' && this.anchorSel.size) {
      this.change('Nudge', () => { for (const key of this.anchorSel) { const [id, si, pi] = key.split(':'); const f = find(this.doc, id); const q = f?.node.subpaths[+si]?.pts[+pi]; if (!q) continue; q.x += dx; q.y += dy; if (q.hi) q.hi = [q.hi[0] + dx, q.hi[1] + dy]; if (q.ho) q.ho = [q.ho[0] + dx, q.ho[1] + dy]; } });
      return;
    }
    this.change('Nudge', () => { for (const n of this.selNodesDeep()) transformNode(n, translate(dx, dy)); });
  }

  bindDrop() {
    const overlay = h('div', { class: 'studio-drop' }, h('div', { class: 'studio-drop-label', text: 'Drop SVG, images or .eyad' }));
    this.root.appendChild(overlay);
    let depth = 0;
    addEventListener('dragenter', (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) { depth++; overlay.classList.add('is-on'); e.preventDefault(); } });
    addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('is-on'); });
    addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault(); });
    addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth = 0; overlay.classList.remove('is-on'); io.handleFiles(this, Array.from(e.dataTransfer.files), { place: true }); });
    addEventListener('paste', (e) => {
      if (isTyping(e) || this.textEditing) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) { e.preventDefault(); io.handleFiles(this, files, { place: true }); return; }
      const txt = e.clipboardData?.getData('text/plain') || '';
      if (/^\s*(<\?xml[\s\S]*?)?<svg[\s>]/i.test(txt)) { e.preventDefault(); io.importSVGText(this, txt, 'Pasted SVG', { place: true }); }
    });
  }
}

function filterOut(items, id) { return items.filter((n) => n.id !== id).map((n) => (n.type === 'group' ? { ...n, children: filterOut(n.children, id) } : n)); }
function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
void FONTS; void scaleAbout; void rotateAbout; void formDialog; void confirmDialog; void openSheet;
