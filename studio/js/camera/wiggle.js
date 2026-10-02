// EYAD KAMERA — Quad 3D: a four-lens stereo camera in software (the look of
// 1980s lenticular cameras such as the Nishika N8000). Four half-frames with
// slightly different viewpoints loop 1-2-3-4-3-2 as a "wigglegram".
//
// A phone has one lens, so the four viewpoints come from one of two honest
// sources:
//   • Sweep  — four frames shot in quick succession while the camera drifts
//              sideways (real parallax), then aligned on a pivot point.
//   • Depth  — one frame split into subject / background with the on-device
//              people model and re-projected to four viewpoints (2.5D).
// Everything runs on this device.

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

// ------------------------------------------------------------------ alignment (sweep)
function gray(src, w, h) {
  const c = mk(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11;
  return out;
}
/** Translation (in source pixels) that best lines frame b up with frame a around the pivot (0..1). */
function offsetBetween(a, b, w, h, px, py, range) {
  const win = Math.round(Math.min(w, h) * 0.22);
  const cx = Math.round(px * w), cy = Math.round(py * h);
  const x0 = Math.max(range, cx - win), x1 = Math.min(w - range, cx + win), y0 = Math.max(range, cy - win), y1 = Math.min(h - range, cy + win);
  let best = Infinity, bx = 0, by = 0;
  const ry = Math.round(range * 0.5);
  for (let dy = -ry; dy <= ry; dy++) for (let dx = -range; dx <= range; dx++) {
    let s = 0;
    for (let y = y0; y < y1; y += 2) { const ra = y * w, rb = (y + dy) * w; for (let x = x0; x < x1; x += 2) s += Math.abs(a[ra + x] - b[rb + x + dx]); }
    s += (Math.abs(dx) + Math.abs(dy)) * 0.6 * (x1 - x0); // prefer small moves when it is a tie
    if (s < best) { best = s; bx = dx; by = dy; }
  }
  return [bx, by];
}
/**
 * Align frames on a pivot so that point stays still and everything nearer /
 * farther swings around it. Returns { frames (cropped to the common area), spread }
 * where spread is the total sideways travel as a fraction of the width.
 */
export function alignFrames(frames, pivot = { x: 0.5, y: 0.5 }) {
  const W = frames[0].width, H = frames[0].height;
  const w = 200, h = Math.max(8, Math.round(200 * H / W)), k = W / w;
  const g = frames.map((f) => gray(f, w, h));
  const offs = [[0, 0]];
  for (let i = 1; i < frames.length; i++) { const [dx, dy] = offsetBetween(g[0], g[i], w, h, pivot.x, pivot.y, 30); offs.push([dx * k, dy * k]); }
  const xs = offs.map((o) => o[0]), ys = offs.map((o) => o[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cw = Math.max(16, Math.floor(W - (maxX - minX))), ch = Math.max(16, Math.floor(H - (maxY - minY)));
  const out = frames.map((f, i) => { const c = mk(cw, ch); c.getContext('2d').drawImage(f, -(offs[i][0] - minX) - 0, -(offs[i][1] - minY)); return c; });
  // a frame shifted by +dx shows content from further right: crop start = dx - minX
  return { frames: out, spread: (maxX - minX) / W, offsets: offs };
}

/** How different the raw frames are from each other (0 = identical): used to decide Sweep vs Depth. */
export function parallaxOf(frames) {
  const w = 96, h = Math.max(8, Math.round(96 * frames[0].height / frames[0].width));
  const g = frames.map((f) => gray(f, w, h));
  const [dx] = offsetBetween(g[0], g[g.length - 1], w, h, 0.5, 0.5, 14);
  let diff = 0; for (let i = 0; i < g[0].length; i++) diff += Math.abs(g[0][i] - g[g.length - 1][i]);
  return { shift: Math.abs(dx) / w, diff: diff / g[0].length / 255 };
}

// ------------------------------------------------------------------ 2.5D views (depth)
/**
 * Four viewpoints from one photo: the subject (mask alpha) moves one way, the
 * background the other, and the gap the subject leaves is filled from the
 * surrounding background.
 */
export function synthViews(photo, mask, n = 4, strength = 0.022) {
  const W = photo.width, H = photo.height, m = Math.max(W, H);
  const feather = Math.max(1, m * 0.003);
  // subject layer
  const subj = mk(W, H), sg = subj.getContext('2d');
  sg.drawImage(photo, 0, 0);
  sg.globalCompositeOperation = 'destination-in'; sg.filter = `blur(${feather}px)`; sg.drawImage(mask, 0, 0, W, H); sg.filter = 'none';
  // background plate: remove the subject, then fill the hole by pulling in neighbouring background
  const plate = mk(W, H), pg = plate.getContext('2d');
  pg.drawImage(photo, 0, 0);
  pg.globalCompositeOperation = 'destination-out'; pg.filter = `blur(${feather * 2}px)`; pg.drawImage(mask, 0, 0, W, H); pg.drawImage(mask, 0, 0, W, H); pg.filter = 'none';
  const fill = mk(W, H), fg = fill.getContext('2d');
  for (const r of [0.08, 0.04, 0.02, 0.008]) { fg.filter = `blur(${Math.round(m * r)}px)`; fg.drawImage(plate, 0, 0); fg.drawImage(plate, 0, 0); }
  fg.filter = 'none'; fg.drawImage(plate, 0, 0);
  // a plain copy under everything so no transparent pixel ever shows
  const base = mk(W, H), bg = base.getContext('2d');
  bg.filter = `blur(${Math.round(m * 0.03)}px)`; bg.drawImage(photo, 0, 0); bg.filter = 'none'; bg.drawImage(fill, 0, 0);
  const pad = Math.ceil(m * strength * (n - 1) * 0.5) + 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i - (n - 1) / 2; // -1.5 … 1.5
    const c = mk(W - pad * 2, H), g = c.getContext('2d');
    g.drawImage(base, -pad + t * m * strength * 0.45, 0);
    g.drawImage(subj, -pad - t * m * strength * 0.55, 0);
    out.push(c);
  }
  return out;
}

// ------------------------------------------------------------------ four lenses are never identical
/** Small per-lens differences: exposure, tint, vignette centre and a little flare — like four cheap lenses. */
export function lensCharacter(frame, i, amount = 1) {
  const W = frame.width, H = frame.height, m = Math.max(W, H);
  const L = [
    { ex: 0.97, tint: 'rgba(255,170,90,.07)', vx: 0.42, flare: 0.0 },
    { ex: 1.03, tint: 'rgba(255,240,200,.04)', vx: 0.48, flare: 0.10 },
    { ex: 1.0, tint: 'rgba(160,210,255,.05)', vx: 0.52, flare: 0.05 },
    { ex: 0.95, tint: 'rgba(120,255,200,.06)', vx: 0.58, flare: 0.0 },
  ][i % 4];
  const c = mk(W, H), g = c.getContext('2d');
  g.filter = `brightness(${1 + (L.ex - 1) * amount})`; g.drawImage(frame, 0, 0); g.filter = 'none';
  g.globalCompositeOperation = 'soft-light'; g.globalAlpha = amount; g.fillStyle = L.tint; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
  if (L.flare) {
    const gr = g.createRadialGradient(W * (0.2 + i * 0.2), H * 0.1, 0, W * (0.2 + i * 0.2), H * 0.1, m * 0.6);
    gr.addColorStop(0, `rgba(255,220,160,${L.flare * amount})`); gr.addColorStop(1, 'rgba(255,220,160,0)');
    g.globalCompositeOperation = 'screen'; g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  const vg = g.createRadialGradient(W * L.vx, H * 0.5, m * 0.3, W * L.vx, H * 0.5, m * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${0.34 * amount})`);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = vg; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  return c;
}

// ------------------------------------------------------------------ outputs
export const PING = [0, 1, 2, 3, 2, 1];

/** A scanned-negative style strip of the four half-frames. */
export function filmStrip(frames, label = 'EYAD KAMERA  ·  QUAD 3D') {
  const fh = 720, fw = Math.round(fh * frames[0].width / frames[0].height), gap = 14, padX = 40, rail = 74;
  const W = padX * 2 + frames.length * fw + (frames.length - 1) * gap, H = fh + rail * 2;
  const c = mk(W, H), g = c.getContext('2d');
  g.fillStyle = '#0c0b0a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e9e4da';
  for (let x = 18; x < W - 30; x += 52) for (const y of [16, H - 16 - 26]) { g.beginPath(); g.roundRect ? g.roundRect(x, y, 30, 26, 5) : g.rect(x, y, 30, 26); g.fill(); }
  frames.forEach((f, i) => { const x = padX + i * (fw + gap); g.drawImage(f, x, rail, fw, fh); });
  g.fillStyle = '#e8a33a'; g.font = '600 20px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
  frames.forEach((f, i) => g.fillText(String(i + 1) + 'A', padX + i * (fw + gap) + 6, rail - 14));
  g.fillText(label, padX + 60, H - rail + 14);
  return c;
}

/** Looping video of the wiggle (ping-pong), recorded from a canvas. Resolves a Blob. */
export async function wiggleVideo(frames, { fps = 8, seconds = 4, maxSize = 1080 } = {}) {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
  const k = Math.min(1, maxSize / Math.max(frames[0].width, frames[0].height));
  const c = mk(Math.round(frames[0].width * k / 2) * 2, Math.round(frames[0].height * k / 2) * 2), g = c.getContext('2d');
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });
  g.drawImage(frames[0], 0, 0, c.width, c.height);
  rec.start(200);
  const total = Math.round(seconds * fps);
  for (let i = 0; i < total; i++) {
    g.drawImage(frames[PING[i % PING.length] % frames.length], 0, 0, c.width, c.height);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  rec.stop(); await done; stream.getTracks().forEach((t) => t.stop());
  const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
  return new Blob(chunks, { type });
}

// ------------------------------------------------------------------ GIF (wigglegrams live as GIFs)
function buildPalette(pixels) {
  // median cut on a sample of RGB triples → up to 256 colours
  let boxes = [pixels];
  while (boxes.length < 256) {
    let bi = -1, br = 0, bc = 0;
    boxes.forEach((b, i) => {
      if (b.length < 6) return;
      const mn = [255, 255, 255], mx = [0, 0, 0];
      for (let j = 0; j < b.length; j += 3) for (let k = 0; k < 3; k++) { const v = b[j + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
      for (let k = 0; k < 3; k++) { const r = (mx[k] - mn[k]) * Math.sqrt(b.length); if (r > br) { br = r; bi = i; bc = k; } }
    });
    if (bi < 0) break;
    const b = boxes[bi], n = b.length / 3, idx = new Uint32Array(n);
    for (let j = 0; j < n; j++) idx[j] = j;
    idx.sort((p, q) => b[p * 3 + bc] - b[q * 3 + bc]);
    const half = n >> 1, A = new Uint8Array(half * 3), B = new Uint8Array((n - half) * 3);
    for (let j = 0; j < n; j++) { const s = idx[j] * 3, t = j < half ? A : B, o = (j < half ? j : j - half) * 3; t[o] = b[s]; t[o + 1] = b[s + 1]; t[o + 2] = b[s + 2]; }
    boxes.splice(bi, 1, A, B);
  }
  const pal = new Uint8Array(256 * 3);
  boxes.forEach((b, i) => { let r = 0, g = 0, bl = 0; const n = b.length / 3 || 1; for (let j = 0; j < b.length; j += 3) { r += b[j]; g += b[j + 1]; bl += b[j + 2]; } pal[i * 3] = r / n; pal[i * 3 + 1] = g / n; pal[i * 3 + 2] = bl / n; });
  return { pal, count: boxes.length };
}
function lzw(indices, minCode) {
  const out = []; let cur = 0, bits = 0;
  const emit = (code, size) => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1, dict = new Map();
  emit(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear, size); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix, size); emit(eoi, size);
  if (bits > 0) out.push(cur & 255);
  return out;
}
/** Animated GIF (ping-pong loop). frames: canvases. Returns a Blob. */
export function wiggleGif(frames, { fps = 8, maxSize = 480 } = {}) {
  const k = Math.min(1, maxSize / Math.max(frames[0].width, frames[0].height));
  const w = Math.round(frames[0].width * k), h = Math.round(frames[0].height * k);
  const datas = frames.map((f) => { const c = mk(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(f, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; });
  // palette from a sample of all frames
  const step = Math.max(1, Math.floor((w * h * frames.length) / 40000));
  const sample = [];
  datas.forEach((d) => { for (let i = 0; i < w * h; i += step) sample.push(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); });
  const { pal } = buildPalette(Uint8Array.from(sample));
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = cache.get(key); if (hit !== undefined) return hit;
    let best = 0, bd = Infinity;
    for (let i = 0; i < 256; i++) { const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b; const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11; if (d < bd) { bd = d; best = i; } }
    cache.set(key, best); return best;
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const indexed = datas.map((d) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, t = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) * 1.1;
      out[y * w + x] = nearest(Math.max(0, Math.min(255, d[i] + t)), Math.max(0, Math.min(255, d[i + 1] + t)), Math.max(0, Math.min(255, d[i + 2] + t)));
    }
    return out;
  });
  const bytes = [];
  const u16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
  bytes.push(...[71, 73, 70, 56, 57, 97]); u16(w); u16(h); bytes.push(0xf7, 0, 0);
  for (let i = 0; i < 768; i++) bytes.push(pal[i]);
  bytes.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((ch) => ch.charCodeAt(0)), 3, 1, 0, 0, 0); // loop forever
  const delay = Math.max(2, Math.round(100 / fps));
  for (const fi of PING) {
    const idx = indexed[fi % indexed.length];
    bytes.push(0x21, 0xf9, 4, 0, delay & 255, delay >> 8, 0, 0);
    bytes.push(0x2c); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
    bytes.push(8);
    const data = lzw(idx, 8);
    for (let p = 0; p < data.length; p += 255) { const n = Math.min(255, data.length - p); bytes.push(n); for (let q = 0; q < n; q++) bytes.push(data[p + q]); }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return new Blob([Uint8Array.from(bytes)], { type: 'image/gif' });
}
