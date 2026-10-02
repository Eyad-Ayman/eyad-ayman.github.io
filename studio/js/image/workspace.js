// EYAD IMAGE — customisable workspace: drag panels to reorder them, drag the
// panel column's edge to resize it, edit the toolbar (hide / reorder tools),
// and save named workspaces. Everything is kept in this browser.
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { dialog, toast, promptDialog } from '../core/ui.js';

const KEY = 'eyad-studio:image:workspace:v1';
export const DEFAULT_ORDER = ['color', 'properties', 'layers', 'history'];
export const DEFAULT_TOOLS = ['move', 'marquee', 'lasso', 'aiselect', 'crop', null, 'heal', 'brush', 'clone', 'historybrush', 'eraser', 'gradient', 'blurtool', 'dodge', null, 'pen', 'text', 'shape', null, 'eyedropper', 'hand', 'zoom'];
/** Tool groups (one toolbar button each, the rest in a flyout). */
export const TOOL_GROUPS = {
  lasso: ['lasso', 'polylasso'], select: ['aiselect', 'quick', 'wand'], gradient: ['gradient', 'bucket'],
  blur: ['blurtool', 'sharpentool', 'smudge'], dodge: ['dodge', 'burn', 'sponge'], eyedropper: ['eyedropper', 'ruler'],
};
export const TOOL_GROUP_OF = Object.fromEntries(Object.entries(TOOL_GROUPS).flatMap(([g, ids]) => ids.map((i) => [i, g])));

export const PRESETS = {
  essentials: { name: 'Essentials', order: DEFAULT_ORDER, vis: { color: true, properties: true, layers: true, history: true, options: true }, width: 292 },
  photography: { name: 'Photography', order: ['layers', 'properties', 'history', 'color'], vis: { color: false, properties: true, layers: true, history: true, options: true }, width: 300 },
  painting: { name: 'Painting', order: ['color', 'layers', 'history', 'properties'], vis: { color: true, properties: false, layers: true, history: true, options: true }, width: 260 },
  design: { name: 'Design', order: ['properties', 'layers', 'color', 'history'], vis: { color: true, properties: true, layers: true, history: false, options: true }, width: 320 },
  focus: { name: 'Focus (canvas only)', order: DEFAULT_ORDER, vis: { color: false, properties: false, layers: true, history: false, options: true }, width: 240 },
};

export function loadWorkspace() {
  let w = {};
  try { w = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { w = {}; }
  const order = Array.isArray(w.order) && w.order.length === 4 && DEFAULT_ORDER.every((k) => w.order.includes(k)) ? w.order : DEFAULT_ORDER.slice();
  const tools = Array.isArray(w.tools) ? w.tools.filter((t) => t === null || typeof t === 'string') : null;
  return { order, width: Number.isFinite(w.width) ? Math.max(200, Math.min(520, w.width)) : 292, tools, vis: w.vis || null, saved: w.saved && typeof w.saved === 'object' ? w.saved : {} };
}
export function saveWorkspace(w) { try { localStorage.setItem(KEY, JSON.stringify(w)); } catch (e) { /* ignore */ } }

/** Apply the panel column width (desktop widths only; narrow screens keep their layout). */
export function applyWidth(app) {
  const main = app.root.querySelector('.img-main'); if (!main) return;
  const w = app.ws.width;
  if (innerWidth > 1180 && !app.mobile.matches && !app.root.classList.contains('is-panels-hidden')) main.style.gridTemplateColumns = `52px minmax(0, 1fr) ${w}px`;
  else main.style.gridTemplateColumns = '';
}

/** Adds drag-to-reorder on panel headers and the resize edge on the panel column. */
export function enableCustomisation(app) {
  const col = app.panelsEl;
  // --- resize edge
  if (!col.querySelector('.img-resize-edge')) {
    const edge = h('div', { class: 'img-resize-edge', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize panels', title: 'Drag to resize the panels (double-click resets)', tabIndex: 0 });
    let st = null;
    edge.addEventListener('pointerdown', (e) => { st = { x: e.clientX, w: app.ws.width, mirror: app.root.dataset.panels === 'left' }; edge.setPointerCapture(e.pointerId); edge.classList.add('is-drag'); });
    edge.addEventListener('pointermove', (e) => { if (!st) return; const d = (e.clientX - st.x) * (st.mirror ? 1 : -1); app.ws.width = Math.max(200, Math.min(520, Math.round(st.w + d))); applyWidth(app); app.view && app.view.resize(); });
    edge.addEventListener('pointerup', () => { if (!st) return; st = null; edge.classList.remove('is-drag'); saveWorkspace(app.ws); });
    edge.addEventListener('dblclick', () => { app.ws.width = 292; applyWidth(app); saveWorkspace(app.ws); app.view && app.view.resize(); });
    edge.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { app.ws.width = Math.max(200, Math.min(520, app.ws.width + (e.key === 'ArrowLeft' ? 16 : -16))); applyWidth(app); saveWorkspace(app.ws); app.view && app.view.resize(); } });
    col.prepend(edge);
  }
  // --- drag panels by their header to reorder
  for (const [key, p] of Object.entries(app.panels)) {
    const head = p.el.querySelector('.img-panel-head');
    if (!head || head.dataset.dragBound) continue;
    head.dataset.dragBound = '1';
    const grip = h('span', { class: 'img-panel-grip', title: 'Drag to move this panel', 'aria-hidden': 'true' }, icon('dots', 12));
    head.prepend(grip);
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      drag = { key, y: e.clientY };
      p.el.classList.add('is-dragging');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const panels = app.ws.order.map((k) => app.panels[k].el).filter((el) => !el.hidden);
      let target = null;
      for (const el of panels) { const r = el.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { target = el; break; } }
      col.querySelectorAll('.is-drop-before, .is-drop-end').forEach((x) => x.classList.remove('is-drop-before', 'is-drop-end'));
      if (target && target !== p.el) target.classList.add('is-drop-before'); else if (!target) panels[panels.length - 1]?.classList.add('is-drop-end');
      drag.target = target ? Object.keys(app.panels).find((k) => app.panels[k].el === target) : '__end';
    });
    const end = () => {
      if (!drag) return;
      p.el.classList.remove('is-dragging');
      col.querySelectorAll('.is-drop-before, .is-drop-end').forEach((x) => x.classList.remove('is-drop-before', 'is-drop-end'));
      const t = drag.target; drag = null;
      if (!t || t === key) return;
      const order = app.ws.order.filter((k) => k !== key);
      if (t === '__end') order.push(key); else order.splice(order.indexOf(t), 0, key);
      app.ws.order = order; saveWorkspace(app.ws); app.buildPanels();
    };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }
  applyWidth(app);
}

