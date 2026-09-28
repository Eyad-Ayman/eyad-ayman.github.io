// EYAD VIDEO — effects registry. Each effect contributes to the canvas
// filter chain; new effects only need an entry here.

export const EFFECTS = {
  brightness: { label: 'Brightness', group: 'Colour', params: [{ key: 'value', label: 'Brightness', min: -100, max: 100, default: 0, unit: '' }], filter: (p) => `brightness(${Math.max(0, 1 + p.value / 100)})` },
  contrast: { label: 'Contrast', group: 'Colour', params: [{ key: 'value', label: 'Contrast', min: -100, max: 100, default: 0 }], filter: (p) => `contrast(${Math.max(0, 1 + p.value / 100)})` },
  saturation: { label: 'Saturation', group: 'Colour', params: [{ key: 'value', label: 'Saturation', min: -100, max: 200, default: 0 }], filter: (p) => `saturate(${Math.max(0, 1 + p.value / 100)})` },
  exposure: { label: 'Exposure', group: 'Colour', params: [{ key: 'value', label: 'Exposure (stops)', min: -4, max: 4, step: 0.05, default: 0 }], filter: (p) => `brightness(${Math.pow(2, p.value).toFixed(4)})` },
  hue: { label: 'Hue Shift', group: 'Colour', params: [{ key: 'value', label: 'Hue', min: -180, max: 180, default: 0, unit: '°' }], filter: (p) => `hue-rotate(${p.value}deg)` },
  grayscale: { label: 'Black & White', group: 'Colour', params: [{ key: 'value', label: 'Amount', min: 0, max: 100, default: 100, unit: '%' }], filter: (p) => `grayscale(${p.value}%)` },
  sepia: { label: 'Sepia', group: 'Colour', params: [{ key: 'value', label: 'Amount', min: 0, max: 100, default: 80, unit: '%' }], filter: (p) => `sepia(${p.value}%)` },
  invert: { label: 'Invert', group: 'Colour', params: [{ key: 'value', label: 'Amount', min: 0, max: 100, default: 100, unit: '%' }], filter: (p) => `invert(${p.value}%)` },
  blur: { label: 'Gaussian Blur', group: 'Blur', params: [{ key: 'value', label: 'Radius', min: 0, max: 100, step: 0.5, default: 8, unit: 'px' }], filter: (p, scale) => `blur(${(p.value * scale).toFixed(2)}px)` },
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

/** Canvas filter string for a clip (scale = output px per sequence px). */
export function filterFor(clip, scale = 1) {
  const parts = [];
  for (const e of clip.effects || []) {
    if (!e.enabled) continue;
    const def = EFFECTS[e.type];
    if (!def) continue;
    const params = { ...defaultParams(e.type), ...e.params };
    parts.push(def.filter(params, scale));
  }
  return parts.length ? parts.join(' ') : 'none';
}

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
