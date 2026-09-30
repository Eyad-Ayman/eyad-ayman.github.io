// EYAD CAMERA — live camera with Film Lab looks (loaded only on /studio/camera/).
// Live preview through film.js, full-resolution capture, short video recording,
// "Open photo" for existing images, .cube LUT import, and hand-off to EYAD IMAGE / VIDEO.
import { h, clear, clamp, isTyping } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, iconButton } from '../core/ui.js';
import { bootStudio, ROUTES } from '../core/shell.js';
import { pickFiles, downloadBlob, ACCEPT, IS_TOUCH, detectFile, loadImageFile, sanitizeFilename, baseName } from '../core/files.js';
import { putHandoff } from '../core/db.js';
import {
  LOOKS, LOOK_PARAMS, FRAMES, getLook, defaultParams, applyLook, createLiveRenderer,
  lookThumbnail, looksByGroup, registerLook, todayStamp, sanitizeDateText,
} from '../core/film.js';
import { BUILTIN_LUTS, readCubeFile, lutToLook, getBuiltinLut } from '../core/lut.js';

bootStudio();

const STORE = 'eyad-camera:v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; } })();
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify({ look: state.lookId, aspect: state.aspect, grid: state.grid, timer: state.timer, flash: state.flash, facing: state.facing })); } catch (e) { /* storage blocked */ } };

const ASPECTS = [
  { id: '3:4', label: '3:4', r: 3 / 4 }, { id: '4:3', label: '4:3', r: 4 / 3 }, { id: '1:1', label: '1:1', r: 1 },
  { id: '9:16', label: '9:16', r: 9 / 16 }, { id: '16:9', label: '16:9', r: 16 / 9 },
];
const PHOTO_ASPECTS = [{ id: 'orig', label: 'Original', r: 0 }, ...ASPECTS];
const TIMERS = [0, 3, 10];
const MAX_REC = 60;

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
const viewBox = h('div', { class: 'cam-viewbox' }, view, gridEl);
const countdown = h('div', { class: 'cam-countdown', 'aria-live': 'assertive' });
const messageEl = h('div', { class: 'cam-message', hidden: true });
const zoomRange = h('input', { class: 'studio-range cam-zoom-range', type: 'range', min: 1, max: 1, step: 0.1, value: 1, 'aria-label': 'Zoom' });
const zoomLabel = h('span', { class: 'cam-zoom-label', text: '1×' });
const zoomBox = h('div', { class: 'cam-zoom', hidden: true }, zoomLabel, zoomRange);
const stage = h('div', { class: 'cam-stage' }, viewBox, messageEl, zoomBox, countdown);
const flashEl = h('div', { class: 'cam-flash', 'aria-hidden': 'true' });
const recBadge = h('div', { class: 'cam-rec', hidden: true }, h('span', { class: 'cam-rec-dot' }), h('span', { class: 'cam-rec-time', text: '0:00' }));

const btnGrid = iconButton('grid', 'Grid', () => { state.grid = !state.grid; syncTop(); persist(); }, { cls: 'cam-tool' });
const btnTimer = h('button', { class: 'studio-icon-btn cam-tool cam-timer', type: 'button', 'aria-label': 'Self-timer', title: 'Self-timer', onclick: () => { state.timer = TIMERS[(TIMERS.indexOf(state.timer) + 1) % TIMERS.length]; syncTop(); persist(); } }, icon('clock', 18), h('span', { class: 'cam-tool-badge' }));
const btnFlash = h('button', { class: 'studio-icon-btn cam-tool', type: 'button', 'aria-label': 'Flash', title: 'Flash', onclick: () => { state.flash = !state.flash; syncTop(); persist(); } });
const btnAspect = h('button', { class: 'cam-chip cam-aspect', type: 'button', 'aria-label': 'Aspect ratio', title: 'Aspect ratio', onclick: cycleAspect });
const btnAdjust = iconButton('sliders', 'Adjust look', () => togglePanel(), { cls: 'cam-tool cam-adjust-btn' });
const homeLink = h('a', { class: 'cam-home', href: ROUTES.home, 'aria-label': 'EYAD STUDIO home' }, icon('back', 18));
const brand = h('a', { class: 'studio-brand cam-brand', href: ROUTES.home, 'aria-label': 'EYAD CAMERA — Studio home' },
  h('span', { class: 'studio-brand-mark', 'aria-hidden': 'true' }),
  h('span', { class: 'studio-brand-word' }, 'EYAD', h('span', { class: 'studio-brand-app', text: 'CAMERA' })));
const top = h('header', { class: 'cam-top' }, homeLink, brand, recBadge, h('div', { class: 'studio-spacer' }), btnAspect, btnFlash, btnTimer, btnGrid, btnAdjust);

