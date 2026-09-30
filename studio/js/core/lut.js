// EYAD STUDIO — LUT engine.
// Parses ".cube" colour look-up tables (1D and 3D; the common text format used
// by grading tools and cameras), validates them strictly (imported files are
// untrusted), and applies them on the GPU (WebGL1: the 3D table is packed into
// a 2D texture as a grid of blue slices, sampled with bilinear filtering inside
// a slice and interpolated between slices = trilinear) with a CPU fallback.
// It also generates a set of original built-in grades in code.

import { sharedGL, cached, program, texture, upload, draw, PRECISION, sourceSize, makeCanvas } from './glutil.js';

export const LUT_LIMITS = {
  max3d: 128,            // LUT_3D_SIZE ≤ 128  (128³ = 2.1 M entries)
  max1d: 4096,           // LUT_1D_SIZE ≤ 4096
  maxBytes: 64 * 1024 * 1024,
  maxValue: 1e6,         // any finite value within ±1e6 is accepted (then clamped when sampling)
};

const lutIds = new WeakMap();
let lutSeq = 0;
/** Stable per-object key (used for GPU texture caching). */
export function lutKey(lut) {
  if (!lut || typeof lut !== 'object') return '';
  let k = lutIds.get(lut);
  if (!k) { k = 'lut' + (++lutSeq); lutIds.set(lut, k); }
  return k;
}

