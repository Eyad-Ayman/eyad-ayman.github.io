// EYAD KAMERA — live camera with Film Lab looks (loaded only on /studio/camera/).
// Live preview through film.js, full-resolution capture, short video recording,
// "Open photo" for existing images, .cube LUT import, and hand-off to EYAD IMAGE / VIDEO.
import { h, clear, clamp, isTyping } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, iconButton, contextMenu } from '../core/ui.js';
import { bootStudio, ROUTES } from '../core/shell.js';
import { pickFiles, downloadBlob, ACCEPT, IS_TOUCH, detectFile, loadImageFile, sanitizeFilename, baseName } from '../core/files.js';
import { putHandoff } from '../core/db.js';
import {
  LOOKS, LOOK_PARAMS, FRAMES, getLook, defaultParams, applyLook, createLiveRenderer,
  lookThumbnail, looksByGroup, registerLook, todayStamp, sanitizeDateText,
} from '../core/film.js';
import { BUILTIN_LUTS, readCubeFile, lutToLook, getBuiltinLut } from '../core/lut.js';
import { FX, fxById, compose, loadSegmenter, segmenterReady, liveMask, applyFxStill } from './fx.js';
import { proControls, focusAt, drawHistogram, shutterSound, watchLevel } from './pro.js';
import { alignFrames, parallaxOf, synthViews, lensCharacter, filmStrip, wiggleVideo, wiggleGif, PING } from './wiggle.js';
import { segment } from '../core/ai.js';
import { maskCanvas } from './fx.js';

bootStudio();

const STORE = 'eyad-camera:v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; } })();
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify({ look: state.lookId, aspect: state.aspect, grid: state.grid, timer: state.timer, flash: state.flash, facing: state.facing, fx: state.fx, deviceId: state.deviceId, quadMethod: state.quadMethod, sound: state.sound, hist: state.hist, level: state.level, quality: state.quality })); } catch (e) { /* storage blocked */ } };

const ASPECTS = [
  { id: '3:4', label: '3:4', r: 3 / 4 }, { id: '4:3', label: '4:3', r: 4 / 3 }, { id: '1:1', label: '1:1', r: 1 },
  { id: '9:16', label: '9:16', r: 9 / 16 }, { id: '16:9', label: '16:9', r: 16 / 9 },
];
const PHOTO_ASPECTS = [{ id: 'orig', label: 'Original', r: 0 }, ...ASPECTS];
const TIMERS = [0, 3, 10];
const MAX_REC = 180;

const state = {
  mode: 'photo',                 // 'photo' | 'video'
  source: 'camera',              // 'camera' | 'file'
  facing: saved.facing === 'user' ? 'user' : 'environment',
  lookId: getLook(saved.look) && LOOKS.some((l) => l.id === saved.look) ? saved.look : 'portrait-400',
  params: null,
  aspect: ASPECTS.some((a) => a.id === saved.aspect) ? saved.aspect : (matchMedia('(orientation: portrait)').matches ? '3:4' : '4:3'),
  photoAspect: 'orig',
  grid: !!saved.grid,
  timer: TIMERS.includes(saved.timer) ? saved.timer : 0,
  flash: !!saved.flash,
  fx: FX.some((f) => f.id === saved.fx) ? saved.fx : 'none',
  deviceId: typeof saved.deviceId === 'string' ? saved.deviceId : '',
  sound: saved.sound !== false, hist: !!saved.hist, level: saved.level !== false,
  quality: ['max', 'high', 'standard'].includes(saved.quality) ? saved.quality : 'max',
  shots: [], preFx: null, pausedByHide: false,
  quadMethod: ['auto', 'sweep', 'depth'].includes(saved.quadMethod) ? saved.quadMethod : 'auto',
  stream: null, track: null, caps: null, zoom: 1,
  photo: null, photoName: '',
  busy: false, recording: null, cameras: 0,
  dateText: todayStamp(),
  lutChoice: '', importedLuts: [],
};
state.params = defaultParams(state.lookId);
state.params.dateText = state.dateText;

// ---------------------------------------------------------------- tiny local icons (not in the shared set)
const NS = 'http://www.w3.org/2000/svg';
function glyph(d, size = 18) {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'studio-icon' })) s.setAttribute(k, v);
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p);
  return s;
}
const FLASH = 'M13 2 5 13h6l-1 9 8-11h-6z';
const FLASH_OFF = 'M13 2 9.5 7M5 13h6l-1 9 4-5.5M15 11h3l-2.8 3.8M3 3l18 18';

