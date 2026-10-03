// EYAD Depth — real monocular depth on this device, and new viewpoints from it.
//
//   estimateDepth(photo)        Depth Anything V2 Small (Apache-2.0) in onnxruntime-web (WASM).
//   prepareDepth(photo)         depth + edge-aware refinement against the photo (cached per photo).
//   renderDepthViews(prep, …)   N viewpoints along a horizontal baseline, toed-in on a pivot depth.
//
// View synthesis is a two-layer "layered depth image":
//   • background layer — the photo with everything that stands in front of a depth edge
//     removed and filled in from the far side (push-pull + mirrored texture), moved by the
//     background's own depth;
//   • foreground layer — a band along each depth edge with a soft matte, moved by the near
//     depth (extended outwards so the silhouette never stretches).
// Both are warped per pixel in WebGL (same maths on the CPU when WebGL is missing).
// Nothing leaves the device. The model file ships in studio/models/.
import { loadOrt, fetchModelBytes } from './inpaint.js';

export const DEPTH_MODEL = {
  id: 'depth-anything-v2-small', label: 'depth model', file: 'depth_anything_v2_vits.onnx',
  size: '28 MB', bytes: 28513516, license: 'Apache-2.0',
};

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const tick = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------ model
let sessionP = null;
/** Load (fetch / cache / compile) the depth model. Safe to call repeatedly. */
export function loadDepthModel({ onProgress, signal } = {}) {
  if (!sessionP) {
    sessionP = (async () => {
      const ort = await loadOrt();
      const bytes = await fetchModelBytes(DEPTH_MODEL, { onProgress, signal });
      onProgress && onProgress(null, 'Preparing the depth model…');
      await tick();
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, session };
    })().catch((e) => { sessionP = null; throw e; });
  }
  return sessionP;
}
export const depthModelReady = () => !!sessionP;

/** Default model input size (long side): smaller on phones so it stays within a few seconds. */
export function defaultDepthSize() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  return coarse || cores <= 4 ? 252 : 308;
}

function drawScaled(src, w, h) {
  // halve in steps so a big photo is not aliased by one bilinear jump
  let cur = src, cw = src.width, ch = src.height;
  while (cw > w * 2 && ch > h * 2) {
    const nw = Math.max(w, Math.round(cw / 2)), nh = Math.max(h, Math.round(ch / 2));
    const c = mk(nw, nh), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, nw, nh);
    cur = c; cw = nw; ch = nh;
  }
  const c = mk(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, w, h);
  return c;
}

/**
 * Relative inverse depth of a photo. → { data: Float32Array (0 = far … 1 = near), width, height, ms }
 */
export async function estimateDepth(source, { size = defaultDepthSize(), onProgress, signal } = {}) {
  const { ort, session } = await loadDepthModel({ onProgress, signal });
  if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  onProgress && onProgress(null, 'Measuring depth…');
  await tick();
  const k = size / Math.max(source.width, source.height);
  const w = Math.max(28, Math.round(source.width * k / 14) * 14), h = Math.max(28, Math.round(source.height * k / 14) * 14);
  const px = drawScaled(source, w, h).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const n = w * h, x = new Float32Array(3 * n);
  const M = [0.485, 0.456, 0.406], S = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) x[c * n + i] = (px[i * 4 + c] / 255 - M[c]) / S[c];
  const t0 = performance.now();
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, h, w]) });
  const out = res[session.outputNames[0]];
  const od = out.data, oh = out.dims[out.dims.length - 2], ow = out.dims[out.dims.length - 1];
  // robust normalisation (1st … 99th percentile)
  const sorted = Float32Array.from(od).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.99)], span = Math.max(1e-6, hi - lo);
  const data = new Float32Array(ow * oh);
  for (let i = 0; i < data.length; i++) data[i] = clamp01((od[i] - lo) / span);
  out.dispose && out.dispose();
  return { data, width: ow, height: oh, ms: performance.now() - t0 };
}

