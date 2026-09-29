// EYAD AI — on-device vision models (MediaPipe Tasks, Apache-2.0), shared by
// Image and Video. Free and unlimited: there is no account, no credits and no
// server — the runtime ships with the Studio and each model (a few MB) is
// downloaded once, then cached by the browser. Images never leave the device.
import { toast } from './ui.js';

const RUNTIME = new URL('../../vendor/mediapipe/', import.meta.url).href;
const LOCAL_MODELS = new URL('../../models/', import.meta.url).href;
const G = 'https://storage.googleapis.com/mediapipe-models/';

export const MODELS = {
  person: { file: 'selfie_segmenter.tflite', remote: G + 'image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite', size: '0.25 MB', label: 'People segmentation' },
  multiclass: { file: 'selfie_multiclass_256x256.tflite', remote: G + 'image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite', size: '16 MB', label: 'Hair / skin / clothes' },
  objects: { file: 'deeplab_v3.tflite', remote: G + 'image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite', size: '2.7 MB', label: 'Objects (21 classes)' },
  interactive: { file: 'magic_touch.tflite', remote: G + 'interactive_segmenter/magic_touch/float32/1/magic_touch.tflite', size: '6 MB', label: 'Click-to-select' },
  faces: { file: 'blaze_face_short_range.tflite', remote: G + 'face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite', size: '0.2 MB', label: 'Face detection' },
};
// DeepLab v3 (PASCAL VOC) labels; index 0 is background.
export const OBJECT_LABELS = ['background', 'aeroplane', 'bicycle', 'bird', 'boat', 'bottle', 'bus', 'car', 'cat', 'chair', 'cow', 'dining table', 'dog', 'horse', 'motorbike', 'person', 'potted plant', 'sheep', 'sofa', 'train', 'tv'];

let visionPromise = null;
let modPromise = null;
const tasks = new Map();
const CACHE = 'eyad-studio-ai-models-v1';

function loadModule() {
  if (!modPromise) modPromise = import(RUNTIME + 'vision_bundle.mjs');
  return modPromise;
}
async function fileset() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const m = await loadModule();
      return m.FilesetResolver.forVisionTasks(RUNTIME + 'wasm');
    })().catch((e) => { visionPromise = null; throw e; });
  }
  return visionPromise;
}

/** Model bytes: studio/models/ (self-hosted) → browser cache → Google's model storage. */
async function modelBytes(key, onStatus) {
  const def = MODELS[key];
  const tryFetch = async (url) => { const r = await fetch(url, { cache: 'force-cache' }); if (!r.ok) throw new Error(r.status); return r; };
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (e) { cache = null; }
  if (cache) { const hit = await cache.match(def.remote); if (hit) return new Uint8Array(await hit.arrayBuffer()); }
  let res = null;
  try { res = await tryFetch(LOCAL_MODELS + def.file); } catch (e) { res = null; }
  if (!res) {
    onStatus && onStatus(`Downloading ${def.label} model (${def.size}, first time only)…`);
    try { res = await tryFetch(def.remote); } catch (e) {
      throw new Error(`Couldn’t download the ${def.label} model. Check your connection (it is needed once), or place ${def.file} in studio/models/.`);
    }
  }
  const buf = await res.clone().arrayBuffer();
  if (cache) try { await cache.put(def.remote, new Response(buf)); } catch (e) { /* quota */ }
  return new Uint8Array(buf);
}

async function create(kind, key, opts, onStatus) {
  const id = kind + ':' + key + ':' + (opts.runningMode || 'IMAGE');
  if (tasks.has(id)) return tasks.get(id);
  const p = (async () => {
    onStatus && onStatus('Starting EYAD AI…');
    const [m, vision, bytes] = await Promise.all([loadModule(), fileset(), modelBytes(key, onStatus)]);
    const Cls = { segmenter: m.ImageSegmenter, interactive: m.InteractiveSegmenter, faces: m.FaceDetector }[kind];
    const make = (delegate) => Cls.createFromOptions(vision, { baseOptions: { modelAssetBuffer: bytes, delegate }, ...opts });
    try { return await make('GPU'); } catch (e) { return await make('CPU'); }
  })();
  tasks.set(id, p);
  p.catch(() => tasks.delete(id));
  return p;
}

