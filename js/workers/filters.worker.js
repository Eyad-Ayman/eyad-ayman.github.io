// EYAD IMAGE — pixel filters & adjustments, run off the main thread.
// Message: { id, op, params, width, height, buffer (ArrayBuffer RGBA) }
// Reply:   { id, buffer } (transferred) or { id, error }

self.onmessage = (e) => {
  const { id, op, params, width, height, buffer } = e.data;
  try {
    const px = new Uint8ClampedArray(buffer);
    const fn = OPS[op];
    if (!fn) throw new Error('Unknown filter: ' + op);
    const out = fn(px, width, height, params || {}) || px;
    self.postMessage({ id, buffer: out.buffer }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h, s, l) {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

function boxBlurH(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1), W1 = w - 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let c = 0; c < 4; c++) {
      let val = 0;
      for (let j = -r; j <= r; j++) val += src[(row + Math.min(W1, Math.max(0, j))) * 4 + c];
      for (let x = 0; x < w; x++) {
        dst[(row + x) * 4 + c] = val * iarr;
        const add = Math.min(W1, x + r + 1), sub = Math.max(0, x - r);
        val += src[(row + add) * 4 + c] - src[(row + sub) * 4 + c];
      }
    }
  }
}
function boxBlurV(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1), H1 = h - 1;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let val = 0;
      for (let j = -r; j <= r; j++) val += src[(Math.min(H1, Math.max(0, j)) * w + x) * 4 + c];
      for (let y = 0; y < h; y++) {
        dst[(y * w + x) * 4 + c] = val * iarr;
        const add = Math.min(H1, y + r + 1), sub = Math.max(0, y - r);
        val += src[(add * w + x) * 4 + c] - src[(sub * w + x) * 4 + c];
      }
    }
  }
}
function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}
function gaussian(px, w, h, radius) {
  if (radius <= 0) return px;
  // premultiply to avoid dark halos around transparency
  const a = new Float32Array(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const al = px[i + 3] / 255;
    a[i] = px[i] * al; a[i + 1] = px[i + 1] * al; a[i + 2] = px[i + 2] * al; a[i + 3] = px[i + 3];
  }
  const b = new Float32Array(px.length);
  const boxes = boxesForGauss(radius / 2, 3);
  for (const bx of boxes) {
    const r = Math.max(0, Math.floor((bx - 1) / 2));
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const al = a[i + 3];
    out[i + 3] = al;
    if (al > 0) { const k = 255 / al; out[i] = a[i] * k; out[i + 1] = a[i + 1] * k; out[i + 2] = a[i + 2] * k; }
  }
  return out;
}

function convolve(px, w, h, k, { bias = 0, keepAlpha = true, gray = false } = {}) {
  const out = new Uint8ClampedArray(px.length);
  const side = Math.round(Math.sqrt(k.length)), half = side >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < side; ky++) {
        const sy = Math.min(h - 1, Math.max(0, y + ky - half));
        for (let kx = 0; kx < side; kx++) {
          const sx = Math.min(w - 1, Math.max(0, x + kx - half));
          const o = (sy * w + sx) * 4, wt = k[ky * side + kx];
          r += px[o] * wt; g += px[o + 1] * wt; b += px[o + 2] * wt;
        }
      }
      const i = (y * w + x) * 4;
      if (gray) { const v = clamp((r + g + b) / 3 + bias); out[i] = out[i + 1] = out[i + 2] = v; }
      else { out[i] = clamp(r + bias); out[i + 1] = clamp(g + bias); out[i + 2] = clamp(b + bias); }
      out[i + 3] = keepAlpha ? px[i + 3] : 255;
    }
  }
  return out;
}

