// EYAD KAMERA — pro controls. Everything here talks to the real camera
// through MediaStreamTrack capabilities (exposure, ISO, shutter, white
// balance, focus, torch, zoom). Browsers only expose what the hardware and
// platform allow — Android Chrome exposes most of it, iPhone and desktop
// webcams expose little — so every control is shown only when it works, and
// the look's own Exposure / Temperature sliders stay as the software fallback.
import { h } from '../core/dom.js';

const getCaps = (t) => { try { return t && t.getCapabilities ? t.getCapabilities() : {}; } catch (e) { return {}; } };
const getSet = (t) => { try { return t && t.getSettings ? t.getSettings() : {}; } catch (e) { return {}; } };
const apply = (t, c) => t.applyConstraints({ advanced: [c] }).catch(() => null);

const fmtShutter = (v) => {
  // exposureTime is in 100 µs units in the spec
  const s = v / 10000;
  return s >= 0.5 ? s.toFixed(1) + ' s' : '1/' + Math.round(1 / Math.max(s, 1e-5));
};

/** Section of manual controls for the live track, or a short note when the camera has none. */
export function proControls(track, { onTorch } = {}) {
  const caps = getCaps(track), set = getSet(track);
  const box = h('div', { class: 'cam-pro' });
  let count = 0;
  const range = (label, key, fmt, { depends } = {}) => {
    const c = caps[key];
    if (!c || typeof c.min !== 'number' || !(c.max > c.min)) return null;
    count++;
    const val = set[key] ?? c.min;
    const out = h('output', { class: 'cam-val', text: fmt(val) });
    const r = h('input', { class: 'studio-range', type: 'range', min: c.min, max: c.max, step: c.step || (c.max - c.min) / 100, value: val, 'aria-label': label });
    let pending = null, want = null;
    const push = async () => {
      if (pending) return;
      while (want !== null) { const v = want; want = null; pending = apply(track, { ...(depends ? depends() : {}), [key]: v }); await pending; pending = null; }
    };
    r.addEventListener('input', () => { out.textContent = fmt(+r.value); want = +r.value; push(); });
    return h('div', { class: 'cam-slider' }, h('span', { class: 'cam-slider-label', text: label }), out, r);
  };
  const modeSel = (label, key, names) => {
    const list = caps[key];
    if (!Array.isArray(list) || list.length < 2) return null;
    count++;
    const sel = h('select', { class: 'studio-input', 'aria-label': label, onchange: () => apply(track, { [key]: sel.value }) },
      list.map((m) => h('option', { value: m, text: names[m] || m, selected: set[key] === m })));
    return h('label', { class: 'cam-field' }, h('span', { text: label }), sel);
  };
  const MODES = { continuous: 'Auto', manual: 'Manual', 'single-shot': 'Single shot', none: 'Off' };
  box.append(...[
    range('Exposure ±', 'exposureCompensation', (v) => (v > 0 ? '+' : '') + (+v).toFixed(1) + ' EV'),
    modeSel('Exposure', 'exposureMode', MODES),
    range('Shutter', 'exposureTime', fmtShutter, { depends: () => (caps.exposureMode && caps.exposureMode.includes('manual') ? { exposureMode: 'manual' } : {}) }),
    range('ISO', 'iso', (v) => String(Math.round(v)), { depends: () => (caps.exposureMode && caps.exposureMode.includes('manual') ? { exposureMode: 'manual' } : {}) }),
    modeSel('White balance', 'whiteBalanceMode', MODES),
    range('Kelvin', 'colorTemperature', (v) => Math.round(v) + ' K', { depends: () => (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('manual') ? { whiteBalanceMode: 'manual' } : {}) }),
    modeSel('Focus', 'focusMode', MODES),
    range('Focus distance', 'focusDistance', (v) => (+v).toFixed(2) + ' m', { depends: () => (caps.focusMode && caps.focusMode.includes('manual') ? { focusMode: 'manual' } : {}) }),
    range('Brightness', 'brightness', (v) => String(Math.round(v))),
    range('Contrast', 'contrast', (v) => String(Math.round(v))),
    range('Saturation', 'saturation', (v) => String(Math.round(v))),
    range('Sharpness', 'sharpness', (v) => String(Math.round(v))),
  ].filter(Boolean));
  if (caps.torch) {
    count++;
    const chk = h('input', { type: 'checkbox', checked: !!set.torch, onchange: () => { apply(track, { torch: chk.checked }); onTorch && onTorch(chk.checked); } });
    box.append(h('label', { class: 'cam-field is-check' }, h('span', { text: 'Torch (always on)' }), chk));
  }
  const s = getSet(track);
  const info = [s.width && s.height ? `${s.width}×${s.height}` : '', s.frameRate ? Math.round(s.frameRate) + ' fps' : '', track && track.label ? track.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/i, '') : ''].filter(Boolean).join(' · ');
  if (!count) box.append(h('p', { class: 'cam-note', text: 'This camera does not expose manual controls to the browser (usual on iPhone and webcams). Use Exposure and Temperature in the look below — they work on every device.' }));
  if (info) box.append(h('p', { class: 'cam-note is-mono', text: info }));
  return box;
}

