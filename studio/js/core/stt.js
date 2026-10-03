// EYAD speech-to-text — public API. Whisper (MIT) on this device; nothing is uploaded.
//
//   transcribe(pcm, { language, model, onProgress, signal }) → [{ start, end, text }]   (seconds; plain text)
//   loadStt(onProgress, { model, signal })                    download / cache / compile without transcribing
//   sttStatus(model)                                          where the model would come from, without loading it
//   resampleTo16k(channels, rate)                             mono 16 kHz Float32Array from decoded audio
//
// Nothing is fetched until the first call. The engine (stt-engine.js) runs in a module Web Worker
// (stt-worker.js); browsers without module workers run it on the main thread instead.
// The text is model output: treat it as untrusted and insert it as plain text only.
const LOCAL = new URL('../../models/', import.meta.url).href;
const CACHE = 'eyad-studio-ai-models-v1';

/** What the UI needs to know before anything is loaded (kept in step with STT_MODELS in stt-engine.js). */
export const STT_MODEL_INFO = {
  tiny: { id: 'tiny', label: 'Fast', name: 'Whisper tiny', size: '39 MB', files: ['whisper_tiny_encoder.onnx', 'whisper_tiny_decoder.onnx'] },
  base: { id: 'base', label: 'Better', name: 'Whisper base', size: '75 MB', files: ['whisper_base_encoder.onnx', 'whisper_base_decoder.onnx'] },
};
export const STT_DEFAULT_MODEL = 'tiny';

/** Languages Whisper was trained on (code → English name). Quality varies a lot between them. */
export const STT_LANGUAGES = {
  ar: 'Arabic', en: 'English', af: 'Afrikaans', sq: 'Albanian', am: 'Amharic', hy: 'Armenian', as: 'Assamese', az: 'Azerbaijani', ba: 'Bashkir', eu: 'Basque', be: 'Belarusian', bn: 'Bengali', bs: 'Bosnian', br: 'Breton', bg: 'Bulgarian', my: 'Burmese', ca: 'Catalan', zh: 'Chinese', hr: 'Croatian', cs: 'Czech', da: 'Danish', nl: 'Dutch', et: 'Estonian', fo: 'Faroese', fi: 'Finnish', fr: 'French', gl: 'Galician', ka: 'Georgian', de: 'German', el: 'Greek', gu: 'Gujarati', ht: 'Haitian Creole', ha: 'Hausa', haw: 'Hawaiian', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', is: 'Icelandic', id: 'Indonesian', it: 'Italian', ja: 'Japanese', jw: 'Javanese', kn: 'Kannada', kk: 'Kazakh', km: 'Khmer', ko: 'Korean', lo: 'Lao', la: 'Latin', lv: 'Latvian', ln: 'Lingala', lt: 'Lithuanian', lb: 'Luxembourgish', mk: 'Macedonian', mg: 'Malagasy', ms: 'Malay', ml: 'Malayalam', mt: 'Maltese', mi: 'Maori', mr: 'Marathi', mn: 'Mongolian', ne: 'Nepali', no: 'Norwegian', nn: 'Nynorsk', oc: 'Occitan', ps: 'Pashto', fa: 'Persian', pl: 'Polish', pt: 'Portuguese', pa: 'Punjabi', ro: 'Romanian', ru: 'Russian', sa: 'Sanskrit', sr: 'Serbian', sn: 'Shona', sd: 'Sindhi', si: 'Sinhala', sk: 'Slovak', sl: 'Slovenian', so: 'Somali', es: 'Spanish', su: 'Sundanese', sw: 'Swahili', sv: 'Swedish', tl: 'Tagalog', tg: 'Tajik', ta: 'Tamil', tt: 'Tatar', te: 'Telugu', th: 'Thai', bo: 'Tibetan', tr: 'Turkish', tk: 'Turkmen', uk: 'Ukrainian', ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese', cy: 'Welsh', yi: 'Yiddish', yo: 'Yoruba',
};

const aborted = () => new DOMException('Cancelled', 'AbortError');

/**
 * → { model, name, size, state: 'ready' | 'cached' | 'included' | 'missing' | 'unsupported', message }
 * 'included' = the files ship with the Studio (studio/models/) and load on first use.
 */
export async function sttStatus(model = STT_DEFAULT_MODEL) {
  const info = STT_MODEL_INFO[model] || STT_MODEL_INFO[STT_DEFAULT_MODEL];
  const out = { model: info.id, name: info.name, size: info.size };
  if (typeof WebAssembly !== 'object') return { ...out, state: 'unsupported', message: 'This browser has no WebAssembly.' };
  if (ready.has(info.id)) return { ...out, state: 'ready', message: 'Loaded — runs on this device.' };
  try {
    const c = await caches.open(CACHE);
    const hits = await Promise.all(info.files.map((f) => c.match(LOCAL + f)));
    if (hits.every(Boolean)) return { ...out, state: 'cached', message: 'Downloaded — works offline.' };
  } catch (e) { /* no Cache Storage (private mode): still loads from the network each time */ }
  try {
    const rs = await Promise.all(info.files.map((f) => fetch(LOCAL + f + '.parts.json', { method: 'HEAD', cache: 'no-cache' })));
    if (rs.every((r) => r.ok)) return { ...out, state: 'included', message: `Downloads once (${info.size}), then works offline.` };
  } catch (e) { /* offline */ }
  return { ...out, state: 'missing', message: 'The speech model is not available (offline, or its files are not in studio/models/).' };
}

