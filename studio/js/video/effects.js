// EYAD VIDEO — effects registry. Colour effects run in the GPU pipeline
// (gl.js) so they look the same in every browser and in the export; blur and
// glow use the 2D canvas filter where the browser supports it.
import { defaultUniforms, toCbCr } from './gl.js';
import { LOOKS, getLook } from '../core/film.js';

const P = (key, label, min, max, def, unit = '', step = 1) => ({ key, label, min, max, default: def, unit, step });
const hueRGB = (deg) => { const h = ((deg % 360) + 360) % 360 / 60, x = 1 - Math.abs(h % 2 - 1); const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]; return [r, g, b]; };

export const EFFECTS = {
  // ---- Colour (GPU)
  grade: { label: 'Colour Grade (Basic)', group: 'Colour', params: [P('temp', 'Temperature', -100, 100, 0), P('tint', 'Tint', -100, 100, 0), P('exposure', 'Exposure', -4, 4, 0, ' st', 0.05), P('contrast', 'Contrast', -100, 100, 0), P('highlights', 'Highlights', -100, 100, 0), P('shadows', 'Shadows', -100, 100, 0), P('saturation', 'Saturation', -100, 100, 0), P('vibrance', 'Vibrance', -100, 100, 0)],
    gl: (p, u) => { u.temp += p.temp / 100; u.tint += p.tint / 100; u.expo *= Math.pow(2, p.exposure); u.contrast *= 1 + p.contrast / 100; u.high += p.highlights / 100; u.shad += p.shadows / 100; u.sat *= 1 + p.saturation / 100; u.vib += p.vibrance / 100; } },
  wheels: { label: 'Lift / Gamma / Gain', group: 'Colour', params: [P('lift', 'Lift (shadows)', -100, 100, 0), P('liftHue', 'Lift hue', 0, 360, 220, '°'), P('liftSat', 'Lift colour', 0, 100, 0, '%'), P('gamma', 'Gamma (mids)', -100, 100, 0), P('gammaHue', 'Gamma hue', 0, 360, 30, '°'), P('gammaSat', 'Gamma colour', 0, 100, 0, '%'), P('gain', 'Gain (highlights)', -100, 100, 0), P('gainHue', 'Gain hue', 0, 360, 45, '°'), P('gainSat', 'Gain colour', 0, 100, 0, '%')],
    gl: (p, u) => {
      const tintOf = (hue, s) => { const c = hueRGB(hue); const L = (c[0] + c[1] + c[2]) / 3; return c.map((x) => (x - L) * s / 100); };
      const lt = tintOf(p.liftHue, p.liftSat), gt = tintOf(p.gammaHue, p.gammaSat), gn = tintOf(p.gainHue, p.gainSat);
      for (let i = 0; i < 3; i++) { u.lift[i] += p.lift / 400 + lt[i] * 0.15; u.gam[i] *= Math.max(0.1, 1 + p.gamma / 100 + gt[i] * 0.4); u.gain[i] *= Math.max(0, 1 + p.gain / 100 + gn[i] * 0.4); }
    } },
  brightness: { label: 'Brightness', group: 'Colour', params: [P('value', 'Brightness', -100, 100, 0)], gl: (p, u) => { u.bright += p.value / 200; } },
  contrast: { label: 'Contrast', group: 'Colour', params: [P('value', 'Contrast', -100, 100, 0)], gl: (p, u) => { u.contrast *= Math.max(0, 1 + p.value / 100); } },
  saturation: { label: 'Saturation', group: 'Colour', params: [P('value', 'Saturation', -100, 200, 0)], gl: (p, u) => { u.sat *= Math.max(0, 1 + p.value / 100); } },
  exposure: { label: 'Exposure', group: 'Colour', params: [P('value', 'Exposure (stops)', -4, 4, 0, '', 0.05)], gl: (p, u) => { u.expo *= Math.pow(2, p.value); } },
  hue: { label: 'Hue Shift', group: 'Colour', params: [P('value', 'Hue', -180, 180, 0, '°')], gl: (p, u) => { u.hue += p.value * Math.PI / 180; } },
  grayscale: { label: 'Black & White', group: 'Colour', params: [P('value', 'Amount', 0, 100, 100, '%')], gl: (p, u) => { u.gray = Math.min(1, u.gray + p.value / 100); } },
  sepia: { label: 'Sepia', group: 'Colour', params: [P('value', 'Amount', 0, 100, 80, '%')], gl: (p, u) => { u.sepia = Math.min(1, u.sepia + p.value / 100); } },
  tintColor: { label: 'Colour Tint', group: 'Colour', params: [P('hue', 'Tint hue', 0, 360, 30, '°'), P('amount', 'Amount', 0, 100, 35, '%')], gl: (p, u) => { u.tintCol = hueRGB(p.hue).map((x) => 0.5 + x * 0.5); u.tintAmt = Math.min(1, u.tintAmt + p.amount / 100); } },
  invert: { label: 'Invert', group: 'Colour', params: [P('value', 'Amount', 0, 100, 100, '%')], gl: (p, u) => { u.invert = Math.min(1, u.invert + p.value / 100); } },
  // ---- Stylize (GPU)
  vignette: { label: 'Vignette', group: 'Stylize', params: [P('amount', 'Amount', -100, 100, 50), P('mid', 'Midpoint', 0, 100, 45, '%')], gl: (p, u) => { u.vig += p.amount / 100; u.vigMid = p.mid / 100; } },
  grain: { label: 'Film Grain', group: 'Stylize', params: [P('amount', 'Amount', 0, 100, 25)], gl: (p, u) => { u.grain += p.amount / 400; } },
  sharpen: { label: 'Sharpen', group: 'Stylize', params: [P('amount', 'Amount', 0, 300, 60, '%')], gl: (p, u) => { u.sharp += p.amount / 100; } },
  // ---- Keying (GPU)
  chromaKey: { label: 'Chroma Key (green / blue screen)', group: 'Keying', params: [P('hue', 'Key colour hue', 0, 360, 120, '°'), P('tolerance', 'Tolerance', 0, 100, 30), P('softness', 'Edge softness', 0, 100, 20), P('spill', 'Spill suppression', 0, 100, 60, '%')],
    gl: (p, u) => { const c = hueRGB(p.hue); u.keyOn = 1; u.keyCbCr = toCbCr(c[0] * 0.8, c[1] * 0.8, c[2] * 0.8); u.keyTol = p.tolerance / 250; u.keySoft = p.softness / 400; u.spill = p.spill / 100; } },
  // ---- Blur & light (2D canvas filter)
  blur: { label: 'Gaussian Blur', group: 'Blur & Light', params: [P('value', 'Radius', 0, 100, 8, 'px', 0.5)], filter: (p, scale) => `blur(${(p.value * scale).toFixed(2)}px)` },
  glow: { label: 'Glow', group: 'Blur & Light', params: [P('amount', 'Amount', 0, 100, 45, '%'), P('radius', 'Radius', 1, 80, 18, 'px')], glow: true },
  // ---- Film & grades (the same 136 looks as Film Lab / EYAD CAMERA)
  film: { label: 'Film Look (136 film, camera & LUT grades)', group: 'Film & Grades', params: [P('look', 'Look', 1, LOOKS.length, (LOOKS.find((l) => l.id === 'portrait-400') || LOOKS[0]).code), P('strength', 'Strength', 0, 100, 100, '%')], film: true,
    options: { look: () => LOOKS.filter((l) => l.code <= LOOKS.length).map((l) => [l.code, l.name]) } },
  // ---- AI
  bgRemove: { label: 'Remove Background (people, AI)', group: 'AI', params: [P('feather', 'Edge softness', 0, 100, 40), P('threshold', 'Threshold', 5, 95, 50, '%')], ai: true },
};