function cleanTitle(s) {
  return String(s || '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Parse the text of a .cube file.
 * Returns { title, size, data: Float32Array(size³·3) | null, size1d, data1d: Float32Array(n·3) | null,
 *           domainMin:[r,g,b], domainMax:[r,g,b], kind: '3d' | '1d' | '1d+3d' }.
 * Throws an Error with a human-readable message when the file is invalid.
 */
export function parseCube(text) {
  if (typeof text !== 'string') throw new Error('The LUT could not be read as text.');
  if (text.length > LUT_LIMITS.maxBytes) throw new Error('This LUT file is too large (over 64 MB).');
  if (/\u0000/.test(text.slice(0, 4096))) throw new Error('This is not a text .cube file.');
  let title = '';
  let size3 = 0, size1 = 0;
  let dmin = [0, 0, 0], dmax = [1, 1, 1];
  let range1 = null, range3 = null;
  let d1 = null, d3 = null, n1 = 0, n3 = 0;
  let lineNo = 0;
  let pos = 0;
  const len = text.length;
  const bad = (msg) => { throw new Error(`Line ${lineNo}: ${msg}`); };
  const num = (s) => {
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) bad(`"${s.slice(0, 20)}" is not a number.`);
    const v = Number(s);
    if (!Number.isFinite(v) || Math.abs(v) > LUT_LIMITS.maxValue) bad('value out of range.');
    return v;
  };
  while (pos < len) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = len;
    let line = text.slice(pos, end);
    pos = end + 1;
    lineNo++;
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;
    const c0 = line.charCodeAt(0);
    const isData = (c0 >= 48 && c0 <= 57) || c0 === 45 || c0 === 43 || c0 === 46;
    if (isData) {
      const parts = line.split(/\s+/);
      if (parts.length !== 3) bad('expected three numbers (R G B).');
      if (!size1 && !size3) bad('table data appears before LUT_1D_SIZE / LUT_3D_SIZE.');
      if (d1 && n1 < size1) {
        d1[n1 * 3] = num(parts[0]); d1[n1 * 3 + 1] = num(parts[1]); d1[n1 * 3 + 2] = num(parts[2]);
        n1++;
      } else if (d3 && n3 < size3 * size3 * size3) {
        d3[n3 * 3] = num(parts[0]); d3[n3 * 3 + 1] = num(parts[1]); d3[n3 * 3 + 2] = num(parts[2]);
        n3++;
      } else bad('more table entries than the declared LUT size.');
      continue;
    }
    if (n1 || n3) bad('unexpected text inside the table (every row must be three numbers).');
    const m = /^([A-Z0-9_]+)(?:\s+(.*))?$/.exec(line);
    if (!m) bad('unrecognised line.');
    const key = m[1], rest = (m[2] || '').trim();
    switch (key) {
      case 'TITLE': {
        const q = /^"(.*)"$/.exec(rest);
        title = cleanTitle(q ? q[1] : rest);
        break;
      }
      case 'LUT_3D_SIZE': {
        if (size3) bad('LUT_3D_SIZE declared twice.');
        if (!/^\d+$/.test(rest)) bad('LUT_3D_SIZE must be a whole number.');
        size3 = Number(rest);
        if (size3 < 2 || size3 > LUT_LIMITS.max3d) bad(`LUT_3D_SIZE must be between 2 and ${LUT_LIMITS.max3d}.`);
        d3 = new Float32Array(size3 * size3 * size3 * 3);
        break;
      }
      case 'LUT_1D_SIZE': {
        if (size1) bad('LUT_1D_SIZE declared twice.');
        if (!/^\d+$/.test(rest)) bad('LUT_1D_SIZE must be a whole number.');
        size1 = Number(rest);
        if (size1 < 2 || size1 > LUT_LIMITS.max1d) bad(`LUT_1D_SIZE must be between 2 and ${LUT_LIMITS.max1d}.`);
        d1 = new Float32Array(size1 * 3);
        break;
      }
      case 'DOMAIN_MIN':
      case 'DOMAIN_MAX': {
        const p = rest.split(/\s+/);
        if (p.length !== 3) bad(`${key} needs three numbers.`);
        const v = p.map(num);
        if (key === 'DOMAIN_MIN') dmin = v; else dmax = v;
        break;
      }
      case 'LUT_1D_INPUT_RANGE':
      case 'LUT_3D_INPUT_RANGE': {
        const p = rest.split(/\s+/);
        if (p.length !== 2) bad(`${key} needs two numbers.`);
        const v = p.map(num);
        if (key === 'LUT_1D_INPUT_RANGE') range1 = v; else range3 = v;
        break;
      }
      case 'LUT_IN_VIDEO_RANGE':
      case 'LUT_OUT_VIDEO_RANGE':
        break; // informational, accepted
      default:
        bad(`unknown keyword "${key.slice(0, 24)}".`);
    }
  }
  if (!size1 && !size3) throw new Error('No LUT_3D_SIZE or LUT_1D_SIZE found — this is not a .cube LUT.');
  if (size1 && n1 !== size1) throw new Error(`The 1D table has ${n1} entries but LUT_1D_SIZE says ${size1}.`);
  if (size3 && n3 !== size3 * size3 * size3) throw new Error(`The 3D table has ${n3} entries but LUT_3D_SIZE ${size3} needs ${size3 * size3 * size3}.`);
  // Resolve-style input ranges override the domain.
  if (size3 && range3) { dmin = [range3[0], range3[0], range3[0]]; dmax = [range3[1], range3[1], range3[1]]; }
  else if (!size3 && range1) { dmin = [range1[0], range1[0], range1[0]]; dmax = [range1[1], range1[1], range1[1]]; }
  for (let i = 0; i < 3; i++) if (!(dmax[i] > dmin[i])) throw new Error('DOMAIN_MAX must be greater than DOMAIN_MIN for every channel.');
  const lut = {
    title: title || 'Imported LUT',
    kind: size1 && size3 ? '1d+3d' : size3 ? '3d' : '1d',
    size: size3 || 0, data: d3,
    size1d: size1 || 0, data1d: d1,
    domainMin: dmin, domainMax: dmax,
    domain1d: size1 && size3 && range1 ? [[range1[0], range1[0], range1[0]], [range1[1], range1[1], range1[1]]] : null,
  };
  return lut;
}

/** Read a picked File as a LUT (validates extension + size first). */
export async function readCubeFile(file) {
  if (!file) throw new Error('No file.');
  if (file.size > LUT_LIMITS.maxBytes) throw new Error('This LUT file is too large (over 64 MB).');
  if (!/\.cube$/i.test(file.name || '')) throw new Error('Only .cube LUT files are supported.');
  const text = await file.text();
  const lut = parseCube(text);
  if (lut.title === 'Imported LUT') lut.title = cleanTitle(String(file.name).replace(/\.cube$/i, '')) || 'Imported LUT';
  return lut;
}

