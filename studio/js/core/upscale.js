// EYAD Upscale — on-device AI super-resolution (×4, or ×2 by halving the ×4 result).
//
//   upscale(source, { scale, model, onProgress, signal }) → Promise<HTMLCanvasElement>
//
// Network: Real-ESRGAN "compact" (SRVGGNetCompact, BSD-3-Clause) in onnxruntime-web (WASM).
//   photo  realesr-general-x4v3   2.4 MB   photos, scans, logos, anything
//   art    realesr-animevideov3   1.2 MB   flat illustration / cartoon artwork, about twice as fast
// The image is cut into overlapping tiles; each tile runs in a Web Worker (a small pool, one WASM
// thread each, so it also scales on pages that are not cross-origin isolated) and the results are
// cross-faded over the overlap, so there are no seams. Transparency is kept: the colours are upscaled
// by the network on an opaque copy and the alpha channel is enlarged separately.
// Nothing leaves the device; nothing loads until upscale() is first called.
import { fetchModelBytes } from './inpaint.js';

export const UPSCALE_MODELS = {
  photo: { id: 'photo', label: 'upscaler (photo)', file: 'realesr_general_x4v3.onnx', single: true, bytes: 2435294, size: '2.4 MB', license: 'BSD-3-Clause', sPerMP: 110 },
  art: { id: 'art', label: 'upscaler (illustration)', file: 'realesr_animevideo_x4v3.onnx', single: true, bytes: 1247549, size: '1.2 MB', license: 'BSD-3-Clause', sPerMP: 60 },
};
export const NET_SCALE = 4;
export const MAX_OUTPUT_SIDE = 8192;
const TILE = 160, OVERLAP = 24, TRIM = 4; // input px: tiles overlap by 24; the outer 4 are dropped, the other 16 cross-fade
const SPEED_KEY = 'eyad:upscale:speed';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const abortErr = () => new DOMException('Cancelled', 'AbortError');
const tick = () => new Promise((r) => setTimeout(r, 0));

function isSmallDevice() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const mem = navigator.deviceMemory;
  return coarse || (mem && mem <= 4) || (navigator.hardwareConcurrency || 4) <= 2;
}
/** What this device is allowed to do: { maxPixels (input), maxSide (input), workers, small }. */
export function upscaleLimits() {
  const small = isSmallDevice(), cores = navigator.hardwareConcurrency || 2;
  const mem = navigator.deviceMemory;
  return {
    small,
    // input megapixels (the ×4 result has 16× as many): phones stay under the 16.7 MP canvas limit of iOS
    maxPixels: mem && mem <= 2 ? 0.5e6 : small ? 1e6 : 3e6,
    maxSide: Math.floor(MAX_OUTPUT_SIDE / NET_SCALE),  // 2048 px input side → 8192 px output side
    workers: typeof Worker === 'undefined' ? 0 : Math.max(1, Math.min(small ? 2 : 4, cores - 1)),
  };
}
/** Size the input has to be reduced to (never enlarged) to fit this device: { width, height, reduced }. */
export function fitInput(w, h, lim = upscaleLimits()) {
  const k = Math.min(1, lim.maxSide / Math.max(w, h), Math.sqrt(lim.maxPixels / (w * h)));
  return k >= 1 ? { width: w, height: h, reduced: false } : { width: Math.max(1, Math.floor(w * k)), height: Math.max(1, Math.floor(h * k)), reduced: true };
}
function speeds() { try { return JSON.parse(localStorage.getItem(SPEED_KEY)) || {}; } catch (e) { return {}; } }
const tileMP = (w, h) => tilePlan(w, h).reduce((a, t) => a + t.w * t.h, 0) / 1e6; // megapixels the network really processes (tiles overlap)
/** Rough time for an input of w×h: { seconds, measured } — measured on this device after the first run. */
export function estimateSeconds(w, h, model = 'photo') {
  const m = UPSCALE_MODELS[model] || UPSCALE_MODELS.photo, lim = upscaleLimits(), got = speeds()[m.id];
  // default: seconds per processed megapixel for ONE worker, measured in desktop Chromium (WASM SIMD); phones are assumed twice as slow
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const sPerMP = got > 0 ? got : m.sPerMP / Math.max(1, lim.workers) * (coarse ? 2 : 1);
  return { seconds: Math.max(1, tileMP(w, h) * sPerMP + (pool && pool.model === m.id ? 0 : 1.5)), measured: got > 0 };
}

