// EYAD STUDIO — Film Lab look engine.
// Applies film / camera "looks" to images and video frames:
//   exposure, white balance, LUT stage, channel crossover, mono conversion,
//   contrast, per-look RGB tone curve (256×1 texture), highlight roll-off,
//   fade, split toning, halation, bloom, CCD artefacts, light leaks, vignette,
//   dust & scratches, grain, chromatic aberration, softness, sharpening, tape
//   scanlines — then optional frames (instant, 35 mm, digicam, panorama) and an
//   orange segmented date stamp drawn with canvas 2D.
// GPU path: WebGL1 fragment shader, processed in tiles (≤2048 px + overlap)
// with global-coordinate uniforms so grain, vignette, leaks and dust stay
// continuous across tiles. Glow (halation / bloom) is computed once per image
// at low resolution and sampled in content coordinates. CPU fallback runs the
// same maths in JavaScript (without the multi-tap softness blur).

import { sharedGL, cached, createGL, program, texture, target, draw, upload, PRECISION, sourceSize, makeCanvas } from './glutil.js';
import { LUT_GLSL, lutTexture, getBuiltinLut, sampleLut, BUILTIN_LUTS, lutKey } from './lut.js';
import { LOOK_DATA, LOOK_GROUPS as GROUPS } from './film-looks.js';

// ---------------------------------------------------------------- parameters

/** Slider specs for UIs. `group`: basic | colour | texture | optics | effects | frame */
export const LOOK_PARAMS = [
  { key: 'strength', label: 'Strength', min: 0, max: 100, def: 100, group: 'basic' },
  { key: 'exposure', label: 'Exposure', min: -100, max: 100, def: 0, group: 'basic' },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, def: 0, group: 'basic' },
  { key: 'fade', label: 'Fade', min: 0, max: 100, def: 0, group: 'basic' },
  { key: 'highlights', label: 'Highlight roll-off', min: 0, max: 100, def: 0, group: 'basic' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, def: 0, group: 'colour' },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, def: 0, group: 'colour' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, def: 0, group: 'colour' },
  { key: 'shadowHue', label: 'Shadow tone hue', min: 0, max: 360, def: 200, group: 'colour', unit: '°' },
  { key: 'shadowTone', label: 'Shadow tone', min: 0, max: 100, def: 0, group: 'colour' },
  { key: 'highlightHue', label: 'Highlight tone hue', min: 0, max: 360, def: 40, group: 'colour', unit: '°' },
  { key: 'highlightTone', label: 'Highlight tone', min: 0, max: 100, def: 0, group: 'colour' },
  { key: 'lutAmount', label: 'LUT amount', min: 0, max: 100, def: 100, group: 'colour' },
  { key: 'grain', label: 'Grain', min: 0, max: 100, def: 0, group: 'texture' },
  { key: 'grainSize', label: 'Grain size', min: 0, max: 100, def: 35, group: 'texture' },
  { key: 'grainColor', label: 'Grain colour', min: 0, max: 100, def: 20, group: 'texture' },
  { key: 'dust', label: 'Dust & scratches', min: 0, max: 100, def: 0, group: 'texture' },
  { key: 'ccd', label: 'CCD artefacts', min: 0, max: 100, def: 0, group: 'texture' },
  { key: 'scanlines', label: 'Tape lines', min: 0, max: 100, def: 0, group: 'texture' },
  { key: 'halation', label: 'Halation', min: 0, max: 100, def: 0, group: 'optics' },
  { key: 'bloom', label: 'Bloom', min: 0, max: 100, def: 0, group: 'optics' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, def: 0, group: 'optics' },
  { key: 'aberration', label: 'Chromatic aberration', min: 0, max: 100, def: 0, group: 'optics' },
  { key: 'softness', label: 'Softness', min: 0, max: 100, def: 0, group: 'optics' },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100, def: 0, group: 'optics' },
  { key: 'leak', label: 'Light leak', min: 0, max: 100, def: 0, group: 'effects' },
  { key: 'leakHue', label: 'Leak colour', min: 0, max: 360, def: 25, group: 'effects', unit: '°' },
  { key: 'leakPos', label: 'Leak position', min: 0, max: 100, def: 15, group: 'effects' },
];

export const FRAMES = [
  { id: 'none', name: 'No frame' },
  { id: 'instant', name: 'Instant square' },
  { id: 'instantWide', name: 'Instant wide' },
  { id: 'film35', name: '35 mm film strip' },
  { id: 'digicam', name: 'Digicam screen' },
  { id: 'panorama', name: 'Panorama mask' },
];
const FRAME_IDS = new Set(FRAMES.map((f) => f.id));

const BASE = Object.freeze({
  ...Object.fromEntries(LOOK_PARAMS.map((p) => [p.key, p.def])),
  frame: 'none', dateStamp: false, dateText: '', lut: null,
});

// ---------------------------------------------------------------- looks

export const LOOK_GROUPS = GROUPS;

const GRADE_LOOKS = BUILTIN_LUTS.map((g) => ({ id: 'grade-' + g.id, name: g.name, group: 'grades', desc: g.desc, params: { lut: g.id, lutAmount: 100 } }));

/** All looks (presets + built-in grades + anything added with registerLook). */
export const LOOKS = [...LOOK_DATA, ...GRADE_LOOKS].map((l, i) => Object.freeze({ ...l, code: i + 1 }));
const byId = new Map(LOOKS.map((l) => [l.id, l]));
const byCode = new Map(LOOKS.map((l) => [l.code, l]));
let nextCode = 10000;

/** Add a custom look (e.g. from lutToLook). Returns its id. */
export function registerLook(look) {
  if (!look || typeof look !== 'object' || typeof look.id !== 'string') throw new Error('Invalid look.');
  const id = look.id.slice(0, 64);
  const existing = byId.get(id);
  const l = Object.freeze({ ...look, id, name: String(look.name || 'Custom look').slice(0, 60), group: look.group || 'luts', params: { ...(look.params || {}) }, code: existing ? existing.code : nextCode++ });
  if (existing) LOOKS.splice(LOOKS.indexOf(existing), 1, l); else LOOKS.push(l);
  byId.set(id, l); byCode.set(l.code, l);
  return id;
}

export function getLook(idOrLook) {
  if (idOrLook && typeof idOrLook === 'object') return idOrLook;
  return byId.get(idOrLook) || byId.get('clean');
}
export function lookByCode(code) { return byCode.get(Math.round(code)) || null; }

/** Full parameter set for a look (its preset values over the neutral base). */
export function defaultParams(lookId) {
  const l = getLook(lookId);
  return { ...BASE, ...(l ? l.params : {}) };
}

/** Merge user overrides over a look's defaults and validate everything. */
export function resolveParams(lookId, params = {}) {
  const P = { ...defaultParams(lookId) };
  if (params && typeof params === 'object') {
    for (const spec of LOOK_PARAMS) {
      const v = Number(params[spec.key]);
      if (params[spec.key] !== undefined && Number.isFinite(v)) P[spec.key] = v;
    }
    if (typeof params.frame === 'string') P.frame = params.frame;
    if (params.dateStamp !== undefined) P.dateStamp = !!params.dateStamp;
    if (typeof params.dateText === 'string') P.dateText = params.dateText;
    if (params.lut !== undefined) P.lut = params.lut;
  }
  for (const spec of LOOK_PARAMS) P[spec.key] = Math.min(spec.max, Math.max(spec.min, Number(P[spec.key]) || 0));
  if (!FRAME_IDS.has(P.frame)) P.frame = 'none';
  P.dateText = sanitizeDateText(P.dateText);
  return P;
}

