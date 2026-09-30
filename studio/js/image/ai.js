// EYAD AI for EYAD IMAGE — on-device, free, unlimited. Selections and masks
// come from MediaPipe models running in this browser (core/ai.js); fills,
// enlarging and colour matching are local algorithms. Nothing is uploaded.
import { h, clamp } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, dialog, progressDialog } from '../core/ui.js';
import { segment, selectAt, detectFaces, detectObjects, withAI, MODELS } from '../core/ai.js';
import { makeCanvas, walk, MAX_SIDE, MAX_AREA } from './doc.js';
<<<<<<< HEAD
import { selectionCmd, pixelCmd } from './history.js';
=======
import { selectionCmd, pixelCmd, treeCmd } from './history.js';
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
import { selectionFromCanvas, combine } from './selection.js';
import { runFilter } from './filters.js';
import * as ops from './ops.js';
import { contentAwareFill } from './pro.js';
const modeFromEvent = (pt, fb) => (pt.shift && pt.alt ? 'intersect' : pt.shift ? 'add' : pt.alt ? 'subtract' : fb);

const need = (app) => { if (!app.doc) { toast('Open or create a document first.'); return false; } return true; };

/** What the model sees: every visible layer, as composited on screen. */
function source(app) {
  app.view.updateComposite();
  const d = app.doc, max = 1600, s = Math.min(1, max / Math.max(d.width, d.height));
  const c = makeCanvas(Math.max(1, Math.round(d.width * s)), Math.max(1, Math.round(d.height * s)));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // transparent areas read as white, not black
  g.drawImage(app.view.comp, 0, 0, c.width, c.height);
  return c;
}

