// EYAD IMAGE — document operations used by menus, panels, shortcuts.
import { h } from '../core/dom.js';
import { toast, formDialog, confirmDialog, promptDialog, dialog, progressDialog } from '../core/ui.js';
import { setSetting, getSettings } from '../core/settings.js';
import {
  makeNode, makeCanvas, cloneNode, findNode, walk, hitTest, localSize, nodeMatrix, isIdentity, nodeBounds,
  roundRect, intersectRect, isAncestor, MAX_SIDE, MAX_AREA, layoutText,
} from './doc.js';
import { propCmd, pixelCmd, replaceCanvasCmd, compound, treeCmd, stateCmd, selectionCmd } from './history.js';
import { renderNode, flatten, drawContent, matrixArgs } from './render.js';
import { selectAll as selAll, invertSelection, featherSelection, selectionFromCanvas } from './selection.js';
import { localSelection } from './tools.js';
import { runFilter } from './filters.js';
import { loadImageFile } from '../core/files.js';

const need = (app) => { if (!app.doc) { toast('Open or create a document first.'); return false; } return true; };

export function hit(app, pt) { return hitTest(app.doc, pt.x, pt.y, { includeLocked: true }); }

function selectedNodes(app) {
  const d = app.doc; const out = [];
  for (const id of app.selectedIds) { const f = findNode(d, id); if (f) out.push(f.node); }
  if (!out.length && app.active) out.push(app.active);
  // drop nodes whose ancestor is also selected
  return out.filter((n) => !out.some((o) => o !== n && isAncestor(o, n)));
}

/** Trim a doc-sized canvas to its opaque bounds. Returns { canvas, x, y } (or a 1×1 when empty). */
export function trimCanvas(c) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const W = c.width, H = c.height;
  const d = g.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) if (d[row + x * 4 + 3]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return { canvas: makeCanvas(1, 1), x: 0, y: 0, empty: true };
  const w = maxX - minX + 1, hh = maxY - minY + 1;
  const out = makeCanvas(w, hh);
  out.getContext('2d').drawImage(c, -minX, -minY);
  return { canvas: out, x: minX, y: minY };
}

// ================================================================= layers

export function newLayer(app) {
  if (!need(app)) return;
  const d = app.doc;
  app.insertNode(makeNode('raster', { width: d.width, height: d.height }), 'New Layer');
}

export function newGroup(app) {
  if (!need(app)) return;
  app.insertNode(makeNode('group', {}), 'New Group');
}

export function addTextCenter(app) {
  if (!need(app)) return;
  const d = app.doc, o = app.opt('text');
  const n = makeNode('text', { text: 'Your text', font: o.font, size: Math.round(Math.min(d.width, d.height) / 10), weight: o.weight, color: app.fg });
  const l = layoutText(n);
  n.x = Math.round((d.width - l.w) / 2); n.y = Math.round((d.height - l.h) / 2);
  app.insertNode(n, 'Add Text');
}

export function duplicate(app) {
  if (!need(app)) return;
  const nodes = selectedNodes(app); if (!nodes.length) return;
  const d = app.doc;
  let last = null;
  const cmd = treeCmd(d, nodes.length > 1 ? 'Duplicate Layers' : 'Duplicate Layer', () => {
    for (const n of nodes) {
      const f = findNode(d, n.id); if (!f) continue;
      const c = cloneNode(n);
      f.arr.splice(f.index + 1, 0, c);
      last = c;
    }
    if (last) d.activeId = last.id;
  });
  app.selectedIds = new Set(last ? [last.id] : []);
  app.commit(cmd);
}

export function deleteLayers(app) {
  if (!need(app)) return;
  const d = app.doc;
  const nodes = selectedNodes(app);
  if (!nodes.length) return;
  let total = 0; walk(d.layers, (n) => { if (n.type !== 'group') total++; });
  let removing = 0; for (const n of nodes) { if (n.type === 'group') walk(n.children, (c) => { if (c.type !== 'group') removing++; }); else removing++; }
  if (removing >= total && d.layers.length <= nodes.length) { toast('A document needs at least one layer.', { type: 'warn' }); return; }
  if (nodes.some((n) => app.isLocked(n))) { toast('Locked layers can’t be deleted. Unlock them first.', { type: 'warn' }); return; }
  let nextActive = null;
  const cmd = treeCmd(d, nodes.length > 1 ? 'Delete Layers' : 'Delete Layer', () => {
    for (const n of nodes) {
      const f = findNode(d, n.id); if (!f) continue;
      f.arr.splice(f.index, 1);
      nextActive = f.arr[Math.min(f.index, f.arr.length - 1)] || f.parent || null;
    }
    if (!nextActive) nextActive = d.layers[d.layers.length - 1] || null;
    d.activeId = nextActive ? nextActive.id : null;
  });
  app.selectedIds = new Set(d.activeId ? [d.activeId] : []);
  app.commit(cmd);
}

export function toggleVisible(app, n) {
  if (!n) return;
  app.commit(propCmd(n.visible ? 'Hide Layer' : 'Show Layer', n, { visible: n.visible }, { visible: !n.visible }));
  n.visible = !n.visible;
  app.invalidate();
}
export function toggleLock(app, n) {
  if (!n) return;
  const cmd = propCmd(n.locked ? 'Unlock Layer' : 'Lock Layer', n, { locked: n.locked }, { locked: !n.locked });
  n.locked = !n.locked;
  app.commit(cmd);
}
export function toggleClip(app, n) {
  if (!n || n.type === 'group') return;
  const cmd = propCmd(n.clip ? 'Release Clipping Mask' : 'Create Clipping Mask', n, { clip: n.clip }, { clip: !n.clip });
  n.clip = !n.clip;
  app.commit(cmd);
}
export function setProp(app, n, key, value, label, coalesce) {
  if (!n || n[key] === value) return;
  const before = { [key]: n[key] };
  n[key] = value;
  delete n._layout;
  app.commit(propCmd(label, n, before, { [key]: value }, { coalesce }));
}
export function renameLayer(app, n, name) {
  name = String(name || '').trim().slice(0, 200);
  if (!n || !name || name === n.name) return;
  setProp(app, n, 'name', name, 'Rename Layer');
}
export async function renameDoc(app) {
  if (!need(app)) return;
  const name = await promptDialog('Rename document', 'Name', app.doc.name);
  if (name) { app.doc.name = name.slice(0, 200); app.refresh(); }
}

