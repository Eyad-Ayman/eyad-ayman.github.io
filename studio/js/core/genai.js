// EYAD Generate — text-to-image through the free public Pollinations.ai image
// service (no account, no API key). Only the prompt TEXT (plus size / seed /
// style words) leaves the device; images are never uploaded. The user is told
// this once, in a consent dialog that names the service ("Don't ask again" is
// remembered in localStorage on this device only).
//
// Service notes (checked September 2026 — public services change without notice):
// • Keyless endpoint: GET https://image.pollinations.ai/prompt/{prompt}?width&height&seed&nologo&model&referrer
//   Anonymous tier: about one request every 15 s per IP; `nologo` is only honoured
//   for registered apps, so free images may carry a small Pollinations mark.
//   Model ids come from GET https://image.pollinations.ai/models (a JSON array —
//   it listed only ["sana"] at the time of writing), so the model is optional and
//   validated at run time instead of hard-coded.
// • Keyed endpoint (optional, user's own key): GET https://gen.pollinations.ai/image/{prompt}?…&key=…
//   Only used when the user pastes their own key; it is stored on this device.
// This page sends `Referrer-Policy: no-referrer`, so the app identifies itself with
// the documented `referrer` query parameter instead of the Referer header.
import { h } from './dom.js';
import { dialog } from './ui.js';

export const SERVICE = {
  name: 'Pollinations.ai',
  anonymous: 'https://image.pollinations.ai/prompt/',
  models: 'https://image.pollinations.ai/models',
  keyed: 'https://gen.pollinations.ai/image/',
  site: 'https://pollinations.ai',
  referrer: 'eyad-studio',
};

const LS_CONSENT = 'eyad-genai-consent-v1';
const LS_KEY = 'eyad-genai-pollinations-key';
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 120000;

/** Style presets — implemented as prompt suffixes (plus words to steer away from). */
export const GENERATION_STYLES = [
  { id: 'none', label: 'No style', suffix: '', avoid: '' },
  { id: 'photo', label: 'Photo', suffix: 'professional photograph, natural light, sharp focus, realistic detail, 35mm', avoid: 'cartoon, illustration, painting, text' },
  { id: 'cinematic', label: 'Cinematic', suffix: 'cinematic film still, dramatic lighting, shallow depth of field, color graded', avoid: 'cartoon, text, watermark' },
  { id: 'product', label: 'Product shot', suffix: 'studio product photography, softbox lighting, clean seamless background, crisp reflections, commercial', avoid: 'clutter, text, hands' },
  { id: 'illustration', label: 'Illustration', suffix: 'digital illustration, clean lines, rich flat colours', avoid: 'photo, blurry' },
  { id: '3d', label: '3D render', suffix: '3D render, octane, soft global illumination, high detail', avoid: 'flat, sketch' },
  { id: 'anime', label: 'Anime', suffix: 'anime style, cel shading, vibrant', avoid: 'photo, realistic' },
  { id: 'watercolor', label: 'Watercolour', suffix: 'watercolour painting, soft washes, paper texture', avoid: 'photo, 3D' },
  { id: 'oil', label: 'Oil painting', suffix: 'oil painting, visible brush strokes, canvas texture', avoid: 'photo' },
  { id: 'sketch', label: 'Pencil sketch', suffix: 'pencil sketch, graphite shading, hand drawn', avoid: 'colour, photo' },
  { id: 'logo', label: 'Logo / icon', suffix: 'minimal vector logo mark, flat, simple shapes, centered, plain background', avoid: 'photo, gradient mess, small text' },
  { id: 'texture', label: 'Seamless texture', suffix: 'seamless tileable texture, top-down, even lighting', avoid: 'objects, perspective, text' },
];

/** Aspect presets: [id, label, w/h ratio]. 'canvas' / 'selection' are resolved by the caller. */
export const ASPECTS = [
  ['1:1', 'Square 1:1', 1], ['4:5', 'Portrait 4:5', 4 / 5], ['2:3', 'Portrait 2:3', 2 / 3], ['9:16', 'Story 9:16', 9 / 16],
  ['3:2', 'Landscape 3:2', 3 / 2], ['16:9', 'Wide 16:9', 16 / 9], ['21:9', 'Cinema 21:9', 21 / 9],
];

/** Output size for a ratio: longest side `max`, both sides multiples of 16, within 256…1536. */
export function sizeForRatio(ratio, max = 1024) {
  const r = Math.max(0.2, Math.min(5, ratio || 1));
  let w = r >= 1 ? max : max * r, hh = r >= 1 ? max / r : max;
  const snap = (v) => Math.max(256, Math.min(1536, Math.round(v / 16) * 16));
  return { width: snap(w), height: snap(hh) };
}