// ---------------------------------------------------------------- DOM
const body = document.body;
const video = h('video', { class: 'cam-video', playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' });
video.muted = true; video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
const view = h('canvas', { class: 'cam-view', 'aria-label': 'Live preview with the selected look', role: 'img' });
const gridEl = h('div', { class: 'cam-grid', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
const fxView = h('canvas', { class: 'cam-view cam-fxview', hidden: true, 'aria-hidden': 'true' });
const viewBox = h('div', { class: 'cam-viewbox' }, view, fxView, gridEl);
const countdown = h('div', { class: 'cam-countdown', 'aria-live': 'assertive' });
const messageEl = h('div', { class: 'cam-message', hidden: true });
const zoomRange = h('input', { class: 'studio-range cam-zoom-range', type: 'range', min: 1, max: 1, step: 0.1, value: 1, 'aria-label': 'Zoom' });
const zoomLabel = h('span', { class: 'cam-zoom-label', text: '1×' });
const zoomBox = h('div', { class: 'cam-zoom', hidden: true }, zoomLabel, zoomRange);
const focusRing = h('div', { class: 'cam-focus', 'aria-hidden': 'true' });
const histCanvas = h('canvas', { class: 'cam-hist', width: 128, height: 64, hidden: true, 'aria-hidden': 'true' });
const levelEl = h('div', { class: 'cam-level', hidden: true, 'aria-hidden': 'true' }, h('i'));
const zoomChips = h('div', { class: 'cam-zoomchips', hidden: true });
const quadDots = [0, 1, 2, 3].map(() => h('i'));
const quadMethodBtn = h('button', { class: 'cam-quad-method', type: 'button', title: 'How the four viewpoints are made', onclick: () => { const o = ['auto', 'sweep', 'depth']; state.quadMethod = o[(o.indexOf(state.quadMethod) + 1) % 3]; persist(); syncQuad(); } });
const quadHud = h('div', { class: 'cam-quad', hidden: true }, h('div', { class: 'cam-quad-lenses', 'aria-hidden': 'true' }, quadDots), quadMethodBtn);
let quadTipShown = false;
function syncQuad() { quadMethodBtn.textContent = { auto: 'Auto', sweep: 'Sweep (move sideways)', depth: 'AI depth (hold still)' }[state.quadMethod]; }
const stage = h('div', { class: 'cam-stage' }, video, viewBox, focusRing, histCanvas, levelEl, quadHud, messageEl, zoomChips, zoomBox, countdown);
const flashEl = h('div', { class: 'cam-flash', 'aria-hidden': 'true' });
const recBadge = h('div', { class: 'cam-rec', hidden: true }, h('span', { class: 'cam-rec-dot' }), h('span', { class: 'cam-rec-time', text: '0:00' }));

const btnGrid = iconButton('grid', 'Grid', () => { state.grid = !state.grid; syncTop(); persist(); }, { cls: 'cam-tool' });
const btnTimer = h('button', { class: 'studio-icon-btn cam-tool cam-timer', type: 'button', 'aria-label': 'Self-timer', title: 'Self-timer', onclick: () => { state.timer = TIMERS[(TIMERS.indexOf(state.timer) + 1) % TIMERS.length]; syncTop(); persist(); } }, icon('clock', 18), h('span', { class: 'cam-tool-badge' }));
const btnFlash = h('button', { class: 'studio-icon-btn cam-tool', type: 'button', 'aria-label': 'Flash', title: 'Flash', onclick: () => { state.flash = !state.flash; syncTop(); persist(); } });
const btnAspect = h('button', { class: 'cam-chip cam-aspect', type: 'button', 'aria-label': 'Aspect ratio', title: 'Aspect ratio', onclick: cycleAspect });
const btnAdjust = iconButton('sliders', 'Adjust look & camera', () => togglePanel(), { cls: 'cam-tool cam-adjust-btn' });
const btnHist = iconButton('audioWave', 'Histogram', () => { state.hist = !state.hist; syncTop(); persist(); }, { cls: 'cam-tool' });
const btnCams = iconButton('camera', 'Choose camera', (e) => pickCamera(e), { cls: 'cam-tool' });
const btnPhoto = iconButton('image', 'Open a photo', () => openPhoto(), { cls: 'cam-tool' });
const btnMore = iconButton('dots', 'More', (e) => moreMenu(e), { cls: 'cam-tool' });
const homeLink = h('a', { class: 'cam-home', href: ROUTES.home, 'aria-label': 'EYAD STUDIO home' }, icon('back', 18));
const brand = h('a', { class: 'studio-brand cam-brand', href: ROUTES.home, 'aria-label': 'EYAD KAMERA — Studio home' },
  h('span', { class: 'studio-brand-mark', 'aria-hidden': 'true' }),
  h('span', { class: 'studio-brand-word' }, 'EYAD', h('span', { class: 'studio-brand-app', text: 'KAMERA' })));
const top = h('header', { class: 'cam-top' }, homeLink, brand, recBadge, h('div', { class: 'studio-spacer' }), btnAspect, btnFlash, btnTimer, btnGrid, btnHist, btnCams, btnPhoto, btnMore, btnAdjust);

const lookName = h('div', { class: 'cam-lookname', 'aria-live': 'polite' });
const chips = h('div', { class: 'cam-groups', role: 'tablist', 'aria-label': 'Look groups' });
const strip = h('div', { class: 'cam-strip', role: 'listbox', 'aria-label': 'Looks' });
const modePhoto = h('button', { class: 'cam-mode', type: 'button', text: 'Photo', onclick: () => setMode('photo') });
const modeVideo = h('button', { class: 'cam-mode', type: 'button', text: 'Video', onclick: () => setMode('video') });
const modePortrait = h('button', { class: 'cam-mode', type: 'button', text: 'Portrait', onclick: () => setMode('portrait') });
const modeBurst = h('button', { class: 'cam-mode', type: 'button', text: 'Burst', onclick: () => setMode('burst') });
const modeQuad = h('button', { class: 'cam-mode', type: 'button', text: '3D ×4', title: 'Quad 3D — four-lens stereo camera (N8000 style wigglegram)', onclick: () => setMode('quad') });
const modes = h('div', { class: 'cam-modes', role: 'group', 'aria-label': 'Capture mode' }, modeBurst, modeQuad, modePhoto, modePortrait, modeVideo);
const shutter = h('button', { class: 'cam-shutter', type: 'button', 'aria-label': 'Take photo', onclick: onShutter }, h('span'));
const btnOpen = h('button', { class: 'cam-round cam-gallery', type: 'button', 'aria-label': 'Open a photo', title: 'Open a photo', onclick: () => (state.shots.length ? openGallery(state.shots.length - 1) : openPhoto()) }, icon('image', 22));
const btnFlip = h('button', { class: 'cam-round', type: 'button', 'aria-label': 'Switch camera', title: 'Switch camera', onclick: onFlip }, icon('swap', 22));
const controls = h('div', { class: 'cam-controls' }, btnOpen, h('div', { class: 'cam-shutter-wrap' }, modes, shutter), btnFlip);
const fxRow = h('div', { class: 'cam-fx', role: 'listbox', 'aria-label': 'Effects' }, FX.map((f) => h('button', { class: 'cam-fx-chip' + (f.ai ? ' is-ai' : f.group === 'flash' ? ' is-flash' : ''), type: 'button', role: 'option', dataset: { fx: f.id }, onclick: () => setFx(f.id) },
  f.ai ? h('span', { class: 'cam-fx-tag', text: 'AI' }) : f.tag ? h('span', { class: 'cam-fx-tag is-' + f.tag.toLowerCase(), text: f.tag }) : f.group === 'flash' ? glyph(FLASH, 13) : null, h('span', { text: f.name }))));
const dock = h('div', { class: 'cam-dock' }, lookName, fxRow, chips, strip, controls);

const panelBody = h('div', { class: 'cam-panel-body' });
const panel = h('aside', { class: 'cam-panel', 'aria-label': 'Look adjustments' },
  h('div', { class: 'cam-panel-head' }, h('h2', { class: 'cam-panel-title', text: 'Adjust' }), h('div', { class: 'studio-spacer' }),
    h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'Reset', onclick: resetLook }),
    iconButton('close', 'Close adjustments', () => togglePanel(false), { cls: 'cam-panel-close', size: 16 })),
  panelBody);

const review = h('div', { class: 'cam-review', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Review capture' });

body.append(top, stage, dock, panel, review, flashEl);

// ---------------------------------------------------------------- renderer + loop
const renderer = createLiveRenderer(view);
let lastLayout = null;
let needsRender = true;
let rafId = 0;
const t0 = performance.now();

function aspectList() { return state.source === 'file' ? PHOTO_ASPECTS : ASPECTS; }
const QUAD_ASPECT = { id: '4:5', label: '4 lens', r: 4 / 5 };
function currentAspect() { if (state.mode === 'quad' && state.source === 'camera') return QUAD_ASPECT; const id = state.source === 'file' ? state.photoAspect : state.aspect; return aspectList().find((a) => a.id === id) || aspectList()[0]; }

function cropFor(W, H) {
  const a = currentAspect().r;
  if (!a) return { x: 0, y: 0, w: W, h: H };
  if (W / H > a) { const w = H * a; return { x: (W - w) / 2, y: 0, w, h: H }; }
  const hh = W / a; return { x: 0, y: (H - hh) / 2, w: W, h: hh };
}

function sourceEl() {
  if (state.source === 'file') return state.photo;
  if (video.readyState >= 2 && video.videoWidth) return video;
  return null;
}
const mirrored = () => state.source === 'camera' && state.facing === 'user';
const previewMax = () => Math.min(IS_TOUCH ? 1080 : 1280, Math.round(Math.max(stage.clientWidth, stage.clientHeight) * Math.min(2, devicePixelRatio || 1)));

function frame() {
  rafId = requestAnimationFrame(frame);
  const src = sourceEl();
  if (!src) return;
  const live = state.source === 'camera';
  if (!live && !needsRender) return;
  needsRender = false;
  const W = live ? video.videoWidth : src.width, H = live ? video.videoHeight : src.height;
  const time = live ? (performance.now() - t0) / 1000 : 0;
  const r = renderer.render(src, state.lookId, state.params, time, { crop: cropFor(W, H), mirror: mirrored(), maxSize: state.recording ? state.recording.maxSize : previewMax() });
  if (r) afterFrame(state.fx !== 'none' ? view : view);
  if (r && state.fx !== 'none') {
    if (fxView.width !== view.width || fxView.height !== view.height) { fxView.width = view.width; fxView.height = view.height; }
    let mask = null;
    if (fxById(state.fx).ai && segmenterReady()) { try { mask = liveMask(view); } catch (e) { mask = null; } }
    compose(fxView.getContext('2d'), view, mask, state.fx, time || performance.now() / 1000);
  }
  if (r) {
    const changed = !lastLayout || r.width !== lastLayout.width || r.height !== lastLayout.height || r.layout.rect.w !== lastLayout.layout.rect.w;
    lastLayout = r;
    if (changed) fitView();
  }
}

function fitView() {
  if (!lastLayout) return;
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const pad = sw < 600 ? 0 : 16;
  const s = Math.min((sw - pad * 2) / lastLayout.width, (sh - pad * 2) / lastLayout.height);
  const w = Math.max(1, Math.floor(lastLayout.width * s)), hh = Math.max(1, Math.floor(lastLayout.height * s));
  viewBox.style.width = w + 'px'; viewBox.style.height = hh + 'px';
  const R = lastLayout.layout.rect;
  Object.assign(gridEl.style, { left: (R.x * s) + 'px', top: (R.y * s) + 'px', width: (R.w * s) + 'px', height: (R.h * s) + 'px' });
}
new ResizeObserver(() => { fitView(); needsRender = true; }).observe(stage);

// ---------------------------------------------------------------- camera
function showMessage(title, text, actions = []) {
  clear(messageEl);
  messageEl.append(h('div', { class: 'cam-message-card' },
    icon('camera', 28), h('h2', { text: title }), h('p', { text }),
    h('div', { class: 'cam-message-actions' }, actions.map((a) => h('button', { class: 'studio-btn' + (a.primary ? ' is-primary' : ''), type: 'button', text: a.label, onclick: a.fn })))));
  messageEl.hidden = false;
  viewBox.hidden = true;
}
function hideMessage() { messageEl.hidden = true; viewBox.hidden = false; }

function stopStream() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null; state.track = null; state.caps = null;
  video.srcObject = null;
  zoomBox.hidden = true; zoomChips.hidden = true;
}

async function cameraPermission() {
  try { const p = await navigator.permissions.query({ name: 'camera' }); return p.state; } catch (e) { return 'unknown'; }
}
function deniedHelp() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'On iPhone: Settings ▸ Safari ▸ Camera ▸ Allow (or tap “aA” in the address bar ▸ Website Settings ▸ Camera ▸ Allow), then tap Try again.';
  if (/Android/.test(ua)) return 'On Android: tap the lock icon next to the address ▸ Permissions ▸ Camera ▸ Allow, then tap Try again.';
  return 'Click the camera or lock icon in the address bar, allow the camera for this site, then click Try again.';
}
async function openStream() {
  const want = { width: { ideal: state.quality === 'standard' ? 1280 : 2560 }, height: { ideal: state.quality === 'standard' ? 720 : 1440 }, frameRate: { ideal: 30 } };
  const where = state.deviceId ? { deviceId: { exact: state.deviceId } } : { facingMode: { ideal: state.facing } };
  const tries = [{ ...where, ...want }, where, true];
  let last = null;
  for (const v of tries) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: false, video: v }); }
    catch (e) {
      last = e;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      if (state.deviceId && e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) { state.deviceId = ''; persist(); return openStream(); }
    }
  }
  throw last;
}
const waitFrames = (ms) => new Promise((res) => {
  const t0 = performance.now();
  const tick = () => { if (video.videoWidth > 0 && video.readyState >= 2) res(true); else if (performance.now() - t0 > ms) res(false); else setTimeout(tick, 80); };
  tick();
});
let starting = null;
function startCamera() {
  if (!starting) starting = startCameraInner().finally(() => { starting = null; });
  return starting;
}
async function startCameraInner() {
  stopStream();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const secure = window.isSecureContext;
    showMessage('Camera unavailable', secure ? 'This browser does not give web pages access to a camera. You can still open a photo and apply every look and effect to it.' : 'The camera only works over a secure (https) connection — open the Studio from https://eyad-ayman.github.io/studio/. You can still open a photo and apply looks to it.', [{ label: 'Open a photo', primary: true, fn: openPhoto }]);
    syncControls();
    return false;
  }
  if (await cameraPermission() === 'denied') {
    showMessage('Camera is blocked', 'EYAD KAMERA is not allowed to use the camera. ' + deniedHelp(), [{ label: 'Try again', primary: true, fn: startCamera }, { label: 'Open a photo', fn: openPhoto }]);
    syncControls();
    return false;
  }
  showMessage('Starting camera…', 'Allow camera access when your browser asks.', []);
  try {
    const stream = await openStream();
    state.stream = stream;
    state.track = stream.getVideoTracks()[0] || null;
    state.source = 'camera';
    video.srcObject = stream;
    let played = true;
    try { await video.play(); } catch (e) { played = false; }
    if (state.track) {
      state.track.addEventListener('ended', () => { if (state.source === 'camera' && state.stream && !document.hidden) showMessage('Camera stopped', 'The camera was disconnected or taken by another app.', [{ label: 'Try again', primary: true, fn: startCamera }, { label: 'Open a photo', fn: openPhoto }]); });
      const st = state.track.getSettings ? state.track.getSettings() : {};
      if (st.facingMode === 'user' || st.facingMode === 'environment') state.facing = st.facingMode;
      setupZoom();
    }
    try { const devs = await navigator.mediaDevices.enumerateDevices(); state.devices = devs.filter((d) => d.kind === 'videoinput'); state.cameras = state.devices.length; } catch (e) { state.devices = []; state.cameras = 1; }
    // Some browsers (iOS in particular) need a tap before the video plays; others give a stream with no frames.
    const ok = played && await waitFrames(4500);
    if (!ok) {
      showMessage('Tap to start the camera', 'Your browser needs a tap before it shows the live camera.', [{ label: 'Start camera', primary: true, fn: async () => {
        try { await video.play(); } catch (e) { /* retried below */ }
        if (await waitFrames(2500)) { hideMessage(); needsRender = true; } else startCamera();
      } }, { label: 'Open a photo', fn: openPhoto }]);
    } else hideMessage();
    syncControls(); syncTop(); buildPanel();
    scheduleThumbs(400);
    return ok;
  } catch (err) {
    const n = err && err.name;
    let title = 'Camera unavailable', text = 'The camera could not be started' + (err && err.message ? ` (${String(err.message).slice(0, 120)})` : '') + '.';
    if (n === 'NotAllowedError' || n === 'SecurityError') { title = 'Camera permission denied'; text = 'EYAD KAMERA was not allowed to use the camera. ' + deniedHelp(); }
    else if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') { title = 'No camera found'; text = 'This device does not seem to have a camera. You can open a photo and apply every look and effect to it.'; }
    else if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') { title = 'Camera is busy'; text = 'Another app or tab is using the camera. Close it (video calls, other camera apps) and try again.'; }
    showMessage(title, text, [{ label: 'Try again', fn: startCamera }, { label: 'Open a photo', primary: true, fn: openPhoto }]);
    syncControls();
    return false;
  }
}

