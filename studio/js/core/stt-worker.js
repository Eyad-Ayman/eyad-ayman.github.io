// EYAD speech-to-text — Web Worker wrapper around stt-engine.js (keeps the page responsive while Whisper runs).
// Messages in:  { type: 'run', id, pcm: Float32Array (mono 16 kHz), model, language } · { type: 'load', id, model } · { type: 'cancel', id } · { type: 'release' }
// Messages out: { type: 'progress', id, phase: 'load' | 'run', … } · { type: 'done', id, … } · { type: 'error', id, message, aborted }
import { SttRuntime } from './stt-engine.js';

const rt = new SttRuntime();
const cancelled = new Set();
let queue = Promise.resolve();

async function job(m) {
  const { id } = m;
  const check = () => { if (cancelled.has(id)) throw new DOMException('Cancelled', 'AbortError'); };
  try {
    check();
    const dec = await rt.load(m.model, (frac, label) => postMessage({ type: 'progress', id, phase: 'load', frac, label }));
    check();
    if (m.type === 'load') { postMessage({ type: 'done', id }); return; }
    const t0 = performance.now();
    const res = await dec.transcribe(m.pcm, {
      language: m.language, check,
      onWindow: (w) => postMessage({ type: 'progress', id, phase: 'run', processed: w.processed, total: w.total, segments: w.segments, partial: w.partial, language: w.language, ms: performance.now() - t0 }),
    });
    postMessage({ type: 'done', id, segments: res.segments, language: res.language, ms: performance.now() - t0 });
  } catch (e) {
    postMessage({ type: 'error', id, message: (e && e.message) || String(e), aborted: !!(e && e.name === 'AbortError') });
  } finally { cancelled.delete(id); }
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'cancel') cancelled.add(m.id);
  else if (m.type === 'release') queue = queue.then(() => rt.release());
  else if (m.type === 'run' || m.type === 'load') queue = queue.then(() => job(m));
};