const OPS = {
  brightnessContrast(px, w, h, { brightness = 0, contrast = 0 }) {
    const c = contrast / 100;
    const f = c >= 0 ? 1 / Math.max(0.01, 1 - c * 0.99) : 1 + c;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = clamp((i - 128) * f + 128 + brightness);
    for (let i = 0; i < px.length; i += 4) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
    return px;
  },
  hueSaturation(px, w, h, { hue = 0, saturation = 0, lightness = 0 }) {
    const hs = hue / 360, sf = 1 + saturation / 100, lf = lightness / 100;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      let [hh, s, l] = rgb2hsl(px[i], px[i + 1], px[i + 2]);
      hh = (hh + hs + 1) % 1;
      s = Math.min(1, Math.max(0, s * sf));
      l = lf >= 0 ? l + (1 - l) * lf : l * (1 + lf);
      const [r, g, b] = hsl2rgb(hh, s, l);
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
    return px;
  },
  exposure(px, w, h, { exposure = 0, offset = 0, gamma = 1 }) {
    const m = Math.pow(2, exposure), gi = 1 / Math.max(0.01, gamma);
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      // work in linear light
      const lin = Math.pow(i / 255, 2.2) * m + offset;
      lut[i] = clamp(Math.pow(Math.max(0, lin), 1 / 2.2 * gi) * 255);
    }
    for (let i = 0; i < px.length; i += 4) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
    return px;
  },
  invert(px) { for (let i = 0; i < px.length; i += 4) { px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; px[i + 2] = 255 - px[i + 2]; } return px; },
  desaturate(px) { for (let i = 0; i < px.length; i += 4) { const v = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722; px[i] = px[i + 1] = px[i + 2] = v; } return px; },
  sepia(px, w, h, { amount = 100 }) {
    const a = amount / 100;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      px[i] = r + ((r * 0.393 + g * 0.769 + b * 0.189) - r) * a;
      px[i + 1] = g + ((r * 0.349 + g * 0.686 + b * 0.168) - g) * a;
      px[i + 2] = b + ((r * 0.272 + g * 0.534 + b * 0.131) - b) * a;
    }
    return px;
  },
  threshold(px, w, h, { level = 128 }) {
    for (let i = 0; i < px.length; i += 4) { const v = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) >= level ? 255 : 0; px[i] = px[i + 1] = px[i + 2] = v; }
    return px;
  },
  posterize(px, w, h, { levels = 4 }) {
    const n = Math.max(2, levels | 0), step = 255 / (n - 1);
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) px[i + c] = Math.round(Math.round(px[i + c] / step) * step);
    return px;
  },
  gaussianBlur(px, w, h, { radius = 4 }) { return gaussian(px, w, h, radius); },
  sharpen(px, w, h, { amount = 60, radius = 1.5 }) {
    const blur = gaussian(new Uint8ClampedArray(px), w, h, radius);
    const k = amount / 100;
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) px[i + c] = clamp(px[i + c] + (px[i + c] - blur[i + c]) * k * 2);
    return px;
  },
  noise(px, w, h, { amount = 12, mono = true }) {
    const a = amount * 2.55;
    for (let i = 0; i < px.length; i += 4) {
      if (mono) { const n = (Math.random() - 0.5) * a; px[i] = clamp(px[i] + n); px[i + 1] = clamp(px[i + 1] + n); px[i + 2] = clamp(px[i + 2] + n); }
      else for (let c = 0; c < 3; c++) px[i + c] = clamp(px[i + c] + (Math.random() - 0.5) * a);
    }
    return px;
  },
  pixelate(px, w, h, { size = 12 }) {
    const s = Math.max(2, size | 0);
    for (let by = 0; by < h; by += s) {
      for (let bx = 0; bx < w; bx += s) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        const ey = Math.min(h, by + s), ex = Math.min(w, bx + s);
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const o = (y * w + x) * 4; const al = px[o + 3]; r += px[o] * al; g += px[o + 1] * al; b += px[o + 2] * al; a += al; n++; }
        const R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0, A = a / n;
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const o = (y * w + x) * 4; px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = A; }
      }
    }
    return px;
  },
  emboss(px, w, h) { return convolve(px, w, h, [-2, -1, 0, -1, 1, 1, 0, 1, 2], { bias: 0 }); },
  findEdges(px, w, h) {
    const out = convolve(px, w, h, [-1, -1, -1, -1, 8, -1, -1, -1, -1], { gray: true });
    for (let i = 0; i < out.length; i += 4) { out[i] = 255 - out[i]; out[i + 1] = 255 - out[i + 1]; out[i + 2] = 255 - out[i + 2]; }
    return out;
  },
  vignette(px, w, h, { amount = 50, size = 60 }) {
    const cx = w / 2, cy = h / 2, maxd = Math.sqrt(cx * cx + cy * cy), inner = size / 100, a = amount / 100;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxd;
      const t = d <= inner ? 0 : Math.min(1, (d - inner) / (1 - inner));
      const f = 1 - a * t * t;
      const o = (y * w + x) * 4;
      px[o] *= f; px[o + 1] *= f; px[o + 2] *= f;
    }
    return px;
  },
  /** Blend processed pixels back through a selection mask: mix(orig, processed, mask.alpha). */
  maskMix(px, w, h, { orig, mask }) {
    const o = new Uint8ClampedArray(orig), m = new Uint8ClampedArray(mask);
    for (let i = 0; i < px.length; i += 4) {
      const k = m[i + 3] / 255;
      if (k >= 1) continue;
      for (let c = 0; c < 4; c++) px[i + c] = o[i + c] + (px[i + c] - o[i + c]) * k;
    }
    return px;
  },
};

// =====================================================================
// Pro adjustments, filters, Camera Raw development and content-aware fill.
// =====================================================================

const lum = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const s2l = new Float32Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; s2l[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const l2sExact = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const L2S = new Float32Array(4097); for (let i = 0; i <= 4096; i++) L2S[i] = l2sExact(i / 4096);
const l2s = (v) => (v <= 0 ? 0 : v >= 1 ? l2sExact(v) : L2S[(v * 4096 + 0.5) | 0]);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Monotone cubic curve through control points (0..255) → 256 LUT. */
function curveLUT(points) {
  const pts = (points && points.length >= 2 ? points : [[0, 0], [255, 255]]).map((p) => [Number(p[0]), Number(p[1])]).sort((a, b) => a[0] - b[0]);
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const lut = new Uint8ClampedArray(256);
  let k = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) { lut[x] = ys[0]; continue; }
    if (x >= xs[n - 1]) { lut[x] = ys[n - 1]; continue; }
    while (k < n - 2 && x > xs[k + 1]) k++;
    const hh = xs[k + 1] - xs[k], t = (x - xs[k]) / hh, t2 = t * t, t3 = t2 * t;
    lut[x] = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * hh * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * hh * m[k + 1];
  }
  return lut;
}

