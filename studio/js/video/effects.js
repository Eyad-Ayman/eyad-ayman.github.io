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
  // ---- Stylize & retro (GPU; animated ones run on sequence time, so export matches preview)
  vhs: { label: 'VHS / Camcorder', group: 'Retro & lo-fi', params: [P('amount', 'Amount', 0, 100, 70, '%'), P('bleed', 'Colour boost', -50, 50, 15)], gl: (p, u) => { const a = p.amount / 100; u.vhs = Math.max(u.vhs, a); u.sat *= 1 + p.bleed / 100; u.contrast *= 1 - 0.08 * a; u.grain += 0.05 * a; } },
  oldFilm: { label: 'Old Film (flicker, scratches)', group: 'Retro & lo-fi', params: [P('amount', 'Wear', 0, 100, 80, '%'), P('sepia', 'Sepia', 0, 100, 70, '%')], gl: (p, u) => { const a = p.amount / 100; u.oldFilm = Math.max(u.oldFilm, a); u.sepia = Math.min(1, u.sepia + p.sepia / 100); u.grain += 0.09 * a; u.vig += 0.4 * a; u.contrast *= 1 + 0.1 * a; } },
  lofi: { label: 'Low Quality / Lo-fi', group: 'Retro & lo-fi', params: [P('res', 'Resolution loss', 0, 100, 50, '%'), P('blocks', 'Compression blocks', 0, 100, 70, '%'), P('depth', 'Colour levels', 2, 32, 12)], gl: (p, u) => { if (p.res > 0) u.pix = Math.max(u.pix, (1 + p.res * 0.09) / 540); u.blocky = Math.max(u.blocky, p.blocks / 100); u.poster = Math.max(1, Math.round(p.depth) - 1); u.dither = Math.max(u.dither, 0.6); } },
  dither: { label: 'Dither (retro pixels)', group: 'Retro & lo-fi', params: [P('levels', 'Colour levels', 2, 16, 3), P('size', 'Pixel size', 1, 60, 5, 'px')], gl: (p, u) => { u.poster = Math.max(1, Math.round(p.levels) - 1); u.dither = 1; u.pix = Math.max(u.pix, p.size / 1080); } },
  scanlines: { label: 'Scanlines / CRT', group: 'Retro & lo-fi', params: [P('amount', 'Line strength', 0, 100, 40, '%'), P('lines', 'Lines', 60, 1080, 240), P('curve', 'Screen curve', 0, 100, 30, '%')], gl: (p, u) => { u.scan = Math.max(u.scan, p.amount / 100); u.scanN = p.lines; u.crt = Math.max(u.crt, p.curve / 100); } },
  nightVision: { label: 'Night Vision', group: 'Retro & lo-fi', params: [P('amount', 'Amount', 0, 100, 100, '%'), P('gain', 'Gain', -100, 100, 20)], gl: (p, u) => { const a = p.amount / 100; u.nv = Math.max(u.nv, a); u.expo *= Math.pow(2, p.gain / 100); u.vig += 0.55 * a; u.grain += 0.05 * a; } },
  rgbSplit: { label: 'RGB Split (chromatic aberration)', group: 'Stylize', params: [P('amount', 'Amount', 0, 100, 30, '%'), P('angle', 'Angle', 0, 360, 0, '°')], gl: (p, u) => { u.split += p.amount / 100 * 0.03; u.splitAng = p.angle * Math.PI / 180; } },
  glitch: { label: 'Glitch (animated)', group: 'Stylize', params: [P('amount', 'Amount', 0, 100, 50, '%')], gl: (p, u) => { u.glitch = Math.max(u.glitch, p.amount / 100); } },
  pixelate: { label: 'Pixelate / Mosaic', group: 'Stylize', params: [P('size', 'Block size', 2, 200, 24, 'px')], gl: (p, u) => { u.pix = Math.max(u.pix, p.size / 1080); } },
  posterize: { label: 'Posterize', group: 'Stylize', params: [P('levels', 'Levels', 2, 32, 5)], gl: (p, u) => { u.poster = Math.max(1, Math.round(p.levels) - 1); } },
  halftone: { label: 'Halftone (print dots)', group: 'Stylize', params: [P('amount', 'Amount', 0, 100, 100, '%'), P('size', 'Dot size', 4, 80, 14, 'px')], gl: (p, u) => { u.htone = Math.max(u.htone, p.amount / 100); u.halfSize = p.size / 1080; } },
  duotone: { label: 'Duotone', group: 'Stylize', params: [P('shadow', 'Shadow hue', 0, 360, 250, '°'), P('light', 'Highlight hue', 0, 360, 40, '°'), P('amount', 'Amount', 0, 100, 100, '%')], gl: (p, u) => { u.duoA = hueRGB(p.shadow).map((x) => x * 0.28); u.duoB = hueRGB(p.light).map((x) => 0.5 + x * 0.5); u.duoAmt = Math.min(1, u.duoAmt + p.amount / 100); } },
  mirror: { label: 'Mirror / Kaleidoscope', group: 'Stylize', params: [P('mode', 'Mode', 1, 6, 1)], gl: (p, u) => { u.mirror = Math.round(p.mode); },
    options: { mode: () => [[1, 'Horizontal — left side'], [2, 'Horizontal — right side'], [3, 'Vertical — top'], [4, 'Vertical — bottom'], [5, 'Four-way'], [6, 'Kaleidoscope']] } },
  lightLeak: { label: 'Light Leak', group: 'Blur & Light', params: [P('amount', 'Amount', 0, 100, 60, '%'), P('hue', 'Colour hue', 0, 360, 25, '°')], gl: (p, u) => { u.leak = Math.min(1.5, u.leak + p.amount / 100); u.leakHue = (p.hue % 360) / 360; } },
  bloom: { label: 'Bloom (highlights only)', group: 'Blur & Light', params: [P('amount', 'Amount', 0, 100, 60, '%'), P('threshold', 'Threshold', 0, 95, 60, '%'), P('radius', 'Radius', 1, 100, 30)], gl: (p, u) => { u.bloom = Math.max(u.bloom, p.amount / 100); u.bloomThr = p.threshold / 100; u.bloomRad = p.radius / 1000; } },
  // ---- Keying (GPU)
  chromaKey: { label: 'Chroma Key (green / blue screen)', group: 'Keying', params: [P('hue', 'Key colour hue', 0, 360, 120, '°'), P('tolerance', 'Tolerance', 0, 100, 30), P('softness', 'Edge softness', 0, 100, 20), P('spill', 'Spill suppression', 0, 100, 60, '%')],
    gl: (p, u) => { const c = hueRGB(p.hue); u.keyOn = 1; u.keyCbCr = toCbCr(c[0] * 0.8, c[1] * 0.8, c[2] * 0.8); u.keyTol = p.tolerance / 250; u.keySoft = p.softness / 400; u.spill = p.spill / 100; } },
  // ---- Blur & light (2D canvas filter)
  blur: { label: 'Gaussian Blur', group: 'Blur & Light', params: [P('value', 'Radius', 0, 100, 8, 'px', 0.5)], filter: (p, scale) => `blur(${(p.value * scale).toFixed(2)}px)` },
  glow: { label: 'Glow', group: 'Blur & Light', params: [P('amount', 'Amount', 0, 100, 45, '%'), P('radius', 'Radius', 1, 80, 18, 'px')], glow: true },
  // ---- Film & grades (the same 136 looks as Film Lab / EYAD KAMERA)
  film: { label: 'Film Look (136 film, camera & LUT grades)', group: 'Film & Grades', params: [P('look', 'Look', 1, LOOKS.length, (LOOKS.find((l) => l.id === 'portrait-400') || LOOKS[0]).code), P('strength', 'Strength', 0, 100, 100, '%')], film: true,
    options: { look: () => LOOKS.filter((l) => l.code <= LOOKS.length).map((l) => [l.code, l.name]) } },
  // ---- AI
  // Auto mask: one people-segmentation model, six ways to use the mask. The key
  // stays `bgRemove` so projects saved before the modes existed still load (mode 0).
  bgRemove: { label: 'Auto Mask (AI people)', group: 'AI', ai: true,
    params: [P('mode', 'Mode', 0, 5, 0), P('feather', 'Edge softness', 0, 100, 40), P('threshold', 'Threshold', 5, 95, 50, '%'), P('amount', 'Blur / outline size', 0, 100, 40), P('hue', 'Colour hue', 0, 360, 140, '°'), P('light', 'Colour lightness', 0, 100, 50, '%')],
    options: { mode: () => MASK_MODES.map((m, i) => [i, m]) } },
};