export function aiSupported() {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

/** Soft mask (Float32Array 0..1, w×h of the model output) for 'person' | 'objects' | 'multiclass'. */
export async function segment(image, key = 'person', { classes = null, onStatus } = {}) {
  const seg = await create('segmenter', key, { runningMode: 'IMAGE', outputCategoryMask: key !== 'person', outputConfidenceMasks: true }, onStatus);
  onStatus && onStatus('Analysing…');
  const res = seg.segment(image);
  try {
    const cms = res.confidenceMasks || [];
    const w = cms[0].width, h = cms[0].height;
    const out = new Float32Array(w * h);
    if (key === 'person') { out.set(cms[0].getAsFloat32Array()); }
    else {
      // sum the confidence of the wanted classes (default: everything but background)
      const want = classes || cms.map((_, i) => i).filter((i) => i !== 0);
      for (const i of want) { if (!cms[i]) continue; const a = cms[i].getAsFloat32Array(); for (let k = 0; k < out.length; k++) out[k] += a[k]; }
      for (let k = 0; k < out.length; k++) if (out[k] > 1) out[k] = 1;
    }
    return { mask: out, width: w, height: h };
  } finally { res.close && res.close(); }
}

/** Which DeepLab classes appear in the image (share of pixels). */
export async function detectObjects(image, { onStatus } = {}) {
  const seg = await create('segmenter', 'objects', { runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false }, onStatus);
  const res = seg.segment(image);
  try {
    const cat = res.categoryMask.getAsUint8Array();
    const counts = new Array(OBJECT_LABELS.length).fill(0);
    for (const c of cat) if (c < counts.length) counts[c]++;
    return counts.map((n, i) => ({ id: i, label: OBJECT_LABELS[i], share: n / cat.length })).filter((x) => x.id && x.share > 0.002).sort((a, b) => b.share - a.share);
  } finally { res.close && res.close(); }
}

/** Click-to-select: soft mask of the object under (x, y) — normalised 0..1 coordinates. */
export async function selectAt(image, x, y, { onStatus } = {}) {
  const seg = await create('interactive', 'interactive', { outputCategoryMask: false, outputConfidenceMasks: true }, onStatus);
  onStatus && onStatus('Finding the object…');
  const res = seg.segment(image, { keypoint: { x, y } });
  try {
    const cm = res.confidenceMasks[0];
    return { mask: new Float32Array(cm.getAsFloat32Array()), width: cm.width, height: cm.height };
  } finally { res.close && res.close(); }
}

/** Face boxes in image pixels: [{ x, y, w, h, score }]. */
export async function detectFaces(image, { onStatus } = {}) {
  const det = await create('faces', 'faces', { runningMode: 'IMAGE', minDetectionConfidence: 0.45 }, onStatus);
  const r = det.detect(image);
  return (r.detections || []).map((d) => ({ x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height, score: d.categories?.[0]?.score || 0 }));
}

/** Video-mode people segmenter for per-frame work (EYAD VIDEO). */
export async function videoSegmenter(onStatus) {
  return create('segmenter', 'person', { runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true }, onStatus);
}

/** Wrap an AI action with friendly status + error toasts. */
export async function withAI(title, fn) {
  if (!aiSupported()) { toast('EYAD AI needs WebAssembly, which this browser doesn’t provide.', { type: 'error' }); return null; }
  const t = toast(title + '…', { timeout: 0 });
  const set = (msg) => { try { t && t.set ? t.set(msg) : null; } catch (e) { /* ignore */ } };
  try { return await fn(set); }
  catch (e) {
    const msg = String(e && e.message || e).split(/[;\n]/)[0].slice(0, 220);
    toast('EYAD AI: ' + msg, { type: 'error', timeout: 7000 });
    return null;
  }
  finally { t && t.close && t.close(); }
}