/** Default date-stamp text for today, e.g. "'26 9 29". */
export function todayStamp(d = new Date()) {
  return `'${String(d.getFullYear() % 100).padStart(2, '0')} ${d.getMonth() + 1} ${d.getDate()}`;
}
export function sanitizeDateText(s) {
  return String(s || '').replace(/[’‘`]/g, "'").replace(/[^0-9 '.:/-]/g, '').replace(/\s+/g, ' ').slice(0, 16);
}

// ---------------------------------------------------------------- curves

function monotoneCurve(points) {
  const pts = (points && points.length ? points : [[0, 0], [255, 255]]).map(([x, y]) => [Math.min(255, Math.max(0, x)), Math.min(255, Math.max(0, y))]).sort((a, b) => a[0] - b[0]);
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
  if (pts[pts.length - 1][0] < 255) pts.push([255, pts[pts.length - 1][1]]);
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const out = new Float32Array(256);
  let k = 0;
  for (let x = 0; x < 256; x++) {
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k], t = h > 0 ? (x - xs[k]) / h : 0;
    const t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
    out[x] = Math.min(255, Math.max(0, y));
  }
  return out;
}

const curveCache = new WeakMap();
/** 256×1 RGBA table of the look's tone curve (master applied first, then per channel). */
function curveTable(look) {
  let t = curveCache.get(look);
  if (t) return t;
  const c = look.curve || {};
  const M = monotoneCurve(c.m), R = monotoneCurve(c.r), G = monotoneCurve(c.g), B = monotoneCurve(c.b);
  t = new Uint8Array(256 * 4);
  const at = (tab, v) => { const i = Math.min(254, Math.floor(v)), f = v - i; return tab[i] * (1 - f) + tab[i + 1] * f; };
  for (let x = 0; x < 256; x++) {
    const m = M[x];
    t[x * 4] = Math.round(at(R, m)); t[x * 4 + 1] = Math.round(at(G, m)); t[x * 4 + 2] = Math.round(at(B, m)); t[x * 4 + 3] = 255;
  }
  curveCache.set(look, t);
  return t;
}

const lookKeys = new WeakMap();
let lookSeq = 0;
function lookKey(look) { let k = lookKeys.get(look); if (!k) { k = 'L' + (++lookSeq); lookKeys.set(look, k); } return k; }

// ---------------------------------------------------------------- uniforms

const hueRGB = (deg) => {
  const h = (((deg % 360) + 360) % 360) / 60, x = 1 - Math.abs((h % 2) - 1);
  return h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
};
const LUMA = [0.2126, 0.7152, 0.0722];

function resolveLut(v) {
  if (!v) return null;
  if (typeof v === 'string') return getBuiltinLut(v);
  if (typeof v === 'object' && (v.data || v.data1d) && (v.size || v.size1d)) return v;
  return null;
}

/** Everything the shader (and CPU path) needs, derived from look + params + content size. */
function buildUniforms(look, P, cw, ch, frameNo = 0) {
  const S = Math.min(cw, ch);
  const t = P.temperature / 100, m = P.tint / 100;
  let wb = [1 + 0.16 * t + 0.02 * m, 1 - 0.13 * m, 1 - 0.18 * t + 0.02 * m];
  const wl = wb[0] * LUMA[0] + wb[1] * LUMA[1] + wb[2] * LUMA[2];
  wb = wb.map((v) => v / wl);
  const tintVec = (hue, amt, k) => { const c = hueRGB(hue), mean = (c[0] + c[1] + c[2]) / 3; return c.map((v) => (v - mean) * (amt / 100) * k); };
  const roll = P.highlights / 100;
  const knee = 1 - 0.55 * roll;
  const over1 = 0.55 * roll;
  const rollK = roll > 0 ? (0.55 / 0.47 - 1) / Math.max(1e-4, over1) : 0;
  const mat = look.matrix && look.matrix.length === 9 ? look.matrix : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let mono = look.mono || null;
  if (mono) { const s = mono[0] + mono[1] + mono[2]; mono = mono.map((v) => v / (s || 1)); }
  const leakC = hueRGB(P.leakHue).map((v) => 0.2 + 0.8 * v);
  const softMix = Math.min(1, P.softness / 35);
  const lut = resolveLut(P.lut);
  return {
    uContent: [cw, ch],
    uStrength: P.strength / 100,
    uExpo: Math.pow(2, P.exposure / 50),
    uContrast: P.contrast / 100,
    uSat: 1 + P.saturation / 100,
    uFade: (P.fade / 100) * 0.22,
    uFadeCol: look.fadeColor || [1, 0.98, 0.95],
    uRoll: roll, uRollKnee: knee, uRollK: rollK,
    uWB: wb,
    uMatrix: [mat[0], mat[3], mat[6], mat[1], mat[4], mat[7], mat[2], mat[5], mat[8]], // column-major for GLSL
    uMatrixRow: mat,
    uMono: mono ? (look.monoMix == null ? 1 : look.monoMix) : 0,
    uMonoW: mono || LUMA,
    uShadowT: tintVec(P.shadowHue, P.shadowTone, 0.32),
    uHighT: tintVec(P.highlightHue, P.highlightTone, 0.28),
    uHal: (P.halation / 100) * 1.35,
    uHalCol: look.halColor || [1.0, 0.3, 0.1],
    uBloom: (P.bloom / 100) * 0.85,
    uVig: P.vignette / 100,
    uAb: (P.aberration / 100) * S * 0.012,
    uSoftR: S * 0.0045 * (0.35 + 0.65 * P.softness / 100),
    uSoftMix: softMix,
    uEdgeSoft: look.edgeSoft || 0,
    uSharp: (P.sharpen / 100) * 1.6,
    uSharpR: Math.max(0.75, S / 1400),
    uGrain: (P.grain / 100) * 0.24,
    uGrainPx: (0.55 + (P.grainSize / 100) * 2.6) * Math.min(4, Math.max(0.55, S / 1100)),
    uGrainCol: (P.grainColor / 100) * 0.6,
    uLeak: P.leak / 100,
    uLeakAng: (P.leakPos / 100) * Math.PI * 2,
    uLeakCol: leakC,
    uDust: P.dust / 100,
    uDustTone: look.dustTone == null ? 0.85 : look.dustTone,
    uCcd: P.ccd / 100,
    uCcdBlock: Math.max(3, Math.round(S / 130)),
    uScan: P.scanlines / 100,
    uScanPx: Math.max(1, S / 240),
    uSeed: frameNo % 997,
    uDustSeed: Math.floor(frameNo / 3) % 997,
    uLutAmt: lut ? P.lutAmount / 100 : 0,
    lut,
    needGlow: P.halation > 0 || P.bloom > 0,
  };
}

/** Pixels of neighbourhood a tile needs (content px). */
function overlapFor(U) {
  return Math.ceil(Math.max(U.uAb * 1.2, U.uSoftMix > 0 ? U.uSoftR * 1.7 : 0, U.uSharp > 0 ? U.uSharpR * 2 : 0, U.uCcd > 0 ? U.uCcdBlock : 0, U.uScan > 0 ? U.uScanPx * 4 + U.uScan * U.uScanPx * 1.5 : 0)) + 3;
}

// ---------------------------------------------------------------- shaders

const NOISE_GLSL = `
float hash(vec2 p) { p = mod(p, 4096.0); vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
`;

const MAIN_FS = PRECISION + LUT_GLSL + NOISE_GLSL + `
uniform sampler2D uSrc, uCurve, uGlowH, uGlowB;
uniform vec2 uOrigin; uniform float uTileH;
uniform vec2 uContent; uniform vec4 uCrop; uniform vec4 uTex; uniform float uMirror;
uniform float uStrength, uExpo, uContrast, uSat, uFade, uRoll, uRollKnee, uRollK, uMono, uLutAmt;
uniform vec3 uFadeCol, uWB, uMonoW, uShadowT, uHighT, uHalCol, uLeakCol;
uniform mat3 uMatrix;
uniform float uHal, uBloom, uVig, uAb, uSoftR, uSoftMix, uEdgeSoft, uSharp, uSharpR;
uniform float uGrain, uGrainPx, uGrainCol, uLeak, uLeakAng, uDust, uDustTone, uCcd, uCcdBlock, uScan, uScanPx, uSeed, uDustSeed;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec2 toTex(vec2 q) { vec2 u = q / uContent; if (uMirror > 0.5) u.x = 1.0 - u.x; return (uCrop.xy + u * uCrop.zw - uTex.xy) / uTex.zw; }
vec4 S(vec2 q) { return texture2D(uSrc, toTex(q)); }
vec3 chroma(vec3 c) { return c - dot(c, LUMA); }

void main() {
  vec2 p = uOrigin + vec2(gl_FragCoord.x, uTileH - gl_FragCoord.y);
  vec2 uv = p / uContent;
  float Sm = min(uContent.x, uContent.y);
  vec2 d = (p - 0.5 * uContent) / Sm;
  float rr = length(d) / length(0.5 * uContent / Sm);

  vec4 base = S(p);
  vec3 c = base.rgb;
  vec2 pj = p;
  // tape: per-line horizontal jitter + chroma bleed
  if (uScan > 0.0) {
    float line = floor(p.y / uScanPx);
    pj.x += (vnoise(vec2(line * 0.13, uSeed * 1.7)) - 0.5) * uScan * uScanPx * 1.5;
    c = S(pj).rgb;
    vec3 cl = S(pj - vec2(uScanPx * 3.0, 0.0)).rgb, cr = S(pj + vec2(uScanPx * 1.5, 0.0)).rgb;
    c = dot(c, LUMA) + mix(chroma(c), (chroma(cl) + chroma(c) + chroma(cr)) / 3.0, uScan);
  }
  // chromatic aberration (radial)
  if (uAb > 0.0) { vec2 off = d * uAb * rr; c.r = S(pj + off).r; c.b = S(pj - off).b; }
  // softness (optionally stronger toward the edges)
  float soft = uSoftMix * mix(1.0, clamp(smoothstep(0.2, 1.0, rr) * 1.5, 0.0, 1.0), uEdgeSoft);
  if (uEdgeSoft > 0.0 && uSoftMix <= 0.0) soft = 0.0;
  if (soft > 0.0) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      vec2 o = vec2(cos(a), sin(a));
      acc += S(pj + o * uSoftR).rgb;
      acc += S(pj + vec2(o.x * 0.7071 - o.y * 0.7071, o.x * 0.7071 + o.y * 0.7071) * uSoftR * 0.5).rgb;
    }
    c = mix(c, (acc + c * 2.0) / 18.0, soft);
  }
  // sharpen (unsharp mask)
  if (uSharp > 0.0) {
    vec3 n4 = (S(pj + vec2(uSharpR, 0.0)).rgb + S(pj - vec2(uSharpR, 0.0)).rgb + S(pj + vec2(0.0, uSharpR)).rgb + S(pj - vec2(0.0, uSharpR)).rgb) * 0.25;
    c += (c - n4) * uSharp;
  }
  // CCD: JPEG-ish blocky chroma
  if (uCcd > 0.0) {
    vec3 bc = S((floor(p / uCcdBlock) + 0.5) * uCcdBlock).rgb;
    float L0 = dot(c, LUMA);
    c = mix(L0, dot(bc, LUMA), 0.12 * uCcd) + mix(chroma(c), chroma(bc), 0.7 * uCcd);
  }

  // ---- grade
  c = max(c, 0.0);
  c = pow(c, vec3(2.2)) * uExpo;
  c = pow(c, vec3(1.0 / 2.2));
  c *= uWB;
  if (uLutAmt > 0.0) c = mix(c, lut3d(c), uLutAmt);
  c = uMatrix * c;
  c = mix(c, vec3(dot(c, uMonoW)), uMono);
  float L = dot(c, LUMA);
  c = mix(vec3(L), c, uSat);
  c = clamp(c, 0.0, 1.0);
  if (uContrast > 0.0) c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  else c = mix(c, 0.5 + (c - 0.5) * 0.55, -uContrast);
  c = clamp(c, 0.0, 1.0) * 0.99609375 + 0.001953125;
  c = vec3(texture2D(uCurve, vec2(c.r, 0.5)).r, texture2D(uCurve, vec2(c.g, 0.5)).g, texture2D(uCurve, vec2(c.b, 0.5)).b);
  if (uRoll > 0.0) {
    vec3 over = max(c - uRollKnee, 0.0);
    c = c - over + over / (1.0 + over * uRollK);
    float L2 = dot(c, LUMA);
    c = mix(c, vec3(L2), smoothstep(0.7, 1.0, L2) * uRoll * 0.3);
  }
  c = uFadeCol * uFade + c * (1.0 - uFade);
  L = clamp(dot(c, LUMA), 0.0, 1.0);
  c += uShadowT * (1.0 - L) * (1.0 - L) + uHighT * L * L;
  // halation (red glow around highlights) & bloom
  if (uHal > 0.0) c = 1.0 - (1.0 - clamp(c, 0.0, 1.0)) * (1.0 - clamp(texture2D(uGlowH, uv).rgb * uHalCol * uHal, 0.0, 1.0));
  if (uBloom > 0.0) c = 1.0 - (1.0 - clamp(c, 0.0, 1.0)) * (1.0 - clamp(texture2D(uGlowB, uv).rgb * uBloom, 0.0, 1.0));
  // CCD colour: cyan-shifted highlights, posterised tones, noisy shadows
  if (uCcd > 0.0) {
    L = dot(c, LUMA);
    c += vec3(-0.07, 0.012, 0.06) * smoothstep(0.55, 1.0, L) * uCcd;
    float q = mix(64.0, 20.0, uCcd);
    c = mix(c, floor(c * q + 0.5) / q, 0.5 * uCcd);
    vec3 nz = vec3(hash(p + uSeed * 13.0), hash(p + 71.3 + uSeed * 7.0), hash(p + 143.7 + uSeed * 3.0)) - 0.5;
    c += nz * pow(1.0 - clamp(L, 0.0, 1.0), 3.0) * 0.16 * uCcd;
  }
  // light leak
  if (uLeak > 0.0) {
    vec2 hc = 0.5 * uContent / Sm;
    vec2 dir = vec2(cos(uLeakAng), sin(uLeakAng));
    vec2 c1 = dir * hc * 1.05, c2 = vec2(dir.x * 0.8 - dir.y * 0.45, dir.y * 0.8 + dir.x * 0.45) * hc * 0.95;
    float g = exp(-dot(d - c1, d - c1) * 4.0) + 0.55 * exp(-dot(d - c2, d - c2) * 9.0);
    float streak = exp(-pow(dot(d - c1, vec2(-dir.y, dir.x)) * 5.0, 2.0)) * smoothstep(1.2, 0.2, length(d - c1)) * 0.35;
    vec3 lc = uLeakCol * clamp((g + streak) * uLeak * 1.2, 0.0, 1.0);
    c = 1.0 - (1.0 - clamp(c, 0.0, 1.0)) * (1.0 - lc);
  }
  // vignette
  if (uVig > 0.0) c *= 1.0 - uVig * 0.85 * smoothstep(0.32, 1.12, rr);
  // dust specks & hairs
  if (uDust > 0.0) {
    float cell = Sm / 16.0;
    vec2 cp = p / cell, ci = floor(cp), cf = fract(cp);
    if (hash(ci + uDustSeed * 11.0 + 5.0) < uDust * 0.35) {
      vec2 ctr = vec2(hash(ci + 1.7 + uDustSeed), hash(ci + 9.2 + uDustSeed)) * 0.6 + 0.2;
      float hair = step(0.72, hash(ci + 3.3 + uDustSeed));
      float ang = hash(ci + 7.7 + uDustSeed) * 6.2831853;
      vec2 q = cf - ctr;
      vec2 rq = vec2(cos(ang) * q.x + sin(ang) * q.y, -sin(ang) * q.x + cos(ang) * q.y);
      rq.y += rq.x * rq.x * (hash(ci + 2.9) - 0.5) * 6.0 * hair;
      float rad = mix(0.015 + 0.05 * hash(ci + 4.4 + uDustSeed) * hash(ci + 2.2), 0.012, hair);
      float dd = length(vec2(rq.x * mix(1.0, 0.09, hair), rq.y)) / rad;
      float mk = 1.0 - smoothstep(0.55, 1.0, dd);
      float white = step(hash(ci + 8.8 + uDustSeed), uDustTone);
      c = mix(c, vec3(mix(0.06, 0.96, white)), mk * 0.85);
    }
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      if (hash(vec2(fk * 13.1 + 1.0, uDustSeed + 3.0)) < uDust * 0.6) {
        float x = hash(vec2(fk * 7.3 + 1.0, uDustSeed + 9.0)) * uContent.x;
        float w = max(0.8, Sm / 1300.0);
        float dx = abs(p.x - x - (vnoise(vec2(p.y / Sm * 3.0, fk * 4.0 + uDustSeed)) - 0.5) * Sm * 0.02);
        float ln = 1.0 - smoothstep(w * 0.5, w * 1.6, dx);
        float along = smoothstep(0.35, 0.7, vnoise(vec2(p.y / Sm * 4.0 + fk * 5.0, 2.0 + uDustSeed)));
        c = mix(c, vec3(mix(0.1, 0.92, uDustTone)), ln * along * 0.55);
      }
    }
  }
  // grain (midtone-weighted, optional colour)
  if (uGrain > 0.0) {
    vec2 gp = p / uGrainPx + uSeed * 37.0;
    float n = vnoise(gp) * 0.62 + vnoise(gp * 2.17 + 17.0) * 0.38 - 0.5;
    L = clamp(dot(c, LUMA), 0.0, 1.0);
    float w = 0.3 + 2.8 * L * (1.0 - L);
    vec3 gn = vec3(n);
    if (uGrainCol > 0.0) gn += (vec3(vnoise(gp * 1.3 + 91.0), vnoise(gp * 1.3 + 53.0), vnoise(gp * 1.3 + 27.0)) - 0.5) * uGrainCol * (1.0 - uMono);
    c += gn * uGrain * w * 2.0;
  }
  // tape scanlines
  if (uScan > 0.0) c *= 1.0 - uScan * 0.16 * (0.5 + 0.5 * cos(p.y / uScanPx * 3.14159265));
  c = clamp(c, 0.0, 1.0);
  gl_FragColor = vec4(mix(base.rgb, c, uStrength), base.a);
}`;

const DOWN_FS = PRECISION + `
uniform sampler2D uSrc; uniform vec2 uSize; uniform vec4 uCrop; uniform vec4 uTex; uniform float uMirror; uniform float uThr;
vec2 toTex(vec2 u) { if (uMirror > 0.5) u.x = 1.0 - u.x; return (uCrop.xy + u * uCrop.zw - uTex.xy) / uTex.zw; }
void main() {
  vec2 u = gl_FragCoord.xy / uSize; vec2 h = 0.3 / uSize;
  vec3 c = (texture2D(uSrc, toTex(u + vec2(-h.x, -h.y))).rgb + texture2D(uSrc, toTex(u + vec2(h.x, -h.y))).rgb
          + texture2D(uSrc, toTex(u + vec2(-h.x, h.y))).rgb + texture2D(uSrc, toTex(u + vec2(h.x, h.y))).rgb) * 0.25;
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * smoothstep(uThr, min(1.0, uThr + 0.3), L), 1.0);
}`;

const BLUR_FS = PRECISION + `
uniform sampler2D uIn; uniform vec2 uSize; uniform vec2 uDir;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize; vec2 st = uDir / uSize;
  vec3 c = texture2D(uIn, uv).rgb * 0.2270270;
  c += (texture2D(uIn, uv + st).rgb + texture2D(uIn, uv - st).rgb) * 0.1945946;
  c += (texture2D(uIn, uv + st * 2.0).rgb + texture2D(uIn, uv - st * 2.0).rgb) * 0.1216216;
  c += (texture2D(uIn, uv + st * 3.0).rgb + texture2D(uIn, uv - st * 3.0).rgb) * 0.0540540;
  c += (texture2D(uIn, uv + st * 4.0).rgb + texture2D(uIn, uv - st * 4.0).rgb) * 0.0162162;
  gl_FragColor = vec4(c, 1.0);
}`;

function resources(ctx) {
  return cached(ctx, 'film', (gl) => ({
    main: program(gl, MAIN_FS), down: program(gl, DOWN_FS), blur: program(gl, BLUR_FS),
    src: texture(gl), small: texture(gl), black: texture(gl), targets: null, tsize: '',
  }));
}

function setUniforms(gl, U, vals) {
  for (const k in vals) {
    const loc = U[k];
    if (!loc) continue;
    const v = vals[k];
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (Array.isArray(v)) {
      if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
      else if (v.length === 4) gl.uniform4fv(loc, v);
      else if (v.length === 9) gl.uniformMatrix3fv(loc, false, v);
    }
  }
}

function curveTexture(ctx, look) {
  const key = 'curve:' + lookKey(look);
  let t = ctx.cache.get(key);
  if (!t) {
    t = texture(ctx.gl);
    upload(ctx.gl, t, { width: 256, height: 1, data: curveTable(look) });
    ctx.cache.set(key, t);
  }
  return t;
}

/**
 * Halation / bloom textures (low-res, content coordinates).
 * srcTex + map describe where the content lives in the bound source texture.
 */
function runGlow(ctx, R, srcTex, map, gw, gh) {
  const gl = ctx.gl;
  const key = gw + 'x' + gh;
  if (R.tsize !== key) {
    if (R.targets) R.targets.forEach((t) => t.dispose());
    R.targets = [target(gl, gw, gh), target(gl, gw, gh), target(gl, gw, gh), target(gl, gw, gh)];
    R.tsize = key;
  }
  const [A, T, H, B] = R.targets;
  gl.viewport(0, 0, gw, gh);
  // bright pass + downsample
  gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
  R.down.use();
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.uniform1i(R.down.U.uSrc, 0);
  setUniforms(gl, R.down.U, { uSize: [gw, gh], uCrop: map.crop, uTex: map.tex, uMirror: map.mirror ? 1 : 0, uThr: 0.58 });
  draw(gl);
  const k = Math.min(gw, gh) / 180;
  const pass = (from, to, dx, dy) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    setUniforms(gl, R.blur.U, { uSize: [gw, gh], uDir: [dx, dy] });
    draw(gl);
  };
  R.blur.use();
  gl.uniform1i(R.blur.U.uIn, 0);
  pass(A, T, 1.1 * k, 0); pass(T, H, 0, 1.1 * k);          // halation radius ≈ 1.5 %
  pass(H, T, 3.2 * k, 0); pass(T, B, 0, 3.2 * k);          // bloom radius ≈ 5 %
  pass(B, T, 6 * k, 0); pass(T, B, 0, 6 * k);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { h: H.tex, b: B.tex };
}

/** Draw the main pass into the context's canvas (already sized to the tile). */
function runMain(ctx, R, look, U, srcTex, map, tile, glow) {
  const gl = ctx.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, tile.w, tile.h);
  R.main.use();
  const P = R.main;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, curveTexture(ctx, look));
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, glow ? glow.h : R.black);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, glow ? glow.b : R.black);
  let lutDim = [2, 2], lutTex = [4, 2];
  if (U.lut) {
    const L = lutTexture(ctx, U.lut);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, L.tex);
    lutDim = L.dim; lutTex = L.texSize;
  } else { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, R.black); }
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(P.U.uSrc, 0); gl.uniform1i(P.U.uCurve, 1); gl.uniform1i(P.U.uGlowH, 2); gl.uniform1i(P.U.uGlowB, 3); gl.uniform1i(P.U.uLut, 4);
  const { lut, needGlow, uMatrixRow, ...vals } = U;
  setUniforms(gl, P.U, vals);
  setUniforms(gl, P.U, {
    uOrigin: [tile.x, tile.y], uTileH: tile.h, uCrop: map.crop, uTex: map.tex, uMirror: map.mirror ? 1 : 0,
    uLutDim: lutDim, uLutTex: lutTex,
    uHal: glow ? U.uHal : 0, uBloom: glow ? U.uBloom : 0,
  });
  draw(gl);
}

// ---------------------------------------------------------------- layout & frames

function centerCrop(x, y, w, h, aspect) {
  if (!aspect) return { x, y, w, h };
  if (w / h > aspect) { const nw = h * aspect; return { x: x + (w - nw) / 2, y, w: nw, h }; }
  const nh = w / aspect; return { x, y: y + (h - nh) / 2, w, h: nh };
}

function frameAspect(frame, w, h) {
  const land = w >= h;
  switch (frame) {
    case 'instant': return 1;
    case 'instantWide': return land ? 1.6 : 1 / 1.6;
    case 'film35': return land ? 1.5 : 1 / 1.5;
    case 'panorama': return 2.8;
    default: return 0;
  }
}

/** Border sizes around content (px) for a content size. */
function frameBorders(frame, cw, ch) {
  const s = Math.min(cw, ch), land = cw >= ch;
  const R = Math.round;
  switch (frame) {
    case 'instant': return { l: R(s * 0.058), r: R(s * 0.058), t: R(s * 0.068), b: R(s * 0.27) };
    case 'instantWide': return { l: R(s * 0.073), r: R(s * 0.073), t: R(s * 0.097), b: R(s * 0.29) };
    case 'film35': return land ? { l: R(s * 0.07), r: R(s * 0.07), t: R(s * 0.235), b: R(s * 0.235) } : { l: R(s * 0.235), r: R(s * 0.235), t: R(s * 0.07), b: R(s * 0.07) };
    case 'digicam': return { l: R(s * 0.035), r: R(s * 0.035), t: R(s * 0.035), b: R(s * 0.035) };
    case 'panorama': { const hOut = cw / 1.5; const bar = Math.max(0, R((hOut - ch) / 2)); return { l: 0, r: 0, t: bar, b: bar }; }
    default: return { l: 0, r: 0, t: 0, b: 0 };
  }
}

const IS_IOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const MAX_OUTPUT_PIXELS = IS_IOS ? 16_000_000 : 64_000_000;

/**
 * Compute the output geometry.
 * srcW/H: source size; crop: optional source crop {x,y,w,h}; opts.width/height: fit the OUTER size inside.
 */
export function computeLayout(frame, srcW, srcH, { crop, width, height, maxPixels = MAX_OUTPUT_PIXELS } = {}) {
  let c = crop ? { x: Math.max(0, crop.x), y: Math.max(0, crop.y), w: Math.min(crop.w, srcW - Math.max(0, crop.x)), h: Math.min(crop.h, srcH - Math.max(0, crop.y)) } : { x: 0, y: 0, w: srcW, h: srcH };
  c = centerCrop(c.x, c.y, c.w, c.h, frameAspect(frame, c.w, c.h));
  const b1 = frameBorders(frame, c.w, c.h);
  const ow1 = c.w + b1.l + b1.r, oh1 = c.h + b1.t + b1.b;
  let s = 1;
  if (width) s = Math.min(s, width / ow1);
  if (height) s = Math.min(s, height / oh1);
  if (ow1 * oh1 * s * s > maxPixels) s = Math.sqrt(maxPixels / (ow1 * oh1));
  if (!width && !height) s = Math.min(s, 1);
  const cw = Math.max(1, Math.round(c.w * s)), ch = Math.max(1, Math.round(c.h * s));
  const b = frameBorders(frame, cw, ch);
  return { frame, crop: c, cw, ch, rect: { x: b.l, y: b.t, w: cw, h: ch }, outW: cw + b.l + b.r, outH: ch + b.t + b.b, scale: s };
}

// deterministic tiny PRNG for frame textures
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function paperTexture(ctx, x, y, w, h, alpha) {
  const n = makeCanvas(96, 96), g = n.getContext('2d');
  const id = g.createImageData(96, 96), r = rng(7);
  for (let i = 0; i < id.data.length; i += 4) { const v = 110 + r() * 145; id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = ctx.createPattern(n, 'repeat');
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw frame + date stamp over an output canvas whose content is already in place. */
export function drawOverlay(ctx, layout, look, P) {
  const { rect, outW, outH, frame } = layout;
  const s = Math.min(rect.w, rect.h);
  ctx.save();
  if (frame === 'instant' || frame === 'instantWide') {
    ctx.beginPath(); ctx.rect(0, 0, outW, outH); ctx.rect(rect.x, rect.y, rect.w, rect.h);
    const g = ctx.createLinearGradient(0, 0, 0, outH);
    g.addColorStop(0, '#f6f3ec'); g.addColorStop(1, '#ece7dc');
    ctx.fillStyle = g; ctx.fill('evenodd');
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, outW, outH); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip('evenodd');
    paperTexture(ctx, 0, 0, outW, outH, 0.07);
    ctx.restore();
    // recessed image edge
    const lw = Math.max(1, s * 0.004);
    ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.strokeRect(rect.x + lw / 2, rect.y + lw / 2, rect.w - lw, rect.h - lw);
    const sh = Math.max(2, s * 0.012);
    const gt = ctx.createLinearGradient(0, rect.y, 0, rect.y + sh);
    gt.addColorStop(0, 'rgba(0,0,0,0.18)'); gt.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gt; ctx.fillRect(rect.x, rect.y, rect.w, sh);
  } else if (frame === 'film35') {
    const land = rect.w >= rect.h;
    ctx.beginPath(); ctx.rect(0, 0, outW, outH); roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, s * 0.012);
    ctx.fillStyle = '#15110e'; ctx.fill('evenodd');
    // sprocket holes along both long edges
    const pitch = s * 0.198, hl = s * 0.116, hs = s * 0.0825, fromEdge = s * 0.125, rad = s * 0.014;
    const along = land ? outW : outH;
    const count = Math.ceil(along / pitch) + 1;
    const off = (along - (count - 1) * pitch) / 2;
    ctx.fillStyle = '#efe9dc';
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < count; i++) {
        const a = off + i * pitch - hl / 2;
        ctx.beginPath();
        if (land) roundRectPath(ctx, a, side === 0 ? fromEdge - hs / 2 : outH - fromEdge - hs / 2, hl, hs, rad);
        else roundRectPath(ctx, side === 0 ? fromEdge - hs / 2 : outW - fromEdge - hs / 2, a, hs, hl, rad);
        ctx.fill();
      }
    }
    // edge markings
    const fs = Math.max(6, s * 0.042);
    ctx.fillStyle = 'rgba(236,142,48,0.92)';
    ctx.font = `700 ${fs}px "Studio Mono", ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    const txt = look.edgeText || 'EYAD 400';
    const num = String(12 + ((look.code || 0) % 24));
    const strip = land ? rect.y : rect.x;
    const mid = strip - (strip - (fromEdge + hs / 2)) / 2;
    if (land) {
      ctx.textAlign = 'left'; ctx.fillText(txt, rect.x + s * 0.06, mid);
      ctx.textAlign = 'center'; ctx.fillText(num, rect.x + rect.w * 0.62, mid);
      ctx.fillText(num + 'A', rect.x + rect.w * 0.62, outH - mid);
      ctx.beginPath(); const ax = rect.x + rect.w * 0.62 + fs * 1.6; ctx.moveTo(ax, mid - fs * 0.35); ctx.lineTo(ax + fs * 0.6, mid); ctx.lineTo(ax, mid + fs * 0.35); ctx.fill();
    } else {
      ctx.save(); ctx.translate(mid, rect.y + s * 0.06); ctx.rotate(Math.PI / 2); ctx.textAlign = 'left'; ctx.fillText(txt, 0, 0); ctx.restore();
      ctx.save(); ctx.translate(outW - mid, rect.y + rect.h * 0.62); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(num + 'A', 0, 0); ctx.restore();
    }
  } else if (frame === 'digicam') {
    const r = s * 0.05;
    ctx.beginPath(); ctx.rect(0, 0, outW, outH); roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, r);
    ctx.fillStyle = '#0c0c0d'; ctx.fill('evenodd');
    ctx.beginPath(); roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, r);
    ctx.lineWidth = Math.max(1, s * 0.004); ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
  } else if (frame === 'panorama') {
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, outW, rect.y);
    ctx.fillRect(0, rect.y + rect.h, outW, outH - rect.y - rect.h);
  }
  ctx.restore();
  if (P.dateStamp) {
    const text = P.dateText || todayStamp();
    const hgt = Math.max(8, s * 0.05);
    drawDateStamp(ctx, text, rect.x + rect.w - s * 0.055, rect.y + rect.h - s * 0.05, hgt);
  }
}

