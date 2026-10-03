// EYAD 3D — right-hand panels (bottom sheets on phones): outliner, object
// transform, material, light, scene (environment / ground / shadows),
// camera (projection, lens, bookmarks) and animation.
import * as THREE from '../../vendor/three/three.module.js';
import { h, clear, clamp } from '../core/dom.js';
import { openSheet, contextMenu } from '../core/ui.js';
import { icon } from './icons.js';
import { PRIMITIVES, LIGHTS, materialsOf, iconFor, kindLabel, isLight, isCam, isEmpty, camOf, focalToFov, fovToFocal, SENSOR_FITS, modsOf, canModify, editorChildren } from './objects.js';
import { EASES } from './anim.js';
import { ENVS } from './viewport.js';
import * as io from './io.js';

/** One-tap looks. Applied to every material of the selection; everything stays editable afterwards. */
export const MATERIAL_PRESETS = [
  { id: 'plastic', label: 'Plastic', sw: '#e8e4dc', values: { metalness: 0, roughness: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.2 } },
  { id: 'matte', label: 'Matte clay', sw: '#b9b2a6', values: { color: '#b9b2a6', metalness: 0, roughness: 0.95 } },
  { id: 'rubber', label: 'Rubber', sw: '#1c1c1e', values: { color: '#1c1c1e', metalness: 0, roughness: 0.8, sheen: 0.4 } },
  { id: 'chrome', label: 'Chrome', sw: 'linear-gradient(135deg,#fff,#7d848c 55%,#e9edf0)', values: { color: '#f2f4f5', metalness: 1, roughness: 0.04 } },
  { id: 'steel', label: 'Brushed steel', sw: 'linear-gradient(135deg,#c9ccd0,#8b9096)', values: { color: '#b9bdc2', metalness: 1, roughness: 0.42 } },
  { id: 'gold', label: 'Gold', sw: 'linear-gradient(135deg,#ffe9a3,#c28a1e)', values: { color: '#ffc45c', metalness: 1, roughness: 0.18 } },
  { id: 'copper', label: 'Copper', sw: 'linear-gradient(135deg,#f5b99a,#a9552d)', values: { color: '#d98b62', metalness: 1, roughness: 0.25 } },
  { id: 'glass', label: 'Glass', sw: 'linear-gradient(135deg,rgba(255,255,255,.75),rgba(160,200,255,.25))', values: { color: '#ffffff', metalness: 0, roughness: 0.03, transmission: 1, ior: 1.5, thickness: 0.4 } },
  { id: 'frosted', label: 'Frosted glass', sw: 'linear-gradient(135deg,rgba(255,255,255,.6),rgba(200,210,220,.45))', values: { color: '#f4f7fa', metalness: 0, roughness: 0.45, transmission: 0.9, ior: 1.45, thickness: 0.6 } },
  { id: 'paint', label: 'Car paint', sw: 'linear-gradient(135deg,#ff5a4e,#8e1410)', values: { color: '#c21d17', metalness: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 } },
  { id: 'glow', label: 'Glow', sw: 'radial-gradient(circle,#fff,#7ab8ff)', values: { color: '#101216', metalness: 0, roughness: 0.6, emissive: '#7ab8ff', emissiveIntensity: 3 } },
];

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const TITLES = { outliner: 'Outliner', object: 'Object', mods: 'Modifiers', material: 'Material', light: 'Light', camdata: 'Camera', scene: 'World', render: 'Render', camera: 'View', anim: 'Animation', add: 'Add', props: 'Properties' };
const TABS = [['object', 'move', 'Object'], ['mods', 'sliders', 'Modifiers'], ['material', 'palette', 'Material'], ['light', 'bulb', 'Light'], ['camdata', 'camera', 'Camera'], ['scene', 'globe', 'World'], ['render', 'render', 'Render'], ['camera', 'persp', 'View'], ['anim', 'key', 'Animation']];

function section(title, key, body, { actions = [] } = {}) {
  const btn = h('button', { class: 'img-panel-toggle', type: 'button', 'aria-expanded': 'true' }, icon('chevronDown', 14), h('span', { text: title }));
  const el = h('section', { class: 'img-panel t3-panel is-' + key, dataset: { panel: key } }, h('div', { class: 'img-panel-head' }, btn, h('div', { class: 'img-panel-actions' }, actions)), h('div', { class: 'img-panel-body' }, body));
  btn.addEventListener('click', () => { const c = el.classList.toggle('is-collapsed'); btn.setAttribute('aria-expanded', String(!c)); });
  return el;
}