export function reorder(app, dir) {
  if (!need(app)) return;
  const n = app.active; if (!n) return;
  const d = app.doc;
  const f = findNode(d, n.id);
  const arr = f.arr, i = f.index;
  let j = i;
  if (dir === 'up') j = Math.min(arr.length - 1, i + 1);
  else if (dir === 'down') j = Math.max(0, i - 1);
  else if (dir === 'top') j = arr.length - 1;
  else if (dir === 'bottom') j = 0;
  if (i === j) return;
  app.commit(treeCmd(d, { up: 'Bring Forward', down: 'Send Backward', top: 'Bring to Front', bottom: 'Send to Back' }[dir], () => {
    arr.splice(i, 1); arr.splice(j, 0, n);
  }));
}

/** Move node into targetParent (null = root) at index (panel drag & drop). */
export function moveNode(app, id, targetParent, index) {
  const d = app.doc;
  const f = findNode(d, id); if (!f) return;
  if (targetParent && (targetParent === f.node || isAncestor(f.node, targetParent))) return;
  app.commit(treeCmd(d, 'Move Layer', () => {
    f.arr.splice(f.index, 1);
    const arr = targetParent ? targetParent.children : d.layers;
    let idx = index;
    if (arr === f.arr && f.index < index) idx--;
    arr.splice(Math.max(0, Math.min(arr.length, idx)), 0, f.node);
    d.activeId = id;
  }));
}

export function groupLayers(app) {
  if (!need(app)) return;
  const d = app.doc;
  const nodes = selectedNodes(app);
  if (!nodes.length) return;
  const g = makeNode('group', {});
  const first = findNode(d, nodes[0].id);
  // keep only siblings of the first node (keeps behaviour predictable)
  const sibs = nodes.filter((n) => findNode(d, n.id).arr === first.arr).sort((a, b) => first.arr.indexOf(a) - first.arr.indexOf(b));
  app.commit(treeCmd(d, 'Group Layers', () => {
    const arr = first.arr;
    const top = Math.max(...sibs.map((n) => arr.indexOf(n)));
    arr.splice(top + 1, 0, g);
    for (const n of sibs) { arr.splice(arr.indexOf(n), 1); g.children.push(n); }
    d.activeId = g.id;
  }));
  app.selectedIds = new Set([g.id]);
}

export function ungroup(app) {
  if (!need(app)) return;
  const d = app.doc, g = app.active;
  if (!g || g.type !== 'group') { toast('Select a group to ungroup.'); return; }
  app.commit(treeCmd(d, 'Ungroup Layers', () => {
    const f = findNode(d, g.id);
    f.arr.splice(f.index, 1, ...g.children);
    d.activeId = g.children.length ? g.children[g.children.length - 1].id : null;
  }));
}

/** Render a list of sibling nodes (bottom→top) into a new trimmed raster layer. */
function mergeNodes(app, nodes, name) {
  const d = app.doc;
  const c = makeCanvas(d.width, d.height);
  const g = c.getContext('2d');
  for (const n of nodes) if (n.visible) renderNode(n, g, { width: d.width, height: d.height });
  const t = trimCanvas(c);
  const m = makeNode('raster', { name, canvas: t.canvas });
  m.x = t.x; m.y = t.y;
  return m;
}

export function mergeDown(app) {
  if (!need(app)) return;
  const d = app.doc;
  const sel = selectedNodes(app);
  if (sel.length > 1) return mergeSelected(app, sel);
  const n = app.active; if (!n) return;
  const f = findNode(d, n.id);
  const below = f.arr[f.index - 1];
  if (!below) { toast('There is no layer below to merge into.'); return; }
  if (app.isLocked(below) || app.isLocked(n)) { toast('Unlock the layers before merging.', { type: 'warn' }); return; }
  const merged = mergeNodes(app, [below, n], below.name);
  app.commit(treeCmd(d, 'Merge Down', () => {
    const i = f.arr.indexOf(below);
    f.arr.splice(i, 2, merged);
    d.activeId = merged.id;
  }));
  app.selectedIds = new Set([merged.id]);
}

function mergeSelected(app, nodes) {
  const d = app.doc;
  const f0 = findNode(d, nodes[0].id);
  const sibs = nodes.filter((n) => findNode(d, n.id).arr === f0.arr).sort((a, b) => f0.arr.indexOf(a) - f0.arr.indexOf(b));
  const merged = mergeNodes(app, sibs, sibs[sibs.length - 1].name);
  app.commit(treeCmd(d, 'Merge Layers', () => {
    const idx = f0.arr.indexOf(sibs[sibs.length - 1]);
    f0.arr.splice(idx + 1, 0, merged);
    for (const s of sibs) f0.arr.splice(f0.arr.indexOf(s), 1);
    d.activeId = merged.id;
  }));
  app.selectedIds = new Set([merged.id]);
}