// ---------------------------------------------------------------- CPU sampling

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sample1d(lut, c, out) {
  const n = lut.size1d, d = lut.data1d;
  const dm = lut.domain1d || [lut.domainMin, lut.domainMax];
  for (let ch = 0; ch < 3; ch++) {
    const t = clamp01((c[ch] - dm[0][ch]) / (dm[1][ch] - dm[0][ch])) * (n - 1);
    const i = Math.min(n - 2, Math.floor(t)), f = t - i;
    out[ch] = d[i * 3 + ch] * (1 - f) + d[(i + 1) * 3 + ch] * f;
  }
  return out;
}

function sample3d(size, d, dmin, dmax, r, g, b, out) {
  const n1 = size - 1;
  const x = clamp01((r - dmin[0]) / (dmax[0] - dmin[0])) * n1;
  const y = clamp01((g - dmin[1]) / (dmax[1] - dmin[1])) * n1;
  const z = clamp01((b - dmin[2]) / (dmax[2] - dmin[2])) * n1;
  const x0 = Math.min(n1 - 1, x | 0), y0 = Math.min(n1 - 1, y | 0), z0 = Math.min(n1 - 1, z | 0);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const s1 = size, s2 = size * size;
  for (let ch = 0; ch < 3; ch++) {
    const i000 = (x0 + y0 * s1 + z0 * s2) * 3 + ch;
    const c00 = d[i000] + (d[i000 + 3] - d[i000]) * fx;
    const c10 = d[i000 + s1 * 3] + (d[i000 + s1 * 3 + 3] - d[i000 + s1 * 3]) * fx;
    const c01 = d[i000 + s2 * 3] + (d[i000 + s2 * 3 + 3] - d[i000 + s2 * 3]) * fx;
    const c11 = d[i000 + (s1 + s2) * 3] + (d[i000 + (s1 + s2) * 3 + 3] - d[i000 + (s1 + s2) * 3]) * fx;
    const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
    out[ch] = c0 + (c1 - c0) * fz;
  }
  return out;
}

/** Look up one colour (0..1 floats) through any parsed LUT. */
export function sampleLut(lut, r, g, b, out = [0, 0, 0]) {
  if (lut.size1d) {
    sample1d(lut, [r, g, b], out);
    if (!lut.size) return out;
    r = out[0]; g = out[1]; b = out[2];
  }
  return sample3d(lut.size, lut.data, lut.domainMin, lut.domainMax, r, g, b, out);
}

/**
 * Normalise any LUT to a 3D table over the 0..1 domain (for the GPU).
 * 1D-only tables are baked into a 33³ cube (per-channel curves are separable,
 * so this is exact up to linear interpolation between the 33 points).
 */
export function lutTo3D(lut) {
  const trivial = lut.kind === '3d' && lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
  if (trivial) return { size: lut.size, data: lut.data };
  const n = lut.size ? Math.max(2, lut.size) : 33;
  const d = new Float32Array(n * n * n * 3);
  const o = [0, 0, 0];
  // Image values are 0..1; sampleLut maps them through the file's domain itself.
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    sampleLut(lut, r / (n - 1), g / (n - 1), b / (n - 1), o);
    const i = (r + g * n + b * n * n) * 3;
    d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
  }
  return { size: n, data: d };
}

/**
 * Pack a LUT for a WebGL1 2D texture: blue slices laid out in a grid.
 * Returns { size, cols, width, height, pixels: Uint8Array RGBA }.
 */
export function packLut(lut) {
  const { size: n, data } = lutTo3D(lut);
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const W = cols * n, H = rows * n;
  const px = new Uint8Array(W * H * 4);
  for (let b = 0; b < n; b++) {
    const ox = (b % cols) * n, oy = Math.floor(b / cols) * n;
    for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const s = (r + g * n + b * n * n) * 3;
      const o = ((oy + g) * W + ox + r) * 4;
      px[o] = Math.round(clamp01(data[s]) * 255);
      px[o + 1] = Math.round(clamp01(data[s + 1]) * 255);
      px[o + 2] = Math.round(clamp01(data[s + 2]) * 255);
      px[o + 3] = 255;
    }
  }
  return { size: n, cols, width: W, height: H, pixels: px };
}

