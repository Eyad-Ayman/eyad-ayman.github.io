// EYAD KAMERA — effects on top of the film look.
//  • Flash looks (no AI): direct on-camera flash, party flash with a
//    drag-shutter ghost, paparazzi flash with star glints.
//  • AI looks: a people-segmentation model (MediaPipe selfie segmenter, bundled
//    in studio/models, runs on this device) separates the person from the
//    background → portrait blur, colour pop, sticker, neon outline, studio
//    light, dream background.
// Everything is drawn with the 2D canvas API; nothing leaves the device.
import { videoSegmenter, segment } from '../core/ai.js';
import { drawDateStamp, todayStamp } from '../core/film.js';

export const FX = [
  { id: 'none', name: 'No effect' },
  { id: 'flash', name: 'Flash', group: 'flash', cat: 'flash' },
  { id: 'party', name: 'Party flash', group: 'flash', cat: 'flash' },
  { id: 'paparazzi', name: 'Paparazzi', group: 'flash', cat: 'flash' },
  { id: 'night', name: 'Night mode', tag: 'NIGHT', cat: 'flash' },
  { id: 'portrait', name: 'Portrait blur', ai: true, cat: 'ai' },
  { id: 'pop', name: 'Colour pop', ai: true, cat: 'ai' },
  { id: 'sticker', name: 'Sticker', ai: true, cat: 'ai' },
  { id: 'neon', name: 'Neon outline', ai: true, cat: 'ai' },
  { id: 'studio', name: 'Studio light', ai: true, cat: 'ai' },
  { id: 'dream', name: 'Dream background', ai: true, cat: 'ai' },
  // Y2K & video looks (great for recording): old camcorders, digicams, webcams, phones, tubes
  { id: 'flashcam', name: 'Digicam flash', tag: 'Y2K', cat: 'y2k' },
  { id: 'digicam', name: 'Digicam 2003', tag: 'Y2K', cat: 'y2k' },
  { id: 'ccd', name: 'CCD smear', tag: 'Y2K', cat: 'y2k' },
  { id: 'mirror05', name: 'Mirror selfie', tag: 'Y2K', cat: 'y2k' },
  { id: 'phonecam', name: 'Phone cam 0.3 MP', tag: 'Y2K', cat: 'y2k' },
  { id: 'flip', name: 'Flip phone', tag: 'Y2K', cat: 'y2k' },
  { id: 'webcam', name: 'Webcam 2001', tag: 'Y2K', cat: 'y2k' },
  { id: 'booth', name: 'Sticker booth', tag: 'Y2K', cat: 'y2k' },
  { id: 'camcorder', name: 'Camcorder', tag: 'Y2K', cat: 'y2k' },
  { id: 'dv', name: 'DV slow shutter', tag: 'Y2K', cat: 'y2k' },
  { id: 'vhs', name: 'VHS tape', tag: 'Y2K', cat: 'y2k' },
  { id: 'crt', name: 'CRT TV', tag: 'Y2K', cat: 'y2k' },
  { id: 'pxl', name: 'Toy cam B&W', tag: 'Y2K', cat: 'y2k' },
  { id: 'lofi', name: 'Low quality', tag: 'Y2K', cat: 'y2k' },
  { id: 'security', name: 'CCTV', tag: 'Y2K', cat: 'y2k' },
  { id: 'thermal', name: 'Thermal look', tag: 'Y2K', cat: 'y2k' },
  { id: 'nightvision', name: 'Night vision', tag: 'NIGHT', cat: 'y2k' },
  { id: 'glitch', name: 'Glitch', tag: 'Y2K', cat: 'y2k' },
];
export const fxById = (id) => FX.find((f) => f.id === id) || FX[0];

// ------------------------------------------------------------------ scratch canvases (reused)
// NS separates the live picture's scratch canvases / frame memory from the thumbnails'.
let NS = '';
const pool = new Map();
const states = new Map();
function st(name) { let s = states.get(NS + name); if (!s) { s = {}; states.set(NS + name, s); } return s; }
function scratch(key, w, h) {
  key = NS + key;
  let c = pool.get(key);
  if (!c) { c = document.createElement('canvas'); pool.set(key, c); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

/** Float mask (0..1) → canvas whose alpha is the mask. */
export function maskCanvas({ mask, width, height }, key = 'mask') {
  const c = scratch(key, width, height);
  const g = c.getContext('2d');
  const img = g.createImageData(width, height);
  const d = img.data;
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = Math.max(0, Math.min(255, (mask[i] - 0.15) * 340)); }
  g.putImageData(img, 0, 0);
  return c;
}

function subjectOf(src, mask, w, h, feather) {
  const c = scratch('subject', w, h), g = c.getContext('2d');
  g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, w, h);
  g.drawImage(src, 0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.filter = `blur(${feather}px)`;
  g.drawImage(mask, 0, 0, w, h);
  g.filter = 'none'; g.globalCompositeOperation = 'source-over';
  return c;
}
function silhouette(mask, w, h, color, feather) {
  const c = scratch('sil', w, h), g = c.getContext('2d');
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h);
  g.filter = `blur(${feather}px)`; g.drawImage(mask, 0, 0, w, h); g.filter = 'none';
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  return c;
}