// Seven-segment glyphs: a b c d e f g
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };

function glyphAdvance(ch, h) {
  const w = h * 0.52, gap = h * 0.2;
  if (ch === ' ') return w * 0.7;
  if (ch === "'" || ch === '.' || ch === ':') return h * 0.24 + gap * 0.5;
  if (ch === '/') return w * 0.6 + gap;
  return w + gap;
}

function segPath(ctx, x, y, h, ch) {
  const w = h * 0.52, t = h * 0.13, g = t * 0.22;
  const hs = (cx, cy, len) => { ctx.moveTo(cx - len / 2, cy); ctx.lineTo(cx - len / 2 + t / 2, cy - t / 2); ctx.lineTo(cx + len / 2 - t / 2, cy - t / 2); ctx.lineTo(cx + len / 2, cy); ctx.lineTo(cx + len / 2 - t / 2, cy + t / 2); ctx.lineTo(cx - len / 2 + t / 2, cy + t / 2); ctx.closePath(); };
  const vs = (cx, cy, len) => { ctx.moveTo(cx, cy - len / 2); ctx.lineTo(cx + t / 2, cy - len / 2 + t / 2); ctx.lineTo(cx + t / 2, cy + len / 2 - t / 2); ctx.lineTo(cx, cy + len / 2); ctx.lineTo(cx - t / 2, cy + len / 2 - t / 2); ctx.lineTo(cx - t / 2, cy - len / 2 + t / 2); ctx.closePath(); };
  if (ch === "'") { vs(x + h * 0.12, y + h * 0.16, h * 0.3); return; }
  if (ch === '.') { ctx.rect(x + h * 0.06, y + h - t, t, t); return; }
  if (ch === ':') { ctx.rect(x + h * 0.06, y + h * 0.28, t, t); ctx.rect(x + h * 0.06, y + h * 0.66, t, t); return; }
  if (ch === '/') { ctx.moveTo(x + w * 0.6, y); ctx.lineTo(x + w * 0.6 + t * 0.8, y); ctx.lineTo(x + t * 0.8, y + h); ctx.lineTo(x, y + h); ctx.closePath(); return; }
  const segs = SEG[ch];
  if (!segs) return;
  const L = w - g * 2, V = h / 2 - g * 2;
  for (const sname of segs) {
    if (sname === 'a') hs(x + w / 2, y + t / 2, L);
    else if (sname === 'g') hs(x + w / 2, y + h / 2, L);
    else if (sname === 'd') hs(x + w / 2, y + h - t / 2, L);
    else if (sname === 'f') vs(x + t / 2, y + h / 4 + t / 4, V);
    else if (sname === 'b') vs(x + w - t / 2, y + h / 4 + t / 4, V);
    else if (sname === 'e') vs(x + t / 2, y + (3 * h) / 4 - t / 4, V);
    else if (sname === 'c') vs(x + w - t / 2, y + (3 * h) / 4 - t / 4, V);
  }
}

