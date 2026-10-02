// EYAD IMAGE — working with several layers and several documents:
// align / distribute, select all layers, duplicate layers to another open
// document (or a new one), duplicate a whole document, and open a document in
// a second window side by side.
import { toast, dialog } from '../core/ui.js';
import { h } from '../core/dom.js';
import { putHandoff } from '../core/db.js';
import { ROUTES } from '../core/shell.js';
import { walk, findNode, nodeBounds, makeCanvas, createDoc } from './doc.js';
import { multiPropCmd, treeCmd } from './history.js';

const selNodes = (app) => { const d = app.doc; const out = []; for (const id of app.selectedIds) { const f = findNode(d, id); if (f && !app.isLocked(f.node)) out.push(f.node); } return out; };
const leaves = (n) => { if (n.type !== 'group') return [n]; const o = []; walk(n.children, (c) => { if (c.type !== 'group') o.push(c); }); return o; };

function shiftNodes(entries, n, dx, dy) {
  for (const l of leaves(n)) { entries.push({ node: l, before: { x: l.x, y: l.y }, after: { x: l.x + dx, y: l.y + dy } }); }
}

/** mode: left | hcenter | right | top | vcenter | bottom */
export function align(app, mode) {
  if (!app.doc) return;
  const nodes = selNodes(app);
  if (!nodes.length) { toast('Select one or more layers first.'); return; }
  const bs = nodes.map((n) => ({ n, b: nodeBounds(n) })).filter((x) => x.b);
  const ref = bs.length > 1 ? bs.reduce((a, { b }) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), r: Math.max(a.r, b.x + b.w), bt: Math.max(a.bt, b.y + b.h) }), { x: Infinity, y: Infinity, r: -Infinity, bt: -Infinity })
    : { x: 0, y: 0, r: app.doc.width, bt: app.doc.height }; // one layer → align to the canvas
  const entries = [];
  for (const { n, b } of bs) {
    let dx = 0, dy = 0;
    if (mode === 'left') dx = ref.x - b.x; else if (mode === 'right') dx = ref.r - (b.x + b.w); else if (mode === 'hcenter') dx = (ref.x + ref.r) / 2 - (b.x + b.w / 2);
    if (mode === 'top') dy = ref.y - b.y; else if (mode === 'bottom') dy = ref.bt - (b.y + b.h); else if (mode === 'vcenter') dy = (ref.y + ref.bt) / 2 - (b.y + b.h / 2);
    if (dx || dy) shiftNodes(entries, n, Math.round(dx), Math.round(dy));
  }
  if (!entries.length) return;
  for (const e of entries) Object.assign(e.node, e.after);
  app.commit(multiPropCmd('Align Layers', entries));
  app.invalidate(); app.refresh();
}

export function distribute(app, axis) {
  const nodes = selNodes(app);
  const bs = nodes.map((n) => ({ n, b: nodeBounds(n) })).filter((x) => x.b);
  if (bs.length < 3) { toast('Select three or more layers to distribute.'); return; }
  const key = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h';
  bs.sort((a, b) => a.b[key] - b.b[key]);
  const first = bs[0].b, last = bs[bs.length - 1].b;
  const total = bs.reduce((a, x) => a + x.b[size], 0);
  const gap = (last[key] + last[size] - first[key] - total) / (bs.length - 1);
  let pos = first[key] + first[size] + gap;
  const entries = [];
  for (let i = 1; i < bs.length - 1; i++) {
    const { n, b } = bs[i];
    const d = Math.round(pos - b[key]);
    if (d) shiftNodes(entries, n, axis === 'h' ? d : 0, axis === 'h' ? 0 : d);
    pos += b[size] + gap;
  }
  if (!entries.length) return;
  for (const e of entries) Object.assign(e.node, e.after);
  app.commit(multiPropCmd('Distribute Layers', entries));
  app.invalidate(); app.refresh();
}

export function selectAllLayers(app) {
  if (!app.doc) return;
  const ids = app.doc.layers.map((n) => n.id);
  if (!ids.length) return;
  app.selectedIds = new Set(ids);
  app.doc.activeId = ids[ids.length - 1];
  app.refresh(); app.view.requestDraw();
  toast(`${ids.length} layers selected`, { timeout: 1000 });
}

// ------------------------------------------------------------------ duplicate across documents

function cloneNode(n) {
  const c = { ...n, id: 'n' + Math.random().toString(36).slice(2, 10) };
  if (n.canvas) { c.canvas = makeCanvas(n.canvas.width, n.canvas.height); c.canvas.getContext('2d').drawImage(n.canvas, 0, 0); }
  if (n.mask && n.mask.canvas) { const m = makeCanvas(n.mask.canvas.width, n.mask.canvas.height); m.getContext('2d').drawImage(n.mask.canvas, 0, 0); c.mask = { ...n.mask, canvas: m }; }
  if (n.points) c.points = n.points.map((p) => ({ ...p }));
  if (n.subpaths) c.subpaths = n.subpaths.map((sp) => ({ closed: sp.closed, points: sp.points.map((p) => ({ ...p })) }));
  if (n.children) c.children = n.children.map(cloneNode);
  if (n.artboard) c.artboard = { ...n.artboard };
  delete c._layout;
  return c;
}

