// EYAD IMAGE — artboards: several designs (post, story, banner…) in one
// document. An artboard is a top-level group with a frame { x, y, w, h, bg };
// its contents are clipped to the frame and it exports on its own.
import { h } from '../core/dom.js';
import { dialog, toast, formDialog } from '../core/ui.js';
import { downloadBlob, sanitizeFilename } from '../core/files.js';
import { makeNode, walk, makeCanvas, canvasToBlob } from './doc.js';
import { stateCmd } from './history.js';
import { renderDoc } from './render.js';

const GAP = 120;
const PRESETS = [['doc', 'Same as document'], ['1080x1080', 'Instagram post 1080 × 1080'], ['1080x1350', 'Portrait 4:5 1080 × 1350'], ['1080x1920', 'Story / Reel 1080 × 1920'], ['1920x1080', 'Desktop / Full HD 1920 × 1080'], ['1280x720', 'YouTube thumbnail 1280 × 720'], ['1500x500', 'Header / banner 1500 × 500'], ['2480x3508', 'A4 @300 dpi'], ['390x844', 'Phone screen 390 × 844'], ['custom', 'Custom…']];

export const artboardsOf = (doc) => (doc ? doc.layers.filter((n) => n.type === 'group' && n.artboard) : []);

export async function newArtboardDialog(app) {
  const d = app.doc; if (!d) { toast('Open or create an image first.'); return; }
  const list = artboardsOf(d);
  const v = await formDialog({ title: 'New artboard', ok: 'Create', fields: [
    { key: 'name', label: 'Name', type: 'text', value: 'Artboard ' + (list.length + (list.length ? 1 : 2)), maxLength: 80 },
    { key: 'preset', label: 'Size', type: 'select', value: list.length ? '1080x1080' : 'doc', options: PRESETS.map(([value, label]) => ({ value, label })) },
    { key: 'w', label: 'Width (custom)', type: 'number', value: 1080, min: 16, max: 16000, suffix: 'px' },
    { key: 'h', label: 'Height (custom)', type: 'number', value: 1080, min: 16, max: 16000, suffix: 'px' },
    { key: 'bg', label: 'Background', type: 'select', value: 'white', options: [{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'transparent', label: 'Transparent' }] },
    { type: 'note', label: list.length ? 'The new artboard is placed to the right; the canvas grows to hold it.' : 'Your current layers become the first artboard, and the new one is placed to its right.' },
  ] });
  if (!v) return;
  let W, H;
  if (v.preset === 'doc') { W = d.width; H = d.height; } else if (v.preset === 'custom') { W = v.w; H = v.h; } else [W, H] = v.preset.split('x').map(Number);
  W = Math.max(16, Math.min(16000, Math.round(W))); H = Math.max(16, Math.min(16000, Math.round(H)));
  const bg = v.bg === 'white' ? '#ffffff' : v.bg === 'black' ? '#000000' : null;
  let created = null;
  app.commit(stateCmd(d, 'New Artboard', () => {
    if (!artboardsOf(d).length) {
      // wrap the existing document into Artboard 1
      const g = makeNode('group', { name: 'Artboard 1', blend: 'pass-through' });
      g.children = d.layers.splice(0, d.layers.length);
      g.artboard = { x: 0, y: 0, w: d.width, h: d.height, bg: null };
      d.layers.push(g);
    }
    const abs = artboardsOf(d);
    const right = Math.max(...abs.map((a) => a.artboard.x + a.artboard.w));
    const x = right + GAP, y = 0;
    const g = makeNode('group', { name: String(v.name || 'Artboard').slice(0, 80), blend: 'pass-through' });
    g.children = [];
    g.artboard = { x, y, w: W, h: H, bg };
    d.layers.push(g);
    d.width = Math.min(30000, x + W); d.height = Math.min(30000, Math.max(d.height, y + H));
    d.activeId = g.id; created = g;
  }));
  app.docResized && app.docResized();
  app.view && app.view.fit && app.view.fit();
  if (created) toast(`${created.name} — ${W} × ${H}`, { type: 'ok', timeout: 1800 });
}

/** Render one artboard to a canvas (its own size). */
export function renderArtboard(doc, ab, scale = 1) {
  const a = ab.artboard;
  const c = makeCanvas(Math.max(1, Math.round(a.w * scale)), Math.max(1, Math.round(a.h * scale)));
  const g = c.getContext('2d');
  g.setTransform(scale, 0, 0, scale, -a.x * scale, -a.y * scale);
  // only this artboard (plus layers outside any artboard) is drawn
  renderDoc({ ...doc, layers: doc.layers.filter((n) => n === ab || !n.artboard) }, g);
  return c;
}

export async function exportArtboards(app) {
  const d = app.doc; const list = artboardsOf(d);
  if (!list.length) { toast('This document has no artboards. Use Layer ▸ New Artboard… first.'); return; }
  const v = await formDialog({ title: `Export ${list.length} artboard${list.length === 1 ? '' : 's'}`, ok: 'Export', fields: [
    { key: 'fmt', label: 'Format', type: 'select', value: 'png', options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }] },
    { key: 'scale', label: 'Scale', type: 'select', value: '1', options: ['0.5', '1', '2', '3'].map((s) => ({ value: s, label: s + '×' })) },
    { key: 'zip', label: 'Pack into one .zip', type: 'checkbox', value: list.length > 1 },
  ] });
  if (!v) return;
  const scale = Number(v.scale) || 1;
  const files = [];
  for (const ab of list) {
    const c = renderArtboard(d, ab, scale);
    let out = c;
    if (v.fmt === 'jpeg') { out = makeCanvas(c.width, c.height); const g = out.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(c, 0, 0); }
    const blob = await canvasToBlob(out, 'image/' + v.fmt, 0.92);
    files.push([sanitizeFilename(ab.name) + '.' + (v.fmt === 'jpeg' ? 'jpg' : v.fmt), blob]);
  }
  if (v.zip && files.length > 1) {
    const { zipSync } = await import('../../vendor/fflate/fflate.js');
    const entries = {};
    for (const [n, b] of files) entries[uniqueName(entries, n)] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
    downloadBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), sanitizeFilename(d.name || 'artboards') + '-artboards.zip');
  } else for (const [n, b] of files) downloadBlob(b, n);
  toast(`Exported ${files.length} artboard${files.length === 1 ? '' : 's'}`, { type: 'ok' });
}
function uniqueName(map, n) { let k = n, i = 2; while (map[k]) k = n.replace(/(\.\w+)$/, `-${i++}$1`); return k; }

/** Artboard containing a doc point (used by tools that need a frame). */
export function artboardAt(doc, x, y) { return artboardsOf(doc).find((a) => x >= a.artboard.x && y >= a.artboard.y && x <= a.artboard.x + a.artboard.w && y <= a.artboard.y + a.artboard.h) || null; }
export { walk };