function setupZoom() {
  const t = state.track;
  let caps = null;
  try { caps = t.getCapabilities ? t.getCapabilities() : null; } catch (e) { caps = null; }
  state.caps = caps;
  if (caps && caps.zoom && caps.zoom.max > caps.zoom.min) {
    const st = t.getSettings ? t.getSettings() : {};
    zoomRange.min = caps.zoom.min; zoomRange.max = caps.zoom.max; zoomRange.step = caps.zoom.step || 0.1;
    state.zoom = st.zoom || caps.zoom.min;
    zoomRange.value = state.zoom;
    zoomLabel.textContent = (+state.zoom).toFixed(1) + '×';
    zoomBox.hidden = false;
    const stops = [0.5, 1, 2, 3, 5, 10].filter((z) => z >= caps.zoom.min - 0.01 && z <= caps.zoom.max + 0.01);
    zoomChips.replaceChildren(...stops.map((z) => h('button', { class: 'cam-zchip', type: 'button', text: (z < 1 ? '.5' : z) + '×', onclick: () => setZoom(z) })));
    zoomChips.hidden = stops.length < 2;
  } else { zoomBox.hidden = true; zoomChips.hidden = true; }
}
let zoomPending = null;
async function setZoom(z) {
  if (!state.caps || !state.caps.zoom || !state.track) return;
  z = clamp(z, state.caps.zoom.min, state.caps.zoom.max);
  state.zoom = z; zoomRange.value = z; zoomLabel.textContent = z.toFixed(1) + '×';
  for (const b of zoomChips.children) b.classList.toggle('is-on', Math.abs(parseFloat(b.textContent.replace(/^\./, '0.')) - z) < 0.05);
  if (zoomPending) return;
  zoomPending = state.track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {}).finally(() => { zoomPending = null; if (Math.abs(state.zoom - z) > 0.01) setZoom(state.zoom); });
}
zoomRange.addEventListener('input', () => setZoom(+zoomRange.value));

// pinch to zoom (hardware zoom when the camera supports it)
const pointers = new Map();
let pinchStart = null;
stage.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, [e.clientX, e.clientY]); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: state.zoom }; } });
stage.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinchStart && pointers.size === 2 && state.caps && state.caps.zoom) { const [a, b] = [...pointers.values()]; setZoom(pinchStart.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, pinchStart.d)); }
});
const endPointer = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null; };
stage.addEventListener('pointerup', endPointer); stage.addEventListener('pointercancel', endPointer);

async function onFlip() {
  if (state.recording || state.busy) return;
  if (state.source === 'file') { state.photo = null; await startCamera(); return; }
  state.facing = state.facing === 'user' ? 'environment' : 'user';
  persist();
  await startCamera();
}

// ---------------------------------------------------------------- open photo (no camera needed)
async function openPhoto() {
  if (state.recording || state.busy) return;
  const files = await pickFiles({ accept: ACCEPT.image, source: IS_TOUCH ? 'photos' : 'files', media: 'image' });
  const f = files[0];
  if (!f) return;
  try {
    const info = await detectFile(f);
    if (info.kind !== 'image') { toast('That file is not an image EYAD KAMERA can open.', { type: 'warn', detail: sanitizeFilename(f.name) + ' — ' + info.label }); return; }
    const c = await loadImageFile(f);
    stopStream();
    state.photo = c; state.photoName = baseName(f.name) || 'photo';
    state.source = 'file'; state.photoAspect = 'orig';
    if (state.mode === 'video') setMode('photo');
    hideMessage();
    needsRender = true;
    syncControls(); syncTop();
    scheduleThumbs(50);
    toast('Photo opened — pick a look, then tap the shutter to render it at full size.', { type: 'ok' });
  } catch (e) {
    toast(e.message || 'The image could not be opened.', { type: 'error' });
  }
}

// ---------------------------------------------------------------- looks strip
const itemById = new Map();
function buildStrip() {
  clear(strip); clear(chips); itemById.clear();
  for (const g of looksByGroup()) {
    const first = g.looks[0];
    chips.append(h('button', { class: 'cam-chip', type: 'button', role: 'tab', text: g.name, dataset: { group: g.id }, onclick: () => { const it = itemById.get(first.id); if (it) it.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }); } }));
    strip.append(h('div', { class: 'cam-strip-label', text: g.name, 'aria-hidden': 'true' }));
    for (const l of g.looks) {
      const c = h('canvas', { class: 'cam-thumb', width: 96, height: 96, 'aria-hidden': 'true' });
      const it = h('button', { class: 'cam-look', type: 'button', role: 'option', 'aria-selected': 'false', title: l.desc ? `${l.name} — ${l.desc}` : l.name, dataset: { id: l.id }, onclick: () => selectLook(l.id, true) }, c, h('span', { text: l.name }));
      it._canvas = c; it._stamp = -1;
      itemById.set(l.id, it);
      strip.append(it);
      io.observe(it);
    }
  }
  markSelected();
}

const visible = new Set();
const io = new IntersectionObserver((entries) => {
  for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); }
  scheduleThumbs(120);
}, { root: strip, rootMargin: '0px 200px 0px 200px' });