export function mergeVisible(app) {
  if (!need(app)) return;
  const d = app.doc;
  const vis = d.layers.filter((n) => n.visible);
  if (vis.length < 2) { toast('Need at least two visible layers to merge.'); return; }
  const merged = mergeNodes(app, vis, 'Merged');
  app.commit(treeCmd(d, 'Merge Visible', () => {
    const top = d.layers.indexOf(vis[vis.length - 1]);
    d.layers.splice(top + 1, 0, merged);
    d.layers = d.layers.filter((n) => !vis.includes(n));
    d.activeId = merged.id;
  }));
  app.selectedIds = new Set([merged.id]);
}

export async function flattenImage(app) {
  if (!need(app)) return;
  const d = app.doc;
  let hidden = 0; walk(d.layers, (n) => { if (!n.visible) hidden++; });
  if (hidden) {
    const ok = await confirmDialog('Flatten image', `Discard ${hidden} hidden layer(s)?`, { ok: 'Flatten' });
    if (!ok) return;
  }
  const c = flatten(d, { background: '#ffffff' });
  const bg = makeNode('raster', { name: 'Background', canvas: c });
  app.commit(treeCmd(d, 'Flatten Image', () => { d.layers = [bg]; d.activeId = bg.id; }));
  app.selectedIds = new Set([bg.id]);
}

export function rasterize(app, n) {
  if (!n || (n.type !== 'text' && n.type !== 'shape')) return;
  const d = app.doc;
  const c = makeCanvas(d.width, d.height);
  renderNode({ ...n, opacity: 1, blend: 'normal', visible: true }, c.getContext('2d'), { width: d.width, height: d.height });
  const t = trimCanvas(c);
  const r = makeNode('raster', { name: n.name, canvas: t.canvas });
  Object.assign(r, { x: t.x, y: t.y, opacity: n.opacity, blend: n.blend, visible: n.visible, clip: n.clip, locked: false });
  app.commit(treeCmd(d, 'Rasterize Layer', () => {
    const f = findNode(d, n.id);
    f.arr.splice(f.index, 1, r);
    d.activeId = r.id;
  }));
  app.selectedIds = new Set([r.id]);
}

export function convertPsdText(app) {
  const n = app.active;
  if (!n || !n.psd || n.psd.kind !== 'text') { toast('Select a text layer imported from a PSD.'); return; }
  const p = n.psd;
  const t = makeNode('text', {
    text: p.text || 'Text', size: Math.max(4, Math.round(p.size || 36)), weight: 600, name: (p.text || 'Text').split('\n')[0].slice(0, 40) + ' (editable)',
    color: Array.isArray(p.color) ? '#' + p.color.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : '#111111',
    font: /mono/i.test(p.font || '') ? 'Studio Mono' : /oswald|condensed|narrow|impact|bebas/i.test(p.font || '') ? 'Studio Oswald' : 'Studio Inter',
  });
  t.x = n.x; t.y = n.y;
  app.insertNode(t, 'Convert PSD Text');
  toast(`Approximate editable copy added above. Original font: ${p.font || 'unknown'}. The pixel layer is kept.`, { timeout: 6000 });
}

// ================================================================= masks

export function addMask(app, mode = 'reveal') {
  const n = app.active; if (!n) return;
  if (n.mask) { toast('This layer already has a mask.'); return; }
  const { w, h: hh } = n.type === 'group' ? { w: app.doc.width, h: app.doc.height } : localSize(n);
  const c = makeCanvas(w, hh);
  const g = c.getContext('2d');
  if (mode === 'selection' && app.doc.selection) {
    if (n.type === 'group') g.drawImage(app.doc.selection.mask, 0, 0);
    else g.drawImage(localSelection(app.doc, n), 0, 0);
  } else if (mode === 'reveal') { g.fillStyle = '#000'; g.fillRect(0, 0, w, hh); }
  const cmd = propCmd('Add Layer Mask', n, { mask: null, maskEnabled: n.maskEnabled }, { mask: { canvas: c, x: 0, y: 0 }, maskEnabled: true });
  cmd.redo();
  app.commit(cmd);
}
export function deleteMask(app) { const n = app.active; if (!n || !n.mask) return; const cmd = propCmd('Delete Layer Mask', n, { mask: n.mask }, { mask: null }); cmd.redo(); app.commit(cmd); }
export function toggleMask(app) { const n = app.active; if (!n || !n.mask) return; const cmd = propCmd(n.maskEnabled ? 'Disable Layer Mask' : 'Enable Layer Mask', n, { maskEnabled: n.maskEnabled }, { maskEnabled: !n.maskEnabled }); cmd.redo(); app.commit(cmd); }
export function invertMask(app) {
  const n = app.active; if (!n || !n.mask) return;
  const m = n.mask.canvas;
  const c = makeCanvas(m.width, m.height), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out'; g.drawImage(m, 0, 0);
  const cmd = propCmd('Invert Mask', n, { mask: n.mask }, { mask: { ...n.mask, canvas: c } }); cmd.redo(); app.commit(cmd);
}
export function applyMask(app) {
  const n = app.active; if (!n || !n.mask || n.type !== 'raster') { toast('Apply Mask works on pixel layers with a mask.'); return; }
  const c = makeCanvas(n.canvas.width, n.canvas.height), g = c.getContext('2d');
  g.drawImage(n.canvas, 0, 0);
  if (n.maskEnabled) { g.globalCompositeOperation = 'destination-in'; g.drawImage(n.mask.canvas, n.mask.x, n.mask.y); }
  const before = { canvas: n.canvas, mask: n.mask };
  const cmd = propCmd('Apply Layer Mask', n, before, { canvas: c, mask: null }); cmd.redo(); app.commit(cmd);
}

// ================================================================= selection

