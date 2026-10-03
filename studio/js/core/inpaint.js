// EYAD Remove — on-device object removal with a small inpainting network
// (MI-GAN, MIT licence, ~28 MB ONNX) running in onnxruntime-web (MIT, WebAssembly,
// vendored in studio/vendor/onnxruntime-web/). The image never leaves the device:
// only the model file is downloaded, once, then kept in Cache Storage.
//
// Model sources, in order:
//   1. Cache Storage 'eyad-studio-ai-models-v1' (keyed by the model's canonical URL)
//   2. studio/models/<file>.parts.json  → { parts: ["<file>.part1", …], bytes, sha256 }
//      (written by studio/scripts/fetch-models.py; parts stay under GitHub's 25 MB web-upload limit)
//   3. studio/models/<file>             (a single self-hosted copy)
//   4. the remote URL list (Hugging Face CDN — sends CORS headers)
// When none is reachable, callers fall back to the patch-based Content-Aware Fill.
const VENDOR = new URL('../../vendor/onnxruntime-web/', import.meta.url).href;
const LOCAL = new URL('../../models/', import.meta.url).href;
const CACHE = 'eyad-studio-ai-models-v1';

/**
 * Model specs. `input`: 'uint8' → image uint8 [1,3,H,W] 0..255, mask uint8 [1,1,H,W]
 * with `maskHole` for pixels to fill and 255-maskHole elsewhere; 'float' → float32 0..1
 * image and a float mask (1 = fill). Output: [1,3,H,W], uint8 or float (0..1 or 0..255, auto-detected).
 */
export const INPAINT_MODELS = {
  migan: {
    id: 'migan', label: 'MI-GAN (object removal)', file: 'migan_pipeline_v2.onnx', size: '14 MB', bytes: 14.15e6, license: 'MIT',
    res: 512, input: 'uint8', maskHole: 0,
    urls: [
      'https://huggingface.co/andraniksargsyan/migan/resolve/1538c135034b8cfe7a8472f34d09c8a5a45b17a7/migan_pipeline_v2.onnx',
      'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
    ],
  },
};
let current = 'migan';

/** Point the remover at another model / mirror list (e.g. { urls: [...] } or a full spec). */
export function configureInpaint(spec = {}) {
  const base = INPAINT_MODELS[spec.id || current] || {};
  const next = { ...base, ...spec };
  if (!next.id || !next.file || !next.urls) throw new Error('configureInpaint: id, file and urls are required');
  INPAINT_MODELS[next.id] = next;
  if (next.id !== current || spec.urls) { current = next.id; sessionP = null; }
  return next;
}

let sessionP = null;
let state = { state: 'idle', message: '' };
const setState = (s, message = '', extra = {}) => { state = { state: s, message, ...extra }; };

async function openCache() { try { return await caches.open(CACHE); } catch (e) { return null; } }
function spec() { return INPAINT_MODELS[current]; }

/**
 * Where the model would come from right now, without downloading it.
 * → { model, label, size, state: 'ready'|'cached'|'local'|'remote'|'loading'|'error'|'unsupported', message }
 */
export async function modelStatus() {
  const s = spec();
  const out = { model: s.id, label: s.label, size: s.size, license: s.license };
  if (typeof WebAssembly !== 'object') return { ...out, state: 'unsupported', message: 'This browser has no WebAssembly.' };
  if (state.state === 'ready' || state.state === 'loading' || state.state === 'error') return { ...out, ...state };
  const cache = await openCache();
  if (cache && await cache.match(s.urls[0])) return { ...out, state: 'cached', message: 'Downloaded — works offline.' };
  try {
    const r = await fetch(new URL('../../models/' + s.file + '.parts.json', import.meta.url), { method: 'HEAD', cache: 'no-cache' });
    if (r.ok) return { ...out, state: 'cached', message: 'Included with the Studio — works offline.' };
  } catch (e) { /* not self-hosted */ }
  return { ...out, state: 'remote', message: `Downloads once (${s.size}) from Hugging Face, or from studio/models/ if self-hosted.` };
}

async function fetchOk(url, signal) {
  const r = await fetch(url, { signal, cache: 'no-cache' });
  if (!r.ok) throw new Error(url.split('/').pop() + ': HTTP ' + r.status);
  return r;
}