// GLSL used by film.js too. Needs: uniform sampler2D uLut; uniform vec3 uLutDim (size, cols, unused); uniform vec2 uLutTex (texture px).
export const LUT_GLSL = `
uniform sampler2D uLut;
uniform vec2 uLutDim;   // x = size N, y = columns in the slice grid
uniform vec2 uLutTex;   // texture width, height in px
vec3 lut3d(vec3 c) {
  float N = uLutDim.x, C = uLutDim.y;
  c = clamp(c, 0.0, 1.0) * (N - 1.0);
  float b0 = floor(c.b);
  float b1 = min(b0 + 1.0, N - 1.0);
  float f = c.b - b0;
  vec2 rg = c.rg + 0.5;
  vec2 s0 = vec2(mod(b0, C), floor(b0 / C)) * N;
  vec2 s1 = vec2(mod(b1, C), floor(b1 / C)) * N;
  vec3 a = texture2D(uLut, (s0 + rg) / uLutTex).rgb;
  vec3 b = texture2D(uLut, (s1 + rg) / uLutTex).rgb;
  return mix(a, b, f);
}`;

/** Get (or build) the GPU texture of a LUT on a given GL context cache. Returns { tex, dim:[N,C], texSize:[W,H] }. */
export function lutTexture(ctx, lut) {
  const key = 'lutTex:' + lutKey(lut);
  let e = ctx.cache.get(key);
  if (e) return e;
  const gl = ctx.gl;
  const p = packLut(lut);
  const tex = texture(gl);
  upload(gl, tex, { width: p.width, height: p.height, data: p.pixels });
  e = { tex, dim: [p.size, p.cols], texSize: [p.width, p.height] };
  // Keep the cache small: drop the oldest LUT textures.
  const lutKeys = [...ctx.cache.keys()].filter((k) => k.startsWith('lutTex:'));
  if (lutKeys.length > 24) { const old = ctx.cache.get(lutKeys[0]); if (old) gl.deleteTexture(old.tex); ctx.cache.delete(lutKeys[0]); }
  ctx.cache.set(key, e);
  return e;
}

// ---------------------------------------------------------------- applyLut

const APPLY_FS = PRECISION + LUT_GLSL + `
uniform sampler2D uSrc;
uniform vec2 uSize;
uniform float uAmount;
void main() {
  vec2 uv = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uSize;
  vec4 s = texture2D(uSrc, uv);
  vec3 c = mix(s.rgb, lut3d(s.rgb), uAmount);
  gl_FragColor = vec4(c, s.a);
}`;

/**
 * Apply a LUT to any drawable source at full resolution.
 * amount: 0..1 (or 0..100 — values above 1 are treated as percent).
 * Returns Promise<HTMLCanvasElement>.
 */
