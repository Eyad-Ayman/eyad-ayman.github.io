// EYAD KAMERA — lenses. Real-time optical looks drawn with WebGL1 shaders
// (runs on every browser incl. iPhone Safari): fisheye, action-cam wide,
// tilt-shift, crystal ball, bulge, pinch, anamorphic, kaleidoscope, mirror,
// mist, star filter, prism, door viewer.
// The lens sits FIRST in the chain (lens → film look → effect), the way glass
// sits in front of the film, so frames, date stamps and on-screen text stay straight.
// The same shaders run on the live preview, on recorded video and — at the
// photo's own resolution — on the captured still.
import { createGL, program, texture, target, draw, upload, PRECISION } from '../core/glutil.js';

export const LENSES = [
  { id: 'none', name: 'No lens' },
  { id: 'fisheye', name: 'Fisheye', label: 'Strength', def: 0.7, desc: 'Circular fisheye with real barrel distortion' },
  { id: 'wide', name: 'Action wide', label: 'Strength', def: 0.6, desc: 'Ultra-wide action-camera barrel that fills the frame' },
  { id: 'tilt', name: 'Tilt-shift', label: 'Blur', def: 0.6, pre: 'blur', desc: 'Miniature look — a sharp band, soft above and below' },
  { id: 'ball', name: 'Crystal ball', label: 'Size', def: 0.55, pre: 'blur', desc: 'A glass ball that flips the scene, soft background' },
  { id: 'bulge', name: 'Bulge', label: 'Strength', def: 0.6, desc: 'Pushes the centre toward you' },
  { id: 'pinch', name: 'Pinch', label: 'Strength', def: 0.5, desc: 'Pulls the centre away' },
  { id: 'anamorphic', name: 'Anamorphic', label: 'Flare', def: 0.6, pre: 'streak', desc: '2.39 : 1 cinema crop with blue streak flares' },
  { id: 'mist', name: 'Mist', label: 'Glow', def: 0.6, pre: 'bloom', desc: 'Soft-focus diffusion — highlights bloom' },
  { id: 'star', name: 'Star filter', label: 'Glints', def: 0.6, pre: 'star', desc: 'Cross-screen glints on bright points' },
  { id: 'prism', name: 'Prism', label: 'Amount', def: 0.6, desc: 'Rainbow edges and ghost reflections' },
  { id: 'kaleido', name: 'Kaleidoscope', label: 'Segments', def: 0.35, desc: 'Mirrored wedges around the centre' },
  { id: 'mirror', name: 'Mirror', label: 'Style', def: 0.1, desc: 'Left–right, top–bottom or four-way mirror' },
  { id: 'peephole', name: 'Door viewer', label: 'Strength', def: 0.7, desc: 'Peephole — tiny circle, huge distortion' },
];
export const lensById = (id) => LENSES.find((l) => l.id === id) || LENSES[0];

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// shared by every lens: image-space uv (0,0 = top-left), crop + mirror of the camera frame
const HEAD = PRECISION + `
varying vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uGlow;
uniform sampler2D uGlow2;
uniform vec4 uCrop;
uniform float uMirror;
uniform vec2 uRes;
uniform float uAmt;
vec3 tx(vec2 uv) {
  uv = clamp(uv, 0.0, 1.0);
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  return texture2D(uSrc, uCrop.xy + uv * uCrop.zw).rgb;
}
vec2 fold(vec2 uv) { return 1.0 - abs(mod(uv, 2.0) - 1.0); }
vec3 glow(vec2 uv) { return texture2D(uGlow, vec2(uv.x, 1.0 - uv.y)).rgb; }
vec3 glow2(vec2 uv) { return texture2D(uGlow2, vec2(uv.x, 1.0 - uv.y)).rgb; }
vec2 toP(vec2 uv) { return (uv - 0.5) * uRes / min(uRes.x, uRes.y) * 2.0; }
vec2 toUv(vec2 p) { return p * min(uRes.x, uRes.y) / uRes * 0.5 + 0.5; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 sat(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }
`;
const TAIL = `
void main() { vec2 uv = vec2(vUv.x, 1.0 - vUv.y); gl_FragColor = vec4(clamp(lens(uv), 0.0, 1.0), 1.0); }`;

