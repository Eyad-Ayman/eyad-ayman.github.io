// EYAD IMAGE — Select ▸ Modify (Expand, Contract, Smooth, Border) and Color Range.
import { toast, formDialog } from '../core/ui.js';
import { makeCanvas } from './doc.js';
import { selectionFromCanvas } from './selection.js';
import { selectionCmd } from './history.js';

function morph(mask, r) {
  // grow the white area of an alpha mask by r px (disc)
  const c = makeCanvas(mask.width, mask.height), g = c.getContext('2d');
  const steps = Math.min(64, Math.max(12, Math.round(r * 1.6)));
  for (const rr of r > 6 ? [r, r * 0.5] : [r]) for (let i = 0; i < steps; i++) { const t = i / steps * Math.PI * 2; g.drawImage(mask, Math.cos(t) * rr, Math.sin(t) * rr); }
  g.drawImage(mask, 0, 0);
  return c;
}
function inverted(mask) { const c = makeCanvas(mask.width, mask.height), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'destination-out'; g.drawImage(mask, 0, 0); return c; }
function threshold(mask, blur) {
  const c = makeCanvas(mask.width, mask.height), g = c.getContext('2d', { willReadFrequently: true });
  g.filter = `blur(${blur}px)`; g.drawImage(mask, 0, 0); g.filter = 'none';
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
  g.putImageData(img, 0, 0);
  return c;
}

export async function modifySelection(app, kind) {
  const d = app.doc;
  if (!d || !d.selection) { toast('Make a selection first.'); return; }
  const titles = { expand: 'Expand selection', contract: 'Contract selection', smooth: 'Smooth selection', border: 'Border selection' };
  const v = await formDialog({ title: titles[kind], fields: [{ key: 'r', label: kind === 'smooth' ? 'Sample radius' : kind === 'border' ? 'Width' : 'By', type: 'number', value: kind === 'border' ? 10 : 8, min: 1, max: 500, suffix: 'px' }] });
  if (!v) return;
  const r = Math.max(1, +v.r), m = d.selection.mask;
  let out;
  if (kind === 'expand') out = morph(m, r);
  else if (kind === 'contract') out = inverted(morph(inverted(m), r));
  else if (kind === 'smooth') out = threshold(m, r);
  else { const big = morph(m, r / 2), small = inverted(morph(inverted(m), r / 2)); const g = big.getContext('2d'); g.globalCompositeOperation = 'destination-out'; g.drawImage(small, 0, 0); out = big; }
  const b = d.selection, a = selectionFromCanvas(d, (g) => g.drawImage(out, 0, 0));
  d.selection = a.empty ? null : a;
  app.commit(selectionCmd(d, titles[kind].replace(' selection', ''), b, d.selection));
}

/** Select ▸ Color Range: everything close to the foreground colour (pick it with the Eyedropper first). */
export async function colorRange(app) {
  const d = app.doc; if (!d) return;
  const v = await formDialog({ title: 'Color Range', fields: [
    { type: 'note', label: 'Selects every pixel close to the foreground colour. Pick the colour with the Eyedropper (I) first.' },
    { key: 'color', label: 'Colour', type: 'color', value: app.fg },
    { key: 'fuzz', label: 'Fuzziness', type: 'number', value: 40, min: 0, max: 200 },
    { key: 'all', label: 'Sample all layers', type: 'checkbox', value: true },
    { key: 'mode', label: 'Mode', type: 'select', value: 'new', options: [['new', 'New selection'], ['add', 'Add'], ['subtract', 'Subtract']] },
  ] });
  if (!v) return;
  const hex = /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : app.fg;
  const tr = parseInt(hex.slice(1, 3), 16), tg = parseInt(hex.slice(3, 5), 16), tb = parseInt(hex.slice(5, 7), 16);
  const c = makeCanvas(d.width, d.height), g = c.getContext('2d', { willReadFrequently: true });
  if (v.all || !app.active || !app.active.canvas) { app.view.updateComposite(); g.drawImage(app.view.comp, 0, 0); } else { const n = app.active; g.drawImage(n.canvas, n.x || 0, n.y || 0); }
  const img = g.getImageData(0, 0, d.width, d.height), px = img.data;
  const fz = Math.max(1, +v.fuzz) * 1.6;
  for (let i = 0; i < px.length; i += 4) {
    const dist = Math.sqrt((px[i] - tr) ** 2 * 0.3 + (px[i + 1] - tg) ** 2 * 0.59 + (px[i + 2] - tb) ** 2 * 0.11);
    const a = Math.max(0, Math.min(1, 1 - (dist - fz * 0.5) / fz)) * (px[i + 3] / 255);
    px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  let next = selectionFromCanvas(d, (gg) => gg.drawImage(c, 0, 0));
  const { combine } = await import('./selection.js');
  const b = d.selection;
  if (v.mode !== 'new' && b) next = combine(d, b, next, v.mode);
  if (next.empty) { toast('No pixels match that colour — raise Fuzziness.'); return; }
  d.selection = next;
  app.commit(selectionCmd(d, 'Color Range', b, next));
}