// ------------------------------------------------------------------ small image maths (Float32 planes)
function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[o + x] = s; s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; }
  }
  const d = (2 * r + 1) * (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / d; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}
/** 1-D running max over a window of radius r (van Herk / Gil-Werman), in place via scratch buffers. */
function runMax(buf, n, r, g, hh, out, stride, base, obase) {
  const k = 2 * r + 1, N = n + 2 * r;
  // padded read: index j in [0, N) ↔ source j - r (outside = -Infinity)
  for (let j = 0; j < N; j++) {
    const v = j < r || j >= n + r ? -Infinity : buf[base + (j - r) * stride];
    g[j] = j % k === 0 ? v : (g[j - 1] > v ? g[j - 1] : v);
  }
  for (let j = N - 1; j >= 0; j--) {
    const v = j < r || j >= n + r ? -Infinity : buf[base + (j - r) * stride];
    hh[j] = j === N - 1 || (j + 1) % k === 0 ? v : (hh[j + 1] > v ? hh[j + 1] : v);
  }
  for (let i = 0; i < n; i++) { const a = hh[i], b = g[i + 2 * r]; out[obase + i * stride] = a > b ? a : b; }
}
/** Separable min (sign = -1) or max (sign = +1) filter over a (2r+1)² square. */
function extreme(src, w, h, r, sign) {
  if (r < 1) return src;
  let a = src;
  if (sign < 0) { a = new Float32Array(src.length); for (let i = 0; i < a.length; i++) a[i] = -src[i]; }
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), L = Math.max(w, h) + 2 * r, g = new Float32Array(L), hh = new Float32Array(L);
  for (let y = 0; y < h; y++) runMax(a, w, r, g, hh, tmp, 1, y * w, y * w);
  for (let x = 0; x < w; x++) runMax(tmp, h, r, g, hh, out, w, x, x);
  if (sign < 0) for (let i = 0; i < out.length; i++) out[i] = -out[i];
  return out;
}
function resizeBilinear(src, sw, sh, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / h - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / w - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      out[y * w + x] = (src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx) * (1 - ty) + (src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx) * ty;
    }
  }
  return out;
}
/** Guided filter: smooths p but keeps (and snaps to) the edges of the guide I. */
function guided(I, p, w, h, r, eps) {
  const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxBlur(I, w, h, r), mp = boxBlur(p, w, h, r), mIp = boxBlur(Ip, w, h, r), mII = boxBlur(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i]; a[i] = c / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = clamp01(ma[i] * I[i] + mb[i]);
  return q;
}

/** Fill pixels with weight 0 from weighted neighbours at ever coarser scales (push-pull). vals: C planes. */
function pushPull(planes, wgt, w, h) {
  const C = planes.length;
  const levels = [{ v: planes.map((p) => Float32Array.from(p)), a: Float32Array.from(wgt), w, h }];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const L = levels[levels.length - 1], nw = Math.max(1, Math.ceil(L.w / 2)), nh = Math.max(1, Math.ceil(L.h / 2));
    const v = L.v.map(() => new Float32Array(nw * nh)), a = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let ws = 0; const o = y * nw + x;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(L.w - 1, x * 2 + dx), sy = Math.min(L.h - 1, y * 2 + dy), i = sy * L.w + sx, ww = L.a[i];
        if (ww > 0) { ws += ww; for (let c = 0; c < C; c++) v[c][o] += L.v[c][i] * ww; }
      }
      if (ws > 0) for (let c = 0; c < C; c++) v[c][o] /= ws;
      a[o] = Math.min(1, ws);
    }
    levels.push({ v, a, w: nw, h: nh });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], U = levels[l + 1];
    const up = U.v.map((p) => resizeBilinear(p, U.w, U.h, L.w, L.h));
    for (let i = 0; i < L.a.length; i++) {
      const a = L.a[i]; if (a >= 1) continue;
      for (let c = 0; c < C; c++) L.v[c][i] = L.v[c][i] * a + up[c][i] * (1 - a);
      L.a[i] = 1;
    }
  }
  return levels[0].v;
}