let thumbTimer = 0, thumbSnap = null, thumbStamp = 0, thumbRunning = false;
function scheduleThumbs(ms = 0) { clearTimeout(thumbTimer); thumbTimer = setTimeout(runThumbs, ms); }
async function runThumbs() {
  if (thumbRunning) return;
  const src = sourceEl();
  if (!src || document.hidden) { scheduleThumbs(1500); return; }
  thumbRunning = true;
  try {
    const live = state.source === 'camera';
    const W = live ? video.videoWidth : src.width, H = live ? video.videoHeight : src.height;
    const cr = cropFor(W, H), s = Math.min(cr.w, cr.h);
    const snap = document.createElement('canvas'); snap.width = snap.height = 144;
    const g = snap.getContext('2d');
    if (mirrored()) { g.translate(144, 0); g.scale(-1, 1); }
    g.drawImage(src, cr.x + (cr.w - s) / 2, cr.y + (cr.h - s) / 2, s, s, 0, 0, 144, 144);
    thumbSnap = snap; thumbStamp++;
    const items = [...visible].filter((it) => it._stamp !== thumbStamp);
    for (const it of items) {
      if (state.recording) break;
      const out = await lookThumbnail(thumbSnap, it.dataset.id, 96);
      const tg = it._canvas.getContext('2d');
      tg.clearRect(0, 0, 96, 96);
      tg.drawImage(out, (96 - out.width) / 2, (96 - out.height) / 2);
      it._stamp = thumbStamp;
      await new Promise((r) => requestAnimationFrame(r));
    }
  } catch (e) { /* thumbnails are best-effort */ }
  thumbRunning = false;
  if (state.source === 'camera') scheduleThumbs(state.recording ? 4000 : 2500);
}

function markSelected() {
  for (const [id, it] of itemById) { const on = id === state.lookId; it.classList.toggle('is-active', on); it.setAttribute('aria-selected', on ? 'true' : 'false'); }
  const l = getLook(state.lookId);
  lookName.textContent = l.name + (state.fx !== 'none' ? ' · ' + fxById(state.fx).name : '');
  const gi = l.group;
  for (const c of chips.children) c.classList.toggle('is-active', c.dataset.group === gi);
}

function selectLook(id, scroll) {
  const keepDate = state.params.dateText;
  const lutChoice = state.lutChoice;
  state.lookId = id;
  state.params = defaultParams(id);
  state.params.dateText = keepDate;
  if (lutChoice && !getLook(id).params.lut) { state.params.lut = lutFromChoice(lutChoice); }
  else state.lutChoice = '';
  markSelected(); buildPanel(); persist();
  needsRender = true;
  if (scroll) { const it = itemById.get(id); if (it) it.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); }
}
function stepLook(d) {
  const i = LOOKS.findIndex((l) => l.id === state.lookId);
  selectLook(LOOKS[(i + d + LOOKS.length) % LOOKS.length].id, true);
}

// ---------------------------------------------------------------- adjust panel
function lutFromChoice(v) {
  if (!v) return null;
  if (v.startsWith('b:')) return getBuiltinLut(v.slice(2));
  const imp = state.importedLuts.find((x) => x.key === v);
  return imp ? imp.lut : null;
}

function buildPanel() {
  clear(panelBody);
  const P = state.params;
  if (state.source === 'camera' && state.track) {
    panelBody.append(h('h3', { class: 'cam-panel-h', text: 'Camera (pro)' }), proControls(state.track));
    const q = h('select', { class: 'studio-input', 'aria-label': 'Photo quality', onchange: () => { state.quality = q.value; persist(); startCamera(); } },
      [['max', 'Maximum (full sensor)'], ['high', 'High (1440p stream)'], ['standard', 'Standard (720p, fastest)']].map(([v, t]) => h('option', { value: v, text: t, selected: state.quality === v })));
    panelBody.append(h('label', { class: 'cam-field' }, h('span', { text: 'Quality' }), q));
  }
  const change = () => { needsRender = true; };
  const section = (title) => h('h3', { class: 'cam-panel-h', text: title });
  // frame / date / LUT
  const frameSel = h('select', { class: 'studio-input', 'aria-label': 'Frame', onchange: () => { P.frame = frameSel.value; change(); } }, FRAMES.map((f) => h('option', { value: f.id, text: f.name, selected: P.frame === f.id })));
  const dateChk = h('input', { type: 'checkbox', checked: !!P.dateStamp, 'aria-label': 'Date stamp', onchange: () => { P.dateStamp = dateChk.checked; dateTxt.disabled = !dateChk.checked; change(); } });
  const dateTxt = h('input', { class: 'studio-input cam-date-input', type: 'text', value: P.dateText || todayStamp(), maxlength: 16, disabled: !P.dateStamp, 'aria-label': 'Date stamp text', inputmode: 'numeric', oninput: () => { const v = sanitizeDateText(dateTxt.value); P.dateText = v; state.params.dateText = v; change(); } });
  const lutSel = h('select', { class: 'studio-input', 'aria-label': 'LUT', onchange: () => { state.lutChoice = lutSel.value; P.lut = lutFromChoice(lutSel.value) || getLook(state.lookId).params.lut || null; change(); } },
    h('option', { value: '', text: getLook(state.lookId).params.lut ? 'Look’s own grade' : 'None' }),
    h('optgroup', { label: 'Built-in grades' }, BUILTIN_LUTS.map((b) => h('option', { value: 'b:' + b.id, text: b.name, selected: state.lutChoice === 'b:' + b.id }))),
    state.importedLuts.length ? h('optgroup', { label: 'Imported' }, state.importedLuts.map((x) => h('option', { value: x.key, text: x.lut.title, selected: state.lutChoice === x.key }))) : null);
  panelBody.append(
    section('Frame & stamp'),
    h('label', { class: 'cam-field' }, h('span', { text: 'Frame' }), frameSel),
    h('label', { class: 'cam-field is-check' }, h('span', { text: 'Date stamp' }), h('span', { class: 'cam-field-row' }, dateChk, dateTxt)),
    section('LUT'),
    h('label', { class: 'cam-field' }, h('span', { text: 'Grade' }), lutSel),
    h('button', { class: 'studio-btn is-small is-block', type: 'button', onclick: importLut }, icon('upload', 14), h('span', { text: 'Import .cube LUT…' })),
  );
  const groups = [['basic', 'Basic'], ['colour', 'Colour'], ['texture', 'Texture'], ['optics', 'Optics'], ['effects', 'Light leak']];
  for (const [gid, gname] of groups) {
    panelBody.append(section(gname));
    for (const spec of LOOK_PARAMS.filter((p) => p.group === gid)) {
      const out = h('output', { class: 'cam-val', text: String(Math.round(P[spec.key])) + (spec.unit || '') });
      const r = h('input', { class: 'studio-range', type: 'range', min: spec.min, max: spec.max, step: 1, value: P[spec.key], 'aria-label': spec.label });
      r.addEventListener('input', () => { P[spec.key] = +r.value; out.textContent = r.value + (spec.unit || ''); change(); });
      const reset = () => { const d = defaultParams(state.lookId)[spec.key]; r.value = d; P[spec.key] = d; out.textContent = d + (spec.unit || ''); change(); };
      panelBody.append(h('div', { class: 'cam-slider' }, h('button', { class: 'cam-slider-label', type: 'button', title: 'Double-click to reset', text: spec.label, ondblclick: reset }), out, r));
    }
  }
}

function togglePanel(force) {
  const open = force === undefined ? !body.classList.contains('cam-panel-open') : force;
  body.classList.toggle('cam-panel-open', open);
  btnAdjust.setAttribute('aria-pressed', open ? 'true' : 'false');
  requestAnimationFrame(() => { fitView(); needsRender = true; });
}

function resetLook() { state.lutChoice = ''; selectLook(state.lookId, false); toast('Look reset to its preset values.'); }

async function importLut() {
  const files = await pickFiles({ accept: '.cube' });
  const f = files[0];
  if (!f) return;
  try {
    const lut = await readCubeFile(f);
    const look = lutToLook(lut);
    registerLook(look);
    const key = 'i:' + look.id;
    state.importedLuts.push({ key, lut });
    buildStrip();
    state.lutChoice = '';
    selectLook(look.id, true);
    toast(`LUT “${lut.title}” imported (${lut.kind.toUpperCase()}${lut.size ? ', ' + lut.size + '³' : ''}).`, { type: 'ok', detail: 'It is in the look strip under Imported LUTs and in Adjust → LUT.' });
    scheduleThumbs(50);
  } catch (e) {
    toast('This LUT could not be used.', { type: 'error', detail: e.message, timeout: 7000 });
  }
}

