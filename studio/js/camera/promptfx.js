// EYAD Prompt look — "describe a look" for a photo, entirely on this device.
//
// What it really is (and says so in the dialog): the text is read by a keyword interpreter
// (English + Arabic) into a recipe of real image operations:
//   • neural style transfer — five small "fast neural style" networks (BSD-3, 3.4 MB each,
//     studio/models/style_*.onnx) run in onnxruntime-web (WASM);
//   • colour grading, split-toning, named palettes;
//   • film texture: grain, bloom, halation, light leaks, dust, scanlines, vignette, fringing;
//   • subject-aware edits with the people-segmentation model (blur / darken / recolour the
//     background, subject pop, sticker outline, neon edge).
// It restyles the photo. It does not generate new objects — there is no text-to-image model
// here (those are gigabytes and need a server), and nothing is uploaded.
//
//   openPromptFx({ source, title }) → Promise<HTMLCanvasElement | null>
//   parsePrompt(text) → recipe          renderRecipe(source, recipe, opts) → canvas
import { h } from '../core/dom.js';
import { dialog, toast } from '../core/ui.js';
import { loadOrt, fetchModelBytes } from '../core/inpaint.js';
import { segment } from '../core/ai.js';

const mk = (w, h2) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h2)); return c; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const tick = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------ neural style
export const STYLE_MODELS = {
  mosaic: { label: 'Mosaic', file: 'style_mosaic.onnx', bytes: 3378536 },
  candy: { label: 'Candy', file: 'style_candy.onnx', bytes: 3378536 },
  rain: { label: 'Oil painting', file: 'style_rain_princess.onnx', bytes: 3378536 },
  udnie: { label: 'Abstract painting', file: 'style_udnie.onnx', bytes: 3378536 },
  pointilism: { label: 'Pointillism', file: 'style_pointilism.onnx', bytes: 3378536 },
};
const sessions = new Map();
function styleSession(id, onProgress) {
  if (!sessions.has(id)) {
    const p = (async () => {
      const spec = STYLE_MODELS[id];
      const ort = await loadOrt();
      const bytes = await fetchModelBytes({ ...spec, single: true, label: spec.label + ' style' }, { onProgress });
      onProgress && onProgress(null, 'Preparing the style model…');
      await tick();
      return { ort, session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }) };
    })();
    p.catch(() => sessions.delete(id));
    sessions.set(id, p);
  }
  return sessions.get(id);
}
/** Run a style network on `src` at `side` px (long side). → canvas at that size, plus ms. */
export async function stylize(src, id, side = 512, onProgress) {
  const { ort, session } = await styleSession(id, onProgress);
  const k = Math.min(1, side / Math.max(src.width, src.height));
  const w = Math.max(32, Math.round(src.width * k / 4) * 4), hh = Math.max(32, Math.round(src.height * k / 4) * 4);
  const c = mk(w, hh), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, hh);
  const im = g.getImageData(0, 0, w, hh), d = im.data, n = w * hh, x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { x[i] = d[i * 4]; x[n + i] = d[i * 4 + 1]; x[2 * n + i] = d[i * 4 + 2]; }
  onProgress && onProgress(null, 'Painting…');
  await tick();
  const t0 = performance.now();
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, hh, w]) });
  const o = res[session.outputNames[0]], od = o.data, ow = o.dims[3], oh = o.dims[2], m = ow * oh;
  const oc = mk(ow, oh), og = oc.getContext('2d'), oi = og.createImageData(ow, oh);
  for (let i = 0; i < m; i++) { oi.data[i * 4] = od[i]; oi.data[i * 4 + 1] = od[m + i]; oi.data[i * 4 + 2] = od[2 * m + i]; oi.data[i * 4 + 3] = 255; }
  og.putImageData(oi, 0, 0);
  o.dispose && o.dispose();
  oc._ms = performance.now() - t0;
  return oc;
}

// ------------------------------------------------------------------ prompt interpreter
const COLORS = {
  pink: [255, 105, 180], red: [230, 40, 50], orange: [255, 140, 40], yellow: [255, 214, 10], green: [60, 200, 90], teal: [0, 170, 170],
  cyan: [0, 200, 255], blue: [40, 110, 255], purple: [150, 70, 230], magenta: [240, 40, 200], white: [245, 245, 245], black: [12, 12, 14], gold: [230, 180, 60], brown: [130, 85, 50],
};
const COLOR_WORDS = {
  pink: ['pink', 'وردي', 'بمبي', 'زهري'], red: ['red', 'احمر'], orange: ['orange', 'برتقالي', 'برتقاني'], yellow: ['yellow', 'اصفر'],
  green: ['green', 'اخضر'], teal: ['teal', 'turquoise', 'تركواز', 'فيروزي'], cyan: ['cyan', 'سماوي', 'لبني'], blue: ['blue', 'ازرق'],
  purple: ['purple', 'violet', 'بنفسجي', 'موف'], magenta: ['magenta', 'فوشيا'], white: ['white', 'ابيض'], black: ['black', 'اسود'], gold: ['gold', 'golden', 'دهبي', 'ذهبي'], brown: ['brown', 'بني'],
};
const BG_WORDS = ['background', 'backdrop', 'bg', 'الخلفيه', 'خلفيه', 'الباك', 'باكجراوند'];
const STRONG = ['very', 'strong', 'heavy', 'heavily', 'extreme', 'super', 'a lot', 'جدا', 'اوي', 'قوي', 'كتير', 'جامد'];
const LIGHT = ['slightly', 'subtle', 'a bit', 'a little', 'lightly', 'soft touch', 'شويه', 'خفيف', 'بسيط', 'حبه'];
const STOP = new Set(('a an the and with of to in on for my me make it this that photo picture image pic look like style effect filter add some please more is as at be into from but i want give put apply ' +
  'و في على علي من الى الي مع يا عايز عاوز اعمل اعملي خلي خليها خليه الصوره صوره صورة الصورة شكل زي ستايل فلتر تاثير حط ضيف لو سمحت بس دي ده كده يبقى تبقى ابقى ال كل حاجه').split(' '));

