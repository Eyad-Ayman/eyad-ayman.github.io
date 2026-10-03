// EYAD Studio — Moodboard (/studio/moodboard/). A free-form board: images, colour chips and type that you
// drag, resize and layer, with the palette pulled from your images. Saved on this device; exports one PNG.
// Imported files are untrusted: images are only decoded by the browser and redrawn; text is always plain text.
import { h } from '../core/dom.js';
import { toast } from '../core/ui.js';
import { db } from '../core/db.js';
import { downloadBlob, pickFiles } from '../core/files.js';
import { page } from './common.js';

const FORMATS = { wide: [1600, 1000, 'Wide 16:10'], square: [1200, 1200, 'Square 1:1'], portrait: [1080, 1350, 'Portrait 4:5'], story: [1080, 1920, 'Story 9:16'], a4: [1400, 990, 'A4 landscape'] };
const FONTS = { poster: ["'Poster BN', Impact, sans-serif", 'Poster'], heavy: ["'Poster AB', 'Arial Black', sans-serif", 'Heavy'], sans: ["'Studio Inter', Inter, system-ui, sans-serif", 'Clean'], mono: ["'Poster MO', ui-monospace, monospace", 'Mono'], serif: ["'Playfair Display', Georgia, serif", 'Serif'] };
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v);
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const lum = (hx) => { const n = parseInt(hx.slice(1), 16); return (n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11; };

let state = { format: 'wide', bg: '#ecebe6', items: [] };
const images = new Map(); // id -> { blob, url, bmp }
let sel = null, scale = 1, saveT = 0;

// ------------------------------------------------------------------ storage
const save = () => { clearTimeout(saveT); saveT = setTimeout(async () => { try { await db.put('files', { id: 'mood:board', json: JSON.stringify(state), created: Date.now() }); } catch (e) { /* storage blocked: the board still works for this visit */ } }, 400); };
async function load() {
  try {
    const rec = await db.get('files', 'mood:board');
    if (!rec || typeof rec.json !== 'string') return;
    const s = JSON.parse(rec.json);
    if (!s || !Array.isArray(s.items)) return;
    state = { format: FORMATS[s.format] ? s.format : 'wide', bg: isHex(s.bg) ? s.bg : '#ecebe6', items: [] };
    for (const it of s.items.slice(0, 300)) {
      const base = { id: String(it.id || uid()).slice(0, 16), type: it.type, x: +it.x || 0, y: +it.y || 0, w: clamp(+it.w || 100, 20, 4000), h: clamp(+it.h || 100, 20, 4000), z: +it.z || 0 };
      if (it.type === 'image') { const r = await db.get('files', 'mood:img:' + base.id); if (!r || !(r.blob instanceof Blob)) continue; images.set(base.id, { blob: r.blob, url: URL.createObjectURL(r.blob) }); state.items.push(base); }
      else if (it.type === 'color') state.items.push({ ...base, color: isHex(it.color) ? it.color : '#f4260f' });
      else if (it.type === 'text') state.items.push({ ...base, text: String(it.text || '').slice(0, 2000), font: FONTS[it.font] ? it.font : 'poster', size: clamp(+it.size || 90, 10, 600), color: isHex(it.color) ? it.color : '#0d0d0d' });
    }
  } catch (e) { /* start with an empty board */ }
}

// ------------------------------------------------------------------ board
const board = h('div', { class: 'mb-board' });
const wrap = h('div', { class: 'mb-wrap' }, board);
const empty = h('div', { class: 'mb-empty' }, h('b', { text: 'Your moodboard' }), h('span', { text: 'Add images, colours and words — or drop and paste pictures here.' }));
const size = () => FORMATS[state.format];
function fit() {
  const [W, H] = size();
  scale = Math.min(1, (wrap.clientWidth || 300) / W);
  board.style.width = W + 'px'; board.style.height = H + 'px'; board.style.transform = `scale(${scale})`; board.style.background = state.bg;
  wrap.style.height = Math.round(H * scale) + 'px';
}
const topZ = () => state.items.reduce((m, i) => Math.max(m, i.z), 0) + 1;

function elFor(it) {
  const el = h('div', { class: 'mb-item is-' + it.type, dataset: { id: it.id } });
  if (it.type === 'image') el.append(h('img', { src: images.get(it.id).url, alt: '', draggable: false }));
  else if (it.type === 'color') el.append(h('span', { class: 'mb-hex' }));
  else { const t = h('div', { class: 'mb-text', spellcheck: false }); t.textContent = it.text; el.append(t); }
  el.append(h('i', { class: 'mb-grip', 'aria-hidden': 'true' }));
  place(el, it);
  return el;
}
function place(el, it) {
  Object.assign(el.style, { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', height: it.type === 'text' ? 'auto' : it.h + 'px', zIndex: String(it.z) });
  if (it.type === 'color') { el.style.background = it.color; const hx = el.querySelector('.mb-hex'); hx.textContent = it.color; hx.style.color = lum(it.color) > 150 ? '#0d0d0d' : '#fff'; }
  if (it.type === 'text') { const t = el.querySelector('.mb-text'); t.style.fontFamily = FONTS[it.font][0]; t.style.fontSize = it.size + 'px'; t.style.color = it.color; t.style.textTransform = it.font === 'poster' || it.font === 'heavy' || it.font === 'mono' ? 'uppercase' : 'none'; }
}
const find = (id) => state.items.find((i) => i.id === id);
const elOf = (id) => board.querySelector(`.mb-item[data-id="${id}"]`);
function render() { board.replaceChildren(...state.items.map(elFor)); empty.hidden = state.items.length > 0; select(sel && find(sel) ? sel : null); fit(); }
function add(it) { it.z = topZ(); state.items.push(it); board.append(elFor(it)); empty.hidden = true; select(it.id); save(); }

// ------------------------------------------------------------------ selection + contextual bar
const cColor = h('input', { type: 'color', 'aria-label': 'Colour' });
const cFont = h('select', { class: 'studio-input', 'aria-label': 'Typeface' }, Object.entries(FONTS).map(([k, v]) => h('option', { value: k, text: v[1] })));
const cSize = h('input', { class: 'studio-range', type: 'range', min: 16, max: 400, 'aria-label': 'Type size' });
const pill = (text, fn) => h('button', { class: 'po-pill', type: 'button', text, onclick: fn });
const selBar = h('div', { class: 'mb-selbar', hidden: true },
  h('label', { class: 'mb-ctl mb-c-color' }, h('span', { class: 'po-mono', text: 'Colour' }), cColor),
  h('label', { class: 'mb-ctl mb-c-text' }, h('span', { class: 'po-mono', text: 'Type' }), cFont),
  h('label', { class: 'mb-ctl mb-c-text' }, h('span', { class: 'po-mono', text: 'Size' }), cSize),
  pill('Edit text', () => editText(sel)), pill('To front', () => { const it = find(sel); if (it) { it.z = topZ(); place(elOf(sel), it); save(); } }),
  pill('To back', () => { const it = find(sel); if (it) { it.z = state.items.reduce((m, i) => Math.min(m, i.z), 0) - 1; place(elOf(sel), it); save(); } }),
  pill('Duplicate', () => duplicate()), pill('Delete', () => remove()));
selBar.children[3].classList.add('mb-c-text');
function select(id) {
  sel = id; for (const el of board.children) el.classList.toggle('is-sel', el.dataset.id === id);
  const it = id && find(id); selBar.hidden = !it; if (!it) return;
  selBar.dataset.type = it.type;
  if (it.type !== 'image') cColor.value = it.color;
  if (it.type === 'text') { cFont.value = it.font; cSize.value = it.size; }
}
cColor.addEventListener('input', () => { const it = find(sel); if (it && it.type !== 'image' && isHex(cColor.value)) { it.color = cColor.value; place(elOf(sel), it); save(); } });
cFont.addEventListener('change', () => { const it = find(sel); if (it && it.type === 'text' && FONTS[cFont.value]) { it.font = cFont.value; place(elOf(sel), it); save(); } });
cSize.addEventListener('input', () => { const it = find(sel); if (it && it.type === 'text') { it.size = clamp(+cSize.value, 10, 600); place(elOf(sel), it); save(); } });
function remove() { const it = find(sel); if (!it) return; state.items = state.items.filter((i) => i !== it); elOf(it.id)?.remove(); if (it.type === 'image') { const im = images.get(it.id); if (im) URL.revokeObjectURL(im.url); images.delete(it.id); db.del('files', 'mood:img:' + it.id).catch(() => {}); } select(null); empty.hidden = state.items.length > 0; save(); }
async function duplicate() {
  const it = find(sel); if (!it) return; const n = { ...it, id: uid(), x: it.x + 30, y: it.y + 30 };
  if (it.type === 'image') { const im = images.get(it.id); images.set(n.id, { blob: im.blob, url: URL.createObjectURL(im.blob) }); db.put('files', { id: 'mood:img:' + n.id, blob: im.blob, created: Date.now() }).catch(() => {}); }
  add(n);
}
function editText(id) {
  const it = find(id); if (!it || it.type !== 'text') return; const t = elOf(id).querySelector('.mb-text');
  t.contentEditable = 'true'; t.focus(); const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  const done = () => { t.contentEditable = 'false'; it.text = (t.innerText || '').replace(/ /g, ' ').slice(0, 2000) || 'Text'; t.textContent = it.text; t.removeEventListener('blur', done); save(); };
  t.addEventListener('blur', done);
}
board.addEventListener('paste', (e) => { if (e.target.closest && e.target.closest('.mb-text[contenteditable="true"]')) { e.preventDefault(); e.stopPropagation(); const s = (e.clipboardData?.getData('text/plain') || '').slice(0, 2000); document.execCommand('insertText', false, s); } });
board.addEventListener('keydown', (e) => { if (e.target.closest && e.target.closest('.mb-text[contenteditable="true"]') && e.key === 'Escape') e.target.blur(); });
board.addEventListener('dblclick', (e) => { const el = e.target.closest('.mb-item.is-text'); if (el) editText(el.dataset.id); });

// drag / resize
let drag = null;
board.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.mb-text[contenteditable="true"]')) return;
  const el = e.target.closest('.mb-item');
  if (!el) { select(null); return; }
  const it = find(el.dataset.id); select(it.id); e.preventDefault();
  drag = { it, el, resize: !!e.target.closest('.mb-grip'), sx: e.clientX, sy: e.clientY, x: it.x, y: it.y, w: it.w, h: it.h, size: it.size, moved: false };
  el.setPointerCapture(e.pointerId);
});
board.addEventListener('pointermove', (e) => {
  if (!drag) return; const dx = (e.clientX - drag.sx) / scale, dy = (e.clientY - drag.sy) / scale, it = drag.it, [W, H] = size();
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
  if (drag.resize) {
    if (it.type === 'image') { const k = Math.max(0.08, (drag.w + dx) / drag.w); it.w = clamp(drag.w * k, 40, 4000); it.h = it.w * drag.h / drag.w; }
    else if (it.type === 'text') { it.w = clamp(drag.w + dx, 80, 4000); it.size = clamp(Math.round(drag.size * Math.max(0.2, (drag.h + dy) / Math.max(20, drag.h))), 10, 600); }
    else { it.w = clamp(drag.w + dx, 30, 4000); it.h = clamp(drag.h + dy, 30, 4000); }
  } else { it.x = clamp(drag.x + dx, -it.w + 30, W - 30); it.y = clamp(drag.y + dy, -20, H - 30); }
  place(drag.el, it);
});
const endDrag = () => { if (!drag) return; if (drag.it.type === 'text') { drag.it.h = drag.el.offsetHeight; if (sel === drag.it.id) cSize.value = drag.it.size; } if (drag.moved) save(); drag = null; };
board.addEventListener('pointerup', endDrag); board.addEventListener('pointercancel', endDrag);
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel) { e.preventDefault(); duplicate(); }
});

