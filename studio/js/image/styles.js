// EYAD IMAGE — Layer Style dialog (fx): Drop Shadow, Inner Shadow, Outer Glow,
// Stroke, Colour Overlay, Gradient Overlay and Fill opacity, previewed live on
// the canvas, one undo step. Styles are saved in .eyad projects.
import { h } from '../core/dom.js';
import { dialog, toast } from '../core/ui.js';
import { FX_DEFAULTS, sanitizeFx } from './doc.js';
import { propCmd } from './history.js';

const LABELS = { dropShadow: 'Drop Shadow', innerShadow: 'Inner Shadow', outerGlow: 'Outer Glow', stroke: 'Stroke', colorOverlay: 'Colour Overlay', gradientOverlay: 'Gradient Overlay' };
const FIELD = {
  opacity: ['Opacity', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  angle: ['Angle', -180, 180, 1, (v) => Math.round(v) + '°'],
  distance: ['Distance', 0, 300, 1, (v) => Math.round(v) + ' px'],
  size: ['Size', 0, 250, 1, (v) => Math.round(v) + ' px'],
};

export const PRESETS = {
  'Soft shadow': { dropShadow: { on: true, color: '#000000', opacity: 0.35, angle: 90, distance: 18, size: 40 } },
  'Hard shadow': { dropShadow: { on: true, color: '#000000', opacity: 0.9, angle: 135, distance: 14, size: 0 } },
  'Sticker': { stroke: { on: true, color: '#ffffff', size: 14, position: 'outside', opacity: 1 }, dropShadow: { on: true, color: '#000000', opacity: 0.35, angle: 90, distance: 8, size: 16 } },
  'Neon': { outerGlow: { on: true, color: '#00e5ff', opacity: 1, size: 40 }, stroke: { on: true, color: '#b8f6ff', size: 3, position: 'outside', opacity: 1 } },
  'Gradient text': { gradientOverlay: { on: true, from: '#7b61ff', to: '#ff6a88', angle: 0, opacity: 1 } },
  'Embossed': { innerShadow: { on: true, color: '#000000', opacity: 0.55, angle: 120, distance: 4, size: 6 }, dropShadow: { on: true, color: '#ffffff', opacity: 0.25, angle: -60, distance: 2, size: 2 } },
};

export async function layerStyleDialog(app, node = app.active) {
  if (!node || node.type === 'group') { toast('Pick a pixel, text or shape layer for layer styles.', { type: 'warn' }); return; }
  const before = { fx: node.fx ? JSON.parse(JSON.stringify(node.fx)) : undefined, fillOpacity: node.fillOpacity == null ? 1 : node.fillOpacity };
  const fx = sanitizeFx(node.fx || {});
  let fill = before.fillOpacity;
  const redraw = () => { node.fx = sanitizeFx(fx); node.fillOpacity = fill; node._dirtyThumb = true; app.invalidate(); };

  const secBox = h('div', { class: 'ls-sections' });
  const edit = h('div', { class: 'ls-edit' });
  let current = Object.keys(LABELS).find((k) => fx[k].on) || 'dropShadow';
  const renderList = () => {
    secBox.replaceChildren(...Object.keys(LABELS).map((k) => {
      const chk = h('input', { type: 'checkbox', checked: fx[k].on, 'aria-label': 'Enable ' + LABELS[k], onchange: () => { fx[k].on = chk.checked; current = k; redraw(); renderList(); renderEdit(); } });
      return h('div', { class: 'ls-sec' + (k === current ? ' is-on' : '') }, chk, h('button', { type: 'button', class: 'ls-sec-name', text: LABELS[k], onclick: () => { current = k; renderList(); renderEdit(); } }));
    }),
    h('div', { class: 'ls-fill' }, h('span', { text: 'Fill' }), (() => {
      const out = h('output', { text: Math.round(fill * 100) + '%' });
      const r = h('input', { class: 'studio-range', type: 'range', min: 0, max: 1, step: 0.01, value: fill, 'aria-label': 'Fill opacity' });
      r.addEventListener('input', () => { fill = +r.value; out.textContent = Math.round(fill * 100) + '%'; redraw(); });
      return h('div', { class: 'ls-row' }, r, out);
    })()),
    h('div', { class: 'ls-presets' }, h('span', { class: 'studio-label', text: 'Presets' }), ...Object.entries(PRESETS).map(([name, p]) => h('button', { type: 'button', class: 'studio-btn is-small', text: name, onclick: () => {
      for (const k of Object.keys(fx)) fx[k].on = false;
      for (const [k, v] of Object.entries(p)) Object.assign(fx[k], v);
      current = Object.keys(p)[0]; redraw(); renderList(); renderEdit();
    } }))));
  };
  const renderEdit = () => {
    const e = fx[current];
    const rows = [h('h3', { class: 'ls-h', text: LABELS[current] })];
    for (const [key, val] of Object.entries(e)) {
      if (key === 'on') continue;
      if (FIELD[key]) {
        const [label, mn, mx, st, f] = FIELD[key];
        const out = h('output', { text: f(val) });
        const r = h('input', { class: 'studio-range', type: 'range', min: mn, max: mx, step: st, value: val, 'aria-label': label });
        r.addEventListener('input', () => { e[key] = +r.value; out.textContent = f(+r.value); if (!e.on) { e.on = true; renderList(); } redraw(); });
        rows.push(h('label', { class: 'ls-field' }, h('span', { text: label }), h('div', { class: 'ls-row' }, r, out)));
      } else if (key === 'position') {
        const sel = h('select', { class: 'studio-input', onchange: () => { e.position = sel.value; redraw(); } }, ['outside', 'center', 'inside'].map((p) => h('option', { value: p, text: p[0].toUpperCase() + p.slice(1), selected: e.position === p })));
        rows.push(h('label', { class: 'ls-field' }, h('span', { text: 'Position' }), sel));
      } else if (key === 'blend') {
        continue;
      } else {
        const inp = h('input', { type: 'color', class: 'ls-color', value: val, 'aria-label': key });
        inp.addEventListener('input', () => { e[key] = inp.value; if (!e.on) { e.on = true; renderList(); } redraw(); });
        rows.push(h('label', { class: 'ls-field' }, h('span', { text: key === 'from' ? 'From' : key === 'to' ? 'To' : 'Colour' }), inp));
      }
    }
    edit.replaceChildren(...rows);
  };
  renderList(); renderEdit();
  const v = await dialog({ title: 'Layer Style — ' + node.name, width: 640, className: 'ls-dialog', body: h('div', { class: 'ls-root' }, secBox, edit),
    buttons: [{ label: 'Clear Style', value: 'clear' }, { label: 'Cancel', value: null }, { label: 'OK', value: true, primary: true }] });
  if (!v) { node.fx = before.fx; node.fillOpacity = before.fillOpacity; app.invalidate(); return; }
  const after = v === 'clear' ? { fx: undefined, fillOpacity: 1 } : { fx: sanitizeFx(fx), fillOpacity: fill };
  Object.assign(node, after);
  app.commit(propCmd('Layer Style', node, before, after));
  app.invalidate(); app.refresh();
}

export function copyStyle(app) { const n = app.active; if (!n || !n.fx) { toast('This layer has no style to copy.'); return; } app._styleClip = { fx: JSON.parse(JSON.stringify(n.fx)), fillOpacity: n.fillOpacity == null ? 1 : n.fillOpacity }; toast('Layer style copied', { timeout: 1200 }); }
export function pasteStyle(app) {
  const s = app._styleClip; if (!s) { toast('Copy a layer style first.'); return; }
  for (const id of app.selectedIds || [app.active && app.active.id]) {
    const f = app.doc && findLeaf(app.doc.layers, id); if (!f || f.type === 'group') continue;
    const before = { fx: f.fx, fillOpacity: f.fillOpacity == null ? 1 : f.fillOpacity }, after = { fx: sanitizeFx(s.fx), fillOpacity: s.fillOpacity };
    Object.assign(f, after); app.commit(propCmd('Paste Layer Style', f, before, after));
  }
  app.invalidate(); app.refresh();
}
function findLeaf(list, id) { for (const n of list) { if (n.id === id) return n; if (n.children) { const r = findLeaf(n.children, id); if (r) return r; } } return null; }
void FX_DEFAULTS;
