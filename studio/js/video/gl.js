// EYAD VIDEO — GPU colour pipeline (WebGL). One fragment shader applies the
// clip's colour effects in order: key → sharpen → exposure → white balance →
// lift/gamma/gain → shadows/highlights → brightness/contrast → saturation/
// vibrance → hue → B&W/sepia/invert/tint → vignette → grain.
// Works in every browser with WebGL (including iPhone Safari, which has no
// canvas filters), and the export uses exactly the same path.

const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `precision mediump float;
varying vec2 v; uniform sampler2D t; uniform vec2 texel; uniform float aspect, time;
uniform float bright, contrast, sat, vib, expo, hue, gray, sepia, invert, temp, tint, high, shad, sharp, vig, vigMid, grain;
uniform vec3 lift, gam, gain, tintCol; uniform float tintAmt;
uniform float keyOn, keyTol, keySoft, spill; uniform vec2 keyCbCr;
const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
vec2 cbcr(vec3 c){ return vec2(-0.168736*c.r - 0.331264*c.g + 0.5*c.b, 0.5*c.r - 0.418688*c.g - 0.081312*c.b); }
void main(){
  vec4 s = texture2D(t, v);
  vec3 c = s.a > 0.0 ? s.rgb : vec3(0.0); float a = s.a;
  if (sharp > 0.0) {
    vec3 n = texture2D(t, v + vec2(texel.x, 0.0)).rgb + texture2D(t, v - vec2(texel.x, 0.0)).rgb + texture2D(t, v + vec2(0.0, texel.y)).rgb + texture2D(t, v - vec2(0.0, texel.y)).rgb;
    c = c + (c - n * 0.25) * sharp;
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
  vec3 sp = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  c = mix(c, sp, sepia);
  c = mix(c, 1.0 - c, invert);
  c = mix(c, c * tintCol * 1.6, tintAmt);
  if (vig != 0.0) { vec2 d = (v - 0.5) * vec2(aspect, 1.0); float r = length(d) / length(vec2(aspect * 0.5, 0.5)); c *= 1.0 - vig * smoothstep(vigMid, 1.05, r); }
  if (grain > 0.0) { float n = fract(sin(dot(v * vec2(12.9898, 78.233) + time, vec2(1.0, 1.7))) * 43758.5453) - 0.5; c += n * grain; }
  c = clamp(c, 0.0, 1.0);
  gl_FragColor = vec4(c * a, a);
}`;

export function defaultUniforms() {
  return { bright: 0, contrast: 1, sat: 1, vib: 0, expo: 1, hue: 0, gray: 0, sepia: 0, invert: 0, temp: 0, tint: 0, high: 0, shad: 0, sharp: 0, vig: 0, vigMid: 0.5, grain: 0, lift: [0, 0, 0], gam: [1, 1, 1], gain: [1, 1, 1], tintCol: [1, 1, 1], tintAmt: 0, keyOn: 0, keyTol: 0.08, keySoft: 0.06, spill: 0.5, keyCbCr: [-0.33, -0.42] };
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
  for (const k of ['bright', 'contrast', 'sat', 'vib', 'expo', 'hue', 'gray', 'sepia', 'invert', 'temp', 'tint', 'high', 'shad', 'sharp', 'vig', 'vigMid', 'grain', 'tintAmt', 'keyOn', 'keyTol', 'keySoft', 'spill']) set1(k, u[k]);
  for (const k of ['lift', 'gam', 'gain', 'tintCol']) set3(k, u[k]);
  set2('keyCbCr', u.keyCbCr); set2('texel', [1 / outW, 1 / outH]);
  set1('aspect', outW / outH); set1('time', time % 100);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return canvas;
}

/** RGB (0..1) → CbCr used by the keyer. */
export function toCbCr(r, g, b) { return [-0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 * r - 0.418688 * g - 0.081312 * b]; }