// ------------------------------------------------------------------ adding things
async function addImages(files) {
  const [W, H] = size(); let n = 0;
  for (const f of files.slice(0, 24)) {
    if (!/^image\//.test(f.type || '') || f.size > 80 * 1024 * 1024) continue;
    try {
      let bmp; try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(f); }
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
      const png = /png|webp|gif|svg/.test(f.type); const blob = await new Promise((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.9)); if (!blob) continue;
      const id = uid(); images.set(id, { blob, url: URL.createObjectURL(blob) });
      db.put('files', { id: 'mood:img:' + id, blob, created: Date.now() }).catch(() => {});
      const w = Math.min(W * 0.34, c.width), hh = w * c.height / c.width, i = state.items.length;
      add({ id, type: 'image', x: 40 + (i * 70) % Math.max(60, W - w - 80), y: 40 + (i * 50) % Math.max(60, H - hh - 80), w, h: hh });
      n++;
    } catch (e) { /* not a readable image: skipped */ }
  }
  if (!n && files.length) toast('Those files could not be read as images.', { type: 'warn' });
}
function addColor(color = '#f4260f') { const [W, H] = size(); const n = state.items.filter((i) => i.type === 'color').length; add({ id: uid(), type: 'color', x: 40 + (n * 150) % Math.max(150, W - 200), y: H - 190, w: 140, h: 150, color }); }
function addText() { const [W] = size(); add({ id: uid(), type: 'text', x: 60, y: 60, w: Math.min(700, W - 120), h: 100, text: 'Mood', font: 'poster', size: 140, color: lum(state.bg) > 150 ? '#0d0d0d' : '#f1eee7' }); editText(sel); }
async function paletteFromImages() {
  const px = [];
  for (const it of state.items) { if (it.type !== 'image') continue; const im = images.get(it.id); try { const bmp = await createImageBitmap(im.blob); const c = document.createElement('canvas'); c.width = 40; c.height = Math.max(1, Math.round(40 * bmp.height / bmp.width)); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close(); const d = g.getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]); } catch (e) { /* skip */ } }
  if (!px.length) { toast('Add an image first — the palette is pulled from your pictures.'); return; }
  const k = 5; const sorted = px.slice().sort((a, b) => (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11) - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
  let cen = Array.from({ length: k }, (_, i) => sorted[Math.floor((i + 0.5) / k * sorted.length)].slice());
  for (let t = 0; t < 10; t++) { const sum = cen.map(() => [0, 0, 0, 0]); for (const p of px) { let b = 0, bd = 1e9; for (let i = 0; i < k; i++) { const c = cen[i], dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < bd) { bd = dd; b = i; } } sum[b][0] += p[0]; sum[b][1] += p[1]; sum[b][2] += p[2]; sum[b][3]++; } cen = cen.map((c, i) => sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c); }
  const [W, H] = size(), w = Math.min(150, (W - 80) / k - 10);
  cen.forEach((c, i) => add({ id: uid(), type: 'color', x: 40 + i * (w + 10), y: H - w - 50, w, h: w + 10, color: hex(c) }));
}