/** For every pixel, the index of the nearest pixel where valid[i] is truthy (two-pass 8SSEDT). */
function nearestValid(valid, w, h) {
  const n = w * h, BIG = 1e9, dx = new Float32Array(n), dy = new Float32Array(n);
  for (let i = 0; i < n; i++) { if (valid[i]) { dx[i] = 0; dy[i] = 0; } else { dx[i] = BIG; dy[i] = BIG; } }
  const cmp = (i, x, y, ox, oy) => {
    const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
    const j = yy * w + xx; if (dx[j] >= BIG) return;
    const cx = dx[j] + ox, cy = dy[j] + oy;
    if (cx * cx + cy * cy < dx[i] * dx[i] + dy[i] * dy[i]) { dx[i] = cx; dy[i] = cy; }
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { const i = y * w + x; cmp(i, x, y, -1, 0); cmp(i, x, y, 0, -1); cmp(i, x, y, -1, -1); cmp(i, x, y, 1, -1); }
    for (let x = w - 1; x >= 0; x--) cmp(y * w + x, x, y, 1, 0);
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) { const i = y * w + x; cmp(i, x, y, 1, 0); cmp(i, x, y, 0, 1); cmp(i, x, y, 1, 1); cmp(i, x, y, -1, 1); }
    for (let x = 0; x < w; x++) cmp(y * w + x, x, y, -1, 0);
  }
  return { dx, dy, BIG };
}

/** Depth edges become real steps (a ramp would smear a silhouette across depths); gentle slopes are left alone. */
function sharpenSteps(D, w, h, r, iters) {
  for (let it = 0; it < iters; it++) {
    const lo = extreme(D, w, h, r, -1), hi = extreme(D, w, h, r, 1), S = new Float32Array(D.length);
    for (let i = 0; i < D.length; i++) {
      const span = hi[i] - lo[i];
      if (span < 0.05) { S[i] = D[i]; continue; }
      const snap = D[i] - lo[i] > span * 0.5 ? hi[i] : lo[i], k = Math.min(1, (span - 0.05) / 0.05);
      S[i] = D[i] + (snap - D[i]) * k;
    }
    D = S;
  }
  return D;
}
/**
 * Move each depth edge onto the picture's own edge: pixels within 2 px of a depth step join
 * whichever side (near / far) their colour matches, judged against the mean colour of the
 * pixels that surely belong to each side. Local, so nothing leaks along background structures.
 */
function snapEdges(D, px, w, h) {
  const n = w * h, R = 5, lo = extreme(D, w, h, R, -1), hi = extreme(D, w, h, R, 1);
  const isF = new Float32Array(n), isB = new Float32Array(n);
  let any = 0;
  for (let i = 0; i < n; i++) {
    const span = hi[i] - lo[i]; if (span < 0.08) continue;
    if (D[i] - lo[i] > span * 0.5) isF[i] = 1; else isB[i] = 1;
    any++;
  }
  if (!any) return D;
  const nearB = extreme(isB, w, h, 2, 1), nearF = extreme(isF, w, h, 2, 1), sF = new Float32Array(n), sB = new Float32Array(n);
  for (let i = 0; i < n; i++) { sF[i] = isF[i] && !nearB[i] ? 1 : 0; sB[i] = isB[i] && !nearF[i] ? 1 : 0; }
  const wF = boxBlur(sF, w, h, R), wB = boxBlur(sB, w, h, R), mF = [], mB = [];
  for (let c = 0; c < 3; c++) {
    const a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = px[i * 4 + c]; a[i] = v * sF[i]; b[i] = v * sB[i]; }
    mF.push(boxBlur(a, w, h, R)); mB.push(boxBlur(b, w, h, R));
  }
  const out = Float32Array.from(D);
  for (let i = 0; i < n; i++) {
    if (!(isF[i] && nearB[i]) && !(isB[i] && nearF[i])) continue;   // only the uncertain strip
    if (wF[i] < 0.02 || wB[i] < 0.02) continue;
    let dF = 0, dB = 0, sep = 0;
    for (let c = 0; c < 3; c++) { const f = mF[c][i] / wF[i], b = mB[c][i] / wB[i], v = px[i * 4 + c]; dF += (v - f) * (v - f); dB += (v - b) * (v - b); sep += (f - b) * (f - b); }
    if (sep < 900) continue;                                         // the two sides look alike: trust the model
    const fg = dF < dB;
    if (fg && !isF[i]) out[i] = hi[i]; else if (!fg && isF[i]) out[i] = lo[i];
  }
  return out;
}