const FS = {
  none: `vec3 lens(vec2 uv) { return tx(uv); }`,

  fisheye: `
vec3 lens(vec2 uv) {
  vec2 p = toP(uv);
  float r = length(p) / 1.12;
  vec2 d = p / max(length(p), 1e-5);
  float tm = mix(0.55, 1.38, uAmt);
  float rs = tan(min(r, 1.0) * tm) / tan(tm) * 1.08;
  float ca = 0.016 * r * r;
  vec3 c = vec3(tx(toUv(d * rs * (1.0 + ca))).r, tx(toUv(d * rs)).g, tx(toUv(d * rs * (1.0 - ca))).b);
  c *= mix(1.0, 0.5, smoothstep(0.5, 1.0, r));
  c += vec3(0.05, 0.07, 0.1) * smoothstep(0.93, 0.99, r);
  return c * (1.0 - smoothstep(0.985, 1.0, r));
}`,

  wide: `
vec3 lens(vec2 uv) {
  vec2 p = toP(uv);
  float rd = length(toP(vec2(1.0)));
  float r = length(p) / rd;
  vec2 d = p / max(length(p), 1e-5);
  float tm = mix(0.45, 1.15, uAmt);
  float rs = tan(r * tm) / tan(tm) * rd;
  float ca = 0.008 * r * r;
  vec3 c = vec3(tx(toUv(d * rs * (1.0 + ca))).r, tx(toUv(d * rs)).g, tx(toUv(d * rs * (1.0 - ca))).b);
  c = sat(c, 1.12);
  c = (c - 0.5) * 1.06 + 0.5;
  return c * mix(1.0, 0.72, smoothstep(0.55, 1.0, r));
}`,

  tilt: `
vec3 lens(vec2 uv) {
  float band = mix(0.2, 0.07, uAmt);
  float t = smoothstep(band, band + 0.3, abs(uv.y - 0.54));
  float rad = t * mix(0.012, 0.03, uAmt);
  vec2 px = min(uRes.x, uRes.y) / uRes;
  vec3 a = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float f = float(i);
    float ang = f * 2.39996;
    float rr = sqrt((f + 0.5) / 16.0) * rad;
    a += tx(uv + vec2(cos(ang), sin(ang)) * rr * px);
  }
  a /= 16.0;
  vec3 c = mix(a, glow(uv), smoothstep(0.55, 1.0, t) * 0.75);
  c = sat(c, 1.38);
  return (c - 0.5) * 1.14 + 0.5;
}`,

  ball: `
vec3 lens(vec2 uv) {
  vec2 p = toP(uv);
  float R = mix(0.42, 0.86, uAmt);
  vec2 q = p / R;
  float r2 = dot(q, q);
  vec3 bg = glow(uv) * 0.86;
  float shade = smoothstep(1.3, 0.95, length(q - vec2(0.0, 0.14))) * 0.3;
  bg *= 1.0 - shade;
  if (r2 >= 1.0) return bg;
  float z = sqrt(1.0 - r2);
  float k = 1.0 + 1.7 * (1.0 - z);
  vec2 sp = -q * k * 0.92;
  float ca = 0.03 * r2;
  vec3 c = vec3(tx(fold(toUv(sp * (1.0 + ca)))).r, tx(fold(toUv(sp))).g, tx(fold(toUv(sp * (1.0 - ca)))).b);
  c *= mix(1.0, 0.7, r2 * r2);
  c = mix(c, vec3(1.0), pow(1.0 - z, 3.0) * 0.4);
  vec3 n = vec3(q, z);
  c += pow(max(dot(n, normalize(vec3(-0.5, -0.6, 0.62))), 0.0), 60.0) * 0.85;
  c += pow(max(dot(n, normalize(vec3(0.55, 0.62, 0.55))), 0.0), 24.0) * 0.12;
  return mix(bg, c, smoothstep(1.0, 0.975, sqrt(r2)));
}`,

  bulge: `
vec3 lens(vec2 uv) {
  vec2 p = toP(uv);
  float r = length(p);
  float k = mix(0.2, 0.72, uAmt);
  float s = smoothstep(0.0, 1.08, r);
  return tx(toUv(p * (1.0 - k * (1.0 - s))));
}`,

  pinch: `
vec3 lens(vec2 uv) {
  vec2 p = toP(uv);
  float r = length(p);
  float k = mix(0.25, 1.25, uAmt);
  float s = smoothstep(0.0, 1.12, r);
  return tx(fold(toUv(p * (1.0 + k * (1.0 - s)))));
}`,

  anamorphic: `
vec3 lens(vec2 uv) {
  float hh = min(1.0, (uRes.x / uRes.y) / 2.39);
  float y = (uv.y - 0.5) / hh;
  if (abs(y) > 0.5) return vec3(0.0);
  vec2 p = vec2(uv.x - 0.5, y) * 2.0;
  vec2 suv = uv;
  suv.x = 0.5 + (uv.x - 0.5) * (1.0 - 0.035 * (1.0 - p.y * p.y));
  float e = smoothstep(0.45, 1.0, abs(p.x)) * 0.007;
  vec3 c = tx(suv) * 0.4 + (tx(suv + vec2(0.0, e)) + tx(suv - vec2(0.0, e))) * 0.2 + (tx(suv + vec2(0.0, e * 2.0)) + tx(suv - vec2(0.0, e * 2.0))) * 0.1;
  vec3 g = glow(uv);
  vec3 flare = vec3(0.22, 0.55, 1.0) * luma(g) * mix(0.5, 1.7, uAmt) + g * 0.15;
  c = 1.0 - (1.0 - c) * (1.0 - clamp(flare, 0.0, 1.0));
  c *= mix(1.0, 0.8, smoothstep(0.6, 1.1, length(p * vec2(0.9, 0.7))));
  return c * smoothstep(0.5, 0.494, abs(y));
}`,

  mist: `
vec3 lens(vec2 uv) {
  vec3 c = tx(uv);
  vec3 g = glow(uv) * vec3(1.05, 1.0, 0.96);
  float k = mix(0.3, 1.0, uAmt);
  c = c * (1.0 - 0.07 * k) + 0.035 * k;
  // glow only adds where the picture is darker than its own bloom — a white wall stays a white wall
  vec3 add = clamp(g * k, 0.0, 1.0) * (0.35 + 0.65 * (1.0 - smoothstep(0.55, 1.0, luma(c))));
  return 1.0 - (1.0 - c) * (1.0 - add);
}`,

  star: `
vec3 lens(vec2 uv) {
  vec3 c = tx(uv);
  vec3 g = glow(uv) + glow2(uv);
  g *= mix(0.5, 1.9, uAmt);
  return c + g * vec3(0.96, 0.98, 1.06);
}`,

  prism: `
vec3 lens(vec2 uv) {
  vec2 p = uv - 0.5;
  float r = length(p * vec2(uRes.x / uRes.y, 1.0));
  float k = mix(0.008, 0.05, uAmt) * (0.25 + r * 1.7);
  vec3 c = vec3(tx(0.5 + p * (1.0 + k)).r, tx(uv).g, tx(0.5 + p * (1.0 - k)).b);
  float e = smoothstep(0.16, 0.5, abs(p.x));
  vec2 off = vec2(-sign(p.x) * 0.24, 0.05);
  vec3 gh = vec3(tx(fold(uv + off * 1.07)).r, tx(fold(uv + off)).g, tx(fold(uv + off * 0.93)).b);
  vec3 rb = 0.55 + 0.45 * cos(6.28318 * (p.x * 2.4 + p.y * 0.6 + vec3(0.0, 0.33, 0.67)));
  gh = mix(gh, gh * rb * 1.6, 0.4);
  c = mix(c, 1.0 - (1.0 - c * 0.75) * (1.0 - gh * 0.8), e * mix(0.4, 0.9, uAmt));
  return c;
}`,

  kaleido: `
vec3 lens(vec2 uv) {
  vec2 p = toP(uv);
  float n = floor(mix(3.0, 12.0, uAmt) + 0.5);
  float seg = 6.2831853 / n;
  float a = atan(p.y, p.x) + 1.5707963;
  a = abs(mod(a, seg) - seg * 0.5);
  float r = length(p) * 0.85;
  return tx(fold(toUv(vec2(sin(a), -cos(a)) * r + vec2(0.0, 0.25))));
}`,

  mirror: `
vec3 lens(vec2 uv) {
  vec2 s = uv;
  if (uAmt < 0.34) s.x = 0.5 - abs(s.x - 0.5);
  else if (uAmt < 0.67) s.y = 0.5 - abs(s.y - 0.5);
  else { s.x = 0.5 - abs(s.x - 0.5); s.y = 0.5 - abs(s.y - 0.5); }
  return tx(s);
}`,

  peephole: `
vec3 lens(vec2 uv) {
  vec2 p = toP(uv);
  float r = length(p) / 0.86;
  vec2 d = p / max(length(p), 1e-5);
  float tm = mix(1.1, 1.47, uAmt);
  float rs = tan(min(r, 1.0) * tm) / tan(tm) * 1.7;
  float ca = 0.03 * r * r;
  vec3 c = vec3(tx(fold(toUv(d * rs * (1.0 + ca)))).r, tx(fold(toUv(d * rs))).g, tx(fold(toUv(d * rs * (1.0 - ca)))).b);
  c *= mix(1.0, 0.42, smoothstep(0.4, 1.0, r)) * vec3(1.03, 1.0, 0.9);
  c *= 1.0 - smoothstep(0.93, 1.0, r);
  float ring = smoothstep(0.035, 0.0, abs(r - 1.09)) * 0.07 + smoothstep(0.02, 0.0, abs(r - 1.22)) * 0.03;
  return c + vec3(0.9, 0.8, 0.6) * ring * (0.6 + 0.4 * d.y);
}`,
};