// ---------------------------------------------------------------- effects (flash looks + on-device AI)
function syncFx() {
  const on = state.fx !== 'none';
  fxView.hidden = !on; view.style.visibility = on ? 'hidden' : '';
  for (const b of fxRow.children) { const a = b.dataset.fx === state.fx; b.classList.toggle('is-active', a); b.setAttribute('aria-selected', String(a)); }
  lookName.textContent = getLook(state.lookId).name + (on ? ' · ' + fxById(state.fx).name : '');
}
async function setFx(id) {
  if (state.recording) return;
  const f = fxById(id);
  state.fx = f.id; persist(); syncFx(); needsRender = true;
  if (f.ai && !segmenterReady()) {
    const t = toast('Loading EYAD AI (on this device)…', { timeout: 0 });
    try { await loadSegmenter((m) => { try { t.set && t.set(m); } catch (e) { /* ignore */ } }); toast(f.name + ' is on — the person is found on this device, nothing is uploaded.', { type: 'ok', timeout: 2600 }); }
    catch (e) { toast('EYAD AI could not start: ' + (e.message || e), { type: 'error', timeout: 7000 }); state.fx = 'none'; persist(); syncFx(); }
    finally { t && t.close && t.close(); needsRender = true; }
  }
}

// ---------------------------------------------------------------- top bar & modes
function syncTop() {
  btnGrid.setAttribute('aria-pressed', state.grid ? 'true' : 'false');
  gridEl.hidden = !state.grid;
  btnTimer.setAttribute('aria-pressed', state.timer ? 'true' : 'false');
  btnTimer.querySelector('.cam-tool-badge').textContent = state.timer ? state.timer + 's' : '';
  btnTimer.title = state.timer ? `Self-timer: ${state.timer} s` : 'Self-timer: off';
  // flash: front camera = white screen; back camera = torch when the hardware supports it
  const torch = !!(state.caps && state.caps.torch);
  const canFlash = state.source === 'camera' && !!state.stream && (state.facing === 'user' || torch);
  btnFlash.hidden = !canFlash;
  clear(btnFlash).append(glyph(state.flash ? FLASH : FLASH_OFF));
  btnFlash.setAttribute('aria-pressed', state.flash ? 'true' : 'false');
  btnFlash.title = state.facing === 'user' ? (state.flash ? 'Screen flash: on' : 'Screen flash: off') : (state.flash ? 'Torch flash: on' : 'Torch flash: off');
  btnAspect.textContent = currentAspect().label;
  btnAspect.disabled = !!state.recording;
  btnHist.setAttribute('aria-pressed', String(state.hist)); histCanvas.hidden = !state.hist;
  btnCams.hidden = !(state.source === 'camera' && (state.cameras || 0) > 1);
  levelEl.hidden = !(state.grid && state.level && levelSeen);
}
function cycleAspect() {
  if (state.recording) return;
  const list = aspectList();
  const i = list.findIndex((a) => a.id === currentAspect().id);
  const next = list[(i + 1) % list.length].id;
  if (state.source === 'file') state.photoAspect = next; else state.aspect = next;
  syncTop(); persist(); needsRender = true; scheduleThumbs(100);
}

const canRecord = () => typeof MediaRecorder !== 'undefined' && typeof view.captureStream === 'function';
function setMode(m) {
  if (state.recording || state.busy) return;
  if (m === 'portrait') { if (state.fx !== 'portrait') { state.preFx = state.fx; setFx('portrait'); } }
  else if (state.mode === 'portrait' && state.fx === 'portrait') { setFx(state.preFx && state.preFx !== 'portrait' ? state.preFx : 'none'); }
  if (m === 'video' && state.source !== 'camera') { toast('Video recording uses the live camera.', { type: 'warn' }); return; }
  if (m === 'video' && !canRecord()) { toast('This browser cannot record video from a canvas.', { type: 'warn' }); return; }
  state.mode = m;
  quadHud.hidden = m !== 'quad';
  needsRender = true;
  syncControls();
  if (m === 'quad' && !quadTipShown) { quadTipShown = true; toast('Quad 3D: four shots in half a second. Slide the phone a little sideways while it fires for real depth — or hold still and the person is lifted off the background.', { timeout: 7000 }); }
}
function syncControls() {
  const cam = state.source === 'camera' && !!state.stream;
  modePhoto.classList.toggle('is-active', state.mode === 'photo');
  modeVideo.classList.toggle('is-active', state.mode === 'video');
  modePortrait.classList.toggle('is-active', state.mode === 'portrait');
  modeQuad.classList.toggle('is-active', state.mode === 'quad'); modeQuad.disabled = !cam;
  modeBurst.classList.toggle('is-active', state.mode === 'burst');
  modeBurst.disabled = !cam;
  modeVideo.disabled = !cam || !canRecord();
  shutter.classList.toggle('is-video', state.mode === 'video');
  shutter.classList.toggle('is-recording', !!state.recording);
  shutter.classList.toggle('is-apply', state.source === 'file');
  shutter.disabled = !sourceEl() && !cam && state.source !== 'file';
  shutter.setAttribute('aria-label', state.source === 'file' ? 'Render photo with this look' : state.mode === 'video' ? (state.recording ? 'Stop recording' : 'Start recording') : 'Take photo');
  clear(btnFlip).append(icon(state.source === 'file' ? 'camera' : 'swap', 22));
  btnFlip.setAttribute('aria-label', state.source === 'file' ? 'Back to camera' : 'Switch camera');
  btnFlip.title = btnFlip.getAttribute('aria-label');
  // keep its slot so the shutter stays centred; only hide it when there is nothing to switch to
  btnFlip.style.visibility = state.source === 'camera' && (!cam || state.cameras < 2) ? 'hidden' : '';
  btnOpen.disabled = !!state.recording;
  body.classList.toggle('cam-is-file', state.source === 'file');
  syncTop();
}

// ---------------------------------------------------------------- capture
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
let countdownCancel = null;
async function runCountdown(sec) {
  if (!sec) return true;
  let cancelled = false;
  countdownCancel = () => { cancelled = true; };
  for (let s = sec; s > 0; s--) {
    countdown.textContent = String(s); countdown.classList.add('is-on');
    await sleep(1000);
    if (cancelled) break;
  }
  countdown.textContent = ''; countdown.classList.remove('is-on');
  countdownCancel = null;
  return !cancelled;
}

async function onShutter() {
  if (countdownCancel) { countdownCancel(); return; }
  if (state.busy) return;
  if (state.source === 'file') { await renderPhoto(); return; }
  if (!state.stream) { startCamera(); return; }
  if (state.mode === 'video') { if (state.recording) stopRecording(); else { if (await runCountdown(state.timer)) startRecording(); } return; }
  if (!(await runCountdown(state.timer))) return;
  if (state.mode === 'burst') { await captureBurst(); return; }
  if (state.mode === 'quad') { await captureQuad(); return; }
  await capturePhoto();
}