function axis(n) { // tile starts along one axis
  if (n <= TILE) return [0];
  const step = TILE - OVERLAP, out = [];
  for (let p = 0; p + TILE < n; p += step) out.push(p);
  out.push(n - TILE);
  return out;
}
export function tilePlan(w, h) {
  const xs = axis(w), ys = axis(h), out = [];
  for (const y of ys) for (const x of xs) out.push({ x, y, w: Math.min(TILE, w), h: Math.min(TILE, h) });
  return out;
}

// ------------------------------------------------------------------ runners (worker pool, or the page itself)
let pool = null; // { model, runners: [{ run(rgba,w,h), kill() }] }
function killPool() { if (pool) { for (const r of pool.runners) r.kill(); pool = null; } }

function workerRunner(bytes) {
  return new Promise((resolve, reject) => {
    let w; try { w = new Worker(new URL('./upscale-worker.js', import.meta.url), { type: 'module' }); } catch (e) { reject(e); return; }
    let pending = null, ready = false;
    const fail = (msg) => { const e = new Error(msg); if (!ready) reject(e); else if (pending) { pending.reject(e); pending = null; } };
    w.onerror = (e) => { e.preventDefault && e.preventDefault(); fail('The upscaler could not start (' + (e.message || 'worker error') + ')'); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { ready = true; resolve({ run, kill: () => { w.terminate(); if (pending) { pending.reject(abortErr()); pending = null; } } }); }
      else if (m.type === 'done' && pending) { const p = pending; pending = null; p.resolve({ rgba: new Uint8ClampedArray(m.rgba), w: m.w, h: m.h }); }
      else if (m.type === 'error') fail(m.message);
    };
    const run = (rgba, tw, th) => new Promise((res, rej) => { pending = { resolve: res, reject: rej }; w.postMessage({ type: 'run', id: 0, rgba: rgba.buffer, w: tw, h: th }, [rgba.buffer]); });
    const copy = bytes.slice().buffer;
    w.postMessage({ type: 'init', model: copy }, [copy]);
  });
}

async function getPool(m, onProgress, signal) {
  if (pool && pool.model === m.id) return pool;
  killPool();
  const bytes = await fetchModelBytes(m, { onProgress: onProgress ? (f, msg) => onProgress(null, f != null && f < 1 ? `Getting the upscaler (${m.size}, first time only)… ${Math.round(f * 100)}%` : msg) : null, signal });
  if (signal && signal.aborted) throw abortErr();
  onProgress && onProgress(null, 'Starting the upscaler…');
  const want = upscaleLimits().workers, runners = [];
  if (want > 0) {
    const made = await Promise.allSettled(Array.from({ length: want }, () => workerRunner(bytes)));
    for (const r of made) if (r.status === 'fulfilled') runners.push(r.value);
  }
  if (signal && signal.aborted) { for (const r of runners) r.kill(); throw abortErr(); }
  if (!runners.length) { // no module workers here: run on the page, yielding between tiles
    const { makeRunner } = await import('./upscale-worker.js');
    const run = await makeRunner(bytes);
    runners.push({ run: async (rgba, w, h) => { await tick(); return run(rgba, w, h); }, kill: () => {}, inline: true });
  }
  pool = { model: m.id, runners };
  return pool;
}
/** Free the workers and the model (they are re-created on the next upscale). */
export function releaseUpscaler() { killPool(); }