// pre-passes at low resolution: highlights → blur / streaks
const FS_PRE = HEAD + `
uniform vec2 uThresh;
uniform vec2 uPx;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 c = (tx(uv + uPx * vec2(-0.5, -0.5)) + tx(uv + uPx * vec2(0.5, -0.5)) + tx(uv + uPx * vec2(-0.5, 0.5)) + tx(uv + uPx * vec2(0.5, 0.5))) * 0.25;
  if (uThresh.y > 0.0) { float l = mix(luma(c), max(c.r, max(c.g, c.b)), 0.35); c *= smoothstep(uThresh.x, uThresh.x + uThresh.y, l); }
  gl_FragColor = vec4(c, 1.0);
}`;
const FS_STREAK = PRECISION + `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uFall;
uniform float uGain;
void main() {
  vec3 a = vec3(0.0); float ws = 0.0;
  for (int i = -8; i <= 8; i++) {
    float f = float(i);
    float w = exp(-abs(f) * uFall);
    a += texture2D(uTex, vUv + uDir * f).rgb * w; ws += w;
  }
  gl_FragColor = vec4(a / ws * uGain, 1.0);
}`;

// keeps small bright points, drops large bright areas (a white wall must not flare like a lamp)
const FS_SUB = PRECISION + `
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uBlur;
uniform float uK;
void main() {
  vec3 b = texture2D(uBlur, vUv).rgb;
  float area = max(b.r, max(b.g, b.b));
  vec3 c = max(texture2D(uTex, vUv).rgb - b * uK, 0.0) * 1.5;
  gl_FragColor = vec4(c * (1.0 - smoothstep(0.07, 0.26, area)), 1.0);
}`;