export function randomSeed() { return Math.floor(Math.random() * 2147483000) + 1; }

/** Build the final prompt: user text + style suffix + "avoid" guidance. */
export function buildPrompt(prompt, style = 'none', negative = '') {
  const st = GENERATION_STYLES.find((s) => s.id === style) || GENERATION_STYLES[0];
  const parts = [String(prompt || '').trim()];
  if (st.suffix) parts.push(st.suffix);
  const avoid = [negative, st.avoid].map((s) => String(s || '').trim()).filter(Boolean).join(', ');
  let out = parts.filter(Boolean).join(', ');
  if (avoid) out += '. Avoid: ' + avoid;
  return out.slice(0, 1800); // keep the GET URL a sane length
}

// ---------------------------------------------------------------- optional user key

export function getApiKey() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
export function setApiKey(key) {
  try { if (key) localStorage.setItem(LS_KEY, String(key).trim()); else localStorage.removeItem(LS_KEY); } catch (e) { /* private mode */ }
}

// ---------------------------------------------------------------- consent

export function hasConsent() { try { return localStorage.getItem(LS_CONSENT) === 'yes'; } catch (e) { return false; } }
export function resetConsent() { try { localStorage.removeItem(LS_CONSENT); } catch (e) { /* ignore */ } }

/**
 * Tell the user, once, that the prompt text goes to a public service.
 * Resolves true when they agree (remembered only if "Don't ask again" is ticked).
 */
export async function ensureConsent() {
  if (hasConsent()) return true;
  const keyed = !!getApiKey();
  const host = keyed ? 'gen.pollinations.ai' : 'image.pollinations.ai';
  const remember = h('input', { type: 'checkbox', checked: true });
  const body = h('div', { class: 'studio-stack gen-consent' },
    h('p', {}, 'EYAD Generate creates images with ', h('strong', { text: SERVICE.name }), ', a free public image-generation service run by a third party (', h('code', { text: host }), ').'),
    h('ul', { class: 'gen-consent-list' },
      h('li', { text: 'Your prompt text (with the chosen style words, size and seed) is sent to that service to make the image.' }),
      h('li', { text: 'Your photos and documents are NOT uploaded — generation works from text only. Removal and Expand without a prompt run on this device.' }),
      h('li', { text: 'Free, no account. The public service may rate-limit (about one image every few seconds), be slow or unavailable, and may add a small logo. Its own terms apply to what you generate.' }),
      h('li', { text: 'Don’t put private or personal information in prompts.' })),
    h('label', { class: 'gen-check' }, remember, h('span', { text: 'Don’t ask again on this device' })));
  const ok = await dialog({ title: 'Send prompt to ' + SERVICE.name + '?', body, width: 460, buttons: [{ label: 'Cancel', value: false }, { label: 'Agree & generate', value: true, primary: true }] });
  if (ok && remember.checked) { try { localStorage.setItem(LS_CONSENT, 'yes'); } catch (e) { /* ignore */ } }
  return !!ok;
}

// ---------------------------------------------------------------- models

let modelsPromise = null;
/** Model ids the keyless endpoint currently offers (cached per session; [] when unknown). */
export function availableModels({ signal } = {}) {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const r = await fetchWithTimeout(SERVICE.models, { signal, timeout: 15000 });
      if (!r.ok) throw new Error('models ' + r.status);
      const j = await r.json();
      return Array.isArray(j) ? j.map((m) => (typeof m === 'string' ? m : m && (m.name || m.id))).filter(Boolean) : [];
    })().catch(() => { modelsPromise = null; return []; });
  }
  return modelsPromise;
}

// ---------------------------------------------------------------- request plumbing

class GenError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
export { GenError };

function linkSignals(outer, ms) {
  const ctl = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
  const onAbort = () => ctl.abort();
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', onAbort, { once: true }); }
  return { signal: ctl.signal, done: () => { clearTimeout(t); outer && outer.removeEventListener('abort', onAbort); }, timedOut: () => timedOut };
}

async function fetchWithTimeout(url, { signal, timeout = TIMEOUT_MS, ...init } = {}) {
  const l = linkSignals(signal, timeout);
  try { return await fetch(url, { ...init, signal: l.signal }); }
  catch (e) {
    if (signal && signal.aborted) throw new GenError('Cancelled.', 'abort');
    if (l.timedOut()) throw new GenError('The image service took too long to answer. Try again, or a smaller size.', 'timeout');
    throw new GenError('Couldn’t reach ' + SERVICE.name + ' — check your connection, or the service may be down.', 'network');
  } finally { l.done(); }
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal && signal.addEventListener('abort', () => { clearTimeout(t); rej(new GenError('Cancelled.', 'abort')); }, { once: true });
});