// ------------------------------------------------------------------ flash
function flashBase(ctx, src, w, h, o) {
  const m = Math.max(w, h);
  ctx.filter = `contrast(${o.contrast}) saturate(${o.sat}) brightness(${o.bright})`;
  ctx.drawImage(src, 0, 0, w, h);
  ctx.filter = 'none';
  // hot spot where the flash hits
  const cx = w / 2, cy = h * 0.42;
  let gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.55);
  gr.addColorStop(0, `rgba(255,255,255,${o.hot})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.35);
  gr.addColorStop(0, `rgba(255,255,255,${o.hot * 0.28})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  // fall-off into the dark
  gr = ctx.createRadialGradient(cx, cy, m * 0.22, cx, cy, m * 0.78);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${o.vig})`);
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  if (o.tint) { ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = o.tint; ctx.fillRect(0, 0, w, h); }
  ctx.globalCompositeOperation = 'source-over';
}
function glints(ctx, src, w, h) {
  const s = scratch('glint', 48, 48), g = s.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data;
  const pts = [];
  for (let i = 0; i < 48 * 48; i++) { const l = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; if (l > 228) pts.push([l, i % 48, (i / 48) | 0]); }
  pts.sort((a, b) => b[0] - a[0]);
  const chosen = [];
  for (const p of pts) { if (chosen.length >= 5) break; if (chosen.every((q) => Math.hypot(q[1] - p[1], q[2] - p[2]) > 8)) chosen.push(p); }
  const m = Math.max(w, h);
  ctx.globalCompositeOperation = 'screen';
  for (const [, x, y] of chosen) {
    const px = (x + 0.5) / 48 * w, py = (y + 0.5) / 48 * h, r = m * 0.07;
    for (const [dx, dy, len] of [[1, 0, 1], [0, 1, 1], [0.7, 0.7, 0.45], [0.7, -0.7, 0.45]]) {
      const gr = ctx.createLinearGradient(px - dx * r * len, py - dy * r * len, px + dx * r * len, py + dy * r * len);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = gr; ctx.lineWidth = Math.max(1, m * 0.0028);
      ctx.beginPath(); ctx.moveTo(px - dx * r * len, py - dy * r * len); ctx.lineTo(px + dx * r * len, py + dy * r * len); ctx.stroke();
    }
    const gr = ctx.createRadialGradient(px, py, 0, px, py, r * 0.25);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(px - r, py - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Draw `src` into ctx (canvas size) with effect `id`.
 * mask: canvas from maskCanvas() (alpha = person) or null while the model loads.
 */
export function compose(ctx, src, mask, id, t = 0) {
  const w = ctx.canvas.width, h = ctx.canvas.height, m = Math.max(w, h);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.shadowBlur = 0;
  ctx.clearRect(0, 0, w, h);
  const fx = fxById(id);
  if (fx.ai && !mask) { ctx.drawImage(src, 0, 0, w, h); ctx.restore(); return; }
  const feather = Math.max(1, m * 0.0025);
  switch (id) {
    case 'flash': flashBase(ctx, src, w, h, { contrast: 1.2, sat: 1.1, bright: 1.05, hot: 0.55, vig: 0.62, tint: 'rgba(170,195,255,.14)' }); break;
    case 'party': {
      flashBase(ctx, src, w, h, { contrast: 1.28, sat: 1.25, bright: 1.03, hot: 0.6, vig: 0.78, tint: 'rgba(255,120,170,.16)' });
      ctx.globalAlpha = 0.3; ctx.globalCompositeOperation = 'screen'; ctx.filter = `blur(${Math.round(m * 0.006)}px)`;
      ctx.drawImage(src, -w * 0.025, -h * 0.018, w * 1.05, h * 1.036);
      ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'paparazzi': flashBase(ctx, src, w, h, { contrast: 1.25, sat: 0.95, bright: 1.08, hot: 0.7, vig: 0.7, tint: 'rgba(200,215,255,.12)' }); glints(ctx, src, w, h); break;
    case 'portrait': {
      const r = Math.round(m * 0.014);
      ctx.filter = `blur(${r}px) saturate(1.1)`; ctx.drawImage(src, -r, -r, w + r * 2, h + r * 2); ctx.filter = 'none';
      ctx.drawImage(subjectOf(src, mask, w, h, feather), 0, 0);
      break;
    }
    case 'pop':
      ctx.filter = 'grayscale(1) contrast(1.12)'; ctx.drawImage(src, 0, 0, w, h); ctx.filter = 'none';
      ctx.filter = 'saturate(1.25)'; ctx.drawImage(subjectOf(src, mask, w, h, feather), 0, 0); ctx.filter = 'none';
      break;
    case 'sticker': {
      const r = Math.round(m * 0.02);
      ctx.filter = `blur(${r}px) brightness(.72) saturate(1.4)`; ctx.drawImage(src, -r, -r, w + r * 2, h + r * 2); ctx.filter = 'none';
      const sil = silhouette(mask, w, h, '#ffffff', feather), o = Math.max(2, m * 0.009);
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = m * 0.03; ctx.shadowOffsetY = m * 0.01;
      ctx.drawImage(sil, 0, 0); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      for (let a = 0; a < 16; a++) ctx.drawImage(sil, Math.cos(a / 16 * Math.PI * 2) * o, Math.sin(a / 16 * Math.PI * 2) * o);
      ctx.drawImage(subjectOf(src, mask, w, h, feather * 0.6), 0, 0);
      break;
    }
    case 'neon': {
      ctx.filter = 'brightness(.32) saturate(1.3)'; ctx.drawImage(src, 0, 0, w, h); ctx.filter = 'none';
      const hue = (t * 40) % 360;
      const sil = silhouette(mask, w, h, `hsl(${hue},100%,62%)`, feather);
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = `hsl(${hue},100%,60%)`; ctx.shadowBlur = m * 0.035;
      ctx.drawImage(sil, 0, 0); ctx.drawImage(sil, 0, 0);
      ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(subjectOf(src, mask, w, h, feather), 0, 0);
      break;
    }
    case 'studio': {
      const gr = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.45, m * 0.75);
      gr.addColorStop(0, '#3a3a40'); gr.addColorStop(0.55, '#141416'); gr.addColorStop(1, '#050505');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.18; ctx.filter = `blur(${Math.round(m * 0.02)}px) grayscale(.6)`; ctx.drawImage(src, 0, 0, w, h); ctx.filter = 'none'; ctx.globalAlpha = 1;
      const sil = silhouette(mask, w, h, 'rgba(255,255,255,.9)', feather * 2);
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.35; ctx.shadowColor = '#fff'; ctx.shadowBlur = m * 0.02;
      ctx.drawImage(sil, 0, 0); ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'brightness(1.08) contrast(1.1)'; ctx.drawImage(subjectOf(src, mask, w, h, feather), 0, 0); ctx.filter = 'none';
      break;
    }
    case 'dream': {
      const hue = (t * 12) % 360;
      const gr = ctx.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, `hsl(${hue},85%,78%)`); gr.addColorStop(0.5, `hsl(${(hue + 60) % 360},80%,82%)`); gr.addColorStop(1, `hsl(${(hue + 140) % 360},85%,76%)`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.28; ctx.globalCompositeOperation = 'soft-light'; ctx.filter = `blur(${Math.round(m * 0.03)}px)`; ctx.drawImage(src, 0, 0, w, h);
      ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.shadowColor = 'rgba(255,255,255,.85)'; ctx.shadowBlur = m * 0.04;
      ctx.drawImage(subjectOf(src, mask, w, h, feather), 0, 0);
      ctx.shadowBlur = 0;
      break;
    }
    case 'night': retroNight(ctx, src, w, h); break;
    case 'nightvision': retroNightVision(ctx, src, w, h, t); break;
    case 'camcorder': retroCamcorder(ctx, src, w, h, t); break;
    case 'vhs': retroVhs(ctx, src, w, h, t); break;
    case 'digicam': retroLowRes(ctx, src, w, h, 640, { sat: 1.25, con: 1.15, sharp: true }); osdDate(ctx, w, h, '#ff9a2e'); break;
    case 'webcam': retroLowRes(ctx, held(src, t, 12), w, h, 320, { sat: 0.8, con: 0.92, bright: 1.08, blocky: true }); break;
    case 'lofi': retroLowRes(ctx, src, w, h, 240, { sat: 1.1, con: 1.1, blocky: true, poster: true }); break;
    case 'flip': retroLowRes(ctx, held(src, t, 10), w, h, 176, { sat: 1.3, con: 1.2, blocky: true }); osdFlip(ctx, w, h); break;
    case 'security': retroSecurity(ctx, held(src, t, 8), w, h, t); break;
    case 'glitch': retroGlitch(ctx, src, w, h, t); break;
    case 'flashcam': retroFlashCam(ctx, src, w, h); break;
    case 'mirror05': retroMirrorSelfie(ctx, src, w, h, t); break;
    case 'ccd': retroCcd(ctx, src, w, h); break;
    case 'phonecam': retroPhoneCam(ctx, held(src, t, 12), w, h, t); break;
    case 'thermal': retroThermal(ctx, src, w, h); break;
    case 'pxl': retroPxl(ctx, held(src, t, 15), w, h, t); break;
    case 'dv': retroDv(ctx, src, w, h, t); break;
    case 'booth': retroBooth(ctx, src, w, h); break;
    case 'crt': retroCrt(ctx, src, w, h, t); break;
    default: ctx.drawImage(src, 0, 0, w, h);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ Y2K / video looks
const MONO = '"Studio Mono", ui-monospace, Menlo, Consolas, monospace';
const rnd = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
/** Low frame-rate feel: only refresh the picture `fps` times a second. */
function held(src, t, fps) {
  const S = st('held'), k = Math.floor(t * fps);
  const fresh = S.w !== src.width || S.h !== src.height;
  const c = scratch('held', src.width, src.height);
  if (fresh || k !== S.at || !t) { S.at = k; S.w = src.width; S.h = src.height; const g = c.getContext('2d'); g.globalCompositeOperation = 'copy'; g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-over'; }
  return c;
}
/** Down-sample to a tiny sensor and blow it back up (nearest-neighbour when blocky). */
function lowCanvas(src, w, h, longSide, o = {}, key = 'low2') {
  const k = Math.min(1, longSide / Math.max(w, h)), sw = Math.max(8, Math.round(w * k)), sh = Math.max(8, Math.round(h * k));
  const s = scratch(key, sw, sh), g = s.getContext('2d');
  g.globalCompositeOperation = 'copy'; g.imageSmoothingEnabled = true; g.filter = `saturate(${o.sat || 1}) contrast(${o.con || 1}) brightness(${o.bright || 1})`;
  g.drawImage(src, 0, 0, sw, sh); g.filter = 'none'; g.globalCompositeOperation = 'source-over';
  return s;
}
function retroLowRes(ctx, src, w, h, longSide, o = {}) {
  const k = longSide / Math.max(w, h), sw = Math.max(8, Math.round(w * k)), sh = Math.max(8, Math.round(h * k));
  const s = scratch('lowres', sw, sh), g = s.getContext('2d');
  g.imageSmoothingEnabled = true; g.filter = `saturate(${o.sat || 1}) contrast(${o.con || 1}) brightness(${o.bright || 1})`;
  g.drawImage(src, 0, 0, sw, sh); g.filter = 'none';
  if (o.poster) { // crush to few levels, like heavy compression
    const img = g.getImageData(0, 0, sw, sh), d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = Math.round(d[i] / 36) * 36; d[i + 1] = Math.round(d[i + 1] / 36) * 36; d[i + 2] = Math.round(d[i + 2] / 51) * 51; }
    g.putImageData(img, 0, 0);
  }
  ctx.imageSmoothingEnabled = !o.blocky;
  ctx.drawImage(s, 0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  if (o.sharp) { ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(s, 0, 0, w, h); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
}
function scanlines(ctx, w, h, a = 0.18, gap = 3) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  const step = Math.max(2, Math.round(h / 240) * gap / 3 + 2);
  for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, Math.max(1, step / 2.5));
}
function noise(ctx, w, h, t, amount = 0.08) {
  const n = scratch('noise', 128, 128), g = n.getContext('2d');
  const img = g.createImageData(128, 128), d = img.data; const seed = Math.floor(t * 30);
  for (let i = 0; i < d.length; i += 4) { const v = rnd(i * 0.37 + seed * 13.7) * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  ctx.globalAlpha = amount; ctx.globalCompositeOperation = 'overlay'; ctx.imageSmoothingEnabled = false;
  const s = Math.max(1, Math.round(Math.max(w, h) / 480));
  for (let y = 0; y < h; y += 128 * s) for (let x = 0; x < w; x += 128 * s) ctx.drawImage(n, x, y, 128 * s, 128 * s);
  ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function stamp(d = new Date()) {
  const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], p = (n) => String(n).padStart(2, '0');
  const hh = d.getHours();
  return { date: `${M[d.getMonth()]}. ${p(d.getDate())} ${d.getFullYear()}`, time: `${hh % 12 || 12}:${p(d.getMinutes())} ${hh < 12 ? 'AM' : 'PM'}`, short: `'${String(d.getFullYear()).slice(2)} ${d.getMonth() + 1} ${d.getDate()}`, clock: `${p(hh)}:${p(d.getMinutes())}:${p(d.getSeconds())}` };
}
function osdText(ctx, text, x, y, size, color = '#fff', align = 'left') {
  ctx.font = `700 ${size}px ${MONO}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = Math.max(2, size * 0.14); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.textAlign = 'left';
}
function osdDate(ctx, w, h, color) { const s = stamp(), fs = Math.round(Math.min(w, h) * 0.05); osdText(ctx, s.short, w - fs * 0.8, h - fs * 0.8, fs, color, 'right'); }
function osdFlip(ctx, w, h) { const fs = Math.round(Math.min(w, h) * 0.045); osdText(ctx, '▮▮▮  ' + stamp().time, fs * 0.6, fs * 1.4, fs, '#fff'); }
function retroCamcorder(ctx, src, w, h, t) {
  retroLowRes(ctx, src, w, h, 720, { sat: 1.15, con: 1.08 });
  // soft chroma bleed
  ctx.globalAlpha = 0.25; ctx.globalCompositeOperation = 'screen'; ctx.filter = `blur(${Math.max(1, w / 400)}px) saturate(1.6)`; ctx.drawImage(src, w * 0.004, 0, w, h); ctx.filter = 'none';
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  scanlines(ctx, w, h, 0.1); noise(ctx, w, h, t, 0.07);
  const fs = Math.round(Math.min(w, h) * 0.05), s = stamp(), m = fs * 0.9;
  if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = '#ff2d2d'; ctx.beginPath(); ctx.arc(m + fs * 0.35, m + fs * 0.6, fs * 0.32, 0, 7); ctx.fill(); }
  osdText(ctx, 'REC', m + fs * 0.9, m + fs * 0.95, fs);
  const sec = Math.floor(t), tc = `${String(Math.floor(sec / 3600)).padStart(1, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  osdText(ctx, tc, w - m, m + fs * 0.95, fs, '#fff', 'right');
  osdText(ctx, s.time, m, h - m - fs * 1.2, fs); osdText(ctx, s.date, m, h - m, fs);
  // battery
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, fs * 0.1); ctx.strokeRect(w - m - fs * 1.9, h - m - fs * 0.8, fs * 1.7, fs * 0.8); ctx.fillStyle = '#fff'; ctx.fillRect(w - m - fs * 0.2, h - m - fs * 0.6, fs * 0.2, fs * 0.4); ctx.fillRect(w - m - fs * 1.75, h - m - fs * 0.65, fs * 0.95, fs * 0.5);
  osdText(ctx, 'SP', w - m - fs * 2.4, h - m, fs, '#fff', 'right');
}
function retroVhs(ctx, src, w, h, t) {
  retroLowRes(ctx, src, w, h, 480, { sat: 1.3, con: 1.05 });
  // colour channels slip sideways
  const sh = Math.max(2, w * 0.006);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.16;
  ctx.filter = 'saturate(3) hue-rotate(-40deg)'; ctx.drawImage(src, sh, 0, w, h);
  ctx.filter = 'saturate(3) hue-rotate(150deg)'; ctx.drawImage(src, -sh, 0, w, h);
  ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // tracking band rolling up the picture
  const by = h - ((t * 0.17) % 1.2) * h, bh = h * 0.05;
  ctx.drawImage(ctx.canvas, 0, by, w, bh, w * 0.02 * Math.sin(t * 20), by, w, bh);
  ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, by, w, bh * 0.3);
  // head-switching noise at the bottom
  for (let i = 0; i < 6; i++) { ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd(i + Math.floor(t * 30)) * 0.5})`; ctx.fillRect(rnd(i * 3.1 + Math.floor(t * 24)) * w, h - h * 0.02 * rnd(i + 2.2), w * 0.2 * rnd(i * 7.7 + t), Math.max(1, h * 0.004)); }
  scanlines(ctx, w, h, 0.16); noise(ctx, w, h, t, 0.12);
  const fs = Math.round(Math.min(w, h) * 0.055), m = fs;
  osdText(ctx, 'PLAY ▶', m, m + fs, fs); osdText(ctx, stamp().date, m, h - m, fs);
  osdText(ctx, 'SP', w - m, m + fs, fs, '#fff', 'right');
}
/** Night mode (live): average the last frames to calm the noise, then lift the exposure. */
function retroNight(ctx, src, w, h) {
  const nightState = st('night');
  const a = nightState.acc && nightState.acc.width === w && nightState.acc.height === h ? nightState.acc : (nightState.acc = (() => { const c = scratch('nightacc', w, h); c.getContext('2d').drawImage(src, 0, 0, w, h); return c; })());
  const g = a.getContext('2d'); g.globalAlpha = 0.22; g.drawImage(src, 0, 0, w, h); g.globalAlpha = 1;
  // gain follows the scene: a dark room is lifted hard, a bright one is left alone
  const m = scratch('nightmeter', 16, 16), mg = m.getContext('2d', { willReadFrequently: true });
  mg.drawImage(a, 0, 0, 16, 16);
  const d = mg.getImageData(0, 0, 16, 16).data; let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  const mean = sum / 256 / 255, want = Math.max(1, Math.min(2.6, 0.42 / Math.max(0.02, mean)));
  nightState.gain = nightState.gain ? nightState.gain + (want - nightState.gain) * 0.1 : want;
  const gn = nightState.gain;
  ctx.filter = `brightness(${gn.toFixed(2)}) contrast(1.05) saturate(1.12)`; ctx.drawImage(a, 0, 0, w, h); ctx.filter = 'none';
  if (gn > 1.3) { ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = Math.min(0.25, (gn - 1.3) * 0.2); ctx.drawImage(a, 0, 0, w, h); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
}
function retroNightVision(ctx, src, w, h, t) {
  ctx.filter = 'grayscale(1) brightness(1.9) contrast(1.25)'; ctx.drawImage(src, 0, 0, w, h); ctx.filter = 'none';
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#39ff5a'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
  noise(ctx, w, h, t, 0.2); scanlines(ctx, w, h, 0.12);
  const m = Math.max(w, h), gr = ctx.createRadialGradient(w / 2, h / 2, m * 0.25, w / 2, h / 2, m * 0.62);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.9)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  const fs = Math.round(Math.min(w, h) * 0.045); osdText(ctx, 'NIGHTSHOT', fs, fs * 1.6, fs, '#b6ffc2'); osdText(ctx, stamp().clock, w - fs, fs * 1.6, fs, '#b6ffc2', 'right');
}
function retroSecurity(ctx, src, w, h, t) {
  retroLowRes(ctx, src, w, h, 352, { sat: 0, con: 1.25, blocky: true });
  noise(ctx, w, h, t, 0.14); scanlines(ctx, w, h, 0.2);
  const fs = Math.round(Math.min(w, h) * 0.045), s = stamp();
  osdText(ctx, 'CAM 01', fs, fs * 1.6, fs); osdText(ctx, `${s.date}  ${s.clock}`, fs, h - fs, fs);
  if (Math.floor(t * 2) % 2 === 0) osdText(ctx, '● REC', w - fs, fs * 1.6, fs, '#ff4040', 'right');
}
function retroGlitch(ctx, src, w, h, t) {
  ctx.drawImage(src, 0, 0, w, h);
  const k = Math.floor(t * 12);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.3;
  const sh = w * 0.012 * (0.4 + rnd(k));
  ctx.filter = 'saturate(4) hue-rotate(-60deg)'; ctx.drawImage(src, sh, 0, w, h);
  ctx.filter = 'saturate(4) hue-rotate(160deg)'; ctx.drawImage(src, -sh, 0, w, h);
  ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const n = rnd(k * 3.3) > 0.45 ? 5 : 1;
  for (let i = 0; i < n; i++) { const y = rnd(k + i * 9.1) * h, bh = h * (0.01 + rnd(k * 2 + i) * 0.07), dx = (rnd(k * 5 + i) - 0.5) * w * 0.18; ctx.drawImage(src, 0, y / h * src.height, src.width, bh / h * src.height, dx, y, w, bh); }
}


// ------------------------------------------------------------------ more Y2K cameras
/** Pocket digicam at a party: small CCD, harsh direct flash, crunchy in-camera sharpening, orange LCD date. */
function retroFlashCam(ctx, src, w, h) {
  const s = lowCanvas(src, w, h, 1024, { sat: 1.28, con: 1.22, bright: 1.04 });
  flashBase(ctx, s, w, h, { contrast: 1.18, sat: 1.05, bright: 1.06, hot: 0.85, vig: 0.88, tint: 'rgba(185,205,255,.16)' });
  ctx.globalAlpha = 0.3; ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(s, 0, 0, w, h);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const fs = Math.round(Math.min(w, h) * 0.05);
  drawDateStamp(ctx, todayStamp(), w - fs * 0.9, h - fs * 0.9, fs);
}
/** Mirror selfie, 2005: soft over-exposed compact camera, bloom everywhere, the flash burning a hole in the mirror. */
function retroMirrorSelfie(ctx, src, w, h, t) {
  const m = Math.max(w, h);
  const s = lowCanvas(src, w, h, 640, { sat: 0.94, con: 0.92, bright: 1.14 });
  ctx.drawImage(s, 0, 0, w, h);
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.42; ctx.filter = `blur(${Math.max(2, Math.round(m * 0.014))}px)`; ctx.drawImage(s, 0, 0, w, h);
  ctx.filter = 'none'; ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(170,255,214,.14)'; ctx.fillRect(0, 0, w, h);
  // the flash in the mirror
  const fx = w * 0.7, fy = h * 0.3;
  ctx.globalCompositeOperation = 'screen';
  let gr = ctx.createRadialGradient(fx, fy, 0, fx, fy, m * 0.3);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,.92)'); gr.addColorStop(0.3, 'rgba(225,238,255,.4)'); gr.addColorStop(1, 'rgba(210,230,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI + 0.26, len = m * (i % 2 ? 0.2 : 0.33), dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    gr = ctx.createLinearGradient(fx - dx, fy - dy, fx + dx, fy + dy);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = gr; ctx.lineWidth = Math.max(1.5, m * 0.004); ctx.beginPath(); ctx.moveTo(fx - dx, fy - dy); ctx.lineTo(fx + dx, fy + dy); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'multiply';
  gr = ctx.createRadialGradient(w / 2, h / 2, m * 0.3, w / 2, h / 2, m * 0.8); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,10,.4)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  noise(ctx, w, h, t, 0.06);
}
/** CCD sensor overload: every bright light bleeds into a vertical streak down the whole frame, plus blooming. */
function retroCcd(ctx, src, w, h) {
  const m = Math.max(w, h);
  const s = lowCanvas(src, w, h, 1024, { sat: 1.2, con: 1.1 });
  ctx.drawImage(s, 0, 0, w, h);
  const N = 96, a = scratch('ccdmeter', N, N), ag = a.getContext('2d', { willReadFrequently: true });
  ag.drawImage(src, 0, 0, N, N);
  const d = ag.getImageData(0, 0, N, N).data;
  const line = scratch('ccdline', N, 1), lg = line.getContext('2d'), li = lg.createImageData(N, 1);
  // a frame that is bright all over does not smear on a real sensor either: only lights against something darker do
  let hot = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > 236) hot++;
  const calm = Math.max(0, 1 - hot / (N * N) * 5);
  for (let x = 0; x < N; x++) {
    let sum = 0;
    for (let y = 0; y < N; y++) { const i = (y * N + x) * 4, l = Math.max(d[i], d[i + 1], d[i + 2]); if (l > 236) sum += (l - 236) / 19; }
    const v = Math.min(1, sum / 5) * calm;
    li.data[x * 4] = 255; li.data[x * 4 + 1] = 225; li.data[x * 4 + 2] = 255; li.data[x * 4 + 3] = Math.round(v * 215);
  }
  lg.putImageData(li, 0, 0);
  ctx.globalCompositeOperation = 'screen'; ctx.imageSmoothingEnabled = true;
  ctx.drawImage(line, 0, 0, N, 1, 0, 0, w, h);
  // blooming around the blown highlights
  ctx.globalAlpha = 0.5 * calm; if (calm > 0.02) { ctx.filter = `brightness(.55) contrast(4) blur(${Math.max(2, Math.round(m * 0.012))}px)`; ctx.drawImage(s, 0, 0, w, h); }
  ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(150,190,255,.12)'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
}
/** First camera phones: 320 × 240, colour stored in coarse 8 × 8 blocks, magenta centre / green corners, noise. */
function retroPhoneCam(ctx, src, w, h, t) {
  const s = lowCanvas(src, w, h, 320, { sat: 1.15, con: 1.12, bright: 1.02 });
  const b = scratch('pc8', Math.max(2, Math.round(s.width / 8)), Math.max(2, Math.round(s.height / 8))), bg = b.getContext('2d');
  bg.imageSmoothingEnabled = true; bg.drawImage(s, 0, 0, b.width, b.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s, 0, 0, w, h);
  ctx.globalAlpha = 0.28; ctx.drawImage(b, 0, 0, w, h); ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'color'; ctx.drawImage(b, 0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  const m = Math.max(w, h), gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, m * 0.62);
  gr.addColorStop(0, 'rgba(255,120,215,.26)'); gr.addColorStop(0.55, 'rgba(200,200,200,0)'); gr.addColorStop(1, 'rgba(70,255,140,.34)');
  ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighten'; ctx.fillStyle = 'rgb(14,18,26)'; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  noise(ctx, w, h, t, 0.1);
}
/** Brightness mapped to an iron palette — the look of a thermal camera (it does not measure heat). */
let ironLut = null;
function iron() {
  if (ironLut) return ironLut;
  const stops = [[0, 0, 0, 12], [0.14, 28, 0, 96], [0.32, 120, 0, 150], [0.5, 205, 40, 110], [0.68, 245, 120, 20], [0.85, 255, 205, 40], [1, 255, 255, 235]];
  ironLut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255; let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const a = stops[k], b = stops[k + 1], f = Math.max(0, Math.min(1, (v - a[0]) / (b[0] - a[0])));
    for (let c = 0; c < 3; c++) ironLut[i * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
  }
  return ironLut;
}
function retroThermal(ctx, src, w, h) {
  const k = 200 / Math.max(w, h), sw = Math.max(8, Math.round(w * k)), sh = Math.max(8, Math.round(h * k));
  const s = scratch('thermal', sw, sh), g = s.getContext('2d', { willReadFrequently: true });
  g.filter = 'blur(1.4px) contrast(1.25)'; g.drawImage(src, 0, 0, sw, sh); g.filter = 'none';
  const img = g.getImageData(0, 0, sw, sh), d = img.data, L = iron();
  // auto-range like a thermal imager: the coldest thing in view is black, the hottest is white (eased over time)
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 16) { const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; if (l < lo) lo = l; if (l > hi) hi = l; }
  const T = st('thermal'); T.lo = T.lo == null ? lo : T.lo + (lo - T.lo) * 0.15; T.hi = T.hi == null ? hi : T.hi + (hi - T.hi) * 0.15;
  const base = T.lo, span = 255 / Math.max(24, T.hi - T.lo);
  for (let i = 0; i < d.length; i += 4) { const l = Math.max(0, Math.min(255, Math.round((((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8) - base) * span))); d[i] = L[l * 3]; d[i + 1] = L[l * 3 + 1]; d[i + 2] = L[l * 3 + 2]; }
  g.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(s, 0, 0, w, h);
  // palette bar + centre reticle (no numbers: this is a look, not a measurement)
  const m = Math.min(w, h), bw = Math.max(4, m * 0.018), bh = h * 0.5, bx = w - bw - m * 0.045, by = h * 0.25;
  const gr = ctx.createLinearGradient(0, by + bh, 0, by);
  for (let i = 0; i <= 8; i++) { const v = Math.round(i / 8 * 255); gr.addColorStop(i / 8, `rgb(${L[v * 3]},${L[v * 3 + 1]},${L[v * 3 + 2]})`); }
  ctx.fillStyle = gr; ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1, m * 0.003); ctx.strokeRect(bx, by, bw, bh);
  const r = m * 0.035; ctx.beginPath();
  ctx.moveTo(w / 2 - r, h / 2); ctx.lineTo(w / 2 - r * 0.35, h / 2); ctx.moveTo(w / 2 + r * 0.35, h / 2); ctx.lineTo(w / 2 + r, h / 2);
  ctx.moveTo(w / 2, h / 2 - r); ctx.lineTo(w / 2, h / 2 - r * 0.35); ctx.moveTo(w / 2, h / 2 + r * 0.35); ctx.lineTo(w / 2, h / 2 + r); ctx.stroke();
}
/** Toy video camera that recorded on audio cassette: ~100 lines, black & white, smeary lag, picture in a window. */
function retroPxl(ctx, src, w, h, t) {
  const k = 120 / Math.max(w, h), sw = Math.max(8, Math.round(w * k)), sh = Math.max(8, Math.round(h * k));
  const S = st('pxl');
  const fresh = S.w !== sw || S.h !== sh; S.w = sw; S.h = sh;
  const acc = scratch('pxlacc', sw, sh), g = acc.getContext('2d', { willReadFrequently: true });
  g.globalAlpha = fresh ? 1 : 0.5; g.filter = 'grayscale(1) contrast(1.22) brightness(1.12)'; g.drawImage(src, 0, 0, sw, sh); g.filter = 'none'; g.globalAlpha = 1;
  const out = scratch('pxlout', sw, sh), og = out.getContext('2d');
  const img = g.getImageData(0, 0, sw, sh), d = img.data;
  // crude auto-gain, like the toy's sensor: a dark room is lifted (and gets noisier) instead of going black
  let hi = 0; for (let i = 0; i < d.length; i += 16) if (d[i] > hi) hi = d[i];
  const gain = Math.min(3.5, 225 / Math.max(48, hi)); S.gain = S.gain == null || fresh ? gain : S.gain + (gain - S.gain) * 0.2;
  const gn = Math.max(1, S.gain);
  for (let i = 0; i < d.length; i += 4) { const v = Math.min(252, Math.round(d[i] * gn / 28) * 28); d[i] = d[i + 1] = d[i + 2] = v; }
  og.putImageData(img, 0, 0);
  ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, w, h);
  const iw = Math.round(w * 0.84), ih = Math.round(h * 0.84), ix = Math.round((w - iw) / 2), iy = Math.round((h - ih) / 2);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(out, ix, iy, iw, ih); ctx.imageSmoothingEnabled = true;
  ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
  noise(ctx, w, h, t, 0.16); scanlines(ctx, w, h, 0.14);
  ctx.restore();
}
/** MiniDV handycam in slow-shutter mode: frames blend into trails (live / video); crisp interlaced DV otherwise. */
function retroDv(ctx, src, w, h, t) {
  const S = st('dv'), fresh = S.w !== w || S.h !== h; S.w = w; S.h = h;
  const acc = scratch('dvacc', w, h), g = acc.getContext('2d');
  g.globalAlpha = fresh || !t ? 1 : 0.16; g.drawImage(src, 0, 0, w, h); g.globalAlpha = 1;
  const s = lowCanvas(acc, w, h, 720, { sat: 1.22, con: 1.06, bright: 1.03 });
  ctx.drawImage(s, 0, 0, w, h);
  ctx.globalAlpha = 0.22; ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(s, 0, 0, w, h); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  scanlines(ctx, w, h, 0.07); noise(ctx, w, h, t, 0.05);
  const fs = Math.round(Math.min(w, h) * 0.045), m = fs * 0.9, sp = stamp();
  osdText(ctx, 'SLOW SHUTTER', m, m + fs, fs); osdText(ctx, '1/4', w - m, m + fs, fs, '#fff', 'right');
  osdText(ctx, sp.date, m, h - m, fs); osdText(ctx, sp.time, w - m, h - m, fs, '#fff', 'right');
}
/** Sticker photo booth: blown-out soft skin, pink light, a hand-decorated frame of hearts, stars and sparkles. */
function heart(ctx, x, y, s) { ctx.beginPath(); ctx.moveTo(x, y + s * 0.3); ctx.bezierCurveTo(x - s * 0.5, y - s * 0.25, x - s, y + s * 0.3, x, y + s); ctx.bezierCurveTo(x + s, y + s * 0.3, x + s * 0.5, y - s * 0.25, x, y + s * 0.3); ctx.closePath(); }
function starPath(ctx, x, y, r, pts = 5, inner = 0.45, rot = -Math.PI / 2) { ctx.beginPath(); for (let i = 0; i < pts * 2; i++) { const a = rot + i * Math.PI / pts, rr = i % 2 ? r * inner : r; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); }
function retroBooth(ctx, src, w, h) {
  const m = Math.max(w, h), mn = Math.min(w, h);
  ctx.filter = 'brightness(1.2) contrast(.9) saturate(1.12)'; ctx.drawImage(src, 0, 0, w, h); ctx.filter = 'none';
  const s = lowCanvas(src, w, h, 480, { bright: 1.15 });
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.4; ctx.filter = `blur(${Math.max(2, Math.round(m * 0.012))}px)`; ctx.drawImage(s, 0, 0, w, h);
  ctx.filter = 'none'; ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(255,170,205,.22)'; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  // frame
  const b = mn * 0.045, r = mn * 0.07;
  const gr = ctx.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#ff9ccb'); gr.addColorStop(0.5, '#c9a6ff'); gr.addColorStop(1, '#8fd8ff');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.rect(0, 0, w, h);
  const x0 = b, y0 = b, x1 = w - b, y1 = h - b * 2.6;
  ctx.moveTo(x0 + r, y0); ctx.arcTo(x0, y0, x0, y0 + r, r); ctx.lineTo(x0, y1 - r); ctx.arcTo(x0, y1, x0 + r, y1, r); ctx.lineTo(x1 - r, y1); ctx.arcTo(x1, y1, x1, y1 - r, r); ctx.lineTo(x1, y0 + r); ctx.arcTo(x1, y0, x1 - r, y0, r); ctx.closePath();
  ctx.fill('evenodd');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, mn * 0.006); ctx.setLineDash([mn * 0.02, mn * 0.014]);
  ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.arcTo(x1, y0, x1, y1, r); ctx.arcTo(x1, y1, x0, y1, r); ctx.arcTo(x0, y1, x0, y0, r); ctx.arcTo(x0, y0, x1, y0, r); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  // decorations (fixed places so video does not flicker)
  const deco = [[0.1, 0.1, 0.06, 'h', '#ff4f9a'], [0.88, 0.09, 0.055, 's', '#ffe14d'], [0.93, 0.3, 0.03, 'h', '#ff8ac0'], [0.07, 0.34, 0.035, 's', '#fff'], [0.08, 0.7, 0.045, 's', '#ffe14d'], [0.92, 0.66, 0.05, 'h', '#ff4f9a'], [0.2, 0.05, 0.028, 'p', '#fff'], [0.75, 0.16, 0.03, 'p', '#fff'], [0.16, 0.5, 0.024, 'p', '#fff'], [0.85, 0.48, 0.026, 'p', '#fff'], [0.3, 0.14, 0.02, 'p', '#fff']];
  ctx.lineJoin = 'round';
  for (const [fx, fy, fsz, kind, col] of deco) {
    const x = fx * w, y = fy * (y1 + b), sz = fsz * mn;
    if (kind === 'h') heart(ctx, x, y - sz * 0.5, sz); else if (kind === 's') starPath(ctx, x, y, sz); else starPath(ctx, x, y, sz, 4, 0.22);
    if (kind !== 'p') { ctx.strokeStyle = '#fff'; ctx.lineWidth = sz * 0.28; ctx.stroke(); }
    ctx.fillStyle = col; ctx.fill();
  }
  const fs = Math.round(b * 1.25), d = new Date(), p = (n) => String(n).padStart(2, '0');
  ctx.font = `700 ${fs}px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", ui-rounded, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = fs * 0.22; const text = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`, ty = h - b * 1.3;
  ctx.strokeText(text, w / 2, ty); ctx.fillStyle = '#ff4f9a'; ctx.fillText(text, w / 2, ty);
  const tw = ctx.measureText(text).width;
  for (const sx of [-1, 1]) { heart(ctx, w / 2 + sx * (tw / 2 + fs * 0.9), ty - fs * 0.42, fs * 0.42); ctx.fillStyle = '#fff'; ctx.fill(); starPath(ctx, w / 2 + sx * (tw / 2 + fs * 2.1), ty, fs * 0.36); ctx.fillStyle = '#ffe14d'; ctx.fill(); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
/** A picture tube filmed off the screen: RGB phosphor stripes, scan lines, bloom, a hum bar, curved-glass corners. */
function retroCrt(ctx, src, w, h, t) {
  const m = Math.max(w, h), mn = Math.min(w, h);
  const s = lowCanvas(src, w, h, 640, { sat: 1.3, con: 1.08, bright: 1.3 });
  ctx.drawImage(s, 0, 0, w, h);
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.35; ctx.filter = `blur(${Math.max(2, Math.round(m * 0.008))}px)`; ctx.drawImage(s, 0, 0, w, h);
  ctx.filter = 'none'; ctx.globalAlpha = 1;
  // phosphor stripes
  const c = Math.max(1, Math.round(mn / 520)), S = st('crt');
  if (S.c !== c || !S.tile) {
    const tile = document.createElement('canvas'); tile.width = c * 3; tile.height = c * 3; const tg = tile.getContext('2d');
    ['#ff9a9a', '#9aff9a', '#9a9aff'].forEach((col, i) => { tg.fillStyle = col; tg.fillRect(i * c, 0, c, c * 3); });
    tg.fillStyle = 'rgba(0,0,0,.32)'; tg.fillRect(0, c * 3 - Math.max(1, Math.round(c * 0.8)), c * 3, Math.max(1, Math.round(c * 0.8)));
    S.tile = tile; S.c = c; S.pat = null;
  }
  const pat = ctx.createPattern(S.tile, 'repeat');
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h);
  // hum bar drifting up, vignette
  const by = h - ((t * 0.11) % 1.3) * h, bh = h * 0.22;
  let gr = ctx.createLinearGradient(0, by, 0, by + bh); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, by, w, bh);
  gr = ctx.createRadialGradient(w / 2, h / 2, m * 0.3, w / 2, h / 2, m * 0.75); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  // tube corners + glass glare
  const r = mn * 0.09, e = mn * 0.012;
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.rect(0, 0, w, h);
  ctx.moveTo(e + r, e); ctx.arcTo(e, e, e, e + r, r); ctx.lineTo(e, h - e - r); ctx.arcTo(e, h - e, e + r, h - e, r); ctx.lineTo(w - e - r, h - e); ctx.arcTo(w - e, h - e, w - e, h - e - r, r); ctx.lineTo(w - e, e + r); ctx.arcTo(w - e, e, w - e - r, e, r); ctx.closePath();
  ctx.fill('evenodd');
  gr = ctx.createLinearGradient(0, 0, w * 0.7, h * 0.7); gr.addColorStop(0, 'rgba(255,255,255,.1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.02)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
}