/** Lower-case, strip Arabic diacritics and unify letter variants so spelling differences still match. */
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}&+ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Each rule: phrases (already normalised) → label + a change to the recipe. k = intensity multiplier.
const add = (r, key, v, max = 1.5) => { r[key] = clamp((r[key] || 0) + v, -max, max); };
const RULES = [
  // ---- neural styles
  { p: ['mosaic', 'stained glass', 'موزاييك', 'فسيفساء', 'زجاج ملون'], label: 'mosaic (neural style)', f: (r) => { r.style = 'mosaic'; } },
  { p: ['candy', 'pop art', 'psychedelic', 'بوب ارت', 'كاندي'], label: 'candy pop art (neural style)', f: (r) => { r.style = 'candy'; } },
  { p: ['oil painting', 'oil paint', 'painting', 'painted', 'painterly', 'impressionist', 'van gogh', 'لوحه زيتيه', 'زيتي', 'لوحه', 'مرسومه', 'رسم زيتي', 'رسمه'], label: 'oil painting (neural style)', f: (r) => { r.style = 'rain'; } },
  { p: ['abstract', 'cubist', 'cubism', 'expressionist', 'تجريدي', 'تكعيبي'], label: 'abstract painting (neural style)', f: (r) => { r.style = 'udnie'; } },
  { p: ['pointillism', 'pointilism', 'pointillist', 'dots painting', 'تنقيط', 'تنقيطي'], label: 'pointillism (neural style)', f: (r) => { r.style = 'pointilism'; } },
  // ---- drawn looks (not neural)
  { p: ['anime', 'cartoon', 'comic', 'toon', 'manga', 'cel shaded', 'انمي', 'كرتون', 'كارتون', 'كوميكس'], label: 'cartoon (flat colours + ink lines)', f: (r, k) => { r.toon = clamp(0.9 * k, 0, 1); add(r, 'sat', 0.15); } },
  { p: ['pencil sketch', 'sketch', 'pencil', 'drawing', 'line art', 'اسكتش', 'رصاص', 'رسم بالقلم', 'تخطيط'], label: 'pencil sketch', f: (r, k) => { r.sketch = clamp(1 * k, 0, 1); } },
  // ---- palettes
  { p: ['teal and orange', 'teal & orange', 'orange and teal', 'blockbuster', 'cinematic', 'cinema', 'movie', 'سينمائي', 'سينما', 'فيلم سينما'], label: 'teal and orange cinema grade', f: (r, k) => { r.split = { sh: [0, 150, 170], hi: [255, 160, 70], amt: 0.42 * k }; add(r, 'contrast', 0.12 * k); add(r, 'sat', 0.08); r.bars = r.bars || 0; } },
  { p: ['cyberpunk', 'neon city', 'synthwave', 'vaporwave', 'retrowave', 'neon', 'سايبربانك', 'نيون'], label: 'cyberpunk neon', f: (r, k) => { r.split = { sh: [40, 0, 200], hi: [255, 40, 190], amt: 0.55 * k }; add(r, 'contrast', 0.18 * k); add(r, 'sat', 0.3 * k); add(r, 'bloom', 0.5 * k); add(r, 'ca', 0.5 * k); } },
  { p: ['golden hour', 'sunset', 'sunrise', 'magic hour', 'ساعه ذهبيه', 'غروب', 'الغروب', 'شروق'], label: 'golden hour', f: (r, k) => { add(r, 'temp', 0.55 * k); r.split = { sh: [150, 60, 40], hi: [255, 190, 90], amt: 0.3 * k }; add(r, 'bloom', 0.3 * k); r.leak = Math.max(r.leak || 0, 0.35 * k); } },
  { p: ['moody', 'dark and moody', 'dramatic', 'noir mood', 'مودي', 'درامي', 'كئيب', 'غامق'], label: 'moody', f: (r, k) => { add(r, 'bright', -0.1 * k); add(r, 'contrast', 0.22 * k); add(r, 'sat', -0.25 * k); add(r, 'vignette', 0.5 * k); r.split = r.split || { sh: [20, 60, 80], hi: [200, 170, 140], amt: 0.25 * k }; } },
  { p: ['pastel', 'soft colours', 'soft colors', 'باستيل', 'الوان هاديه'], label: 'pastel', f: (r, k) => { add(r, 'fade', 0.6 * k); add(r, 'sat', -0.18 * k); add(r, 'bright', 0.08 * k); add(r, 'contrast', -0.15 * k); } },
  { p: ['black and white', 'black & white', 'b&w', 'bw', 'monochrome', 'noir', 'greyscale', 'grayscale', 'ابيض واسود', 'ابيض و اسود', 'ابيض في اسود', 'مونوكروم'], label: 'black and white', f: (r) => { r.bw = 1; } },
  { p: ['sepia', 'old photo', 'antique', 'سيبيا', 'صوره قديمه'], label: 'sepia / old photo', f: (r, k) => { r.bw = 1; r.split = { sh: [90, 60, 30], hi: [255, 225, 170], amt: 0.5 * k }; add(r, 'fade', 0.3 * k); add(r, 'grain', 0.4 * k); add(r, 'vignette', 0.35 * k); } },
  { p: ['vintage 70s', '70s', 'seventies', 'السبعينات', 'سبعينات'], label: 'vintage 70s', f: (r, k) => { add(r, 'temp', 0.4 * k); add(r, 'fade', 0.5 * k); add(r, 'sat', -0.12); r.split = { sh: [110, 70, 30], hi: [255, 210, 120], amt: 0.35 * k }; add(r, 'grain', 0.5 * k); r.leak = Math.max(r.leak || 0, 0.4 * k); } },
  { p: ['vintage 80s', '80s', 'eighties', 'التمانينات', 'تمانينات', 'الثمانينات'], label: 'vintage 80s', f: (r, k) => { add(r, 'sat', 0.25 * k); add(r, 'contrast', 0.1 * k); r.split = { sh: [60, 20, 150], hi: [255, 120, 160], amt: 0.3 * k }; add(r, 'bloom', 0.35 * k); add(r, 'grain', 0.35 * k); } },
  { p: ['vintage 90s', '90s', 'nineties', 'التسعينات', 'تسعينات', 'disposable', 'disposable camera'], label: 'vintage 90s', f: (r, k) => { add(r, 'temp', 0.15 * k); add(r, 'tint', -0.12 * k); add(r, 'fade', 0.35 * k); add(r, 'contrast', 0.08); add(r, 'grain', 0.55 * k); add(r, 'vignette', 0.4 * k); add(r, 'halation', 0.3 * k); } },
  { p: ['y2k', '2000s', 'digicam', 'flash party', 'الالفينات'], label: 'Y2K digicam', f: (r, k) => { add(r, 'contrast', 0.2 * k); add(r, 'sat', 0.22 * k); add(r, 'temp', -0.12 * k); add(r, 'sharp', 0.6 * k); add(r, 'vignette', 0.3 * k); add(r, 'bloom', 0.2 * k); } },
  { p: ['vhs', 'camcorder', 'tape', 'crt', 'شريط فيديو', 'فيديو قديم'], label: 'VHS tape', f: (r, k) => { add(r, 'scan', 0.7 * k); add(r, 'ca', 0.8 * k); add(r, 'sat', 0.15); add(r, 'fade', 0.25 * k); add(r, 'soft', 0.4 * k); add(r, 'grain', 0.3 * k); } },
  { p: ['vintage', 'retro', 'old school', 'فينتدج', 'فينتج', 'ريترو', 'زمان', 'كلاسيك', 'classic', 'قديم', 'قديمه', 'old'], label: 'vintage', f: (r, k) => { add(r, 'temp', 0.25 * k); add(r, 'fade', 0.45 * k); add(r, 'sat', -0.1); add(r, 'grain', 0.45 * k); add(r, 'vignette', 0.35 * k); } },
  { p: ['warm film', 'kodak', 'portra', 'gold film', 'كوداك'], label: 'warm colour film', f: (r, k) => { add(r, 'temp', 0.3 * k); add(r, 'fade', 0.2 * k); r.split = r.split || { sh: [40, 90, 90], hi: [255, 200, 130], amt: 0.25 * k }; add(r, 'grain', 0.4 * k); add(r, 'halation', 0.35 * k); } },
  { p: ['cool film', 'fuji', 'fujifilm', 'فوجي'], label: 'cool green film', f: (r, k) => { add(r, 'temp', -0.12 * k); add(r, 'tint', -0.18 * k); add(r, 'fade', 0.2 * k); r.split = r.split || { sh: [20, 110, 90], hi: [240, 240, 200], amt: 0.25 * k }; add(r, 'grain', 0.35 * k); } },
  { p: ['film', 'analog', 'analogue', '35mm', 'فيلم', 'افلام', 'نيجاتيف'], label: 'film look', f: (r, k) => { add(r, 'fade', 0.25 * k); add(r, 'grain', 0.45 * k); add(r, 'halation', 0.3 * k); add(r, 'contrast', 0.06); } },
  // ---- colour
  { p: ['warm', 'warmer', 'cozy', 'cosy', 'دافي', 'دافئ', 'دفا', 'سخن'], label: 'warm', f: (r, k) => add(r, 'temp', 0.4 * k) },
  { p: ['cool', 'cooler', 'cold', 'icy', 'winter', 'بارد', 'ساقع', 'تلج', 'شتوي'], label: 'cool', f: (r, k) => add(r, 'temp', -0.4 * k) },
  { p: ['vivid', 'vibrant', 'colourful', 'colorful', 'saturated', 'punchy', 'الوان قويه', 'الوان زاهيه', 'مشبع', 'زاهي', 'الوان'], label: 'vivid colours', f: (r, k) => { add(r, 'sat', 0.4 * k); add(r, 'contrast', 0.08); } },
  { p: ['muted', 'desaturated', 'washed', 'washed out', 'باهت', 'هادي'], label: 'muted', f: (r, k) => { add(r, 'sat', -0.35 * k); add(r, 'fade', 0.2 * k); } },
  { p: ['faded', 'fade', 'matte', 'مطفي', 'مات'], label: 'faded blacks', f: (r, k) => add(r, 'fade', 0.6 * k) },
  { p: ['high contrast', 'contrasty', 'contrast', 'punch', 'كونتراست', 'تباين'], label: 'more contrast', f: (r, k) => add(r, 'contrast', 0.3 * k) },
  { p: ['low contrast', 'flat', 'تباين قليل'], label: 'less contrast', f: (r, k) => add(r, 'contrast', -0.3 * k) },
  { p: ['bright', 'brighter', 'airy', 'light and airy', 'فاتح', 'منور', 'نور', 'اضاءه'], label: 'brighter', f: (r, k) => add(r, 'bright', 0.16 * k) },
  { p: ['dark', 'darker', 'low key', 'ضلمه', 'مظلم', 'اغمق'], label: 'darker', f: (r, k) => add(r, 'bright', -0.16 * k) },
  { p: ['night', 'moonlight', 'blue hour', 'ليل', 'بالليل', 'ليلي', 'قمر'], label: 'night tint', f: (r, k) => { add(r, 'temp', -0.45 * k); add(r, 'bright', -0.14 * k); add(r, 'contrast', 0.1); r.split = r.split || { sh: [10, 30, 110], hi: [170, 200, 255], amt: 0.3 * k }; } },
  // ---- texture
  { p: ['film grain', 'grain', 'grainy', 'noise', 'noisy', 'gritty', 'grit', 'حبيبات', 'جرين', 'نويز', 'خشن'], label: 'film grain', f: (r, k) => { add(r, 'grain', 0.7 * k); } },
  { p: ['halation', 'red glow', 'هاليشن'], label: 'halation', f: (r, k) => add(r, 'halation', 0.7 * k) },
  { p: ['bloom', 'glow', 'glowing', 'dreamy', 'dream', 'ethereal', 'hazy', 'توهج', 'حالم', 'احلام', 'جلو', 'ضباب'], label: 'dreamy glow', f: (r, k) => { add(r, 'bloom', 0.7 * k); add(r, 'soft', 0.3 * k); add(r, 'fade', 0.15 * k); } },
  { p: ['soft', 'softer', 'smooth', 'ناعم', 'نعومه'], label: 'soft', f: (r, k) => add(r, 'soft', 0.5 * k) },
  { p: ['sharp', 'sharper', 'crisp', 'detailed', 'حاد', 'شارب', 'تفاصيل'], label: 'sharper', f: (r, k) => add(r, 'sharp', 0.7 * k) },
  { p: ['vignette', 'dark corners', 'dark edges', 'فينيت', 'اطراف غامقه'], label: 'vignette', f: (r, k) => add(r, 'vignette', 0.6 * k) },
  { p: ['light leak', 'light leaks', 'leak', 'leaks', 'sun flare', 'flare', 'تسريب ضوء', 'فلير'], label: 'light leaks', f: (r, k) => { r.leak = clamp((r.leak || 0) + 0.7 * k, 0, 1.2); } },
  { p: ['dust', 'scratches', 'dusty', 'تراب', 'خدوش'], label: 'dust and scratches', f: (r, k) => add(r, 'dust', 0.7 * k) },
  { p: ['scanlines', 'scan lines', 'tv lines', 'خطوط'], label: 'scanlines', f: (r, k) => add(r, 'scan', 0.7 * k) },
  { p: ['chromatic aberration', 'aberration', 'rgb split', 'fringe', 'glitch', 'جليتش'], label: 'colour fringing', f: (r, k) => add(r, 'ca', 0.9 * k) },
  // ---- subject-aware (people model)
  { p: ['blur the background', 'blur background', 'blurred background', 'background blur', 'bokeh', 'portrait mode', 'shallow depth', 'الخلفيه مغبشه', 'غبش الخلفيه', 'خلفيه مغبشه', 'بلور الخلفيه', 'خلفيه بلور', 'بوكيه', 'عزل', 'تغبيش الخلفيه'], label: 'blurred background', f: (r, k) => { r.bgBlur = clamp(0.8 * k, 0, 1.4); } },
  { p: ['darken the background', 'dark background', 'darker background', 'الخلفيه غامقه', 'خلفيه غامقه', 'غمق الخلفيه', 'خلفيه ضلمه'], label: 'darker background', f: (r, k) => { r.bgDark = clamp(0.55 * k, 0, 0.9); } },
  { p: ['black and white background', 'desaturate the background', 'grey background', 'gray background', 'colour splash', 'color splash', 'الخلفيه ابيض واسود', 'خلفيه ابيض واسود'], label: 'colour only on the subject', f: (r) => { r.bgGray = 1; } },
  { p: ['subject pop', 'make me pop', 'pop', 'stand out', 'ابرز', 'ابراز', 'يبان'], label: 'subject pop', f: (r, k) => { r.pop = clamp(0.8 * k, 0, 1.2); } },
  { p: ['sticker', 'outline', 'white outline', 'cut out', 'cutout', 'استيكر', 'ستيكر', 'حدود بيضا', 'اوت لاين'], label: 'sticker outline', f: (r, k) => { r.outline = clamp(1 * k, 0, 1.5); } },
  { p: ['neon outline', 'neon edge', 'neon glow', 'glow outline', 'حدود نيون', 'نيون حوالين'], label: 'neon edge', f: (r, k) => { r.neon = clamp(1 * k, 0, 1.5); } },
];
// longest phrases first so "black and white background" wins over "black and white"
const FLAT = [];
RULES.forEach((rule) => rule.p.forEach((ph) => FLAT.push({ ph: norm(ph), rule })));
FLAT.sort((a, b) => b.ph.length - a.ph.length);