// ------------------------------------------------------------------ pixels
/** Opaque copy of the source for the network: transparent areas take the colour of what is next to them (no dark halo). */
function opaqueCopy(src, w, h, hasAlpha) {
  const c = mk(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  if (hasAlpha) {
    g.globalCompositeOperation = 'destination-over';
    for (const r of [1, 2, 4, 8, 16, 32]) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) g.drawImage(c, dx, dy);
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}
function anyAlpha(src, w, h) {
  const k = Math.min(1, 512 / Math.max(w, h)), c = mk(w * k, h * k), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

/** Blend one finished tile into the output: cross-fade over the overlap with what is already there (tiles arrive in reading order). */
function composite(og, t, res) {
  const S = NET_SCALE, W = res.w, H = res.h, px = res.rgba;
  const trim = TRIM * S, fade = (OVERLAP - 2 * TRIM) * S;
  const left = t.x > 0, top = t.y > 0;
  if (left || top) {
    const old = og.getImageData(t.x * S, t.y * S, W, H).data;
    for (let y = 0; y < H; y++) {
      const ay = !top ? 1 : y < trim ? 0 : y >= trim + fade ? 1 : (y - trim + 0.5) / fade;
      const xEnd = ay < 1 ? W : left ? trim + fade : 0; // only the fading band needs work
      for (let x = 0; x < xEnd; x++) {
        const ax = !left ? 1 : x < trim ? 0 : x >= trim + fade ? 1 : (x - trim + 0.5) / fade;
        const a = ax * ay; if (a >= 1) continue;
        const p = (y * W + x) * 4;
        px[p] = px[p] * a + old[p] * (1 - a); px[p + 1] = px[p + 1] * a + old[p + 1] * (1 - a); px[p + 2] = px[p + 2] * a + old[p + 2] * (1 - a);
      }
    }
  }
  og.putImageData(new ImageData(px, W, H), t.x * S, t.y * S);
}

/**
 * Upscale an image with the on-device network.
 * @param {HTMLCanvasElement|ImageBitmap|HTMLImageElement} source  not modified. Must already fit upscaleLimits() (see fitInput).
 * @param {{scale?: 2|4, model?: 'photo'|'art', onProgress?: (fraction: number|null, message: string, info?: {tile:number,tiles:number,eta:number}) => void, signal?: AbortSignal}} opts
 * @returns {Promise<HTMLCanvasElement>} a new canvas, scale × the source size
 */
export async function upscale(source, { scale = 4, model = 'photo', onProgress, signal } = {}) {
  const m = UPSCALE_MODELS[model] || UPSCALE_MODELS.photo;
  const w = source.width, h = source.height, lim = upscaleLimits();
  if (!(w > 0 && h > 0)) throw new Error('This image is empty.');
  if (typeof WebAssembly !== 'object') throw new Error('This browser cannot run the on-device upscaler (no WebAssembly).');
  if (w * h > lim.maxPixels * 1.001 || Math.max(w, h) > lim.maxSide) throw new Error('This image is too large to upscale on this device.');
  if (signal && signal.aborted) throw abortErr();
  const p = await getPool(m, onProgress, signal);
  const hasAlpha = anyAlpha(source, w, h);
  const inC = opaqueCopy(source, w, h, hasAlpha), ig = inC.getContext('2d', { willReadFrequently: true });
  const out = mk(w * NET_SCALE, h * NET_SCALE), og = out.getContext('2d', { willReadFrequently: true });
  if (out.width !== w * NET_SCALE) throw new Error('This device cannot make an image that large.');
  const tiles = tilePlan(w, h), n = tiles.length, results = new Array(n);
  let next = 0, flushed = 0, done = 0;
  const t0 = performance.now();
  onProgress && onProgress(0, `Upscaling… tile 0 of ${n}`, { tile: 0, tiles: n, eta: NaN });

  await new Promise((resolve, reject) => {
    let over = false;
    const stop = (e) => { if (over) return; over = true; signal && signal.removeEventListener('abort', onAbort); if (e) { killPool(); reject(e); } else resolve(); };
    const onAbort = () => stop(abortErr()); // terminating the workers stops the work at once
    signal && signal.addEventListener('abort', onAbort);
    const pump = async (r) => {
      while (!over) {
        // keep finished-but-not-yet-blended tiles bounded (they must be blended in reading order)
        if (next >= n) return;
        const i = next++, t = tiles[i];
        let res;
        try { res = await r.run(ig.getImageData(t.x, t.y, t.w, t.h).data, t.w, t.h); } catch (e) { stop(e); return; }
        if (over) return;
        results[i] = res; done++;
        while (flushed < n && results[flushed]) { composite(og, tiles[flushed], results[flushed]); results[flushed] = null; flushed++; }
        const el = (performance.now() - t0) / 1000, eta = el / done * (n - done);
        onProgress && onProgress(done / n, `Upscaling… tile ${done} of ${n}`, { tile: done, tiles: n, eta });
        if (flushed >= n) { stop(); return; }
      }
    };
    for (const r of p.runners) pump(r);
  });

  const secs = (performance.now() - t0) / 1000;
  if (n >= 4) try { const s = speeds(); s[m.id] = +(secs / tileMP(w, h)).toFixed(1); localStorage.setItem(SPEED_KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }

  if (hasAlpha) { // enlarge the alpha channel on its own (smooth) and apply it
    og.globalCompositeOperation = 'destination-in'; og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
    og.drawImage(source, 0, 0, out.width, out.height); og.globalCompositeOperation = 'source-over';
  }
  let result = out;
  if (scale === 2) { // the network only makes ×4: halve it (each pixel = the average of four)
    result = mk(w * 2, h * 2); const g = result.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(out, 0, 0, result.width, result.height); out.width = out.height = 1;
  }
  inC.width = inC.height = 1;
  onProgress && onProgress(1, 'Done', { tile: n, tiles: n, eta: 0 });
  return Object.assign(result, { _seconds: secs, _alpha: hasAlpha });
}
