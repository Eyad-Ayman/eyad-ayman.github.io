// EYAD IMAGE — history (undo/redo) built on reversible commands.
// Commands store *what changed* (property diffs, pixel patches of the
// touched rectangle, tree shape references) — never whole-canvas screenshots.
import { walk } from './doc.js';

export { History } from '../core/history.js';

// ---------------------------------------------------------------- command builders

export function compound(label, cmds, extra = {}) {
  cmds = cmds.filter(Boolean);
  if (!cmds.length) return null;
  if (cmds.length === 1 && !extra.icon) { cmds[0].label = label; return cmds[0]; }
  return {
    label, ...extra,
    bytes: cmds.reduce((a, c) => a + (c.bytes || 0), 0),
    undo() { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo(); },
    redo() { for (const c of cmds) c.redo(); },
  };
}

/** Property change on one node. before/after are partial objects. */
export function propCmd(label, node, before, after, { coalesce, onApply } = {}) {
  const apply = (vals) => { Object.assign(node, vals); delete node._layout; node._dirtyThumb = true; onApply && onApply(); };
  const cmd = {
    label, coalesce: coalesce ? coalesce + ':' + node.id : null,
    undo: () => apply(before),
    redo: () => apply(after),
    merge(next) {
      // keep our "before", take next "after"
      if (!next._node || next._node !== node) return false;
      Object.assign(after, next._after);
      return true;
    },
    _node: node, _after: after,
  };
  return cmd;
}

/** Change several nodes' props at once (e.g. moving a group's children). */
export function multiPropCmd(label, entries, { coalesce } = {}) {
  // entries: [{ node, before, after }]
  const apply = (key) => { for (const e of entries) { Object.assign(e.node, e[key]); delete e.node._layout; e.node._dirtyThumb = true; } };
  return { label, coalesce, undo: () => apply('before'), redo: () => apply('after'), merge: () => false };
}

/** Pixel patch: stores before/after ImageData of the touched rectangle only. */
export function pixelCmd(label, node, rect, before, after, target = 'canvas') {
  const getCanvas = () => (target === 'mask' ? node.mask.canvas : node.canvas);
  return {
    label,
    bytes: before.data.length + after.data.length,
    undo() { getCanvas().getContext('2d').putImageData(before, rect.x, rect.y); node._dirtyThumb = true; },
    redo() { getCanvas().getContext('2d').putImageData(after, rect.x, rect.y); node._dirtyThumb = true; },
  };
}

/** Replace a raster layer's backing canvas (resizing, expanding). */
export function replaceCanvasCmd(label, node, newCanvas, newX, newY) {
  const old = { canvas: node.canvas, x: node.x, y: node.y };
  const nw = { canvas: newCanvas, x: newX, y: newY };
  Object.assign(node, nw);
  node._dirtyThumb = true;
  return {
    label, bytes: newCanvas.width * newCanvas.height * 4,
    undo() { Object.assign(node, old); node._dirtyThumb = true; },
    redo() { Object.assign(node, nw); node._dirtyThumb = true; },
  };
}

/** Snapshot of the tree structure: arrays of node references (cheap). */
export function snapTree(doc) {
  const groups = new Map();
  walk(doc.layers, (n) => { if (n.type === 'group') groups.set(n, n.children.slice()); });
  return { root: doc.layers.slice(), groups, activeId: doc.activeId };
}
export function restoreTree(doc, s) {
  doc.layers = s.root.slice();
  for (const [g, ch] of s.groups) g.children = ch.slice();
  doc.activeId = s.activeId;
}
/** Run mutate() and record the structural change. */
export function treeCmd(doc, label, mutate) {
  const before = snapTree(doc);
  mutate();
  const after = snapTree(doc);
  return {
    label,
    undo: () => restoreTree(doc, before),
    redo: () => restoreTree(doc, after),
  };
}

/** Full state snapshot of every node's own fields + doc size (for resample/rotate/crop). */
const SKIP = new Set(['children', '_layout', '_thumb', '_dirtyThumb']);
export function snapState(doc) {
  const nodes = new Map();
  walk(doc.layers, (n) => {
    const o = {};
    for (const k of Object.keys(n)) if (!SKIP.has(k)) o[k] = k === 'points' && n.points ? n.points.map((p) => ({ ...p })) : k === 'subpaths' && n.subpaths ? n.subpaths.map((sp) => ({ closed: sp.closed, points: sp.points.map((p) => ({ ...p })) })) : k === 'mask' && n.mask ? { ...n.mask } : n[k];
    nodes.set(n, o);
  });
  return { w: doc.width, h: doc.height, nodes, tree: snapTree(doc), guides: doc.guides.map((g) => ({ ...g })), selection: doc.selection };
}
export function restoreState(doc, s) {
  doc.width = s.w; doc.height = s.h;
  restoreTree(doc, s.tree);
  for (const [n, o] of s.nodes) {
    for (const k of Object.keys(n)) if (!SKIP.has(k) && !(k in o)) delete n[k];
    Object.assign(n, o, o.points ? { points: o.points.map((p) => ({ ...p })) } : {}, o.subpaths ? { subpaths: o.subpaths.map((sp) => ({ closed: sp.closed, points: sp.points.map((p) => ({ ...p })) })) } : {});
    delete n._layout; n._dirtyThumb = true;
  }
  doc.guides = s.guides.map((g) => ({ ...g }));
  doc.selection = s.selection;
}
export function stateCmd(doc, label, mutate) {
  const before = snapState(doc);
  mutate();
  const after = snapState(doc);
  let bytes = 0;
  for (const [n, o] of after.nodes) if (o.canvas && o.canvas !== before.nodes.get(n)?.canvas) bytes += o.canvas.width * o.canvas.height * 4;
  return { label, bytes, undo: () => restoreState(doc, before), redo: () => restoreState(doc, after), resized: true };
}

export function selectionCmd(doc, label, before, after) {
  return { label, undo: () => { doc.selection = before; }, redo: () => { doc.selection = after; }, selection: true };
}
