// EYAD STUDIO — small WebGL1 helpers shared by the film look engine (film.js)
// and the LUT engine (lut.js). WebGL1 only, so it runs on every browser incl.
// iPhone Safari. One shared offscreen context serves all still-image work, so
// the Studio never piles up GPU contexts (browsers cap them at ~16).

export const QUAD_VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/** Create a WebGL1 context on `canvas` (null when unavailable). */
export function createGL(canvas, opts = {}) {
  const attrs = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false, depth: false, stencil: false, powerPreference: 'default', ...opts };
  let gl = null;
  try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch (e) { gl = null; }
  if (!gl) return null;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  return gl;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('Shader compile failed: ' + log);
  }
  return s;
}

/** Link a program; returns { prog, U (uniform locations by name), use() }. */
export function program(gl, fs, vs = QUAD_VS) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Program link failed: ' + gl.getProgramInfoLog(prog));
  const U = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) || 0;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const name = info.name.replace(/\[0\]$/, '');
    U[name] = gl.getUniformLocation(prog, info.name);
  }
  return {
    prog, U,
    use() {
      gl.useProgram(prog);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    },
  };
}

export function texture(gl, { filter = 'linear' } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // 1×1 placeholder so a bound-but-unfilled texture samples as black, never "incomplete".
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  return t;
}

/** Render target: texture + framebuffer of a given size (RGBA8). */
export function target(gl, w, h) {
  const tex = texture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h, dispose() { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); } };
}

export function draw(gl) { gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }

/** Upload any canvas / image / bitmap / video / ImageData to a texture. */
export function upload(gl, tex, src) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (src && src.data && typeof src.width === 'number' && !(src instanceof HTMLElement)) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data instanceof Uint8Array ? src.data : new Uint8Array(src.data.buffer));
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }
}

// ---------------------------------------------------------------- shared context

let shared = null;

/**
 * The shared offscreen WebGL context for still-image work.
 * Returns { gl, canvas, cache: Map } or null when WebGL is unavailable.
 * `cache` holds per-context objects (programs, textures); it is dropped
 * automatically if the context is lost.
 */
export function sharedGL() {
  if (shared === false) return null;
  if (shared && !shared.gl.isContextLost()) return shared;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const gl = createGL(canvas);
    if (!gl) { shared = false; return null; }
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    const maxView = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [4096, 4096];
    shared = { gl, canvas, cache: new Map(), maxTex, maxTile: Math.max(256, Math.min(2048, maxTex, maxView[0], maxView[1])) };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (shared) shared.cache.clear(); shared = null; });
    return shared;
  } catch (e) {
    shared = false;
    return null;
  }
}

/** Get-or-create a cached per-context object. */
export function cached(ctx, key, make) {
  let v = ctx.cache.get(key);
  if (!v) { v = make(ctx.gl); ctx.cache.set(key, v); }
  return v;
}

/** Natural pixel size of any drawable source. */
export function sourceSize(src) {
  if (!src) return [0, 0];
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) return [src.naturalWidth || src.width, src.naturalHeight || src.height];
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return [src.displayWidth, src.displayHeight];
  return [src.width | 0, src.height | 0];
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