/** Small preview of an effect for the looks strip (keeps the live picture's frame memory untouched). */
export function composeThumb(ctx, src, mask, id) {
  NS = 'thumb:';
  try { compose(ctx, src, mask, id, 1.37); } finally { NS = ''; }
}

// ------------------------------------------------------------------ segmentation
let seg = null, segP = null, lastTs = 0;
/** Starts loading the live people segmenter (bundled model, on-device). */
export function loadSegmenter(onStatus) {
  if (seg) return Promise.resolve(seg);
  if (!segP) segP = videoSegmenter(onStatus).then((s) => { seg = s; return s; }).catch((e) => { segP = null; throw e; });
  return segP;
}
export const segmenterReady = () => !!seg;

/** Live mask for a rendered frame (canvas) — synchronous once the model is loaded. */
export function liveMask(source) {
  if (!seg) return null;
  const sw = source.width, sh = source.height; if (!sw || !sh) return null;
  const k = Math.min(1, 320 / Math.max(sw, sh));
  const small = scratch('segin', Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k)));
  small.getContext('2d').drawImage(source, 0, 0, small.width, small.height);
  let ts = Math.round(performance.now()); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
  const r = seg.segmentForVideo(small, ts);
  try {
    const cm = r.confidenceMasks && r.confidenceMasks[0]; if (!cm) return null;
    return maskCanvas({ mask: cm.getAsFloat32Array(), width: cm.width, height: cm.height }, 'livemask');
  } finally { r.close && r.close(); }
}

/** Full-resolution still: segments the developed photo and returns a new canvas with the effect. */
export async function applyFxStill(canvas, id, onStatus) {
  if (!id || id === 'none') return canvas;
  let mask = null;
  if (fxById(id).ai) {
    const res = await segment(canvas, 'person', { onStatus });
    mask = maskCanvas(res, 'stillmask');
  }
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height;
  compose(out.getContext('2d'), canvas, mask, id, performance.now() / 1000);
  return out;
}

/** Person mask for the thumbnails (only when the live segmenter is already loaded). */
export function thumbMask(source) {
  NS = 'thumb:';
  try { return liveMask(source); } catch (e) { return null; } finally { NS = ''; }
}
