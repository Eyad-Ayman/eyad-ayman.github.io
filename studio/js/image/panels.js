// EYAD IMAGE — panels: Layers, Properties, Colour, History.
import { h, clear, isMac } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { contextMenu, toast } from '../core/ui.js';
import { BLEND_MODES, FONTS, walk, findNode, localSize, nodeBounds, layoutText } from './doc.js';
import { nodeThumb } from './render.js';
import { propCmd, multiPropCmd } from './history.js';
import * as ops from './ops.js';
import { hexToRgb, rgbToHex } from './tools.js';

function panelShell(title, { actions = [], collapsible = true } = {}) {
  const body = h('div', { class: 'img-panel-body' });
  const btn = h('button', { class: 'img-panel-toggle', type: 'button', 'aria-expanded': 'true' }, icon('chevronDown', 14), h('span', { text: title }));
  const head = h('div', { class: 'img-panel-head' }, btn, h('div', { class: 'img-panel-actions' }, actions));
  const el = h('section', { class: 'img-panel', 'aria-label': title }, head, body);
  if (collapsible) btn.addEventListener('click', () => { const c = el.classList.toggle('is-collapsed'); btn.setAttribute('aria-expanded', String(!c)); });
  return { el, head, body };
}

/** A number field whose label can be dragged to scrub the value. */
function numField(label, value, { min = -1e9, max = 1e9, step = 1, unit = '', onInput, onCommit, width } = {}) {
  const input = h('input', { class: 'studio-input is-num', type: 'number', value: round(value), step, min, max, 'aria-label': label });
  if (width) input.style.width = width;
  const lab = h('span', { class: 'img-num-label', text: label, title: 'Drag to adjust' });
  function round(v) { return Math.round(v * 100) / 100; }
  input.addEventListener('change', () => { const v = Math.min(max, Math.max(min, Number(input.value))); if (Number.isFinite(v)) onCommit(v); });
  let drag = null;
  lab.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, v: Number(input.value) || 0 }; lab.setPointerCapture(e.pointerId); e.preventDefault(); });
  lab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const v = Math.min(max, Math.max(min, drag.v + Math.round((e.clientX - drag.x) / 2) * step * k));
    input.value = round(v);
    onInput ? onInput(v) : onCommit(v);
  });
  const end = () => { if (!drag) return; drag = null; onCommit(Number(input.value)); };
  lab.addEventListener('pointerup', end); lab.addEventListener('pointercancel', end);
  return { el: h('label', { class: 'img-num' }, lab, input, unit ? h('span', { class: 'studio-faint studio-small', text: unit }) : null), input, set(v) { if (document.activeElement !== input) input.value = round(v); } };
}

// ================================================================= Layers

export class LayersPanel {
  constructor(app) {
    this.app = app;
    const p = panelShell('Layers');
    Object.assign(this, p);
    this.el.classList.add('is-layers');
    this.blend = h('select', { class: 'studio-input img-layers-blend', 'aria-label': 'Blend mode' });
    this.blend.addEventListener('change', () => { const n = app.active; if (n) ops.setProp(app, n, 'blend', this.blend.value, 'Blend Mode'); });
    this.opacity = numField('Opacity', 100, { min: 0, max: 100, unit: '%', onInput: (v) => this.liveOpacity(v), onCommit: (v) => this.commitOpacity(v), width: '54px' });
    this.lockBtn = h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Lock layer', 'aria-label': 'Lock layer', onclick: () => ops.toggleLock(app, app.active) }, icon('lock', 15));
    this.clipBtn = h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Clipping mask', 'aria-label': 'Clipping mask', onclick: () => ops.toggleClip(app, app.active) }, icon('mask', 15));
    this.controls = h('div', { class: 'img-layers-controls' }, this.blend, this.opacity.el, this.lockBtn, this.clipBtn);
    this.list = h('div', { class: 'img-layers-list', role: 'tree', 'aria-label': 'Layers' });
    this.footer = h('div', { class: 'img-layers-footer' },
      this.fbtn('plus', 'New layer', () => ops.newLayer(app)),
      this.fbtn('folder', 'New group', () => ops.newGroup(app)),
      this.fbtn('mask', 'Add layer mask', () => (app.active?.mask ? ops.deleteMask(app) : ops.addMask(app, app.doc?.selection ? 'selection' : 'reveal'))),
      this.fbtn('duplicate', 'Duplicate', () => ops.duplicate(app)),
      this.fbtn('chevronUp', 'Bring forward', () => ops.reorder(app, 'up')),
      this.fbtn('chevronDown', 'Send backward', () => ops.reorder(app, 'down')),
      h('span', { class: 'studio-spacer' }),
      this.fbtn('trash', 'Delete layer', () => ops.deleteLayers(app)));
    this.body.append(this.controls, this.list, this.footer);
    for (const [id, label] of BLEND_MODES) this.blend.appendChild(h('option', { value: id, text: label }));
    this.blend.appendChild(h('option', { value: 'pass-through', text: 'Pass Through' }));
  }
  fbtn(ic, label, fn) { const b = h('button', { class: 'studio-icon-btn is-small', type: 'button', title: label, 'aria-label': label, onclick: fn }, icon(ic, 15)); return b; }