/** Gaussian blur of a single float channel. */
function blurChannel(ch, w, h, radius) {
  if (radius <= 0.3) return ch.slice();
  const a = ch.slice(), b = new Float32Array(ch.length);
  const boxes = boxesForGauss(radius / 2, 3);
  const bh = (src, dst, r) => { const ia = 1 / (r + r + 1), W1 = w - 1; for (let y = 0; y < h; y++) { const row = y * w; let v = 0; for (let j = -r; j <= r; j++) v += src[row + Math.min(W1, Math.max(0, j))]; for (let x = 0; x < w; x++) { dst[row + x] = v * ia; v += src[row + Math.min(W1, x + r + 1)] - src[row + Math.max(0, x - r)]; } } };
  const bv = (src, dst, r) => { const ia = 1 / (r + r + 1), H1 = h - 1; for (let x = 0; x < w; x++) { let v = 0; for (let j = -r; j <= r; j++) v += src[Math.min(H1, Math.max(0, j)) * w + x]; for (let y = 0; y < h; y++) { dst[y * w + x] = v * ia; v += src[Math.min(H1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x]; } } };
  for (const bx of boxes) { const r = Math.max(0, Math.floor((bx - 1) / 2)); bh(a, b, r); bv(b, a, r); }
  return a;
}

function sampleBilinear(px, w, h, x, y, out, o) {
  if (x < 0) x = 0; if (y < 0) y = 0; if (x > w - 1) x = w - 1; if (y > h - 1) y = h - 1;
  const x0 = x | 0, y0 = y | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 4; c++) out[o + c] = (px[i00 + c] * (1 - fx) + px[i10 + c] * fx) * (1 - fy) + (px[i01 + c] * (1 - fx) + px[i11 + c] * fx) * fy;
}
function remap(px, w, h, fn) {
  const out = new Uint8ClampedArray(px.length);
  const p = { x: 0, y: 0 };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { fn(x, y, p); sampleBilinear(px, w, h, p.x, p.y, out, (y * w + x) * 4); }
  return out;
}
function hexRgb(hex) { const n = parseInt(String(hex || '#000000').slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hueRgb(hDeg) { const [r, g, b] = hsl2rgb(((hDeg % 360) + 360) % 360 / 360, 1, 0.5); return [r / 255, g / 255, b / 255]; }

// 8 hue bands for the colour mixer / B&W (degrees)
const BANDS = [0, 30, 60, 120, 180, 240, 275, 310];
function bandWeights(hDeg, out) {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let d = Math.abs(hDeg - BANDS[i]); if (d > 180) d = 360 - d;
    const next = BANDS[(i + 1) % 8], prev = BANDS[(i + 7) % 8];
    const span = Math.max(20, (((next - BANDS[i]) + 360) % 360 + ((BANDS[i] - prev) + 360) % 360) / 2);
    const w = Math.max(0, 1 - d / span);
    out[i] = w; sum += w;
  }
  if (sum > 0) for (let i = 0; i < 8; i++) out[i] /= sum;
}

Object.assign(OPS, {
  levels(px, w, h, { inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255, channel = 'rgb' }) {
    const lut = new Uint8ClampedArray(256), g = 1 / Math.max(0.05, gamma), span = Math.max(1, inWhite - inBlack);
    for (let i = 0; i < 256; i++) { const t = Math.max(0, Math.min(1, (i - inBlack) / span)); lut[i] = outBlack + Math.pow(t, g) * (outWhite - outBlack); }
    const chs = channel === 'r' ? [0] : channel === 'g' ? [1] : channel === 'b' ? [2] : [0, 1, 2];
    for (let i = 0; i < px.length; i += 4) for (const c of chs) px[i + c] = lut[px[i + c]];
    return px;
  },
  curves(px, w, h, { rgb, r, g, b }) {
    const L = curveLUT(rgb), R = curveLUT(r), G = curveLUT(g), B = curveLUT(b);
    for (let i = 0; i < px.length; i += 4) { px[i] = L[R[px[i]]]; px[i + 1] = L[G[px[i + 1]]]; px[i + 2] = L[B[px[i + 2]]]; }
    return px;
  },
  vibrance(px, w, h, { vibrance = 0, saturation = 0 }) {
    const v = vibrance / 100, s = saturation / 100;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0, L = lum(r, g, b);
      const k = 1 + s + v * (1 - sat) * (v > 0 ? 1 - 0.5 * smooth(0.55, 0.95, (r - Math.max(g, b)) / 255 + 0.5) : 1);
      px[i] = clamp(L + (r - L) * k); px[i + 1] = clamp(L + (g - L) * k); px[i + 2] = clamp(L + (b - L) * k);
    }
    return px;
  },
  colorBalance(px, w, h, p) {
    const sh = [p.sCR || 0, p.sMG || 0, p.sYB || 0], md = [p.mCR || 0, p.mMG || 0, p.mYB || 0], hi = [p.hCR || 0, p.hMG || 0, p.hYB || 0];
    const preserve = p.preserve !== false;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2], L = lum(r, g, b) / 255;
      const ws = Math.max(0, 1 - L * 2.2) ** 1.2, wh = Math.max(0, L * 2.2 - 1.2) ** 1.2, wm = Math.max(0, 1 - ws - wh);
      const add = (c) => (sh[c] * ws + md[c] * wm + hi[c] * wh) * 0.9;
      let R = r + add(0), G = g + add(1), B = b + add(2);
      if (preserve) { const L2 = lum(R, G, B); const d = L * 255 - L2; R += d; G += d; B += d; }
      px[i] = clamp(R); px[i + 1] = clamp(G); px[i + 2] = clamp(B);
    }
    return px;
  },
  blackWhite(px, w, h, { reds = 40, yellows = 60, greens = 40, cyans = 60, blues = 20, magentas = 80, tint = false, tintHue = 35, tintSat = 20 }) {
    const wts = [reds, (reds + yellows) / 2, yellows, greens, cyans, blues, (blues + magentas) / 2, magentas].map((v) => v / 100);
    const bw = new Float32Array(8), tc = hueRgb(tintHue), ts = tintSat / 100;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const [hh, s] = rgb2hsl(r, g, b);
      bandWeights(hh * 360, bw);
      let f = 0; for (let k = 0; k < 8; k++) f += bw[k] * wts[k];
      const base = lum(r, g, b);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      let v = base + (mx - mn) * (f - 0.5) * 1.1 * Math.min(1, s * 1.5);
      v = clamp(v);
      if (tint) { px[i] = clamp(v + (tc[0] - 0.5) * 255 * ts * 0.6); px[i + 1] = clamp(v + (tc[1] - 0.5) * 255 * ts * 0.6); px[i + 2] = clamp(v + (tc[2] - 0.5) * 255 * ts * 0.6); }
      else px[i] = px[i + 1] = px[i + 2] = v;
    }
    return px;
  },
  channelMixer(px, w, h, p) {
    const m = [[p.rr ?? 100, p.rg ?? 0, p.rb ?? 0], [p.gr ?? 0, p.gg ?? 100, p.gb ?? 0], [p.br ?? 0, p.bg ?? 0, p.bb ?? 100]].map((r) => r.map((v) => v / 100));
    const mono = !!p.monochrome;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (mono) { const v = clamp(r * m[0][0] + g * m[0][1] + b * m[0][2]); px[i] = px[i + 1] = px[i + 2] = v; }
      else { px[i] = clamp(r * m[0][0] + g * m[0][1] + b * m[0][2]); px[i + 1] = clamp(r * m[1][0] + g * m[1][1] + b * m[1][2]); px[i + 2] = clamp(r * m[2][0] + g * m[2][1] + b * m[2][2]); }
    }
    return px;
  },
  gradientMap(px, w, h, { from = '#000000', to = '#ffffff', reverse = false }) {
    let a = hexRgb(from), b = hexRgb(to); if (reverse) [a, b] = [b, a];
    for (let i = 0; i < px.length; i += 4) { const t = lum(px[i], px[i + 1], px[i + 2]) / 255; for (let c = 0; c < 3; c++) px[i + c] = a[c] + (b[c] - a[c]) * t; }
    return px;
  },
  photoFilter(px, w, h, { color = '#ec8a00', density = 25, preserve = true }) {
    const c = hexRgb(color), d = density / 100;
    for (let i = 0; i < px.length; i += 4) {
      const L = lum(px[i], px[i + 1], px[i + 2]);
      let R = px[i] * (1 - d) + px[i] * c[0] / 255 * d * 1.6, G = px[i + 1] * (1 - d) + px[i + 1] * c[1] / 255 * d * 1.6, B = px[i + 2] * (1 - d) + px[i + 2] * c[2] / 255 * d * 1.6;
      if (preserve) { const k = L / Math.max(1, lum(R, G, B)); R *= k; G *= k; B *= k; }
      px[i] = clamp(R); px[i + 1] = clamp(G); px[i + 2] = clamp(B);
    }
    return px;
  },
  shadowsHighlights(px, w, h, { shadows = 35, highlights = 0, radius = 30 }) {
    const n = w * h, L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = lum(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) / 255;
    const B = blurChannel(L, w, h, radius);
    const s = shadows / 100, hl = highlights / 100;
    for (let i = 0; i < n; i++) {
      const b = B[i];
      const gain = 1 + s * Math.pow(1 - b, 2) * 1.6 - hl * Math.pow(b, 2) * 0.8;
      const k = i * 4;
      for (let c = 0; c < 3; c++) px[k + c] = clamp(px[k + c] * gain);
    }
    return px;
  },
  solarize(px) { for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) if (px[i + c] > 127) px[i + c] = 255 - px[i + c]; return px; },

  // ------------------------------------------------------------ filters
  motionBlur(px, w, h, { angle = 0, distance = 20 }) {
    const a = angle * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a), n = Math.max(1, Math.round(distance));
    const out = new Uint8ClampedArray(px.length), tmp = new Float32Array(4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let k = -n; k <= n; k++) {
        const sx = x + dx * k * 0.5, sy = y + dy * k * 0.5;
        sampleBilinear(px, w, h, sx, sy, tmp, 0);
        const aa = tmp[3]; r += tmp[0] * aa; g += tmp[1] * aa; b += tmp[2] * aa; al += aa;
      }
      const o = (y * w + x) * 4, cnt = 2 * n + 1;
      out[o + 3] = al / cnt;
      if (al > 0) { out[o] = r / al; out[o + 1] = g / al; out[o + 2] = b / al; }
    }
    return out;
  },
  radialBlur(px, w, h, { amount = 20, mode = 'zoom', cx = 50, cy = 50 }) {
    const ox = w * cx / 100, oy = h * cy / 100, out = new Uint8ClampedArray(px.length), tmp = new Float32Array(4);
    const N = Math.max(4, Math.min(48, Math.round(amount)));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      const vx = x - ox, vy = y - oy;
      for (let k = 0; k < N; k++) {
        const t = (k / (N - 1) - 0.5);
        let sx, sy;
        if (mode === 'spin') { const ang = t * amount * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang); sx = ox + vx * c - vy * s; sy = oy + vx * s + vy * c; }
        else { const f = 1 + t * amount / 100; sx = ox + vx * f; sy = oy + vy * f; }
        sampleBilinear(px, w, h, sx, sy, tmp, 0);
        const aa = tmp[3]; r += tmp[0] * aa; g += tmp[1] * aa; b += tmp[2] * aa; al += aa;
      }
      const o = (y * w + x) * 4;
      out[o + 3] = al / N; if (al > 0) { out[o] = r / al; out[o + 1] = g / al; out[o + 2] = b / al; }
    }
    return out;
  },
  unsharpMask(px, w, h, { amount = 100, radius = 1.2, threshold = 0 }) {
    const blur = gaussian(new Uint8ClampedArray(px), w, h, radius), k = amount / 100;
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) {
      const d = px[i + c] - blur[i + c];
      if (Math.abs(d) >= threshold) px[i + c] = clamp(px[i + c] + d * k);
    }
    return px;
  },
  median(px, w, h, { radius = 2, threshold = 0 }) {
    const r = Math.max(1, Math.min(10, radius | 0)), out = new Uint8ClampedArray(px);
    const hist = [new Uint16Array(256), new Uint16Array(256), new Uint16Array(256)];
    for (let y = 0; y < h; y++) {
      for (const hh of hist) hh.fill(0);
      let cnt = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) for (let xx = 0; xx <= Math.min(w - 1, r); xx++) { const o = (yy * w + xx) * 4; hist[0][px[o]]++; hist[1][px[o + 1]]++; hist[2][px[o + 2]]++; cnt++; }
      for (let x = 0; x < w; x++) {
        const half = cnt / 2, o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) { let acc = 0, v = 0; const hh = hist[c]; while (v < 255 && acc + hh[v] <= half) { acc += hh[v]; v++; } if (Math.abs(px[o + c] - v) > threshold) out[o + c] = v; }
        const xo = x - r, xi = x + r + 1;
        if (xo >= 0) for (let yy = y0; yy <= y1; yy++) { const q = (yy * w + xo) * 4; hist[0][px[q]]--; hist[1][px[q + 1]]--; hist[2][px[q + 2]]--; cnt--; }
        if (xi < w) for (let yy = y0; yy <= y1; yy++) { const q = (yy * w + xi) * 4; hist[0][px[q]]++; hist[1][px[q + 1]]++; hist[2][px[q + 2]]++; cnt++; }
      }
    }
    return out;
  },
  reduceNoise(px, w, h, { strength = 50, color = 50, detail = 40 }) {
    // luminance: edge-aware blend with a blurred copy; colour: blur chroma, keep luma.
    const n = w * h, Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = i * 4, r = px[k], g = px[k + 1], b = px[k + 2]; Y[i] = 0.299 * r + 0.587 * g + 0.114 * b; Cb[i] = b - Y[i]; Cr[i] = r - Y[i]; }
    const sY = blurChannel(Y, w, h, 1 + strength / 25);
    const sCb = blurChannel(Cb, w, h, 1 + color / 8), sCr = blurChannel(Cr, w, h, 1 + color / 8);
    const keep = detail / 100, amt = strength / 100;
    for (let i = 0; i < n; i++) {
      const edge = Math.min(1, Math.abs(Y[i] - sY[i]) / (18 + 60 * (1 - keep)));
      const y = Y[i] + (sY[i] - Y[i]) * amt * (1 - edge);
      const cb = Cb[i] + (sCb[i] - Cb[i]) * Math.min(1, color / 50), cr = Cr[i] + (sCr[i] - Cr[i]) * Math.min(1, color / 50);
      const k = i * 4, r = cr + y, b = cb + y, g = (y - 0.299 * r - 0.114 * b) / 0.587;
      px[k] = clamp(r); px[k + 1] = clamp(g); px[k + 2] = clamp(b);
    }
    return px;
  },
  highPass(px, w, h, { radius = 4 }) {
    const blur = gaussian(new Uint8ClampedArray(px), w, h, radius);
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) px[i + c] = clamp(128 + px[i + c] - blur[i + c]);
    return px;
  },
  twirl(px, w, h, { angle = 90 }) {
    const cx = w / 2, cy = h / 2, R = Math.min(cx, cy), a = angle * Math.PI / 180;
    return remap(px, w, h, (x, y, p) => { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d >= R) { p.x = x; p.y = y; return; } const t = (1 - d / R); const th = a * t * t, c = Math.cos(th), s = Math.sin(th); p.x = cx + dx * c - dy * s; p.y = cy + dx * s + dy * c; });
  },
  pinch(px, w, h, { amount = 50 }) {
    const cx = w / 2, cy = h / 2, R = Math.min(cx, cy), k = amount / 100;
    return remap(px, w, h, (x, y, p) => { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d >= R || d === 0) { p.x = x; p.y = y; return; } const f = Math.pow(Math.sin(Math.PI / 2 * d / R), -k); p.x = cx + dx * f; p.y = cy + dy * f; });
  },
  spherize(px, w, h, { amount = 60 }) {
    const cx = w / 2, cy = h / 2, R = Math.min(cx, cy), k = amount / 100;
    return remap(px, w, h, (x, y, p) => { const dx = (x - cx) / R, dy = (y - cy) / R, d = Math.hypot(dx, dy); if (d >= 1 || d === 0) { p.x = x; p.y = y; return; } const nd = Math.asin(d) / (Math.PI / 2); const f = (1 - k) + k * nd / d; p.x = cx + dx * f * R; p.y = cy + dy * f * R; });
  },
  wave(px, w, h, { amplitude = 12, wavelength = 80, direction = 'both' }) {
    const tw = Math.PI * 2 / Math.max(2, wavelength);
    return remap(px, w, h, (x, y, p) => { p.x = x + (direction !== 'vertical' ? amplitude * Math.sin(y * tw) : 0); p.y = y + (direction !== 'horizontal' ? amplitude * Math.sin(x * tw) : 0); });
  },
  ripple(px, w, h, { amount = 10, size = 30 }) {
    const cx = w / 2, cy = h / 2;
    return remap(px, w, h, (x, y, p) => { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1, o = amount * Math.sin(d / Math.max(2, size) * Math.PI * 2); p.x = x + dx / d * o; p.y = y + dy / d * o; });
  },
  clouds(px, w, h, { fg = '#000000', bg = '#ffffff', scale = 180, seed = 1 }) {
    const a = hexRgb(fg), b = hexRgb(bg);
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const G = 256, perm = new Uint16Array(G * 2), grad = new Float32Array(G);
    for (let i = 0; i < G; i++) { perm[i] = i; grad[i] = rnd() * 2 - 1; }
    for (let i = G - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < G; i++) perm[G + i] = perm[i];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const noise = (x, y) => {
      const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
      const v = (i, j, dx, dy) => { const hsh = perm[perm[i] + j]; return grad[hsh] * dx + grad[(hsh + 57) & 255] * dy; };
      const u = fade(xf), vv = fade(yf);
      const n00 = v(xi, yi, xf, yf), n10 = v(xi + 1, yi, xf - 1, yf), n01 = v(xi, yi + 1, xf, yf - 1), n11 = v(xi + 1, yi + 1, xf - 1, yf - 1);
      return (n00 * (1 - u) + n10 * u) * (1 - vv) + (n01 * (1 - u) + n11 * u) * vv;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let f = 0, amp = 1, freq = 1 / Math.max(8, scale), tot = 0;
      for (let o = 0; o < 6; o++) { f += noise(x * freq, y * freq) * amp; tot += amp; amp *= 0.5; freq *= 2; }
      const t = Math.max(0, Math.min(1, f / tot * 1.4 + 0.5)), k = (y * w + x) * 4;
      px[k] = a[0] + (b[0] - a[0]) * t; px[k + 1] = a[1] + (b[1] - a[1]) * t; px[k + 2] = a[2] + (b[2] - a[2]) * t; px[k + 3] = 255;
    }
    return px;
  },
  addGrain(px, w, h, { amount = 25, size = 1.5, roughness = 50, seed = 7 }) { return grain(px, w, h, amount, size, roughness, seed); },
  oilPaint(px, w, h, { radius = 3, levels = 20 }) {
    const r = Math.max(1, radius | 0), L = Math.max(4, levels | 0), out = new Uint8ClampedArray(px);
    const cnt = new Uint32Array(L), sr = new Float64Array(L), sg = new Float64Array(L), sb = new Float64Array(L);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        const o = (yy * w + xx) * 4, bin = Math.min(L - 1, (lum(px[o], px[o + 1], px[o + 2]) * L / 256) | 0);
        cnt[bin]++; sr[bin] += px[o]; sg[bin] += px[o + 1]; sb[bin] += px[o + 2];
      }
      let best = 0; for (let i = 1; i < L; i++) if (cnt[i] > cnt[best]) best = i;
      const o = (y * w + x) * 4; out[o] = sr[best] / cnt[best]; out[o + 1] = sg[best] / cnt[best]; out[o + 2] = sb[best] / cnt[best];
    }
    return out;
  },
  halftone(px, w, h, { size = 8 }) {
    const s = Math.max(3, size | 0), out = new Uint8ClampedArray(px.length);
    for (let i = 0; i < out.length; i += 4) { out[i] = out[i + 1] = out[i + 2] = 255; out[i + 3] = px[i + 3]; }
    for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) {
      let t = 0, n = 0;
      for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) { const o = (y * w + x) * 4; t += lum(px[o], px[o + 1], px[o + 2]); n++; }
      const rad = (1 - t / n / 255) * s * 0.72, cx = bx + s / 2, cy = by + s / 2;
      for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), a = Math.max(0, Math.min(1, rad - d + 0.5));
        const o = (y * w + x) * 4; const v = 255 * (1 - a); out[o] = out[o + 1] = out[o + 2] = v;
      }
    }
    return out;
  },
  tiltShift(px, w, h, { focus = 50, band = 20, blur = 12 }) {
    const B = gaussian(new Uint8ClampedArray(px), w, h, blur), fy = h * focus / 100, bh = h * band / 200;
    for (let y = 0; y < h; y++) {
      const d = Math.abs(y - fy), t = smooth(bh, bh * 2.4 + 1, d);
      for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; for (let c = 0; c < 4; c++) px[o + c] = px[o + c] + (B[o + c] - px[o + c]) * t; }
    }
    return px;
  },

  // ------------------------------------------------------------ Camera Raw development
  cameraRaw(px, w, h, P) { return develop(px, w, h, P || {}); },
  histogram(px) {
    const H = new Uint32Array(256 * 4);
    for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 8) continue; H[px[i]]++; H[256 + px[i + 1]]++; H[512 + px[i + 2]]++; H[768 + ((px[i] * 54 + px[i + 1] * 183 + px[i + 2] * 19) >> 8)]++; }
    return new Uint8ClampedArray(H.buffer);
  },

  // ------------------------------------------------------------ content-aware fill
  inpaint(px, w, h, { mask }) { return inpaint(px, w, h, new Uint8ClampedArray(mask), 0); },
});