/** Soft model mask → document-space selection (edges refined, never binary-jagged). */
function maskSelection(app, m, { gain = 2.2 } = {}) {
  const d = app.doc;
  const mc = makeCanvas(m.width, m.height), g = mc.getContext('2d'), im = g.createImageData(m.width, m.height);
  for (let i = 0; i < m.mask.length; i++) im.data[i * 4 + 3] = clamp((m.mask[i] - 0.5) * gain + 0.5, 0, 1) * 255;
  g.putImageData(im, 0, 0);
  return selectionFromCanvas(d, (sg) => { sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high'; sg.drawImage(mc, 0, 0, d.width, d.height); });
}

function applySelection(app, next, label, mode = 'new') {
  const d = app.doc, before = d.selection;
  const after = combine(d, before, next, before ? mode : 'new');
  d.selection = after;
  app.commit(selectionCmd(d, label, before, after));
  app.view.requestDraw();
}

function coverage(m) { let s = 0; for (const v of m.mask) s += v; return s / m.mask.length; }

// ------------------------------------------------------------------ selections

export async function selectSubject(app, { label = 'Select Subject', mode = 'new' } = {}) {
  if (!need(app)) return null;
  return withAI('Finding the subject', async (status) => {
    const src = source(app);
    // General objects first (people, animals, vehicles, furniture…); people get the finer people model.
<<<<<<< HEAD
    let objs;
    try { objs = await segment(src, 'objects', { onStatus: status }); }
    catch (e) {
      // offline without the objects model: the people model (shipped with the Studio) still finds people
      const p = await segment(src, 'person', { onStatus: status });
      if (coverage(p) < 0.004) { toast('No person found. The general subject model downloads once when you are online (or add it in Settings ▸ Offline & AI models).', { type: 'warn', timeout: 7000 }); return null; }
      applySelection(app, maskSelection(app, p), label, mode);
      return true;
    }
=======
    const objs = await segment(src, 'objects', { onStatus: status });
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
    let m = objs;
    const people = await detectObjects(src).catch(() => []);
    if (people.some((o) => o.label === 'person' && o.share > 0.01)) {
      const p = await segment(src, 'person', { onStatus: status });
      const merged = new Float32Array(p.mask.length);
      // resample the object mask onto the person mask grid and take the max
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
        const ox = Math.min(objs.width - 1, Math.floor(x / p.width * objs.width)), oy = Math.min(objs.height - 1, Math.floor(y / p.height * objs.height));
        merged[y * p.width + x] = Math.max(p.mask[y * p.width + x], objs.mask[oy * objs.width + ox]);
      }
      m = { mask: merged, width: p.width, height: p.height };
    }
    if (coverage(m) < 0.004) { toast('No clear subject was found. Try Object Selection (click the object) instead.', { type: 'warn', timeout: 6000 }); return null; }
    applySelection(app, maskSelection(app, m), label, mode);
    return true;
  });
}

export async function selectPeople(app, part = null) {
  if (!need(app)) return null;
  return withAI(part ? 'Selecting ' + part : 'Selecting people', async (status) => {
    const src = source(app);
    let m;
    if (!part) m = await segment(src, 'person', { onStatus: status });
    else {
      const classes = { hair: [1], skin: [2, 3], face: [3], clothes: [4] }[part];
      m = await segment(src, 'multiclass', { classes, onStatus: status });
    }
    if (coverage(m) < 0.002) { toast('No ' + (part || 'people') + ' found in this image.', { type: 'warn' }); return null; }
    applySelection(app, maskSelection(app, m), part ? 'Select ' + part[0].toUpperCase() + part.slice(1) : 'Select People');
    return true;
  });
}

export async function selectObjectClass(app) {
  if (!need(app)) return;
  const found = await withAI('Looking for objects', async (status) => detectObjects(source(app), { onStatus: status }));
  if (!found) return;
  if (!found.length) { toast('No known objects found (people, animals, vehicles, furniture, plants, screens…).', { type: 'warn', timeout: 6000 }); return; }
  const pick = await dialog({
    title: 'Select objects', width: 380,
    body: h('div', { class: 'studio-stack' }, h('p', { class: 'studio-dim studio-small', text: 'Found in this image:' }),
      h('div', { class: 'ai-list' }, found.map((o) => h('label', { class: 'ai-check' }, h('input', { type: 'checkbox', value: String(o.id), checked: true }), h('span', { text: o.label }), h('em', { class: 'studio-faint', text: Math.round(o.share * 100) + '%' }))))),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Select', primary: true, value: () => Array.from(document.querySelectorAll('.ai-check input:checked')).map((i) => Number(i.value)) }],
  });
  if (!pick || !pick.length) return;
  await withAI('Selecting', async (status) => {
    const m = await segment(source(app), 'objects', { classes: pick, onStatus: status });
    applySelection(app, maskSelection(app, m), 'Select Objects');
  });
}

/** Colour-based sky selection: grows from the top edge through sky-like colours. */
export function selectSky(app) {
  if (!need(app)) return;
  const src = source(app), W = src.width, H = src.height;
  const px = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const isSkyish = (i) => { const r = px[i], g = px[i + 1], b = px[i + 2], l = (r + g + b) / 3; return (b >= r - 8 && l > 70) || l > 200; };
  const mask = new Uint8Array(W * H), stack = [];
  for (let x = 0; x < W; x++) if (isSkyish(x * 4)) { mask[x] = 1; stack.push(x); }
  if (!stack.length) { toast('No sky found along the top edge.', { type: 'warn' }); return; }
  while (stack.length) {
    const q = stack.pop(), x = q % W, y = (q / W) | 0, i = q * 4;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const nq = Y * W + X; if (mask[nq]) continue;
      const j = nq * 4, diff = Math.abs(px[j] - px[i]) + Math.abs(px[j + 1] - px[i + 1]) + Math.abs(px[j + 2] - px[i + 2]);
      if (diff < 30 && isSkyish(j)) { mask[nq] = 1; stack.push(nq); }
    }
  }
  const soft = new Float32Array(mask.length); for (let i = 0; i < mask.length; i++) soft[i] = mask[i];
  applySelection(app, maskSelection(app, { mask: soft, width: W, height: H }, { gain: 1 }), 'Select Sky');
}