const lookName = h('div', { class: 'cam-lookname', 'aria-live': 'polite' });
const chips = h('div', { class: 'cam-groups', role: 'tablist', 'aria-label': 'Look groups' });
const strip = h('div', { class: 'cam-strip', role: 'listbox', 'aria-label': 'Looks' });
const modePhoto = h('button', { class: 'cam-mode', type: 'button', text: 'Photo', onclick: () => setMode('photo') });
const modeVideo = h('button', { class: 'cam-mode', type: 'button', text: 'Video', onclick: () => setMode('video') });
const modes = h('div', { class: 'cam-modes', role: 'group', 'aria-label': 'Capture mode' }, modePhoto, modeVideo);
const shutter = h('button', { class: 'cam-shutter', type: 'button', 'aria-label': 'Take photo', onclick: onShutter }, h('span'));
const btnOpen = h('button', { class: 'cam-round', type: 'button', 'aria-label': 'Open a photo', title: 'Open a photo', onclick: openPhoto }, icon('image', 22));
const btnFlip = h('button', { class: 'cam-round', type: 'button', 'aria-label': 'Switch camera', title: 'Switch camera', onclick: onFlip }, icon('swap', 22));
const controls = h('div', { class: 'cam-controls' }, btnOpen, h('div', { class: 'cam-shutter-wrap' }, modes, shutter), btnFlip);
const dock = h('div', { class: 'cam-dock' }, lookName, chips, strip, controls);

const panelBody = h('div', { class: 'cam-panel-body' });
const panel = h('aside', { class: 'cam-panel', 'aria-label': 'Look adjustments' },
  h('div', { class: 'cam-panel-head' }, h('h2', { class: 'cam-panel-title', text: 'Adjust' }), h('div', { class: 'studio-spacer' }),
    h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'Reset', onclick: resetLook }),
    iconButton('close', 'Close adjustments', () => togglePanel(false), { cls: 'cam-panel-close', size: 16 })),
  panelBody);

const review = h('div', { class: 'cam-review', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Review capture' });

body.append(top, stage, dock, panel, review, flashEl, video);

// ---------------------------------------------------------------- renderer + loop
const renderer = createLiveRenderer(view);
let lastLayout = null;
let needsRender = true;
let rafId = 0;
const t0 = performance.now();

function aspectList() { return state.source === 'file' ? PHOTO_ASPECTS : ASPECTS; }
function currentAspect() { const id = state.source === 'file' ? state.photoAspect : state.aspect; return aspectList().find((a) => a.id === id) || aspectList()[0]; }

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
  zoomBox.hidden = true;
}

async function startCamera() {
  stopStream();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const secure = window.isSecureContext;
    showMessage('Camera unavailable', secure ? 'This browser does not give web pages access to a camera. You can still open a photo and apply looks to it.' : 'The camera only works over a secure (https) connection. You can still open a photo and apply looks to it.', [{ label: 'Open a photo', primary: true, fn: openPhoto }]);
    syncControls();
    return false;
  }
  showMessage('Starting camera…', 'Allow camera access when your browser asks.', []);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    state.stream = stream;
    state.track = stream.getVideoTracks()[0] || null;
    state.source = 'camera';
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay with muted+playsinline normally succeeds */ }
    if (state.track) {
      state.track.addEventListener('ended', () => { if (state.source === 'camera' && state.stream) showMessage('Camera stopped', 'The camera was disconnected or taken by another app.', [{ label: 'Try again', primary: true, fn: startCamera }, { label: 'Open a photo', fn: openPhoto }]); });
      const s = state.track.getSettings ? state.track.getSettings() : {};
      if (s.facingMode === 'user' || s.facingMode === 'environment') state.facing = s.facingMode;
      setupZoom();
    }
    try { const devs = await navigator.mediaDevices.enumerateDevices(); state.cameras = devs.filter((d) => d.kind === 'videoinput').length; } catch (e) { state.cameras = 1; }
    hideMessage();
    syncControls(); syncTop();
    scheduleThumbs(400);
    return true;
  } catch (err) {
    const n = err && err.name;
    let title = 'Camera unavailable', text = 'The camera could not be started.';
    if (n === 'NotAllowedError' || n === 'SecurityError') { title = 'Camera permission denied'; text = 'EYAD CAMERA was not allowed to use the camera. Allow camera access for this site in your browser settings and try again — or open a photo instead.'; }
    else if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') { title = 'No camera found'; text = 'This device does not seem to have a camera. You can open a photo and apply looks to it.'; }
    else if (n === 'NotReadableError' || n === 'TrackStartError') { title = 'Camera is busy'; text = 'Another app or tab is using the camera. Close it and try again.'; }
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
  } else zoomBox.hidden = true;
}
let zoomPending = null;
async function setZoom(z) {
  if (!state.caps || !state.caps.zoom || !state.track) return;
  z = clamp(z, state.caps.zoom.min, state.caps.zoom.max);
  state.zoom = z; zoomRange.value = z; zoomLabel.textContent = z.toFixed(1) + '×';
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
    if (info.kind !== 'image') { toast('That file is not an image EYAD CAMERA can open.', { type: 'warn', detail: sanitizeFilename(f.name) + ' — ' + info.label }); return; }
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
  lookName.textContent = l.name;
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
  if (m === 'video' && state.source !== 'camera') { toast('Video recording uses the live camera.', { type: 'warn' }); return; }
  if (m === 'video' && !canRecord()) { toast('This browser cannot record video from a canvas.', { type: 'warn' }); return; }
  state.mode = m;
  syncControls();
}
function syncControls() {
  const cam = state.source === 'camera' && !!state.stream;
  modePhoto.classList.toggle('is-active', state.mode === 'photo');
  modeVideo.classList.toggle('is-active', state.mode === 'video');
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
  await capturePhoto();
}

