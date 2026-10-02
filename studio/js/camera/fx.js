// EYAD KAMERA — effects on top of the film look.
//  • Flash looks (no AI): direct on-camera flash, party flash with a
//    drag-shutter ghost, paparazzi flash with star glints.
//  • AI looks: a people-segmentation model (MediaPipe selfie segmenter, bundled
//    in studio/models, runs on this device) separates the person from the
//    background → portrait blur, colour pop, sticker, neon outline, studio
//    light, dream background.
// Everything is drawn with the 2D canvas API; nothing leaves the device.
import { videoSegmenter, segment } from '../core/ai.js';

export const FX = [
  { id: 'none', name: 'No effect' },
  { id: 'flash', name: 'Flash', group: 'flash' },
  { id: 'party', name: 'Party flash', group: 'flash' },
  { id: 'paparazzi', name: 'Paparazzi', group: 'flash' },
  { id: 'portrait', name: 'Portrait blur', ai: true },
  { id: 'pop', name: 'Colour pop', ai: true },
  { id: 'sticker', name: 'Sticker', ai: true },
  { id: 'neon', name: 'Neon outline', ai: true },
  { id: 'studio', name: 'Studio light', ai: true },
  { id: 'dream', name: 'Dream background', ai: true },
  // Y2K & video looks (great for recording): old camcorders, digicams, webcams, night
  { id: 'night', name: 'Night mode', tag: 'NIGHT' },
  { id: 'nightvision', name: 'Night vision', tag: 'NIGHT' },
  { id: 'camcorder', name: 'Camcorder', tag: 'Y2K' },
  { id: 'vhs', name: 'VHS tape', tag: 'Y2K' },
  { id: 'digicam', name: 'Digicam 2003', tag: 'Y2K' },
  { id: 'webcam', name: 'Webcam 2001', tag: 'Y2K' },
  { id: 'lofi', name: 'Low quality', tag: 'Y2K' },
  { id: 'flip', name: 'Flip phone', tag: 'Y2K' },
  { id: 'security', name: 'CCTV', tag: 'Y2K' },
  { id: 'glitch', name: 'Glitch', tag: 'Y2K' },
];
export const fxById = (id) => FX.find((f) => f.id === id) || FX[0];

// ------------------------------------------------------------------ scratch canvases (reused)
const pool = new Map();
function scratch(key, w, h) {
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
    default: ctx.drawImage(src, 0, 0, w, h);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ Y2K / video looks
const MONO = '"Studio Mono", ui-monospace, Menlo, Consolas, monospace';
const rnd = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
/** Low frame-rate feel: only refresh the picture `fps` times a second. */
const heldState = { c: null, at: -1 };
function held(src, t, fps) {
  const k = Math.floor(t * fps);
  const c = heldState.c && heldState.c.width === src.width && heldState.c.height === src.height ? heldState.c : (heldState.c = scratch('held', src.width, src.height));
  if (k !== heldState.at || !t) { heldState.at = k; const g = c.getContext('2d'); g.globalCompositeOperation = 'copy'; g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-over'; }
  return c;
}
/** Down-sample to a tiny sensor and blow it back up (nearest-neighbour when blocky). */
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
const nightState = { acc: null };
function retroNight(ctx, src, w, h) {
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