// ------------------------------------------------------------------ toolbar editor

export async function editToolbarDialog(app) {
  const all = app.tools.map((t) => t.id);
  let list = (app.ws.tools || DEFAULT_TOOLS).slice();
  const hidden = all.filter((id) => !list.includes(id));
  const box = h('div', { class: 'ws-tools' });
  const render = () => {
    clear(box);
    const row = (id, i, shown) => {
      const t = id ? app.tools.find((x) => x.id === id) : null;
      if (id && !t) return null;
      return h('div', { class: 'ws-tool' + (shown ? '' : ' is-off') },
        id ? icon(t.icon, 16) : h('span', { class: 'ws-sep-mark' }), h('span', { text: id ? t.label : '— divider —' }),
        h('span', { class: 'studio-spacer' }),
        shown ? h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; render(); } }, icon('chevronUp', 13)) : null,
        shown ? h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; render(); } }, icon('chevronDown', 13)) : null,
        h('button', { class: 'studio-btn is-small', type: 'button', text: shown ? 'Hide' : 'Show', onclick: () => {
          if (shown) { list.splice(i, 1); if (id) hidden.push(id); } else { hidden.splice(hidden.indexOf(id), 1); list.push(id); }
          render();
        } }));
    };
    box.append(h('div', { class: 'ws-sub', text: 'In the toolbar' }), ...list.map((id, i) => row(id, i, true)),
      h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: '+ Add divider', onclick: () => { list.push(null); render(); } }),
      hidden.length ? h('div', { class: 'ws-sub', text: 'Hidden tools (still work from shortcuts & menus)' }) : null, ...hidden.map((id) => row(id, -1, false)));
  };
  render();
  const v = await dialog({ title: 'Edit toolbar', body: box, width: 440, buttons: [{ label: 'Reset', value: 'reset' }, { label: 'Cancel', value: null }, { label: 'Done', value: true, primary: true }] });
  if (!v) return;
  app.ws.tools = v === 'reset' ? null : list;
  saveWorkspace(app.ws); app.buildToolbar(); app.selectTool(app.tool ? app.tool.id : 'move');
  toast(v === 'reset' ? 'Toolbar reset' : 'Toolbar saved', { type: 'ok', timeout: 1200 });
}

// ------------------------------------------------------------------ named workspaces

export function applyPreset(app, p) {
  app.ws.order = p.order.slice(); app.ws.width = p.width || 292;
  app.panelVis = { ...app.panelVis, ...p.vis };
  app.ws.vis = app.panelVis;
  saveWorkspace(app.ws);
  app.root.classList.remove('is-panels-hidden');
  app.buildPanels(); applyWidth(app); app.view && app.view.resize();
  toast('Workspace: ' + p.name, { timeout: 1200 });
}
export async function saveCurrentWorkspace(app) {
  const name = await promptDialog('Save workspace', 'Name', 'My workspace', { maxLength: 40 });
  if (!name) return;
  app.ws.saved[name] = { name, order: app.ws.order.slice(), vis: { ...app.panelVis }, width: app.ws.width, tools: app.ws.tools ? app.ws.tools.slice() : null };
  saveWorkspace(app.ws);
  toast(`Saved “${name}”`, { type: 'ok' });
}
export function workspaceMenu(app) {
  return [
    ...Object.entries(PRESETS).map(([, p]) => ({ label: p.name, action: () => applyPreset(app, p) })),
    ...(Object.keys(app.ws.saved).length ? [{ separator: true }, ...Object.values(app.ws.saved).map((p) => ({ label: p.name, action: () => { applyPreset(app, p); if (p.tools !== undefined) { app.ws.tools = p.tools; saveWorkspace(app.ws); app.buildToolbar(); } } }))] : []),
    { separator: true },
    { label: 'Save Workspace…', action: () => saveCurrentWorkspace(app) },
    { label: 'Delete Saved Workspaces', enabled: () => Object.keys(app.ws.saved).length > 0, action: () => { app.ws.saved = {}; saveWorkspace(app.ws); toast('Saved workspaces removed'); } },
    { label: 'Edit Toolbar…', action: () => editToolbarDialog(app) },
  ];
}
