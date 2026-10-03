// EYAD Upscale — tile runner. Runs one tile of the super-resolution network (Real-ESRGAN "compact",
// BSD-3-Clause) in onnxruntime-web (WASM). Used inside a module Web Worker (several at once, one WASM
// thread each) and, when workers are not available, directly on the page.
import { loadOrt } from './inpaint.js';

/** → async run(rgba: Uint8ClampedArray, w, h) → { rgba: Uint8ClampedArray (4w × 4h), w, h } */
export async function makeRunner(modelBytes) {
  const ort = await loadOrt();
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const inName = session.inputNames[0], outName = session.outputNames[0];
  return async function run(rgba, w, h) {
    const n = w * h, x = new Float32Array(3 * n);
    for (let i = 0, p = 0; i < n; i++, p += 4) { x[i] = rgba[p] / 255; x[n + i] = rgba[p + 1] / 255; x[2 * n + i] = rgba[p + 2] / 255; }
    const res = await session.run({ [inName]: new ort.Tensor('float32', x, [1, 3, h, w]) });
    const t = res[outName], H = t.dims[2], W = t.dims[3], d = t.data, N = W * H;
    const out = new Uint8ClampedArray(N * 4);
    for (let i = 0, p = 0; i < N; i++, p += 4) { out[p] = d[i] * 255; out[p + 1] = d[N + i] * 255; out[p + 2] = d[2 * N + i] * 255; out[p + 3] = 255; } // the clamped array rounds
    t.dispose && t.dispose();
    return { rgba: out, w: W, h: H };
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  let runner = null;
  self.onmessage = async (e) => {
    const m = e.data || {};
    try {
      if (m.type === 'init') {
        const ort = await loadOrt(); ort.env.wasm.numThreads = 1; // the page runs several workers instead of threads
        runner = await makeRunner(new Uint8Array(m.model));
        self.postMessage({ type: 'ready' });
      } else if (m.type === 'run') {
        const t0 = performance.now();
        const r = await runner(new Uint8ClampedArray(m.rgba), m.w, m.h);
        self.postMessage({ type: 'done', id: m.id, rgba: r.rgba.buffer, w: r.w, h: r.h, ms: performance.now() - t0 }, [r.rgba.buffer]);
      }
    } catch (err) { self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }); }
  };
}