// Arabic glues "and / with / the" onto the next word (وخلي، بحبيبات): split them off when what is left is a word we know.
const VOCAB = new Set(STOP);
FLAT.forEach(({ ph }) => ph.split(' ').forEach((w) => VOCAB.add(w)));
[...Object.values(COLOR_WORDS).flat(), ...BG_WORDS, ...STRONG, ...LIGHT].forEach((p) => norm(p).split(' ').forEach((w) => VOCAB.add(w)));
const PREFIX = ['وبال', 'وال', 'بال', 'لل', 'ال', 'وب', 'و', 'ب', 'ل'];
function unprefix(t) {
  return t.split(' ').map((w) => {
    if (VOCAB.has(w) || !/[\u0600-\u06ff]/.test(w)) return w;
    for (const p of PREFIX) if (w.length > p.length + 1 && w.startsWith(p) && VOCAB.has(w.slice(p.length))) return w.slice(p.length);
    return w;
  }).join(' ');
}
const hasWord = (text, ph) => (' ' + text + ' ').includes(' ' + ph + ' ');
const cut = (text, ph) => (' ' + text + ' ').split(' ' + ph + ' ').join('  ').replace(/\s+/g, ' ').trim();

/**
 * Text → recipe. recipe.understood lists what was recognised (in plain words) and
 * recipe.unknown the words that were not — nothing is silently invented.
 */