async function grabFullFrame() {
  // Best quality: ImageCapture.takePhoto() (full sensor resolution where supported).
  if (typeof ImageCapture !== 'undefined' && state.track && state.track.readyState === 'live') {
    try {
      const ic = new ImageCapture(state.track);
      const blob = await Promise.race([ic.takePhoto(), sleep(6000).then(() => { throw new Error('timeout'); })]);
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
    const src = await withFlash(() => { flashEl.classList.add('is-shot'); setTimeout(() => flashEl.classList.remove('is-shot'), 120); return grabFullFrame(); });
    const W = src.width, H = src.height;
    const out = await applyLook(src, state.lookId, state.params, { crop: cropFor(W, H), mirror: mirrored(), onProgress: (f) => { countdown.textContent = `Developing… ${Math.round(f * 100)}%`; } });
    if (src.close) src.close();
    showReviewPhoto(out, `eyad-camera-${stampName()}-${state.lookId}`);
  } catch (e) {
    toast('The photo could not be captured.', { type: 'error', detail: e.message });
  } finally { busy(false); }
}

async function renderPhoto() {
  if (!state.photo) return;
  busy(true, 'Rendering…');
  try {
    const out = await applyLook(state.photo, state.lookId, state.params, { crop: cropFor(state.photo.width, state.photo.height), onProgress: (f) => { countdown.textContent = `Rendering… ${Math.round(f * 100)}%`; } });
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
  const stream = view.captureStream(30);
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

function showReviewPhoto(canvas, base) {
  base = sanitizeFilename(base);
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


// ---------------------------------------------------------------- AI / social-style smart looks
// These are local, deterministic presets built from EYAD's film engine — no upload.
function buildSmartLooks() {
  if (document.querySelector('.cam-smart-looks')) return;
  const defs = [
    ['flash', 'Flash Pop', 'ccd-party'],
    ['y2k', 'Y2K CCD', 'ccd-2003'],
    ['night', 'Night Flash', 'night-halo'],
    ['film', 'Clean Film', 'cine-50d'],
    ['disposable', 'Disposable', 'fairground'],
    ['warm', 'Warm Skin', 'portrait-400'],
    ['cool', 'Cool Street', 'ccd-blue-2004'],
  ];
  const bar = h('div', { class:'cam-smart-looks', 'aria-label':'AI smart looks' },
    h('span',{class:'cam-smart-label'}, icon('sparkle',12), h('b',{text:'SMART LOOKS'})),
    ...defs.map(([id,label,look]) => h('button',{
      class:'cam-smart-chip', type:'button', dataset:{id},
      title:`Smart look: ${label}`,
      onclick:()=>selectLook(look,true)
    }, h('span',{text:label})))
  );
  body.appendChild(bar);
}

// ---------------------------------------------------------------- keyboard
addEventListener('keydown', (e) => {
  if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!review.hidden) { if (e.key === 'Escape') { e.preventDefault(); closeReview(); } return; }
  if (document.querySelector('.studio-scrim')) return;
  if (e.key === ' ' || e.key === 'Enter') { if (e.target === document.body || e.target === shutter) { e.preventDefault(); onShutter(); } }
  else if (e.key === 'ArrowRight' && !e.target.closest('.cam-panel')) { e.preventDefault(); stepLook(1); }
  else if (e.key === 'ArrowLeft' && !e.target.closest('.cam-panel')) { e.preventDefault(); stepLook(-1); }
  else if (e.key === 'g') { state.grid = !state.grid; syncTop(); persist(); }
  else if (e.key === 'Escape' && body.classList.contains('cam-panel-open')) togglePanel(false);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.source === 'camera' && state.track && state.track.readyState === 'ended') startCamera();
});
addEventListener('pagehide', () => { stopStream(); if (micStream) micStream.getTracks().forEach((t) => t.stop()); renderer.dispose(); });

// ---------------------------------------------------------------- boot
buildSmartLooks();
buildStrip();
buildPanel();
syncControls();
if (matchMedia('(min-width: 1100px) and (min-height: 600px)').matches) togglePanel(true);
requestAnimationFrame(() => { const it = itemById.get(state.lookId); if (it) it.scrollIntoView({ inline: 'center', block: 'nearest' }); });
rafId = requestAnimationFrame(frame);
startCamera();