/** Number field with a drag-to-scrub label. cb: { begin(), input(v), end() } */
function numField(label, value, cb, { step = 0.1, min = -1e6, max = 1e6, digits = 3, cls = '', title = '' } = {}) {
  const fmt = (v) => String(Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits));
  const input = h('input', { class: 'studio-input is-num', type: 'number', step: String(step), value: fmt(value), 'aria-label': title || label, inputMode: 'decimal' });
  input.addEventListener('change', () => {
    const v = clamp(Number(input.value), min, max);
    if (!Number.isFinite(v)) { input.value = fmt(value); return; }
    cb.begin?.(); cb.input(v); cb.end?.();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); });
  const lab = h('span', { class: 't3-num-label', text: label, title: 'Drag to adjust' });
  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lab.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = Number(input.value) || 0;
    let moved = false;
    cb.begin?.();
    const move = (ev) => {
      const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true;
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clamp(v0 + dx * step * k * 0.5, min, max);
      input.value = fmt(v); cb.input(v);
    };
    const up = () => { lab.removeEventListener('pointermove', move); lab.removeEventListener('pointerup', up); lab.removeEventListener('pointercancel', up); if (moved) cb.end?.(); else { cb.end?.(); input.focus(); input.select(); } };
    lab.addEventListener('pointermove', move); lab.addEventListener('pointerup', up); lab.addEventListener('pointercancel', up);
  });
  const el = h('label', { class: 't3-num ' + cls }, lab, input);
  el.set = (v) => { if (document.activeElement !== input) input.value = fmt(v); };
  return el;
}
function row(label, ...controls) { return h('div', { class: 't3-row' }, h('span', { class: 't3-row-label', text: label }), h('div', { class: 't3-row-ctl' }, controls)); }
function range(value, min, max, step, onInput, fmt = (v) => v.toFixed(2)) {
  const out = h('output', { class: 'studio-mono t3-out', text: fmt(value) });
  const r = h('input', { class: 'studio-range', type: 'range', min, max, step, value });
  r.addEventListener('input', () => { out.textContent = fmt(Number(r.value)); onInput(Number(r.value)); });
  return h('div', { class: 't3-range' }, r, out);
}
function colorInput(value, onInput) {
  const c = h('input', { class: 'studio-color', type: 'color', value });
  c.addEventListener('input', () => onInput(c.value));
  return c;
}
function check(label, value, onChange) {
  const i = h('input', { type: 'checkbox', checked: !!value });
  i.addEventListener('change', () => onChange(i.checked));
  return h('label', { class: 't3-check' }, i, h('span', { text: label }));
}
function select(value, items, onChange) {
  const s = h('select', { class: 'studio-input' }, items.map(([v, l]) => h('option', { value: String(v), text: l, selected: String(v) === String(value) })));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function seg(value, items, onChange) {
  return h('div', { class: 'img-seg t3-seg', role: 'group' }, items.map(([v, l, ic]) => {
    const b = h('button', { class: 'studio-btn is-small' + (String(v) === String(value) ? ' is-primary' : ' is-ghost'), type: 'button', 'aria-pressed': String(String(v) === String(value)), onclick: () => onChange(v) }, ic ? icon(ic, 14) : null, l ? h('span', { text: l }) : null);
    return b;
  }));
}
const hex = (c) => '#' + c.getHexString();

export class Panels {
  constructor(app, host) {
    this.app = app; this.host = host; this.matIndex = 0;
    // the first click of a double-click re-renders the list, so rename is handled on the stable host
    host.addEventListener('dblclick', (e) => {
      const r = e.target.closest?.('.t3-out-row');
      if (!r || e.target.closest('button, input')) return;
      const o = app.findById(r.dataset.id), name = r.querySelector('.t3-out-name');
      if (o && name) this.renameInline(o, name);
    });
  }

  focus(key) {
    if (this.app.mobile.matches) { this.sheet(key); return; }
    if (key !== 'outliner') { this.tab = key; this.refresh(); }
    const el = this.host.querySelector(`[data-panel="${key}"]`);
    if (el) { el.classList.remove('is-collapsed'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 700); }
  }
  /** Phones: Add / Outliner / Properties / Render open as sheets. A property tab name opens Properties on that tab. */
  sheet(key) {
    const app = this.app;
    if (key === 'material' && isLight(app.selected)) key = 'light';
    if (key === 'material' && isCam(app.selected)) key = 'camdata';
    if (TABS.some((t) => t[0] === key)) { if (key !== 'render') { this.tab = key; key = 'props'; } }
    this.sheetKey = key;
    this.activeSheet = openSheet({ title: TITLES[key] || key, persistent: key !== 'add', content: h('div', { class: 't3-sheet is-' + key }, this.sheetBody(key)), onClose: () => { this.sheetKey = null; app.root.removeAttribute('data-sheet'); } });
    this.activeSheet.panel.classList.add('t3-sheet-panel', 'is-' + key);
    app.root.dataset.sheet = key;
  }
  sheetBody(key) {
    if (key === 'add') return this.p_add();
    if (key === 'props') { const tabs = this.tabs(); this.pickTab(tabs); return h('div', { class: 't3-props' }, this.tabStrip(tabs), this.make(this.tab)); }
    return this.make(key);
  }
  /** Property tabs that apply to the current selection. */
  tabs() {
    const s = this.app.selected;
    const ok = { object: !!s, mods: canModify(s), material: !!s && !isLight(s) && !isCam(s) && materialsOf(s).length > 0, light: isLight(s), camdata: isCam(s), scene: true, render: true, camera: true, anim: true };
    return TABS.filter((t) => ok[t[0]]);
  }
  /** Follow the selection: a new kind of object opens its most useful tab. */
  pickTab(tabs) {
    const s = this.app.selected, selKey = s ? s.userData.eyadId : '';
    if (selKey !== this.lastSel) { const was = this.lastSel; this.lastSel = selKey; if (s && (!was || !this.tab || ['object', 'mods', 'light', 'camdata'].includes(this.tab) || !tabs.some((t) => t[0] === this.tab))) this.tab = isCam(s) ? 'camdata' : isLight(s) ? 'light' : 'object'; }
    if (!tabs.some((t) => t[0] === this.tab)) this.tab = tabs[0][0];
  }
  tabStrip(tabs) {
    return h('div', { class: 't3-tabs', role: 'tablist', 'aria-label': 'Properties' }, tabs.map(([k, ic, label]) => h('button', { class: 't3-tab' + (k === this.tab ? ' is-on' : ''), type: 'button', role: 'tab', 'aria-selected': String(k === this.tab), 'aria-label': label, title: label, dataset: { tab: k }, onclick: () => { this.tab = k; this.refresh(); } }, icon(ic, 16), h('span', { class: 't3-tab-label', text: label }))));
  }
  refresh() {
    if (this.app.mobile.matches) {
      clear(this.host);
      if (this.activeSheet && !this.activeSheet.closed && this.sheetKey) {
        const act = document.activeElement;
        if (act && this.activeSheet.panel.contains(act) && act.matches('input[type="number"], input[type="text"]')) return;
        const body = this.activeSheet.panel.querySelector('.t3-sheet');
        const sb = this.activeSheet.panel.querySelector('.studio-sheet-body');
        const st = sb ? sb.scrollTop : 0, ts = body?.querySelector('.t3-tabs')?.scrollLeft || 0;
        if (body) body.replaceChildren(this.sheetBody(this.sheetKey));
        if (sb) sb.scrollTop = st;
        const strip = body?.querySelector('.t3-tabs'); if (strip) strip.scrollLeft = ts;
      }
      return;
    }
    if (this.host.contains(document.activeElement) && document.activeElement.matches('input[type="number"], input[type="text"]')) { this.pending = true; return; }
    const propsScroll = this.host.querySelector('.t3-props-body')?.scrollTop || 0, lastTab = this.shownTab;
    const outScroll = this.host.querySelector('.t3-outliner')?.scrollTop || 0;
    const collapsed = new Set(Array.from(this.host.querySelectorAll('.img-panel.is-collapsed')).map((e) => e.dataset.panel));
    clear(this.host);
    const tabs = this.tabs();
    this.pickTab(tabs);
    const out = this.make('outliner');
    if (collapsed.has('outliner')) out.classList.add('is-collapsed');
    const body = h('div', { class: 't3-props-body' }, this.make(this.tab));
    this.host.append(out, h('div', { class: 't3-props img-panel' }, this.tabStrip(tabs), body));
    this.shownTab = this.tab;
    if (lastTab === this.tab) body.scrollTop = propsScroll;
    const ol = this.host.querySelector('.t3-outliner'); if (ol) ol.scrollTop = outScroll;
  }
  /** Fast path while dragging the gizmo / playing: only the transform numbers change. */
  syncTransform() {
    const o = this.app.selected; if (!o) return;
    const roots = [this.host, this.activeSheet && !this.activeSheet.closed ? this.activeSheet.panel : null].filter(Boolean);
    for (const r of roots) {
      const f = r.querySelectorAll('.t3-xyz [data-k]');
      for (const el of f) {
        const [k, i] = el.dataset.k.split(':');
        const v = k === 'r' ? o.rotation.toArray()[i] * R2D : k === 'p' ? o.position.toArray()[i] : o.scale.toArray()[i];
        el.set?.(v);
      }
    }
  }
  make(k) {
    const body = this['p_' + k] ? this['p_' + k]() : h('div');
    const actions = k === 'outliner' ? [this.addButton()] : [];
    return section(TITLES[k], k, body, { actions });
  }

  addButton() {
    const b = h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Add object', title: 'Add object' }, icon('plus', 15));
    b.addEventListener('click', () => { const r = b.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, this.app.addMenuItems()); });
    return b;
  }

  // ------------------------------------------------------------ add (phone sheet: big tiles)
  p_add() {
    const app = this.app;
    const tile = (ic, label, fn) => h('button', { class: 't3-tile', type: 'button', onclick: () => { this.activeSheet?.close(); fn(); } }, icon(ic, 24), h('span', { text: label }));
    const group = (title, tiles) => [h('div', { class: 't3-sub', text: title }), h('div', { class: 't3-tiles' }, tiles)];
    return h('div', { class: 't3-stack' },
      ...group('Mesh', [...PRIMITIVES.map((p) => tile(p.icon, p.label, () => app.addPrimitive(p.id))), tile('text', 'Text', () => app.addText())]),
      ...group('Light', LIGHTS.map((l) => tile(l.icon, l.label, () => app.addLight(l.id)))),
      ...group('Other', [tile('camera', 'Camera', () => app.addCamera()), tile('empty', 'Empty', () => app.addEmpty()), tile('upload', 'Import model', () => io.importDialog(app)), tile('folder', 'Open project', () => io.openDialog(app))]));
  }

  // ------------------------------------------------------------ render (output presets + actions)
  p_render() {
    const app = this.app, r = app.settings.render, vp = app.viewport;
    const set = (label, fn, co) => app.changeSettings(label, fn, co);
    const max = Math.min(4096, vp.maxOutputSize());
    const sizeKey = `${r.w}x${r.h}`;
    const chips = (items, cur, on) => h('div', { class: 't3-chips', role: 'group' }, items.map(([v, l]) => h('button', { class: 't3-chip' + (String(v) === String(cur) ? ' is-on' : ''), type: 'button', 'aria-pressed': String(String(v) === String(cur)), text: l, onclick: () => on(v) })));
    const cam = app.activeCamera();
    return h('div', { class: 't3-stack' },
      h('div', { class: 't3-sub', text: 'Image size' }),
      chips(io.RENDER_SIZES, sizeKey, (v) => { const [w, hh] = v.split('x').map(Number); set('Render size', () => { r.w = Math.min(max, w); r.h = Math.min(max, hh); }); }),
      h('div', { class: 't3-xyz is-2' },
        numField('W', r.w, { input: (x) => set('Render width', () => { r.w = Math.round(clamp(x, 16, max)); }, 'rw'), end: () => this.refresh() }, { step: 10, min: 16, max, digits: 0, title: 'Render width in pixels' }),
        numField('H', r.h, { input: (x) => set('Render height', () => { r.h = Math.round(clamp(x, 16, max)); }, 'rh'), end: () => this.refresh() }, { step: 10, min: 16, max, digits: 0, title: 'Render height in pixels' })),
      h('div', { class: 't3-sub', text: 'Quality' }),
      chips(io.RENDER_QUALITY, [1, 8, 32].includes(r.samples) ? r.samples : '', (v) => set('Render quality', () => { r.samples = Number(v); r.ss = true; })),
      h('p', { class: 'studio-dim studio-small', text: `${r.samples} sample${r.samples > 1 ? 's' : ''} per pixel${r.ss ? ' · 2× supersampling' : ''}. Draft is instant; Best takes longest.` }),
      h('div', { class: 't3-checks' },
        check('Transparent background', r.transparent, (v) => set('Transparent background', () => { r.transparent = v; })),
        check('2× supersampling', r.ss, (v) => set('Supersampling', () => { r.ss = v; }))),
      row('Camera', h('span', { class: 't3-parent', text: cam ? cam.name : 'Viewport view' }), cam ? null : h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'Add camera', onclick: () => app.addCamera() })),
      h('div', { class: 't3-render-go' },
        h('button', { class: 'studio-btn is-primary t3-big', type: 'button', dataset: { go: 'image' }, onclick: () => { if (app.mobile.matches) this.activeSheet?.close(); io.renderImageNow(app); } }, icon('render', 16), h('span', { text: `Render image · ${r.w} × ${r.h}` })),
        h('button', { class: 'studio-btn t3-big', type: 'button', onclick: () => { if (app.mobile.matches) this.activeSheet?.close(); io.renderVideoDialog(app); } }, icon('video', 16), h('span', { text: 'Render animation…' })),
        h('button', { class: 'studio-btn t3-big', type: 'button', onclick: () => { if (app.mobile.matches) this.activeSheet?.close(); io.renderVideoDialog(app, { motion: 'turntable' }); } }, icon('turntable', 16), h('span', { text: 'Turntable video…' })),
        h('button', { class: 'studio-btn is-ghost t3-big', type: 'button', onclick: () => { if (app.mobile.matches) this.activeSheet?.close(); io.exportGLB(app); } }, icon('download', 16), h('span', { text: 'Export GLB' }))),
      h('p', { class: 'studio-dim studio-small', text: 'Real-time WebGL render — grid, gizmos and helpers are never included. Video saves as WebM (or MP4 where the browser records it).' }));
  }

  // ------------------------------------------------------------ outliner (tree)
  p_outliner() {
    const app = this.app, v = app.viewport;
    const list = h('div', { class: 't3-outliner', role: 'tree', 'aria-label': 'Scene objects' });
    const flat = [];
    const activeId = app.settings.activeCamera;
    const addRow = (o, depth) => {
      flat.push(o);
      const on = app.selected === o, inSel = !on && app.isSelected(o), locked = !!o.userData.eyadLocked;
      const eye = h('button', { class: 'img-layer-eye', type: 'button', 'aria-pressed': String(o.visible), 'aria-label': o.visible ? 'Hide' : 'Show', title: o.visible ? 'Hide (H)' : 'Show', onclick: (e) => { e.stopPropagation(); app.setVisible(o, !o.visible); } }, icon(o.visible ? 'eye' : 'eyeOff', 15));
      const sel = h('button', { class: 'studio-icon-btn is-small t3-out-sel' + (locked ? ' is-off' : ''), type: 'button', 'aria-pressed': String(!locked), 'aria-label': locked ? 'Make selectable in the view' : 'Make unselectable in the view', title: locked ? 'Not selectable in the view — click to allow' : 'Selectable in the view — click to protect', onclick: (e) => { e.stopPropagation(); app.setLocked(o, !locked); } }, icon(locked ? 'lock' : 'cursor', 13));
      const name = h('span', { class: 't3-out-name', text: o.name || kindLabel(o) });
      const r = h('div', { class: 't3-out-row' + (on ? ' is-on' : '') + (inSel ? ' is-sel' : '') + (o.visible ? '' : ' is-hidden'), role: 'treeitem', 'aria-selected': String(on), 'aria-level': String(depth + 1), tabindex: '0', draggable: 'true', dataset: { id: o.userData.eyadId } },
        eye, h('span', { class: 't3-out-indent', style: { width: depth * 14 + 'px' } }), h('span', { class: 't3-out-icon' }, icon(iconFor(o), 15)), name,
        isCam(o) && o.userData.eyadId === activeId ? h('span', { class: 't3-out-badge is-cam', title: 'Active camera (used for renders)' }, icon('render', 12)) : null,
        app.anim.tracks[o.userData.eyadId]?.length ? h('span', { class: 't3-out-badge', title: 'Has keyframes' }, icon('key', 11)) : null,
        sel,
        h('button', { class: 'studio-icon-btn is-small t3-out-more', type: 'button', 'aria-label': 'More actions', onclick: (e) => { e.stopPropagation(); const rr = e.currentTarget.getBoundingClientRect(); contextMenu(rr.left, rr.bottom, app.objectMenuItems(o)); } }, icon('dots', 14)));
      r.addEventListener('click', (e) => {
        if (app.onViewportPick(o) === true) return;
        const add = e.shiftKey || e.ctrlKey || e.metaKey || !!app.addMode;
        if (add) app.select(o, { add: true }); else if (app.selected !== o || app.multi.length > 1) app.select(o);
      });
      r.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); this.renameInline(o, name); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const t = flat[flat.indexOf(o) + (e.key === 'ArrowDown' ? 1 : -1)]; if (t) { app.select(t); requestAnimationFrame(() => this.host.querySelector(`[data-id="${t.userData.eyadId}"]`)?.focus()); } }
      });
      r.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!app.isSelected(o)) app.select(o); contextMenu(e.clientX, e.clientY, app.objectMenuItems(o)); });
      // drag a row onto another to parent it; onto the empty area to clear the parent
      r.addEventListener('dragstart', (e) => { this.dragObj = o; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', o.name); } catch (err) { /* ignore */ } r.classList.add('is-drag'); });
      r.addEventListener('dragend', () => { this.dragObj = null; r.classList.remove('is-drag'); list.querySelectorAll('.is-drop').forEach((x) => x.classList.remove('is-drop')); });
      r.addEventListener('dragover', (e) => { const d = this.dragObj; if (!d || d === o || app.canParent(d, o)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; r.classList.add('is-drop'); });
      r.addEventListener('dragleave', () => r.classList.remove('is-drop'));
      r.addEventListener('drop', (e) => { const d = this.dragObj; this.dragObj = null; if (!d) return; e.preventDefault(); e.stopPropagation(); app.setParent(d, o); });
      list.appendChild(r);
      for (const c of editorChildren(o)) addRow(c, depth + 1);
    };
    for (const g of [v.content, v.cams, v.lights]) for (const o of editorChildren(g)) addRow(o, 0);
    if (!flat.length) list.appendChild(h('div', { class: 'img-panel-empty', text: 'Nothing here yet — add a shape or import a model.' }));
    list.addEventListener('dragover', (e) => { const d = this.dragObj; if (d && app.hasEditorParent(d)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    list.addEventListener('drop', (e) => { const d = this.dragObj; this.dragObj = null; if (d && app.hasEditorParent(d)) { e.preventDefault(); app.clearParent(d); } });
    const nl = flat.filter(isLight).length, nc = flat.filter(isCam).length, no = flat.length - nl - nc, nsel = app.selection().length;
    const foot = h('div', { class: 't3-out-foot' },
      h('span', { class: 'studio-dim studio-small', text: nsel > 1 ? `${nsel} selected` : `${no} object${no === 1 ? '' : 's'} · ${nl} light${nl === 1 ? '' : 's'}${nc ? ` · ${nc} camera${nc === 1 ? '' : 's'}` : ''}` }),
      h('span', { class: 'studio-spacer' }),
      h('button', { class: 'studio-icon-btn is-small t3-out-multi' + (app.addMode ? ' is-on' : ''), type: 'button', 'aria-label': 'Select several', 'aria-pressed': String(!!app.addMode), title: 'Select several — taps add to the selection (or Shift-click)', onclick: () => { app.setAddMode(!app.addMode); this.refresh(); } }, icon('multi', 15)),
      this.iconBtn('duplicate', 'Duplicate', () => app.duplicateSelected(), !app.selected),
      this.iconBtn('trash', 'Delete', () => app.deleteSelected(), !app.selected));
    return h('div', { class: 't3-outliner-wrap' }, list, foot);
  }
  iconBtn(ic, label, fn, disabled = false) { return h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': label, title: label, disabled, onclick: fn }, icon(ic, 15)); }
  renameInline(o, nameEl) {
    const input = h('input', { class: 'studio-input t3-out-rename', type: 'text', value: o.name, maxLength: 120 });
    nameEl.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; const v = input.value.trim(); if (input.isConnected) input.replaceWith(nameEl); if (ok && v && v !== o.name) this.app.rename(o, v); else this.refresh(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  // ------------------------------------------------------------ object / transform
  p_object() {
    const app = this.app, o = app.selected;
    if (!o) return h('div', { class: 'img-panel-empty', text: 'Select an object.' });
    const nameIn = h('input', { class: 'studio-input', type: 'text', value: o.name, maxLength: 120, 'aria-label': 'Name' });
    nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); if (v && v !== o.name) app.rename(o, v); });
    nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nameIn.blur(); });
    const tcb = (k, i) => ({
      begin: () => app.beginTransform(o),
      input: (v) => { if (k === 'p') o.position.setComponent(i, v); else if (k === 'r') { const r = o.rotation.toArray(); r[i] = v * D2R; o.rotation.set(r[0], r[1], r[2]); } else { if (app.uniformScale) { const f = v / (o.scale.getComponent(i) || 1); if (Number.isFinite(f) && f !== 0) o.scale.multiplyScalar(f); o.scale.setComponent(i, v); } else o.scale.setComponent(i, v); } app.viewport.invalidate(); this.syncTransform(); },
      end: () => app.commitTransform(o, { p: 'Move', r: 'Rotate', s: 'Scale' }[k]),
    });
    const xyz = (k, vals, step, digits) => h('div', { class: 't3-xyz' }, ['X', 'Y', 'Z'].map((ax, i) => { const f = numField(ax, vals[i], tcb(k, i), { step, digits, cls: 'is-' + ax.toLowerCase(), title: { p: 'Position ', r: 'Rotation ', s: 'Scale ' }[k] + ax }); f.dataset.k = k + ':' + i; return f; }));
    const els = [
      h('div', { class: 't3-name-row' }, h('span', { class: 't3-kind' }, icon(iconFor(o), 15), h('span', { text: kindLabel(o) })), nameIn),
      h('div', { class: 't3-sub' }, h('span', { text: 'Location' }), h('em', { class: 't3-unit', text: 'm' })), xyz('p', o.position.toArray(), 0.05, 3),
    ];
    const showRot = !(o.isLight && (o.isPointLight || o.isAmbientLight || o.isHemisphereLight));
    if (showRot) els.push(h('div', { class: 't3-sub' }, h('span', { text: 'Rotation' }), h('em', { class: 't3-unit', text: 'degrees' })), xyz('r', o.rotation.toArray().slice(0, 3).map((x) => x * R2D), 1, 1));
    if (app.hasEditorParent(o)) els.push(row('Parent', h('span', { class: 't3-parent', text: o.parent.name }), h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'Clear', title: 'Clear parent (Alt+P)', onclick: () => app.clearParent(o) })));
    const nsel = app.selection().length;
    if (nsel > 1) els.unshift(h('p', { class: 't3-note', text: `${nsel} objects selected — these values belong to the active one; moving it carries the rest.` }));
    if (isCam(o) || isEmpty(o)) {
      els.push(h('div', { class: 't3-actions' },
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.resetTransform(o) }, icon('undo', 14), h('span', { text: 'Reset' })),
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.startPick('parent') }, icon('link', 14), h('span', { text: 'Set parent…' }))));
    } else if (!o.isLight) {
      els.push(h('div', { class: 't3-sub' }, h('span', { text: 'Scale' }), h('em', { class: 't3-unit', text: '×' }), h('span', { class: 'studio-spacer' }), check('Uniform', app.uniformScale, (v) => { app.uniformScale = v; })), xyz('s', o.scale.toArray(), 0.05, 3));
      const meshes = []; o.traverse((n) => { if (n.isMesh) meshes.push(n); });
      const cast = meshes.some((m) => m.castShadow), recv = meshes.some((m) => m.receiveShadow);
      els.push(h('div', { class: 't3-checks' },
        check('Casts shadow', cast, (v) => app.setMeshFlag(o, 'castShadow', v)),
        check('Receives shadow', recv, (v) => app.setMeshFlag(o, 'receiveShadow', v))));
      els.push(h('div', { class: 't3-actions' },
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.dropToGround(o) }, icon('chevronDown', 14), h('span', { text: 'Drop to ground' })),
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.resetTransform(o) }, icon('undo', 14), h('span', { text: 'Reset' })),
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.viewport.frame(o) }, icon('frame', 14), h('span', { text: 'Frame' })),
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.startPick('parent') }, icon('link', 14), h('span', { text: 'Set parent…' }))));
      const clips = app.clips.filter((c) => c.root === o);
      if (clips.length) els.push(h('div', { class: 't3-sub', text: 'Animation clips (glTF)' }), h('div', { class: 't3-checks is-col' }, clips.map((c) => check(`${c.clip.name || 'Clip'} · ${c.clip.duration.toFixed(2)} s`, c.enabled, (v) => app.setClipEnabled(c, v)))));
    } else {
      els.push(h('div', { class: 't3-actions' }, h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.aimLightAtSelection(o) }, icon('frame', 14), h('span', { text: 'Aim at scene centre' }))));
    }
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ modifiers (shapes are rebuilt from their primitive)
  p_mods() {
    const app = this.app, o = app.selected;
    if (!canModify(o)) return h('div', { class: 'img-panel-empty', text: 'Modifiers work on the built-in shapes.' });
    const m = modsOf(o);
    const mats = materialsOf(o);
    const flat = mats.some((x) => x.flatShading);
    const num = (label, key, val) => numField(label, val, { input: (v) => app.setMods(o, { array: { [key]: v } }, 'a' + key) }, { step: 0.05, min: -100, max: 100, digits: 2, cls: 'is-' + label.toLowerCase(), title: 'Array offset ' + label });
    return h('div', { class: 't3-stack' },
      h('div', { class: 't3-sub', text: 'Resolution' }),
      row('Detail', range(m.detail, 0.25, 3, 0.25, (v) => app.setMods(o, { detail: v }, 'detail'), (v) => '×' + v.toFixed(2))),
      h('div', { class: 't3-checks' }, check('Smooth shading', !flat, (v) => { for (const x of mats) app.setMaterialProp(x, v ? 'Shade smooth' : 'Shade flat', 'flatShading', !v); })),
      h('div', { class: 't3-sub', text: 'Array' }),
      row('Count', range(m.array.count, 1, 32, 1, (v) => app.setMods(o, { array: { count: v } }, 'count'), (v) => String(Math.round(v)))),
      h('div', { class: 't3-sub' }, h('span', { text: 'Offset' }), h('em', { class: 't3-unit', text: '× size' })),
      h('div', { class: 't3-xyz' }, num('X', 'x', m.array.x), num('Y', 'y', m.array.y), num('Z', 'z', m.array.z)),
      h('p', { class: 'studio-dim studio-small', text: 'Modifiers stay editable: the shape is rebuilt from its primitive each time, and saved with the project.' }));
  }

  // ------------------------------------------------------------ camera object
  p_camdata() {
    const app = this.app, o = app.selected, v = app.viewport;
    if (!isCam(o)) return h('div');
    const c = camOf(o), r = app.settings.render;
    const active = app.settings.activeCamera === o.userData.eyadId;
    const set = (label, key, value, co) => app.setCamProp(o, label, key, value, co);
    const nf = (label, key, val, opt) => numField(opt.unit, val, { input: (x) => set(label, key, x, key), end: () => this.refresh() }, { step: opt.step, min: opt.min, max: opt.max, digits: opt.digits ?? 2, title: label });
    const els = [
      h('div', { class: 't3-bgseg' }, seg(c.type, [['persp', 'Perspective', 'persp'], ['ortho', 'Orthographic', 'ortho']], (t) => set('Camera type', 'type', t))),
    ];
    if (c.type === 'persp') {
      els.push(row('Focal length', nf('Focal length', 'focal', c.focal, { unit: 'mm', step: 1, min: 1, max: 5000, digits: 1 })));
      els.push(row('Field of view', range(focalToFov(c.focal, c.sensor), 2, 170, 0.5, (f) => set('Field of view', 'focal', Math.round(fovToFocal(f, c.sensor) * 100) / 100, 'focal'), (f) => f.toFixed(0) + '°')));
    } else els.push(row('Ortho scale', nf('Orthographic scale', 'orthoScale', c.orthoScale, { unit: 'm', step: 0.1, min: 0.001, max: 1e6 })));
    els.push(
      row('Sensor fit', select(c.fit, SENSOR_FITS, (x) => set('Sensor fit', 'fit', x))),
      c.type === 'persp' ? row('Sensor size', nf('Sensor size', 'sensor', c.sensor, { unit: 'mm', step: 1, min: 1, max: 200, digits: 1 })) : null,
      row('Clip start', nf('Clip start', 'near', c.near, { unit: 'm', step: 0.01, min: 0.001, max: 1e5, digits: 3 })),
      row('Clip end', nf('Clip end', 'far', c.far, { unit: 'm', step: 1, min: 0.01, max: 1e7, digits: 1 })),
      h('div', { class: 't3-sub', text: 'Frame (render size)' }),
      h('div', { class: 't3-xyz is-2' },
        numField('W', r.w, { input: (x) => app.changeSettings('Render width', () => { app.settings.render.w = Math.round(clamp(x, 16, 4096)); }, 'rw') }, { step: 10, min: 16, max: 4096, digits: 0, title: 'Render width in pixels' }),
        numField('H', r.h, { input: (x) => app.changeSettings('Render height', () => { app.settings.render.h = Math.round(clamp(x, 16, 4096)); }, 'rh') }, { step: 10, min: 16, max: 4096, digits: 0, title: 'Render height in pixels' })),
      h('div', { class: 't3-checks' },
        check('Active camera (renders use it)', active, (on) => { if (on) app.setActiveCamera(o); else app.changeSettings('Active camera', () => { app.settings.activeCamera = null; }); }),
        check('Lock camera to view', !!app.settings.lockCamera, (on) => app.setCameraLock(on))),
      h('div', { class: 't3-actions' },
        h('button', { class: 'studio-btn is-small' + (v.viewCam === o ? ' is-primary' : ''), type: 'button', title: 'Look through this camera (0)', onclick: () => { if (v.viewCam === o) v.exitCameraView(); else { app.setActiveCamera(o); v.enterCameraView(o); } app.onCamViewChanged(); } }, icon('camera', 14), h('span', { text: v.viewCam === o ? 'Leave camera view' : 'Look through' })),
        h('button', { class: 'studio-btn is-small', type: 'button', title: 'Move this camera to the current view (Ctrl+Alt+0)', disabled: !!v.viewCam, onclick: () => app.cameraToView() }, icon('frame', 14), h('span', { text: 'Camera to view' })),
        h('button', { class: 'studio-btn is-small', type: 'button', title: 'Insert a keyframe for this camera (I)', onclick: () => app.keySelected() }, icon('keyPlus', 14), h('span', { text: 'Key' }))));
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ material
  p_material() {
    const app = this.app, o = app.selected;
    const mats = materialsOf(o);
    if (!mats.length) return h('div', { class: 'img-panel-empty', text: 'This object has no material.' });
    if (this.matOwner !== o) { this.matOwner = o; this.matIndex = 0; }
    const m = mats[Math.min(this.matIndex, mats.length - 1)];
    const els = [];
    if (mats.length > 1) els.push(row('Material', select(this.matIndex, mats.map((mm, i) => [i, (mm.name || 'Material') + ' ' + (i + 1)]), (v) => { this.matIndex = Number(v); this.refresh(); })));
    const set = (label, key, value, co) => app.setMaterialProp(m, label, key, value, co);
    if (m.isMeshStandardMaterial) els.push(h('div', { class: 't3-sub', text: 'Presets' }), h('div', { class: 't3-presets' }, MATERIAL_PRESETS.map((p) => h('button', { class: 't3-preset', type: 'button', title: p.label, 'aria-label': 'Material preset: ' + p.label, dataset: { preset: p.id }, onclick: () => app.applyMaterialPreset(p) }, h('i', { style: { background: p.sw } }), h('span', { text: p.label })))));
    if (m.color) els.push(row('Colour', colorInput(hex(m.color), (v) => set('Material colour', 'color', v, 'mc')), h('span', { class: 'studio-mono t3-hex', text: hex(m.color) })));
    if (m.isMeshStandardMaterial) {
      els.push(row('Metalness', range(m.metalness, 0, 1, 0.01, (v) => set('Metalness', 'metalness', v, 'mm'))));
      els.push(row('Roughness', range(m.roughness, 0, 1, 0.01, (v) => set('Roughness', 'roughness', v, 'mr'))));
    }
    if (m.emissive) {
      els.push(row('Emission', colorInput(hex(m.emissive), (v) => set('Emission colour', 'emissive', v, 'me')), h('span', { class: 't3-grow' }, range(m.emissiveIntensity ?? 1, 0, 20, 0.05, (v) => set('Emission strength', 'emissiveIntensity', v, 'mei'), (v) => v.toFixed(1)))));
    }
    els.push(row('Opacity', range(m.opacity, 0, 1, 0.01, (v) => set('Opacity', 'opacity', v, 'mo'))));
    if (m.isMeshPhysicalMaterial) {
      els.push(row('Transmission', range(m.transmission, 0, 1, 0.01, (v) => set('Transmission', 'transmission', v, 'mt'))));
      if (m.transmission > 0) els.push(row('IOR', range(m.ior, 1, 2.333, 0.01, (v) => set('Index of refraction', 'ior', v, 'mi'))), row('Thickness', range(m.thickness, 0, 5, 0.01, (v) => set('Thickness', 'thickness', v, 'mth'))));
    } else if (m.isMeshStandardMaterial) els.push(row('Transmission', h('button', { class: 'studio-btn is-small', type: 'button', text: 'Enable glass', title: 'Turn this into a physical material that can transmit light', onclick: () => app.enableGlass(m) })));
    els.push(h('div', { class: 't3-checks' },
      check('Wireframe', m.wireframe, (v) => set('Wireframe', 'wireframe', v)),
      check('Double-sided', m.side === THREE.DoubleSide, (v) => set('Double-sided', 'side', v ? THREE.DoubleSide : THREE.FrontSide)),
      'flatShading' in m ? check('Flat shading', m.flatShading, (v) => set('Flat shading', 'flatShading', v)) : null));
    // texture
    const tex = m.map;
    let thumb = h('div', { class: 't3-tex-thumb is-empty' }, icon('texture', 18));
    if (tex && tex.image && (tex.image.width || tex.image.videoWidth)) {
      try {
        const c = document.createElement('canvas'); c.width = 48; c.height = 48;
        c.getContext('2d').drawImage(tex.image, 0, 0, 48, 48);
        thumb = h('div', { class: 't3-tex-thumb' }, c);
      } catch (e) { /* image not drawable (e.g. still decoding) */ }
    }
    els.push(h('div', { class: 't3-sub', text: 'Colour texture' }), h('div', { class: 't3-tex' }, thumb,
      h('div', { class: 't3-tex-meta' },
        h('span', { class: 'studio-small', text: tex ? (tex.name || 'Image texture') + (tex.image?.width ? ` · ${tex.image.width}×${tex.image.height}` : '') : 'None' }),
        h('div', { class: 't3-actions' },
          h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.pickTexture() }, icon('upload', 14), h('span', { text: tex ? 'Replace…' : 'Load image…' })),
          tex ? h('button', { class: 'studio-btn is-small is-ghost', type: 'button', onclick: () => app.setMaterialMap(null) }, h('span', { text: 'Remove' })) : null))));
    if (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial) els.push(h('p', { class: 'studio-dim studio-small', text: 'This material type has no metal / roughness controls.' }));
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ light
  p_light() {
    const app = this.app, l = app.selected;
    if (!isLight(l)) return h('div');
    const set = (label, key, value, co) => app.setLightProp(l, label, key, value, co);
    const els = [
      row('Colour', colorInput(hex(l.color), (v) => set('Light colour', 'color', v, 'lc')), h('span', { class: 'studio-mono t3-hex', text: hex(l.color) })),
      row('Intensity', range(l.intensity, 0, l.isPointLight || l.isSpotLight ? 400 : 20, l.isPointLight || l.isSpotLight ? 0.5 : 0.05, (v) => set('Intensity', 'intensity', v, 'li'), (v) => v.toFixed(v >= 100 ? 0 : 2))),
    ];
    if (l.isHemisphereLight) els.push(row('Ground', colorInput(hex(l.groundColor), (v) => set('Ground colour', 'groundColor', v, 'lg'))));
    if (l.isSpotLight) {
      els.push(row('Cone', range(l.angle * R2D, 1, 89, 0.5, (v) => set('Cone angle', 'angle', v * D2R, 'la'), (v) => v.toFixed(0) + '°')));
      els.push(row('Softness', range(l.penumbra, 0, 1, 0.01, (v) => set('Penumbra', 'penumbra', v, 'lp'))));
    }
    if (l.isRectAreaLight) {
      els.push(row('Width', range(l.width, 0.05, 20, 0.05, (v) => set('Light width', 'width', v, 'lw'), (v) => v.toFixed(2) + ' m')));
      els.push(row('Height', range(l.height, 0.05, 20, 0.05, (v) => set('Light height', 'height', v, 'lh'), (v) => v.toFixed(2) + ' m')));
      els.push(h('p', { class: 'studio-dim studio-small', text: 'A soft rectangular panel shining along its arrow. Area lights do not cast shadows.' }));
    }
    if (l.isPointLight || l.isSpotLight) els.push(row('Range', range(l.distance, 0, 100, 0.5, (v) => set('Range', 'distance', v, 'ld'), (v) => (v === 0 ? '∞' : v.toFixed(1)))));
    if (l.shadow) {
      els.push(h('div', { class: 't3-checks' }, check('Casts shadows', l.castShadow, (v) => set('Light shadows', 'castShadow', v))));
      if (!app.settings.shadows) els.push(h('p', { class: 'studio-dim studio-small', text: 'Shadows are turned off for the scene (Environment panel).' }));
    }
    if (l.isAmbientLight || l.isHemisphereLight) els.push(h('p', { class: 'studio-dim studio-small', text: 'Fills the whole scene evenly; position does not matter.' }));
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ scene / environment
  p_scene() {
    const app = this.app, s = app.settings;
    const set = (label, fn, co) => app.changeSettings(label, fn, co);
    const env = s.env, g = s.ground;
    const els = [
      h('div', { class: 't3-sub', text: 'Lighting' }),
      h('div', { class: 't3-chips', role: 'group', 'aria-label': 'Lighting environment' }, ENVS.map(([v, l]) => h('button', { class: 't3-chip' + (env.lighting === v ? ' is-on' : ''), type: 'button', 'aria-pressed': String(env.lighting === v), dataset: { env: v }, text: v === 'none' ? 'None' : l, onclick: () => set('Environment', () => { env.lighting = v; }) }))),
      env.lighting !== 'none' ? row('Strength', range(env.intensity, 0, 3, 0.01, (v) => set('Environment strength', () => { env.intensity = v; }, 'ei'))) : null,
      h('div', { class: 't3-sub', text: 'Background' }),
      h('div', { class: 't3-bgseg' }, seg(env.background, [['gradient', 'Gradient'], ['solid', 'Solid'], ['environment', 'Sky'], ['transparent', 'None']], (v) => set('Background', () => { env.background = v; }))),
    ];
    if (env.background === 'gradient') els.push(row('Top / bottom', colorInput(env.top, (v) => set('Background', () => { env.top = v; }, 'bt')), colorInput(env.bottom, (v) => set('Background', () => { env.bottom = v; }, 'bb'))));
    if (env.background === 'solid') els.push(row('Colour', colorInput(env.color, (v) => set('Background', () => { env.color = v; }, 'bc'))));
    if (env.background === 'environment') els.push(row('Blur', range(env.blur, 0, 1, 0.01, (v) => set('Background blur', () => { env.blur = v; }, 'bl'))));
    if (env.background === 'transparent') els.push(h('p', { class: 'studio-dim studio-small', text: 'Transparent in PNG renders when "Transparent background" is on; video renders use black.' }));
    const fog = s.fog;
    els.push(
      h('div', { class: 't3-sub' }, h('span', { text: 'Fog' }), check('On', fog.on, (v) => set('Fog', () => { fog.on = v; }))),
      fog.on ? row('Colour', colorInput(fog.color, (v) => set('Fog colour', () => { fog.color = v; }, 'fc'))) : null,
      fog.on ? row('Density', range(fog.density, 0, 0.5, 0.002, (v) => set('Fog density', () => { fog.density = v; }, 'fd'), (v) => v.toFixed(3))) : null);
    els.push(
      h('div', { class: 't3-sub', text: 'Camera response' }),
      row('Tone mapping', select(env.toneMapping, [['aces', 'Filmic (ACES)'], ['agx', 'AgX'], ['neutral', 'Neutral'], ['none', 'None (linear)']], (v) => set('Tone mapping', () => { env.toneMapping = v; }))),
      row('Exposure', range(env.exposure, 0.1, 4, 0.01, (v) => set('Exposure', () => { env.exposure = v; }, 'ex'))),
      h('div', { class: 't3-sub', text: 'Ground' }),
      h('div', { class: 't3-bgseg' }, seg(g.mode, [['shadow', 'Shadow catcher'], ['solid', 'Floor'], ['none', 'None']], (v) => set('Ground', () => { g.mode = v; }))),
      g.mode === 'shadow' ? row('Shadow', range(g.opacity, 0, 1, 0.01, (v) => set('Shadow opacity', () => { g.opacity = v; }, 'go'))) : null,
      g.mode === 'solid' ? row('Floor colour', colorInput(g.color, (v) => set('Floor colour', () => { g.color = v; }, 'gc'))) : null,
      h('div', { class: 't3-checks' },
        check('Shadows', s.shadows, (v) => set('Shadows', () => { s.shadows = v; })),
        check('Snap', s.snap.on, (v) => app.setSnap(v)),
        check('Grid', g.grid, (v) => set('Grid', () => { g.grid = v; })),
        check('World axes', s.overlays.axes, (v) => set('Axes', () => { s.overlays.axes = v; })),
        check('Helpers', s.overlays.helpers, (v) => set('Helpers', () => { s.overlays.helpers = v; }))),
    );
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ camera
  p_camera() {
    const app = this.app, v = app.viewport;
    if (v.viewCam) {
      return h('div', { class: 't3-stack' },
        h('p', { class: 'studio-dim studio-small', text: `Looking through “${v.viewCam.name}”. Its lens is in the Camera tab; orbit to leave the camera, or lock it to the view to move it.` }),
        h('div', { class: 't3-checks' }, check('Lock camera to view', !!app.settings.lockCamera, (on) => app.setCameraLock(on))),
        h('div', { class: 't3-actions' }, h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.toggleCameraView() }, icon('persp', 14), h('span', { text: 'Leave camera view' }))));
    }
    const persp = !v.camera.isOrthographicCamera;
    const fovToMm = (f) => v.persp.getFilmHeight() / 2 / Math.tan(f * D2R / 2);
    const els = [
      h('div', { class: 't3-bgseg' }, seg(persp ? 'persp' : 'ortho', [['persp', 'Perspective', 'persp'], ['ortho', 'Orthographic', 'ortho']], (t) => app.setProjection(t))),
    ];
    if (persp) {
      els.push(row('Field of view', range(v.persp.fov, 5, 120, 0.5, (f) => { app.setFov(f); document.querySelectorAll('.t3-focal input').forEach((x) => { if (document.activeElement !== x) x.value = Math.round(fovToMm(f)); }); }, (f) => f.toFixed(0) + '°')));
      const focal = numField('mm', Math.round(fovToMm(v.persp.fov)), { input: (mm) => { v.persp.setFocalLength(clamp(mm, 4, 800)); app.setFov(v.persp.fov); }, end: () => this.refresh() }, { step: 1, min: 4, max: 800, digits: 0, cls: 't3-focal', title: 'Focal length (35 mm film)' });
      els.push(row('Focal length', focal, h('span', { class: 'studio-dim studio-small', text: '35 mm equivalent' })));
    }
    els.push(h('div', { class: 't3-sub', text: 'Views' }), h('div', { class: 't3-views' },
      [['front', 'Front'], ['right', 'Right'], ['top', 'Top'], ['back', 'Back'], ['left', 'Left'], ['bottom', 'Bottom']].map(([k, l]) => h('button', { class: 'studio-btn is-small', type: 'button', text: l, onclick: () => v.setView(k) }))));
    els.push(h('div', { class: 't3-sub', text: 'Scene camera' }), h('div', { class: 't3-actions' },
      h('button', { class: 'studio-btn is-small', type: 'button', title: 'Look through the active camera (0)', onclick: () => app.toggleCameraView() }, icon('camera', 14), h('span', { text: 'Camera view' })),
      h('button', { class: 'studio-btn is-small', type: 'button', title: 'Move the active camera here (Ctrl+Alt+0)', onclick: () => app.cameraToView() }, icon('frame', 14), h('span', { text: 'Camera to view' })),
      h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.addCamera() }, icon('plus', 14), h('span', { text: 'New camera' }))));
    els.push(h('div', { class: 't3-sub' }, h('span', { text: 'Bookmarks' }), h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.addBookmark() }, icon('plus', 13), h('span', { text: 'Save view' }))));
    if (!app.bookmarks.length) els.push(h('p', { class: 'studio-dim studio-small', text: 'Save camera positions to come back to them, or to key camera moves.' }));
    for (const b of app.bookmarks) {
      els.push(h('div', { class: 't3-bm' },
        h('button', { class: 't3-bm-go', type: 'button', title: 'Go to view', onclick: () => app.goBookmark(b) }, icon('bookmark', 14), h('span', { text: b.name }), h('em', { text: b.type === 'ortho' ? 'Ortho' : Math.round(b.fov) + '°' })),
        h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Update to current view', title: 'Update to current view', onclick: () => app.updateBookmark(b) }, icon('rotate', 13)),
        h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Delete bookmark', title: 'Delete', onclick: () => app.deleteBookmark(b) }, icon('trash', 13))));
    }
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ animation
  p_anim() {
    const app = this.app, a = app.anim, o = app.selected;
    const els = [
      row('Duration', numField('s', a.duration, { begin: () => app.animBegin(), input: (v) => { a.duration = clamp(v, 0.1, 600); app.timeline?.update(); }, end: () => app.animEnd('Duration') }, { step: 0.1, min: 0.1, max: 600, digits: 2, title: 'Duration in seconds' })),
      h('div', { class: 't3-checks' },
        check('Loop playback', a.loop, (v) => app.animChange('Loop', () => { a.loop = v; })),
        check('Auto-key', app.autoKey, (v) => app.setAutoKey(v))),
      h('div', { class: 't3-sub', text: 'Quick moves' }),
      h('div', { class: 't3-actions' },
        h('button', { class: 'studio-btn is-small', type: 'button', disabled: !o, onclick: () => app.keySelected() }, icon('keyPlus', 14), h('span', { text: 'Insert keyframe' })),
        h('button', { class: 'studio-btn is-small', type: 'button', disabled: !o || isCam(o) || isLight(o), onclick: () => app.turntable('object') }, icon('turntable', 14), h('span', { text: 'Turntable' })),
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.turntable('camera') }, icon('orbit', 14), h('span', { text: 'Camera orbit' }))),
    ];
    const keyList = (title, keys, onEase, onDel, onGo) => {
      els.push(h('div', { class: 't3-sub', text: title }));
      if (!keys.length) { els.push(h('p', { class: 'studio-dim studio-small', text: 'No keys.' })); return; }
      els.push(h('div', { class: 't3-keys' }, keys.map((k, i) => h('div', { class: 't3-key' },
        h('button', { class: 't3-key-t', type: 'button', title: 'Go to key', onclick: () => onGo(k) }, icon('key', 11), h('span', { class: 'studio-mono', text: k.t.toFixed(2) + ' s' })),
        select(k.ease, EASES, (v) => onEase(i, v)),
        h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Delete key', title: 'Delete key', onclick: () => onDel(i) }, icon('close', 13))))));
    };
    if (o) {
      const id = o.userData.eyadId;
      const keys = a.tracks[id] || [];
      keyList(`Keys · ${o.name}`, keys, (i, v) => app.animChange('Key easing', () => { a.tracks[id][i].ease = v; }), (i) => app.animChange('Delete key', () => { a.tracks[id].splice(i, 1); if (!a.tracks[id].length) delete a.tracks[id]; }), (k) => app.setTime(k.t));
    }
    if (!app.activeCamera() || a.camera.length) keyList('View camera keys', a.camera, (i, v) => app.animChange('Key easing', () => { a.camera[i].ease = v; }), (i) => app.animChange('Delete camera key', () => { a.camera.splice(i, 1); }), (k) => app.setTime(k.t));
    els.push(h('div', { class: 't3-actions' },
      h('button', { class: 'studio-btn is-small is-ghost', type: 'button', disabled: !o || !a.tracks[o?.userData.eyadId], onclick: () => app.clearKeys('object') }, h('span', { text: 'Clear object keys' })),
      h('button', { class: 'studio-btn is-small is-ghost', type: 'button', disabled: !a.camera.length, onclick: () => app.clearKeys('camera') }, h('span', { text: 'Clear camera keys' }))));
    if (app.clips.length) els.push(h('p', { class: 'studio-dim studio-small', text: `${app.clips.length} glTF clip${app.clips.length > 1 ? 's' : ''} play on the same timeline (select the model to toggle them).` }));
    return h('div', { class: 't3-stack' }, els);
  }
}
void PRIMITIVES; void LIGHTS;
