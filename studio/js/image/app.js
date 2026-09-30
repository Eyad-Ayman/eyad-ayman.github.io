// EYAD IMAGE — application controller.
import { h, clear, debounce, isTyping, modKey, uid } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, dialog, confirmDialog, createMenubar, contextMenu, menuSheet, openSheet, closeSheet, commandPalette, saveIndicator, bindKeys, iconButton, isDialogOpen } from '../core/ui.js';
import { getSettings, onSettings } from '../core/settings.js';
import { bootStudio, brandMark, appSwitcher, backToPortfolio, ROUTES, installButton, themeToggle, goPortfolio } from '../core/shell.js';
import { createDoc, findNode, makeNode, effectiveLocked, FONTS, walk, localSize, layoutText } from './doc.js';
import { History, propCmd, treeCmd } from './history.js';
import { View } from './view.js';
import { createTools, TOOL_DEFAULTS, resetTransform } from './tools.js';
import { buildMenus } from './menus.js';
import { LayersPanel, PropertiesPanel, ColorPanel, HistoryPanel } from './panels.js';
import * as ops from './ops.js';
import * as io from './io.js';
import * as pro from './pro.js';

const OPTS_KEY = 'eyad-studio:image-tool-options:v1';

export class ImageApp {
  constructor(root) {
    this.root = root;
    this.records = [];
    this.current = -1;
    this.live = null;
    this.hidden = new Set();
    this.fg = '#111111';
    this.bg = '#ffffff';
    this.recentColors = [];
    this.consts = { FONTS };
    this.clipboard = null;
    this.cloneState = null;
    this.selectedIds = new Set();
    this.mobile = matchMedia('(max-width: 760px) and (orientation: portrait), (max-width: 540px)');
    this.toolOpts = this.loadToolOptions();
    this.tools = createTools();
    for (const t of this.tools) t.app = this;
    this.tool = null;
    this.lastFillTool = 'gradient';
    this.panelVis = { color: true, properties: true, layers: true, history: true, options: true };
  }

  // ------------------------------------------------------------ getters
  get rec() { return this.records[this.current] || null; }
  get doc() { return this.rec ? this.rec.doc : null; }
  get history() { return this.rec ? this.rec.history : null; }
  get active() { const d = this.doc; if (!d || !d.activeId) return null; const f = findNode(d, d.activeId); return f ? f.node : null; }
  isLocked(n) { return !!n && effectiveLocked(this.doc, n); }