/** Orange segmented-LCD date imprint, right-aligned at (right, bottom). */
export function drawDateStamp(ctx, text, right, bottom, h) {
  text = sanitizeDateText(text);
  if (!text) return;
  let total = 0;
  for (const ch of text) total += glyphAdvance(ch, h);
  const pad = Math.ceil(h * 0.6);
  const cw = Math.ceil(total + pad * 2), chh = Math.ceil(h + pad * 2);
  const layer = makeCanvas(cw, chh), g = layer.getContext('2d');
  g.setTransform(1, 0, -0.1, 1, pad + h * 0.1, pad);
  const path = () => { g.beginPath(); let x = 0; for (const ch of text) { segPath(g, x, 0, h, ch); x += glyphAdvance(ch, h); } };
  g.shadowColor = 'rgba(255,96,10,0.95)'; g.shadowBlur = h * 0.45;
  g.fillStyle = '#ff6f1a'; path(); g.fill();
  g.shadowBlur = 0; g.fillStyle = 'rgba(255,196,120,0.85)'; path(); g.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(layer, right - total - pad, bottom - h - pad);
  ctx.restore();
}

// ---------------------------------------------------------------- still images (tiled)

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Apply a look to a drawable source at full quality.
 * @param src      HTMLCanvasElement | ImageBitmap | HTMLImageElement | HTMLVideoElement | OffscreenCanvas
 * @param lookId   look id string or look object
 * @param params   partial parameter overrides (see LOOK_PARAMS, plus frame, dateStamp, dateText, lut)
 * @param opts     { width, height }  fit the output inside this box (default: source size)
 *                 { crop:{x,y,w,h}, mirror, frameNo, onProgress(frac), cpu:true (force CPU) }
 * @returns Promise<HTMLCanvasElement>
 */
