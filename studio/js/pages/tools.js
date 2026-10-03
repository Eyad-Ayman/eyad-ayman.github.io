// EYAD Studio — Quick tools (/studio/tools/). Small, single-purpose tools that run on this device:
// compress & convert images, remove a background, pull a colour palette, make a QR code, record the screen.
// Imported files are untrusted: they are only ever decoded as images by the browser and redrawn on a canvas.
import { h, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast } from '../core/ui.js';
import { ROUTES } from '../core/shell.js';
import { sanitizeFilename, baseName, downloadBlob, pickFiles, LIMITS } from '../core/files.js';
import { page, bindPageDrop } from './common.js';

const MAX_SIDE = 8192;
const pick = (multiple) => pickFiles({ accept: 'image/*', multiple, media: 'image' });
const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
/** Decode an image file safely (the browser's own decoder; nothing in the file is executed). */
async function decode(file) {
  if (!file || !/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|gif|avif|bmp|heic|heif)$/i.test(file.name || '')) throw new Error('Not an image');
  if (file.size > (LIMITS && LIMITS.image || 200 * 1024 * 1024)) throw new Error('File is too large');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { bmp = await createImageBitmap(file); }
  if (bmp.width > MAX_SIDE * 2 || bmp.height > MAX_SIDE * 2) { bmp.close && bmp.close(); throw new Error('Image is too large for this device'); }
  return bmp;
}
function draw(bmp, maxSide = 0) {
  const k = maxSide ? Math.min(1, maxSide / Math.max(bmp.width, bmp.height)) : 1;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
const field = (label, control) => h('label', { class: 'qt-field' }, h('span', { class: 'po-mono', text: label }), control);
const select = (opts, value) => { const s = h('select', { class: 'studio-input' }, opts.map(([v, t]) => h('option', { value: v, text: t, selected: v === value }))); return s; };
const btn = (text, onclick, primary) => h('button', { class: 'studio-btn' + (primary ? ' is-primary' : ''), type: 'button', onclick, text });
const busy = async (el, label, fn) => { const old = el.textContent; el.disabled = true; el.textContent = label; try { await fn(); } catch (e) { toast(e && e.message ? e.message : 'That did not work.', { type: 'error' }); } el.disabled = false; el.textContent = old; };
const tool = (n, id, title, text, ...body) => h('section', { class: 'qt-tool', id }, h('h2', { class: 'qt-h' }, h('span', { class: 'po-mono', text: `(0${n})` }), title), h('p', { class: 'qt-p', text }), ...body);

// ------------------------------------------------------------------ 1. compress & convert
function compressTool() {
  let files = [], results = [];
  const fmt = select([['image/jpeg', 'JPEG'], ['image/webp', 'WebP'], ['image/png', 'PNG (lossless)']], 'image/jpeg');
  const size = select([['0', 'Original size'], ['3840', '4K — 3840 px'], ['2048', '2048 px'], ['1920', '1920 px'], ['1350', 'Instagram portrait — 1350 px'], ['1080', '1080 px'], ['512', '512 px']], '0');
  const q = h('input', { class: 'studio-range', type: 'range', min: 30, max: 100, value: 82, 'aria-label': 'Quality' });
  const qv = h('output', { class: 'po-mono', text: '82' }); q.addEventListener('input', () => { qv.textContent = q.value; });
  const list = h('div', { class: 'qt-list' });
  const info = h('p', { class: 'po-mono', text: 'No images yet' });
  const run = btn('Compress', () => busy(run, 'Working…', go), true);
  const all = btn('Download all (.zip)', () => busy(all, 'Zipping…', zip)); all.hidden = true;
  const ext = () => ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' })[fmt.value];
  function setFiles(fs) { files = fs.slice(0, 60); results = []; all.hidden = true; list.replaceChildren(); info.textContent = files.length ? `${files.length} image${files.length > 1 ? 's' : ''} · ${formatBytes(files.reduce((a, f) => a + f.size, 0))}` : 'No images yet'; }
  async function go() {
    if (!files.length) { setFiles(await pick(true)); if (!files.length) return; }
    results = []; list.replaceChildren(); let before = 0, after = 0;
    for (const f of files) {
      const row = h('div', { class: 'qt-row' }, h('b', { text: sanitizeFilename(f.name) }), h('span', { class: 'po-mono', text: '…' })); list.append(row);
      try {
        const bmp = await decode(f); const c = draw(bmp, +size.value); bmp.close && bmp.close();
        if (fmt.value === 'image/jpeg') { const g = c.getContext('2d'); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        const blob = await toBlob(c, fmt.value, +q.value / 100); if (!blob) throw new Error('encode');
        const name = sanitizeFilename(baseName(f.name)) + '.' + ext();
        results.push({ name, blob }); before += f.size; after += blob.size;
        const save = Math.round((1 - blob.size / f.size) * 100);
        row.lastChild.textContent = `${c.width}×${c.height} · ${formatBytes(f.size)} → ${formatBytes(blob.size)}${save > 0 ? ` · −${save}%` : ''}`;
        row.append(h('button', { class: 'po-pill', type: 'button', text: 'Save', onclick: () => downloadBlob(blob, name) }));
      } catch (e) { row.lastChild.textContent = 'Could not read this file'; }
    }
    if (results.length) { info.textContent = `${results.length} done · ${formatBytes(before)} → ${formatBytes(after)}`; all.hidden = results.length < 2; }
  }
  async function zip() {
    const { zipSync } = await import('../../vendor/fflate/fflate.js');
    const out = {}; const seen = new Set();
    for (const r of results) { let n = r.name, i = 2; while (seen.has(n)) n = r.name.replace(/(\.\w+)$/, `-${i++}$1`); seen.add(n); out[n] = [new Uint8Array(await r.blob.arrayBuffer()), { level: 0 }]; }
    downloadBlob(new Blob([zipSync(out)], { type: 'application/zip' }), 'eyad-compressed.zip');
  }
  const el = tool(1, 'compress', 'Compress & convert', 'Shrink photos for the web, convert between JPEG, WebP and PNG, and resize a whole batch at once. Saving a copy also strips location data from the photo.',
    h('div', { class: 'qt-controls' }, field('Format', fmt), field('Resize', size), field('Quality', h('span', { class: 'qt-range' }, q, qv))),
    h('div', { class: 'qt-actions' }, btn('Choose images', async () => setFiles(await pick(true))), run, all, info), list);
  el._drop = setFiles;
  return el;
}

// ------------------------------------------------------------------ 2. remove background
function cutoutTool() {
  let result = null, name = 'cutout';
  const kind = select([['person', 'A person'], ['objects', 'An object, pet or car']], 'person');
  const stage = h('div', { class: 'qt-stage is-checker' });
  const save = btn('Save PNG', () => result && downloadBlob(result, name + '-cutout.png')); save.hidden = true;
  const status = h('span', { class: 'po-mono' });
  async function go(file) {
    const bmp = await decode(file); const c = draw(bmp, 2400); bmp.close && bmp.close();
    name = sanitizeFilename(baseName(file.name));
    status.textContent = 'Loading the on-device AI…';
    const ai = await import('../core/ai.js');
    if (!ai.aiSupported()) throw new Error('This browser cannot run the on-device AI.');
    const { mask, width, height } = await ai.segment(c, kind.value === 'person' ? 'multiclass' : kind.value, { onStatus: (t) => { status.textContent = t; } });
    let hit = 0; for (let i = 0; i < mask.length; i += 7) if (mask[i] > 0.5) hit++;
    if (hit < mask.length / 7 * 0.01) { status.textContent = ''; throw new Error(kind.value === 'person' ? 'No person was found in this photo — try “An object, pet or car”.' : 'Nothing was found to cut out in this photo.'); }
    // mask → soft alpha at image size
    const m = document.createElement('canvas'); m.width = width; m.height = height;
    const mg = m.getContext('2d'); const id = mg.createImageData(width, height);
    for (let i = 0; i < mask.length; i++) { const a = Math.max(0, Math.min(1, (mask[i] - 0.35) / 0.3)); id.data[i * 4 + 3] = Math.round(a * 255); }
    mg.putImageData(id, 0, 0);
    const g = c.getContext('2d'); g.globalCompositeOperation = 'destination-in'; g.imageSmoothingQuality = 'high'; g.drawImage(m, 0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over';
    result = await toBlob(c, 'image/png'); c.className = 'qt-preview'; stage.replaceChildren(c); save.hidden = false; status.textContent = `${c.width}×${c.height} · ${formatBytes(result.size)}`;
  }
  const choose = btn('Choose a photo', () => busy(choose, 'Working…', async () => { const f = (await pick(false))[0]; if (f) await go(f); }), true);
  const el = tool(2, 'cutout', 'Remove background', 'One tap cut-out with the on-device AI: a person, or an object such as a pet, a car or a bottle. You get a transparent PNG. For fine edges, open the result in IMAGE and refine the mask.',
    h('div', { class: 'qt-controls' }, field('What to keep', kind)), h('div', { class: 'qt-actions' }, choose, save, status), stage);
  el._drop = (fs) => busy(choose, 'Working…', () => go(fs[0]));
  return el;
}

// ------------------------------------------------------------------ 3. palette
function paletteTool() {
  const sw = h('div', { class: 'qt-swatches' });
  const stage = h('div', { class: 'qt-stage' });
  let cols = [];
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  function kmeans(px, k) {
    // deterministic start: spread along luminance
    const sorted = px.slice().sort((a, b) => (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11) - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
    let cen = Array.from({ length: k }, (_, i) => sorted[Math.floor((i + 0.5) / k * sorted.length)].slice());
    const cnt = new Array(k).fill(0);
    for (let it = 0; it < 12; it++) {
      const sum = cen.map(() => [0, 0, 0]); cnt.fill(0);
      for (const p of px) { let b = 0, bd = 1e9; for (let i = 0; i < k; i++) { const c = cen[i], d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; b = i; } } sum[b][0] += p[0]; sum[b][1] += p[1]; sum[b][2] += p[2]; cnt[b]++; }
      cen = cen.map((c, i) => cnt[i] ? sum[i].map((v) => v / cnt[i]) : c);
    }
    return cen.map((c, i) => ({ c, n: cnt[i] })).filter((x) => x.n).sort((a, b) => b.n - a.n).map((x) => x.c);
  }
  async function go(file) {
    const bmp = await decode(file); const small = draw(bmp, 72); const view = draw(bmp, 900); bmp.close && bmp.close();
    const d = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, small.width, small.height).data; const px = [];
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]);
    if (!px.length) throw new Error('This image is fully transparent.');
    cols = kmeans(px, 6);
    sw.replaceChildren(...cols.map((c) => { const x = hex(c); const lum = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; return h('button', { class: 'qt-swatch', type: 'button', style: { background: x, color: lum > 150 ? '#0d0d0d' : '#fff' }, title: 'Copy ' + x, text: x, onclick: async () => { try { await navigator.clipboard.writeText(x); toast(x + ' copied', { type: 'ok', timeout: 1500 }); } catch (e) { toast(x); } } }); }));
    view.className = 'qt-preview'; stage.replaceChildren(view); png.hidden = false; copy.hidden = false;
  }
  const png = btn('Save palette PNG', async () => { const c = document.createElement('canvas'); c.width = 1200; c.height = 400; const g = c.getContext('2d'); cols.forEach((col, i) => { g.fillStyle = hex(col); g.fillRect(i * 1200 / cols.length, 0, 1200 / cols.length + 1, 400); g.fillStyle = (col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11) > 150 ? '#0d0d0d' : '#fff'; g.font = '600 22px system-ui, sans-serif'; g.fillText(hex(col), i * 1200 / cols.length + 16, 376); }); downloadBlob(await toBlob(c, 'image/png'), 'eyad-palette.png'); }); png.hidden = true;
  const copy = btn('Copy all', async () => { const t = cols.map(hex).join(', '); try { await navigator.clipboard.writeText(t); toast('Palette copied', { type: 'ok' }); } catch (e) { toast(t, { timeout: 8000 }); } }); copy.hidden = true;
  const choose = btn('Choose an image', () => busy(choose, 'Reading…', async () => { const f = (await pick(false))[0]; if (f) await go(f); }), true);
  const el = tool(3, 'palette', 'Colour palette', 'Pull the six main colours out of any photo, poster or screenshot. Tap a colour to copy its hex code.',
    h('div', { class: 'qt-actions' }, choose, copy, png), sw, stage);
  el._drop = (fs) => busy(choose, 'Reading…', () => go(fs[0]));
  return el;
}