export function parsePrompt(text) {
  let t = unprefix(norm(text));
  const r = { understood: [], unknown: [] };
  let k = 1;
  for (const w of STRONG) if (hasWord(t, norm(w))) { k = 1.4; t = cut(t, norm(w)); }
  for (const w of LIGHT) if (hasWord(t, norm(w))) { k = 0.6; t = cut(t, norm(w)); }
  // "pink background" / "background pink" / "خلفية وردي"
  const bgWord = BG_WORDS.map(norm).find((b) => hasWord(t, b));
  if (bgWord) {
    for (const [name, words] of Object.entries(COLOR_WORDS)) {
      const cw = words.map(norm).find((c) => hasWord(t, c));
      if (!cw) continue;
      // leave "black and white …" to the rules
      if ((name === 'black' || name === 'white') && /black (and|&) white|ابيض (و ?|في )اسود/.test(t)) continue;
      r.bgColor = COLORS[name]; r.understood.push(`${name} background`);
      t = cut(cut(t, cw), bgWord);
      break;
    }
  }
  const seen = new Set();
  for (const { ph, rule } of FLAT) {
    if (!hasWord(t, ph)) continue;
    t = cut(t, ph);
    if (seen.has(rule)) continue;
    seen.add(rule); rule.f(r, k); r.understood.push(rule.label);
  }
  // a bare colour word → tint the whole picture
  for (const [name, words] of Object.entries(COLOR_WORDS)) {
    const cw = words.map(norm).find((c) => hasWord(t, c));
    if (!cw) continue;
    t = cut(t, cw);
    if (name === 'black' || name === 'white') continue;
    const c = COLORS[name];
    r.split = { sh: c.map((v) => v * 0.6), hi: c.map((v) => 128 + v * 0.5), amt: 0.4 * k }; r.understood.push(`${name} tint`);
    break;
  }
  for (const b of BG_WORDS.map(norm)) t = cut(t, b);
  r.unknown = t.split(' ').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w) && w.length > 1);
  r.needsMask = !!(r.bgBlur || r.bgDark || r.bgGray || r.bgColor || r.pop || r.outline || r.neon);
  r.empty = r.understood.length === 0;
  if (k !== 1 && !r.empty) r.understood.push(k > 1 ? 'stronger' : 'subtle');
  return r;
}