/** Night mode photo: average 10 frames (the noise cancels out, the picture stays), like a phone's night shot. */
async function nightStack() {
  const W = video.videoWidth, H = video.videoHeight, n = 10;
  const sum = new Float32Array(W * H * 3);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < n; i++) {
    countdown.textContent = `Hold still… ${i + 1}/${n}`;
    g.drawImage(video, 0, 0); const d = g.getImageData(0, 0, W, H).data;
    for (let p = 0, q = 0; p < d.length; p += 4, q += 3) { sum[q] += d[p]; sum[q + 1] += d[p + 1]; sum[q + 2] += d[p + 2]; }
    await sleep(70);
  }
  const img = g.createImageData(W, H), o = img.data;
  for (let p = 0, q = 0; p < o.length; p += 4, q += 3) { o[p] = sum[q] / n; o[p + 1] = sum[q + 1] / n; o[p + 2] = sum[q + 2] / n; o[p + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

async function grabFullFrame() {
  // Best quality: ImageCapture.takePhoto() (full sensor resolution where supported).
  if (state.quality === 'max' && typeof ImageCapture !== 'undefined' && state.track && state.track.readyState === 'live') {
    try {
      const ic = new ImageCapture(state.track);
      // ask for the sensor's full photo resolution (often 12 MP+, far above the video stream)
      let settings;
      try { const pc = await ic.getPhotoCapabilities(); if (pc && pc.imageWidth && pc.imageWidth.max) settings = { imageWidth: pc.imageWidth.max, imageHeight: pc.imageHeight && pc.imageHeight.max }; } catch (e) { settings = undefined; }
      const blob = await Promise.race([ic.takePhoto(settings), sleep(6000).then(() => { throw new Error('timeout'); })]);
      const bmp = await createImageBitmap(blob);
      if (bmp.width && bmp.height) return bmp;
    } catch (e) { /* fall back to the video frame */ }
  }
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}

async function withFlash(fn) {
  const front = state.facing === 'user';
  const torch = !front && state.caps && state.caps.torch;
  if (!state.flash) return fn();
  if (front) {
    flashEl.classList.add('is-on');
    await sleep(350);
    try { return await fn(); } finally { flashEl.classList.remove('is-on'); }
  }
  if (torch) {
    try { await state.track.applyConstraints({ advanced: [{ torch: true }] }); await sleep(450); } catch (e) { /* torch refused */ }
    try { return await fn(); } finally { try { await state.track.applyConstraints({ advanced: [{ torch: false }] }); } catch (e) { /* ignore */ } }
  }
  return fn();
}

function busy(on, text = '') {
  state.busy = on;
  body.classList.toggle('cam-busy', on);
  shutter.disabled = on;
  if (on) { countdown.textContent = text; countdown.classList.add('is-busy'); } else { countdown.textContent = ''; countdown.classList.remove('is-busy'); }
}

async function capturePhoto() {
  busy(true, 'Developing…');
  try {
    if (state.sound) shutterSound();
    const src = state.fx === 'night' ? await nightStack() : await withFlash(() => { flashEl.classList.add('is-shot'); setTimeout(() => flashEl.classList.remove('is-shot'), 120); return grabFullFrame(); });
    const W = src.width, H = src.height;
    let out = await applyLook(src, state.lookId, state.params, { crop: cropFor(W, H), mirror: mirrored(), onProgress: (f) => { countdown.textContent = `Developing… ${Math.round(f * 100)}%`; } });
    if (src.close) src.close();
    out = await applyFxStill(out, state.fx, (m) => { countdown.textContent = m; });
    showReviewPhoto(out, `eyad-camera-${stampName()}-${state.lookId}`);
  } catch (e) {
    toast('The photo could not be captured.', { type: 'error', detail: e.message });
  } finally { busy(false); }
}

async function renderPhoto() {
  if (!state.photo) return;
  busy(true, 'Rendering…');
  try {
    let out = await applyLook(state.photo, state.lookId, state.params, { crop: cropFor(state.photo.width, state.photo.height), onProgress: (f) => { countdown.textContent = `Rendering… ${Math.round(f * 100)}%`; } });
    out = await applyFxStill(out, state.fx, (m) => { countdown.textContent = m; });
    showReviewPhoto(out, `${state.photoName}-${state.lookId}`);
  } catch (e) {
    toast('The photo could not be rendered.', { type: 'error', detail: e.message });
  } finally { busy(false); }
}

function stampName() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------- video recording
function pickMime() {
  const c = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of c) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ } }
  return '';
}
let micStream = null, micAsked = false;
async function startRecording() {
  if (!canRecord()) { toast('This browser cannot record video from a canvas.', { type: 'warn' }); return; }
  const mime = pickMime();
  if (!micAsked) {
    micAsked = true;
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { micStream = null; toast('Recording without sound — microphone access was not allowed.', { type: 'warn' }); }
  }
  const maxSize = Math.min(1280, previewMax());
  const stream = (state.fx !== 'none' ? fxView : view).captureStream(30);
  if (micStream) micStream.getAudioTracks().forEach((t) => { if (t.readyState === 'live') stream.addTrack(t); });
  let rec;
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined); }
  catch (e) { toast('Video recording could not start.', { type: 'error', detail: e.message }); return; }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const started = performance.now();
  state.recording = { rec, maxSize, started, timer: 0 };
  rec.onstop = () => {
    const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
    const blob = new Blob(chunks, { type });
    clearInterval(state.recording && state.recording.timer);
    state.recording = null;
    recBadge.hidden = true;
    stream.getVideoTracks().forEach((t) => t.stop());
    syncControls();
    if (!blob.size) { toast('Nothing was recorded.', { type: 'warn' }); return; }
    showReviewVideo(blob, `eyad-camera-${stampName()}-${state.lookId}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
  };
  rec.start(500);
  recBadge.hidden = false;
  const timeEl = recBadge.querySelector('.cam-rec-time');
  state.recording.timer = setInterval(() => {
    const s = Math.floor((performance.now() - started) / 1000);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= MAX_REC) stopRecording();
  }, 250);
  syncControls();
}
function stopRecording() { if (state.recording && state.recording.rec.state !== 'inactive') state.recording.rec.stop(); }

// ---------------------------------------------------------------- review
let reviewUrl = null;
function closeReview() {
  review.hidden = true; clear(review);
  if (reviewUrl) { URL.revokeObjectURL(reviewUrl); reviewUrl = null; }
  body.classList.remove('cam-reviewing');
  needsRender = true;
}
function reviewShell(media, info, actions) {
  clear(review);
  review.append(
    h('div', { class: 'cam-review-top' },
      h('button', { class: 'studio-btn is-ghost cam-review-back', type: 'button', onclick: closeReview }, icon('back', 16), h('span', { text: state.source === 'file' ? 'Back' : 'Retake' })),
      h('div', { class: 'cam-review-info', text: info })),
    h('div', { class: 'cam-review-media' }, media),
    h('div', { class: 'cam-review-actions' }, actions));
  review.hidden = false;
  body.classList.add('cam-reviewing');
  const first = review.querySelector('.studio-btn.is-primary'); if (first) first.focus();
}
const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The image is too large to encode in this browser.'))), type, q));

function showReviewPhoto(canvas, base, { fromGallery = false } = {}) {
  base = sanitizeFilename(base);
  if (!fromGallery) addShot(canvas, base);
  canvas.classList.add('cam-review-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Captured photo with ' + getLook(state.lookId).name);
  const save = async (type) => {
    try { const b = await toBlob(canvas, type, 0.92); downloadBlob(b, `${base}.${type === 'image/png' ? 'png' : 'jpg'}`); toast('Saved.', { type: 'ok' }); }
    catch (e) { toast('Could not save the photo.', { type: 'error', detail: e.message }); }
  };
  const edit = async () => {
    try {
      const b = await toBlob(canvas, 'image/png');
      const id = await putHandoff([new File([b], `${base}.png`, { type: 'image/png' })]);
      location.href = ROUTES.image + '?handoff=' + encodeURIComponent(id);
    } catch (e) { toast('Could not open the photo in EYAD IMAGE.', { type: 'error', detail: e.message }); }
  };
  const share = async () => {
    try {
      const b = await toBlob(canvas, 'image/jpeg', 0.92);
      const f = new File([b], `${base}.jpg`, { type: 'image/jpeg' });
      await navigator.share({ files: [f] });
    } catch (e) { if (e && e.name !== 'AbortError') toast('Sharing failed.', { type: 'error', detail: e.message }); }
  };
  const canShare = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.jpg', { type: 'image/jpeg' })] }));
  reviewShell(canvas, `${getLook(state.lookId).name} · ${canvas.width} × ${canvas.height}`, [
    h('button', { class: 'studio-btn is-primary', type: 'button', onclick: () => save('image/jpeg') }, icon('download', 15), h('span', { text: 'Save JPEG' })),
    h('button', { class: 'studio-btn', type: 'button', onclick: () => save('image/png') }, icon('download', 15), h('span', { text: 'Save PNG' })),
    canShare ? h('button', { class: 'studio-btn', type: 'button', onclick: share }, icon('arrowUpRight', 15), h('span', { text: 'Share' })) : null,
    h('button', { class: 'studio-btn', type: 'button', onclick: edit }, icon('image', 15), h('span', { text: 'Edit in EYAD IMAGE' })),
  ]);
}

function showReviewVideo(blob, name) {
  name = sanitizeFilename(name);
  reviewUrl = URL.createObjectURL(blob);
  const v = h('video', { class: 'cam-review-video', src: reviewUrl, controls: true, playsinline: true, loop: true });
  v.setAttribute('playsinline', '');
  const mb = (blob.size / 1048576).toFixed(1);
  reviewShell(v, `${getLook(state.lookId).name} · ${mb} MB`, [
    h('button', { class: 'studio-btn is-primary', type: 'button', onclick: () => { downloadBlob(blob, name); toast('Saved.', { type: 'ok' }); } }, icon('download', 15), h('span', { text: 'Download video' })),
    h('button', { class: 'studio-btn', type: 'button', onclick: async () => {
      try { const id = await putHandoff([new File([blob], name, { type: blob.type })]); location.href = ROUTES.video + '?handoff=' + encodeURIComponent(id); }
      catch (e) { toast('Could not open the clip in EYAD VIDEO.', { type: 'error', detail: e.message }); }
    } }, icon('video', 15), h('span', { text: 'Edit in EYAD VIDEO' })),
  ]);
  v.play().catch(() => {});
}

// ---------------------------------------------------------------- Quad 3D (four-lens stereo, N8000 style)
async function blinkFlash(fn) {
  // a fast strobe per lens: screen flash (front / no torch) or the torch (back camera)
  const torch = state.facing !== 'user' && state.caps && state.caps.torch;
  if (torch && state.flash) {
    try { await state.track.applyConstraints({ advanced: [{ torch: true }] }); await sleep(70); } catch (e) { /* refused */ }
    try { return await fn(); } finally { try { await state.track.applyConstraints({ advanced: [{ torch: false }] }); } catch (e) { /* ignore */ } }
  }
  flashEl.classList.add(state.flash ? 'is-on' : 'is-shot');
  if (state.flash) await sleep(45);
  try { return await fn(); } finally { setTimeout(() => flashEl.classList.remove('is-on', 'is-shot'), 40); }
}
async function captureQuad() {
  busy(true, '3D ×4');
  try {
    const raw = [];
    for (let i = 0; i < 4; i++) {
      quadDots.forEach((d, k) => d.classList.toggle('is-on', k === i));
      if (state.sound) shutterSound();
      raw.push(await blinkFlash(async () => { const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0); return c; }));
      await sleep(95);
    }
    quadDots.forEach((d) => d.classList.remove('is-on'));
    const dev = [];
    for (let i = 0; i < raw.length; i++) {
      countdown.textContent = `Developing ${i + 1}/4…`;
      let c = await applyLook(raw[i], state.lookId, state.params, { crop: cropFor(raw[i].width, raw[i].height), mirror: mirrored() });
      if (state.fx !== 'none' && !fxById(state.fx).ai) c = await applyFxStill(c, state.fx);
      dev.push(c);
    }
    await showQuad(dev);
  } catch (e) { toast('The 3D shot could not be captured.', { type: 'error', detail: e.message }); }
  finally { quadDots.forEach((d) => d.classList.remove('is-on')); busy(false); }
}
/** Build the four viewpoints from developed frames (sweep) or from one frame + AI depth. */
async function buildQuad(dev, pivot, method) {
  const par = parallaxOf(dev);
  let how = method;
  if (how === 'auto') how = par.shift >= 0.012 ? 'sweep' : 'depth';
  if (how === 'depth') {
    try {
      countdown.textContent = 'Finding depth…';
      const res = await segment(dev[1], 'person');
      let cover = 0; for (let i = 0; i < res.mask.length; i += 7) cover += res.mask[i] > 0.5 ? 1 : 0; cover /= res.mask.length / 7;
      if (cover > 0.02 && cover < 0.9) return { frames: synthViews(dev[1], maskCanvas(res, 'quadmask'), 4).map((f, i) => lensCharacter(f, i)), how: 'depth', note: 'AI depth — the person is lifted off the background' };
      if (method === 'depth') toast('No person found for AI depth — using the four real shots instead.', { type: 'warn' });
    } catch (e) { if (method === 'depth') toast('AI depth could not start — using the four real shots.', { type: 'warn' }); }
    how = 'sweep';
  }
  const al = alignFrames(dev, pivot);
  return { frames: al.frames.map((f, i) => lensCharacter(f, i)), how: 'sweep', note: al.spread < 0.01 ? 'Almost no movement between shots — slide the phone sideways while shooting for stronger 3D' : 'Four real viewpoints — tap the picture to choose what stays still' };
}
async function showQuad(dev) {
  let pivot = { x: 0.5, y: 0.5 }, method = state.quadMethod, fps = 8;
  let built = await buildQuad(dev, pivot, method);
  const base = sanitizeFilename(`eyad-kamera-${stampName()}-3d`);
  const cv = document.createElement('canvas'); cv.className = 'cam-review-canvas cam-quad-view';
  let timer = 0, step = 0;
  const play = () => { clearInterval(timer); timer = setInterval(() => { const f = built.frames[PING[step++ % PING.length]]; if (cv.width !== f.width || cv.height !== f.height) { cv.width = f.width; cv.height = f.height; } cv.getContext('2d').drawImage(f, 0, 0); if (review.hidden) clearInterval(timer); }, 1000 / fps); };
  const note = h('span', { class: 'cam-quad-note', text: built.note });
  const speed = h('input', { class: 'studio-range', type: 'range', min: 3, max: 16, step: 1, value: fps, 'aria-label': 'Wiggle speed', oninput: () => { fps = +speed.value; play(); } });
  const sel = h('select', { class: 'studio-input', 'aria-label': '3D method', onchange: async () => { method = sel.value; busy(true, 'Rebuilding…'); try { built = await buildQuad(dev, pivot, method); note.textContent = built.note; } finally { busy(false); } } },
    [['auto', 'Auto'], ['sweep', 'Sweep — real shots'], ['depth', 'AI depth']].map(([v, t]) => h('option', { value: v, text: t, selected: method === v })));
  cv.addEventListener('click', async (e) => {
    if (built.how !== 'sweep') return;
    const r = cv.getBoundingClientRect(); pivot = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    built = await buildQuad(dev, pivot, 'sweep'); note.textContent = 'Pivot moved — that point now stays still';
  });
  const saving = async (label, fn) => { busy(true, label); try { await fn(); toast('Saved.', { type: 'ok' }); } catch (e) { toast('Could not save.', { type: 'error', detail: e.message }); } finally { busy(false); } };
  const zipPhotos = () => saving('Saving photos…', async () => {
    const { zipSync } = await import('../../vendor/fflate/fflate.js');
    const files = {};
    for (let i = 0; i < built.frames.length; i++) { const b = await toBlob(built.frames[i], 'image/jpeg', 0.95); files[`${base}-${i + 1}.jpg`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }]; }
    const strip = await toBlob(filmStrip(built.frames), 'image/jpeg', 0.92); files[`${base}-strip.jpg`] = [new Uint8Array(await strip.arrayBuffer()), { level: 0 }];
    downloadBlob(new Blob([zipSync(files)], { type: 'application/zip' }), `${base}-4-photos.zip`);
  });
  let videoBlob = null;
  const getVideo = async () => (videoBlob = videoBlob && videoBlob._fps === fps && videoBlob._f === built.frames ? videoBlob : Object.assign(await wiggleVideo(built.frames, { fps, seconds: 4 }), { _fps: fps, _f: built.frames }));
  reviewShell(h('div', { class: 'cam-quad-stage' }, cv), `Quad 3D · ${getLook(state.lookId).name}`, [
    h('div', { class: 'cam-quad-bar' }, note, h('label', { class: 'cam-quad-ctl' }, h('span', { text: 'Speed' }), speed), h('label', { class: 'cam-quad-ctl' }, h('span', { text: 'Method' }), sel)),
    h('button', { class: 'studio-btn is-primary', type: 'button', onclick: () => saving('Rendering video…', async () => { const b = await getVideo(); downloadBlob(b, `${base}.${b.type.includes('mp4') ? 'mp4' : 'webm'}`); }) }, icon('download', 15), h('span', { text: 'Save 3D video' })),
    h('button', { class: 'studio-btn', type: 'button', onclick: () => saving('Making GIF…', async () => { downloadBlob(wiggleGif(built.frames, { fps }), `${base}.gif`); }) }, icon('download', 15), h('span', { text: 'Save GIF' })),
    h('button', { class: 'studio-btn', type: 'button', onclick: zipPhotos }, icon('download', 15), h('span', { text: 'Save the 4 photos' })),
    h('button', { class: 'studio-btn', type: 'button', onclick: () => saving('Saving strip…', async () => { downloadBlob(await toBlob(filmStrip(built.frames), 'image/jpeg', 0.93), `${base}-strip.jpg`); }) }, icon('film', 15), h('span', { text: 'Film strip' })),
    h('button', { class: 'studio-btn', type: 'button', onclick: async () => { busy(true, 'Rendering video…'); try { const b = await getVideo(); const id = await putHandoff([new File([b], `${base}.${b.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: b.type })]); location.href = ROUTES.video + '?handoff=' + encodeURIComponent(id); } catch (e) { toast('Could not open in EYAD VIDEO.', { type: 'error', detail: e.message }); } finally { busy(false); } } }, icon('video', 15), h('span', { text: 'Edit in EYAD VIDEO' })),
  ]);
  play();
}