// ------------------------------------------------------------------ depth for a photo (cached)
const prepCache = new WeakMap();
/**
 * Depth of a photo, refined against its own edges, on a working grid.
 * → { photo, D (Float32 0..1, near = 1), gw, gh, ms }   (cached per photo canvas)
 */
export async function prepareDepth(photo, { size, grid = 640, onProgress, signal } = {}) {
  const hit = prepCache.get(photo);
  if (hit) return hit;
  const raw = await estimateDepth(photo, { size, onProgress, signal });
  onProgress && onProgress(null, 'Refining edges…');
  await tick();
  const k = Math.min(1, grid / Math.max(photo.width, photo.height));
  const gw = Math.max(16, Math.round(photo.width * k)), gh = Math.max(16, Math.round(photo.height * k));
  const small = drawScaled(photo, gw, gh);
  const px = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, gw, gh).data;
  const I = new Float32Array(gw * gh);
  for (let i = 0; i < I.length; i++) I[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
  let D = resizeBilinear(raw.data, raw.width, raw.height, gw, gh);
  D = sharpenSteps(D, gw, gh, 3, 2);
  D = snapEdges(D, px, gw, gh);
  const prep = { photo, D, gw, gh, px, ms: raw.ms, model: { w: raw.width, h: raw.height } };
  prepCache.set(photo, prep);
  return prep;
}