function makeRig(canvas) {
  const gl = createGL(canvas, { alpha: false });
  if (!gl) return null;
  return { gl, canvas, progs: new Map(), src: texture(gl), fbo: {}, max: Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, (gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [4096])[0]) };
}
function prog(rig, key, fs) {
  let p = rig.progs.get(key);
  if (!p) { p = program(rig.gl, fs, VS); rig.progs.set(key, p); }
  return p;
}
function fbo(rig, name, w, h) {
  let f = rig.fbo[name];
  if (!f || f.w !== w || f.h !== h) { if (f) f.dispose(); f = rig.fbo[name] = target(rig.gl, w, h); }
  return f;
}
function bindTex(gl, unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
function common(gl, p, o) {
  gl.uniform1i(p.U.uSrc, 0);
  if (p.U.uGlow) gl.uniform1i(p.U.uGlow, 1);
  if (p.U.uGlow2) gl.uniform1i(p.U.uGlow2, 2);
  if (p.U.uCrop) gl.uniform4f(p.U.uCrop, o.crop[0], o.crop[1], o.crop[2], o.crop[3]);
  if (p.U.uMirror) gl.uniform1f(p.U.uMirror, o.mirror ? 1 : 0);
  if (p.U.uRes) gl.uniform2f(p.U.uRes, o.w, o.h);
  if (p.U.uAmt) gl.uniform1f(p.U.uAmt, o.amt);
}
function streak(rig, from, to, dx, dy, fall, gain) {
  const gl = rig.gl, p = prog(rig, 'streak', FS_STREAK);
  gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb); gl.viewport(0, 0, to.w, to.h);
  p.use(); bindTex(gl, 0, from.tex);
  gl.uniform1i(p.U.uTex, 0); gl.uniform2f(p.U.uDir, dx / to.w, dy / to.h); gl.uniform1f(p.U.uFall, fall); gl.uniform1f(p.U.uGain, gain);
  draw(gl);
}