// ---------------------------------------------------------------- burst
async function captureBurst() {
  busy(true, 'Burst…');
  try {
    const frames = [];
    for (let i = 0; i < 8; i++) {
      if (state.sound) shutterSound();
      flashEl.classList.add('is-shot'); setTimeout(() => flashEl.classList.remove('is-shot'), 60);
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0); frames.push(c);
      countdown.textContent = `Burst ${i + 1}/8`;
      await sleep(140);
    }
    const out = [];
    for (let i = 0; i < frames.length; i++) {
      countdown.textContent = `Developing ${i + 1}/${frames.length}…`;
      let c = await applyLook(frames[i], state.lookId, state.params, { crop: cropFor(frames[i].width, frames[i].height), mirror: mirrored() });
      c = await applyFxStill(c, state.fx);
      out.push(c);
    }
    const stamp = stampName();
    out.forEach((c, i) => addShot(c, `eyad-camera-${stamp}-burst-${i + 1}`));
    openGallery(state.shots.length - out.length, { burst: out.length });
  } catch (e) { toast('The burst could not be captured.', { type: 'error', detail: e.message }); }
  finally { busy(false); }
}

// ---------------------------------------------------------------- session gallery
function addShot(canvas, base) {
  state.shots.push({ canvas, base, look: getLook(state.lookId).name, fx: state.fx });
  if (state.shots.length > 40) state.shots.shift();
  const t = document.createElement('canvas'); t.width = t.height = 96;
  const s = Math.min(canvas.width, canvas.height);
  t.getContext('2d').drawImage(canvas, (canvas.width - s) / 2, (canvas.height - s) / 2, s, s, 0, 0, 96, 96);
  clear(btnOpen).append(t);
  btnOpen.classList.add('has-shot');
  btnOpen.setAttribute('aria-label', 'Photos from this session'); btnOpen.title = 'Photos from this session';
}
function openGallery(i, { burst = 0 } = {}) {
  const shot = state.shots[i]; if (!shot) return;
  showReviewPhoto(shot.canvas, shot.base, { fromGallery: true });
  const top = review.querySelector('.cam-review-top');
  const nav = h('div', { class: 'cam-gal-nav' },
    h('button', { class: 'studio-icon-btn', type: 'button', 'aria-label': 'Previous photo', disabled: i === 0, onclick: () => openGallery(i - 1) }, icon('chevronLeft', 18)),
    h('span', { class: 'cam-gal-count', text: `${i + 1} / ${state.shots.length}` }),
    h('button', { class: 'studio-icon-btn', type: 'button', 'aria-label': 'Next photo', disabled: i === state.shots.length - 1, onclick: () => openGallery(i + 1) }, icon('chevronRight', 18)));
  top.insertBefore(nav, top.querySelector('.cam-review-info'));
  if (burst || state.shots.length > 1) {
    const strip = h('div', { class: 'cam-gal-strip' }, state.shots.map((sh, k) => {
      const t = document.createElement('canvas'); t.width = t.height = 64;
      const m = Math.min(sh.canvas.width, sh.canvas.height);
      t.getContext('2d').drawImage(sh.canvas, (sh.canvas.width - m) / 2, (sh.canvas.height - m) / 2, m, m, 0, 0, 64, 64);
      return h('button', { class: 'cam-gal-thumb' + (k === i ? ' is-on' : ''), type: 'button', 'aria-label': 'Photo ' + (k + 1), onclick: () => openGallery(k) }, t);
    }));
    review.querySelector('.cam-review-actions').before(strip);
    requestAnimationFrame(() => strip.querySelector('.is-on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
    const acts = review.querySelector('.cam-review-actions');
    acts.append(h('button', { class: 'studio-btn', type: 'button', onclick: saveAllShots }, icon('download', 15), h('span', { text: `Save all (${state.shots.length})` })));
  }
  let sx = null;
  const media = review.querySelector('.cam-review-media');
  media.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  media.addEventListener('pointerup', (e) => { if (sx == null) return; const d = e.clientX - sx; sx = null; if (Math.abs(d) > 50) openGallery(Math.max(0, Math.min(state.shots.length - 1, i + (d < 0 ? 1 : -1)))); });
}
async function saveAllShots() {
  try {
    const { zipSync } = await import('../../vendor/fflate/fflate.js');
    const files = {};
    for (const sh of state.shots) { const b = await toBlob(sh.canvas, 'image/jpeg', 0.94); files[sh.base + '.jpg'] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }]; }
    downloadBlob(new Blob([zipSync(files)], { type: 'application/zip' }), `eyad-camera-${stampName()}.zip`);
    toast(`Saved ${state.shots.length} photos (.zip).`, { type: 'ok' });
  } catch (e) { toast('Could not save the photos.', { type: 'error', detail: e.message }); }
}