export async function selectFaces(app) {
  if (!need(app)) return;
  await withAI('Finding faces', async (status) => {
    const src = source(app);
    const faces = await detectFaces(src, { onStatus: status });
    if (!faces.length) { toast('No faces found.', { type: 'warn' }); return; }
    const d = app.doc, k = d.width / src.width;
    const sel = selectionFromCanvas(d, (g) => {
      g.fillStyle = '#000';
      for (const f of faces) { g.beginPath(); g.ellipse((f.x + f.w / 2) * k, (f.y + f.h / 2) * k, f.w * 0.62 * k, f.h * 0.78 * k, 0, 0, Math.PI * 2); g.fill(); }
    });
    applySelection(app, sel, faces.length === 1 ? 'Select Face' : `Select ${faces.length} Faces`);
  });
}

// ------------------------------------------------------------------ actions

export async function removeBackground(app) {
  if (!need(app)) return;
  const node = app.active;
  if (!node || node.type === 'group') { toast('Select a layer first.', { type: 'warn' }); return; }
  const prevSel = app.doc.selection;
  const ok = await selectSubject(app, { label: 'Select Subject' });
  if (!ok) return;
  if (node.mask) ops.deleteMask(app);
  ops.addMask(app, 'selection');
  const d = app.doc; const before = d.selection;
  d.selection = prevSel;
  app.commit(selectionCmd(d, 'Restore Selection', before, prevSel));
  toast('Background hidden with a layer mask — paint on the mask to refine, or Layer ▸ Layer Mask ▸ Delete to undo.', { type: 'ok', timeout: 6500 });
}

export async function removeObject(app) {
  if (!need(app)) return;
<<<<<<< HEAD
  if (!app.doc.selection) { toast('First select what to remove — use Object Selection (click it), the Lasso, or paint with the Spot Heal Brush (J).', { type: 'warn', timeout: 7000 }); app.selectTool('aiselect'); return; }
=======
  if (!app.doc.selection) { toast('First select what to remove — use Object Selection (click it), the Lasso, or paint with the Spot Healing Brush (J).', { type: 'warn', timeout: 7000 }); app.selectTool('aiselect'); return; }
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  await contentAwareFill(app, { label: 'Remove Object' });
}

export async function smartCrop(app) {
  if (!need(app)) return;
  const v = await dialog({ title: 'Smart Crop', width: 360, body: h('div', { class: 'studio-stack' },
    h('p', { class: 'studio-dim studio-small', text: 'Crops around faces (or the main subject) at the chosen shape.' }),
    h('select', { class: 'studio-input', id: 'ai-ratio' }, [['1', 'Square 1:1'], ['0.8', 'Portrait 4:5 (Instagram)'], ['0.5625', 'Story 9:16'], ['1.7778', 'Landscape 16:9']].map(([val, l]) => h('option', { value: val, text: l })))),
  buttons: [{ label: 'Cancel', value: null }, { label: 'Crop', primary: true, value: () => Number(document.getElementById('ai-ratio').value) }] });
  if (!v) return;
  await withAI('Finding faces', async (status) => {
    const src = source(app), d = app.doc, k = d.width / src.width;
    let box = null;
    const faces = await detectFaces(src, { onStatus: status }).catch(() => []);
    if (faces.length) {
      const x0 = Math.min(...faces.map((f) => f.x)), y0 = Math.min(...faces.map((f) => f.y)), x1 = Math.max(...faces.map((f) => f.x + f.w)), y1 = Math.max(...faces.map((f) => f.y + f.h));
      box = { cx: (x0 + x1) / 2 * k, cy: ((y0 + y1) / 2 + (y1 - y0) * 0.35) * k, need: Math.max(x1 - x0, (y1 - y0) * 2.2) * k };
    } else {
      const m = await segment(src, 'objects', { onStatus: status });
      let sx = 0, sy = 0, s = 0;
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) { const a = m.mask[y * m.width + x]; sx += x * a; sy += y * a; s += a; }
      if (s > 0) box = { cx: sx / s / m.width * d.width, cy: sy / s / m.height * d.height, need: 0 };
    }
    if (!box) box = { cx: d.width / 2, cy: d.height / 2, need: 0 };
    let w = d.width, hh = w / v; if (hh > d.height) { hh = d.height; w = hh * v; }
    const x = clamp(box.cx - w / 2, 0, d.width - w), y = clamp(box.cy - hh / 2, 0, d.height - hh);
    const sel = selectionFromCanvas(d, (g) => { g.fillStyle = '#000'; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh)); });
    applySelection(app, sel, 'Smart Crop Area');
    ops.cropToSelection(app);
  });
}