function grain(px, w, h, amount, size, roughness, seed) {
  let s = seed * 7919 + 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) - 0.5; };
  const n = w * h, N = new Float32Array(n);
  for (let i = 0; i < n; i++) N[i] = rnd();
  const G = size > 1.05 ? blurChannel(N, w, h, size) : N;
  let sd = 0; for (let i = 0; i < n; i += 97) sd += G[i] * G[i]; sd = Math.sqrt(sd / Math.ceil(n / 97)) || 1;
  const a = amount / 100 * 60 / sd, rough = roughness / 100;
  for (let i = 0; i < n; i++) {
    const k = i * 4, L = lum(px[k], px[k + 1], px[k + 2]) / 255;
    const v = G[i] * a * (0.35 + 0.65 * (1 - Math.abs(L - 0.5) * 2 * (1 - rough)));
    px[k] = clamp(px[k] + v); px[k + 1] = clamp(px[k + 1] + v); px[k + 2] = clamp(px[k + 2] + v);
  }
  return px;
}

/**
 * Camera Raw-style development. Params (all optional, 0 = neutral):
 * temp, tint, exposure, contrast, highlights, shadows, whites, blacks,
 * texture, clarity, dehaze, vibrance, saturation, curve{rgb,r,g,b},
 * mixer{hue[8],sat[8],lum[8]}, grading{shH,shS,midH,midS,hiH,hiS,balance},
 * sharpen, sharpenRadius, nrLum, nrColor, distortion, lensVignette,
 * vignette, vignetteMid, grain, grainSize
 */