/** Read a response body with progress (loaded bytes). */
async function readAll(res, onBytes, signal) {
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(), chunks = [];
  let n = 0;
  for (;;) {
    if (signal && signal.aborted) { reader.cancel().catch(() => {}); throw new DOMException('Cancelled', 'AbortError'); }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.byteLength; onBytes && onBytes(n);
  }
  const out = new Uint8Array(n);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Self-hosted copy: split parts (via manifest) or a single file. Returns bytes or null. */
async function localBytes(s, onProgress, signal) {
  let manifest = null;
  // spec.single = the model ships as one file: do not probe for a parts manifest (avoids a 404 in the console)
  if (!s.single) try { const r = await fetch(LOCAL + s.file + '.parts.json', { signal, cache: 'no-cache' }); if (r.ok) manifest = await r.json(); } catch (e) { manifest = null; }
  if (manifest && Array.isArray(manifest.parts) && manifest.parts.length) {
    const total = manifest.bytes || s.bytes, bufs = [];
    let done = 0;
    for (const p of manifest.parts) {
      if (!/^[\w.-]+$/.test(p)) throw new Error('Bad part name in model manifest');
      const r = await fetchOk(LOCAL + p, signal);
      const b = await readAll(r, (n) => onProgress && onProgress(Math.min(1, (done + n) / total), 'Loading self-hosted model…'), signal);
      bufs.push(b); done += b.byteLength;
    }
    const out = new Uint8Array(done); let o = 0; for (const b of bufs) { out.set(b, o); o += b.byteLength; }
    if (manifest.sha256 && crypto.subtle && (await sha256Hex(out)) !== manifest.sha256) throw new Error('Self-hosted model parts are corrupt (checksum mismatch).');
    return out;
  }
  try {
    const r = await fetch(LOCAL + s.file, { signal, cache: 'no-cache' });
    if (r.ok) return await readAll(r, (n) => onProgress && onProgress(Math.min(1, n / s.bytes), 'Loading self-hosted model…'), signal);
  } catch (e) { /* not self-hosted */ }
  return null;
}

async function modelBytes(onProgress, signal) {
  const s = spec();
  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(s.urls[0]);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  let bytes = await localBytes(s, onProgress, signal);
  if (!bytes) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline — the removal model hasn’t been downloaded yet');
    let lastErr = null;
    for (const url of s.urls) {
      try {
        setState('loading', `Downloading ${s.label} (${s.size}, first time only)…`);
        const r = await fetchOk(url, signal);
        const total = Number(r.headers.get('content-length')) || s.bytes;
        bytes = await readAll(r, (n) => onProgress && onProgress(Math.min(1, n / total), `Downloading removal model… ${Math.round(n / 1e6)} / ${Math.round(total / 1e6)} MB (first time only)`), signal);
        break;
      } catch (e) { if (signal && signal.aborted) throw e; lastErr = e; }
    }
    if (!bytes) throw new Error('couldn’t download the removal model (' + (lastErr ? lastErr.message : 'no source') + ')');
  }
  if (bytes.byteLength < 64) throw new Error('the removal model file is incomplete');
  if (cache) { try { await cache.put(s.urls[0], new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* quota — still usable this session */ } }
  return bytes;
}

/**
 * Generic loader for any self-hosted ONNX model (used by depth.js and promptfx.js):
 * Cache Storage → studio/models/<file>.parts.json / <file> → optional remote urls.
 * spec: { file, bytes, label, urls? }. Returns a Uint8Array.
 */
export async function fetchModelBytes(s, { onProgress, signal } = {}) {
  const key = (s.urls && s.urls[0]) || (LOCAL + s.file);
  const cache = await openCache();
  if (cache) { const hit = await cache.match(key); if (hit) return new Uint8Array(await hit.arrayBuffer()); }
  const label = s.label || s.file;
  let bytes = await localBytes(s, onProgress ? (f) => onProgress(f, `Loading ${label}…`) : null, signal);
  if (!bytes) {
    let lastErr = null;
    for (const url of (s.urls || [])) {
      try {
        const r = await fetchOk(url, signal);
        const total = Number(r.headers.get('content-length')) || s.bytes || 1;
        bytes = await readAll(r, (n) => onProgress && onProgress(Math.min(1, n / total), `Downloading ${label}…`), signal);
        break;
      } catch (e) { if (signal && signal.aborted) throw e; lastErr = e; }
    }
    if (!bytes) throw new Error(`the ${label} model is not available` + (lastErr ? ' (' + lastErr.message + ')' : ''));
  }
  if (bytes.byteLength < 64) throw new Error(`the ${label} model file is incomplete`);
  if (cache) { try { await cache.put(key, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* quota — still usable this session */ } }
  return bytes;
}

let ortP = null;
export function loadOrt() {
  if (!ortP) {
    ortP = import(VENDOR + 'ort.wasm.min.mjs').then((ort) => {
      ort.env.wasm.wasmPaths = VENDOR;
      // Threads need cross-origin isolation (SharedArrayBuffer); GitHub Pages isn't, so 1 thread there.
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
      ort.env.wasm.proxy = false;
      return ort;
    }).catch((e) => { ortP = null; throw e; });
  }
  return ortP;
}

/** Load (download / cache / compile) the model. Safe to call repeatedly. */
export function loadInpaintModel({ onProgress, signal } = {}) {
  if (!sessionP) {
    sessionP = (async () => {
      setState('loading', 'Starting on-device removal…');
      const ort = await loadOrt();
      const bytes = await modelBytes(onProgress, signal);
      onProgress && onProgress(null, 'Preparing the removal model…');
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      setState('ready', 'Ready — runs on this device.');
      return { ort, session };
    })().catch((e) => {
      sessionP = null;
      const aborted = (signal && signal.aborted) || (e && e.name === 'AbortError');
      setState(aborted ? 'idle' : 'error', aborted ? '' : String(e && e.message || e));
      throw e;
    });
  }
  return sessionP;
}

// ---------------------------------------------------------------- pure helpers (unit-tested)

/** Bounding box of mask pixels with alpha > threshold: {x,y,w,h} or null. */
export function maskBounds(alphaRGBA, w, h, threshold = 8) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) if (alphaRGBA[row + x * 4 + 3] > threshold) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Context crop around the hole: square-ish, ≥ 2× the hole, at least `res` px when the image allows. */
export function cropRect(b, W, H, res = 512) {
  const side = Math.max(Math.round(Math.max(b.w, b.h) * 2 + 32), res);
  const cw = Math.min(W, side), ch = Math.min(H, side);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const x = Math.round(Math.max(0, Math.min(W - cw, cx - cw / 2)));
  const y = Math.round(Math.max(0, Math.min(H - ch, cy - ch / 2)));
  return { x, y, w: cw, h: ch };
}

/**
 * RGBA (res×res) image + RGBA mask (alpha = fill) → model input arrays (NCHW).
 * Returns { image, mask, dims: { image: [1,3,H,W], mask: [1,1,H,W] }, type }.
 */
export function toModelInputs(img, maskRGBA, w, h, s) {
  const n = w * h;
  if (s.input === 'float') {
    const image = new Float32Array(3 * n), mask = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const hole = maskRGBA[i * 4 + 3] > 0 ? 1 : 0;
      mask[i] = hole;
      for (let c = 0; c < 3; c++) image[c * n + i] = hole ? 0 : img[i * 4 + c] / 255;
    }
    return { image, mask, type: 'float32', dims: { image: [1, 3, h, w], mask: [1, 1, h, w] } };
  }
  const image = new Uint8Array(3 * n), mask = new Uint8Array(n);
  const holeV = s.maskHole ?? 0, keepV = 255 - holeV;
  for (let i = 0; i < n; i++) {
    const hole = maskRGBA[i * 4 + 3] > 0;
    mask[i] = hole ? holeV : keepV;
    for (let c = 0; c < 3; c++) image[c * n + i] = img[i * 4 + c];
  }
  return { image, mask, type: 'uint8', dims: { image: [1, 3, h, w], mask: [1, 1, h, w] } };
}