export async function applyLook(src, lookId, params = {}, opts = {}) {
  const look = getLook(lookId);
  const P = resolveParams(look, params);
  const [W, H] = sourceSize(src);
  if (!W || !H) throw new Error('The image has no pixels.');
  const layout = computeLayout(P.frame, W, H, opts);
  const out = makeCanvas(layout.outW, layout.outH);
  const octx = out.getContext('2d');
  const U = buildUniforms(look, P, layout.cw, layout.ch, opts.frameNo || 0);
  const ctx = opts.cpu ? null : sharedGL();
  let done = false;
  if (ctx) {
    try { await gpuStill(ctx, src, look, U, layout, octx, !!opts.mirror, opts.onProgress); done = !ctx.gl.isContextLost(); } catch (e) { console.warn('Film Lab: GPU path failed, using CPU —', e && e.message); done = false; }
  }
  if (!done) await cpuStill(src, look, U, layout, octx, !!opts.mirror, opts.onProgress);
  drawOverlay(octx, layout, look, P);
  return out;
}

function glowSource(src, crop, mirror, maxSide) {
  const k = Math.min(1, maxSide / Math.max(crop.w, crop.h));
  const gw = Math.max(8, Math.round(crop.w * k)), gh = Math.max(8, Math.round(crop.h * k));
  const c = makeCanvas(gw, gh), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  if (mirror) { g.translate(gw, 0); g.scale(-1, 1); }
  g.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, gw, gh);
  return c;
}

