// EYAD VECTOR — right-hand panels (also shown as bottom sheets on phones).
import { h, clear, clamp, uid } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openSheet, promptDialog } from '../core/ui.js';
import { bounds, BLENDS, PATTERNS, FONTS, find } from './model.js';

const PRESETS = [['Instagram post', 1080, 1080], ['Instagram portrait', 1080, 1350], ['Story / Reel', 1080, 1920], ['YouTube thumbnail', 1280, 720], ['Full HD', 1920, 1080], ['A4 (px @96)', 794, 1123], ['A3 (px @96)', 1123, 1587], ['Logo 1000²', 1000, 1000]];

function section(title, key, body, { actions = [] } = {}) {
  const btn = h('button', { class: 'img-panel-toggle', type: 'button', 'aria-expanded': 'true' }, icon('chevronDown', 14), h('span', { text: title }));
  const el = h('section', { class: 'img-panel vec-panel is-' + key, dataset: { panel: key } }, h('div', { class: 'img-panel-head' }, btn, h('div', { class: 'img-panel-actions' }, actions)), h('div', { class: 'img-panel-body' }, body));
  btn.addEventListener('click', () => { const c = el.classList.toggle('is-collapsed'); btn.setAttribute('aria-expanded', String(!c)); });
  return el;
}
function num(label, value, onCommit, { step = 1, unit = '', min = -1e6, max = 1e6 } = {}) {
  const input = h('input', { class: 'studio-input is-num', type: 'number', step, min, max, value: Math.round(value * 100) / 100, 'aria-label': label });
  input.addEventListener('change', () => { const v = clamp(Number(input.value), min, max); if (Number.isFinite(v)) onCommit(v); });
  return h('label', { class: 'vec-num' }, h('span', { text: label }), input, unit ? h('em', { text: unit }) : null);
}
function select(label, value, items, onChange) {
  const s = h('select', { class: 'studio-input' }, items.map(([v, l]) => h('option', { value: String(v), text: l, selected: String(v) === String(value) })));
  s.addEventListener('change', () => onChange(s.value));
  return h('label', { class: 'vec-field' }, h('span', { text: label }), s);
}
function range(label, value, min, max, step, onInput, onCommit, fmt = (v) => v) {
  const out = h('output', { class: 'studio-mono', text: fmt(value) });
  const r = h('input', { class: 'studio-range', type: 'range', min, max, step, value });
  r.addEventListener('input', () => { out.textContent = fmt(Number(r.value)); onInput(Number(r.value)); });
  r.addEventListener('change', () => onCommit(Number(r.value)));
  return h('label', { class: 'vec-field is-range' }, h('span', { text: label }), r, out);
}

export class Panels {
  constructor(app, host) { this.app = app; this.host = host; this.build(); }
  build() { this.refresh(); }
  focus(key) {
    if (this.app.mobile.matches) { this.sheet(key); return; }
    const el = this.host.querySelector(`[data-panel="${key}"]`);
    if (el) { el.classList.remove('is-collapsed'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 700); }
  }
  sheet(key) {
    const el = this.make(key);
    this.sheetKey = key;
    this.activeSheet = openSheet({ title: { appearance: 'Appearance', layers: 'Layers', align: 'Align & Transform', pathfinder: 'Shape Builder', artboards: 'Artboards', character: 'Character' }[key] || key, content: h('div', { class: 'vec-sheet' }, el), onClose: () => { this.sheetKey = null; } });
  }
  refresh() {
    if (!this.app.doc) return;
    if (this.app.mobile.matches) {
      clear(this.host);
      if (this.activeSheet && !this.activeSheet.closed && this.sheetKey) { const body = this.activeSheet.panel.querySelector('.vec-sheet'); if (body) body.replaceChildren(this.make(this.sheetKey)); }
      return;
    }
    const scroll = this.host.scrollTop;
    const collapsed = new Set(Array.from(this.host.querySelectorAll('.img-panel.is-collapsed')).map((e) => e.dataset.panel));
    clear(this.host);
    const keys = ['appearance', 'character', 'align', 'pathfinder', 'layers', 'artboards'];
    for (const k of keys) {
      if (k === 'character' && !this.app.selNodesDeep().some((n) => n.type === 'text')) continue;
      const el = this.make(k);
      if (collapsed.has(k)) el.classList.add('is-collapsed');
      this.host.appendChild(el);
    }
    this.host.scrollTop = scroll;
  }
  make(k) {
    const title = { appearance: 'Appearance', character: 'Character', align: 'Align & Transform', pathfinder: 'Shape Builder', layers: 'Layers', artboards: 'Artboards' }[k];
    return section(title, k, this['p_' + k]());
  }