// ---------------------------------------------------------------- camera picker & more menu
function menuAt(btn, items) { const r = btn.getBoundingClientRect(); contextMenu(Math.max(8, r.right - 240), r.bottom + 6, items); }
function pickCamera() {
  const list = state.devices || [];
  if (!list.length) return;
  const cur = state.track && state.track.getSettings ? state.track.getSettings().deviceId : '';
  menuAt(btnCams, list.map((d, i) => ({ label: d.label || `Camera ${i + 1}`, checked: () => d.deviceId === cur, action: () => { state.deviceId = d.deviceId; persist(); startCamera(); } })));
}
function moreMenu() {
  menuAt(btnMore, [
    { label: 'Shutter sound', checked: () => state.sound, action: () => { state.sound = !state.sound; persist(); } },
    { label: 'Live histogram', checked: () => state.hist, action: () => { state.hist = !state.hist; persist(); syncTop(); } },
    { label: 'Horizon level (with grid)', checked: () => state.level, action: () => { state.level = !state.level; if (state.level) state.grid = true; persist(); syncTop(); } },
    { separator: true },
    { label: 'Open a photo…', action: openPhoto },
    { label: 'Import .cube LUT…', action: importLut },
    { label: 'Photos from this session', enabled: () => state.shots.length > 0, action: () => openGallery(state.shots.length - 1) },
    { separator: true },
    { label: 'Restart camera', action: () => startCamera() },
    { label: 'EYAD IMAGE', action: () => { location.href = ROUTES.image; } },
    { label: 'Studio home', action: () => { location.href = ROUTES.home; } },
  ]);
}

// ---------------------------------------------------------------- tap to focus
let tapStart = null;
stage.addEventListener('pointerdown', (e) => { if (e.target.closest('button, input, .cam-message')) return; tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; });
stage.addEventListener('pointerup', async (e) => {
  if (!tapStart || pointers.size > 0) { tapStart = null; return; }
  const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y), dt = performance.now() - tapStart.t; tapStart = null;
  if (moved > 10 || dt > 600 || state.source !== 'camera' || !state.track) return;
  const r = viewBox.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
  let nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
  if (mirrored()) nx = 1 - nx;
  const sr = stage.getBoundingClientRect();
  focusRing.style.left = (e.clientX - sr.left) + 'px'; focusRing.style.top = (e.clientY - sr.top) + 'px';
  focusRing.classList.remove('is-on', 'is-ok'); void focusRing.offsetWidth; focusRing.classList.add('is-on');
  const ok = await focusAt(state.track, nx, ny);
  if (ok) focusRing.classList.add('is-ok');
  setTimeout(() => focusRing.classList.remove('is-on', 'is-ok'), 1400);
});

// ---------------------------------------------------------------- histogram & level
var histTick = 0, levelSeen = false; // var: read by syncTop() at boot
function afterFrame(src) {
  if (state.hist && !histCanvas.hidden && ++histTick % 6 === 0) {
    try { const c = drawHistogram(src, histCanvas); histCanvas.classList.toggle('is-clip', c.clipHi || c.clipLo); } catch (e) { /* ignore */ }
  }
}
watchLevel((roll) => {
  if (!levelSeen) { levelSeen = true; syncTop(); }
  const flat = Math.abs(roll) < 1.2;
  levelEl.style.setProperty('--roll', (-roll).toFixed(1) + 'deg');
  levelEl.classList.toggle('is-level', flat);
});

// ---------------------------------------------------------------- keyboard
addEventListener('keydown', (e) => {
  if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!review.hidden) { if (e.key === 'Escape') { e.preventDefault(); closeReview(); } return; }
  if (document.querySelector('.studio-scrim')) return;
  if (e.key === ' ' || e.key === 'Enter') { if (e.target === document.body || e.target === shutter) { e.preventDefault(); onShutter(); } }
  else if (e.key === 'ArrowRight' && !e.target.closest('.cam-panel')) { e.preventDefault(); stepLook(1); }
  else if (e.key === 'ArrowLeft' && !e.target.closest('.cam-panel')) { e.preventDefault(); stepLook(-1); }
  else if (e.key === 'g') { state.grid = !state.grid; syncTop(); persist(); }
  else if (e.key === 'f') { state.flash = !state.flash; syncTop(); persist(); }
  else if (e.key === 't') { state.timer = TIMERS[(TIMERS.indexOf(state.timer) + 1) % TIMERS.length]; syncTop(); persist(); }
  else if (e.key === 'h') { state.hist = !state.hist; syncTop(); persist(); }
  else if (e.key === 'p') setMode(state.mode === 'portrait' ? 'photo' : 'portrait');
  else if (e.key === 'b') setMode('burst');
  else if (e.key === 'v') setMode('video');
  else if ((e.key === '+' || e.key === '=') && state.caps && state.caps.zoom) setZoom(state.zoom + 0.5);
  else if (e.key === '-' && state.caps && state.caps.zoom) setZoom(state.zoom - 0.5);
  else if (e.key === 'Escape' && body.classList.contains('cam-panel-open')) togglePanel(false);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // save battery and free the camera for other apps; resume when we are back
    if (state.source === 'camera' && state.stream && !state.recording && !state.busy) { state.pausedByHide = true; stopStream(); }
    return;
  }
  if (state.source === 'camera' && (state.pausedByHide || (state.track && state.track.readyState === 'ended'))) { state.pausedByHide = false; startCamera(); }
});
addEventListener('pagehide', () => { stopStream(); if (micStream) micStream.getTracks().forEach((t) => t.stop()); renderer.dispose(); });

// ---------------------------------------------------------------- boot
buildStrip();
buildPanel();
syncQuad();
syncControls();
syncFx();
if (fxById(state.fx).ai) setFx(state.fx);
if (matchMedia('(min-width: 1100px) and (min-height: 600px)').matches) togglePanel(true);
requestAnimationFrame(() => { const it = itemById.get(state.lookId); if (it) it.scrollIntoView({ inline: 'center', block: 'nearest' }); });
rafId = requestAnimationFrame(frame);
startCamera();