/** Enlarge 2× / 4× with staged resampling + detail restoration (local algorithm, not a generative model). */
export async function enlarge(app, factor = 2) {
  if (!need(app)) return;
  const d = app.doc, W = Math.round(d.width * factor), H = Math.round(d.height * factor);
  if (W > MAX_SIDE || H > MAX_SIDE || W * H > MAX_AREA) { toast(`That would be ${W} × ${H} px — over the ${MAX_SIDE} px / ${MAX_AREA / 1e6} MP limit.`, { type: 'error' }); return; }
  const prog = progressDialog('Enlarge ' + factor + '×', { cancellable: false });
  try {
    const canvases = new Map(), nodes = [];
    walk(d.layers, (n) => { if (n.type === 'raster') nodes.push(n); });
    let i = 0;
    for (const n of nodes) {
      prog.set(i++ / nodes.length, 'Enlarging ' + n.name + '…');
      let c = n.canvas;
      const tw = Math.max(1, Math.round(c.width * factor)), th = Math.max(1, Math.round(c.height * factor));
      while (c.width < tw) { // staged 2× steps keep edges cleaner than one big jump
        const nw = Math.min(tw, c.width * 2), nh = Math.min(th, c.height * 2);
        const t = makeCanvas(nw, nh), g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, nw, nh); c = t;
      }
      const g = c.getContext('2d', { willReadFrequently: true });
      if (c.width * c.height <= 40e6) {
        const img = g.getImageData(0, 0, c.width, c.height);
        const out = await runFilter('unsharpMask', img, { amount: 70, radius: 0.9 * factor, threshold: 2 });
        g.putImageData(out, 0, 0);
      }
      canvases.set(n.id, c);
    }
    ops.resizeDocument(app, W, H, { canvases, label: 'Enlarge ' + factor + '×' });
  } catch (e) { toast(e.message, { type: 'error' }); }
  finally { prog.close(); }
}

/** Match Colour: move the active layer's colour statistics toward another layer's (Reinhard transfer). */
export async function matchColor(app) {
  if (!need(app)) return;
  const target = app.active;
  if (!target || target.type !== 'raster') { toast('Select a pixel layer to recolour.', { type: 'warn' }); return; }
  const others = []; walk(app.doc.layers, (n) => { if (n.type === 'raster' && n !== target) others.push(n); });
  if (!others.length) { toast('Add or place another image layer to match colours from.', { type: 'warn' }); return; }
  const v = await dialog({ title: 'Match Colour', width: 380, body: h('div', { class: 'studio-stack' },
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Take colours from' }), h('select', { class: 'studio-input', id: 'ai-src' }, others.map((n) => h('option', { value: n.id, text: n.name })))),
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Strength' }), h('input', { class: 'studio-range', type: 'range', id: 'ai-str', min: 0, max: 100, value: 80 }))),
  buttons: [{ label: 'Cancel', value: null }, { label: 'Match', primary: true, value: () => ({ id: document.getElementById('ai-src').value, k: Number(document.getElementById('ai-str').value) / 100 }) }] });
  if (!v) return;
  const src = others.find((n) => n.id === v.id);
  const stats = (c) => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; const m = [0, 0, 0], s = [0, 0, 0]; let n = 0; for (let i = 0; i < d.length; i += 16) { if (d[i + 3] < 16) continue; n++; for (let c2 = 0; c2 < 3; c2++) { m[c2] += d[i + c2]; s[c2] += d[i + c2] * d[i + c2]; } } for (let c2 = 0; c2 < 3; c2++) { m[c2] /= n || 1; s[c2] = Math.sqrt(Math.max(1, s[c2] / (n || 1) - m[c2] * m[c2])); } return { m, s }; };
  const a = stats(target.canvas), b = stats(src.canvas);
  const g = target.canvas.getContext('2d', { willReadFrequently: true });
  const before = g.getImageData(0, 0, target.canvas.width, target.canvas.height);
  const out = new ImageData(new Uint8ClampedArray(before.data), before.width, before.height);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const nv = (d[i + c] - a.m[c]) * (b.s[c] / a.s[c]) + b.m[c]; d[i + c] = d[i + c] + (nv - d[i + c]) * v.k; }
  g.putImageData(out, 0, 0);
  app.commit(pixelCmd('Match Colour', target, { x: 0, y: 0, w: out.width, h: out.height }, before, out));
  app.invalidate();
}