/** Draw lens `id` into the rig's canvas at w × h. `src` is any drawable; crop is in source pixels. */
function run(rig, src, sw, sh, o) {
  const gl = rig.gl, L = lensById(o.id);
  const w = o.w, h = o.h;
  if (rig.canvas.width !== w || rig.canvas.height !== h) { rig.canvas.width = w; rig.canvas.height = h; }
  bindTex(gl, 0, rig.src);
  upload(gl, rig.src, src);
  const u = { crop: [o.crop.x / sw, o.crop.y / sh, o.crop.w / sw, o.crop.h / sh], mirror: o.mirror, w, h, amt: o.amt };
  let gA = null, gB = null;
  if (L.pre) {
    const long = Math.max(192, Math.min(768, Math.round(Math.max(w, h) / 3)));
    const k = long / Math.max(w, h), gw = Math.max(8, Math.round(w * k)), gh = Math.max(8, Math.round(h * k)), s = long / 360;
    const hi = fbo(rig, 'hi', gw, gh), t1 = fbo(rig, 't1', gw, gh), a = fbo(rig, 'a', gw, gh);
    const pre = prog(rig, 'pre', FS_PRE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hi.fb); gl.viewport(0, 0, gw, gh);
    pre.use(); bindTex(gl, 0, rig.src); common(gl, pre, u);
    const th = { blur: [0, 0], bloom: [0.6, 0.38], streak: [0.78, 0.18], star: [0.82, 0.15] }[L.pre];
    gl.uniform2f(pre.U.uThresh, th[0], th[1]); gl.uniform2f(pre.U.uPx, 1 / gw, 1 / gh);
    draw(gl);
    if (L.pre === 'blur' || L.pre === 'bloom') {
      streak(rig, hi, t1, 1.2 * s, 0, 0.28, 1); streak(rig, t1, a, 0, 1.2 * s, 0.28, 1);
      streak(rig, a, t1, 3.5 * s, 0, 0.22, 1); streak(rig, t1, a, 0, 3.5 * s, 0.22, L.pre === 'bloom' ? 1.25 : 1);
      gA = a;
    } else {
      // isolate the points: highlights minus their own wide blur
      const pts = fbo(rig, 'c', gw, gh), sub = prog(rig, 'sub', FS_SUB);
      streak(rig, hi, t1, 4 * s, 0, 0.12, 1); streak(rig, t1, a, 0, 4 * s, 0.12, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pts.fb); gl.viewport(0, 0, gw, gh);
      sub.use(); bindTex(gl, 1, a.tex); bindTex(gl, 0, hi.tex);
      gl.uniform1i(sub.U.uTex, 0); gl.uniform1i(sub.U.uBlur, 1); gl.uniform1f(sub.U.uK, L.pre === 'star' ? 1.05 : 0.95);
      draw(gl);
      if (L.pre === 'streak') {
        streak(rig, pts, t1, 2 * s, 0, 0.2, 1.5); streak(rig, t1, a, 11 * s, 0, 0.24, 1.5);
        gA = a;
      } else {
        const b = fbo(rig, 'b', gw, gh), c1 = Math.cos(0.3) * s, s1 = Math.sin(0.3) * s;
        streak(rig, pts, t1, c1, s1, 0.3, 1.8); streak(rig, t1, a, c1 * 6, s1 * 6, 0.3, 1.8);
        streak(rig, pts, t1, -s1, c1, 0.3, 1.8); streak(rig, t1, b, -s1 * 6, c1 * 6, 0.3, 1.8);
        gA = a; gB = b;
      }
    }
  }
  const p = prog(rig, 'lens:' + L.id, HEAD + (FS[L.id] || FS.none) + TAIL);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
  p.use(); common(gl, p, u);
  bindTex(gl, 1, gA ? gA.tex : rig.src); bindTex(gl, 2, gB ? gB.tex : rig.src); bindTex(gl, 0, rig.src);
  draw(gl);
}