/** The depth map as a greyscale canvas (white = near). */
export function depthCanvas(prep) {
  const c = mk(prep.gw, prep.gh), g = c.getContext('2d'), im = g.createImageData(prep.gw, prep.gh);
  for (let i = 0; i < prep.D.length; i++) { const v = prep.D[i] * 255; im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  return c;
}

/** Depth (0..1) under a point of the photo (x, y in 0..1): median of a small window. */
export function depthAt(prep, x, y) {
  const { D, gw, gh } = prep, r = Math.max(2, Math.round(gw / 60));
  const cx = Math.round(clamp01(x) * (gw - 1)), cy = Math.round(clamp01(y) * (gh - 1)), v = [];
  for (let yy = Math.max(0, cy - r); yy <= Math.min(gh - 1, cy + r); yy++) for (let xx = Math.max(0, cx - r); xx <= Math.min(gw - 1, cx + r); xx++) v.push(D[yy * gw + xx]);
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}
/** A sensible pivot when the user has not picked one: the depth of what sits near and central (the subject). */
export function autoPivot(prep) {
  const { D, gw, gh } = prep, bins = new Float32Array(64);
  let tot = 0;
  for (let y = 0; y < gh; y += 2) for (let x = 0; x < gw; x += 2) {
    const d = D[y * gw + x], nx = x / gw - 0.5, ny = y / gh - 0.5;
    const wgt = Math.exp(-(nx * nx + ny * ny) * 7) * (0.15 + d * d);
    bins[Math.min(63, Math.floor(d * 64))] += wgt; tot += wgt;
  }
  let acc = 0;
  for (let i = 0; i < 64; i++) { acc += bins[i]; if (acc >= tot * 0.5) return (i + 0.5) / 64; }
  return 0.5;
}

// ------------------------------------------------------------------ layers
/**
 * Split the photo into a background plate and a foreground band for a given
 * maximum relative shift (delta, in grid pixels, between the nearest and farthest depth).
 * → { maps: ImageData (R = foreground depth, G = background depth, B = matte), fill: ImageData (RGB = fill, A = where) }
 */
function buildLayers(prep, delta) {
  const { D, gw: w, gh: h, px } = prep, n = w * h;
  const dl = Math.max(2, Math.ceil(delta));
  const Rh = dl + 2, Ra = 2 * dl + 5, rd = dl + 3;
  const tau = Math.min(0.2, Math.max(0.045, 0.6 / dl));
  // 1. real depth steps (not slopes): pixels that stand in front of something 3 px away
  const min3 = extreme(D, w, h, 3, -1), seed = new Float32Array(n);
  let seeds = 0;
  for (let i = 0; i < n; i++) if (D[i] - min3[i] > tau) { seed[i] = 1; seeds++; }
  const maps = new ImageData(w, h), fill = new ImageData(w, h);
  if (!seeds) {
    for (let i = 0; i < n; i++) { const v = D[i] * 255; maps.data[i * 4] = v; maps.data[i * 4 + 1] = v; maps.data[i * 4 + 2] = 0; maps.data[i * 4 + 3] = 255; }
    return { maps, fill, seeds: 0 };
  }
  // 2. the near side of those steps: the upper half of the depth range found around the pixel
  const loW = extreme(D, w, h, Ra, -1), hiW = extreme(D, w, h, Ra, 1), near = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const span = hiW[i] - loW[i]; near[i] = span > tau && D[i] - loW[i] > span * 0.5 ? 1 : 0; }
  const sA = extreme(seed, w, h, Ra, 1), sH = extreme(seed, w, h, Rh, 1), sO = extreme(seed, w, h, 2, 1);
  const band = new Float32Array(n), hole = new Float32Array(n), valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    band[i] = sA[i] && near[i] ? 1 : 0;
    hole[i] = (sH[i] && near[i]) || sO[i] ? 1 : 0;
    valid[i] = !hole[i] && !band[i] ? 1 : 0;          // by construction the far side of an edge is the nearest valid pixel
  }
  // matte: a pixel wider than the band on the outside (mixed edge pixels travel with the subject), soft
  const bandW = extreme(band, w, h, 1, 1), A = boxBlur(bandW, w, h, 1);
  // foreground depth: the band's own depth pushed outwards, so the silhouette moves as one piece
  const bandD = new Float32Array(n); for (let i = 0; i < n; i++) bandD[i] = band[i] ? D[i] : 0;
  const push = extreme(bandD, w, h, rd, 1), Dfg = new Float32Array(n);
  for (let i = 0; i < n; i++) Dfg[i] = band[i] ? D[i] : Math.max(D[i], push[i]);
  // steps this two-layer split cannot serve (a middle object right next to a nearer one): let them
  // stretch a little rather than tear
  const loose = new Float32Array(n); let nLoose = 0;
  for (let i = 0; i < n; i++) if (seed[i] && !band[i]) { loose[i] = 1; nLoose++; }
  const soft = nLoose ? boxBlur(extreme(loose, w, h, dl, 1), w, h, 2) : null, Dblur = nLoose ? boxBlur(D, w, h, Math.max(2, dl >> 1)) : null;
  // 3. background plate: colour + depth filled in from the far side
  let any = 0; for (let i = 0; i < n; i++) any += valid[i];
  if (!any) for (let i = 0; i < n; i++) valid[i] = hole[i] ? 0 : 1;
  const P = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)], wg = new Float32Array(n);
  for (let i = 0; i < n; i++) { wg[i] = valid[i] ? (near[i] ? 0.02 : 1) : 0; P[0][i] = px[i * 4]; P[1][i] = px[i * 4 + 1]; P[2][i] = px[i * 4 + 2]; P[3][i] = D[i]; }
  const pp = pushPull(P, wg, w, h);
  const nv = nearestValid(valid, w, h);
  const F = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], Dbg = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!hole[i]) { F[0][i] = px[i * 4]; F[1][i] = px[i * 4 + 1]; F[2][i] = px[i * 4 + 2]; Dbg[i] = soft ? D[i] + (Dblur[i] - D[i]) * soft[i] : D[i]; continue; }
    Dbg[i] = nv.dx[i] < nv.BIG ? Math.min(D[i], D[(y + nv.dy[i]) * w + x + nv.dx[i]]) : pp[3][i];
    let r = pp[0][i], g = pp[1][i], b = pp[2][i];
    if (nv.dx[i] < nv.BIG) {
      // real texture instead of a smear: mirror across the nearest background pixel,
      // or (when the mirror lands on something that is not background) repeat that pixel
      const nx = x + nv.dx[i], ny = y + nv.dy[i];
      let j = (ny * w + nx) * 4, m = 0.75;
      const mx = Math.round(x + nv.dx[i] * 2), my = Math.round(y + nv.dy[i] * 2);
      if (mx >= 0 && my >= 0 && mx < w && my < h && valid[my * w + mx]) { j = (my * w + mx) * 4; m = 0.9; }
      r = r * (1 - m) + px[j] * m; g = g * (1 - m) + px[j + 1] * m; b = b * (1 - m) + px[j + 2] * m;
    }
    F[0][i] = r; F[1][i] = g; F[2][i] = b;
  }
  const holeSoft = boxBlur(extreme(hole, w, h, 1, 1), w, h, 1);
  const Fb = F.map((p) => boxBlur(p, w, h, 1));
  const DbgS = boxBlur(Dbg, w, h, 2), DfgS = boxBlur(Dfg, w, h, 1);
  for (let i = 0; i < n; i++) {
    const hs = hole[i] ? 1 : holeSoft[i];
    maps.data[i * 4] = DfgS[i] * 255; maps.data[i * 4 + 1] = (hole[i] ? DbgS[i] : Dbg[i]) * 255; maps.data[i * 4 + 2] = A[i] * 255; maps.data[i * 4 + 3] = 255;
    fill.data[i * 4] = hole[i] ? Fb[0][i] : F[0][i]; fill.data[i * 4 + 1] = hole[i] ? Fb[1][i] : F[1][i]; fill.data[i * 4 + 2] = hole[i] ? Fb[2][i] : F[2][i]; fill.data[i * 4 + 3] = hs * 255;
  }
  return { maps, fill, seeds };
}