<<<<<<< HEAD
=======

// ------------------------------------------------------------------ local generator

function hashSeed(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; }
function mulberry(seed) { return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export async function generateDialog(app) {
  if (!need(app)) return;
  const d = app.doc;
  const body = h('div', { class: 'studio-stack' },
    h('p', { class: 'studio-dim studio-small', text: 'Generate original backgrounds, textures and graphic surfaces locally. Nothing is uploaded.' }),
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Type' }), h('select', { class: 'studio-input', id: 'gen-type' },
      [['gradient','Gradient'],['noise','Film Grain'],['paper','Paper Texture'],['grid','Technical Grid'],['stars','Star Field'],['aurora','Aurora Glow']].map(([v,l]) => h('option', { value:v, text:l })))),
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Seed / prompt' }), h('input', { class: 'studio-input', id: 'gen-seed', type:'text', value:'eyad studio', placeholder:'e.g. red black grain' })),
    h('div', { class: 'studio-grid-2' },
      h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Primary' }), h('input', { class:'studio-color', id:'gen-c1', type:'color', value:'#111111' })),
      h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Secondary' }), h('input', { class:'studio-color', id:'gen-c2', type:'color', value:'#d02b2a' }))),
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Opacity' }), h('input', { class:'studio-range', id:'gen-opacity', type:'range', min:10, max:100, value:100 }))
  );
  const result = await dialog({ title:'EYAD Generate', body, width:430, buttons:[{label:'Cancel',value:null},{label:'Generate',primary:true,value:()=>({ type:document.getElementById('gen-type').value, seed:document.getElementById('gen-seed').value, c1:document.getElementById('gen-c1').value, c2:document.getElementById('gen-c2').value, opacity:Number(document.getElementById('gen-opacity').value)/100 })}] });
  if (!result) return;
  const c = makeCanvas(d.width, d.height), g = c.getContext('2d');
  const rnd = mulberry(hashSeed(result.seed || 'eyad'));
  if (result.type === 'gradient') {
    const grad = g.createLinearGradient(0, 0, d.width, d.height); grad.addColorStop(0, result.c1); grad.addColorStop(1, result.c2); g.fillStyle = grad; g.fillRect(0,0,d.width,d.height);
  } else if (result.type === 'noise') {
    g.fillStyle = result.c1; g.fillRect(0,0,d.width,d.height); const im=g.getImageData(0,0,d.width,d.height), px=im.data; for(let i=0;i<px.length;i+=4){ const n=(rnd()*255)|0; px[i]=Math.min(255,n+(parseInt(result.c1.slice(1,3),16))); px[i+1]=Math.min(255,n+(parseInt(result.c1.slice(3,5),16))); px[i+2]=Math.min(255,n+(parseInt(result.c1.slice(5,7),16))); px[i+3]=255; } g.putImageData(im,0,0);
  } else if (result.type === 'paper') {
    g.fillStyle=result.c1; g.fillRect(0,0,d.width,d.height); g.globalAlpha=.22; for(let i=0;i<Math.min(18000,d.width*d.height/3);i++){ g.fillStyle=rnd()>.5?result.c2:'#ffffff'; g.fillRect(rnd()*d.width,rnd()*d.height,1+rnd()*3,1+rnd()*3); } g.globalAlpha=1;
  } else if (result.type === 'grid') {
    g.fillStyle=result.c1; g.fillRect(0,0,d.width,d.height); g.strokeStyle=result.c2; g.globalAlpha=.28; g.lineWidth=1; const step=Math.max(24,Math.round(Math.min(d.width,d.height)/20)); for(let x=0;x<d.width;x+=step){g.beginPath();g.moveTo(x,0);g.lineTo(x,d.height);g.stroke()} for(let y=0;y<d.height;y+=step){g.beginPath();g.moveTo(0,y);g.lineTo(d.width,y);g.stroke()} g.globalAlpha=1;
  } else if (result.type === 'stars') {
    g.fillStyle=result.c1; g.fillRect(0,0,d.width,d.height); for(let i=0;i<Math.min(2500,d.width*d.height/12000);i++){const x=rnd()*d.width,y=rnd()*d.height,r=.3+rnd()*1.8;g.fillStyle=result.c2;g.globalAlpha=.25+rnd()*.75;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill()} g.globalAlpha=1;
  } else {
    const grd=g.createRadialGradient(d.width*.5,d.height*.45,0,d.width*.5,d.height*.45,Math.max(d.width,d.height)*.7); grd.addColorStop(0,result.c2); grd.addColorStop(.45,result.c1); grd.addColorStop(1,'#000000'); g.fillStyle=grd; g.fillRect(0,0,d.width,d.height);
  }
  const n = makeNode('raster', { name:'Generated — '+result.type, canvas:c, opacity:result.opacity });
  app.commit(treeCmd('Generate '+result.type, d, () => { d.layers.push(n); d.activeId=n.id; })); app.invalidate();
}