  // ------------------------------------------------------------ Appearance
  p_appearance() {
    const app = this.app, nodes = app.selNodesDeep().filter((n) => n.style && n.type !== 'group');
    const n = nodes[0];
    const st = n ? n.style : { fill: app.defFill, stroke: app.defStroke, sw: app.defSW, cap: 'round', join: 'round', dash: '', opacity: 1, blend: 'normal' };
    const setStyle = (label, fn, live = false) => {
      if (!nodes.length) { fn({ style: stDefaults }); app.defFill = stDefaults.fill; app.defStroke = stDefaults.stroke; app.defSW = stDefaults.sw; app.renderSwatches(); this.refresh(); return; }
      if (live) { app.begin(); for (const x of nodes) fn(x); app.render(); return; }
      app.change(label, () => { for (const x of nodes) fn(x); });
    };
    const stDefaults = { fill: app.defFill, stroke: app.defStroke, sw: app.defSW };
    const wrap = h('div', { class: 'vec-appearance' },
      n ? null : h('p', { class: 'studio-faint studio-small', text: 'Nothing selected — these are the colours for new shapes.' }),
      this.paintEditor('Fill', st.fill, (p) => setStyle('Fill', (x) => { x.style.fill = p; }), n),
      this.paintEditor('Stroke', st.stroke, (p) => setStyle('Stroke', (x) => { x.style.stroke = p; if (p && !x.style.sw) x.style.sw = 2; }), n),
      h('div', { class: 'vec-row' },
        num('Stroke', st.sw ?? 1, (v) => setStyle('Stroke Width', (x) => { x.style.sw = v; }), { min: 0, max: 1000, step: 0.5, unit: 'px' }),
        select('Cap', st.cap || 'round', [['butt', 'Butt'], ['round', 'Round'], ['square', 'Square']], (v) => setStyle('Stroke Cap', (x) => { x.style.cap = v; })),
        select('Join', st.join || 'round', [['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']], (v) => setStyle('Stroke Join', (x) => { x.style.join = v; }))),
      select('Dashes', st.dash || '', [['', 'Solid'], ['8 6', 'Dashed'], ['2 6', 'Dotted'], ['16 8 2 8', 'Dash-dot'], ['24 12', 'Long dash']], (v) => setStyle('Dashes', (x) => { x.style.dash = v; })),
      n ? range('Opacity', Math.round((st.opacity ?? 1) * 100), 0, 100, 1, (v) => { app.begin(); for (const x of nodes) x.style.opacity = v / 100; app.render(); }, (v) => { app.begin(); for (const x of nodes) x.style.opacity = v / 100; app.end('Opacity'); app.panels.refresh(); }, (v) => v + '%') : null,
      n ? select('Blend', st.blend || 'normal', BLENDS.map((b) => [b, b[0].toUpperCase() + b.slice(1).replace('-', ' ')]), (v) => setStyle('Blend Mode', (x) => { x.style.blend = v; })) : null);
    void uid;
    return wrap;
  }
  paintEditor(label, paint, onChange, hasSel) {
    const kinds = [['none', 'None'], ['solid', 'Solid'], ['linear', 'Linear'], ['radial', 'Radial'], ['pattern', 'Pattern']];
    const cur = paint ? paint.kind : 'none';
    const seg = h('div', { class: 'img-seg vec-kinds' }, kinds.map(([k, l]) => h('button', { class: 'studio-btn is-small' + (k === cur ? ' is-primary' : ''), type: 'button', text: l, onclick: () => {
      const base = paint && paint.kind === 'solid' ? paint.color : paint?.stops?.[0]?.color || paint?.color || '#d02b2a';
      if (k === 'none') onChange(null);
      else if (k === 'solid') onChange({ kind: 'solid', color: base, a: 1 });
      else if (k === 'pattern') onChange({ kind: 'pattern', name: 'dots', color: base, bg: null, scale: 16 });
      else onChange({ kind: k, x1: k === 'radial' ? 0.5 : 0, y1: 0.5, x2: 1, y2: 0.5, stops: paint?.stops || [{ o: 0, color: base, a: 1 }, { o: 1, color: '#111111', a: 1 }] });
    } })));
    const body = h('div', { class: 'vec-paint-body' });
    if (paint && paint.kind === 'solid') {
      const c = h('input', { type: 'color', class: 'studio-color', value: paint.color });
      c.addEventListener('change', () => onChange({ ...paint, color: c.value }));
      const hex = h('input', { class: 'studio-input studio-mono', value: paint.color, maxLength: 7, style: { width: '84px' } });
      hex.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) onChange({ ...paint, color: hex.value.toLowerCase() }); });
      body.append(h('div', { class: 'vec-row' }, c, hex, num('Alpha', Math.round((paint.a ?? 1) * 100), (v) => onChange({ ...paint, a: clamp(v, 0, 100) / 100 }), { unit: '%', min: 0, max: 100 })),
        h('div', { class: 'vec-swatchrow' }, ['#111111', '#ffffff', '#d02b2a', '#f3ede1', '#f39433', '#f2d23a', '#48b85a', '#3f6fe8', '#8a4fe0', '#e04fb8', '#7a7a7a', '#3a3a3a'].map((col) => h('button', { class: 'vec-swatch', type: 'button', title: col, style: { background: col }, onclick: () => onChange({ kind: 'solid', color: col, a: paint.a ?? 1 }) }))));
    } else if (paint && (paint.kind === 'linear' || paint.kind === 'radial')) {
      body.append(this.gradientEditor(paint, onChange));
      if (paint.kind === 'linear') {
        const ang = Math.round(Math.atan2(paint.y2 - paint.y1, paint.x2 - paint.x1) * 180 / Math.PI);
        body.append(num('Angle', ang, (v) => { const a = v * Math.PI / 180; onChange({ ...paint, x1: 0.5 - Math.cos(a) / 2, y1: 0.5 - Math.sin(a) / 2, x2: 0.5 + Math.cos(a) / 2, y2: 0.5 + Math.sin(a) / 2 }); }, { unit: '°' }));
      }
      body.append(h('p', { class: 'studio-faint studio-small', text: hasSel ? 'Tip: the Gradient tool (G) sets direction by dragging.' : '' }));
    } else if (paint && paint.kind === 'pattern') {
      const c = h('input', { type: 'color', class: 'studio-color', value: paint.color }); c.addEventListener('change', () => onChange({ ...paint, color: c.value }));
      const bg = h('input', { type: 'color', class: 'studio-color', value: paint.bg || '#ffffff' }); bg.addEventListener('change', () => onChange({ ...paint, bg: bg.value }));
      body.append(select('Pattern', paint.name, PATTERNS.map((p) => [p, p[0].toUpperCase() + p.slice(1)]), (v) => onChange({ ...paint, name: v })),
        h('div', { class: 'vec-row' }, h('label', { class: 'vec-field' }, h('span', { text: 'Ink' }), c), h('label', { class: 'vec-field' }, h('span', { text: 'Paper' }), bg), h('button', { class: 'studio-btn is-small', type: 'button', text: 'No paper', onclick: () => onChange({ ...paint, bg: null }) })),
        num('Scale', paint.scale || 16, (v) => onChange({ ...paint, scale: v }), { min: 2, max: 400, unit: 'px' }));
    }
    return h('div', { class: 'vec-paint' }, h('div', { class: 'vec-paint-head' }, h('strong', { text: label }), seg), body);
  }
  gradientEditor(paint, onChange) {
    const stops = paint.stops.map((s) => ({ ...s }));
    let selI = 0;
    const bar = h('div', { class: 'vec-grad-bar' });
    const track = h('div', { class: 'vec-grad-track' });
    const editRow = h('div', { class: 'vec-row' });
    const draw = () => {
      const sorted = [...stops].sort((a, b) => a.o - b.o);
      bar.style.background = `linear-gradient(90deg, ${sorted.map((s) => `${hexA(s.color, s.a)} ${s.o * 100}%`).join(', ')}), var(--vec-checker)`;
      clear(track);
      stops.forEach((s, i) => {
        const k = h('button', { class: 'vec-grad-stop' + (i === selI ? ' is-on' : ''), type: 'button', style: { left: s.o * 100 + '%', background: s.color }, title: 'Drag to move · double-click to remove' });
        k.addEventListener('pointerdown', (e) => {
          selI = i; draw(); k.setPointerCapture(e.pointerId);
          const r = track.getBoundingClientRect();
          const mv = (ev) => { s.o = clamp((ev.clientX - r.left) / r.width, 0, 1); k.style.left = s.o * 100 + '%'; bar.style.background = `linear-gradient(90deg, ${[...stops].sort((a, b) => a.o - b.o).map((q) => `${hexA(q.color, q.a)} ${q.o * 100}%`).join(', ')})`; };
          const upf = () => { k.removeEventListener('pointermove', mv); k.removeEventListener('pointerup', upf); onChange({ ...paint, stops }); };
          k.addEventListener('pointermove', mv); k.addEventListener('pointerup', upf);
          e.stopPropagation();
        });
        k.addEventListener('dblclick', () => { if (stops.length > 2) { stops.splice(i, 1); selI = 0; onChange({ ...paint, stops }); } });
        track.appendChild(k);
      });
      const s = stops[selI];
      const c = h('input', { type: 'color', class: 'studio-color', value: s.color }); c.addEventListener('change', () => { s.color = c.value; onChange({ ...paint, stops }); });
      clear(editRow);
      editRow.append(c, num('Location', Math.round(s.o * 100), (v) => { s.o = clamp(v, 0, 100) / 100; onChange({ ...paint, stops }); }, { unit: '%', min: 0, max: 100 }), num('Alpha', Math.round((s.a ?? 1) * 100), (v) => { s.a = clamp(v, 0, 100) / 100; onChange({ ...paint, stops }); }, { unit: '%', min: 0, max: 100 }),
        h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Reverse', onclick: () => { stops.forEach((q) => { q.o = 1 - q.o; }); onChange({ ...paint, stops }); } }, icon('swap', 14)));
    };
    bar.addEventListener('click', (e) => { const r = bar.getBoundingClientRect(); const o = clamp((e.clientX - r.left) / r.width, 0, 1); stops.push({ o, color: stops[selI].color, a: 1 }); selI = stops.length - 1; onChange({ ...paint, stops }); });
    draw();
    return h('div', { class: 'vec-grad' }, bar, track, editRow);
  }

  // ------------------------------------------------------------ Character
  p_character() {
    const app = this.app, texts = app.selNodesDeep().filter((n) => n.type === 'text');
    const t = texts[0] || app.charDefaults;
    const set = (label, fn) => { if (!texts.length) { fn(app.charDefaults); this.refresh(); return; } app.change(label, () => texts.forEach(fn)); };
    return h('div', { class: 'vec-char' },
      select('Font', t.font, FONTS.map(([f, l]) => [f, l]), (v) => set('Font', (x) => { x.font = v; })),
      h('div', { class: 'vec-row' },
        num('Size', t.size, (v) => set('Font Size', (x) => { x.size = clamp(v, 1, 2000); }), { unit: 'px', min: 1 }),
        select('Weight', t.weight, [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']], (v) => set('Font Weight', (x) => { x.weight = Number(v); }))),
      h('div', { class: 'vec-row' },
        num('Tracking', t.tracking || 0, (v) => set('Tracking', (x) => { x.tracking = v; }), { unit: '‰', min: -500, max: 2000 }),
        num('Leading', t.leading || 1.2, (v) => set('Leading', (x) => { x.leading = clamp(v, 0.5, 5); }), { step: 0.05, min: 0.5, max: 5 })),
      h('div', { class: 'vec-row' },
        h('div', { class: 'img-seg' }, [['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight']].map(([a, ic]) => h('button', { class: 'studio-icon-btn is-small' + (t.align === a ? ' is-on' : ''), type: 'button', title: 'Align ' + a, onclick: () => set('Align Text', (x) => { x.align = a; }) }, icon(ic, 15)))),
        h('button', { class: 'studio-btn is-small' + (t.italic ? ' is-primary' : ''), type: 'button', text: 'Italic', onclick: () => set('Italic', (x) => { x.italic = !x.italic; }) }),
        texts.length ? h('button', { class: 'studio-btn is-small', type: 'button', text: texts[0].width > 0 ? 'Point text' : 'Area text', onclick: () => set('Text Type', (x) => { x.width = x.width > 0 ? 0 : Math.max(100, bounds(x)?.w || 300); }) }) : null),
      texts.length === 1 ? h('button', { class: 'studio-btn is-small', type: 'button', text: 'Edit text…', onclick: () => app.editText(texts[0]) }) : null);
  }

  // ------------------------------------------------------------ Align & transform
  p_align() {
    const app = this.app, b = app.selBounds();
    const A = (ic, t, arg) => h('button', { class: 'studio-icon-btn', type: 'button', title: t, 'aria-label': t, onclick: () => app.cmd('align', arg) }, icon(ic, 16));
    const trans = b ? h('div', { class: 'vec-grid4' },
      num('X', b.x, (v) => app.cmd('setBounds', { x: v })), num('Y', b.y, (v) => app.cmd('setBounds', { y: v })),
      num('W', b.w, (v) => app.cmd('setBounds', { w: Math.max(0.01, v) })), num('H', b.h, (v) => app.cmd('setBounds', { h: Math.max(0.01, v) }))) : h('p', { class: 'studio-faint studio-small', text: 'Select objects to align and transform.' });
    return h('div', { class: 'vec-align' },
      h('div', { class: 'vec-row vec-iconrow' }, A('alignLeft', 'Align left', 'left'), A('alignCenter', 'Align horizontal centres', 'hcenter'), A('alignRight', 'Align right', 'right'), A('alignTop', 'Align top', 'top'), A('alignMiddle', 'Align vertical centres', 'vcenter'), A('alignBottom', 'Align bottom', 'bottom')),
      h('div', { class: 'vec-row vec-iconrow' },
        h('button', { class: 'studio-icon-btn', type: 'button', title: 'Distribute horizontally', onclick: () => app.cmd('distribute', 'h') }, icon('distH', 16)),
        h('button', { class: 'studio-icon-btn', type: 'button', title: 'Distribute vertically', onclick: () => app.cmd('distribute', 'v') }, icon('distV', 16)),
        select('To', app.alignTo || 'selection', [['selection', 'Selection'], ['artboard', 'Artboard']], (v) => { app.alignTo = v; })),
      trans,
      b ? h('div', { class: 'vec-row vec-iconrow' },
        h('button', { class: 'studio-icon-btn', type: 'button', title: 'Rotate 90°', onclick: () => app.cmd('rotate', 90) }, icon('rotate', 16)),
        h('button', { class: 'studio-icon-btn', type: 'button', title: 'Flip horizontal', onclick: () => app.cmd('reflect', 'h') }, icon('flipH', 16)),
        h('button', { class: 'studio-icon-btn', type: 'button', title: 'Flip vertical', onclick: () => app.cmd('reflect', 'v') }, icon('flipV', 16)),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Rotate…', onclick: () => app.cmd('transformDialog', 'rotate') }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Scale…', onclick: () => app.cmd('transformDialog', 'scale') })) : null);
  }

  // ------------------------------------------------------------ Pathfinder
  p_pathfinder() {
    const app = this.app;
    const B = (ic, t, op) => h('button', { class: 'vec-pf', type: 'button', title: t, onclick: () => app.cmd('pathfinder', op) }, icon(ic, 20), h('span', { text: t }));
    return h('div', { class: 'vec-pfwrap' },
      h('div', { class: 'vec-pfgrid' }, B('union', 'Unite', 'unite'), B('subtract', 'Minus Front', 'subtract'), B('intersect', 'Intersect', 'intersect'), B('exclude', 'Exclude', 'exclude'), B('divide', 'Divide', 'divide')),
      h('div', { class: 'vec-row' },
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Compound', title: 'Make compound path (Ctrl/Cmd+8)', onclick: () => app.cmd('makeCompound') }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Release', onclick: () => app.cmd('releaseCompound') }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Outline stroke', onclick: () => app.cmd('outlineStroke') })));
  }

  // ------------------------------------------------------------ Layers
  p_layers() {
    const app = this.app;
    const list = h('div', { class: 'vec-layers', role: 'tree' });
    const row = (n, depth) => {
      const on = app.sel.has(n.id);
      const r = h('div', { class: 'vec-layer' + (on ? ' is-on' : ''), role: 'treeitem', 'aria-selected': String(on), style: { paddingLeft: 6 + depth * 14 + 'px' } },
        h('button', { class: 'studio-icon-btn is-small', type: 'button', title: n.hidden ? 'Show' : 'Hide', onclick: (e) => { e.stopPropagation(); app.change(n.hidden ? 'Show' : 'Hide', () => { const f = find(app.doc, n.id); if (f) f.node.hidden = !f.node.hidden; }); } }, icon(n.hidden ? 'eyeOff' : 'eye', 14)),
        h('span', { class: 'vec-layer-icon' }, icon({ path: 'pen', group: 'folder', text: 'text', image: 'image' }[n.type] || 'shape', 13)),
        h('span', { class: 'vec-layer-name', text: n.name }),
        h('button', { class: 'studio-icon-btn is-small', type: 'button', title: n.locked ? 'Unlock' : 'Lock', onclick: (e) => { e.stopPropagation(); app.change(n.locked ? 'Unlock' : 'Lock', () => { const f = find(app.doc, n.id); if (f) f.node.locked = !f.node.locked; }); } }, icon(n.locked ? 'lock' : 'unlock', 13)));
      r.addEventListener('click', (e) => { if (n.locked) return; if (e.shiftKey || e.metaKey || e.ctrlKey) { app.sel.has(n.id) ? app.sel.delete(n.id) : app.sel.add(n.id); } else app.sel = new Set([n.id]); app.selectionChanged(); });
      r.addEventListener('dblclick', async () => { const v = await promptDialog('Rename', 'Name', n.name); if (v) app.change('Rename', () => { const f = find(app.doc, n.id); if (f) f.node.name = v; }); });
      list.appendChild(r);
      if (n.type === 'group' && (n.expanded || n.children.some((c) => app.sel.has(c.id)))) [...n.children].reverse().forEach((c) => row(c, depth + 1));
    };
    [...app.doc.items].reverse().forEach((n) => row(n, 0));
    if (!app.doc.items.length) list.appendChild(h('p', { class: 'img-panel-empty', text: 'Draw something — every object appears here.' }));
    const foot = h('div', { class: 'vec-row vec-layers-foot' },
      h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Bring forward', onclick: () => app.cmd('arrange', 'up') }, icon('chevronUp', 14)),
      h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Send backward', onclick: () => app.cmd('arrange', 'down') }, icon('chevronDown', 14)),
      h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Group', onclick: () => app.cmd('group') }, icon('folder', 14)),
      h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Duplicate', onclick: () => app.duplicateSelection() }, icon('duplicate', 14)),
      h('button', { class: 'studio-icon-btn is-small', type: 'button', title: 'Delete', onclick: () => app.cmd('delete') }, icon('trash', 14)));
    return h('div', {}, list, foot);
  }

  // ------------------------------------------------------------ Artboards
  p_artboards() {
    const app = this.app, doc = app.doc, ab = app.activeArtboard();
    const list = h('div', { class: 'vec-abs' }, doc.artboards.map((a, i) => h('button', { class: 'vec-ab-row' + (a.id === ab.id ? ' is-on' : ''), type: 'button', onclick: () => { app.activeAB = a.id; app.render(); app.view.fitArtboard(); this.refresh(); } }, h('span', { text: String(i + 1) }), h('strong', { text: a.name }), h('em', { text: `${a.w}×${a.h}` }))));
    const bg = h('input', { type: 'color', class: 'studio-color', value: ab.bg || '#ffffff' });
    bg.addEventListener('change', () => app.change('Artboard Background', () => { ab.bg = bg.value; }));
    return h('div', { class: 'vec-artboards' }, list,
      h('div', { class: 'vec-row' }, num('W', ab.w, (v) => app.change('Artboard Size', () => { ab.w = clamp(Math.round(v), 1, 20000); }), { min: 1 }), num('H', ab.h, (v) => app.change('Artboard Size', () => { ab.h = clamp(Math.round(v), 1, 20000); }), { min: 1 })),
      select('Preset', '', [['', 'Size preset…'], ...PRESETS.map(([n, w, hh], i) => [i, `${n} · ${w}×${hh}`])], (v) => { if (v === '') return; const [, w, hh] = PRESETS[Number(v)]; app.change('Artboard Size', () => { ab.w = w; ab.h = hh; }); app.view.fitArtboard(); }),
      h('div', { class: 'vec-row' }, h('label', { class: 'vec-field' }, h('span', { text: 'Background' }), bg), h('button', { class: 'studio-btn is-small', type: 'button', text: 'Transparent', onclick: () => app.change('Artboard Background', () => { ab.bg = null; }) })),
      h('div', { class: 'vec-row' },
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Rename', onclick: async () => { const v = await promptDialog('Rename artboard', 'Name', ab.name); if (v) app.change('Rename Artboard', () => { ab.name = v; }); } }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'New', onclick: () => { const last = doc.artboards[doc.artboards.length - 1]; const n = { id: uid('ab'), name: 'Artboard ' + (doc.artboards.length + 1), x: last.x + last.w + 80, y: last.y, w: last.w, h: last.h, bg: '#ffffff' }; app.change('New Artboard', () => { doc.artboards.push(n); }); app.activeAB = n.id; app.view.fitArtboard(); this.refresh(); } }),
        h('button', { class: 'studio-btn is-small is-danger', type: 'button', text: 'Delete', disabled: doc.artboards.length < 2, onclick: () => { app.change('Delete Artboard', () => { doc.artboards = doc.artboards.filter((a) => a.id !== ab.id); }); app.activeAB = doc.artboards[0].id; app.render(); this.refresh(); } })));
  }
}

function hexA(hex, a = 1) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