// ------------------------------------------------------------------ rendering helpers
const canFilter = (() => { try { return 'filter' in mk(1, 1).getContext('2d'); } catch (e) { return false; } })();
/** Gaussian-ish blur that also works where canvas `filter` is missing (older Safari). */
function blurred(src, r, w = src.width, hh = src.height) {
  const c = mk(w, hh), g = c.getContext('2d');
  if (r < 0.5) { g.drawImage(src, 0, 0, w, hh); return c; }
  if (canFilter) { g.filter = `blur(${r}px)`; g.drawImage(src, 0, 0, w, hh); g.filter = 'none'; return c; }
  const k = Math.max(1, r / 1.5), sw = Math.max(2, Math.round(w / k)), sh = Math.max(2, Math.round(hh / k));
  const s = mk(sw, sh), sg = s.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(src, 0, 0, sw, sh);
  const s2 = mk(Math.max(2, sw >> 1), Math.max(2, sh >> 1)); s2.getContext('2d').drawImage(s, 0, 0, s2.width, s2.height);
  g.imageSmoothingQuality = 'high'; g.drawImage(s2, 0, 0, w, hh);
  return c;
}
function rnd(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** Person mask for a picture as a canvas (alpha = person), or null when nobody is found. */
export async function personMask(src) {
  const side = 512, k = Math.min(1, side / Math.max(src.width, src.height));
  const small = mk(src.width * k, src.height * k); small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
  const res = await segment(small, 'person');
  const c = mk(res.width, res.height), g = c.getContext('2d'), im = g.createImageData(res.width, res.height);
  let cover = 0;
  for (let i = 0; i < res.mask.length; i++) { const a = clamp((res.mask[i] - 0.25) * 2.2, 0, 1); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = a * 255; cover += a; }
  g.putImageData(im, 0, 0);
  return cover / res.mask.length > 0.01 ? c : null;
}

function subjectOps(base, mask, r) {
  const W = base.width, H = base.height, m = Math.max(W, H);
  const soft = blurred(mask, Math.max(1, m * 0.003), W, H);
  const subj = mk(W, H), sg = subj.getContext('2d');
  sg.drawImage(base, 0, 0);
  if (r.pop) { sg.globalCompositeOperation = 'soft-light'; sg.globalAlpha = 0.35 * r.pop; sg.drawImage(base, 0, 0); sg.globalAlpha = 1; }
  sg.globalCompositeOperation = 'destination-in'; sg.drawImage(soft, 0, 0); sg.globalCompositeOperation = 'source-over';
  let bg = base;
  if (r.bgBlur) bg = blurred(base, m * 0.012 * r.bgBlur);
  const out = mk(W, H), g = out.getContext('2d');
  g.drawImage(bg, 0, 0, W, H);
  if (r.bgGray) { g.globalCompositeOperation = 'saturation'; g.fillStyle = '#808080'; g.fillRect(0, 0, W, H); }
  if (r.bgColor) {
    const [cr, cg, cb] = r.bgColor;
    g.globalCompositeOperation = 'color'; g.globalAlpha = 0.92; g.fillStyle = `rgb(${cr},${cg},${cb})`; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.45; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
  }
  const dark = (r.bgDark || 0) + (r.pop ? 0.18 * r.pop : 0);
  if (dark) { g.globalCompositeOperation = 'source-over'; g.fillStyle = `rgba(0,0,0,${clamp(dark, 0, 0.92)})`; g.fillRect(0, 0, W, H); }
  if (r.pop) { g.globalCompositeOperation = 'saturation'; g.globalAlpha = 0.3 * Math.min(1, r.pop); g.fillStyle = '#808080'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  g.globalCompositeOperation = 'source-over';
  const sil = (color, grow) => {            // the mask as a solid colour, grown by `grow` px
    const c = mk(W, H), cg = c.getContext('2d'), steps = 16;
    for (let a = 0; a < steps; a++) { const t = a / steps * Math.PI * 2; cg.drawImage(soft, Math.cos(t) * grow, Math.sin(t) * grow); }
    cg.globalCompositeOperation = 'source-in'; cg.fillStyle = color; cg.fillRect(0, 0, W, H);
    return c;
  };
  if (r.neon) {
    const col = r.split ? `rgb(${r.split.hi.map((v) => Math.round(clamp(v * 1.1, 0, 255))).join(',')})` : '#39f0ff';
    const edge = sil(col, m * 0.006 * r.neon);
    g.globalCompositeOperation = 'screen';
    g.drawImage(blurred(edge, m * 0.03), 0, 0); g.drawImage(blurred(edge, m * 0.008), 0, 0);
    g.globalCompositeOperation = 'source-over'; g.drawImage(sil('#ffffff', m * 0.0025), 0, 0);
  }
  if (r.outline) {
    g.globalAlpha = 0.35; g.drawImage(blurred(sil('#000000', m * 0.012 * r.outline), m * 0.012), m * 0.004, m * 0.006); g.globalAlpha = 1;
    g.drawImage(sil('#ffffff', m * 0.011 * r.outline), 0, 0);
  }
  g.drawImage(subj, 0, 0);
  return out;
}

/** Per-pixel colour work in one pass: grade, split-tone, B&W, cartoon, sketch, fringing. */
function gradePass(c, r) {
  const W = c.width, H = c.height, g = c.getContext('2d', { willReadFrequently: true });
  const im = g.getImageData(0, 0, W, H), d = im.data, n = W * H;
  const temp = r.temp || 0, tint = r.tint || 0, con = 1 + (r.contrast || 0), sat = r.bw ? 0 : 1 + (r.sat || 0), fade = r.fade || 0, br = 1 + (r.bright || 0);
  const mr = (1 + 0.16 * temp) * (1 + 0.05 * tint), mg = 1 - 0.11 * tint, mb = (1 - 0.16 * temp) * (1 + 0.05 * tint);
  const sp = r.split, toon = r.toon || 0, sketch = r.sketch || 0;
  let L = null;
  if (toon || sketch) { L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; }
  const ca = Math.round((r.ca || 0) * Math.max(W, H) * 0.004);
  const src = ca ? new Uint8ClampedArray(d) : null;
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
    const j = i * 4;
    let R = d[j], G = d[j + 1], B = d[j + 2];
    if (ca) { const k = (x - W / 2) / (W / 2), sx = Math.round(ca * k) || (k < 0 ? -1 : 1); R = src[(y * W + clamp(x + sx, 0, W - 1)) * 4]; B = src[(y * W + clamp(x - sx, 0, W - 1)) * 4 + 2]; }
    if (toon) { const q = 255 / 5; R += (Math.round(R / q) * q - R) * toon; G += (Math.round(G / q) * q - G) * toon; B += (Math.round(B / q) * q - B) * toon; }
    R *= mr * br; G *= mg * br; B *= mb * br;
    R = (R - 128) * con + 128; G = (G - 128) * con + 128; B = (B - 128) * con + 128;
    if (fade) { R = R * (1 - 0.2 * fade) + 34 * fade; G = G * (1 - 0.2 * fade) + 32 * fade; B = B * (1 - 0.2 * fade) + 36 * fade; }
    let l = R * 0.3 + G * 0.59 + B * 0.11;
    R = l + (R - l) * sat; G = l + (G - l) * sat; B = l + (B - l) * sat;
    if (sp) {
      const t = clamp(l / 255, 0, 1), ws = (1 - t) * (1 - t) * sp.amt, wh = t * t * sp.amt, mid = 4 * t * (1 - t) * sp.amt * 0.25;
      R += (sp.sh[0] - 128) * ws + (sp.hi[0] - 128) * (wh + mid) * 0.8; G += (sp.sh[1] - 128) * ws + (sp.hi[1] - 128) * (wh + mid) * 0.8; B += (sp.sh[2] - 128) * ws + (sp.hi[2] - 128) * (wh + mid) * 0.8;
    }
    if (L && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
      const gx = L[i + 1] - L[i - 1] + 0.5 * (L[i + 1 - W] - L[i - 1 - W] + L[i + 1 + W] - L[i - 1 + W]);
      const gy = L[i + W] - L[i - W] + 0.5 * (L[i + W - 1] - L[i - W - 1] + L[i + W + 1] - L[i - W + 1]);
      const e = Math.sqrt(gx * gx + gy * gy);
      if (sketch) { const p = clamp(255 - e * 3.2, 0, 255) * 0.85 + L[i] * 0.15, v = p * 0.98 + 5; R += (v - R) * sketch; G += (v - G) * sketch; B += (v * 0.98 - B) * sketch; }
      else { const ink = clamp((e - 46) / 50, 0, 1) * toon; R *= 1 - ink; G *= 1 - ink; B *= 1 - ink; }
    }
    d[j] = R; d[j + 1] = G; d[j + 2] = B;
  }
  g.putImageData(im, 0, 0);
}

function texturePass(c, r, seed = 7) {
  const W = c.width, H = c.height, m = Math.max(W, H), g = c.getContext('2d');
  if (r.soft) { g.globalAlpha = clamp(0.5 * r.soft, 0, 0.8); g.drawImage(blurred(c, m * 0.004 * (1 + r.soft)), 0, 0); g.globalAlpha = 1; }
  if (r.sharp) {                                  // unsharp mask: add back what a blur removes
    const b = blurred(c, Math.max(0.8, m * 0.0012));
    const hi = mk(W, H), hg = hi.getContext('2d'); hg.drawImage(c, 0, 0); hg.globalCompositeOperation = 'difference'; hg.drawImage(b, 0, 0);
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = clamp(0.45 * r.sharp, 0, 0.9); g.drawImage(c, 0, 0); g.globalAlpha = 1;
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(0.5 * r.sharp, 0, 1); g.drawImage(hi, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  if (r.bloom || r.halation) {
    const sw = Math.max(8, Math.round(W / 4)), sh = Math.max(8, Math.round(H / 4));
    const hl = mk(sw, sh), hg = hl.getContext('2d', { willReadFrequently: true }); hg.drawImage(c, 0, 0, sw, sh);
    const im = hg.getImageData(0, 0, sw, sh), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11, k = clamp((l - 150) / 90, 0, 1); d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
    hg.putImageData(im, 0, 0);
    g.globalCompositeOperation = 'screen';
    if (r.bloom) { g.globalAlpha = clamp(0.75 * r.bloom, 0, 1); g.drawImage(blurred(hl, sw * 0.03), 0, 0, W, H); g.drawImage(blurred(hl, sw * 0.008), 0, 0, W, H); }
    if (r.halation) {
      const red = mk(sw, sh), rg = red.getContext('2d'); rg.drawImage(blurred(hl, sw * 0.014), 0, 0); rg.globalCompositeOperation = 'multiply'; rg.fillStyle = '#ff5a28'; rg.fillRect(0, 0, sw, sh);
      g.globalAlpha = clamp(0.9 * r.halation, 0, 1); g.drawImage(red, 0, 0, W, H);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  if (r.leak) {
    const R = rnd(seed + 3);
    g.globalCompositeOperation = 'screen';
    for (const [col, a] of [['255,120,40', 0.55], ['255,60,90', 0.35], ['255,210,120', 0.3]]) {
      const x = R() < 0.5 ? W * R() * 0.2 : W * (0.8 + R() * 0.2), y = H * R(), rad = m * (0.35 + R() * 0.3);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${col},${clamp(a * r.leak, 0, 1)})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'source-over';
  }
  if (r.vignette) {
    const gr = g.createRadialGradient(W / 2, H / 2, m * 0.28, W / 2, H / 2, m * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${clamp(0.75 * r.vignette, 0, 0.95)})`);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  if (r.scan) {
    const step = Math.max(2, Math.round(H / 240));
    g.fillStyle = `rgba(0,0,0,${clamp(0.28 * r.scan, 0, 0.6)})`;
    for (let y = 0; y < H; y += step * 2) g.fillRect(0, y, W, step);
  }
  if (r.dust) {
    const R = rnd(seed + 11), count = Math.round(70 * r.dust);
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.fillStyle = 'rgba(255,255,255,.6)';
    for (let i = 0; i < count; i++) {
      const x = R() * W, y = R() * H, s = m * (0.0006 + R() * 0.0016);
      if (R() < 0.12) { g.lineWidth = Math.max(0.6, m * 0.0006); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (R() - 0.5) * m * 0.04, y + R() * m * 0.05, x + (R() - 0.5) * m * 0.03, y + R() * m * 0.11); g.stroke(); }
      else { g.beginPath(); g.arc(x, y, s, 0, 6.3); g.fill(); }
    }
  }
  if (r.grain) {
    const T = 256, tile = mk(T, T), tg = tile.getContext('2d'), im = tg.createImageData(T, T), R = rnd(seed + 29);
    for (let i = 0; i < T * T; i++) { const v = 128 + (R() + R() + R() - 1.5) * 110; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    tg.putImageData(im, 0, 0);
    const scale = Math.max(1, m / 1400);
    g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = clamp(0.5 * r.grain, 0, 0.9); g.scale(scale, scale); g.fillStyle = g.createPattern(tile, 'repeat'); g.fillRect(0, 0, W / scale + 1, H / scale + 1); g.restore();
  }
}

/**
 * Apply a recipe. → new canvas (never touches `source`).
 * opts: maxSide (work size), styleSide (network input, long side), strength 0..1,
 *       mask (canvas | null | undefined = find it), styled (pre-computed style canvas), onProgress, info (filled in)
 */
export async function renderRecipe(source, recipe, { maxSide = 0, styleSide = 512, strength = 1, mask, styled, onProgress, info = {} } = {}) {
  const k = maxSide ? Math.min(1, maxSide / Math.max(source.width, source.height)) : 1;
  const W = Math.max(1, Math.round(source.width * k)), H = Math.max(1, Math.round(source.height * k));
  const base = mk(W, H), bgx = base.getContext('2d'); bgx.imageSmoothingQuality = 'high'; bgx.drawImage(source, 0, 0, W, H);
  let cur = mk(W, H); cur.getContext('2d').drawImage(base, 0, 0);
  if (recipe.style) {
    try {
      const st = styled || await stylize(base, recipe.style, styleSide, onProgress);
      info.styled = st; info.styleMs = st._ms;
      // the network works small: scale its picture up and put the photo's own fine detail back on top
      const up = mk(W, H), ug = up.getContext('2d'); ug.imageSmoothingQuality = 'high'; ug.drawImage(st, 0, 0, W, H);
      if (W > st.width * 1.2) {
        const low = mk(st.width, st.height); low.getContext('2d').drawImage(base, 0, 0, st.width, st.height);
        const lowUp = mk(W, H), lg = lowUp.getContext('2d'); lg.imageSmoothingQuality = 'high'; lg.drawImage(low, 0, 0, W, H);
        const a = ug.getImageData(0, 0, W, H), b = bgx.getImageData(0, 0, W, H).data, l = lg.getImageData(0, 0, W, H).data, d = a.data;
        for (let i = 0; i < d.length; i += 4) { const det = ((b[i] - l[i]) * 0.3 + (b[i + 1] - l[i + 1]) * 0.59 + (b[i + 2] - l[i + 2]) * 0.11) * 0.9; d[i] += det; d[i + 1] += det; d[i + 2] += det; }
        ug.putImageData(a, 0, 0);
      }
      cur = up;
    } catch (e) { info.styleError = String(e && e.message || e); }
  }
  if (recipe.needsMask) {
    let m = mask;
    if (m === undefined) { onProgress && onProgress(null, 'Finding the subject…'); try { m = await personMask(base); } catch (e) { m = null; info.maskError = String(e && e.message || e); } }
    info.mask = m;
    if (m) cur = subjectOps(cur, m, recipe); else info.noSubject = true;
  }
  gradePass(cur, recipe);
  texturePass(cur, recipe);
  if (strength < 0.999) { const g = cur.getContext('2d'); g.globalAlpha = 1 - clamp(strength, 0, 1); g.drawImage(base, 0, 0); g.globalAlpha = 1; }
  return cur;
}

// ------------------------------------------------------------------ dialog
const CHIPS = [
  'Warm film, soft grain', 'Teal and orange cinema', 'Cyberpunk neon', 'Blur the background', 'Make the background pink', 'Oil painting',
  'Mosaic', 'Pointillism', 'Black and white, gritty', 'Dreamy glow', 'Vintage 90s', 'Golden hour', 'Subject pop', 'Neon outline', 'Cartoon', 'Pencil sketch',
  'VHS tape', 'فيلم قديم دافي', 'ابيض واسود بحبيبات', 'الخلفية مغبشة',
];
const CSS = `
.pfx { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, 1fr); gap: 16px; min-height: 0; }
.pfx-stage { position: relative; display: grid; place-items: center; min-height: 240px; border-radius: 18px; overflow: hidden; background: var(--sp-chip, rgba(127,127,127,.14)); }
.pfx-stage canvas { display: block; max-width: 100%; max-height: min(56vh, 520px); width: auto; height: auto; touch-action: manipulation; }
.pfx-busy { position: absolute; left: 10px; bottom: 10px; padding: 6px 12px; border-radius: 999px; font-size: 12px; background: rgba(0,0,0,.62); color: #fff; pointer-events: none; }
.pfx-busy[hidden] { display: none; }
.pfx-cmp { position: absolute; right: 10px; bottom: 10px; min-height: 40px; padding: 0 14px; border: 0; border-radius: 999px; font: inherit; font-size: 12px; background: rgba(0,0,0,.62); color: #fff; cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: none; }
.pfx-cmp:active { background: var(--sp-solid, #fff); color: var(--sp-on-solid, #000); }
.pfx-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.pfx-honest { margin: 0; font-size: 12px; line-height: 1.45; color: var(--st-dim, #aaa); }
.pfx-text { width: 100%; min-height: 64px; resize: none; box-sizing: border-box; padding: 10px 12px; border-radius: 16px; border: 1px solid var(--st-line-2, rgba(127,127,127,.4)); background: var(--sp-chip, rgba(127,127,127,.14)); color: var(--st-text, inherit); font: inherit; font-size: 16px; line-height: 1.35; }
.pfx-text:focus { outline: 2px solid var(--st-accent, #ffd60a); outline-offset: 1px; }
.pfx-chips { display: flex; flex-wrap: wrap; gap: 6px; max-height: 132px; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.pfx-chip { min-height: 36px; padding: 0 12px; border: 0; border-radius: 999px; font: inherit; font-size: 13px; background: var(--sp-chip, rgba(127,127,127,.16)); color: var(--st-text, inherit); cursor: pointer; white-space: nowrap; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.pfx-chip:hover { background: var(--sp-chip-h, rgba(127,127,127,.26)); }
.pfx-chip:active, .pfx-chip.is-on { background: var(--sp-solid, #fff); color: var(--sp-on-solid, #000); }
.pfx-row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.pfx-row input[type=range] { flex: 1; min-width: 0; height: 40px; accent-color: var(--st-accent, #ffd60a); }
.pfx-row output { width: 44px; text-align: right; font-variant-numeric: tabular-nums; color: var(--st-dim, #aaa); }
.pfx-said { font-size: 12.5px; line-height: 1.5; min-height: 38px; }
.pfx-said b { font-weight: 600; }
.pfx-said .is-miss { color: var(--st-dim, #aaa); }
.pfx-said .is-warn { color: #ffb347; }
@media (max-width: 760px), (max-height: 520px) {
  :root .studio-app .studio-scrim:has(.pfx-dialog), .studio-scrim:has(.pfx-dialog) { padding: 0; place-items: end center; }
  :root .studio-app .studio-dialog.pfx-dialog, .studio-dialog.pfx-dialog { width: 100vw !important; max-width: none; height: 100vh; height: 100dvh; max-height: none; border-radius: 0; display: flex; flex-direction: column; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px); box-sizing: border-box; }
  .pfx-dialog .studio-dialog-body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .pfx { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .pfx-stage { min-height: 150px; }
  .pfx-stage canvas { max-height: 36vh; max-height: 36dvh; }
  .pfx-chips { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; max-height: none; padding-bottom: 4px; scrollbar-width: none; }
  .pfx-chip { min-height: 40px; flex: none; }
  .pfx-dialog .studio-dialog-foot .studio-btn { flex: 1; min-height: 44px; }
}
@media (max-height: 520px) and (min-width: 600px) {
  .pfx { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); }
  .pfx-stage { min-height: 0; align-self: start; }
  .pfx-stage canvas { max-height: calc(100vh - 190px); max-height: calc(100dvh - 190px); }
  .pfx-text { min-height: 48px; }
}`;
let cssDone = false;
function ensureCss() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.setAttribute('data-pfx', ''); s.textContent = CSS; document.head.appendChild(s); }

/**
 * Open the "describe a look" dialog on a picture.
 * @param source  canvas / image / bitmap (never modified)
 * @returns a NEW canvas at the source resolution, or null when cancelled
 */
export async function openPromptFx({ source, title = 'Describe a look', prompt = '' } = {}) {
  if (!source) return null;
  ensureCss();
  const SW = source.naturalWidth || source.videoWidth || source.width, SH = source.naturalHeight || source.videoHeight || source.height;
  const src = mk(SW, SH); src.getContext('2d').drawImage(source, 0, 0, SW, SH);
  const PREV = 640, pk = Math.min(1, PREV / Math.max(SW, SH));
  const small = mk(SW * pk, SH * pk); { const g = small.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, small.width, small.height); }
  const view = h('canvas', { width: small.width, height: small.height, role: 'img', 'aria-label': 'Preview' });
  const vg = view.getContext('2d'); vg.drawImage(small, 0, 0);
  const busyEl = h('div', { class: 'pfx-busy', hidden: true });
  const cmp = h('button', { class: 'pfx-cmp', type: 'button', text: 'Hold to compare' });
  const text = h('textarea', { class: 'pfx-text', rows: 2, maxlength: 240, placeholder: 'e.g. warm film with soft grain, blurred background', 'aria-label': 'Describe the look', dir: 'auto', autocapitalize: 'off', spellcheck: 'false' });
  text.value = prompt;
  const said = h('div', { class: 'pfx-said', 'aria-live': 'polite' });
  const strength = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 85, 'aria-label': 'Strength' });
  const strOut = h('output', { text: '85%' });
  const chips = h('div', { class: 'pfx-chips', role: 'group', 'aria-label': 'Ideas' }, CHIPS.map((c) => h('button', { class: 'pfx-chip', type: 'button', text: c, dir: 'auto', onclick: () => { text.value = c; schedule(0); } })));
  const body = h('div', { class: 'pfx' },
    h('div', { class: 'pfx-stage' }, view, busyEl, cmp),
    h('div', { class: 'pfx-side' },
      h('p', { class: 'pfx-honest', text: 'Runs on your device. It restyles your photo — it does not generate new objects.' }),
      text, chips,
      h('label', { class: 'pfx-row' }, h('span', { text: 'Strength' }), strength, strOut),
      said));

  let recipe = parsePrompt(text.value), result = null, mask, maskTried = false, run = 0, timer = 0, closed = false, comparing = false;
  const styledCache = new Map();
  const paint = () => { vg.clearRect(0, 0, view.width, view.height); vg.drawImage(comparing || !result ? small : result, 0, 0, view.width, view.height); };
  const setBusy = (m) => { busyEl.hidden = !m; busyEl.textContent = m || ''; };
  const describe = (info = {}) => {
    while (said.firstChild) said.removeChild(said.firstChild);
    if (!text.value.trim()) { said.append(h('span', { class: 'is-miss', text: 'Type a look, or tap an idea above.' })); return; }
    if (recipe.understood.length) said.append(h('b', { text: 'Understood: ' }), document.createTextNode(recipe.understood.join(', ') + '. '));
    else said.append(h('span', { class: 'is-warn', text: 'Nothing here matches a look this can make — the photo is unchanged. ' }));
    if (recipe.unknown.length) said.append(h('span', { class: 'is-miss', text: 'Not understood: ' + recipe.unknown.slice(0, 8).join(', ') + '. ' }));
    if (info.noSubject) said.append(h('span', { class: 'is-warn', text: 'No person was found, so the subject effects were skipped. ' }));
    if (info.styleError) said.append(h('span', { class: 'is-warn', text: 'The style model could not run on this device. ' }));
  };
  async function update() {
    const my = ++run;
    recipe = parsePrompt(text.value);
    describe();
    if (recipe.empty) { result = null; paint(); setBusy(''); return; }
    const info = {};
    try {
      setBusy('Working…');
      const onProgress = (f, m) => { if (my === run && !closed) setBusy(m ? (typeof f === 'number' ? `${m} ${Math.round(f * 100)}%` : m) : 'Working…'); };
      if (recipe.needsMask && !maskTried) { onProgress(null, 'Finding the subject…'); await tick(); try { mask = await personMask(small); } catch (e) { mask = null; } maskTried = true; }
      if (my !== run || closed) return;
      let styled;
      if (recipe.style) {
        styled = styledCache.get(recipe.style);
        if (!styled) { styled = await stylize(small, recipe.style, 448, onProgress); styledCache.set(recipe.style, styled); }
      }
      if (my !== run || closed) return;
      const out = await renderRecipe(small, recipe, { strength: +strength.value / 100, mask: recipe.needsMask ? mask : null, styled, info });
      if (my !== run || closed) return;
      result = out; paint(); describe(info);
    } catch (e) {
      if (my === run) { describe({ styleError: !!recipe.style }); toast('The look could not be previewed.', { type: 'error', detail: String(e && e.message || e).slice(0, 160) }); }
    } finally { if (my === run) setBusy(''); }
  }
  function schedule(ms = 380) { clearTimeout(timer); timer = setTimeout(update, ms); }
  text.addEventListener('input', () => schedule());
  strength.addEventListener('input', () => { strOut.textContent = strength.value + '%'; schedule(60); });
  const hold = (on) => (e) => { if (e) e.preventDefault(); comparing = on; paint(); };
  cmp.addEventListener('pointerdown', (e) => { try { cmp.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } hold(true)(e); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) cmp.addEventListener(ev, hold(false));
  cmp.addEventListener('contextmenu', (e) => e.preventDefault());
  describe();
  if (text.value.trim()) schedule(0);

  const choice = await dialog({
    title, body, width: 940, className: 'pfx-dialog',
    buttons: [{ label: 'Cancel', value: null }, { label: 'Apply', value: 'apply', primary: true }],
    onOpen: ({ box }) => { const t = box.querySelector('.pfx-text'); if (t && matchMedia('(pointer: coarse)').matches) setTimeout(() => t.blur(), 0); },
  });
  closed = true; clearTimeout(timer);
  if (choice !== 'apply') return null;
  recipe = parsePrompt(text.value);
  if (recipe.empty) { toast('Nothing to apply — the description did not match a look.', { type: 'warn' }); return null; }
  const t = toast('Applying the look…', { timeout: 0 });
  try {
    await tick();
    const info = {};
    const out = await renderRecipe(src, recipe, { strength: +strength.value / 100, styleSide: matchMedia('(pointer: coarse)').matches ? 560 : 720, info, onProgress: (f, m) => { try { t && t.set && m && t.set(m); } catch (e) { /* ignore */ } } });
    if (info.styleError) toast('The style model could not run, so the painted style was left out.', { type: 'warn' });
    return out;
  } catch (e) {
    toast('The look could not be applied.', { type: 'error', detail: String(e && e.message || e).slice(0, 160) });
    return null;
  } finally { t && t.close && t.close(); }
}