/** Layer ▸ Duplicate To… — copy the selected layers into another open document or a new one. */
export async function duplicateTo(app) {
  if (!app.doc) return;
  const nodes = selNodes(app).filter((n) => !app.selectedIds.has(findParentId(app.doc, n.id)));
  if (!nodes.length) { toast('Select the layers to duplicate.'); return; }
  const others = app.records.filter((r) => r.doc !== app.doc);
  const sel = h('select', { class: 'studio-input', 'aria-label': 'Destination' },
    h('option', { value: 'new', text: 'New document' }),
    others.map((r, i) => h('option', { value: String(i), text: r.doc.name + ` (${r.doc.width} × ${r.doc.height})` })));
  const center = h('input', { type: 'checkbox', checked: true });
  const v = await dialog({ title: `Duplicate ${nodes.length} layer${nodes.length === 1 ? '' : 's'} to…`, width: 420,
    body: h('div', { class: 'studio-stack' }, h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Document' }), sel),
      h('label', { class: 'studio-field is-check' }, center, h('span', { text: 'Centre in the destination' }))),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Duplicate', value: true, primary: true }] });
  if (!v) return;
  const src = app.doc;
  const copies = nodes.map(cloneNode);
  if (sel.value === 'new') {
    const doc = createDoc({ name: src.name + ' copy', width: src.width, height: src.height, background: 'transparent' });
    doc.layers = copies; doc.activeId = copies[copies.length - 1].id;
    app.addDocument(doc);
    toast('Duplicated into a new document', { type: 'ok' });
    return;
  }
  const rec = others[Number(sel.value)];
  const dst = rec.doc;
  if (center.checked) {
    const b = copies.map(nodeBounds).filter(Boolean).reduce((a, r) => ({ x: Math.min(a.x, r.x), y: Math.min(a.y, r.y), r: Math.max(a.r, r.x + r.w), bt: Math.max(a.bt, r.y + r.h) }), { x: Infinity, y: Infinity, r: -Infinity, bt: -Infinity });
    if (Number.isFinite(b.x)) { const dx = Math.round(dst.width / 2 - (b.x + b.r) / 2), dy = Math.round(dst.height / 2 - (b.y + b.bt) / 2); for (const c of copies) for (const l of leaves(c)) { l.x += dx; l.y += dy; } }
  }
  app.switchTo(app.records.indexOf(rec));
  const cmd = treeCmd(dst, 'Duplicate Layers', () => { dst.layers.push(...copies); dst.activeId = copies[copies.length - 1].id; });
  app.commit(cmd);
  app.selectedIds = new Set(copies.map((c) => c.id));
  app.invalidate(); app.refresh();
  toast(`Duplicated into “${dst.name}”`, { type: 'ok' });
}
function findParentId(doc, id) { let pid = null; walk(doc.layers, (n) => { if (n.children && n.children.some((c) => c.id === id)) pid = n.id; }); return pid; }

/** Image ▸ Duplicate… — the whole document as a new tab. */
export function duplicateDocument(app) {
  if (!app.doc) return;
  const src = app.doc;
  const doc = createDoc({ name: src.name + ' copy', width: src.width, height: src.height, background: 'transparent' });
  doc.layers = src.layers.map(cloneNode);
  doc.guides = src.guides.map((g) => ({ ...g }));
  doc.activeId = doc.layers.length ? doc.layers[doc.layers.length - 1].id : null;
  app.addDocument(doc);
  toast('Document duplicated', { type: 'ok', timeout: 1200 });
}

// ------------------------------------------------------------------ windows

/** Window ▸ New Window — a second EYAD IMAGE window (work on two documents side by side). */
export function newWindow() {
  const w = window.open(ROUTES.image, '_blank', 'popup=yes,width=1280,height=820');
  if (!w) toast('The browser blocked the new window — allow pop-ups for this site.', { type: 'warn', timeout: 6000 });
}

/** Window ▸ Move Document to New Window — open a copy of this document in its own window. */
export async function moveToNewWindow(app) {
  if (!app.doc) return;
  const { eyadBlobFor } = await import('./io.js');
  const blob = await eyadBlobFor(app);
  const id = await putHandoff([new File([blob], (app.doc.name || 'document') + '.eyad', { type: 'application/x-eyad' })]);
  const w = window.open(ROUTES.image + '?handoff=' + encodeURIComponent(id), '_blank', 'popup=yes,width=1280,height=820');
  if (!w) { toast('The browser blocked the new window — allow pop-ups for this site.', { type: 'warn', timeout: 6000 }); return; }
  toast('Opened in a new window (this tab keeps its copy).', { type: 'ok' });
}