export const INTRINSIC = [
  { key: 'transform', label: 'Transform (Motion)' },
  { key: 'opacity', label: 'Opacity' },
  { key: 'crop', label: 'Crop' },
  { key: 'speed', label: 'Speed' },
  { key: 'fades', label: 'Fade In / Fade Out' },
  { key: 'audio', label: 'Volume & Gain' },
];

export function defaultParams(type) {
  const def = EFFECTS[type];
  const o = {};
  if (def) for (const p of def.params) o[p.key] = p.default;
  return o;
}

/**
 * Everything the renderer needs for a clip's effects at one moment.
 * fxOverride: animated parameter values { [effectId]: { param: value } }.
 */
export function effectState(clip, fxOverride = {}, scale = 1) {
  const u = defaultUniforms();
  let needsGL = false, glow = null, ai = null, film = null;
  const filters = [];
  for (const e of clip.effects || []) {
    if (!e.enabled) continue;
    const def = EFFECTS[e.type];
    if (!def) continue;
    const params = { ...defaultParams(e.type), ...e.params, ...(fxOverride[e.id] || {}) };
    if (def.gl) { def.gl(params, u); needsGL = true; }
    if (def.filter) filters.push(def.filter(params, scale));
    if (def.glow) glow = { amount: params.amount / 100, radius: params.radius * scale };
    if (def.ai) ai = params;
    if (def.film) film = { key: e.id, code: Math.round(params.look), strength: params.strength };
  }
  return { needsGL, u, filter: filters.length ? filters.join(' ') : 'none', glow, ai, film };
}

/** Back-compat: CSS filter string for simple renderers. */
export function filterFor(clip, scale = 1) { return effectState(clip, {}, scale).filter; }

let filterSupport = null;
export function canvasFilterSupported() {
  if (filterSupport !== null) return filterSupport;
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.filter = 'blur(2px)';
    filterSupport = c.filter === 'blur(2px)';
  } catch (e) { filterSupport = false; }
  return filterSupport;
}

// ------------------------------------------------------------------ transitions

export const TRANSITIONS = {
  dissolve: { label: 'Cross Dissolve', group: 'Dissolve' },
  dipBlack: { label: 'Dip to Black', group: 'Dissolve' },
  dipWhite: { label: 'Dip to White', group: 'Dissolve' },
  filmDissolve: { label: 'Film Dissolve', group: 'Dissolve' },
  wipeLeft: { label: 'Wipe ←', group: 'Wipe' },
  wipeRight: { label: 'Wipe →', group: 'Wipe' },
  wipeUp: { label: 'Wipe ↑', group: 'Wipe' },
  pushLeft: { label: 'Push ←', group: 'Slide' },
  pushRight: { label: 'Push →', group: 'Slide' },
  slideUp: { label: 'Slide ↑', group: 'Slide' },
  zoomIn: { label: 'Zoom In', group: 'Zoom' },
  zoomOut: { label: 'Zoom Out', group: 'Zoom' },
  blurT: { label: 'Blur', group: 'Blur' },
  irisRound: { label: 'Iris Round', group: 'Iris' },
};
/** Cross-fading types keep the outgoing clip visible underneath the incoming one. */
export const CROSS = new Set(['dissolve', 'filmDissolve', 'wipeLeft', 'wipeRight', 'wipeUp', 'pushLeft', 'pushRight', 'slideUp', 'zoomIn', 'blurT', 'irisRound']);
