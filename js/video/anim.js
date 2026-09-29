// EYAD VIDEO — keyframe animation. Any numeric clip property can be animated:
// clip.keys[prop] = [{ t: seconds from clip start, v: value, e: easing }].
// Easing applies from a keyframe to the next one.

export const PROPS = {
  x: { label: 'Position X', get: (c) => c.transform.x, set: (c, v) => { c.transform.x = v; }, min: -8000, max: 8000, step: 1, unit: 'px' },
  y: { label: 'Position Y', get: (c) => c.transform.y, set: (c, v) => { c.transform.y = v; }, min: -8000, max: 8000, step: 1, unit: 'px' },
  scale: { label: 'Scale', get: (c) => c.transform.scale, set: (c, v) => { c.transform.scale = v; }, min: 0, max: 2000, step: 1, unit: '%' },
  rotation: { label: 'Rotation', get: (c) => c.transform.rotation, set: (c, v) => { c.transform.rotation = v; }, min: -3600, max: 3600, step: 1, unit: '°' },
  ax: { label: 'Anchor X', get: (c) => c.transform.ax || 0, set: (c, v) => { c.transform.ax = v; }, min: -8000, max: 8000, step: 1, unit: 'px' },
  ay: { label: 'Anchor Y', get: (c) => c.transform.ay || 0, set: (c, v) => { c.transform.ay = v; }, min: -8000, max: 8000, step: 1, unit: 'px' },
  opacity: { label: 'Opacity', get: (c) => c.transform.opacity, set: (c, v) => { c.transform.opacity = v; }, min: 0, max: 100, step: 1, unit: '%' },
  cropL: { label: 'Crop left', get: (c) => c.crop.l, set: (c, v) => { c.crop.l = v; }, min: 0, max: 100, step: 0.5, unit: '%' },
  cropT: { label: 'Crop top', get: (c) => c.crop.t, set: (c, v) => { c.crop.t = v; }, min: 0, max: 100, step: 0.5, unit: '%' },
  cropR: { label: 'Crop right', get: (c) => c.crop.r, set: (c, v) => { c.crop.r = v; }, min: 0, max: 100, step: 0.5, unit: '%' },
  cropB: { label: 'Crop bottom', get: (c) => c.crop.b, set: (c, v) => { c.crop.b = v; }, min: 0, max: 100, step: 0.5, unit: '%' },
  blur: { label: 'Blur', get: (c) => c.anim?.blur || 0, set: (c, v) => { (c.anim = c.anim || {}).blur = v; }, min: 0, max: 100, step: 0.5, unit: 'px' },
  volume: { label: 'Volume', get: (c) => c.volume, set: (c, v) => { c.volume = v; }, min: -60, max: 24, step: 0.5, unit: 'dB' },
  // titles
  reveal: { label: 'Type on', get: (c) => c.gen?.reveal ?? 100, set: (c, v) => { if (c.gen) c.gen.reveal = v; }, min: 0, max: 100, step: 1, unit: '%' },
  tracking: { label: 'Tracking', get: (c) => c.gen?.tracking ?? 0, set: (c, v) => { if (c.gen) c.gen.tracking = v; }, min: -200, max: 2000, step: 1, unit: '' },
};

export const EASINGS = [['linear', 'Linear'], ['in', 'Ease In'], ['out', 'Ease Out'], ['inout', 'Ease In/Out'], ['smooth', 'Bezier (smooth)'], ['back', 'Overshoot'], ['hold', 'Hold']];
const EASE = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inout: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  smooth: (t) => bezier(0.25, 0.1, 0.25, 1, t),
  back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  hold: () => 0,
};
function bezier(x1, y1, x2, y2, x) {
  // solve cubic-bezier(x1,y1,x2,y2) for y at x (Newton iterations)
  let t = x;
  for (let i = 0; i < 6; i++) {
    const cx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3 - x;
    const dx = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
    if (Math.abs(dx) < 1e-6) break;
    t -= cx / dx; t = Math.max(0, Math.min(1, t));
  }
  return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
}

export function hasKeys(c, prop) { return !!(c.keys && c.keys[prop] && c.keys[prop].length); }

/** Interpolated value of `prop` at clip-local time `lt` (falls back to the static value). */
export function valueAt(c, prop, lt, base) {
  const ks = c.keys && c.keys[prop];
  if (!ks || !ks.length) return base;
  if (lt <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (lt >= last.t) return last.v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (lt >= a.t && lt <= b.t) {
      const u = (lt - a.t) / Math.max(1e-6, b.t - a.t);
      const f = (EASE[a.e] || EASE.linear)(u);
      return a.v + (b.v - a.v) * f;
    }
  }
  return base;
}

/** All animated values of a clip at sequence time t. */
export function resolve(c, t) {
  const lt = t - c.start;
  const out = {};
  for (const [k, def] of Object.entries(PROPS)) out[k] = valueAt(c, k, lt, def.get(c));
  // effect parameters: keys['fx:<effectId>:<param>']
  out.fx = {};
  if (c.keys) for (const k of Object.keys(c.keys)) {
    if (!k.startsWith('fx:')) continue;
    const [, id, p] = k.split(':');
    const e = (c.effects || []).find((x) => x.id === id);
    if (e) (out.fx[id] = out.fx[id] || {})[p] = valueAt(c, k, lt, e.params[p]);
  }
  return out;
}