// Requests are serialised; after a 429 the gap between requests widens to what the
// service asked for, so "4 variations" queue politely instead of hammering it.
let queue = Promise.resolve();
let gapMs = 0, lastAt = 0;
function enqueue(fn) {
  const run = queue.then(async () => {
    const wait = lastAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { lastAt = Date.now(); }
  });
  queue = run.catch(() => {});
  return run;
}

/** URL for one generation request (exported for tests). */
export function requestUrl({ prompt, width = 1024, height = 1024, seed, model, key = getApiKey() }) {
  const base = key ? SERVICE.keyed : SERVICE.anonymous;
  const q = new URLSearchParams();
  q.set('width', String(Math.round(width)));
  q.set('height', String(Math.round(height)));
  if (seed != null && seed !== '') q.set('seed', String(Math.round(Number(seed)) || 1));
  if (model) q.set('model', model);
  q.set('nologo', 'true');
  q.set('private', 'true');
  q.set('referrer', SERVICE.referrer);
  if (key) q.set('key', key);
  return base + encodeURIComponent(prompt) + '?' + q.toString();
}

/**
 * Generate one image from text.
 * @returns {Promise<Blob>} an image/* blob (validated, size-capped)
 */
export async function generateImage({ prompt, width = 1024, height = 1024, seed = randomSeed(), style = 'none', negative = '', model = '', signal, onStatus } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new GenError('Type a prompt first.', 'input');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new GenError('You’re offline — generating needs the internet. Removal and Expand without a prompt still work offline.', 'offline');
  const full = buildPrompt(text, style, negative);
  let useModel = '';
  if (model && !getApiKey()) { const list = await availableModels({ signal }); useModel = list.includes(model) ? model : ''; }
  else if (model) useModel = model;
  const url = requestUrl({ prompt: full, width, height, seed, model: useModel });
  const delays = [4000, 10000, 20000];
  for (let attempt = 0; ; attempt++) {
    onStatus && onStatus(attempt ? `Service busy — retrying (${attempt}/${delays.length})…` : 'Generating…');
    const res = await enqueue(() => fetchWithTimeout(url, { signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }));
    if (res.status === 429 || res.status === 503 || res.status === 502) {
      const ra = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(ra) && ra > 0 ? Math.min(60000, ra * 1000) : delays[attempt];
      gapMs = Math.max(gapMs, res.status === 429 ? Math.min(20000, wait) : 0);
      if (attempt >= delays.length) throw new GenError(res.status === 429 ? 'The free service is rate-limiting right now. Wait a minute and try again.' : 'The image service is unavailable right now. Try again later.', 'rate');
      await sleep(wait, signal);
      continue;
    }
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      throw new GenError(getApiKey() ? 'The Pollinations key was refused (' + res.status + '). Check or remove it in the Generate panel.' : 'The free anonymous tier of ' + SERVICE.name + ' refused the request (' + res.status + '). It may now require a key — you can paste your own free key in the Generate panel.', 'auth');
    }
    if (!res.ok) throw new GenError('The image service answered ' + res.status + '. Try a different prompt or try again later.', 'http');
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/')) throw new GenError('The service didn’t return an image (' + (type || 'unknown type') + '). It may be overloaded — try again.', 'type');
    const len = Number(res.headers.get('content-length'));
    if (len && len > MAX_BYTES) throw new GenError('The returned image is too large.', 'size');
    const blob = await readCapped(res, signal);
    if (!blob.type.startsWith('image/')) return new Blob([blob], { type });
    return blob;
  }
}

async function readCapped(res, signal) {
  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!res.body || !res.body.getReader) { const b = await res.blob(); if (b.size > MAX_BYTES) throw new GenError('The returned image is too large.', 'size'); return b; }
  const reader = res.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    if (signal && signal.aborted) { reader.cancel().catch(() => {}); throw new GenError('Cancelled.', 'abort'); }
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > MAX_BYTES) { reader.cancel().catch(() => {}); throw new GenError('The returned image is too large.', 'size'); }
    parts.push(value);
  }
  return new Blob(parts, { type });
}

/** Decode a generated blob to a canvas (throws a friendly error if it isn't a real image). */
export async function blobToCanvas(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch (e) { throw new GenError('The service returned data that isn’t a readable image.', 'decode'); }
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  return c;
}

/** Test hook: reset the request queue pacing. */
export function _resetPacing() { gapMs = 0; lastAt = 0; }