// ------------------------------------------------------------------ 4. QR code
function qrTool() {
  const text = h('textarea', { class: 'studio-input', rows: 3, maxLength: 1200, placeholder: 'https://eyad-ayman.github.io — a link, Wi-Fi, phone number or any text', 'aria-label': 'QR content' });
  const fg = h('input', { type: 'color', value: '#0d0d0d', 'aria-label': 'Colour' }), bg = h('input', { type: 'color', value: '#ffffff', 'aria-label': 'Background' });
  const level = select([['M', 'Standard'], ['Q', 'Strong'], ['H', 'Strongest (for print)']], 'M');
  const canvas = h('canvas', { class: 'qt-qr', width: 720, height: 720 });
  const note = h('span', { class: 'po-mono' });
  let mod = null, cells = null;
  async function render() {
    const value = text.value.trim() || 'https://eyad-ayman.github.io/studio/';
    try {
      mod = mod || (await import('../../vendor/qrcode/qrcode.mjs')).default;
      const qr = mod(0, level.value); qr.addData(value, 'Byte'); qr.make();
      const n = qr.getModuleCount(); cells = { n, at: (r, c) => qr.isDark(r, c) };
      const quiet = 4, s = Math.floor(canvas.width / (n + quiet * 2)), off = Math.floor((canvas.width - s * n) / 2);
      const g = canvas.getContext('2d'); g.fillStyle = bg.value; g.fillRect(0, 0, canvas.width, canvas.height); g.fillStyle = fg.value;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(off + c * s, off + r * s, s, s);
      note.textContent = `${n}×${n} modules`;
    } catch (e) { note.textContent = 'That is too long for one QR code.'; cells = null; }
  }
  let t = 0; const later = () => { clearTimeout(t); t = setTimeout(render, 150); };
  for (const el of [text, fg, bg, level]) el.addEventListener('input', later);
  const svg = () => { if (!cells) return; const { n, at } = cells, q = 4, size = n + q * 2; let d = ''; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (at(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
    const safe = (v) => /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
    downloadBlob(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${safe(bg.value)}"/><path d="${d}" fill="${safe(fg.value)}"/></svg>`], { type: 'image/svg+xml' }), 'eyad-qr.svg'); };
  const el = tool(4, 'qr', 'QR code', 'A clean QR code for a link, your portfolio or a Wi-Fi password. It is made on this device and never expires — there is no tracking link in the middle.',
    h('div', { class: 'qt-qrgrid' }, h('div', { class: 'qt-qrform' }, field('Content', text), h('div', { class: 'qt-controls' }, field('Colour', fg), field('Background', bg), field('Error correction', level)),
      h('div', { class: 'qt-actions' }, btn('Save PNG', async () => { if (cells) downloadBlob(await toBlob(canvas, 'image/png'), 'eyad-qr.png'); }, true), btn('Save SVG', svg), note)), canvas));
  render();
  return el;
}

// ------------------------------------------------------------------ 5. screen recorder
function screenTool() {
  const can = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && typeof MediaRecorder !== 'undefined';
  let rec = null, stream = null, chunks = [], t0 = 0, timer = 0;
  const status = h('span', { class: 'po-mono', text: can ? 'Ready' : 'Not available in this browser (phones do not allow websites to record the screen).' });
  const video = h('video', { class: 'qt-preview', controls: true, playsInline: true, hidden: true });
  const stop = () => { try { rec && rec.state !== 'inactive' && rec.stop(); } catch (e) { /* ignore */ } };
  const go = btn('Start recording', async () => {
    if (rec && rec.state !== 'inactive') { stop(); return; }
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true }); } catch (e) { return; }
    const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    chunks = []; rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined);
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      clearInterval(timer); stream.getTracks().forEach((x) => x.stop()); go.textContent = 'Start recording';
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' }); const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
      if (video.src) URL.revokeObjectURL(video.src); video.src = URL.createObjectURL(blob); video.hidden = false;
      status.textContent = `${formatBytes(blob.size)} · ${ext.toUpperCase()}`;
      save.hidden = false; save.onclick = () => downloadBlob(blob, `eyad-screen-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`);
    };
    stream.getVideoTracks()[0].addEventListener('ended', stop);
    rec.start(1000); t0 = Date.now(); go.textContent = 'Stop'; save.hidden = true;
    timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); status.textContent = `Recording ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 500);
  }, true);
  go.disabled = !can;
  const save = btn('Save video', () => {}); save.hidden = true;
  return tool(5, 'screen', 'Screen recorder', 'Record a window, a tab or the whole screen — with its sound when the browser allows it — and save the video. Then cut it in VIDEO.',
    h('div', { class: 'qt-actions' }, go, save, h('a', { class: 'studio-btn', href: ROUTES.video, text: 'Open VIDEO' }), status), video);
}

const tools = [compressTool(), cutoutTool(), paletteTool(), qrTool(), screenTool()];
page('tools',
  h('section', { class: 'hub-pagehead' }, h('div', {},
    h('h1', { class: 'studio-page-title', text: 'Tools' }),
    h('p', { class: 'studio-dim', text: 'Quick one-job tools. They run on this device — nothing you open is uploaded.' }),
    h('nav', { class: 'qt-jump' }, [['compress', 'Compress & convert'], ['cutout', 'Remove background'], ['palette', 'Colour palette'], ['qr', 'QR code'], ['screen', 'Screen recorder']].map(([id, t]) => h('a', { class: 'po-pill', href: '#' + id, text: t }))))),
  h('div', { class: 'qt-grid' }, tools));

// drop images onto a tool
for (const el of tools) {
  if (!el._drop) continue;
  el.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('is-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('is-over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('is-over'); const fs = Array.from(e.dataTransfer?.files || []).filter((f) => /^image\//.test(f.type)); if (fs.length) el._drop(fs); });
}
bindPageDrop();