  liveOpacity(v) { const n = this.app.active; if (!n) return; if (!this.opBefore) this.opBefore = n.opacity; n.opacity = v / 100; this.app.invalidate(); }
  commitOpacity(v) {
    const n = this.app.active; if (!n) return;
    const before = this.opBefore !== undefined && this.opBefore !== null ? this.opBefore : n.opacity;
    this.opBefore = null;
    n.opacity = Math.max(0, Math.min(1, v / 100));
    if (before !== n.opacity) this.app.commit(propCmd('Opacity', n, { opacity: before }, { opacity: n.opacity }, { coalesce: 'opacity' }));
  }

  renameActive() { const row = this.list.querySelector('.img-layer.is-active .img-layer-name'); if (row) this.startRename(this.app.active, row); }
  startRename(n, nameEl) {
    if (!n) return;
    this.renaming = true;
    const input = h('input', { class: 'studio-input img-layer-rename', type: 'text', value: n.name, maxLength: 200 });
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const done = (commit) => { if (!this.renaming) return; this.renaming = false; if (commit) ops.renameLayer(this.app, n, input.value); this.refresh(true); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
  }

  refresh(force) {
    if (this.renaming && !force) return;
    const app = this.app, d = app.doc;
    const n = app.active;
    this.controls.classList.toggle('is-disabled', !n);
    this.blend.disabled = !n;
    if (n) {
      const opts = Array.from(this.blend.options);
      opts.find((o) => o.value === 'pass-through').hidden = n.type !== 'group';
      this.blend.value = n.blend;
      this.opacity.set(Math.round(n.opacity * 100));
      this.lockBtn.setAttribute('aria-pressed', String(!!n.locked));
      this.clipBtn.setAttribute('aria-pressed', String(!!n.clip));
      this.clipBtn.disabled = n.type === 'group';
    }
    clear(this.list);
    if (!d) { this.list.appendChild(h('div', { class: 'img-panel-empty', text: 'No document open' })); return; }
    const rows = [];
    const rec = (nodes, depth, parent) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        rows.push(this.row(node, depth, parent));
        if (node.type === 'group' && node.expanded) rec(node.children, depth + 1, node);
      }
    };
    rec(d.layers, 0, null);
    this.list.append(...rows);
  }

  row(n, depth, parent) {
    const app = this.app, d = app.doc;
    const active = d.activeId === n.id, selected = app.selectedIds.has(n.id);
    if (n.type !== 'group' && (!n._thumb || n._dirtyThumb)) { n._thumb = nodeThumb(d, n, 34); n._dirtyThumb = false; }
    const eye = h('button', { class: 'img-layer-eye', type: 'button', 'aria-label': n.visible ? 'Hide layer' : 'Show layer', 'aria-pressed': String(n.visible), onclick: (e) => { e.stopPropagation(); ops.toggleVisible(app, n); } }, icon(n.visible ? 'eye' : 'eyeOff', 15));
    const chevron = n.type === 'group' ? h('button', { class: 'img-layer-chevron', type: 'button', 'aria-label': n.expanded ? 'Collapse group' : 'Expand group', onclick: (e) => { e.stopPropagation(); n.expanded = !n.expanded; this.refresh(); } }, icon(n.expanded ? 'chevronDown' : 'chevronRight', 13)) : h('span', { class: 'img-layer-chevron' });
    let thumb;
    if (n.type === 'group') thumb = h('span', { class: 'img-layer-thumb is-icon' }, icon('folder', 16));
    else if (n.type === 'text') thumb = h('span', { class: 'img-layer-thumb is-icon is-text' }, icon('text', 16));
    else {
      thumb = h('span', { class: 'img-layer-thumb' });
      const c = document.createElement('canvas'); c.width = n._thumb.width; c.height = n._thumb.height; c.getContext('2d').drawImage(n._thumb, 0, 0);
      thumb.appendChild(c);
      if (n.type === 'shape') thumb.appendChild(h('span', { class: 'img-layer-thumb-badge' }, icon('shape', 10)));
    }
    thumb.title = (isMac ? '⌘' : 'Ctrl') + '-click to select layer pixels';
    thumb.addEventListener('click', (e) => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); ops.selectLayerPixels(app, n); } });
    const maskThumb = n.mask ? h('span', { class: 'img-layer-thumb is-mask' + (n.maskEnabled ? '' : ' is-off'), title: n.maskEnabled ? 'Layer mask' : 'Layer mask (disabled)' }, (() => { const c = document.createElement('canvas'); const s = Math.min(26 / n.mask.canvas.width, 20 / n.mask.canvas.height); c.width = Math.max(1, Math.round(n.mask.canvas.width * s)); c.height = Math.max(1, Math.round(n.mask.canvas.height * s)); const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'destination-out'; g.drawImage(n.mask.canvas, 0, 0, c.width, c.height); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); return c; })()) : null;
    const name = h('span', { class: 'img-layer-name', text: n.name, title: n.name });
    const badges = h('span', { class: 'img-layer-badges' },
      n.clip ? h('span', { class: 'img-layer-badge', title: 'Clipped to layer below' }, icon('chevronDown', 11)) : null,
      n.psd && n.psd.kind === 'text' ? h('span', { class: 'studio-badge is-muted', text: 'PSD T', title: 'PSD text layer (pixels)' }) : null,
      n.psd && n.psd.kind === 'smart' ? h('span', { class: 'studio-badge is-muted', text: 'SO', title: 'Smart object (rendered pixels)' }) : null,
      n.psd && n.psd.kind === 'adjustment' ? h('span', { class: 'studio-badge is-warn', text: 'ADJ', title: 'Adjustment layer — not applied' }) : null,
      n.psd && n.psd.effects ? h('span', { class: 'studio-badge is-warn', text: 'fx', title: 'Layer styles not rendered: ' + n.psd.effects.join(', ') }) : null,
      n.locked ? h('span', { class: 'img-layer-badge', title: 'Locked' }, icon('lock', 12)) : null);
    const row = h('div', {
      class: 'img-layer' + (active ? ' is-active' : '') + (selected && !active ? ' is-selected' : '') + (n.visible ? '' : ' is-hidden') + (n.clip ? ' is-clipped' : ''),
      role: 'treeitem', 'aria-selected': String(active), tabIndex: active ? 0 : -1, dataset: { id: n.id },
      style: { paddingLeft: 4 + depth * 14 + 'px' },
    }, eye, chevron, thumb, maskThumb, name, badges, h('span', { class: 'img-layer-grip', 'aria-hidden': 'true' }, icon('menu', 13)));
    row.addEventListener('click', (e) => app.setActive(n.id, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey }));
    name.addEventListener('dblclick', (e) => { e.stopPropagation(); this.startRename(n, name); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!app.selectedIds.has(n.id)) app.setActive(n.id); this.menu(n, e.clientX, e.clientY); });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const rows = Array.from(this.list.querySelectorAll('.img-layer'));
        const i = rows.indexOf(row), j = e.key === 'ArrowUp' ? i - 1 : i + 1;
        if (rows[j]) { app.setActive(rows[j].dataset.id); requestAnimationFrame(() => this.list.querySelector('.img-layer.is-active')?.focus()); }
      }
      if (e.key === 'F2') this.startRename(n, name);
    });
    this.bindDrag(row, n);
    // long-press on touch → menu
    let lp = 0;
    row.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; lp = setTimeout(() => { app.setActive(n.id); this.menu(n, e.clientX, e.clientY); }, 550); });
    ['pointerup', 'pointercancel', 'pointermove'].forEach((t) => row.addEventListener(t, (e) => { if (t !== 'pointermove' || Math.abs(e.movementY) > 3) clearTimeout(lp); }));
    return row;
  }

  menu(n, x, y) {
    const app = this.app;
    contextMenu(x, y, [
      { heading: n.name },
      { label: 'Rename…', action: () => { const el = this.list.querySelector(`.img-layer[data-id="${n.id}"] .img-layer-name`); if (el) this.startRename(n, el); } },
      { label: 'Duplicate', action: () => ops.duplicate(app) },
      { label: 'Delete', action: () => ops.deleteLayers(app) },
      { separator: true },
      { label: 'Group layers', action: () => ops.groupLayers(app) },
      { label: 'Ungroup', action: () => ops.ungroup(app), enabled: n.type === 'group' },
      { label: 'Merge down', action: () => ops.mergeDown(app), enabled: n.type !== 'group' },
      { label: 'Rasterize', action: () => ops.rasterize(app, n), enabled: n.type === 'text' || n.type === 'shape' },
      { label: 'Convert PSD text to editable', action: () => ops.convertPsdText(app), enabled: !!(n.psd && n.psd.kind === 'text') },
      { separator: true },
      { label: n.clip ? 'Release clipping mask' : 'Create clipping mask', action: () => ops.toggleClip(app, n), enabled: n.type !== 'group' },
      { label: n.mask ? 'Delete mask' : 'Add mask', action: () => (n.mask ? ops.deleteMask(app) : ops.addMask(app, app.doc.selection ? 'selection' : 'reveal')) },
      { label: 'Select layer pixels', action: () => ops.selectLayerPixels(app, n) },
      { label: n.locked ? 'Unlock' : 'Lock', action: () => ops.toggleLock(app, n) },
      { separator: true },
      { label: 'Bring to front', action: () => ops.reorder(app, 'top') },
      { label: 'Send to back', action: () => ops.reorder(app, 'bottom') },
    ]);
  }

  bindDrag(row, n) {
    const app = this.app;
    let st = null;
    const grip = row.querySelector('.img-layer-grip');
    const start = (e, fromGrip) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.pointerType === 'touch' && !fromGrip) return; // touch drags only from the grip (list can scroll)
      if (e.target.closest('.img-layer-eye, .img-layer-chevron, input')) return;
      st = { y: e.clientY, started: false, id: e.pointerId };
      row.setPointerCapture(e.pointerId);
    };
    row.addEventListener('pointerdown', (e) => start(e, false));
    grip.addEventListener('pointerdown', (e) => { e.stopPropagation(); start(e, true); });
    row.addEventListener('pointermove', (e) => {
      if (!st) return;
      if (!st.started && Math.abs(e.clientY - st.y) > 5) { st.started = true; row.classList.add('is-dragging'); }
      if (!st.started) return;
      this.clearDrop();
      const t = this.dropTarget(e.clientY, n);
      if (t) { t.row.classList.add('drop-' + t.zone); st.target = t; } else st.target = null;
    });
    const end = () => {
      if (!st) return;
      const s = st; st = null;
      row.classList.remove('is-dragging');
      this.clearDrop();
      if (!s.started || !s.target) return;
      const d = app.doc;
      const tf = findNode(d, s.target.row.dataset.id); if (!tf) return;
      if (s.target.zone === 'into') ops.moveNode(app, n.id, tf.node, tf.node.children.length);
      else ops.moveNode(app, n.id, tf.parent, s.target.zone === 'above' ? tf.index + 1 : tf.index);
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', () => { st = null; row.classList.remove('is-dragging'); this.clearDrop(); });
  }
  clearDrop() { this.list.querySelectorAll('.drop-above,.drop-below,.drop-into').forEach((r) => r.classList.remove('drop-above', 'drop-below', 'drop-into')); }
  dropTarget(y, dragged) {
    for (const r of this.list.querySelectorAll('.img-layer')) {
      const b = r.getBoundingClientRect();
      if (y < b.top || y > b.bottom) continue;
      if (r.dataset.id === dragged.id) return null;
      const f = findNode(this.app.doc, r.dataset.id);
      if (!f) return null;
      if (dragged.type === 'group' && isInside(dragged, f.node)) return null;
      const rel = (y - b.top) / b.height;
      if (f.node.type === 'group' && rel > 0.3 && rel < 0.7) return { row: r, zone: 'into' };
      return { row: r, zone: rel < 0.5 ? 'above' : 'below' };
    }
    return null;
  }
}
function isInside(group, node) { let hit = false; walk(group.children, (n) => { if (n === node) { hit = true; return false; } return true; }); return hit; }