function develop(px, w, h, P) {
  const n = w * h;
  const v = (k) => Number(P[k]) || 0;
  // lens distortion first (geometry)
  if (v('distortion')) {
    const k1 = -v('distortion') / 100 * 0.35, cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
    const sc = 1 / (1 + Math.max(0, k1));
    px = remap(px, w, h, (x, y, p) => { const dx = (x - cx) / R, dy = (y - cy) / R, r2 = dx * dx + dy * dy, f = (1 + k1 * r2) * sc; p.x = cx + dx * f * R; p.y = cy + dy * f * R; });
  }
  if (v('nrLum') || v('nrColor')) px = OPS.reduceNoise(px, w, h, { strength: v('nrLum'), color: v('nrColor'), detail: 50 });
  // float working buffers (linear-ish sRGB 0..1)
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const temp = v('temp') / 100, tint = v('tint') / 100, expo = Math.pow(2, v('exposure'));
  const wr = (1 + temp * 0.32) * (1 + tint * 0.12), wg = 1 - tint * 0.22, wb = (1 - temp * 0.32) * (1 + tint * 0.12);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    R[i] = l2s(Math.min(1, s2l[px[k]] * wr * expo) + Math.max(0, s2l[px[k]] * wr * expo - 1) * 0.15);
    G[i] = l2s(Math.min(1, s2l[px[k + 1]] * wg * expo) + Math.max(0, s2l[px[k + 1]] * wg * expo - 1) * 0.15);
    B[i] = l2s(Math.min(1, s2l[px[k + 2]] * wb * expo) + Math.max(0, s2l[px[k + 2]] * wb * expo - 1) * 0.15);
  }
  // tone: build a luminance tone curve from the sliders
  const hi = v('highlights') / 100, sh = v('shadows') / 100, wh = v('whites') / 100, bl = v('blacks') / 100, ct = v('contrast') / 100;
  const tone = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    let t = i / 1023;
    t += bl * 0.18 * Math.pow(1 - t, 4);
    t += sh * 0.42 * t * Math.pow(1 - t, 2) * 1.6;
    t += hi * 0.42 * t * t * (1 - t) * 1.6;
    t += wh * 0.18 * Math.pow(t, 4);
    t = Math.max(0, Math.min(1, t));
    if (ct) { const sgm = 1 / (1 + Math.exp(-(t - 0.5) * 8)); const s0 = 1 / (1 + Math.exp(4)), s1 = 1 / (1 + Math.exp(-4)); const sc = (sgm - s0) / (s1 - s0); t = ct > 0 ? t + (sc - t) * ct * 0.85 : t + (0.5 - t) * -ct * 0.5; }
    tone[i] = t;
  }
  const Lc = new Float32Array(n);
  for (let i = 0; i < n; i++) Lc[i] = lum(R[i], G[i], B[i]);
  // local contrast: clarity (large radius), texture (small), dehaze
  const cl = v('clarity') / 100, tx = v('texture') / 100, dz = v('dehaze') / 100;
  const Lb = cl ? blurChannel(Lc, w, h, Math.max(4, Math.min(w, h) * 0.018)) : null;
  const Ls = tx ? blurChannel(Lc, w, h, 2.2) : null;
  for (let i = 0; i < n; i++) {
    const L0 = Math.max(1e-4, Lc[i]);
    let L = tone[Math.min(1023, Math.max(0, (L0 * 1023) | 0))];
    if (Lb) { const d = L0 - Lb[i]; L += d * cl * 1.6 * (1 - Math.abs(L0 - 0.5) * 1.2); }
    if (Ls) L += (L0 - Ls[i]) * tx * 2.2;
    if (dz) { const a = dz * 0.12; L = (L - a) / (1 - a * (dz > 0 ? 1 : 0.5)); }
    const k = Math.max(0, L) / L0;
    R[i] *= k; G[i] *= k; B[i] *= k;
  }
  // colour: vibrance / saturation / dehaze saturation
  const vib = v('vibrance') / 100, sat = v('saturation') / 100 + (dz > 0 ? dz * 0.25 : dz * 0.15);
  const mix = P.mixer || null;
  const gr = P.grading || null;
  const bw = new Float32Array(8);
  const gShadow = gr ? hueRgb(gr.shH || 0) : null, gMid = gr ? hueRgb(gr.midH || 0) : null, gHigh = gr ? hueRgb(gr.hiH || 0) : null;
  const bal = gr ? (Number(gr.balance) || 0) / 100 : 0;
  const hasMix = mix && [...(mix.hue || []), ...(mix.sat || []), ...(mix.lum || [])].some((x) => Number(x));
  for (let i = 0; i < n; i++) {
    let r = R[i], g = G[i], b = B[i];
    const L = lum(r, g, b);
    if (vib || sat) {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s0 = mx > 0 ? (mx - mn) / mx : 0;
      const skin = r > g && g > b ? 0.55 : 1;
      const kf = 1 + sat + vib * (1 - s0) * (vib > 0 ? skin : 1);
      r = L + (r - L) * kf; g = L + (g - L) * kf; b = L + (b - L) * kf;
    }
    if (hasMix) {
      let [hh, s, l] = rgb2hsl(Math.max(0, Math.min(1, r)) * 255, Math.max(0, Math.min(1, g)) * 255, Math.max(0, Math.min(1, b)) * 255);
      bandWeights(hh * 360, bw);
      let dh = 0, ds = 0, dl = 0;
      for (let q = 0; q < 8; q++) { if (!bw[q]) continue; dh += bw[q] * (Number(mix.hue?.[q]) || 0); ds += bw[q] * (Number(mix.sat?.[q]) || 0); dl += bw[q] * (Number(mix.lum?.[q]) || 0); }
      const sw = Math.min(1, s * 3);
      hh = (hh + dh / 100 * 30 / 360 * sw + 1) % 1;
      s = Math.max(0, Math.min(1, s * (1 + ds / 100)));
      l = Math.max(0, Math.min(1, l + dl / 100 * 0.25 * sw));
      const o = hsl2rgb(hh, s, l); r = o[0] / 255; g = o[1] / 255; b = o[2] / 255;
    }
    if (gr) {
      const Lx = Math.max(0, Math.min(1, lum(r, g, b)));
      const ws = Math.pow(Math.max(0, 1 - Lx - bal * 0.4), 2), whh = Math.pow(Math.max(0, Lx - bal * 0.4), 2), wm = Math.max(0, 1 - ws - whh);
      const add = (c, col, s, wgt) => (col[c] - 0.5) * (s / 100) * 0.35 * wgt;
      r += add(0, gShadow, gr.shS || 0, ws) + add(0, gMid, gr.midS || 0, wm) + add(0, gHigh, gr.hiS || 0, whh);
      g += add(1, gShadow, gr.shS || 0, ws) + add(1, gMid, gr.midS || 0, wm) + add(1, gHigh, gr.hiS || 0, whh);
      b += add(2, gShadow, gr.shS || 0, ws) + add(2, gMid, gr.midS || 0, wm) + add(2, gHigh, gr.hiS || 0, whh);
    }
    R[i] = r; G[i] = g; B[i] = b;
  }
  // write back 8-bit, tone curve
  const c = P.curve || {};
  const CL = curveLUT(c.rgb), CR = curveLUT(c.r), CG = curveLUT(c.g), CB = curveLUT(c.b);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    px[k] = CL[CR[clamp(R[i] * 255) | 0]]; px[k + 1] = CL[CG[clamp(G[i] * 255) | 0]]; px[k + 2] = CL[CB[clamp(B[i] * 255) | 0]];
  }
  if (v('sharpen')) px = OPS.unsharpMask(px, w, h, { amount: v('sharpen') * 1.4, radius: Number(P.sharpenRadius) || 1, threshold: 2 });
  // lens vignette correction, creative vignette, grain
  const lv = v('lensVignette') / 100, vg = v('vignette') / 100, vm = (P.vignetteMid == null ? 50 : Number(P.vignetteMid)) / 100;
  if (lv || vg) {
    const cx = w / 2, cy = h / 2, md = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / md;
      let f = 1 + lv * d * d * 0.8;
      if (vg) { const t = smooth(vm * 0.9, 1.15, d); f *= vg < 0 ? 1 + vg * t * 0.95 : 1; if (vg > 0) { const k = (y * w + x) * 4; for (let q = 0; q < 3; q++) px[k + q] = px[k + q] + (255 - px[k + q]) * vg * t * 0.9; } }
      if (f !== 1) { const k = (y * w + x) * 4; px[k] = clamp(px[k] * f); px[k + 1] = clamp(px[k + 1] * f); px[k + 2] = clamp(px[k + 2] * f); }
    }
  }
  if (v('grain')) px = grain(px, w, h, v('grain'), Number(P.grainSize) || 1.5, 50, 11);
  return px;
}