export const MASK_MODES = ['Remove background', 'Blur background', 'Background colour', 'Black & white background (colour pop)', 'Keep background only', 'Outline / sticker stroke'];

/**
 * Ready looks: one click adds a tuned stack of effects. Effects added by a look
 * are tagged (effect.look) so choosing another look swaps them instead of piling up.
 */
export const LOOK_PRESETS = {
  y2k: { label: 'Y2K camcorder', fx: [['vhs', { amount: 55, bleed: 20 }], ['lofi', { res: 30, blocks: 55, depth: 20 }], ['grade', { temp: 8, contrast: -8, saturation: 12 }], ['vignette', { amount: 25, mid: 50 }]] },
  vhsTape: { label: 'VHS tape', fx: [['vhs', { amount: 90, bleed: 5 }], ['scanlines', { amount: 22, lines: 240, curve: 18 }], ['rgbSplit', { amount: 14, angle: 0 }]] },
  nightCam: { label: 'Night cam', fx: [['nightVision', { amount: 100, gain: 30 }], ['scanlines', { amount: 18, lines: 360, curve: 0 }], ['lofi', { res: 15, blocks: 30, depth: 24 }]] },
  cleanPop: { label: 'Clean pop', fx: [['grade', { contrast: 18, saturation: 22, vibrance: 25, shadows: 8, highlights: -8 }], ['sharpen', { amount: 50 }]] },
  moodyTeal: { label: 'Moody teal', fx: [['wheels', { lift: -4, liftHue: 190, liftSat: 38, gainHue: 35, gainSat: 26 }], ['grade', { contrast: 16, saturation: -14 }], ['vignette', { amount: 40, mid: 40 }]] },
  bwFilm: { label: 'B&W film', fx: [['grayscale', { value: 100 }], ['grade', { contrast: 26, shadows: -10 }], ['grain', { amount: 38 }], ['vignette', { amount: 35, mid: 45 }]] },
  dreamGlow: { label: 'Dream glow', fx: [['bloom', { amount: 75, threshold: 50, radius: 45 }], ['grade', { exposure: 0.15, contrast: -10, saturation: 10 }], ['lightLeak', { amount: 28, hue: 30 }]] },
  goldenHour: { label: 'Golden hour', fx: [['grade', { temp: 38, tint: 6, contrast: 8, vibrance: 20 }], ['lightLeak', { amount: 40, hue: 28 }], ['vignette', { amount: 22, mid: 55 }]] },
  oldCinema: { label: 'Old cinema', fx: [['oldFilm', { amount: 85, sepia: 75 }]] },
  cyber: { label: 'Cyber glitch', fx: [['glitch', { amount: 35 }], ['rgbSplit', { amount: 40, angle: 0 }], ['duotone', { shadow: 265, light: 180, amount: 55 }]] },
  comic: { label: 'Comic print', fx: [['grade', { contrast: 25, saturation: 30 }], ['posterize', { levels: 5 }], ['halftone', { amount: 70, size: 10 }]] },
  gameBoy: { label: 'Retro handheld', fx: [['dither', { levels: 4, size: 6 }], ['duotone', { shadow: 110, light: 75, amount: 100 }]] },
  cctv: { label: 'Security cam', fx: [['grayscale', { value: 100 }], ['lofi', { res: 45, blocks: 80, depth: 14 }], ['scanlines', { amount: 30, lines: 300, curve: 12 }], ['vignette', { amount: 30, mid: 50 }]] },
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
  return { needsGL, u, any: needsGL || !!glow || !!ai || !!film || filters.length > 0, filter: filters.length ? filters.join(' ') : 'none', glow, ai, film };
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
  // ---- ready-to-use extras
  lumaFade: { label: 'Luma Fade', group: 'Dissolve' },
  flash: { label: 'Flash', group: 'Dissolve' },
  leakBurn: { label: 'Light Leak Burn', group: 'Dissolve' },
  wipeDown: { label: 'Wipe ↓', group: 'Wipe' },
  softWipeRight: { label: 'Soft Wipe →', group: 'Wipe' },
  softWipeLeft: { label: 'Soft Wipe ←', group: 'Wipe' },
  softWipeDown: { label: 'Soft Wipe ↓', group: 'Wipe' },
  pushUp: { label: 'Push ↑', group: 'Slide' },
  pushDown: { label: 'Push ↓', group: 'Slide' },
  slideDown: { label: 'Slide ↓', group: 'Slide' },
  slideLeft: { label: 'Slide ←', group: 'Slide' },
  slideRight: { label: 'Slide →', group: 'Slide' },
  squeeze: { label: 'Cube Squeeze', group: 'Slide' },
  whipLeft: { label: 'Whip Pan ←', group: 'Motion' },
  whipRight: { label: 'Whip Pan →', group: 'Motion' },
  spin: { label: 'Spin', group: 'Motion' },
  zoomBlur: { label: 'Zoom Blur', group: 'Motion' },
  glitchCut: { label: 'Glitch Cut', group: 'Stylize' },
  pixelT: { label: 'Pixelate', group: 'Stylize' },
  circleOpen: { label: 'Circle Open (soft)', group: 'Iris' },
  circleClose: { label: 'Circle Close', group: 'Iris' },
};
/** Cross-fading types keep the outgoing clip visible underneath the incoming one. */
export const CROSS = new Set(['dissolve', 'filmDissolve', 'wipeLeft', 'wipeRight', 'wipeUp', 'pushLeft', 'pushRight', 'slideUp', 'zoomIn', 'blurT', 'irisRound',
  'lumaFade', 'leakBurn', 'wipeDown', 'softWipeRight', 'softWipeLeft', 'softWipeDown', 'pushUp', 'pushDown', 'slideDown', 'slideLeft', 'slideRight', 'squeeze', 'whipLeft', 'whipRight', 'spin', 'zoomBlur', 'glitchCut', 'pixelT', 'circleOpen', 'circleClose']);