// ================================================================= Properties

export class PropertiesPanel {
  constructor(app) {
    this.app = app;
    Object.assign(this, panelShell('Properties'));
    this.el.classList.add('is-properties');
    this.key = null;
    this.fields = [];
  }
  refresh() {
    const app = this.app, d = app.doc, n = app.active;
    const key = d ? `${d.id}|${n ? n.id + n.type + (n.mask ? 'm' : '') + (n.psd ? 'p' : '') : 'doc'}|${d.width}x${d.height}` : 'none';
    if (key !== this.key) { this.key = key; this.build(); } else this.update();
  }
  update() { for (const f of this.fields) f.set(f.get()); }
  field(f) { this.fields.push(f); return f.el; }
  section(title, ...rows) { return h('div', { class: 'img-prop-section' }, h('div', { class: 'img-prop-title', text: title }), ...rows); }

  build() {
    const app = this.app, d = app.doc, n = app.active;
    this.fields = [];
    clear(this.body);
    if (!d) { this.body.appendChild(h('div', { class: 'img-panel-empty', text: 'No document open' })); return; }
    if (!n) {
      this.body.append(this.section('Document',
        h('div', { class: 'img-prop-kv' }, h('span', { text: 'Size' }), h('span', { class: 'studio-mono', text: `${d.width} × ${d.height} px` })),
        h('div', { class: 'img-prop-kv' }, h('span', { text: 'Mode' }), h('span', { text: 'RGB · 8 bit · sRGB' })),
        d.meta?.psd ? h('div', { class: 'img-prop-kv' }, h('span', { text: 'Source' }), h('span', { text: `PSD (${d.meta.psd.colorMode}, ${d.meta.psd.bits}-bit)` })) : null,
        h('div', { class: 'img-prop-actions' },
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Image size…', onclick: () => ops.imageSizeDialog(app) }),
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Canvas size…', onclick: () => ops.canvasSizeDialog(app) }))));
      return;
    }
    const locked = app.isLocked(n);
    const commitProps = (label, after, coalesce) => {
      const before = {};
      for (const k of Object.keys(after)) before[k] = n[k];
      if (Object.keys(after).every((k) => before[k] === after[k])) return;
      Object.assign(n, after); delete n._layout;
      app.commit(propCmd(label, n, before, after, { coalesce }));
    };
    const liveProp = (k, v) => { n[k] = v; delete n._layout; app.invalidate(); };

    // --- Layer
    const nameIn = h('input', { class: 'studio-input', type: 'text', value: n.name, maxLength: 200, 'aria-label': 'Layer name' });
    nameIn.addEventListener('change', () => ops.renameLayer(app, n, nameIn.value));
    this.fields.push({ get: () => n.name, set: (v) => { if (document.activeElement !== nameIn) nameIn.value = v; } });
    const kind = { raster: 'Pixel layer', text: 'Text layer', shape: 'Shape layer', group: 'Group' }[n.type];
    this.body.appendChild(this.section(kind, nameIn, locked ? h('p', { class: 'studio-small studio-dim', text: 'Locked — unlock to edit.' }) : null));

    // --- Transform
    if (n.type !== 'group') {
      const { w, h: hh } = localSize(n);
      const fx = numField('X', n.x, { onInput: (v) => liveProp('x', v), onCommit: (v) => commitProps('Move', { x: v }, 'x') });
      const fy = numField('Y', n.y, { onInput: (v) => liveProp('y', v), onCommit: (v) => commitProps('Move', { y: v }, 'y') });
      const fw = numField('W', Math.abs(w * n.sx), { min: 1, onCommit: (v) => commitProps('Scale', { sx: Math.sign(n.sx) * v / w }, 'sx') });
      const fh = numField('H', Math.abs(hh * n.sy), { min: 1, onCommit: (v) => commitProps('Scale', { sy: Math.sign(n.sy) * v / hh }, 'sy') });
      const fr = numField('°', n.rot, { min: -180, max: 180, onInput: (v) => liveProp('rot', v), onCommit: (v) => commitProps('Rotate', { rot: v }, 'rot') });
      this.fields.push({ get: () => n.x, set: fx.set }, { get: () => n.y, set: fy.set }, { get: () => Math.abs(localSize(n).w * n.sx), set: fw.set }, { get: () => Math.abs(localSize(n).h * n.sy), set: fh.set }, { get: () => n.rot, set: fr.set });
      this.body.appendChild(this.section('Transform',
        h('div', { class: 'img-prop-grid' }, fx.el, fy.el, fw.el, fh.el, fr.el,
          h('div', { class: 'img-prop-inline' },
            h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Flip horizontal', 'aria-label': 'Flip horizontal', onclick: () => ops.flipLayer(app, 'h') }, icon('flipH', 15)),
            h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Flip vertical', 'aria-label': 'Flip vertical', onclick: () => ops.flipLayer(app, 'v') }, icon('flipV', 15)),
            h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Reset transform', 'aria-label': 'Reset transform', onclick: () => import('./tools.js').then((m) => m.resetTransform(app)) }, icon('rotate', 15))))));
    } else {
      const b = nodeBounds(n);
      this.body.appendChild(this.section('Group', h('div', { class: 'img-prop-kv' }, h('span', { text: 'Contents' }), h('span', { text: `${n.children.length} item(s)` })),
        b ? h('div', { class: 'img-prop-kv' }, h('span', { text: 'Bounds' }), h('span', { class: 'studio-mono', text: `${Math.round(b.w)} × ${Math.round(b.h)} px` })) : null,
        h('p', { class: 'studio-small studio-dim', text: 'Move the group with the Move tool; transform individual layers for scale and rotation.' })));
    }

    // --- Text
    if (n.type === 'text') {
      const ta = h('textarea', { class: 'studio-input img-prop-text', rows: 3, 'aria-label': 'Text' });
      ta.value = n.text;
      ta.addEventListener('change', () => { if (ta.value.trim()) commitProps('Edit Text', { text: ta.value }); });
      this.fields.push({ get: () => n.text, set: (v) => { if (document.activeElement !== ta) ta.value = v; } });
      const font = h('select', { class: 'studio-input', 'aria-label': 'Font' }, FONTS.map(([v, l]) => h('option', { value: v, text: l, selected: v === n.font })));
      if (!FONTS.some(([v]) => v === n.font)) font.appendChild(h('option', { value: n.font, text: n.font, selected: true }));
      font.addEventListener('change', () => commitProps('Font', { font: font.value }));
      const weight = h('select', { class: 'studio-input', 'aria-label': 'Weight' }, [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']].map(([v, l]) => h('option', { value: v, text: l, selected: v === n.weight })));
      weight.addEventListener('change', () => commitProps('Font Weight', { weight: Number(weight.value) }));
      const size = numField('Size', n.size, { min: 1, max: 4000, unit: 'px', onInput: (v) => liveProp('size', v), onCommit: (v) => commitProps('Font Size', { size: v }, 'size') });
      const lh = numField('Leading', n.lineHeight, { min: 0.5, max: 5, step: 0.05, onInput: (v) => liveProp('lineHeight', v), onCommit: (v) => commitProps('Leading', { lineHeight: v }, 'lh') });
      const tr = numField('Tracking', n.tracking, { min: -100, max: 500, onInput: (v) => liveProp('tracking', v), onCommit: (v) => commitProps('Tracking', { tracking: v }, 'tr') });
      const color = h('input', { class: 'studio-color', type: 'color', value: n.color, 'aria-label': 'Text colour' });
      color.addEventListener('input', () => liveProp('color', color.value));
      color.addEventListener('change', () => { const v = color.value; n.color = this._c0 || n.color; commitProps('Text Colour', { color: v }); });
      color.addEventListener('focus', () => { this._c0 = n.color; });
      const italic = h('button', { class: 'studio-icon-btn is-small', type: 'button', text: 'I', title: 'Italic', 'aria-pressed': String(n.italic), style: { fontStyle: 'italic', fontWeight: 700 }, onclick: () => commitProps('Italic', { italic: !n.italic }) });
      const align = h('div', { class: 'img-seg' }, [['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight']].map(([v, ic]) => h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Align ' + v, 'aria-pressed': String(n.align === v), onclick: () => commitProps('Align', { align: v }) }, icon(ic, 14))));
      this.fields.push({ get: () => n.size, set: size.set }, { get: () => n.lineHeight, set: lh.set }, { get: () => n.tracking, set: tr.set });
      this.body.appendChild(this.section('Character', ta, font, h('div', { class: 'img-prop-inline' }, weight, italic, color), h('div', { class: 'img-prop-grid' }, size.el, lh.el, tr.el), align,
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Edit on canvas', onclick: () => { app.selectTool('text'); app.openTextEditor(n, false); } })));
    }

    // --- Shape
    if (n.type === 'shape') {
      const fillOn = h('input', { type: 'checkbox', checked: n.fillOn, 'aria-label': 'Fill' });
      fillOn.addEventListener('change', () => commitProps('Fill', { fillOn: fillOn.checked }));
      const fill = h('input', { class: 'studio-color', type: 'color', value: n.fill, 'aria-label': 'Fill colour' });
      fill.addEventListener('focus', () => { this._f0 = n.fill; });
      fill.addEventListener('input', () => liveProp('fill', fill.value));
      fill.addEventListener('change', () => { const v = fill.value; n.fill = this._f0 ?? n.fill; commitProps('Fill Colour', { fill: v }); });
      const strokeOn = h('input', { type: 'checkbox', checked: n.strokeOn, 'aria-label': 'Stroke' });
      strokeOn.addEventListener('change', () => commitProps('Stroke', { strokeOn: strokeOn.checked }));
      const stroke = h('input', { class: 'studio-color', type: 'color', value: n.stroke, 'aria-label': 'Stroke colour' });
      stroke.addEventListener('focus', () => { this._s0 = n.stroke; });
      stroke.addEventListener('input', () => liveProp('stroke', stroke.value));
      stroke.addEventListener('change', () => { const v = stroke.value; n.stroke = this._s0 ?? n.stroke; commitProps('Stroke Colour', { stroke: v }); });
      const sw = numField('Stroke', n.strokeWidth, { min: 0, max: 1000, unit: 'px', onInput: (v) => liveProp('strokeWidth', v), onCommit: (v) => commitProps('Stroke Width', { strokeWidth: v }, 'sw') });
      const rows = [
        h('div', { class: 'img-prop-inline' }, h('label', { class: 'img-opt is-check' }, fillOn, h('span', { text: 'Fill' })), fill, h('label', { class: 'img-opt is-check' }, strokeOn, h('span', { text: 'Stroke' })), stroke),
        h('div', { class: 'img-prop-grid' }, sw.el),
      ];
      this.fields.push({ get: () => n.strokeWidth, set: sw.set });
      if (n.shape !== 'path') {
        const sW = numField('Width', n.w, { min: 1, onInput: (v) => liveProp('w', v), onCommit: (v) => commitProps('Shape Size', { w: v }, 'w') });
        const sH = numField('Height', n.h, { min: 1, onInput: (v) => liveProp('h', v), onCommit: (v) => commitProps('Shape Size', { h: v }, 'h') });
        this.fields.push({ get: () => n.w, set: sW.set }, { get: () => n.h, set: sH.set });
        rows.push(h('div', { class: 'img-prop-grid' }, sW.el, sH.el));
        if (n.shape === 'rect') { const rr = numField('Radius', n.radius, { min: 0, onInput: (v) => liveProp('radius', v), onCommit: (v) => commitProps('Corner Radius', { radius: v }, 'r') }); this.fields.push({ get: () => n.radius, set: rr.set }); rows.push(h('div', { class: 'img-prop-grid' }, rr.el)); }
      } else rows.push(h('p', { class: 'studio-small studio-dim', text: n.subpaths ? `Vector shape with ${n.subpaths.length} path(s), ${n.subpaths.reduce((a, sp) => a + sp.points.length, 0)} anchor points${n.psd && n.psd.kind === 'shape' ? ' (from PSD)' : ''}.` : `Path with ${n.points ? n.points.length : 0} anchor points${n.closed ? ' (closed)' : ''}.` }));
      this.body.appendChild(this.section('Shape', ...rows));
    }

    // --- Raster / PSD info
    if (n.type === 'raster') {
      const psd = n.psd || {};
      this.body.appendChild(this.section('Pixels',
        h('div', { class: 'img-prop-kv' }, h('span', { text: 'Size' }), h('span', { class: 'studio-mono', text: `${n.canvas.width} × ${n.canvas.height} px` })),
        psd.kind === 'text' ? h('div', { class: 'img-prop-note' }, h('b', { text: 'PSD text layer (as pixels)' }), h('span', { text: `“${(psd.text || '').slice(0, 200)}”` }), psd.font ? h('span', { class: 'studio-dim', text: `Font: ${psd.font}${psd.size ? ', ' + Math.round(psd.size) + ' pt' : ''}` }) : null, h('button', { class: 'studio-btn is-small', type: 'button', text: 'Convert to editable text', onclick: () => ops.convertPsdText(app) })) : null,
        psd.kind === 'smart' ? h('div', { class: 'img-prop-note' }, h('b', { text: 'Smart object' }), h('span', { class: 'studio-dim', text: 'Imported as rendered pixels.' })) : null,
        psd.kind === 'adjustment' ? h('div', { class: 'img-prop-note is-warn' }, h('b', { text: `Adjustment layer: ${psd.type}` }), h('span', { class: 'studio-dim', text: 'Placeholder only — its effect is not applied.' })) : null,
        psd.kind === 'composite' ? h('div', { class: 'img-prop-note' }, h('b', { text: 'PSD composite (reference)' }), h('span', { class: 'studio-dim', text: 'Photoshop’s flattened preview, kept hidden so you can compare.' })) : null,
        psd.effects ? h('div', { class: 'img-prop-note is-warn' }, h('b', { text: 'Layer styles not rendered' }), h('span', { class: 'studio-dim', text: psd.effects.join(', ') })) : null));
    }

    // --- Mask
    if (n.mask) {
      this.body.appendChild(this.section('Mask',
        h('div', { class: 'img-prop-actions' },
          h('button', { class: 'studio-btn is-small', type: 'button', text: n.maskEnabled ? 'Disable' : 'Enable', onclick: () => ops.toggleMask(app) }),
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Invert', onclick: () => ops.invertMask(app) }),
          n.type === 'raster' ? h('button', { class: 'studio-btn is-small', type: 'button', text: 'Apply', onclick: () => ops.applyMask(app) }) : null,
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Delete', onclick: () => ops.deleteMask(app) }))));
    }

    if (locked) this.body.querySelectorAll('input, select, textarea, button').forEach((el) => { if (!el.closest('.img-prop-section') || el === nameIn) return; el.disabled = true; });
  }
}

// ================================================================= Colour

const PALETTE = ['#111111', '#ffffff', '#d02b2a', '#ec3b35', '#f28c28', '#f2c230', '#3fb56b', '#1f8a70', '#3d8bfd', '#1f3fbf', '#7b3fe4', '#e84393', '#6b4f3a', '#9a9894', '#4a4a50', '#e9e7e3'];

function hsv2rgb(hh, s, v) {
  const f = (n) => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hh = 0;
  if (d) { if (max === r) hh = ((g - b) / d) % 6; else if (max === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
  return [hh, max ? d / max : 0, max];
}

export class ColorPanel {
  constructor(app) {
    this.app = app;
    Object.assign(this, panelShell('Colour'));
    this.el.classList.add('is-color');
    this.hex = h('input', { class: 'studio-input is-num img-hex', type: 'text', maxLength: 7, 'aria-label': 'Hex colour' });
    this.hex.addEventListener('change', () => { let v = this.hex.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) app.setFg(v.toLowerCase()); else this.refresh(); });
    this.sliders = {};
    const mk = (k, label, max) => {
      const r = h('input', { class: 'img-hsb', type: 'range', min: 0, max, step: 1, 'aria-label': label });
      r.addEventListener('input', () => { const hh = +this.sliders.h.value, s = +this.sliders.s.value / 100, v = +this.sliders.b.value / 100; const [R, G, B] = hsv2rgb(hh, s, v); this.fromSlider = true; app.setFg(rgbToHex(R, G, B)); this.fromSlider = false; this.paintTracks(hh, s, v); });
      this.sliders[k] = r;
      return h('label', { class: 'img-hsb-row' }, h('span', { text: label }), r);
    };
    this.big = h('div', { class: 'img-color-big' });
    this.swatches = h('div', { class: 'img-color-swatches' });
    this.recent = h('div', { class: 'img-color-swatches is-recent' });
    this.body.append(
      h('div', { class: 'img-color-top' }, this.big, h('div', { class: 'img-color-meta' }, this.hex, h('span', { class: 'studio-small studio-dim', text: 'Foreground' }))),
      mk('h', 'H', 360), mk('s', 'S', 100), mk('b', 'B', 100),
      this.swatches, this.recent);
    for (const c of PALETTE) this.swatches.appendChild(this.sw(c));
  }
  sw(c) {
    const b = h('button', { class: 'img-color-sw', type: 'button', title: c + ' (Alt-click: background)', 'aria-label': 'Colour ' + c, style: { background: c } });
    b.addEventListener('click', (e) => (e.altKey ? this.app.setBg(c) : this.app.setFg(c)));
    return b;
  }
  paintTracks(hh, s, v) {
    const [r1, g1, b1] = hsv2rgb(hh, 1, 1);
    this.sliders.s.style.background = `linear-gradient(90deg, ${rgbToHex(...hsv2rgb(hh, 0, v))}, ${rgbToHex(...hsv2rgb(hh, 1, v))})`;
    this.sliders.b.style.background = `linear-gradient(90deg, #000, ${rgbToHex(...hsv2rgb(hh, s, 1))})`;
    this.sliders.h.style.background = 'linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)';
    void r1; void g1; void b1;
  }
  refresh() {
    const app = this.app;
    this.big.style.background = app.fg;
    if (document.activeElement !== this.hex) this.hex.value = app.fg;
    if (!this.fromSlider) {
      const [hh, s, v] = rgb2hsv(...hexToRgb(app.fg));
      this.sliders.h.value = Math.round(hh); this.sliders.s.value = Math.round(s * 100); this.sliders.b.value = Math.round(v * 100);
      this.paintTracks(hh, s, v);
    }
    clear(this.recent);
    for (const c of app.recentColors) this.recent.appendChild(this.sw(c));
  }
}

// ================================================================= History

export class HistoryPanel {
  constructor(app) {
    this.app = app;
    Object.assign(this, panelShell('History'));
    this.el.classList.add('is-history');
    this.list = h('div', { class: 'img-history-list', role: 'listbox', 'aria-label': 'History' });
    this.body.appendChild(this.list);
  }
  refresh() {
    const hs = this.app.history;
    clear(this.list);
    if (!hs) { this.list.appendChild(h('div', { class: 'img-panel-empty', text: 'No document open' })); return; }
    const mk = (label, i) => h('button', {
      class: 'img-history-item' + (i === hs.index ? ' is-current' : '') + (i > hs.index ? ' is-future' : ''), type: 'button', role: 'option', 'aria-selected': String(i === hs.index),
      onclick: () => { if (this.app.textEditor) this.app.closeTextEditor(); hs.jumpTo(i); },
    }, icon(i < 0 ? 'image' : 'history', 13), h('span', { text: label }));
    this.list.appendChild(mk(hs.stack.length && hs.stack.length >= hs.limit ? 'Earlier states trimmed' : 'Open', -1));
    hs.stack.forEach((c, i) => this.list.appendChild(mk(c.label, i)));
    const cur = this.list.querySelector('.is-current');
    if (cur) { // scroll only this list, never the surrounding panel column
      const l = this.list, top = cur.offsetTop - l.offsetTop;
      if (top < l.scrollTop) l.scrollTop = top;
      else if (top + cur.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = top + cur.offsetHeight - l.clientHeight;
    }
  }
}

export { toast, multiPropCmd, layoutText };