function sizeOf(src) { return [src.videoWidth || src.naturalWidth || src.width, src.videoHeight || src.naturalHeight || src.height]; }

/** The live lens: one WebGL canvas that the film renderer then reads as its source. */
export function createLens() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
  let rig = makeRig(canvas), lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; rig = makeRig(canvas); });
  return {
    canvas,
    get ok() { return !!rig && !lost && !rig.gl.isContextLost(); },
    /** Returns the canvas (cropped, mirrored, lens applied; longest side ≤ maxSize) or null when WebGL is unavailable. */
    render(src, id, amt, { crop, mirror = false, maxSize = 1280 } = {}) {
      if (!this.ok) return null;
      const [sw, sh] = sizeOf(src);
      if (!sw || !sh) return null;
      crop = crop || { x: 0, y: 0, w: sw, h: sh };
      const k = Math.min(1, maxSize / Math.max(crop.w, crop.h), rig.max / Math.max(crop.w, crop.h));
      const w = Math.max(2, Math.round(crop.w * k)), h = Math.max(2, Math.round(crop.h * k));
      try { run(rig, src, sw, sh, { id, amt, crop, mirror, w, h }); } catch (e) { return null; }
      return canvas;
    },
    dispose() { if (rig && !rig.gl.isContextLost()) { const x = rig.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } rig = null; },
  };
}

// stills and thumbnails share one more context, created on first use
let still = null;
function stillRig() {
  if (still && !still.gl.isContextLost()) return still;
  still = makeRig(document.createElement('canvas'));
  return still;
}
/** Largest side a lens still can have on this device (the GPU's texture limit, at most 4096). */
export function lensMaxSize() { const r = stillRig(); return r ? Math.min(4096, r.max) : 0; }

/**
 * Apply a lens to a still at its own resolution (up to the GPU limit).
 * Returns a new 2D canvas (cropped + mirrored as asked), or null when WebGL is unavailable.
 */
export function applyLensStill(src, id, amt, { crop, mirror = false, maxSize = 4096 } = {}) {
  const rig = stillRig();
  if (!rig) return null;
  let [sw, sh] = sizeOf(src);
  if (!sw || !sh) return null;
  crop = crop || { x: 0, y: 0, w: sw, h: sh };
  // a source larger than a texture can be: reduce it once on a 2D canvas
  const lim = Math.min(rig.max, 4096);
  if (Math.max(sw, sh) > lim) {
    const k = lim / Math.max(crop.w, crop.h), c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(crop.w * Math.min(1, k))); c.height = Math.max(2, Math.round(crop.h * Math.min(1, k)));
    c.getContext('2d').drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
    src = c; sw = c.width; sh = c.height; crop = { x: 0, y: 0, w: sw, h: sh };
  }
  const k = Math.min(1, maxSize / Math.max(crop.w, crop.h), lim / Math.max(crop.w, crop.h));
  const w = Math.max(2, Math.round(crop.w * k)), h = Math.max(2, Math.round(crop.h * k));
  run(rig, src, sw, sh, { id, amt, crop, mirror, w, h });
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  out.getContext('2d').drawImage(rig.canvas, 0, 0);
  return out;
}