// ------------------------------------------------------------------ engine host (worker, or main thread)
let worker = null, workerBroken = false, mainRt = null, seq = 0;
const jobs = new Map(), ready = new Set();

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./stt-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data || {}, j = jobs.get(m.id); if (!j) return;
      if (m.type === 'progress') j.progress(m);
      else if (m.type === 'done') { jobs.delete(m.id); j.resolve(m); }
      else if (m.type === 'error') { jobs.delete(m.id); j.reject(m.aborted ? aborted() : new Error(m.message)); }
    };
    worker.onerror = (ev) => {
      // a worker that cannot start (no module workers, blocked script): fail the waiting jobs, use the main thread next time
      if (ev && ev.preventDefault) ev.preventDefault();
      workerBroken = true; try { worker.terminate(); } catch (e) { /* ignore */ } worker = null;
      for (const [id, j] of jobs) { jobs.delete(id); j.fallback(); }
    };
  } catch (e) { workerBroken = true; worker = null; }
  return worker;
}

async function onMain(msg, progress, signal) {
  const { SttRuntime } = await import('./stt-engine.js');
  if (!mainRt) mainRt = new SttRuntime();
  const check = () => { if (signal && signal.aborted) throw aborted(); };
  const dec = await mainRt.load(msg.model, (frac, label) => progress({ phase: 'load', frac, label }), signal);
  check();
  if (msg.type === 'load') return {};
  const t0 = performance.now();
  // the main thread has to breathe between windows so the progress bar can paint
  const res = await dec.transcribe(msg.pcm, { language: msg.language, check, onWindow: (w) => progress({ phase: 'run', ...w, ms: performance.now() - t0 }) });
  return { segments: res.segments, language: res.language, ms: performance.now() - t0 };
}

function send(msg, progress, signal, transfer) {
  if (signal && signal.aborted) return Promise.reject(aborted());
  const w = getWorker();
  if (!w) return onMain(msg, progress, signal);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onAbort = () => { try { w.postMessage({ type: 'cancel', id }); } catch (e) { /* ignore */ } };
    const clean = () => { if (signal) signal.removeEventListener('abort', onAbort); };
    jobs.set(id, {
      progress,
      resolve: (m) => { clean(); resolve(m); },
      reject: (e) => { clean(); reject(e); },
      // the PCM was copied (not transferred) so a failed worker start can be retried here
      fallback: () => { clean(); onMain(msg, progress, signal).then(resolve, reject); },
    });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ ...msg, id }, transfer || []);
  });
}

/** Download (first time), cache and compile the speech model. onProgress(fraction | null, label). */
export async function loadStt(onProgress = () => {}, { model = STT_DEFAULT_MODEL, signal = null } = {}) {
  if (!STT_MODEL_INFO[model]) throw new Error('Unknown speech model');
  await send({ type: 'load', model }, (m) => onProgress(m.frac, m.label), signal);
  ready.add(model);
  return sttStatus(model);
}

/**
 * Speech → text with timestamps.
 * pcm: Float32Array, mono, 16 kHz. language: 'auto' or a code from STT_LANGUAGES.
 * onProgress({ phase: 'load', frac, label } | { phase: 'run', processed, total, segments, partial, language, ms })
 *   segments = the ones finished since the last call; partial = the words of the sentence being decoded
 * Resolves to an array of { start, end, text } (seconds). The array also carries .language and .ms.
 */
export async function transcribe(pcm, { language = 'auto', model = STT_DEFAULT_MODEL, onProgress = () => {}, signal = null } = {}) {
  if (!(pcm instanceof Float32Array)) throw new Error('transcribe() needs a Float32Array of mono 16 kHz samples');
  if (!STT_MODEL_INFO[model]) throw new Error('Unknown speech model');
  const lang = language === 'auto' || STT_LANGUAGES[language] ? language : 'auto';
  const r = await send({ type: 'run', model, language: lang, pcm }, onProgress, signal);
  ready.add(model);
  const out = (r.segments || []).map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '') }));
  out.language = r.language || null; out.ms = r.ms || 0;
  return out;
}

/** Free the models' memory (they reload from the cache next time). */
export function releaseStt() {
  ready.clear();
  if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
  for (const [id, j] of jobs) { jobs.delete(id); j.reject(aborted()); }
  if (mainRt) { mainRt.release(); mainRt = null; }
}

/** Mix decoded channels to mono and resample to 16 kHz (box low-pass + linear interpolation; fine for speech). */
export function resampleTo16k(channels, rate) {
  const n = channels[0].length, ch = channels.length;
  let mono = channels[0];
  if (ch > 1) { mono = new Float32Array(n); for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / ch; }
  if (rate === 16000) return mono;
  const ratio = rate / 16000, len = Math.floor(n / ratio), out = new Float32Array(len);
  if (ratio > 1) {
    for (let i = 0; i < len; i++) {              // average the source samples that fall inside each output sample
      const a = i * ratio, b = Math.min(n, a + ratio); let s = 0, w = 0;
      for (let j = Math.floor(a); j < b; j++) { const k = Math.min(j + 1, b) - Math.max(j, a); s += mono[j] * k; w += k; }
      out[i] = w ? s / w : 0;
    }
  } else {
    for (let i = 0; i < len; i++) { const p = i * ratio, j = Math.floor(p), f = p - j; out[i] = mono[j] * (1 - f) + (mono[Math.min(n - 1, j + 1)] || 0) * f; }
  }
  return out;
}