>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
// ------------------------------------------------------------------ Object Selection tool

export const objectSelectTool = {
  id: 'aiselect', label: 'Object Selection (AI)', icon: 'sparkle', key: 'W', cursor: 'crosshair',
  hint: 'Click an object to select it with on-device AI · Shift adds · Alt subtracts',
  options(app) {
    return [h('span', { class: 'img-opt studio-dim', text: 'Click any object' }),
      h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => selectSubject(app) }, icon('sparkle', 14), h('span', { text: 'Select Subject' })),
      h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => selectSky(app) }, h('span', { text: 'Select Sky' }))];
  },
  async down(pt) {
    const app = this.app, d = app.doc;
    if (pt.x < 0 || pt.y < 0 || pt.x > d.width || pt.y > d.height) return;
    const mode = modeFromEvent(pt, d.selection ? 'new' : 'new');
    this.busy = { x: pt.x, y: pt.y }; app.view.requestDraw();
    await withAI('Selecting object', async (status) => {
      const m = await selectAt(source(app), pt.x / d.width, pt.y / d.height, { onStatus: status });
      if (coverage(m) < 0.0005) { toast('Nothing distinct there — try clicking the middle of the object.', { type: 'warn' }); return; }
      applySelection(app, maskSelection(app, m), 'Object Selection', mode);
    });
    this.busy = null; app.view.requestDraw();
  },
  overlay(ctx, view) {
    if (!this.busy) return;
    const s = view.docToScreen(this.busy.x, this.busy.y), t = performance.now() / 300;
    ctx.beginPath(); ctx.arc(s.x, s.y, 14, t, t + 4.5); ctx.strokeStyle = '#d02b2a'; ctx.lineWidth = 3; ctx.stroke();
    view.requestDraw();
  },
};

// ------------------------------------------------------------------ AI panel