export function selectAll(app) { if (!need(app)) return; const d = app.doc, b = d.selection, a = selAll(d); d.selection = a; app.commit(selectionCmd(d, 'Select All', b, a)); }
export function deselect(app) { if (!need(app)) return; const d = app.doc; if (!d.selection) return; app.lastSelection = d.selection; const b = d.selection; d.selection = null; app.commit(selectionCmd(d, 'Deselect', b, null)); }
export function reselect(app) { if (!need(app) || !app.lastSelection) return; const d = app.doc, b = d.selection; d.selection = app.lastSelection; app.commit(selectionCmd(d, 'Reselect', b, d.selection)); }
export function invert(app) { if (!need(app)) return; const d = app.doc, b = d.selection, a = invertSelection(d, b); d.selection = a; app.commit(selectionCmd(d, 'Inverse', b, a)); }
export function selectLayerPixels(app, n = app.active) {
  if (!need(app) || !n) return;
  const d = app.doc, b = d.selection;
  const a = selectionFromCanvas(d, (g) => renderNode({ ...n, visible: true, opacity: 1, blend: 'normal' }, g, { width: d.width, height: d.height }));
  if (!a) { toast('That layer has no visible pixels.'); return; }
  d.selection = a;
  app.commit(selectionCmd(d, 'Load Selection', b, a));
}
export async function featherDialog(app) {
  if (!need(app) || !app.doc.selection) { toast('Make a selection first.'); return; }
  const v = await formDialog({ title: 'Feather selection', fields: [{ key: 'r', label: 'Feather radius', type: 'number', value: 8, min: 0, max: 250, suffix: 'px' }] });
  if (!v) return;
  const d = app.doc, b = d.selection, a = featherSelection(d, b, Math.max(0, v.r));
  d.selection = a;
  app.commit(selectionCmd(d, 'Feather', b, a));
}

// ================================================================= clipboard

async function copyPixels(app) {
  const d = app.doc, n = app.active;
  if (!n) return null;
  const c = makeCanvas(d.width, d.height), g = c.getContext('2d');
  renderNode({ ...n, visible: true, opacity: 1, blend: 'normal' }, g, { width: d.width, height: d.height });
  if (d.selection) { g.globalCompositeOperation = 'destination-in'; g.drawImage(d.selection.mask, 0, 0); }
  const t = trimCanvas(c);
  if (t.empty) return null;
  return { canvas: t.canvas, x: t.x, y: t.y, name: n.name };
}

export async function copy(app) {
  if (!need(app)) return;
  const clip = await copyPixels(app);
  if (!clip) { toast('Nothing to copy — the selected area is empty.'); return; }
  app.clipboard = clip;
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const blob = await new Promise((r) => clip.canvas.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
  } catch (e) { /* the internal clipboard still works */ }
  toast('Copied', { type: 'ok', timeout: 1200 });
}

export async function cut(app) {
  if (!need(app)) return;
  const n = app.active;
  if (!n || n.type !== 'raster') { toast('Cut works on pixel layers. Use Copy for other layers.'); return; }
  await copy(app);
  clearPixels(app, 'Cut');
}

export function pasteInternal(app) {
  if (!need(app)) return;
  const c = app.clipboard;
  if (!c) { toast('The clipboard is empty.'); return; }
  const n = makeNode('raster', { name: 'Pasted', canvas: makeCanvas(c.canvas.width, c.canvas.height) });
  n.canvas.getContext('2d').drawImage(c.canvas, 0, 0);
  n.x = c.x; n.y = c.y;
  app.insertNode(n, 'Paste');
}

export async function pasteFile(app, file) {
  try {
    const c = await loadImageFile(file);
    placeCanvas(app, c, 'Pasted image', 'Paste');
  } catch (e) { toast(e.message, { type: 'error' }); }
}

export function placeCanvas(app, c, name, label = 'Place') {
  const d = app.doc;
  const n = makeNode('raster', { name, canvas: c });
  const s = Math.min(1, d.width / c.width, d.height / c.height);
  n.sx = s; n.sy = s;
  n.x = Math.round((d.width - c.width) / 2); n.y = Math.round((d.height - c.height) / 2);
  app.insertNode(n, label);
  if (s < 1) toast(`Placed at ${Math.round(s * 100)}% to fit the canvas (transform to resize).`, { timeout: 3000 });
}

export async function paste(app) {
  if (!need(app)) return;
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) { const blob = await it.getType(type); await pasteFile(app, new File([blob], 'clipboard.png', { type })); return; }
      }
    }
  } catch (e) { /* permission denied → internal */ }
  pasteInternal(app);
}

function clearPixels(app, label) {
  const d = app.doc, n = app.active;
  const g = n.canvas.getContext('2d');
  const r = { x: 0, y: 0, w: n.canvas.width, h: n.canvas.height };
  const before = g.getImageData(0, 0, r.w, r.h);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  if (d.selection) g.drawImage(localSelection(d, n), 0, 0); else g.fillRect(0, 0, r.w, r.h);
  g.restore();
  app.commit(pixelCmd(label, n, r, before, g.getImageData(0, 0, r.w, r.h)));
}

export function clearOrDelete(app) {
  if (!app.doc) return;
  const n = app.active; if (!n) return;
  if (app.doc.selection && n.type === 'raster') {
    if (app.isLocked(n)) { toast('This layer is locked.', { type: 'warn' }); return; }
    clearPixels(app, 'Clear');
  } else deleteLayers(app);
}