export async function applyLut(src, lut, amount = 1) {
  if (typeof lut === 'string') lut = getBuiltinLut(lut);
  if (!lut) throw new Error('No LUT.');
  if (amount > 1) amount /= 100;
  amount = clamp01(amount);
  const [W, H] = sourceSize(src);
  if (!W || !H) throw new Error('The image has no pixels.');
  const out = makeCanvas(W, H);
  const octx = out.getContext('2d');
  const ctx = sharedGL();
  if (ctx) {
    try {
      const { gl, canvas } = ctx;
      const P = cached(ctx, 'lutApply', (g) => program(g, APPLY_FS));
      const srcTex = cached(ctx, 'lutApplySrc', (g) => texture(g));
      const L = lutTexture(ctx, lut);
      const T = ctx.maxTile;
      const stage = makeCanvas(1, 1);
      const sg = stage.getContext('2d');
      for (let y = 0; y < H; y += T) {
        for (let x = 0; x < W; x += T) {
          const tw = Math.min(T, W - x), th = Math.min(T, H - y);
          stage.width = tw; stage.height = th;
          sg.clearRect(0, 0, tw, th);
          sg.drawImage(src, x, y, tw, th, 0, 0, tw, th);
          canvas.width = tw; canvas.height = th;
          gl.viewport(0, 0, tw, th);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          P.use();
          gl.activeTexture(gl.TEXTURE0); upload(gl, srcTex, stage);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.tex);
          gl.uniform1i(P.U.uSrc, 0); gl.uniform1i(P.U.uLut, 1);
          gl.uniform2f(P.U.uLutDim, L.dim[0], L.dim[1]);
          gl.uniform2f(P.U.uLutTex, L.texSize[0], L.texSize[1]);
          gl.uniform2f(P.U.uSize, tw, th);
          gl.uniform1f(P.U.uAmount, amount);
          draw(gl);
          octx.clearRect(x, y, tw, th);
          octx.drawImage(canvas, 0, 0, tw, th, x, y, tw, th);
          gl.activeTexture(gl.TEXTURE0);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!gl.isContextLost()) return out;
    } catch (e) { /* fall through to CPU */ }
  }
  // CPU fallback
  octx.clearRect(0, 0, W, H);
  octx.drawImage(src, 0, 0, W, H);
  const band = Math.max(1, Math.floor(1_000_000 / W));
  const o = [0, 0, 0];
  for (let y = 0; y < H; y += band) {
    const bh = Math.min(band, H - y);
    const id = octx.getImageData(0, y, W, bh);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      sampleLut(lut, r, g, b, o);
      d[i] = Math.round(clamp01(r + (o[0] - r) * amount) * 255);
      d[i + 1] = Math.round(clamp01(g + (o[1] - g) * amount) * 255);
      d[i + 2] = Math.round(clamp01(b + (o[2] - b) * amount) * 255);
    }
    octx.putImageData(id, 0, y);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

// ---------------------------------------------------------------- built-in grades

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const sCurve = (x, k) => x + (x * x * (3 - 2 * x) - x) * k;
const hueRGB = (deg) => {
  const h = (((deg % 360) + 360) % 360) / 60, x = 1 - Math.abs((h % 2) - 1);
  return h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
};
function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const hh = h / 360;
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
}
const sat = (c, k) => { const l = luma(c[0], c[1], c[2]); return c.map((v) => l + (v - l) * k); };
const tone = (c, hue, amt, w) => { const t = hueRGB(hue), m = (t[0] + t[1] + t[2]) / 3; return c.map((v, i) => v + (t[i] - m) * amt * w); };
const gains = (c, r, g, b) => [c[0] * r, c[1] * g, c[2] * b];
const lift = (c, a, col = [1, 1, 1]) => c.map((v, i) => a * col[i] + v * (1 - a));
const hueShiftRange = (c, center, width, shift, satMul = 1) => {
  const [h, s, l] = rgb2hsl(c[0], c[1], c[2]);
  let d = ((h - center + 540) % 360) - 180;
  const w = Math.max(0, 1 - Math.abs(d) / width) * Math.min(1, s * 3);
  if (w <= 0) return c;
  return hsl2rgb(h + shift * w, Math.min(1, s * (1 + (satMul - 1) * w)), l);
};