// ------------------------------------------------------------------ renderers
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uImg, uMaps, uFill;
uniform vec2 uOut;
uniform vec4 uCrop;      // source uv = uCrop.xy + out uv * uCrop.zw
uniform float uK, uPiv, uAspect, uFall;
uniform vec3 uLens;      // roll (rad), vertical offset, keystone
void main() {
  vec2 o = vec2(gl_FragCoord.x / uOut.x, 1.0 - gl_FragCoord.y / uOut.y);
  vec2 c = uCrop.xy + o * uCrop.zw - 0.5;
  c.x *= uAspect;
  float cs = cos(uLens.x), sn = sin(uLens.x);
  c = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  c.x /= uAspect;
  c.y *= 1.0 + uLens.z * c.x;
  vec2 p = c + 0.5 + vec2(0.0, uLens.y);
  vec2 u = p, v = p;
  for (int i = 0; i < 5; i++) {
    u.x = p.x - uK * (texture2D(uMaps, u).g - uPiv);
    v.x = p.x - uK * (texture2D(uMaps, v).r - uPiv);
  }
  vec4 mb = texture2D(uMaps, u), mf = texture2D(uMaps, v), f = texture2D(uFill, u);
  vec3 bg = mix(texture2D(uImg, u).rgb, f.rgb, f.a);
  vec3 col = mix(bg, texture2D(uImg, v).rgb, mf.b);
  float d = mix(mb.g, mf.r, mf.b);
  col *= 1.0 - uFall * (1.0 - d) * (1.0 - d);
  gl_FragColor = vec4(col, 1.0);
}`;
const VS = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

let glState = null;
function getGL() {
  if (glState === false) return null;
  if (glState && !glState.gl.isContextLost()) return glState;
  try {
    const canvas = mk(16, 16);
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) { glState = false; return null; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aPos'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
    const U = {}; for (const k of ['uImg', 'uMaps', 'uFill', 'uOut', 'uCrop', 'uK', 'uPiv', 'uAspect', 'uFall', 'uLens']) U[k] = gl.getUniformLocation(prog, k);
    glState = { gl, canvas, prog, U, tImg: tex(), tMaps: tex(), tFill: tex(), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096 };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); glState = null; });
    return glState;
  } catch (e) { glState = false; return null; }
}

function renderGL(S, img, layers, out, views) {
  const { gl, canvas, prog, U } = S;
  canvas.width = out.w; canvas.height = out.h;
  gl.viewport(0, 0, out.w, out.h);
  gl.useProgram(prog); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const put = (unit, t, src) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); };
  put(0, S.tImg, img); put(1, S.tMaps, layers.maps); put(2, S.tFill, layers.fill);
  gl.uniform1i(U.uImg, 0); gl.uniform1i(U.uMaps, 1); gl.uniform1i(U.uFill, 2);
  gl.uniform2f(U.uOut, out.w, out.h); gl.uniform4f(U.uCrop, out.cx, out.cy, out.cw, out.ch);
  gl.uniform1f(U.uAspect, img.width / img.height);
  const frames = [];
  for (const v of views) {
    gl.uniform1f(U.uK, v.k); gl.uniform1f(U.uPiv, v.piv); gl.uniform1f(U.uFall, v.fall); gl.uniform3f(U.uLens, v.roll, v.dy, v.key);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('WebGL failed');
    const c = mk(out.w, out.h); c.getContext('2d').drawImage(canvas, 0, 0); frames.push(c);
  }
  canvas.width = 16; canvas.height = 16; // give the memory back
  return frames;
}

/** Same warp on the CPU (bilinear maps, nearest photo pixel). */
function renderCPU(img, layers, out, views) {
  const W = img.width, H = img.height, src = img.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const mw = layers.maps.width, mh = layers.maps.height, M = layers.maps.data, F = layers.fill.data, asp = W / H;
  const samp = (arr, ch, u, v) => {
    const fx = Math.min(mw - 1, Math.max(0, u * mw - 0.5)), fy = Math.min(mh - 1, Math.max(0, v * mh - 0.5));
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    return ((arr[(y0 * mw + x0) * 4 + ch] * (1 - tx) + arr[(y0 * mw + x1) * 4 + ch] * tx) * (1 - ty) + (arr[(y1 * mw + x0) * 4 + ch] * (1 - tx) + arr[(y1 * mw + x1) * 4 + ch] * tx) * ty) / 255;
  };
  const pix = (u, v) => (Math.min(H - 1, Math.max(0, Math.round(v * H - 0.5))) * W + Math.min(W - 1, Math.max(0, Math.round(u * W - 0.5)))) * 4;
  return views.map((vw) => {
    const c = mk(out.w, out.h), g = c.getContext('2d'), im = g.createImageData(out.w, out.h), o = im.data;
    const cs = Math.cos(vw.roll), sn = Math.sin(vw.roll);
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
      let cx = (out.cx + (x + 0.5) / out.w * out.cw - 0.5) * asp, cy = out.cy + (y + 0.5) / out.h * out.ch - 0.5;
      const rx = (cx * cs - cy * sn) / asp, ry = (cx * sn + cy * cs) * (1 + vw.key * ((cx * cs - cy * sn) / asp));
      const px = rx + 0.5, py = ry + 0.5 + vw.dy;
      let u = px, v = px;
      for (let i = 0; i < 4; i++) { u = px - vw.k * (samp(M, 1, u, py) - vw.piv); v = px - vw.k * (samp(M, 0, v, py) - vw.piv); }
      const a = samp(M, 2, v, py), fa = samp(F, 3, u, py), bi = pix(u, py), fi = pix(v, py);
      const d = samp(M, 1, u, py) * (1 - a) + samp(M, 0, v, py) * a, fall = 1 - vw.fall * (1 - d) * (1 - d);
      const j = (y * out.w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const bg = src[bi + ch] * (1 - fa) + samp(F, ch, u, py) * 255 * fa;
        o[j + ch] = (bg * (1 - a) + src[fi + ch] * a) * fall;
      }
      o[j + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return c;
  });
}

/** Per-lens mechanical tolerances of a cheap four-lens camera (radians / fraction of height). */
const LENS = [
  { roll: 0.0014, dy: 0.0009 }, { roll: -0.0007, dy: -0.0005 }, { roll: 0.0009, dy: -0.0008 }, { roll: -0.0016, dy: 0.0006 },
];

/**
 * Render n viewpoints along a horizontal baseline, toed-in so the pivot depth stays still.
 * @param prep      from prepareDepth()
 * @param opts.n         number of lenses (4)
 * @param opts.strength  parallax amount, 1 = four lenses 18 mm apart on a subject ~1.5 m away (0…2.5)
 * @param opts.pivot     depth 0..1 that stays still (default: autoPivot)
 * @param opts.flash     0..1 flash fall-off: far things get darker
 * @param opts.jitter    0..1 per-lens roll / height mismatch
 * @param opts.forceCPU  skip WebGL (tests)
 * → { frames: canvas[], renderer: 'webgl' | 'canvas', pivot, crop }
 */
export function renderDepthViews(prep, { n = 4, strength = 1, pivot, flash = 0, jitter = 1, forceCPU = false } = {}) {
  const piv = pivot == null ? autoPivot(prep) : clamp01(pivot);
  const S = 0.05 * Math.max(0, strength);       // total parallax between the outer lenses for the full depth range, as a share of the width
  let img = prep.photo;
  const gs = forceCPU ? null : getGL();
  const cap = gs ? Math.min(gs.maxTex, 4096) : 1600;
  if (Math.max(img.width, img.height) > cap) { const k = cap / Math.max(img.width, img.height); img = drawScaled(img, Math.round(img.width * k), Math.round(img.height * k)); }
  const W = img.width, H = img.height;
  const t0 = performance.now();
  const key = 'layers:' + S.toFixed(4);
  if (prep._layersKey !== key) { prep._layers = buildLayers(prep, Math.max(1, 0.5 * S * prep.gw)); prep._layersKey = key; }
  const layers = prep._layers; const t1 = performance.now();
  // crop so no view ever shows the frame edge
  const maxShift = 0.5 * S * Math.max(piv, 1 - piv), marginX = maxShift + 0.004 * jitter + 0.002, marginY = (0.003 + 0.004) * jitter + 0.001;
  const f = 1 - 2 * Math.max(marginX, marginY);
  const out = { w: Math.max(8, Math.round(W * f / 2) * 2), h: Math.max(8, Math.round(H * f / 2) * 2), cx: (1 - f) / 2, cy: (1 - f) / 2, cw: f, ch: f };
  const views = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0, L = LENS[i % LENS.length];
    views.push({ k: -t * S, piv, fall: flash * 0.55, roll: L.roll * jitter, dy: L.dy * jitter, key: t * 0.018 * Math.min(1.5, strength) });
  }
  let frames = null, renderer = 'webgl';
  if (gs) { try { frames = renderGL(gs, img, layers, out, views); } catch (e) { frames = null; } }
  if (!frames) { renderer = 'canvas'; frames = renderCPU(img.getContext ? img : drawScaled(img, W, H), layers, out, views); }
  return { frames, renderer, pivot: piv, crop: out, ms: { layers: t1 - t0, draw: performance.now() - t1 } };
}