export async function layerViaCopy(app, cutToo = false) {
  if (!need(app)) return;
  const d = app.doc, n = app.active;
  if (!d.selection || !n) { duplicate(app); return; }
  const clip = await copyPixels(app);
  if (!clip) { toast('The selected area is empty.'); return; }
  const cmds = [];
  if (cutToo && n.type === 'raster' && !app.isLocked(n)) {
    const g = n.canvas.getContext('2d');
    const r = { x: 0, y: 0, w: n.canvas.width, h: n.canvas.height };
    const before = g.getImageData(0, 0, r.w, r.h);
    g.save(); g.globalCompositeOperation = 'destination-out'; g.drawImage(localSelection(d, n), 0, 0); g.restore();
    cmds.push(pixelCmd('Cut', n, r, before, g.getImageData(0, 0, r.w, r.h)));
  }
  const nn = makeNode('raster', { name: n.name + (cutToo ? ' (cut)' : ' (copy)'), canvas: clip.canvas });
  nn.x = clip.x; nn.y = clip.y;
  const ins = treeCmd(d, 'x', () => { const f = findNode(d, n.id); f.arr.splice(f.index + 1, 0, nn); d.activeId = nn.id; });
  app.selectedIds = new Set([nn.id]);
  app.commit(compound(cutToo ? 'Layer via Cut' : 'Layer via Copy', [...cmds, ins]));
}
export function layerViaCut(app) { return layerViaCopy(app, true); }

// ================================================================= fill

export async function fillWith(app, color, label) {
  if (!need(app)) return;
  const node = await app.ensureRasterTarget(label);
  if (!node) return;
  const d = app.doc;
  const g = node.canvas.getContext('2d');
  const r = { x: 0, y: 0, w: node.canvas.width, h: node.canvas.height };
  const before = g.getImageData(0, 0, r.w, r.h);
  const tmp = makeCanvas(r.w, r.h), tg = tmp.getContext('2d');
  tg.fillStyle = color; tg.fillRect(0, 0, r.w, r.h);
  if (d.selection) { tg.globalCompositeOperation = 'destination-in'; tg.drawImage(localSelection(d, node), 0, 0); }
  g.drawImage(tmp, 0, 0);
  app.commit(pixelCmd(label, node, r, before, g.getImageData(0, 0, r.w, r.h)));
}
export async function fillDialog(app) {
  if (!need(app)) return;
  const v = await formDialog({ title: 'Fill', fields: [
    { key: 'use', label: 'Contents', type: 'select', value: 'fg', options: [{ value: 'fg', label: 'Foreground colour' }, { value: 'bg', label: 'Background colour' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'custom', label: 'Custom…' }] },
    { key: 'color', label: 'Custom colour', type: 'color', value: app.fg },
  ] });
  if (!v) return;
  const c = { fg: app.fg, bg: app.bg, white: '#ffffff', black: '#000000', custom: v.color }[v.use];
  fillWith(app, c, 'Fill');
}

// ================================================================= image-wide

export async function imageSizeDialog(app) {
  if (!need(app)) return;
  const d = app.doc;
  const ratio = d.width / d.height;
  let lock = true;
  const v = await formDialog({
    title: 'Image size', ok: 'Resize',
    fields: [
      { key: 'w', label: 'Width', type: 'number', value: d.width, min: 1, max: MAX_SIDE, suffix: 'px' },
      { key: 'h', label: 'Height', type: 'number', value: d.height, min: 1, max: MAX_SIDE, suffix: 'px' },
      { key: 'lock', label: 'Constrain proportions', type: 'checkbox', value: true },
      { key: 'quality', label: 'Resample', type: 'select', value: 'high', options: [{ value: 'high', label: 'Smooth (bicubic-like)' }, { value: 'pixelated', label: 'Nearest neighbour (hard edges)' }] },
    ],
    onChange: (vals) => {
      lock = vals.lock;
      const dlg = document.querySelector('.studio-dialog');
      const [wi, hi] = dlg.querySelectorAll('input[type=number]');
      if (!lock) return;
      if (document.activeElement === wi) hi.value = Math.max(1, Math.round(vals.w / ratio));
      else if (document.activeElement === hi) wi.value = Math.max(1, Math.round(vals.h * ratio));
    },
  });
  if (!v) return;
  const W = Math.round(v.w), H = Math.round(v.h);
  if (!(W > 0 && H > 0) || W > MAX_SIDE || H > MAX_SIDE || W * H > MAX_AREA) { toast(`Size must be at most ${MAX_SIDE} px per side and ${MAX_AREA / 1e6} MP.`, { type: 'error' }); return; }
  if (W === d.width && H === d.height) return;
  const kx = W / d.width, ky = H / d.height;
  app.commit(stateCmd(d, 'Image Size', () => {
    walk(d.layers, (n) => {
      if (n.type === 'group') { if (n.mask) n.mask = resampleMask(n.mask, kx, ky, v.quality); return; }
      n.x *= kx; n.y *= ky;
      if (n.type === 'raster') {
        const c = makeCanvas(Math.max(1, Math.round(n.canvas.width * kx)), Math.max(1, Math.round(n.canvas.height * ky)));
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = v.quality !== 'pixelated'; g.imageSmoothingQuality = 'high';
        g.drawImage(n.canvas, 0, 0, c.width, c.height);
        n.canvas = c;
      } else if (n.type === 'text') { n.size *= Math.sqrt(kx * ky); n.sx *= kx / Math.sqrt(kx * ky); n.sy *= ky / Math.sqrt(kx * ky); }
      else if (n.type === 'shape') {
        n.w *= kx; n.h *= ky; n.strokeWidth *= Math.sqrt(kx * ky); n.radius *= Math.sqrt(kx * ky);
        const sc = (p) => ({ x: p.x * kx, y: p.y * ky, ix: p.ix * kx, iy: p.iy * ky, ox: p.ox * kx, oy: p.oy * ky });
        if (n.points) n.points = n.points.map(sc);
        if (n.subpaths) n.subpaths = n.subpaths.map((sp) => ({ closed: sp.closed, points: sp.points.map(sc) }));
      }
      if (n.mask) n.mask = resampleMask(n.mask, kx, ky, v.quality);
      delete n._layout;
    });
    d.width = W; d.height = H;
    for (const g of d.guides) g.pos *= g.axis === 'x' ? kx : ky;
    d.selection = null;
  }));
  app.docResized();
}
function resampleMask(m, kx, ky, q) {
  const c = makeCanvas(Math.max(1, Math.round(m.canvas.width * kx)), Math.max(1, Math.round(m.canvas.height * ky)));
  const g = c.getContext('2d'); g.imageSmoothingEnabled = q !== 'pixelated';
  g.drawImage(m.canvas, 0, 0, c.width, c.height);
  return { canvas: c, x: m.x * kx, y: m.y * ky };
}