/** Original built-in grades. f(rgb) works in display (gamma-encoded) 0..1 space. */
const GRADES = [
  { id: 'teal-amber', name: 'Teal & Amber', desc: 'Blockbuster split: warm skin, teal shadows', f: (c) => {
    const l = luma(...c);
    const ax = [0.62, 0.05, -0.67]; // amber-teal axis (zero-mean)
    const ch = c.map((v) => v - l);
    const a = ch[0] * ax[0] + ch[1] * ax[1] + ch[2] * ax[2];
    const n = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
    const p = ax.map((v) => v * a / n);
    let o = ch.map((v, i) => l + p[i] * 1.35 + (v - p[i]) * 0.55);
    o = tone(o, 190, 0.22, (1 - l) ** 2);
    o = tone(o, 32, 0.16, l * l);
    return o.map((v) => sCurve(clamp01(v), 0.25));
  } },
  { id: 'bleach', name: 'Silver Retention', desc: 'Bleach-bypass: low colour, hard contrast, metallic', f: (c) => {
    const l = luma(...c);
    const ov = c.map((v) => (l < 0.5 ? 2 * v * l : 1 - 2 * (1 - v) * (1 - l)));
    const o = sat(ov.map((v, i) => c[i] * 0.3 + v * 0.7), 0.45);
    return o.map((v) => sCurve(clamp01(v), 0.3));
  } },
  { id: 'day-night', name: 'Day for Night', desc: 'Turns daylight into cool moonlit night', f: (c) => {
    let o = sat(c, 0.35);
    o = o.map((v) => Math.pow(clamp01(v), 1.55) * 0.62);
    o = gains(o, 0.72, 0.9, 1.25);
    o = lift(o, 0.03, [0.2, 0.35, 0.6]);
    return o;
  } },
  { id: 'golden', name: 'Golden Hour', desc: 'Low-sun warmth with soft highlights', f: (c) => {
    let o = gains(c, 1.08, 1.01, 0.84);
    o = sat(o, 1.12);
    o = tone(o, 38, 0.18, luma(...c) ** 1.5);
    return o.map((v) => clamp01(v) ** 0.95);
  } },
  { id: 'steel', name: 'Cold Steel', desc: 'Cool, desaturated and hard-edged', f: (c) => {
    let o = sat(c, 0.62);
    o = gains(o, 0.92, 0.99, 1.09);
    o = tone(o, 205, 0.12, 1 - luma(...c));
    return o.map((v) => sCurve(clamp01(v), 0.35));
  } },
  { id: 'pastel', name: 'Matte Pastel', desc: 'Faded blacks, soft pastel colour', f: (c) => {
    let o = sat(c, 0.78);
    o = o.map((v) => sCurve(clamp01(v), -0.25));
    o = lift(o, 0.12, [0.98, 0.94, 1.0]);
    return o.map((v) => Math.min(v, 0.95));
  } },
  { id: 'emerald', name: 'Emerald Forest', desc: 'Deep emerald greens, warm skin', f: (c) => {
    let o = hueShiftRange(c, 95, 60, 45, 1.15);
    o = hueShiftRange(o, 25, 30, 6, 1.05);
    o = tone(o, 170, 0.14, (1 - luma(...o)) ** 2);
    return o.map((v) => sCurve(clamp01(v), 0.15));
  } },
  { id: 'neon', name: 'Neon Night', desc: 'Magenta highlights, cyan shadows, inky blacks', f: (c) => {
    const l = luma(...c);
    let o = sat(c, 1.3);
    o = tone(o, 185, 0.3, (1 - l) ** 2);
    o = tone(o, 310, 0.26, l * l);
    return o.map((v) => clamp01(sCurve(clamp01(v), 0.35) - 0.02) / 0.98);
  } },
  { id: 'desert', name: 'Desert Heat', desc: 'Bleached orange sun and dusty shadows', f: (c) => {
    let o = gains(c, 1.12, 1.0, 0.78);
    o = sat(o, 1.05);
    o = o.map((v) => clamp01(v * 1.05) ** 0.9);
    return lift(o, 0.05, [0.7, 0.5, 0.3]);
  } },
  { id: 'moonlight', name: 'Moonlight', desc: 'Blue night with lifted blue blacks', f: (c) => {
    let o = sat(c, 0.5);
    o = gains(o, 0.86, 0.96, 1.16);
    o = lift(o, 0.07, [0.25, 0.4, 0.75]);
    return o.map((v) => sCurve(clamp01(v), 0.1));
  } },
  { id: 'seventies', name: 'Faded Seventies', desc: 'Yellow-green shadows, magenta whites, faded print', f: (c) => {
    const l = luma(...c);
    let o = sat(c, 0.8);
    o = tone(o, 75, 0.22, (1 - l) ** 2);
    o = tone(o, 330, 0.1, l * l);
    o = o.map((v) => sCurve(clamp01(v), -0.15));
    return lift(o, 0.1, [1, 0.95, 0.8]);
  } },
  { id: 'noir', name: 'Crushed Noir', desc: 'Near-monochrome, crushed shadows, cold', f: (c) => {
    let o = sat(c, 0.12);
    o = gains(o, 0.97, 1.0, 1.05);
    return o.map((v) => sCurve(clamp01((v - 0.04) / 0.96), 0.55));
  } },
  { id: 'autumn', name: 'Autumn Leaves', desc: 'Greens turn gold, reds deepen', f: (c) => {
    let o = hueShiftRange(c, 100, 55, -45, 1.1);
    o = hueShiftRange(o, 15, 25, -4, 1.2);
    o = gains(o, 1.04, 1.0, 0.9);
    return o.map((v) => sCurve(clamp01(v), 0.12));
  } },
  { id: 'cyber', name: 'Cyber Teal', desc: 'Everything cool and cyan, pink peaks', f: (c) => {
    const l = luma(...c);
    let o = gains(c, 0.86, 1.02, 1.1);
    o = tone(o, 180, 0.2, 1 - l);
    o = tone(o, 330, 0.18, smooth(0.6, 1, l));
    return o.map((v) => sCurve(clamp01(v), 0.25));
  } },
  { id: 'rose', name: 'Rose Print', desc: 'Warm magenta vintage print', f: (c) => {
    const l = luma(...c);
    let o = sat(c, 0.7);
    o = tone(o, 340, 0.16, 1 - Math.abs(l - 0.5) * 2);
    o = lift(o, 0.08, [0.95, 0.85, 0.85]);
    return o.map((v) => sCurve(clamp01(v), -0.1));
  } },
  { id: 'punch', name: 'Clean Punch', desc: 'Crisp contrast, rich but natural colour', f: (c) => {
    let o = sat(c, 1.22);
    return o.map((v) => sCurve(clamp01(v), 0.28));
  } },
];