// ------------------------------------------------------------------ export
async function exportPng() {
  const [W, H] = size(), k = Math.min(2, 4096 / Math.max(W, H)); const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
  const g = c.getContext('2d'); g.scale(k, k); g.fillStyle = state.bg; g.fillRect(0, 0, W, H); g.imageSmoothingQuality = 'high';
  try { await document.fonts.ready; } catch (e) { /* ignore */ }
  for (const it of state.items.slice().sort((a, b) => a.z - b.z)) {
    if (it.type === 'image') { try { const bmp = await createImageBitmap(images.get(it.id).blob); g.drawImage(bmp, it.x, it.y, it.w, it.h); bmp.close && bmp.close(); } catch (e) { /* skip */ } }
    else if (it.type === 'color') { g.fillStyle = it.color; g.fillRect(it.x, it.y, it.w, it.h); g.fillStyle = lum(it.color) > 150 ? '#0d0d0d' : '#fff'; g.font = "400 13px 'Poster MO', ui-monospace, monospace"; g.textBaseline = 'alphabetic'; g.fillText(it.color.toUpperCase(), it.x + 10, it.y + it.h - 10); }
    else {
      const up = it.font !== 'sans' && it.font !== 'serif'; g.fillStyle = it.color; g.font = `400 ${it.size}px ${FONTS[it.font][0]}`; g.textBaseline = 'top'; const lh = it.size * 0.92; let y = it.y + it.size * 0.06;
      for (const para of (up ? it.text.toUpperCase() : it.text).split('\n')) { let line = ''; for (const word of para.split(/\s+/)) { const test = line ? line + ' ' + word : word; if (line && g.measureText(test).width > it.w) { g.fillText(line, it.x, y); y += lh; line = word; } else line = test; } g.fillText(line, it.x, y); y += lh; }
    }
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png')); if (blob) downloadBlob(blob, `eyad-moodboard-${new Date().toISOString().slice(0, 10)}.png`);
}

// ------------------------------------------------------------------ toolbar + page
const fmt = h('select', { class: 'studio-input', 'aria-label': 'Board format' }, Object.entries(FORMATS).map(([k, v]) => h('option', { value: k, text: v[2] })));
fmt.addEventListener('change', () => { state.format = fmt.value; const [W, H] = size(); for (const it of state.items) { it.x = clamp(it.x, -it.w + 30, W - 30); it.y = clamp(it.y, -20, H - 30); } render(); save(); });
const bg = h('input', { type: 'color', 'aria-label': 'Board colour' });
bg.addEventListener('input', () => { if (isHex(bg.value)) { state.bg = bg.value; fit(); save(); } });
const sbtn = (text, fn, primary) => h('button', { class: 'studio-btn' + (primary ? ' is-primary' : ''), type: 'button', text, onclick: fn });
const bar = h('div', { class: 'mb-bar' },
  sbtn('Add images', async () => addImages(await pickFiles({ accept: 'image/*', multiple: true, media: 'image' })), true),
  sbtn('Colour', () => addColor()), sbtn('Text', () => addText()), sbtn('Palette from images', () => paletteFromImages()),
  h('label', { class: 'mb-ctl' }, h('span', { class: 'po-mono', text: 'Board' }), bg), fmt,
  h('span', { class: 'mb-sp' }),
  sbtn('Clear', () => { if (!state.items.length || !confirm('Clear the whole board?')) return; for (const it of state.items) if (it.type === 'image') { URL.revokeObjectURL(images.get(it.id).url); db.del('files', 'mood:img:' + it.id).catch(() => {}); } images.clear(); state.items = []; render(); save(); }),
  sbtn('Export PNG', () => exportPng(), true));

page('moodboard',
  h('section', { class: 'hub-pagehead' }, h('div', {}, h('h1', { class: 'studio-page-title', text: 'Moodboard' }),
    h('p', { class: 'studio-dim', text: 'Collect the feeling of a project on one board: pictures, colours, words. Drag to move, pull the corner to resize, double-tap text to edit. Saved on this device.' }))),
  bar, selBar, h('div', { class: 'mb-stage' }, wrap, empty));

wrap.addEventListener('dragover', (e) => { e.preventDefault(); });
wrap.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); addImages(Array.from(e.dataTransfer?.files || [])); });
addEventListener('paste', (e) => { if (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return; const fs = Array.from(e.clipboardData?.files || []).filter((f) => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); addImages(fs); } });
addEventListener('resize', fit);
(async () => { await load(); fmt.value = state.format; bg.value = state.bg; render(); requestAnimationFrame(fit); })();