export async function canvasSizeDialog(app) {
  if (!need(app)) return;
  const d = app.doc;
  let anchor = 'c';
  const grid = h('div', { class: 'img-anchor', role: 'radiogroup', 'aria-label': 'Anchor' });
  ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'].forEach((a) => {
    const b = h('button', { type: 'button', class: 'img-anchor-cell' + (a === anchor ? ' is-on' : ''), 'aria-label': 'Anchor ' + a, onclick: () => { anchor = a; grid.querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b)); } });
    grid.appendChild(b);
  });
  const wI = h('input', { class: 'studio-input is-num', type: 'number', value: d.width, min: 1, max: MAX_SIDE });
  const hI = h('input', { class: 'studio-input is-num', type: 'number', value: d.height, min: 1, max: MAX_SIDE });
  const body = h('div', { class: 'studio-form' },
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Width (px)' }), wI),
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Height (px)' }), hI),
    h('div', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Anchor' }), grid));
  const ok = await dialog({ title: 'Canvas size', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Resize canvas', value: true, primary: true }] });
  if (!ok) return;
  const W = Math.round(Number(wI.value)), H = Math.round(Number(hI.value));
  if (!(W > 0 && H > 0) || W > MAX_SIDE || H > MAX_SIDE || W * H > MAX_AREA) { toast('Invalid canvas size.', { type: 'error' }); return; }
  const fx = anchor.includes('l') ? 0 : anchor.includes('r') ? 1 : 0.5;
  const fy = anchor.includes('t') ? 0 : anchor.includes('b') ? 1 : 0.5;
  const dx = Math.round((W - d.width) * fx), dy = Math.round((H - d.height) * fy);
  app.commit(stateCmd(d, 'Canvas Size', () => {
    walk(d.layers, (n) => { if (n.type !== 'group') { n.x += dx; n.y += dy; } });
    d.width = W; d.height = H;
    for (const g of d.guides) g.pos += g.axis === 'x' ? dx : dy;
    d.selection = null;
  }));
  app.docResized();
}

export function rotateCanvas(app, deg) {
  if (!need(app)) return;
  const d = app.doc;
  const W = d.width, H = d.height;
  const nW = deg === 180 ? W : H, nH = deg === 180 ? H : W;
  const mapPt = (x, y) => deg === 90 ? { x: H - y, y: x } : deg === -90 ? { x: y, y: W - x } : { x: W - x, y: H - y };
  app.commit(stateCmd(d, deg === 180 ? 'Rotate 180°' : deg === 90 ? 'Rotate 90° Clockwise' : 'Rotate 90° Counter-clockwise', () => {
    walk(d.layers, (n) => {
      if (n.type === 'group') { if (n.mask) n.mask = rotateMask(n.mask, deg, W, H); return; }
      const { w, h: hh } = localSize(n);
      const c = { x: n.x + w / 2, y: n.y + hh / 2 };
      const nc = mapPt(c.x, c.y);
      if (n.type === 'raster' && isIdentity(n)) {
        const rc = makeCanvas(deg === 180 ? w : hh, deg === 180 ? hh : w);
        const g = rc.getContext('2d');
        g.translate(rc.width / 2, rc.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(n.canvas, -w / 2, -hh / 2);
        n.canvas = rc;
        if (n.mask) n.mask = rotateMask(n.mask, deg, w, hh);
        n.x = nc.x - rc.width / 2; n.y = nc.y - rc.height / 2;
      } else {
        n.rot = ((n.rot + deg + 540) % 360) - 180;
        n.x = nc.x - w / 2; n.y = nc.y - hh / 2;
      }
    });
    d.width = nW; d.height = nH;
    d.guides = d.guides.map((g) => {
      if (deg === 180) return { axis: g.axis, pos: g.axis === 'x' ? W - g.pos : H - g.pos };
      if (deg === 90) return g.axis === 'x' ? { axis: 'y', pos: g.pos } : { axis: 'x', pos: H - g.pos };
      return g.axis === 'x' ? { axis: 'y', pos: W - g.pos } : { axis: 'x', pos: g.pos };
    });
    d.selection = null;
  }));
  app.docResized();
}
function rotateMask(m, deg, lw, lh) {
  const c = m.canvas;
  const rc = makeCanvas(deg === 180 ? c.width : c.height, deg === 180 ? c.height : c.width);
  const g = rc.getContext('2d');
  g.translate(rc.width / 2, rc.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(c, -c.width / 2, -c.height / 2);
  // mask origin relative to layer: rotate its rect around the layer centre
  const cx = m.x + c.width / 2 - lw / 2, cy = m.y + c.height / 2 - lh / 2;
  const r = deg === 90 ? { x: -cy, y: cx } : deg === -90 ? { x: cy, y: -cx } : { x: -cx, y: -cy };
  const nlw = deg === 180 ? lw : lh, nlh = deg === 180 ? lh : lw;
  return { canvas: rc, x: r.x + nlw / 2 - rc.width / 2, y: r.y + nlh / 2 - rc.height / 2 };
}

export function flipCanvas(app, axis) {
  if (!need(app)) return;
  const d = app.doc, W = d.width, H = d.height;
  app.commit(stateCmd(d, axis === 'h' ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical', () => {
    walk(d.layers, (n) => {
      if (n.type === 'group') { if (n.mask) n.mask = flipMask(n.mask, axis, W, H); return; }
      const { w, h: hh } = localSize(n);
      if (n.type === 'raster' && isIdentity(n)) {
        const c = makeCanvas(w, hh), g = c.getContext('2d');
        if (axis === 'h') { g.translate(w, 0); g.scale(-1, 1); } else { g.translate(0, hh); g.scale(1, -1); }
        g.drawImage(n.canvas, 0, 0);
        n.canvas = c;
        if (n.mask) n.mask = flipMask(n.mask, axis, w, hh);
      } else {
        if (axis === 'h') { n.sx = -n.sx; n.rot = -n.rot; } else { n.sy = -n.sy; n.rot = -n.rot; }
      }
      if (axis === 'h') n.x = W - (n.x + w); else n.y = H - (n.y + hh);
    });
    for (const g of d.guides) if ((axis === 'h' && g.axis === 'x') || (axis === 'v' && g.axis === 'y')) g.pos = (axis === 'h' ? W : H) - g.pos;
    d.selection = null;
  }));
  app.docResized();
}
function flipMask(m, axis, lw, lh) {
  const c = makeCanvas(m.canvas.width, m.canvas.height), g = c.getContext('2d');
  if (axis === 'h') { g.translate(c.width, 0); g.scale(-1, 1); } else { g.translate(0, c.height); g.scale(1, -1); }
  g.drawImage(m.canvas, 0, 0);
  return axis === 'h' ? { canvas: c, x: lw - (m.x + c.width), y: m.y } : { canvas: c, x: m.x, y: lh - (m.y + c.height) };
}

export function flipLayer(app, axis) {
  const n = app.active; if (!n || n.type === 'group') return;
  if (app.isLocked(n)) { toast('This layer is locked.', { type: 'warn' }); return; }
  const before = { sx: n.sx, sy: n.sy };
  const after = axis === 'h' ? { sx: -n.sx, sy: n.sy } : { sx: n.sx, sy: -n.sy };
  Object.assign(n, after);
  app.commit(propCmd(axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical', n, before, after));
}

export function cropToSelection(app) {
  if (!need(app)) return;
  const d = app.doc;
  if (!d.selection) { toast('Make a selection first.'); return; }
  const R = roundRect(d.selection.bounds);
  const r = intersectRect(R, { x: 0, y: 0, w: d.width, h: d.height });
  if (!r) return;
  app.commit(stateCmd(d, 'Crop to Selection', () => {
    walk(d.layers, (n) => { if (n.type !== 'group') { n.x -= r.x; n.y -= r.y; } });
    for (const g of d.guides) g.pos -= g.axis === 'x' ? r.x : r.y;
    d.width = r.w; d.height = r.h; d.selection = null;
  }));
  app.docResized();
}

// ================================================================= adjustments & filters

export const ADJUSTMENTS = {
  brightnessContrast: { label: 'Brightness / Contrast', fields: [{ key: 'brightness', label: 'Brightness', type: 'range', min: -150, max: 150, value: 0 }, { key: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100, value: 0 }] },
  hueSaturation: { label: 'Hue / Saturation', fields: [{ key: 'hue', label: 'Hue', type: 'range', min: -180, max: 180, value: 0, unit: '°' }, { key: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0 }, { key: 'lightness', label: 'Lightness', type: 'range', min: -100, max: 100, value: 0 }] },
  exposure: { label: 'Exposure', fields: [{ key: 'exposure', label: 'Exposure', type: 'range', min: -5, max: 5, step: 0.05, value: 0, format: (v) => v.toFixed(2) }, { key: 'offset', label: 'Offset', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: 0, format: (v) => v.toFixed(2) }, { key: 'gamma', label: 'Gamma', type: 'range', min: 0.1, max: 3, step: 0.01, value: 1, format: (v) => v.toFixed(2) }] },
  threshold: { label: 'Threshold', fields: [{ key: 'level', label: 'Level', type: 'range', min: 1, max: 255, value: 128 }] },
  posterize: { label: 'Posterize', fields: [{ key: 'levels', label: 'Levels', type: 'range', min: 2, max: 32, value: 4 }] },
  sepia: { label: 'Sepia', fields: [{ key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, value: 80, unit: '%' }] },
  gaussianBlur: { label: 'Gaussian Blur', fields: [{ key: 'radius', label: 'Radius', type: 'range', min: 0.5, max: 100, step: 0.5, value: 6, unit: ' px' }] },
  sharpen: { label: 'Sharpen', fields: [{ key: 'amount', label: 'Amount', type: 'range', min: 1, max: 300, value: 80, unit: '%' }, { key: 'radius', label: 'Radius', type: 'range', min: 0.5, max: 10, step: 0.1, value: 1.5, unit: ' px' }] },
  noise: { label: 'Add Noise', fields: [{ key: 'amount', label: 'Amount', type: 'range', min: 1, max: 100, value: 12, unit: '%' }, { key: 'mono', label: 'Monochromatic', type: 'checkbox', value: true }] },
  pixelate: { label: 'Mosaic', fields: [{ key: 'size', label: 'Cell size', type: 'range', min: 2, max: 200, value: 16, unit: ' px' }] },
  vignette: { label: 'Vignette', fields: [{ key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, value: 55, unit: '%' }, { key: 'size', label: 'Midpoint', type: 'range', min: 0, max: 95, value: 45, unit: '%' }] },
  emboss: { label: 'Emboss', fields: [] },
  findEdges: { label: 'Find Edges', fields: [] },
  invert: { label: 'Invert', fields: [] },
  desaturate: { label: 'Desaturate', fields: [] },
};

async function pixelOp(app, op, params, { preview = true } = {}) {
  const def = ADJUSTMENTS[op];
  const node = await app.ensureRasterTarget(def.label);
  if (!node) return null;
  const d = app.doc;
  const W = node.canvas.width, H = node.canvas.height;
  if (W * H > 64e6) { toast('This layer is too large to filter in the browser.', { type: 'error' }); return null; }
  const g = node.canvas.getContext('2d', { willReadFrequently: true });
  const orig = g.getImageData(0, 0, W, H);
  const selC = localSelection(d, node);
  const mask = selC ? selC.getContext('2d').getImageData(0, 0, W, H).data : null;
  const run = async (p) => {
    let out = await runFilter(op, orig, p);
    if (mask) out = await runFilter('maskMix', out, { orig: orig.data.slice().buffer, mask: mask.slice().buffer });
    return out;
  };
  return { node, g, orig, run, W, H, label: def.label };
}

export async function adjust(app, op) {
  if (!need(app)) return;
  const def = ADJUSTMENTS[op];
  const ctx = await pixelOp(app, op);
  if (!ctx) return;
  const preview = makeCanvas(ctx.W, ctx.H);
  let token = 0, lastParams = Object.fromEntries(def.fields.map((f) => [f.key, f.value]));
  const update = async (p) => {
    const my = ++token;
    try {
      const out = await ctx.run(p);
      if (my !== token) return;
      preview.getContext('2d').putImageData(out, 0, 0);
      app.setLive({ nodeId: ctx.node.id, draw: (c) => c.drawImage(preview, 0, 0) });
    } catch (e) { toast(e.message, { type: 'error' }); }
  };
  if (!def.fields.length) {
    const out = await ctx.run({});
    return finishPixelOp(app, ctx, out, def.label, op, {});
  }
  let timer = 0;
  update(lastParams);
  const v = await formDialog({
    title: def.label, ok: 'Apply', fields: def.fields,
    intro: app.doc.selection ? 'Applies inside the current selection.' : null,
    onChange: (vals) => { lastParams = vals; clearTimeout(timer); timer = setTimeout(() => update(vals), 90); },
  });
  clearTimeout(timer); token++;
  if (!v) { app.setLive(null); return; }
  const out = await ctx.run(v);
  finishPixelOp(app, ctx, out, def.label, op, v);
}

function finishPixelOp(app, ctx, out, label, op, params) {
  app.setLive(null);
  ctx.g.putImageData(out, 0, 0);
  app.commit(pixelCmd(label, ctx.node, { x: 0, y: 0, w: ctx.W, h: ctx.H }, ctx.orig, out));
  app.lastFilter = { op, params };
}

export async function quickOp(app, op) {
  if (!need(app)) return;
  const ctx = await pixelOp(app, op); if (!ctx) return;
  const out = await ctx.run({});
  finishPixelOp(app, ctx, out, ADJUSTMENTS[op].label, op, {});
}

export async function repeatFilter(app) {
  if (!app.lastFilter) { toast('No filter used yet.'); return; }
  const { op, params } = app.lastFilter;
  const ctx = await pixelOp(app, op); if (!ctx) return;
  finishPixelOp(app, ctx, await ctx.run(params), ADJUSTMENTS[op].label, op, params);
}

// ================================================================= view

export function toggleGrid(app) { app.view.showGrid = !app.view.showGrid; setSetting('showRulersGrid', app.view.showGrid); app.view.requestDraw(); }
export function toggleGuides(app) { app.view.showGuides = !app.view.showGuides; app.view.requestDraw(); }
export function toggleSnap(app) { app.view.snap = !app.view.snap; toast(app.view.snap ? 'Snapping on' : 'Snapping off', { timeout: 1000 }); }
export async function newGuideDialog(app) {
  if (!need(app)) return;
  const v = await formDialog({ title: 'New guide', fields: [
    { key: 'axis', label: 'Orientation', type: 'select', value: 'x', options: [{ value: 'x', label: 'Vertical' }, { value: 'y', label: 'Horizontal' }] },
    { key: 'pos', label: 'Position', type: 'number', value: Math.round(app.doc.width / 2), suffix: 'px' },
  ] });
  if (!v) return;
  const d = app.doc, before = d.guides.map((g) => ({ ...g }));
  d.guides.push({ axis: v.axis, pos: Number(v.pos) || 0 });
  const after = d.guides.map((g) => ({ ...g }));
  app.view.showGuides = true;
  app.commit({ label: 'New Guide', undo: () => { d.guides = before.map((g) => ({ ...g })); }, redo: () => { d.guides = after.map((g) => ({ ...g })); } });
}
export function clearGuides(app) {
  if (!need(app) || !app.doc.guides.length) return;
  const d = app.doc, before = d.guides.map((g) => ({ ...g }));
  d.guides = [];
  app.commit({ label: 'Clear Guides', undo: () => { d.guides = before.map((g) => ({ ...g })); }, redo: () => { d.guides = []; } });
}
export function fullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('Fullscreen is not available here.'));
  else toast('Fullscreen is not supported by this browser.');
}
export function togglePanels(app) {
  const on = !app.root.classList.contains('is-panels-hidden');
  app.root.classList.toggle('is-panels-hidden', on);
  setTimeout(() => app.view.resize(), 50);
}
export function brushSize(app, dir) {
  const t = app.tool; if (!t || !['brush', 'eraser', 'clone'].includes(t.id)) return;
  const o = app.opt(t.id);
  const s = o.size;
  o.size = Math.max(1, Math.min(800, Math.round(dir > 0 ? s * 1.15 + 1 : s / 1.15 - 1)));
  app.renderOptions();
  app.view.requestDraw();
}
export { flatten, drawContent, matrixArgs, nodeMatrix, nodeBounds, getSettings, progressDialog };