async function gpuStill(ctx, src, look, U, layout, octx, mirror, onProgress) {
  const { gl, canvas } = ctx;
  const R = resources(ctx);
  const [W, H] = sourceSize(src);
  const { crop, cw, ch, rect } = layout;
  let glow = null;
  if (U.needGlow) {
    const gs = glowSource(src, crop, false, 512);
    upload(gl, R.small, gs);
    glow = runGlow(ctx, R, R.small, { crop: [0, 0, gs.width, gs.height], tex: [0, 0, gs.width, gs.height], mirror }, gs.width, gs.height);
  }
  const T = ctx.maxTile;
  const ov = overlapFor(U);
  const sx = crop.w / cw, sy = crop.h / ch; // source px per content px
  const stage = makeCanvas(1, 1), sg = stage.getContext('2d');
  const tilesX = Math.ceil(cw / T), tilesY = Math.ceil(ch / T), total = tilesX * tilesY;
  let n = 0;
  for (let ty = 0; ty < ch; ty += T) {
    for (let tx = 0; tx < cw; tx += T) {
      const tw = Math.min(T, cw - tx), th = Math.min(T, ch - ty);
      // source region for this tile (+ overlap), mirror-aware
      let u0 = (tx - ov) / cw, u1 = (tx + tw + ov) / cw;
      if (mirror) { const a = 1 - u1, b = 1 - u0; u0 = a; u1 = b; }
      const v0 = (ty - ov) / ch, v1 = (ty + th + ov) / ch;
      const rx0 = Math.max(0, Math.floor(crop.x + u0 * crop.w)), rx1 = Math.min(W, Math.ceil(crop.x + u1 * crop.w));
      const ry0 = Math.max(0, Math.floor(crop.y + v0 * crop.h)), ry1 = Math.min(H, Math.ceil(crop.y + v1 * crop.h));
      const rw = Math.max(1, rx1 - rx0), rh = Math.max(1, ry1 - ry0);
      const k = Math.min(1, 1 / Math.max(sx, sy) * 1.5); // downscale stage when the output is much smaller
      const kw = Math.max(1, Math.min(ctx.maxTex, Math.round(rw * k))), kh = Math.max(1, Math.min(ctx.maxTex, Math.round(rh * k)));
      stage.width = kw; stage.height = kh;
      sg.imageSmoothingQuality = 'high';
      sg.clearRect(0, 0, kw, kh);
      sg.drawImage(src, rx0, ry0, rw, rh, 0, 0, kw, kh);
      upload(gl, R.src, stage);
      canvas.width = tw; canvas.height = th;
      runMain(ctx, R, look, U, R.src, { crop: [crop.x, crop.y, crop.w, crop.h], tex: [rx0, ry0, rw, rh], mirror }, { x: tx, y: ty, w: tw, h: th }, glow);
      octx.drawImage(canvas, 0, 0, tw, th, rect.x + tx, rect.y + ty, tw, th);
      n++;
      if (onProgress) onProgress(n / total);
      if (total > 1) await tick();
    }
  }
}

// ---------------------------------------------------------------- CPU fallback

function hashJS(x, y) {
  x = ((x % 4096) + 4096) % 4096; y = ((y % 4096) + 4096) % 4096;
  let a = (x * 0.1031) % 1, b = (y * 0.1031) % 1, c = (x * 0.1031) % 1;
  const dd = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a = (a + dd) % 1; b = (b + dd) % 1; c = (c + dd) % 1;
  return ((a + b) * c) % 1;
}
function vnoiseJS(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hashJS(ix, iy), b = hashJS(ix + 1, iy), c = hashJS(ix, iy + 1), d = hashJS(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function boxBlur(data, w, h, r) {
  const tmp = new Float32Array(data.length);
  for (let pass = 0; pass < 2; pass++) {
    const [a, b] = pass === 0 ? [data, tmp] : [tmp, data];
    const horiz = pass === 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = horiz ? Math.min(w - 1, Math.max(0, x + k)) : x, yy = horiz ? y : Math.min(h - 1, Math.max(0, y + k));
        const i = (yy * w + xx) * 3; sr += a[i]; sg += a[i + 1]; sb += a[i + 2]; n++;
      }
      const o = (y * w + x) * 3; b[o] = sr / n; b[o + 1] = sg / n; b[o + 2] = sb / n;
    }
  }
}

function cpuGlow(src, crop, mirror) {
  const gs = glowSource(src, crop, mirror, 160);
  const w = gs.width, h = gs.height;
  const id = gs.getContext('2d').getImageData(0, 0, w, h).data;
  const A = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < id.length; i += 4, j += 3) {
    const r = id[i] / 255, g = id[i + 1] / 255, b = id[i + 2] / 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let t = Math.min(1, Math.max(0, (L - 0.58) / 0.3)); t = t * t * (3 - 2 * t);
    A[j] = r * t; A[j + 1] = g * t; A[j + 2] = b * t;
  }
  const k = Math.min(w, h) / 180;
  const Hh = A.slice(); boxBlur(Hh, w, h, Math.max(1, Math.round(2.2 * k))); boxBlur(Hh, w, h, Math.max(1, Math.round(2.2 * k)));
  const B = Hh.slice(); for (let i = 0; i < 3; i++) boxBlur(B, w, h, Math.max(1, Math.round(6 * k)));
  return { w, h, H: Hh, B };
}

function sampleGlow(G, arr, u, v, out) {
  const x = Math.min(G.w - 1.001, Math.max(0, u * G.w - 0.5)), y = Math.min(G.h - 1.001, Math.max(0, v * G.h - 0.5));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i00 = (y0 * G.w + x0) * 3, i10 = i00 + 3, i01 = i00 + G.w * 3, i11 = i01 + 3;
  for (let c = 0; c < 3; c++) out[c] = (arr[i00 + c] * (1 - fx) + arr[i10 + c] * fx) * (1 - fy) + (arr[i01 + c] * (1 - fx) + arr[i11 + c] * fx) * fy;
  return out;
}

