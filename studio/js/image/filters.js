// EYAD IMAGE — main-thread bridge to the filters worker.
const URL_ = new URL('../workers/filters.worker.js', import.meta.url);
let worker = null, seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(URL_);
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id); if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(new ImageData(new Uint8ClampedArray(e.data.buffer), p.w, p.h));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error('Filter failed: ' + (e.message || 'the image may be too large for this device.')));
    pending.clear(); worker.terminate(); worker = null;
  };
  return worker;
}

/** Runs a filter on a copy of the image data (the input is never modified). */
export function runFilter(op, imageData, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const buffer = imageData.data.slice().buffer;
    pending.set(id, { resolve, reject, w: imageData.width, h: imageData.height });
    getWorker().postMessage({ id, op, params, width: imageData.width, height: imageData.height, buffer }, [buffer]);
  });
}