/** Tap to focus / meter at a point (normalised 0..1). Resolves true when the camera accepted it. */
export async function focusAt(track, x, y) {
  if (!track) return false;
  const caps = getCaps(track);
  const c = { pointsOfInterest: [{ x, y }] };
  if (caps.focusMode && caps.focusMode.includes('single-shot')) c.focusMode = 'single-shot';
  if (caps.exposureMode && caps.exposureMode.includes('continuous')) c.exposureMode = 'continuous';
  try { await track.applyConstraints({ advanced: [c] }); return true; } catch (e) { return false; }
}

/** Luminance + RGB histogram of a canvas into a small canvas. */
export function drawHistogram(src, out) {
  const s = 64, k = document.createElement('canvas');
  k.width = s; k.height = Math.max(1, Math.round(s * src.height / Math.max(1, src.width)));
  const g = k.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, k.width, k.height);
  const d = g.getImageData(0, 0, k.width, k.height).data;
  const R = new Uint32Array(64), G = new Uint32Array(64), B = new Uint32Array(64), L = new Uint32Array(64);
  for (let i = 0; i < d.length; i += 4) { R[d[i] >> 2]++; G[d[i + 1] >> 2]++; B[d[i + 2] >> 2]++; L[(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) >> 2]++; }
  const max = Math.max(1, ...L, ...R, ...G, ...B);
  const o = out.getContext('2d'), W = out.width, H = out.height;
  o.clearRect(0, 0, W, H);
  o.globalCompositeOperation = 'lighter';
  for (const [arr, col] of [[R, 'rgba(255,70,70,.7)'], [G, 'rgba(70,255,120,.7)'], [B, 'rgba(80,140,255,.75)'], [L, 'rgba(255,255,255,.55)']]) {
    o.fillStyle = col; o.beginPath(); o.moveTo(0, H);
    for (let i = 0; i < 64; i++) o.lineTo(i / 63 * W, H - Math.sqrt(arr[i] / max) * H);
    o.lineTo(W, H); o.closePath(); o.fill();
  }
  o.globalCompositeOperation = 'source-over';
  // clipping warning: > 2% pure white or black
  const n = d.length / 4;
  return { clipHi: L[63] / n > 0.02, clipLo: L[0] / n > 0.02 };
}

let actx = null;
/** Short synthesized shutter click (no audio file needed). */
export function shutterSound() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, len = 0.07;
    const buf = actx.createBuffer(1, Math.round(actx.sampleRate * len), actx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) { const p = i / ch.length; ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 3) * (p < 0.08 ? 1 : 0.55); }
    const src = actx.createBufferSource(); src.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
    const gn = actx.createGain(); gn.gain.setValueAtTime(0.5, t);
    src.connect(f).connect(gn).connect(actx.destination); src.start(t);
  } catch (e) { /* sound is optional */ }
}

/** Horizon level from the device's orientation sensor (degrees of roll), or null when unavailable. */
export function watchLevel(cb) {
  if (typeof DeviceOrientationEvent === 'undefined') return () => {};
  const on = (e) => {
    if (e.gamma == null || e.beta == null) return;
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    // roll relative to the current screen orientation
    let roll = ang === 90 ? -e.beta : ang === -90 || ang === 270 ? e.beta : e.gamma;
    if (Math.abs(e.beta) > 150 && !ang) roll = -roll;
    cb(Math.max(-45, Math.min(45, roll)));
  };
  addEventListener('deviceorientation', on);
  return () => removeEventListener('deviceorientation', on);
}