/** Add/replace a keyframe at clip-local time lt. */
export function setKey(c, prop, lt, v, e = 'smooth') {
  c.keys = c.keys || {};
  const ks = (c.keys[prop] = c.keys[prop] || []);
  const near = ks.find((k) => Math.abs(k.t - lt) < 1 / 120);
  if (near) near.v = v; else ks.push({ t: lt, v, e });
  ks.sort((a, b) => a.t - b.t);
}
export function removeKeyAt(c, prop, lt) {
  const ks = c.keys && c.keys[prop]; if (!ks) return;
  const i = ks.findIndex((k) => Math.abs(k.t - lt) < 1 / 60);
  if (i >= 0) ks.splice(i, 1);
  if (!ks.length) delete c.keys[prop];
}
export function keyTimes(c) {
  const set = new Set();
  if (c.keys) for (const ks of Object.values(c.keys)) for (const k of ks) set.add(Math.round(k.t * 1000) / 1000);
  return [...set].sort((a, b) => a - b);
}

// ------------------------------------------------------------------ presets

/** Animation presets (Titles and any clip). dur = clip duration (s). */
export const PRESETS = {
  fadeIn: { label: 'Fade In', group: 'In', apply: (c, d) => keys(c, 'opacity', [[0, 0, 'out'], [Math.min(0.6, d / 3), c.transform.opacity]]) },
  fadeOut: { label: 'Fade Out', group: 'Out', apply: (c, d) => keys(c, 'opacity', [[Math.max(0, d - Math.min(0.6, d / 3)), c.transform.opacity, 'in'], [d, 0]]) },
  slideLeft: { label: 'Slide In ←', group: 'In', apply: (c, d, s) => keys(c, 'x', [[0, c.transform.x + s.width * 0.6, 'smooth'], [Math.min(0.8, d / 2), c.transform.x]]) },
  slideRight: { label: 'Slide In →', group: 'In', apply: (c, d, s) => keys(c, 'x', [[0, c.transform.x - s.width * 0.6, 'smooth'], [Math.min(0.8, d / 2), c.transform.x]]) },
  slideUp: { label: 'Slide Up', group: 'In', apply: (c, d, s) => { keys(c, 'y', [[0, c.transform.y + s.height * 0.25, 'smooth'], [Math.min(0.7, d / 2), c.transform.y]]); keys(c, 'opacity', [[0, 0, 'out'], [Math.min(0.4, d / 3), c.transform.opacity]]); } },
  popIn: { label: 'Scale Pop', group: 'In', apply: (c, d) => keys(c, 'scale', [[0, 0, 'back'], [Math.min(0.6, d / 2), c.transform.scale]]) },
  zoomOut: { label: 'Scale Out', group: 'Out', apply: (c, d) => { keys(c, 'scale', [[Math.max(0, d - 0.6), c.transform.scale, 'in'], [d, 0]]); } },
  blurIn: { label: 'Blur In', group: 'In', apply: (c, d) => { keys(c, 'blur', [[0, 24, 'out'], [Math.min(0.7, d / 2), 0]]); keys(c, 'opacity', [[0, 0, 'out'], [Math.min(0.5, d / 3), c.transform.opacity]]); } },
  blurOut: { label: 'Blur Out', group: 'Out', apply: (c, d) => { keys(c, 'blur', [[Math.max(0, d - 0.7), 0, 'in'], [d, 24]]); keys(c, 'opacity', [[Math.max(0, d - 0.5), c.transform.opacity, 'in'], [d, 0]]); } },
  typeOn: { label: 'Type On', group: 'Text', text: true, apply: (c, d) => keys(c, 'reveal', [[0, 0, 'linear'], [Math.min(d * 0.6, Math.max(0.6, (c.gen?.text || '').length * 0.05)), 100]]) },
  trackingIn: { label: 'Tracking In', group: 'Text', text: true, apply: (c, d) => { keys(c, 'tracking', [[0, 600, 'out'], [Math.min(1.2, d / 2), c.gen?.tracking || 0]]); keys(c, 'opacity', [[0, 0, 'out'], [Math.min(0.5, d / 3), c.transform.opacity]]); } },
  kenBurns: { label: 'Ken Burns (slow zoom)', group: 'Motion', apply: (c, d) => keys(c, 'scale', [[0, c.transform.scale, 'linear'], [d, c.transform.scale * 1.15]]) },
  spinIn: { label: 'Spin In', group: 'In', apply: (c, d) => { keys(c, 'rotation', [[0, c.transform.rotation - 180, 'out'], [Math.min(0.8, d / 2), c.transform.rotation]]); keys(c, 'scale', [[0, 0, 'out'], [Math.min(0.8, d / 2), c.transform.scale]]); } },
};
function keys(c, prop, list) {
  c.keys = c.keys || {};
  const existing = (c.keys[prop] || []).filter((k) => !list.some(([t]) => Math.abs(k.t - t) < 0.05));
  c.keys[prop] = [...existing, ...list.map(([t, v, e]) => ({ t: Math.max(0, t), v, e: e || 'smooth' }))].sort((a, b) => a.t - b.t);
}

// ------------------------------------------------------------------ validation

export function sanitizeKeys(o) {
  const out = {};
  if (!o || typeof o !== 'object') return undefined;
  for (const [k, list] of Object.entries(o).slice(0, 80)) {
    if (!(k in PROPS) && !/^fx:[\w-]{1,64}:[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(k)) continue;
    if (!Array.isArray(list)) continue;
    const ks = list.slice(0, 2000).filter((x) => x && Number.isFinite(x.t) && Number.isFinite(x.v)).map((x) => ({ t: Math.max(0, Math.min(1e6, x.t)), v: Math.max(-1e6, Math.min(1e6, x.v)), e: EASINGS.some(([e]) => e === x.e) ? x.e : 'linear' }));
    if (ks.length) out[k] = ks.sort((a, b) => a.t - b.t);
  }
  return Object.keys(out).length ? out : undefined;
}
