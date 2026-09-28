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