  opt(toolId) { if (!this.toolOpts[toolId]) this.toolOpts[toolId] = { ...(TOOL_DEFAULTS[toolId] || {}) }; return this.toolOpts[toolId]; }
  loadToolOptions() {
    const o = {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') || {}; } catch (e) { saved = {}; }
    for (const [k, v] of Object.entries(TOOL_DEFAULTS)) {
      o[k] = { ...v };
      const s = saved[k];
      if (s && typeof s === 'object') for (const kk of Object.keys(v)) if (typeof s[kk] === typeof v[kk]) o[k][kk] = s[kk];
    }
    return o;
  }
  optionsChanged(toolId, key) {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(this.toolOpts)); } catch (e) { /* ignore */ }
    const t = this.tools.find((x) => x.id === toolId);
    if (t && t.optionChanged) t.optionChanged(key);
    this.view.requestDraw();
  }

  // ------------------------------------------------------------ layout
  init() {
    bootStudio();
    const r = this.root;
    this.saveInd = saveIndicator();
    this.menubarEl = h('div', { class: 'img-menubar' });
    this.titleEl = h('button', { class: 'img-m-title', type: 'button', onclick: () => this.docMenuMobile() });
    this.undoBtn = iconButton('undo', 'Undo', () => this.undo(), { shortcut: 'Mod+Z' });
    this.redoBtn = iconButton('redo', 'Redo', () => this.redo(), { shortcut: 'Mod+Shift+Z' });

    const top = h('header', { class: 'img-top' },
      h('div', { class: 'img-top-left' },
        h('a', { class: 'studio-icon-btn img-m-only', href: ROUTES.home, 'aria-label': 'Back to Studio' }, icon('chevronLeft', 20)),
        h('div', { class: 'img-d-only' }, brandMark({ app: 'IMAGE' })),
        h('div', { class: 'img-d-only img-menubar-wrap' }, this.menubarEl),
        h('div', { class: 'img-m-only img-m-titlewrap' }, this.titleEl)),
      h('div', { class: 'img-top-right' },
        h('div', { class: 'img-d-only' }, this.saveInd.el),
        iconButton('layers', 'Show / hide panels', () => { this.root.classList.toggle('is-panels-collapsed'); setTimeout(() => this.view.resize(), 30); }, { cls: 'img-land-only' }),
        this.undoBtn, this.redoBtn,
        iconButton('save', 'Save', () => io.save(this), { shortcut: 'Mod+S', cls: 'img-m-only' }),
        iconButton('dots', 'Menu', () => menuSheet('EYAD IMAGE', [...this.menus, { label: '← Back to portfolio', action: () => goPortfolio() }]), { cls: 'img-m-only' }),
        h('div', { class: 'img-d-only img-top-apps' }, appSwitcher('image')),
        iconButton('command', 'Command palette', () => this.palette.show(), { shortcut: 'Mod+K', cls: 'img-d-only' }),
        h('div', { class: 'img-d-only' }, installButton()),
        h('div', { class: 'img-d-only img-theme-wrap' }, themeToggle()),
        h('div', { class: 'img-d-only' }, backToPortfolio({ compact: true }))));

    this.optionsBar = h('div', { class: 'img-options', role: 'toolbar', 'aria-label': 'Tool options' });
    this.tabsEl = h('div', { class: 'img-tabs', role: 'tablist' });
    this.toolbarEl = h('div', { class: 'img-toolbar', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' });
    this.stage = h('div', { class: 'img-stage' });
    this.emptyEl = this.buildEmpty();
    this.stage.appendChild(this.emptyEl);
    this.statusEl = h('div', { class: 'img-status' });
    this.panelsEl = h('aside', { class: 'img-panels', 'aria-label': 'Panels' });
    this.dockEl = h('div', { class: 'img-dock img-m-only' });

    const main = h('div', { class: 'img-main' }, this.toolbarEl, h('div', { class: 'img-center' }, this.tabsEl, this.stage), this.panelsEl);
    clear(r);
    r.append(top, this.optionsBar, main, this.statusEl, this.dockEl);

    this.view = new View(this, this.stage);
    this.view.onChange = () => this.updateStatus();
    this.onViewChange = () => { this.updateStatus(); if (this.textEditor) this.textEditor.position(); };

    this.panels = {
      color: new ColorPanel(this),
      properties: new PropertiesPanel(this),
      layers: new LayersPanel(this),
      history: new HistoryPanel(this),
    };
    this.buildPanels();
    this.buildToolbar();
    this.buildDock();
    this.menus = buildMenus(this);
    createMenubar(this.menubarEl, this.menus);
    this.palette = commandPalette(() => this.commands());
    this.bindKeyboard();
    this.bindDrop();
    this.bindPaste();
    this.selectTool('move');
    this.refresh();
    this.mobile.addEventListener?.('change', () => { closeSheet(); this.buildPanels(); this.view.resize(); });
    onSettings(() => { this.view._checker = null; this.view.requestDraw(); this.updateStatus(); });
    addEventListener('beforeunload', (e) => {
      if (getSettings().warnOnLeave && this.records.some((r2) => r2.history.dirty)) { io.autosaveNow(this); e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') io.autosaveNow(this); });
    io.startAutosave(this);
    io.boot(this);
  }

  buildEmpty() {
    return h('div', { class: 'img-empty' },
      h('div', { class: 'img-empty-inner' },
        h('p', { class: 'studio-label', text: 'EYAD IMAGE' }),
        h('h1', { class: 'img-empty-title', text: 'Start something.' }),
        h('div', { class: 'img-empty-actions' },
          h('button', { class: 'studio-btn is-primary', type: 'button', onclick: () => io.newDocDialog(this) }, icon('plus', 16), 'New image'),
          h('button', { class: 'studio-btn', type: 'button', onclick: () => io.openDialog(this) }, icon('folder', 16), 'Open file'),
          h('button', { class: 'studio-btn', type: 'button', onclick: () => io.openDialog(this, 'psd') }, icon('layers', 16), 'Open PSD'),
          h('a', { class: 'studio-btn is-ghost', href: ROUTES.projects }, icon('folder', 16), 'Projects')),
        h('p', { class: 'studio-dim studio-small img-empty-hint', text: 'Or drop a PSD, PNG, JPG, WebP, GIF, SVG or .eyad file anywhere. Files stay on this device.' })));
  }

  buildPanels() {
    clear(this.panelsEl);
    if (this.mobile.matches) { this.root.classList.add('is-mobile'); return; }
    this.root.classList.remove('is-mobile');
    const order = ['color', 'properties', 'layers', 'history'];
    for (const k of order) {
      const p = this.panels[k];
      p.el.hidden = !this.panelVis[k];
      this.panelsEl.appendChild(p.el);
    }
    this.optionsBar.hidden = !this.panelVis.options;
  }

  openPanelSheet(key) {
    const p = this.panels[key];
    const titles = { color: 'Colour', properties: 'Properties', layers: 'Layers', history: 'History' };
    p.el.hidden = false;
    const body = p.body;
    const sheet = openSheet({ title: titles[key], content: body, onClose: () => { p.head.after(body); } });
    p.refresh();
    return sheet;
  }

  buildToolbar() {
    clear(this.toolbarEl);
    const order = ['move', 'marquee', 'lasso', 'polylasso', 'aiselect', 'quick', 'wand', 'crop', null, 'brush', 'eraser', 'heal', 'clone', 'gradient', 'bucket', null, 'text', 'shape', 'pen', null, 'eyedropper', 'hand', 'zoom'];
    for (const id of order) {
      if (!id) { this.toolbarEl.appendChild(h('div', { class: 'img-toolbar-sep' })); continue; }
      const t = this.tools.find((x) => x.id === id);
      const b = h('button', { class: 'img-tool', type: 'button', 'aria-label': t.label, 'aria-pressed': 'false', dataset: { tool: id }, onclick: () => this.selectTool(id) }, icon(t.icon, 19));
      b.title = `${t.label} (${t.id === 'bucket' ? 'Shift+G' : t.key})`;
      this.toolbarEl.appendChild(b);
    }
    this.toolbarEl.appendChild(h('div', { class: 'img-toolbar-sep' }));
    this.swatchEl = h('div', { class: 'img-swatches' });
    this.toolbarEl.appendChild(this.swatchEl);
    this.renderSwatches();
  }

  renderSwatches() {
    clear(this.swatchEl);
    const fgIn = h('input', { type: 'color', class: 'img-swatch-input', value: this.fg, 'aria-label': 'Foreground colour' });
    const bgIn = h('input', { type: 'color', class: 'img-swatch-input', value: this.bg, 'aria-label': 'Background colour' });
    fgIn.addEventListener('input', () => this.setFg(fgIn.value));
    bgIn.addEventListener('input', () => this.setBg(bgIn.value));
    this.swatchEl.append(
      h('label', { class: 'img-swatch is-bg', style: { background: this.bg }, title: 'Background colour' }, bgIn),
      h('label', { class: 'img-swatch is-fg', style: { background: this.fg }, title: 'Foreground colour' }, fgIn),
      h('button', { class: 'img-swatch-swap', type: 'button', title: 'Swap colours (X)', 'aria-label': 'Swap colours', onclick: () => this.swapColors() }, icon('swap', 12)),
      h('button', { class: 'img-swatch-reset', type: 'button', title: 'Default colours (D)', 'aria-label': 'Default colours', onclick: () => this.resetColors() }));
  }

  buildDock() {
    clear(this.dockEl);
    const tools = h('div', { class: 'img-dock-tools' });
    for (const id of ['move', 'brush', 'eraser', 'marquee', 'lasso', 'aiselect', 'quick', 'wand', 'heal', 'text', 'shape', 'crop', 'gradient', 'bucket', 'clone', 'pen', 'polylasso', 'eyedropper', 'hand', 'zoom']) {
      const t = this.tools.find((x) => x.id === id);
      const short = { marquee: 'Select', bucket: 'Fill', clone: 'Clone', eyedropper: 'Picker', quick: 'Quick', wand: 'Wand', heal: 'Heal', polylasso: 'Polygon', aiselect: 'AI Select' }[id] || t.label.split(' ')[0];
      tools.appendChild(h('button', { class: 'img-dock-tool', type: 'button', 'aria-label': t.label, dataset: { tool: id }, onclick: () => this.selectTool(id) }, icon(t.icon, 22), h('span', { text: short })));
    }
    const panelsRow = h('div', { class: 'img-dock-panels' },
      [['layers', 'layers', 'Layers'], ['properties', 'sliders', 'Properties'], ['history', 'history', 'History']].map(([k, ic, label]) =>
        h('button', { class: 'img-dock-panel', type: 'button', onclick: () => this.openPanelSheet(k) }, icon(ic, 18), h('span', { text: label }))),
      h('button', { class: 'img-dock-panel', type: 'button', onclick: () => import('./ai.js').then((m) => m.aiPanel(this)) }, icon('sparkle', 18), h('span', { text: 'AI' })),
      h('button', { class: 'img-dock-panel img-dock-color', type: 'button', 'aria-label': 'Foreground colour', onclick: () => this.openPanelSheet('color') }, this.dockSwatch = h('span', { class: 'img-dock-swatch', style: { background: this.fg } }), h('span', { text: 'Colour' })));
    this.dockEl.append(tools, panelsRow);
  }

  // ------------------------------------------------------------ tools
  selectTool(id) {
    const t = this.tools.find((x) => x.id === id);
    if (!t) return;
    if (this.textEditor && id !== 'text') this.closeTextEditor();
    if (this.tool && this.tool !== t) { this.tool.cancel && this.view.toolActive && this.tool.cancel(); this.tool.deactivate && this.tool.deactivate(); }
    this.tool = t;
    if (t.group === 'fill') this.lastFillTool = id;
    if (['quick', 'wand', 'aiselect'].includes(id)) this.lastSelectTool = id;
    this.root.querySelectorAll('[data-tool]').forEach((b) => { const on = b.dataset.tool === id; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
    this.renderOptions();
    this.updateCursor();
    if (t.activate) t.activate();
    this.view && this.view.requestDraw();
    this.updateStatus();
  }
  renderOptions() {
    clear(this.optionsBar);
    const t = this.tool; if (!t) return;
    this.optionsBar.append(
      h('div', { class: 'img-opt-tool' }, icon(t.icon, 16), h('span', { text: t.label })),
      h('div', { class: 'img-opt-items' }, this.doc ? t.options(this) : h('span', { class: 'studio-dim studio-small', text: 'Open or create a document to use this tool.' })));
  }
  updateCursor() { if (this.view && this.tool) this.view.canvas.style.cursor = this.view.spaceDown ? 'grab' : (this.tool.cursor || 'default'); }

  // ------------------------------------------------------------ colours
  setFg(c) { this.fg = c; this.pushRecent(c); this.renderSwatches(); if (this.dockSwatch) this.dockSwatch.style.background = c; this.panels.color.refresh(); }
  setBg(c) { this.bg = c; this.renderSwatches(); this.panels.color.refresh(); }
  swapColors() { [this.fg, this.bg] = [this.bg, this.fg]; this.renderSwatches(); if (this.dockSwatch) this.dockSwatch.style.background = this.fg; this.panels.color.refresh(); }
  resetColors() { this.fg = '#111111'; this.bg = '#ffffff'; this.renderSwatches(); if (this.dockSwatch) this.dockSwatch.style.background = this.fg; this.panels.color.refresh(); }
  pushRecent(c) { this.recentColors = [c, ...this.recentColors.filter((x) => x !== c)].slice(0, 12); }

  // ------------------------------------------------------------ documents
  addDocument(doc, { projectId = null, recovered = false, history = null, meta = {} } = {}) {
    const rec = {
      id: doc.id, doc, projectId, recovered, created: meta.created || Date.now(),
      history: history || new History({ limit: getSettings().historyLimit, onChange: (kind, cmd) => this.onHistoryChange(rec, kind, cmd) }),
      viewState: null, autosavedSeq: 0, thumb: meta.thumb || null,
    };
    rec.history.onChange = (kind, cmd) => this.onHistoryChange(rec, kind, cmd);
    if (recovered) rec.history.savedSeq = -1; // shows as unsaved
    this.records.push(rec);
    this.switchTo(this.records.length - 1);
    return rec;
  }
  switchTo(i) {
    if (this.textEditor) this.closeTextEditor();
    if (this.rec) this.rec.viewState = this.view.getState();
    this.current = i;
    this.live = null;
    this.selectedIds = new Set(this.doc && this.doc.activeId ? [this.doc.activeId] : []);
    this.emptyEl.hidden = !!this.doc;
    this.view.canvas.hidden = !this.doc;
    if (this.doc) this.view.setDoc(this.doc, this.rec.viewState); else { this.view.doc = null; this.view.requestDraw(); }
    if (this.tool && this.tool.activate) this.tool.activate();
    this.renderOptions();
    this.refresh();
    io.updateUrl(this);
  }
  async closeDoc(i = this.current) {
    const rec = this.records[i]; if (!rec) return;
    if (rec.history.dirty) {
      const v = await dialog({
        title: 'Save changes?', body: h('p', { text: `“${rec.doc.name}” has unsaved changes.` }),
        buttons: [{ label: 'Cancel', value: null }, { label: 'Don’t save', value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
      });
      if (!v) return;
      if (v === 'save') { const prev = this.current; this.current = i; const ok = await io.save(this); this.current = prev; if (!ok) return; }
    }
    io.dropRecovery(rec);
    this.records.splice(i, 1);
    this.switchTo(Math.min(i, this.records.length - 1));
    import('./psd.js').then((m) => m.releasePsdWorker());
  }

  onHistoryChange(rec, kind, cmd) {
    if (rec !== this.rec) return;
    if (kind === 'undo' || kind === 'redo') {
      if (cmd && cmd.resized) this.docResized();
      const d = this.doc;
      if (d.activeId && !findNode(d, d.activeId)) d.activeId = d.layers.length ? d.layers[d.layers.length - 1].id : null;
      walk(d.layers, (n) => { n._dirtyThumb = true; });
      this.invalidate();
    }
    this.refresh();
    io.scheduleAutosave(this);
  }

  // ------------------------------------------------------------ editing core
  setActive(id, { additive = false, range = false } = {}) {
    const d = this.doc; if (!d) return;
    if (this.textEditor) this.closeTextEditor();
    if (range && d.activeId) {
      const flat = []; walk(d.layers, (n) => { flat.push(n.id); });
      const a = flat.indexOf(d.activeId), b = flat.indexOf(id);
      const [s, e] = a < b ? [a, b] : [b, a];
      this.selectedIds = new Set(flat.slice(s, e + 1));
    } else if (additive) {
      if (this.selectedIds.has(id) && this.selectedIds.size > 1) { this.selectedIds.delete(id); d.activeId = [...this.selectedIds].pop(); this.refresh(); this.view.requestDraw(); return; }
      this.selectedIds.add(id);
    } else this.selectedIds = new Set([id]);
    d.activeId = id;
    const n = this.active;
    if (n && n.type === 'text') { const o = this.opt('text'); o.font = n.font; o.size = n.size; o.weight = n.weight; o.align = n.align; if (this.tool.id === 'text') this.renderOptions(); }
    this.refresh();
    this.view.requestDraw();
  }
  setLive(live) { this.live = live; this.invalidate(); }
  invalidate(rect) { if (this.view) this.view.invalidate(rect); }
  docResized() { this.view.comp = null; this.view.invalidate(); if (this.tool && this.tool.id === 'crop') this.tool.reset(); this.updateStatus(); }

  commit(cmd, { quiet = false } = {}) {
    if (!cmd || !this.history) return;
    this.history.push(cmd);
    const n = this.active;
    if (n) n._dirtyThumb = true;
    this.invalidate();
    if (!quiet) this.refresh();
  }
  undo() { if (this.textEditor) this.closeTextEditor(); if (this.history && this.history.canUndo) { this.history.undo(); } }
  redo() { if (this.textEditor) this.closeTextEditor(); if (this.history && this.history.canRedo) { this.history.redo(); } }

  /** Insert node above the active layer (same parent) and select it. */
  insertNode(n, label = 'New Layer', { parentArr = null, index = null } = {}) {
    const d = this.doc;
    const cmd = treeCmd(d, label, () => {
      const a = d.activeId ? findNode(d, d.activeId) : null;
      let arr = parentArr || d.layers, idx = index;
      if (idx === null) {
        if (a && !parentArr) {
          if (a.node.type === 'group' && a.node.expanded) { arr = a.node.children; idx = arr.length; }
          else { arr = a.arr; idx = a.index + 1; }
        } else idx = arr.length;
      }
      arr.splice(idx, 0, n);
      d.activeId = n.id;
    });
    this.selectedIds = new Set([n.id]);
    this.commit(cmd);
    return n;
  }

  async ensureRasterTarget(label) {
    const d = this.doc; if (!d) return null;
    let n = this.active;
    if (!n) { n = makeNode('raster', { width: d.width, height: d.height }); this.insertNode(n, 'New Layer'); return n; }
    if (this.isLocked(n)) { toast(`“${n.name}” is locked.`, { type: 'warn' }); return null; }
    if (!n.visible) { toast(`“${n.name}” is hidden — show it to edit it.`, { type: 'warn' }); return null; }
    if (n.type === 'raster') return n;
    if (n.type === 'group') { toast('Groups can’t be painted on. Select a layer inside the group.', { type: 'warn' }); return null; }
    const kind = n.type === 'text' ? 'text' : 'shape';
    const ok = await confirmDialog('Rasterize layer?', `“${n.name}” is a ${kind} layer. ${label} needs pixels, so it must be rasterized first — its ${kind} settings will no longer be editable.`, { ok: 'Rasterize' });
    if (!ok) return null;
    ops.rasterize(this, n);
    return this.active;
  }

  // ------------------------------------------------------------ text editing
  openTextEditor(node, isNew) {
    const app = this, d = this.doc;
    if (this.textEditor) this.closeTextEditor();
    const beforeText = node.text;
    const beforeProps = { text: node.text };
    let snapshotBefore = null;
    if (isNew) {
      // insert without history; the commit below records it as one step
      const a = d.activeId ? findNode(d, d.activeId) : null;
      snapshotBefore = { arr: a ? a.arr : d.layers, index: a ? a.index + 1 : d.layers.length, activeId: d.activeId };
      snapshotBefore.arr.splice(snapshotBefore.index, 0, node);
      d.activeId = node.id;
      this.selectedIds = new Set([node.id]);
    }
    this.hidden.add(node.id);
    const ta = h('textarea', { class: 'img-text-editor', spellcheck: false, 'aria-label': 'Text' });
    ta.value = node.text;
    this.stage.appendChild(ta);
    const ed = {
      node,
      position() {
        const v = app.view, z = v.zoom;
        const s = v.docToScreen(node.x, node.y);
        const { w, h: hh } = localSize(node);
        ta.style.left = s.x + 'px'; ta.style.top = s.y + 'px';
        ta.style.minWidth = Math.max(40, (w + node.size) * z * Math.abs(node.sx)) + 'px';
        ta.style.height = Math.max(20, hh * z * Math.abs(node.sy) + 8) + 'px';
        ta.style.font = `${node.italic ? 'italic ' : ''}${node.weight} ${node.size * z * Math.abs(node.sy)}px ${node.font.includes(',') ? node.font : `'${node.font}'`}`;
        ta.style.lineHeight = String(node.lineHeight);
        ta.style.color = node.color;
        ta.style.textAlign = node.align;
        ta.style.letterSpacing = (node.tracking || 0) * z + 'px';
      },
      sync() { this.position(); },
    };
    ta.addEventListener('input', () => { node.text = ta.value; delete node._layout; ed.position(); app.invalidate(); });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); app.closeTextEditor(); }
    });
    ed.close = () => {
      ta.remove();
      app.hidden.delete(node.id);
      app.textEditor = null;
      const text = node.text;
      if (isNew) {
        const arr = snapshotBefore.arr; const idx = arr.indexOf(node);
        if (!text.trim()) { if (idx >= 0) arr.splice(idx, 1); d.activeId = snapshotBefore.activeId; app.invalidate(); app.refresh(); return; }
        if (idx >= 0) arr.splice(idx, 1);
        d.activeId = snapshotBefore.activeId;
        node.name = text.split('\n')[0].slice(0, 40) || 'Text';
        app.insertNode(node, 'Add Text');
      } else if (text !== beforeText) {
        if (!text.trim()) { node.text = beforeText; app.invalidate(); app.refresh(); toast('Empty text reverted. Delete the layer to remove it.'); return; }
        app.commit(propCmd('Edit Text', node, beforeProps, { text }));
      } else { app.invalidate(); app.refresh(); }
    };
    this.textEditor = ed;
    ed.position();
    this.invalidate();
    setTimeout(() => { ta.focus(); ta.select(); }, 0);
  }
  closeTextEditor() { if (this.textEditor) this.textEditor.close(); }

  // ------------------------------------------------------------ gestures from the view
  onDoubleTap(pt) {
    const d = this.doc; if (!d) return;
    const hit = ops.hit(this, pt);
    if (hit && hit.type === 'text' && !this.isLocked(hit)) { this.selectTool('text'); this.setActive(hit.id); this.openTextEditor(hit, false); return; }
    if (!hit) this.view.fit();
  }
  onContextMenu(pt, x, y) {
    const d = this.doc; if (!d) return;
    const hit = ops.hit(this, pt);
    if (hit && hit.id !== d.activeId) this.setActive(hit.id);
    const n = this.active;
    contextMenu(x, y, [
      n ? { heading: n.name } : null,
      { label: 'Duplicate layer', action: () => ops.duplicate(this), enabled: !!n },
      { label: 'Delete layer', action: () => ops.deleteLayers(this), enabled: !!n },
      { label: n && n.visible ? 'Hide layer' : 'Show layer', action: () => ops.toggleVisible(this, n), enabled: !!n },
      { label: n && n.locked ? 'Unlock layer' : 'Lock layer', action: () => ops.toggleLock(this, n), enabled: !!n },
      { label: 'Edit text', action: () => { this.selectTool('text'); this.openTextEditor(n, false); }, enabled: !!n && n.type === 'text' && !this.isLocked(n) },
      { label: 'Rasterize', action: () => ops.rasterize(this, n), enabled: !!n && (n.type === 'text' || n.type === 'shape') },
      { label: 'Reset transform', action: () => resetTransform(this), enabled: !!n && n.type !== 'group' },
      { separator: true },
      { label: 'Paste', action: () => ops.paste(this) },
      { label: 'Select all', action: () => ops.selectAll(this) },
      { label: 'Deselect', action: () => ops.deselect(this), enabled: !!d.selection },
      { label: 'Layer properties…', action: () => (this.mobile.matches ? this.openPanelSheet('properties') : this.panels.properties.el.scrollIntoView()) },
    ]);
  }
  onPointerHover(pt) { this.cursorPos = pt; this.updateStatusCursor(); }

  docMenuMobile() {
    const items = this.records.map((r2, i) => ({ label: (r2.history.dirty ? '• ' : '') + r2.doc.name, checked: i === this.current, action: () => this.switchTo(i) }));
    menuSheet('Documents', [{ label: 'Open documents', items: [...items, { separator: true }, { label: 'New image…', action: () => io.newDocDialog(this) }, { label: 'Open…', action: () => io.openDialog(this) }, { label: 'Rename…', action: () => ops.renameDoc(this), enabled: !!this.doc }, { label: 'Close document', action: () => this.closeDoc(), enabled: !!this.doc }] }]);
  }

  // ------------------------------------------------------------ refresh
  refresh() {
    if (this._refreshQueued) return;
    this._refreshQueued = true;
    requestAnimationFrame(() => {
      this._refreshQueued = false;
      for (const p of Object.values(this.panels)) p.refresh();
      this.renderTabs();
      this.updateStatus();
      const hst = this.history;
      this.undoBtn.disabled = !hst || !hst.canUndo;
      this.redoBtn.disabled = !hst || !hst.canRedo;
      this.titleEl.textContent = this.doc ? this.doc.name + (hst && hst.dirty ? ' •' : '') : 'EYAD IMAGE';
      document.title = (this.doc ? this.doc.name + (hst && hst.dirty ? ' •' : '') + ' — ' : '') + 'EYAD IMAGE';
    });
  }
  refreshProperties() { this.panels.properties.refresh(); }

  renderTabs() {
    clear(this.tabsEl);
    this.tabsEl.hidden = this.records.length === 0;
    this.records.forEach((r2, i) => {
      const tab = h('div', { class: 'img-tab' + (i === this.current ? ' is-active' : ''), role: 'tab', 'aria-selected': String(i === this.current) },
        h('button', { class: 'img-tab-name', type: 'button', text: r2.doc.name + ' @ ' + (i === this.current ? Math.round(this.view.zoom * 100) : Math.round((r2.viewState?.zoom || 1) * 100)) + '%', title: r2.doc.name, onclick: () => this.switchTo(i) }),
        r2.history.dirty ? h('span', { class: 'img-tab-dot', title: 'Unsaved changes' }) : null,
        h('button', { class: 'img-tab-close', type: 'button', 'aria-label': 'Close ' + r2.doc.name, onclick: () => this.closeDoc(i) }, icon('close', 12)));
      this.tabsEl.appendChild(tab);
    });
    this.tabsEl.appendChild(h('button', { class: 'img-tab-new', type: 'button', 'aria-label': 'New image', title: 'New image', onclick: () => io.newDocDialog(this) }, icon('plus', 14)));
  }

  updateStatus() {
    if (!this.statusEl) return;
    if (!this._statusBuilt) {
      this.zoomInput = h('input', { class: 'studio-input is-num img-zoom-input', type: 'text', 'aria-label': 'Zoom', inputmode: 'decimal' });
      this.zoomInput.addEventListener('change', () => { const v = parseFloat(this.zoomInput.value); if (v > 0) this.view.setZoom(v / 100); else this.updateStatus(); });
      this.st = { doc: h('span', { class: 'studio-mono' }), pos: h('span', { class: 'studio-mono img-status-pos' }), layer: h('span', { class: 'img-status-layer' }), hint: h('span', { class: 'img-status-hint' }), mem: h('span', { class: 'studio-mono studio-faint' }) };
      this.statusEl.append(h('span', { class: 'img-status-zoom' }, this.zoomInput, '%'), this.st.doc, this.st.pos, this.st.layer, this.st.hint, h('span', { class: 'studio-spacer' }), this.st.mem, h('span', { class: 'img-m-hide' }, this.saveIndStatus = saveIndicator().el));
      this._statusBuilt = true;
    }
    const d = this.doc;
    if (document.activeElement !== this.zoomInput) this.zoomInput.value = d ? String(Math.round(this.view.zoom * 1000) / 10) : '—';
    this.st.doc.textContent = d ? `${d.width} × ${d.height} px · RGB/8` : 'No document';
    const n = this.active;
    this.st.layer.textContent = n ? `${n.name}${this.selectedIds.size > 1 ? ` (+${this.selectedIds.size - 1})` : ''}` : '';
    this.st.hint.textContent = this.tool ? this.tool.hint || '' : '';
    this.st.mem.textContent = this.history ? `History ${this.history.index + 1}/${this.history.stack.length}` : '';
    io.updateSaveIndicator(this);
    const tab = this.tabsEl.querySelector('.img-tab.is-active .img-tab-name');
    if (tab && d) tab.textContent = d.name + ' @ ' + Math.round(this.view.zoom * 100) + '%';
  }
  updateStatusCursor() {
    if (!this.st || !this.cursorPos || !this.doc) return;
    this.st.pos.textContent = `${Math.floor(this.cursorPos.x)}, ${Math.floor(this.cursorPos.y)}`;
  }

  // ------------------------------------------------------------ keyboard
  bindKeyboard() {
    const tool = (id) => () => { if (!this.doc && id !== 'hand') return; this.selectTool(id); };
    const map = {
      'Mod+Z': () => this.undo(), 'Mod+Shift+Z': () => this.redo(), 'Mod+Y': () => this.redo(),
      'Mod+S': () => io.save(this), 'Mod+Shift+S': () => io.saveAs(this), 'Mod+O': () => io.openDialog(this), 'Mod+N': () => io.newDocDialog(this),
      'Mod+Alt+N': () => io.newDocDialog(this),
      'Mod+W': () => this.closeDoc(), 'Mod+Alt+Shift+W': () => io.exportDialog(this), 'Mod+Alt+E': () => io.exportDialog(this),
      'Mod+C': () => ops.copy(this), 'Mod+X': () => ops.cut(this), 'Mod+A': () => ops.selectAll(this), 'Mod+D': () => ops.deselect(this),
      'Mod+Shift+D': () => ops.reselect(this), 'Mod+Shift+I': () => ops.invert(this), 'Mod+T': () => this.selectTool('move'),
      'Mod+J': () => ops.layerViaCopy(this), 'Mod+Shift+J': () => ops.layerViaCut(this), 'Mod+Shift+N': () => ops.newLayer(this),
      'Mod+G': () => ops.groupLayers(this), 'Mod+Shift+G': () => ops.ungroup(this), 'Mod+E': () => ops.mergeDown(this), 'Mod+Shift+E': () => ops.mergeVisible(this),
      'Mod+]': () => ops.reorder(this, 'up'), 'Mod+[': () => ops.reorder(this, 'down'), 'Mod+Shift+]': () => ops.reorder(this, 'top'), 'Mod+Shift+[': () => ops.reorder(this, 'bottom'),
      'Mod+=': () => this.view.zoomStep(1), 'Mod+Plus': () => this.view.zoomStep(1), 'Mod+Shift+Plus': () => this.view.zoomStep(1), 'Mod+-': () => this.view.zoomStep(-1),
      'Mod+0': () => this.view.fit(), 'Mod+1': () => this.view.actualSize(), "Mod+'": () => ops.toggleGrid(this), 'Mod+;': () => ops.toggleGuides(this),
      'Mod+Alt+I': () => ops.imageSizeDialog(this), 'Mod+Alt+C': () => ops.canvasSizeDialog(this), 'Mod+L': () => pro.levelsDialog(this),
      'Mod+U': () => ops.adjust(this, 'hueSaturation'), 'Mod+I': () => ops.quickOp(this, 'invert', 'Invert'), 'Mod+Shift+U': () => ops.quickOp(this, 'desaturate', 'Desaturate'),
      'Mod+Alt+F': () => ops.repeatFilter(this),
      'Shift+F5': () => ops.fillDialog(this), 'Shift+Backspace': () => ops.fillWith(this, this.fg, 'Fill'), 'Mod+Backspace': () => ops.fillWith(this, this.bg, 'Fill'),
      'Alt+Backspace': () => ops.fillWith(this, this.fg, 'Fill'), 'Shift+F6': () => ops.featherDialog(this),
      Delete: () => ops.clearOrDelete(this), Backspace: () => ops.clearOrDelete(this),
      V: tool('move'), M: tool('marquee'), L: () => this.doc && this.selectTool(this.tool?.id === 'polylasso' ? 'polylasso' : 'lasso'), C: tool('crop'), B: tool('brush'), E: tool('eraser'), S: tool('clone'),
      'Shift+L': () => this.doc && this.selectTool(this.tool?.id === 'lasso' ? 'polylasso' : 'lasso'),
      W: () => this.doc && this.selectTool(['quick', 'wand', 'aiselect'].includes(this.tool?.id) ? this.tool.id : (this.lastSelectTool || 'aiselect')),
      'Shift+W': () => this.doc && this.selectTool({ aiselect: 'quick', quick: 'wand', wand: 'aiselect' }[this.tool?.id] || 'aiselect'), J: tool('heal'),
      'Mod+M': () => pro.curvesDialog(this), 'Mod+Shift+A': () => pro.cameraRawDialog(this), 'Mod+Shift+F': () => import('./filmlab.js').then((m) => m.filmLabDialog(this)), 'Mod+B': () => ops.adjust(this, 'colorBalance'),
      'Mod+Alt+Shift+B': () => ops.adjust(this, 'blackWhite'), 'Mod+Shift+L': () => pro.autoAdjust(this, 'tone'), 'Mod+Alt+Shift+L': () => pro.autoAdjust(this, 'contrast'),
      'Mod+Shift+B': () => pro.autoAdjust(this, 'color'), 'Mod+Alt+G': () => this.active && ops.toggleClip(this, this.active),
      'Shift+Escape': () => this.view.setRotation(0),
      T: tool('text'), U: tool('shape'), P: tool('pen'), I: tool('eyedropper'), H: tool('hand'), Z: tool('zoom'),
      G: () => this.doc && this.selectTool(this.lastFillTool), 'Shift+G': () => this.doc && this.selectTool(this.tool.id === 'gradient' ? 'bucket' : 'gradient'),
      'Shift+M': () => { const o = this.opt('marquee'); o.shape = o.shape === 'rect' ? 'ellipse' : 'rect'; this.selectTool('marquee'); },
      X: () => this.swapColors(), D: () => this.resetColors(), F: () => ops.fullscreen(this),
      Tab: (e) => { if (e.target !== document.body && e.target !== this.view.canvas) return false; ops.togglePanels(this); },
      '[': () => ops.brushSize(this, -1), ']': () => ops.brushSize(this, 1),
    };
    bindKeys(map, { when: (e) => !(this.textEditor && e.target.classList.contains('img-text-editor')) });
    // tool-specific keys (Enter/Escape/arrows) + space-to-pan
    document.addEventListener('keydown', (e) => {
      if (isTyping(e) || isDialogOpen()) return;
      if (e.key === ' ' && !e.repeat && this.doc) { this.view.spaceDown = true; this.updateCursor(); e.preventDefault(); return; }
      if ((e.key === 'r' || e.key === 'R') && !e.repeat && !modKey(e) && !e.altKey && this.doc) { this.view.rDown = true; this.view.canvas.style.cursor = 'grab'; }
      if (this.doc && this.tool && this.tool.onKey && !modKey(e) && !e.altKey) {
        if (this.tool.onKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
      }
      if (e.key === 'Escape' && this.doc?.selection) { ops.deselect(this); e.preventDefault(); }
    }, true);
    document.addEventListener('keyup', (e) => {
      if (e.key === ' ') { this.view.spaceDown = false; this.updateCursor(); }
      if (e.key === 'r' || e.key === 'R') { this.view.rDown = false; this.updateCursor(); }
    });
    addEventListener('blur', () => { this.view.rDown = false; this.view.spaceDown = false; });
    // number keys set opacity of paint tools (like pro editors)
    document.addEventListener('keydown', (e) => {
      if (isTyping(e) || isDialogOpen() || modKey(e) || e.altKey) return;
      if (/^[0-9]$/.test(e.key) && this.tool && ['brush', 'eraser', 'clone'].includes(this.tool.id)) {
        const v = e.key === '0' ? 1 : Number(e.key) / 10;
        this.opt(this.tool.id).opacity = v; this.renderOptions(); toast(`Opacity ${Math.round(v * 100)}%`, { timeout: 900 });
      }
    });
  }

  bindDrop() {
    const overlay = h('div', { class: 'studio-drop' }, h('div', { class: 'studio-drop-label', text: 'Drop to open' }));
    this.root.appendChild(overlay);
    let depth = 0;
    addEventListener('dragenter', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { depth++; overlay.classList.add('is-on'); e.preventDefault(); } });
    addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('is-on'); });
    addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
    addEventListener('drop', (e) => {
      depth = 0; overlay.classList.remove('is-on');
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      io.handleFiles(this, Array.from(e.dataTransfer.files), { dropped: true });
    });
  }

  bindPaste() {
    document.addEventListener('paste', (e) => {
      if (isTyping(e) || isDialogOpen()) return;
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (files.length) { if (this.doc) ops.pasteFile(this, files[0]); else io.handleFiles(this, files); }
      else ops.pasteInternal(this);
    });
  }

  commands() {
    const out = [];
    const walkMenu = (items, group) => {
      for (const it of items) {
        if (!it || it.separator || it.heading) continue;
        const sub = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
        const label = typeof it.label === 'function' ? it.label() : it.label;
        if (sub) walkMenu(sub, group + ' › ' + label);
        else if (it.action && (it.enabled === undefined || (typeof it.enabled === 'function' ? it.enabled() : it.enabled))) out.push({ label, group, shortcut: it.shortcut, run: it.action, icon: it.icon });
      }
    };
    for (const m of this.menus) walkMenu(m.items, m.label);
    out.unshift(
      { label: 'New Image…', group: 'Studio', icon: 'image', run: () => io.newDocDialog(this) },
      { label: 'Open PSD…', group: 'Studio', icon: 'layers', run: () => io.openDialog(this, 'psd') },
      { label: 'New Video Project', group: 'Studio', icon: 'video', run: () => { location.href = ROUTES.video + '?new=1'; } },
      { label: 'Open Project…', group: 'Studio', icon: 'folder', run: () => { location.href = ROUTES.projects; } },
      { label: 'Import Media (Video)', group: 'Studio', icon: 'film', run: () => { location.href = ROUTES.video + '?import=1'; } },
      { label: 'Add Layer', group: 'Layer', icon: 'plus', run: () => ops.newLayer(this), when: () => !!this.doc },
      { label: 'Add Text', group: 'Layer', icon: 'text', run: () => ops.addTextCenter(this), when: () => !!this.doc },
      { label: 'Settings', group: 'Studio', icon: 'gear', run: () => { location.href = ROUTES.settings; } },
      { label: 'Back to Portfolio', group: 'Studio', icon: 'back', run: () => goPortfolio() },
    );
    return out;
  }
}

export { uid, debounce, layoutText };