/**
 * Content-aware fill (local, no AI service): coarse-to-fine exemplar
 * synthesis. Pixels under the mask (alpha > 127) are rebuilt from the most
 * similar patches of the surrounding known area, onion-peeling inward so
 * structures continue from the edges.
 */
function inpaint(px, w, h, mask, depth = 0) {
  const n = w * h;
  const hole = new Uint8Array(n);
  let count = 0, minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) if (mask[i * 4 + 3] > 127) { hole[i] = 1; count++; const x = i % w, y = (i / w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (!count) return px;
  // Work on a downscaled copy for big holes, then upsample the result into the hole.
  const MAXH = 14000;
  const s = count > MAXH && depth === 0 ? Math.sqrt(MAXH / count) * 0.9 : 1;
  if (s < 1) {
    const sw = Math.max(8, Math.round(w * s)), sh = Math.max(8, Math.round(h * s));
    const small = new Uint8ClampedArray(sw * sh * 4), smask = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const X = Math.min(w - 1, Math.floor((x + 0.5) / s)), Y = Math.min(h - 1, Math.floor((y + 0.5) / s));
      // area-average source; hole if any sample in the cell is a hole
      let r = 0, g = 0, b = 0, a = 0, c = 0, hh = 0;
      const x0 = Math.floor(x / s), x1 = Math.min(w, Math.ceil((x + 1) / s)), y0 = Math.floor(y / s), y1 = Math.min(h, Math.ceil((y + 1) / s));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const q = yy * w + xx; if (hole[q]) { hh = 1; continue; } const k = q * 4; r += px[k]; g += px[k + 1]; b += px[k + 2]; a += px[k + 3]; c++; }
      const o = (y * sw + x) * 4;
      if (c) { small[o] = r / c; small[o + 1] = g / c; small[o + 2] = b / c; small[o + 3] = a / c; } else { const k = (Y * w + X) * 4; small[o] = px[k]; small[o + 1] = px[k + 1]; small[o + 2] = px[k + 2]; small[o + 3] = px[k + 3]; }
      if (hh) smask[o + 3] = 255;
    }
    const filled = inpaint(small, sw, sh, smask, depth + 1);
    // upsample filled region, add a little high-frequency detail from a matched neighbour offset
    const tmp = new Float32Array(4);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const q = y * w + x; if (!hole[q]) continue;
      sampleBilinear(filled, sw, sh, (x + 0.5) * s - 0.5, (y + 0.5) * s - 0.5, tmp, 0);
      const k = q * 4; px[k] = tmp[0]; px[k + 1] = tmp[1]; px[k + 2] = tmp[2]; px[k + 3] = tmp[3];
    }
    // refine at full resolution only near the hole boundary (cheap texture continuation)
    return px;
  }
  const P = 4; // patch radius (9×9)
  const known = new Uint8Array(n); for (let i = 0; i < n; i++) known[i] = hole[i] ? 0 : 1;
  const bx0 = Math.max(0, minX - 60), by0 = Math.max(0, minY - 60), bx1 = Math.min(w - 1, maxX + 60), by1 = Math.min(h - 1, maxY + 60);
  const cands = [];
  for (let y = Math.max(P, by0 - 40); y <= Math.min(h - 1 - P, by1 + 40); y += 1) for (let x = Math.max(P, bx0 - 40); x <= Math.min(w - 1 - P, bx1 + 40); x += 1) {
    let ok = true;
    for (let dy = -P; dy <= P && ok; dy += 2) for (let dx = -P; dx <= P; dx += 2) if (hole[(y + dy) * w + x + dx]) { ok = false; break; }
    if (ok) cands.push(y * w + x);
  }
  if (!cands.length) { // nothing to copy from: diffuse
    for (let it = 0; it < 200; it++) for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const q = y * w + x; if (!hole[q]) continue; let r = 0, g = 0, b = 0, c = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const k = (Y * w + X) * 4; r += px[k]; g += px[k + 1]; b += px[k + 2]; c++; } if (c) { const k = q * 4; px[k] = r / c; px[k + 1] = g / c; px[k + 2] = b / c; px[k + 3] = 255; } }
    return px;
  }
  let seed = 12345; const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const best = new Int32Array(n).fill(-1);
  let remaining = count, guard = 0;
  while (remaining > 0 && guard++ < 4000) {
    // current front: hole pixels with at least one known 8-neighbour
    const front = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const q = y * w + x; if (known[q]) continue;
      let nb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && known[Y * w + X]) nb++; }
      if (nb) front.push([q, nb]);
    }
    if (!front.length) break;
    front.sort((a, b) => b[1] - a[1]);
    const newly = [];
    for (const [q] of front) {
      const x = q % w, y = (q / w) | 0;
      const dist = (c) => {
        const cx = c % w, cy = (c / w) | 0; let d = 0, m = 0;
        for (let dy = -P; dy <= P; dy++) {
          const Y = y + dy; if (Y < 0 || Y >= h) continue;
          for (let dx = -P; dx <= P; dx++) {
            const X = x + dx; if (X < 0 || X >= w) continue;
            const t = Y * w + X; if (!known[t]) continue;
            const a = t * 4, b = ((cy + dy) * w + cx + dx) * 4;
            const e0 = px[a] - px[b], e1 = px[a + 1] - px[b + 1], e2 = px[a + 2] - px[b + 2];
            d += e0 * e0 + e1 * e1 + e2 * e2; m++;
          }
        }
        if (!m) return 1e12;
        const ddx = cx - x, ddy = cy - y;
        return d / m + 0.015 * (ddx * ddx + ddy * ddy); // prefer nearby texture (keeps structures coherent)
      };
      let bi = -1, bd = 1e18;
      // propagate from known neighbours' matches (coherence), then random search
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nq = (y + dy) * w + (x + dx); if (nq < 0 || nq >= n) continue;
        const bm = best[nq]; if (bm < 0) continue;
        const c = bm - dy * w - dx; const cx = c % w, cy = (c / w) | 0;
        if (cx < P || cy < P || cx >= w - P || cy >= h - P || hole[c]) continue;
        const d = dist(c); if (d < bd) { bd = d; bi = c; }
      }
      for (let t = 0; t < 50; t++) { const c = cands[(rnd() * cands.length) | 0]; const d = dist(c); if (d < bd) { bd = d; bi = c; } }
      // local refinement around the best
      if (bi >= 0) for (let r = 8; r >= 1; r >>= 1) { const cx = bi % w, cy = (bi / w) | 0; for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) { const X = cx + dx, Y = cy + dy; if (X < P || Y < P || X >= w - P || Y >= h - P) continue; const c = Y * w + X; if (hole[c]) continue; const d = dist(c); if (d < bd) { bd = d; bi = c; } } }
      if (bi < 0) bi = cands[(rnd() * cands.length) | 0];
      const a = q * 4, b = bi * 4;
      px[a] = px[b]; px[a + 1] = px[b + 1]; px[a + 2] = px[b + 2]; px[a + 3] = px[b + 3];
      best[q] = bi; newly.push(q);
    }
    for (const q of newly) { known[q] = 1; remaining--; }
  }
  // soften seams slightly inside the hole
  const out = new Uint8ClampedArray(px);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const q = y * w + x; if (!hole[q]) continue;
    for (let c = 0; c < 3; c++) { let s2 = 0, m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; s2 += px[(Y * w + X) * 4 + c]; m++; } out[q * 4 + c] = px[q * 4 + c] * 0.6 + s2 / m * 0.4; }
  }
  return out;
}