/** Model output (NCHW, 3 channels, uint8 or float 0..1 / 0..255) → RGBA Uint8ClampedArray. */
export function fromModelOutput(data, w, h) {
  const n = w * h, out = new Uint8ClampedArray(n * 4);
  let scale = 1;
  if (!(data instanceof Uint8Array)) { let mx = 0; for (let i = 0; i < Math.min(data.length, 3 * n); i += 7) if (data[i] > mx) mx = data[i]; scale = mx <= 1.5 ? 255 : 1; }
  for (let i = 0; i < n; i++) {
    out[i * 4] = data[i] * scale; out[i * 4 + 1] = data[n + i] * scale; out[i * 4 + 2] = data[2 * n + i] * scale; out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------- canvas helpers

function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
/** Grow a mask's alpha by r px (cheap: stamped offsets). */
function dilate(src, r) {
  if (r <= 0) return src;
  const c = canvas(src.width, src.height), g = c.getContext('2d');
  const steps = Math.max(8, Math.ceil(r * 2));
  for (let a = 0; a < steps; a++) { const t = a / steps * Math.PI * 2; g.drawImage(src, Math.cos(t) * r, Math.sin(t) * r); }
  g.drawImage(src, 0, 0);
  return c;
}
function blur(src, r) {
  const c = canvas(src.width, src.height), g = c.getContext('2d');
  if (r > 0 && 'filter' in g) g.filter = `blur(${r}px)`;
  g.drawImage(src, 0, 0);
  return c;
}

/**
 * Remove what the mask covers.
 * @param {HTMLCanvasElement} imageCanvas  the pixels to repair (not modified)
 * @param {HTMLCanvasElement} maskCanvas   same size; alpha > 0 marks what to remove
 * @returns {Promise<HTMLCanvasElement>}   a new canvas, identical outside the (feathered) mask
 */
export async function removeWithModel(imageCanvas, maskCanvas, { onProgress, signal } = {}) {
  const W = imageCanvas.width, H = imageCanvas.height;
  if (maskCanvas.width !== W || maskCanvas.height !== H) throw new Error('mask and image sizes differ');
  const s = spec(), R = s.res;
  const { ort, session } = await loadInpaintModel({ onProgress, signal });
  if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  onProgress && onProgress(null, 'Removing on this device…');

  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const b = maskBounds(mctx.getImageData(0, 0, W, H).data, W, H);
  if (!b) throw new Error('the mask is empty');
  const cr = cropRect(b, W, H, R);
  const k = cr.w / R; // doc px per model px (horizontal); crop may be non-square at image edges
  const grow = Math.max(2, Math.round(3 * Math.max(k, cr.h / R)));

  // model-size crops
  const ic = canvas(R, R), ig = ic.getContext('2d', { willReadFrequently: true });
  ig.imageSmoothingQuality = 'high';
  ig.fillStyle = '#fff'; ig.fillRect(0, 0, R, R); // transparent pixels read as white
  ig.drawImage(imageCanvas, cr.x, cr.y, cr.w, cr.h, 0, 0, R, R);
  const holeFull = dilate(maskCanvas, grow); // grow a little so the edge halo is replaced too
  const mc = canvas(R, R), mg = mc.getContext('2d', { willReadFrequently: true });
  mg.drawImage(holeFull, cr.x, cr.y, cr.w, cr.h, 0, 0, R, R);
  const inp = toModelInputs(ig.getImageData(0, 0, R, R).data, mg.getImageData(0, 0, R, R).data, R, R, s);

  const names = session.inputNames;
  const maskName = names.find((n) => /mask/i.test(n)) || names[1];
  const imgName = names.find((n) => n !== maskName) || names[0];
  const feeds = {
    [imgName]: new ort.Tensor(inp.type, inp.image, inp.dims.image),
    [maskName]: new ort.Tensor(inp.type, inp.mask, inp.dims.mask),
  };
  const res = await session.run(feeds);
  const outT = res[session.outputNames[0]];
  const oh = outT.dims[2] || R, ow = outT.dims[3] || R;
  const rgba = fromModelOutput(outT.data, ow, oh);
  outT.dispose && outT.dispose();

  // back to full resolution, only inside a feathered version of the hole
  const oc = canvas(ow, oh); oc.getContext('2d').putImageData(new ImageData(rgba, ow, oh), 0, 0);
  const patch = canvas(cr.w, cr.h), pg = patch.getContext('2d');
  pg.imageSmoothingQuality = 'high';
  pg.drawImage(oc, 0, 0, cr.w, cr.h);
  const feather = blur(holeFull, Math.max(1, grow * 0.75));
  pg.globalCompositeOperation = 'destination-in';
  pg.drawImage(feather, -cr.x, -cr.y);
  // keep the original alpha of the layer under the patch (transparent stays transparent-ish)
  const out = canvas(W, H), og = out.getContext('2d');
  og.drawImage(imageCanvas, 0, 0);
  og.drawImage(patch, cr.x, cr.y);
  onProgress && onProgress(1, 'Done');
  return Object.assign(out, { _changed: cr });
}

/** Drop the cached model (e.g. to re-download). */
export async function forgetInpaintModel() {
  sessionP = null; setState('idle');
  const cache = await openCache();
  if (cache) for (const u of spec().urls) await cache.delete(u);
}
