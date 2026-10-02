// EYAD VIDEO — GPU colour pipeline (WebGL). One fragment shader applies the
// clip's effects in order: geometry (mirror, pixelate, glitch, VHS, CRT) →
// RGB split → bloom → key → sharpen → exposure → white balance →
// lift/gamma/gain → shadows/highlights → brightness/contrast → saturation/
// vibrance → hue → B&W/sepia/invert/tint → duotone/night vision/posterize/halftone/scanlines/
// old film/light leak → vignette → grain.
// Works in every browser with WebGL (including iPhone Safari, which has no
// canvas filters), and the export uses exactly the same path.

const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v; uniform sampler2D t; uniform vec2 texel; uniform float aspect, time;
uniform float bright, contrast, sat, vib, expo, hue, gray, sepia, invert, temp, tint, high, shad, sharp, vig, vigMid, grain;
uniform vec3 lift, gam, gain, tintCol; uniform float tintAmt;
uniform float keyOn, keyTol, keySoft, spill; uniform vec2 keyCbCr;
// stylize (all sizes are fractions of the clip height, so preview and export match)
uniform float mirror, pix, split, splitAng, glitch, vhs, poster, dither, duoAmt, nv, scan, scanN, crt, htone, halfSize, oldFilm, leak, leakHue, blocky, bloom, bloomThr, bloomRad, lumaIn;
uniform vec3 duoA, duoB;
const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
vec2 cbcr(vec3 c){ return vec2(-0.168736*c.r - 0.331264*c.g + 0.5*c.b, 0.5*c.r - 0.418688*c.g - 0.081312*c.b); }
float h1(float n){ return fract(sin(mod(n, 289.0) * 12.9898) * 43758.5453); }
float h2(vec2 p){ return fract(sin(dot(mod(p, 289.0), vec2(12.9898, 78.233))) * 43758.5453); }
float b2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }
vec3 hue3(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
vec4 S(vec2 p){
  if (crt > 0.0 && (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0)) return vec4(0.0); // outside the curved tube
  return texture2D(t, clamp(p, 0.0, 1.0));
}
void main(){
  vec2 uv = v;
  float tt = floor(time * 12.0);
  // ---- geometry: CRT curve, mirror, pixelate, glitch, VHS wobble
  if (crt > 0.0) { vec2 d = uv - 0.5; uv = 0.5 + d * (1.0 + crt * 0.35 * dot(d, d)); }
  if (mirror > 0.5) {
    if (mirror < 1.5) uv.x = 0.5 - abs(uv.x - 0.5);
    else if (mirror < 2.5) uv.x = 0.5 + abs(uv.x - 0.5);
    else if (mirror < 3.5) uv.y = 0.5 + abs(uv.y - 0.5);
    else if (mirror < 4.5) uv.y = 0.5 - abs(uv.y - 0.5);
    else if (mirror < 5.5) uv = 0.5 - abs(uv - 0.5);
    else { // kaleidoscope: fold the angle into 6 mirrored wedges
      vec2 d = (uv - 0.5) * vec2(aspect, 1.0); float r = length(d), a = atan(d.y, d.x);
      float seg = 3.14159265 / 3.0; a = mod(a, seg * 2.0); a = abs(a - seg);
      d = r * vec2(cos(a), sin(a)); uv = clamp(d / vec2(aspect, 1.0) + 0.5, 0.0, 1.0);
    }
  }
  if (glitch > 0.0) {
    float row = floor(uv.y * (6.0 + 18.0 * h1(tt)));
    float r1 = h2(vec2(row, tt));
    if (r1 < glitch * 0.35) uv.x = fract(uv.x + (h2(vec2(row + 7.0, tt)) - 0.5) * glitch * 0.3);
    float r2 = h2(vec2(floor(uv.y * 3.0), tt + 3.0));
    if (r2 < glitch * 0.25) uv.y = fract(uv.y + (h1(tt + 5.0) - 0.5) * 0.2 * glitch);
  }
  if (vhs > 0.0) {
    uv.x += sin(uv.y * 90.0 + time * 9.0) * 0.0012 * vhs;
    float band = fract(time * 0.23);                       // tracking band drifting up the frame
    float bd = abs(uv.y - band);
    uv.x += (h2(vec2(floor(uv.y * 240.0), tt)) - 0.5) * 0.04 * vhs * smoothstep(0.06, 0.0, bd);
    if (uv.y < 0.035) uv.x += (h2(vec2(floor(uv.y * 400.0), tt)) - 0.5) * 0.12 * vhs; // head-switching noise
  }
  vec2 cell = vec2(0.0);
  if (pix > 0.0) { cell = vec2(pix / aspect, pix); uv = (floor(uv / cell) + 0.5) * cell; }
  vec4 s = S(uv);
  float sp = split + glitch * 0.012 * h1(tt + 1.0) + vhs * 0.004;
  if (sp > 0.0) {
    vec2 o = vec2(cos(splitAng), sin(splitAng)) * sp * vec2(1.0 / aspect, 1.0);
    vec4 sr = S(uv + o), sb = S(uv - o);
    s.r = sr.r; s.b = sb.b; s.a = max(s.a, max(sr.a, sb.a) * 0.75);
  }
  vec3 c = s.a > 0.0 ? s.rgb : vec3(0.0); float a = s.a;
  if (vhs > 0.0) { // chroma bleed: smear colour sideways, keep luma sharp
    vec3 m = (S(uv + vec2(0.006, 0.0)).rgb + S(uv + vec2(0.012, 0.0)).rgb + S(uv - vec2(0.004, 0.0)).rgb + c) * 0.25;
    float Lc = dot(c, LW); c = mix(c, vec3(Lc) + (m - dot(m, LW)) * 1.15, vhs);
  }
  if (blocky > 0.0) { // JPEG-like: chroma comes from coarse 8-pixel macroblocks
    vec2 bc = max(cell, vec2(texel.x, texel.y) * 1.0) * 8.0; if (pix <= 0.0) bc = vec2(0.02 / aspect, 0.02);
    vec2 bu = (floor(v / bc) + 0.5) * bc; vec3 bs = S(bu).rgb;
    float Lc = dot(c, LW); c = mix(c, vec3(Lc) + (bs - dot(bs, LW)), blocky);
    c += (h2(floor(v / bc) + tt) - 0.5) * 0.06 * blocky;
  }
  if (sharp > 0.0) {
    vec3 n = texture2D(t, uv + vec2(texel.x, 0.0)).rgb + texture2D(t, uv - vec2(texel.x, 0.0)).rgb + texture2D(t, uv + vec2(0.0, texel.y)).rgb + texture2D(t, uv - vec2(0.0, texel.y)).rgb;
    c = c + (c - n * 0.25) * sharp;
  }
  if (bloom > 0.0) { // threshold glow: 12 taps on two rings
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float an = float(i) * 0.5236 + 0.26; float rr = bloomRad * (mod(float(i), 2.0) < 0.5 ? 1.0 : 0.5);
      vec3 q = S(uv + vec2(cos(an) / aspect, sin(an)) * rr).rgb;
      acc += max(q - bloomThr, 0.0);
    }
    c += acc / 12.0 * bloom * 2.2 / max(0.05, 1.0 - bloomThr);
  }
  if (keyOn > 0.5) {
    float d = distance(cbcr(c), keyCbCr);
    float m = smoothstep(keyTol, keyTol + keySoft + 0.0001, d);
    a *= m;
    // spill suppression: pull the key colour out of the remaining edges
    if (spill > 0.0) { float L = dot(c, LW); c = mix(c, vec3(L), (1.0 - m) * spill); }
  }
  c *= expo;
  c.r *= 1.0 + temp * 0.3; c.b *= 1.0 - temp * 0.3; c.g *= 1.0 - tint * 0.25; c.rb *= 1.0 + tint * 0.08;
  c = max(c * gain + lift * (1.0 - c), 0.0);
  c = pow(c, 1.0 / max(gam, vec3(0.05)));
  float L = dot(c, LW);
  c += shad * (1.0 - smoothstep(0.0, 0.55, L)) * 0.35;
  c += high * smoothstep(0.45, 1.0, L) * 0.35;
  c += bright;
  c = (c - 0.5) * contrast + 0.5;
  L = dot(c, LW);
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  c = mix(vec3(L), c, sat + vib * (1.0 - clamp(mx - mn, 0.0, 1.0)));
  if (hue != 0.0) {
    float cs = cos(hue), sn = sin(hue);
    mat3 m = mat3(0.213 + cs*0.787 - sn*0.213, 0.213 - cs*0.213 + sn*0.143, 0.213 - cs*0.213 - sn*0.787,
                  0.715 - cs*0.715 - sn*0.715, 0.715 + cs*0.285 + sn*0.140, 0.715 - cs*0.715 + sn*0.715,
                  0.072 - cs*0.072 + sn*0.928, 0.072 - cs*0.072 - sn*0.283, 0.072 + cs*0.928 + sn*0.072);
    c = m * c;
  }
  L = dot(c, LW);
  c = mix(c, vec3(L), gray);
  vec3 sp3 = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  c = mix(c, sp3, sepia);
  c = mix(c, 1.0 - c, invert);
  c = mix(c, c * tintCol * 1.6, tintAmt);
  c = clamp(c, 0.0, 1.0);
  // ---- stylize (after the grade)
  if (duoAmt > 0.0) { L = dot(c, LW); c = mix(c, mix(duoA, duoB, smoothstep(0.02, 0.98, L)), duoAmt); }
  if (nv > 0.0) {
    L = dot(c, LW); vec3 g = vec3(0.08, 1.0, 0.18) * pow(L, 0.8) * 1.5;
    g += (h2(v * 311.0 + tt) - 0.5) * 0.18;
    g *= 0.86 + 0.14 * sin(v.y * 3.14159 * 420.0);
    c = mix(c, max(g, 0.0), nv);
  }
  if (poster > 0.0) {
    float th = dither > 0.0 ? (bayer(v / max(cell, texel)) - 0.47) * dither : 0.0;
    c = floor(c * poster + 0.5 + th) / poster;
  }
  if (htone > 0.0) {
    float hs = max(halfSize, 0.002);
    vec2 q = vec2(v.x * aspect, v.y) / hs; q = vec2(q.x * 0.7071 - q.y * 0.7071, q.x * 0.7071 + q.y * 0.7071);
    float d = length(fract(q) - 0.5); L = dot(c, LW);
    float rad = sqrt(1.0 - L) * 0.68; float dotv = smoothstep(rad + 0.06, rad - 0.06, d);
    c = mix(c, mix(vec3(0.96, 0.95, 0.9), c * 0.35, dotv), htone);
  }
  if (scan > 0.0) {
    float ln = sin(v.y * 3.14159 * scanN); c *= 1.0 - scan * (0.5 - 0.5 * ln);
    if (crt > 0.0) { float mk = mod(floor(v.x / texel.x), 3.0); c *= 1.0 + crt * 0.12 * (mk < 0.5 ? vec3(1.0, -0.5, -0.5) : mk < 1.5 ? vec3(-0.5, 1.0, -0.5) : vec3(-0.5, -0.5, 1.0)); }
  }
  if (vhs > 0.0) {
    c *= 1.0 - vhs * 0.12 * (0.5 - 0.5 * sin(v.y * 3.14159 * 480.0));
    float bd = abs(v.y - fract(time * 0.23));
    c += (h2(vec2(floor(v.x * 300.0), floor(v.y * 240.0) + tt)) - 0.3) * 0.5 * vhs * smoothstep(0.03, 0.0, bd);
    c = mix(c, vec3(dot(c, LW)) * vec3(1.02, 1.0, 1.05) + 0.03, vhs * 0.12);
  }
  if (oldFilm > 0.0) {
    float f24 = floor(time * 18.0);
    c *= 1.0 - oldFilm * 0.22 * h1(f24);                    // exposure flicker
    float sx = h1(f24 * 1.7), sx2 = h1(f24 * 0.31 + 4.0);  // vertical scratches
    float sc = smoothstep(0.0018, 0.0, abs(v.x - sx)) * step(0.55, h1(f24 + 9.0)) + smoothstep(0.001, 0.0, abs(v.x - sx2)) * step(0.4, h1(f24 + 2.0));
    c += sc * 0.45 * oldFilm;
    vec2 dp = vec2(h1(f24 + 11.0), h1(f24 + 17.0));          // dust specks
    float dd = length((v - dp) * vec2(aspect, 1.0));
    c -= smoothstep(0.012, 0.004, dd) * 0.6 * oldFilm * step(0.5, h1(f24 + 23.0));
  }
  if (leak > 0.0) {
    vec2 lp = vec2(0.15 + 0.7 * (0.5 + 0.5 * sin(time * 0.7)), 0.3 + 0.4 * (0.5 + 0.5 * cos(time * 0.45)));
    float d1 = length((v - lp) * vec2(aspect, 1.0)); float d2 = length((v - vec2(1.0 - lp.x, lp.y * 0.6)) * vec2(aspect, 1.0));
    vec3 lc = hue3(leakHue) * 0.75 + 0.25;
    vec3 add = lc * smoothstep(0.75, 0.0, d1) + hue3(fract(leakHue + 0.08)) * 0.6 * smoothstep(0.55, 0.0, d2);
    add *= leak; c = 1.0 - (1.0 - c) * (1.0 - clamp(add, 0.0, 1.0));
  }
  if (vig != 0.0) { vec2 d = (v - 0.5) * vec2(aspect, 1.0); float r = length(d) / length(vec2(aspect * 0.5, 0.5)); c *= 1.0 - vig * smoothstep(vigMid, 1.05, r); }
  if (grain > 0.0) { float n = fract(sin(dot(v * vec2(12.9898, 78.233) + time, vec2(1.0, 1.7))) * 43758.5453) - 0.5; c += n * grain; }
  if (lumaIn < 1.0) { L = dot(c, LW); a *= smoothstep(1.0 - lumaIn * 1.25, 1.0 - lumaIn * 1.25 + 0.25, L); }
  c = clamp(c, 0.0, 1.0);
  gl_FragColor = vec4(c * a, a);
}`;

export function defaultUniforms() {
  return { bright: 0, contrast: 1, sat: 1, vib: 0, expo: 1, hue: 0, gray: 0, sepia: 0, invert: 0, temp: 0, tint: 0, high: 0, shad: 0, sharp: 0, vig: 0, vigMid: 0.5, grain: 0, lift: [0, 0, 0], gam: [1, 1, 1], gain: [1, 1, 1], tintCol: [1, 1, 1], tintAmt: 0, keyOn: 0, keyTol: 0.08, keySoft: 0.06, spill: 0.5, keyCbCr: [-0.33, -0.42],
    mirror: 0, pix: 0, split: 0, splitAng: 0, glitch: 0, vhs: 0, poster: 0, dither: 0, duoAmt: 0, duoA: [0, 0, 0], duoB: [1, 1, 1], nv: 0, scan: 0, scanN: 240, crt: 0, htone: 0, halfSize: 0.012, oldFilm: 0, leak: 0, leakHue: 0.07, blocky: 0, bloom: 0, bloomThr: 0.6, bloomRad: 0.03, lumaIn: 1 };
}

let ctx = null;
function init() {
  if (ctx !== null) return ctx;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) { ctx = false; return ctx; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const U = {}; const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); U[info.name] = gl.getUniformLocation(prog, info.name); }
    const stage = document.createElement('canvas');
    ctx = { gl, canvas, U, stage };
  } catch (e) { console.warn('EYAD VIDEO: WebGL colour pipeline unavailable —', e.message); ctx = false; }
  return ctx;
}
export function glAvailable() { return !!init(); }

/**
 * Process a (cropped) source region through the colour pipeline.
 * Returns a canvas of size outW×outH (premultiplied) or null when WebGL is missing.
 */
export function glProcess(src, sx, sy, sw, sh, outW, outH, u, time = 0) {
  const c = init(); if (!c) return null;
  const { gl, canvas, U, stage } = c;
  outW = Math.max(1, Math.min(4096, Math.round(outW))); outH = Math.max(1, Math.min(4096, Math.round(outH)));
  // crop + scale on a 2D stage first (keeps GPU uploads at output size)
  if (stage.width !== outW || stage.height !== outH) { stage.width = outW; stage.height = outH; }
  const sg = stage.getContext('2d');
  sg.clearRect(0, 0, outW, outH);
  sg.imageSmoothingQuality = 'high';
  try { sg.drawImage(src, sx, sy, sw, sh, 0, 0, outW, outH); } catch (e) { return null; }
  if (canvas.width !== outW || canvas.height !== outH) { canvas.width = outW; canvas.height = outH; }
  gl.viewport(0, 0, outW, outH);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage); } catch (e) { return null; }
  const set1 = (k, v) => U[k] && gl.uniform1f(U[k], v);
  const set2 = (k, v) => U[k] && gl.uniform2f(U[k], v[0], v[1]);
  const set3 = (k, v) => U[k] && gl.uniform3f(U[k], v[0], v[1], v[2]);
  for (const k of ['bright', 'contrast', 'sat', 'vib', 'expo', 'hue', 'gray', 'sepia', 'invert', 'temp', 'tint', 'high', 'shad', 'sharp', 'vig', 'vigMid', 'grain', 'tintAmt', 'keyOn', 'keyTol', 'keySoft', 'spill', 'mirror', 'pix', 'split', 'splitAng', 'glitch', 'vhs', 'poster', 'dither', 'duoAmt', 'nv', 'scan', 'scanN', 'crt', 'htone', 'halfSize', 'oldFilm', 'leak', 'leakHue', 'blocky', 'bloom', 'bloomThr', 'bloomRad', 'lumaIn']) set1(k, u[k]);
  for (const k of ['lift', 'gam', 'gain', 'tintCol', 'duoA', 'duoB']) set3(k, u[k]);
  set2('keyCbCr', u.keyCbCr); set2('texel', [1 / outW, 1 / outH]);
  set1('aspect', outW / outH); set1('time', time % 100);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return canvas;
}

/** RGB (0..1) → CbCr used by the keyer. */
export function toCbCr(r, g, b) { return [-0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 * r - 0.418688 * g - 0.081312 * b]; }