async function cpuStill(src, look, U, layout, octx, mirror, onProgress) {
  const { crop, cw, ch, rect } = layout;
  // Source at content resolution (+ mirroring) in one bitmap.
  const sc = makeCanvas(cw, ch), sg = sc.getContext('2d');
  sg.imageSmoothingQuality = 'high';
  if (mirror) { sg.translate(cw, 0); sg.scale(-1, 1); }
  sg.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);
  const srcData = sg.getImageData(0, 0, cw, ch).data;
  const G = U.needGlow ? cpuGlow(src, crop, mirror) : null;
  const curve = curveTable(look);
  const lut = U.lut;
  const M = U.uMatrixRow, MW = U.uMonoW;
  const hl = [0, 0, 0], bl = [0, 0, 0], lo = [0, 0, 0];
  const Sm = Math.min(cw, ch);
  const halfDiag = Math.hypot(cw / 2, ch / 2) / Sm;
  const hcX = 0.5 * cw / Sm, hcY = 0.5 * ch / Sm;
  const dirX = Math.cos(U.uLeakAng), dirY = Math.sin(U.uLeakAng);
  const c1x = dirX * hcX * 1.05, c1y = dirY * hcY * 1.05;
  const c2x = (dirX * 0.8 - dirY * 0.45) * hcX * 0.95, c2y = (dirY * 0.8 + dirX * 0.45) * hcY * 0.95;
  const at = (x, y) => { x = Math.min(cw - 1, Math.max(0, Math.round(x))); y = Math.min(ch - 1, Math.max(0, Math.round(y))); return (y * cw + x) * 4; };
  const band = Math.max(1, Math.floor(250000 / cw));
  for (let y0 = 0; y0 < ch; y0 += band) {
    const bh = Math.min(band, ch - y0);
    const img = octx.createImageData(cw, bh);
    const od = img.data;
    for (let yy = 0; yy < bh; yy++) {
      const y = y0 + yy, py = y + 0.5;
      for (let x = 0; x < cw; x++) {
        const px = x + 0.5;
        const i0 = (y * cw + x) * 4;
        const br = srcData[i0] / 255, bgc = srcData[i0 + 1] / 255, bb = srcData[i0 + 2] / 255;
        let r = br, g = bgc, b = bb;
        const dx = (px - cw / 2) / Sm, dy = (py - ch / 2) / Sm;
        const rr = Math.hypot(dx, dy) / halfDiag;
        if (U.uScan > 0) {
          const line = Math.floor(py / U.uScanPx);
          const jx = px + (vnoiseJS(line * 0.13, U.uSeed * 1.7) - 0.5) * U.uScan * U.uScanPx * 1.5;
          const j = at(jx, py); r = srcData[j] / 255; g = srcData[j + 1] / 255; b = srcData[j + 2] / 255;
          const jl = at(jx - U.uScanPx * 3, py), jr = at(jx + U.uScanPx * 1.5, py);
          const L0 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const cl = [srcData[jl] / 255, srcData[jl + 1] / 255, srcData[jl + 2] / 255], cr = [srcData[jr] / 255, srcData[jr + 1] / 255, srcData[jr + 2] / 255];
          const Ll = 0.2126 * cl[0] + 0.7152 * cl[1] + 0.0722 * cl[2], Lr = 0.2126 * cr[0] + 0.7152 * cr[1] + 0.0722 * cr[2];
          const avg = (k, v) => ((cl[k] - Ll) + (v - L0) + (cr[k] - Lr)) / 3;
          r = L0 + (r - L0) + (avg(0, r) - (r - L0)) * U.uScan;
          g = L0 + (g - L0) + (avg(1, g) - (g - L0)) * U.uScan;
          b = L0 + (b - L0) + (avg(2, b) - (b - L0)) * U.uScan;
        }
        if (U.uAb > 0) {
          const ox = dx * U.uAb * rr, oy = dy * U.uAb * rr;
          r = srcData[at(px + ox, py + oy)] / 255; b = srcData[at(px - ox, py - oy) + 2] / 255;
        }
        if (U.uSharp > 0) {
          const s = U.uSharpR;
          const a1 = at(px + s, py), a2 = at(px - s, py), a3 = at(px, py + s), a4 = at(px, py - s);
          r += (r - (srcData[a1] + srcData[a2] + srcData[a3] + srcData[a4]) / 1020) * U.uSharp;
          g += (g - (srcData[a1 + 1] + srcData[a2 + 1] + srcData[a3 + 1] + srcData[a4 + 1]) / 1020) * U.uSharp;
          b += (b - (srcData[a1 + 2] + srcData[a2 + 2] + srcData[a3 + 2] + srcData[a4 + 2]) / 1020) * U.uSharp;
        }
        if (U.uCcd > 0) {
          const B = U.uCcdBlock;
          const j = at((Math.floor(px / B) + 0.5) * B, (Math.floor(py / B) + 0.5) * B);
          const qr = srcData[j] / 255, qg = srcData[j + 1] / 255, qb = srcData[j + 2] / 255;
          const L0 = 0.2126 * r + 0.7152 * g + 0.0722 * b, Lq = 0.2126 * qr + 0.7152 * qg + 0.0722 * qb;
          const Ln = L0 + (Lq - L0) * 0.12 * U.uCcd, k = 0.7 * U.uCcd;
          r = Ln + (r - L0) + ((qr - Lq) - (r - L0)) * k;
          g = Ln + (g - L0) + ((qg - Lq) - (g - L0)) * k;
          b = Ln + (b - L0) + ((qb - Lq) - (b - L0)) * k;
        }
        // grade
        r = Math.pow(Math.max(0, r), 2.2) * U.uExpo; g = Math.pow(Math.max(0, g), 2.2) * U.uExpo; b = Math.pow(Math.max(0, b), 2.2) * U.uExpo;
        r = Math.pow(r, 1 / 2.2) * U.uWB[0]; g = Math.pow(g, 1 / 2.2) * U.uWB[1]; b = Math.pow(b, 1 / 2.2) * U.uWB[2];
        if (U.uLutAmt > 0 && lut) {
          sampleLut(lut, Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b)), lo);
          r += (lo[0] - r) * U.uLutAmt; g += (lo[1] - g) * U.uLutAmt; b += (lo[2] - b) * U.uLutAmt;
        }
        let nr = M[0] * r + M[1] * g + M[2] * b, ng = M[3] * r + M[4] * g + M[5] * b, nb = M[6] * r + M[7] * g + M[8] * b;
        if (U.uMono > 0) { const m = MW[0] * nr + MW[1] * ng + MW[2] * nb; nr += (m - nr) * U.uMono; ng += (m - ng) * U.uMono; nb += (m - nb) * U.uMono; }
        let L = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
        r = Math.min(1, Math.max(0, L + (nr - L) * U.uSat)); g = Math.min(1, Math.max(0, L + (ng - L) * U.uSat)); b = Math.min(1, Math.max(0, L + (nb - L) * U.uSat));
        if (U.uContrast > 0) { const k = U.uContrast; r += (r * r * (3 - 2 * r) - r) * k; g += (g * g * (3 - 2 * g) - g) * k; b += (b * b * (3 - 2 * b) - b) * k; }
        else if (U.uContrast < 0) { const k = -U.uContrast; r += (0.5 + (r - 0.5) * 0.55 - r) * k; g += (0.5 + (g - 0.5) * 0.55 - g) * k; b += (0.5 + (b - 0.5) * 0.55 - b) * k; }
        const cv = (v, o) => { const f = Math.min(255, Math.max(0, v * 255)); const i = Math.min(254, f | 0), t = f - i; return (curve[i * 4 + o] * (1 - t) + curve[(i + 1) * 4 + o] * t) / 255; };
        r = cv(r, 0); g = cv(g, 1); b = cv(b, 2);
        if (U.uRoll > 0) {
          const f = (v) => { const o = Math.max(0, v - U.uRollKnee); return v - o + o / (1 + o * U.uRollK); };
          r = f(r); g = f(g); b = f(b);
          const L2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          let t = Math.min(1, Math.max(0, (L2 - 0.7) / 0.3)); t = t * t * (3 - 2 * t) * U.uRoll * 0.3;
          r += (L2 - r) * t; g += (L2 - g) * t; b += (L2 - b) * t;
        }
        r = U.uFadeCol[0] * U.uFade + r * (1 - U.uFade); g = U.uFadeCol[1] * U.uFade + g * (1 - U.uFade); b = U.uFadeCol[2] * U.uFade + b * (1 - U.uFade);
        L = Math.min(1, Math.max(0, 0.2126 * r + 0.7152 * g + 0.0722 * b));
        const ws = (1 - L) * (1 - L), wh = L * L;
        r += U.uShadowT[0] * ws + U.uHighT[0] * wh; g += U.uShadowT[1] * ws + U.uHighT[1] * wh; b += U.uShadowT[2] * ws + U.uHighT[2] * wh;
        if (G) {
          const u = px / cw, v = py / ch;
          const cl = (v2) => Math.min(1, Math.max(0, v2));
          if (U.uHal > 0) { sampleGlow(G, G.H, u, v, hl); r = 1 - (1 - cl(r)) * (1 - cl(hl[0] * U.uHalCol[0] * U.uHal)); g = 1 - (1 - cl(g)) * (1 - cl(hl[1] * U.uHalCol[1] * U.uHal)); b = 1 - (1 - cl(b)) * (1 - cl(hl[2] * U.uHalCol[2] * U.uHal)); }
          if (U.uBloom > 0) { sampleGlow(G, G.B, u, v, bl); r = 1 - (1 - cl(r)) * (1 - cl(bl[0] * U.uBloom)); g = 1 - (1 - cl(g)) * (1 - cl(bl[1] * U.uBloom)); b = 1 - (1 - cl(b)) * (1 - cl(bl[2] * U.uBloom)); }
        }
        if (U.uCcd > 0) {
          L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          let t = Math.min(1, Math.max(0, (L - 0.55) / 0.45)); t = t * t * (3 - 2 * t) * U.uCcd;
          r -= 0.07 * t; g += 0.012 * t; b += 0.06 * t;
          const q = 64 + (20 - 64) * U.uCcd, k = 0.5 * U.uCcd;
          r += (Math.floor(r * q + 0.5) / q - r) * k; g += (Math.floor(g * q + 0.5) / q - g) * k; b += (Math.floor(b * q + 0.5) / q - b) * k;
          const w = Math.pow(1 - Math.min(1, Math.max(0, L)), 3) * 0.16 * U.uCcd;
          r += (hashJS(px + U.uSeed * 13, py + U.uSeed * 13) - 0.5) * w; g += (hashJS(px + 71.3, py + 71.3) - 0.5) * w; b += (hashJS(px + 143.7, py + 143.7) - 0.5) * w;
        }
        if (U.uLeak > 0) {
          const e1x = dx - c1x, e1y = dy - c1y, e2x = dx - c2x, e2y = dy - c2y;
          const gg = Math.exp(-(e1x * e1x + e1y * e1y) * 4) + 0.55 * Math.exp(-(e2x * e2x + e2y * e2y) * 9);
          const k = Math.min(1, Math.max(0, gg * U.uLeak * 1.2));
          r = 1 - (1 - Math.min(1, Math.max(0, r))) * (1 - U.uLeakCol[0] * k);
          g = 1 - (1 - Math.min(1, Math.max(0, g))) * (1 - U.uLeakCol[1] * k);
          b = 1 - (1 - Math.min(1, Math.max(0, b))) * (1 - U.uLeakCol[2] * k);
        }
        if (U.uVig > 0) { let t = Math.min(1, Math.max(0, (rr - 0.32) / 0.8)); t = t * t * (3 - 2 * t); const f = 1 - U.uVig * 0.85 * t; r *= f; g *= f; b *= f; }
        if (U.uGrain > 0) {
          const gx = px / U.uGrainPx + U.uSeed * 37, gy = py / U.uGrainPx + U.uSeed * 37;
          const n = vnoiseJS(gx, gy) * 0.62 + vnoiseJS(gx * 2.17 + 17, gy * 2.17 + 17) * 0.38 - 0.5;
          L = Math.min(1, Math.max(0, 0.2126 * r + 0.7152 * g + 0.0722 * b));
          const w = (0.3 + 2.8 * L * (1 - L)) * U.uGrain * 2;
          const cc = U.uGrainCol * (1 - U.uMono);
          r += (n + (cc ? (vnoiseJS(gx * 1.3 + 91, gy * 1.3 + 91) - 0.5) * cc : 0)) * w;
          g += (n + (cc ? (vnoiseJS(gx * 1.3 + 53, gy * 1.3 + 53) - 0.5) * cc : 0)) * w;
          b += (n + (cc ? (vnoiseJS(gx * 1.3 + 27, gy * 1.3 + 27) - 0.5) * cc : 0)) * w;
        }
        if (U.uScan > 0) { const f = 1 - U.uScan * 0.16 * (0.5 + 0.5 * Math.cos(py / U.uScanPx * Math.PI)); r *= f; g *= f; b *= f; }
        const s = U.uStrength, o = yy * cw * 4 + x * 4;
        od[o] = Math.round(Math.min(1, Math.max(0, br + (Math.min(1, Math.max(0, r)) - br) * s)) * 255);
        od[o + 1] = Math.round(Math.min(1, Math.max(0, bgc + (Math.min(1, Math.max(0, g)) - bgc) * s)) * 255);
        od[o + 2] = Math.round(Math.min(1, Math.max(0, bb + (Math.min(1, Math.max(0, b)) - bb) * s)) * 255);
        od[o + 3] = srcData[i0 + 3];
      }
    }
    // putImageData ignores compositing; draw through a temp canvas so it lands at the content rect.
    octx.putImageData(img, rect.x, rect.y + y0);
    if (onProgress) onProgress(Math.min(1, (y0 + bh) / ch));
    await tick();
  }
  // Dust in the CPU path: sparse specks drawn with 2D (same density idea as the shader).
  if (U.uDust > 0) {
    const r = rng(1234 + U.uDustSeed), cell = Sm / 16;
    octx.save();
    octx.beginPath(); octx.rect(rect.x, rect.y, rect.w, rect.h); octx.clip();
    for (let gy = 0; gy < ch / cell; gy++) for (let gx = 0; gx < cw / cell; gx++) {
      if (r() >= U.uDust * 0.35) continue;
      const white = r() < U.uDustTone;
      octx.fillStyle = white ? 'rgba(245,245,245,0.85)' : 'rgba(15,15,15,0.85)';
      octx.beginPath();
      octx.arc(rect.x + (gx + 0.2 + r() * 0.6) * cell, rect.y + (gy + 0.2 + r() * 0.6) * cell, Math.max(0.6, cell * (0.015 + 0.05 * r() * r())), 0, Math.PI * 2);
      octx.fill();
    }
    octx.restore();
  }
}