export const BUILTIN_LUTS = GRADES.map(({ id, name, desc }) => ({ id, name, desc }));
const builtCache = new Map();

/** Build (once) and return a built-in grade as a 33³ LUT object, or null. */
export function getBuiltinLut(id, size = 33) {
  const key = id + ':' + size;
  if (builtCache.has(key)) return builtCache.get(key);
  const g = GRADES.find((x) => x.id === id);
  if (!g) return null;
  const n = size;
  const d = new Float32Array(n * n * n * 3);
  for (let b = 0; b < n; b++) for (let gg = 0; gg < n; gg++) for (let r = 0; r < n; r++) {
    const o = g.f([r / (n - 1), gg / (n - 1), b / (n - 1)]);
    const i = (r + gg * n + b * n * n) * 3;
    d[i] = clamp01(o[0]); d[i + 1] = clamp01(o[1]); d[i + 2] = clamp01(o[2]);
  }
  const lut = { title: g.name, kind: '3d', size: n, data: d, size1d: 0, data1d: null, domainMin: [0, 0, 0], domainMax: [1, 1, 1], domain1d: null, builtin: id };
  builtCache.set(key, lut);
  return lut;
}

/** Serialise a LUT to .cube text (e.g. to export a built-in grade). */
export function lutToCube(lut) {
  const { size, data } = lutTo3D(lut);
  const lines = [`TITLE "${cleanTitle(lut.title).replace(/"/g, '')}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < data.length; i += 3) lines.push(`${data[i].toFixed(6)} ${data[i + 1].toFixed(6)} ${data[i + 2].toFixed(6)}`);
  return lines.join('\n') + '\n';
}

/**
 * Turn a LUT into a look (plain data) that film.js accepts in registerLook()
 * or directly as the `lut` param: { id, name, group, desc, params: { lut, lutAmount } }.
 */
export function lutToLook(lut, { name, id } = {}) {
  if (typeof lut === 'string') lut = getBuiltinLut(lut);
  if (!lut) throw new Error('No LUT.');
  return {
    id: id || (lut.builtin ? 'lut-' + lut.builtin : 'lut-' + lutKey(lut)),
    name: cleanTitle(name || lut.title) || 'LUT',
    group: 'luts',
    desc: lut.builtin ? 'Built-in grade' : 'Imported .cube LUT',
    params: { lut, lutAmount: 100 },
  };
}