export function aiPanel(app) {
  const item = (ic, title, desc, fn, badge) => h('button', { class: 'ai-item', type: 'button', onclick: () => { close(); fn(); } },
    h('span', { class: 'ai-item-icon' }, icon(ic, 18)),
    h('span', { class: 'ai-item-text' }, h('strong', {}, title, badge ? h('em', { class: 'ai-badge', text: badge }) : null), h('span', { text: desc })));
  let close = () => {};
  const body = h('div', { class: 'ai-panel' },
    h('p', { class: 'ai-lede' }, 'Runs on this device — free, unlimited, no account. Models download once (', Object.values(MODELS).map((m) => m.size).join(', '), '), then work offline.'),
    h('div', { class: 'ai-group', text: 'Select' }),
    item('sparkle', 'Select Subject', 'People, animals, vehicles, furniture, plants…', () => selectSubject(app)),
    item('cursor', 'Object Selection', 'Click anything to select just that object', () => app.selectTool('aiselect')),
    item('image', 'Select People', 'Precise people cut-out', () => selectPeople(app)),
    item('brush', 'Select Hair', 'Hair only', () => selectPeople(app, 'hair')),
    item('drop', 'Select Skin', 'Face and body skin', () => selectPeople(app, 'skin')),
    item('layers', 'Select Clothes', 'Clothing only', () => selectPeople(app, 'clothes')),
    item('search', 'Select Objects by Type…', 'Pick from what the AI recognises', () => selectObjectClass(app)),
    item('cloud', 'Select Sky', 'Colour analysis from the top edge', () => selectSky(app), 'Local'),
    item('eye', 'Select Faces', 'Face detection', () => selectFaces(app)),
    h('div', { class: 'ai-group', text: 'Edit' }),
    item('mask', 'Remove Background', 'Hides the background with an editable layer mask', () => removeBackground(app)),
    item('heal', 'Remove Object', 'Content-aware fill of the selection', () => removeObject(app), 'Local'),
    item('crop', 'Smart Crop', 'Crop around faces / subject for Instagram, Stories, YouTube', () => smartCrop(app)),
    item('expand', 'Enlarge 2×', 'Detail-preserving upscale', () => enlarge(app, 2), 'Local'),
    item('expand', 'Enlarge 4×', 'Detail-preserving upscale', () => enlarge(app, 4), 'Local'),
    item('palette', 'Match Colour', 'Match this layer’s colours to another layer', () => matchColor(app), 'Local'),
    item('aperture', 'Auto Tone', 'One-click exposure & contrast', () => import('./pro.js').then((m) => m.autoAdjust(app, 'tone')), 'Local'),
<<<<<<< HEAD
    h('div', { class: 'ai-group', text: 'Generative' }),
    h('div', { class: 'ai-note' }, h('strong', { text: 'Generate Fill, Expand and Text-to-Image need a generation model.' }), h('span', { text: ' Those models are gigabytes in size and need a server GPU, and none is connected to this site — so they are not offered rather than faked. Remove Object and Spot Healing rebuild areas from their surroundings on this device instead.' })));
=======
    item('sparkle', 'Generate Texture / Background…', 'Original local gradients, grain, grids, stars and glows', () => generateDialog(app), 'Local'),
    h('div', { class: 'ai-group', text: 'Generative' }),
    h('div', { class: 'ai-note' }, h('strong', { text: 'Generative Fill, Expand and Text-to-Image need a generation model.' }), h('span', { text: ' Those models are gigabytes in size and need a server GPU, and none is connected to this site — so they are not offered rather than faked. Remove Object and Spot Healing rebuild areas from their surroundings on this device instead.' })));
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  if (app.mobile.matches) {
    import('../core/ui.js').then(({ openSheet }) => { const s = openSheet({ title: 'EYAD AI', content: body }); close = () => s.close(); });
  } else {
    dialog({ title: 'EYAD AI', body, width: 460, buttons: [], onOpen: ({ close: c }) => { close = () => c(null); } });
  }
}