// ---------------------------------------------------------------- live renderer

/**
 * Per-frame renderer for video / camera. Owns its own WebGL context (on an
 * internal canvas) and draws into `canvas` with 2D, so frames and the date
 * stamp can be composited and the canvas can be recorded with captureStream().
 *
 * render(src, lookId, params, time = 0, opts = {}) →
 *   { width, height, layout }   (the canvas is resized to the output)
 *   opts: { crop:{x,y,w,h}, mirror, maxSize (long side, default 1280), width, height (exact outer box) }
 */
export function createLiveRenderer(canvas, { maxGlow = 256 } = {}) {
  const ctx2d = canvas.getContext('2d', { alpha: false });
  const glCanvas = makeCanvas(16, 16);
  let gl = createGL(glCanvas);
  let ctx = gl ? { gl, canvas: glCanvas, cache: new Map(), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) } : null;
  let lost = false;
  glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  glCanvas.addEventListener('webglcontextrestored', () => { lost = false; gl = createGL(glCanvas); ctx = gl ? { gl, canvas: glCanvas, cache: new Map(), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) } : null; });
  let overlay = null, overlayKey = '';
  let cpuBusy = false;
  let lastCpu = null;

  function render(src, lookId, params = {}, time = 0, opts = {}) {
    const look = getLook(lookId);
    const P = resolveParams(look, params);
    const [W, H] = sourceSize(src);
    if (!W || !H) return null;
    let layout;
    if (opts.width && opts.height) {
      layout = computeLayout(P.frame, W, H, { crop: opts.crop, width: opts.width, height: opts.height, maxPixels: Infinity });
    } else {
      const max = opts.maxSize || 1280;
      layout = computeLayout(P.frame, W, H, { crop: opts.crop, width: max, height: max, maxPixels: Infinity });
      if (layout.scale > 1) layout = computeLayout(P.frame, W, H, { crop: opts.crop });
    }
    const outW = opts.width && opts.height ? Math.round(opts.width) : layout.outW;
    const outH = opts.width && opts.height ? Math.round(opts.height) : layout.outH;
    const offX = Math.round((outW - layout.outW) / 2), offY = Math.round((outH - layout.outH) / 2);
    if (canvas.width !== outW || canvas.height !== outH) { canvas.width = outW; canvas.height = outH; overlayKey = ''; }
    const frameNo = Math.floor(time * 24);
    const U = buildUniforms(look, P, layout.cw, layout.ch, frameNo);
    const map = { crop: [layout.crop.x, layout.crop.y, layout.crop.w, layout.crop.h], tex: [0, 0, W, H], mirror: !!opts.mirror };
    if (offX || offY) { ctx2d.fillStyle = '#000'; ctx2d.fillRect(0, 0, outW, outH); }
    if (ctx && !lost && !gl.isContextLost()) {
      const R = resources(ctx);
      try { upload(gl, R.src, src); } catch (e) { return null; }
      const glow = U.needGlow ? (() => {
        const k = maxGlow / Math.max(layout.cw, layout.ch);
        const gw = Math.max(8, Math.round(layout.cw * k)), gh = Math.max(8, Math.round(layout.ch * k));
        return runGlow(ctx, R, R.src, map, gw, gh);
      })() : null;
      if (glCanvas.width !== layout.cw || glCanvas.height !== layout.ch) { glCanvas.width = layout.cw; glCanvas.height = layout.ch; }
      runMain(ctx, R, look, U, R.src, map, { x: 0, y: 0, w: layout.cw, h: layout.ch }, glow);
      ctx2d.drawImage(glCanvas, offX + layout.rect.x, offY + layout.rect.y);
    } else {
      // CPU: render a small version asynchronously and show the latest finished frame.
      if (!cpuBusy) {
        cpuBusy = true;
        const small = Math.min(1, 480 / Math.max(layout.cw, layout.ch));
        const snap = makeCanvas(Math.round(layout.crop.w * small), Math.round(layout.crop.h * small));
        snap.getContext('2d').drawImage(src, layout.crop.x, layout.crop.y, layout.crop.w, layout.crop.h, 0, 0, snap.width, snap.height);
        const P2 = { ...P, frame: 'none', dateStamp: false };
        applyLook(snap, look, P2, { cpu: true, mirror: opts.mirror, frameNo }).then((c) => { lastCpu = c; }).finally(() => { cpuBusy = false; });
      }
      if (lastCpu) ctx2d.drawImage(lastCpu, offX + layout.rect.x, offY + layout.rect.y, layout.cw, layout.ch);
    }
    if (P.frame !== 'none' || P.dateStamp) {
      const key = [outW, outH, P.frame, P.dateStamp, P.dateText, look.id, layout.cw, layout.ch].join('|');
      if (key !== overlayKey) {
        overlay = makeCanvas(outW, outH);
        const og = overlay.getContext('2d');
        og.translate(offX, offY);
        drawOverlay(og, layout, look, P);
        overlayKey = key;
      }
      ctx2d.drawImage(overlay, 0, 0);
    }
    return { width: outW, height: outH, layout: { ...layout, rect: { ...layout.rect, x: layout.rect.x + offX, y: layout.rect.y + offY } } };
  }

  return {
    canvas,
    get gpu() { return !!ctx && !lost; },
    render,
    dispose() {
      if (ctx && gl && !gl.isContextLost()) {
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
      ctx = null; overlay = null;
    },
  };
}

// ---------------------------------------------------------------- thumbnails

const thumbSrcCache = new WeakMap();

/**
 * Square preview of a look (default 112 px). Fast: the source is reduced once
 * per source object and re-used for every look.
 * Returns Promise<HTMLCanvasElement>.
 */
export async function lookThumbnail(src, lookId, size = 112, params = {}) {
  const [W, H] = sourceSize(src);
  if (!W || !H) throw new Error('No source.');
  let small = thumbSrcCache.get(src);
  const s0 = Math.min(W, H);
  const want = Math.round(size * 1.5);
  if (!small || small.width !== want || small._stamp !== (src._thumbStamp || 0)) {
    small = makeCanvas(want, want);
    const g = small.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, (W - s0) / 2, (H - s0) / 2, s0, s0, 0, 0, want, want);
    small._stamp = src._thumbStamp || 0;
    if (typeof src === 'object') thumbSrcCache.set(src, small);
  }
  return applyLook(small, lookId, params, { width: size, height: size });
}

/** Everything a UI needs to list looks, grouped. */
export function looksByGroup() {
  return LOOK_GROUPS.map((g) => ({ ...g, looks: LOOKS.filter((l) => l.group === g.id) })).filter((g) => g.looks.length);
}

export { lutKey };
