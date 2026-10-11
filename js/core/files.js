// EYAD STUDIO — file detection, validation and download helpers.
// Imported files are untrusted: we sniff magic bytes instead of trusting
// the extension, cap sizes, and sanitize every filename we display or write.
import { h } from './dom.js';
import { toast, dialog } from './ui.js';

export const LIMITS = {
  image: 512 * 1024 * 1024,     // 512 MB
  psd: 1024 * 1024 * 1024,      // 1 GB
  prproj: 256 * 1024 * 1024,    // 256 MB compressed
  eyad: 4 * 1024 * 1024 * 1024, // 4 GB
  media: 8 * 1024 * 1024 * 1024,
};

export function sanitizeFilename(name, fallback = 'untitled') {
  let n = String(name || '').normalize('NFC');
  n = n.split(/[\\/]/).pop();                         // strip any path
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, ''); // control + reserved chars
  n = n.replace(/^\.+/, '').trim();
  if (n.length > 120) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : '';
    n = n.slice(0, 120 - ext.length) + ext;
  }
  return n || fallback;
}

export function baseName(name) {
  const n = sanitizeFilename(name);
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(0, i) : n;
}

export function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * Sniff a file. Returns { kind, format, label }
 * kind: 'psd' | 'image' | 'video' | 'audio' | 'eyad' | 'prproj' | 'pdf' | 'fig' | 'model3d' | 'lut' | 'unknown'
 */
export async function detectFile(file) {
  const ext = extOf(file.name);
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = (a, b) => String.fromCharCode(...head.slice(a, b));
  const u32 = (i) => (head[i] << 24 | head[i + 1] << 16 | head[i + 2] << 8 | head[i + 3]) >>> 0;

  if (ascii(0, 4) === '8BPS') return { kind: 'psd', format: head[5] === 2 ? 'psb' : 'psd', label: head[5] === 2 ? 'PSB (large document)' : 'Photoshop document' };
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return { kind: 'image', format: 'png', label: 'PNG image' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'image', format: 'jpeg', label: 'JPEG image' };
  if (ascii(0, 4) === 'GIF8') return { kind: 'image', format: 'gif', label: 'GIF image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'image', format: 'webp', label: 'WebP image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { kind: 'audio', format: 'wav', label: 'WAV audio' };
  if (ascii(0, 2) === 'BM' && ext === 'bmp')return { kind: 'image', format: 'bmp', label: 'BMP image' };
  if (ext === 'prproj' && !(head[0] === 0x1f && head[1] === 0x8b) && !/<\?xml|<PremiereData/.test(ascii(0, 64))) {
    return { kind: 'unknown', format: 'prproj', label: 'Not a valid Premiere project (the file is not compressed project XML — it may be damaged or renamed)' };
  }
  // PDF (and .ai saved with PDF compatibility) → EYAD VECTOR
  if (ascii(0, 5) === '%PDF-' || (ext === 'pdf' || ext === 'ai') && (await file.slice(0, 1024).text()).includes('%PDF-')) return { kind: 'pdf', format: ext === 'ai' ? 'ai' : 'pdf', label: ext === 'ai' ? 'Illustrator-compatible artwork (PDF-based .ai)' : 'PDF document' };
  if (ascii(0, 10) === '%!PS-Adobe' && (ext === 'ai' || ext === 'eps')) return { kind: 'pdf', format: ext, label: 'Legacy PostScript artwork (.' + ext + ')' };
  if (ascii(0, 8) === 'fig-kiwi') return { kind: 'fig', format: 'fig', label: 'Design file (.fig)' };
  if (ascii(0, 4) === 'glTF') return { kind: 'model3d', format: 'glb', label: '3D model (GLB)' };
  if (['gltf', 'obj', 'stl', 'fbx'].includes(ext)) return { kind: 'model3d', format: ext, label: '3D model (.' + ext + ')' };
  if (ext === 'cube' && /LUT_(3D|1D)_SIZE|TITLE|DOMAIN_/i.test(await file.slice(0, 4096).text())) return { kind: 'lut', format: 'cube', label: 'Colour LUT (.cube)' };
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    if (ext === 'eyad') return { kind: 'eyad', format: 'eyad', label: 'EYAD project' };
    if (ext === 'fig') return { kind: 'fig', format: 'fig', label: 'Design file (.fig, zipped)' };
    return { kind: 'unknown', format: 'zip', label: 'ZIP archive' };
  }
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (ext === 'prproj') return { kind: 'prproj', format: 'prproj', label: 'Premiere Pro project (compressed XML)' };
    return { kind: 'unknown', format: 'gzip', label: 'GZIP archive' };
  }
  if (ext === 'prproj' && /<\?xml|<PremiereData/.test(ascii(0, 64))) return { kind: 'prproj', format: 'prproj-xml', label: 'Premiere Pro project (uncompressed XML)' };
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    const isAudio = ext === 'weba' || (file.type || '').startsWith('audio/');
    return { kind: isAudio ? 'audio' : 'video', format: 'webm', label: isAudio ? 'WebM audio' : 'WebM / Matroska video' };
  }
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (/^M4A|^M4B|^F4A/.test(brand) || ['m4a', 'aac'].includes(ext)) return { kind: 'audio', format: 'm4a', label: 'AAC / M4A audio' };
    if (brand === 'qt  ') return { kind: 'video', format: 'mov', label: 'QuickTime MOV' };
    if (/^hei|^mif1|^avif|^avis/.test(brand)) return { kind: 'image', format: brand.trim(), label: brand.startsWith('avi') ? 'AVIF image' : 'HEIC image' };
    return { kind: 'video', format: ext === 'mov' ? 'mov' : 'mp4', label: ext === 'mov' ? 'QuickTime MOV' : 'MP4 video' };
  }
  if (ext === 'mov' && (ascii(4, 8) === 'moov' || ascii(4, 8) === 'wide' || ascii(4, 8) === 'mdat')) return { kind: 'video', format: 'mov', label: 'QuickTime MOV' };
  if (ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && ['mp3', 'mpeg', 'mpga'].includes(ext))) return { kind: 'audio', format: 'mp3', label: 'MP3 audio' };
  if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return { kind: 'audio', format: 'aac', label: 'AAC (ADTS) audio' };
  if (ascii(0, 4) === 'OggS') return { kind: 'audio', format: 'ogg', label: 'Ogg audio' };
  if (ascii(0, 4) === 'fLaC') return { kind: 'audio', format: 'flac', label: 'FLAC audio' };
  // SVG: text — look for <svg in the first 1 KB.
  if (ext === 'svg' || (file.type || '') === 'image/svg+xml') {
    const txt = await file.slice(0, 2048).text();
    if (/<svg[\s>]/i.test(txt)) return { kind: 'image', format: 'svg', label: 'SVG vector' };
  }
  if (ext === 'eyad') return { kind: 'unknown', format: 'eyad', label: 'Damaged EYAD project' };
  if (ext === 'psd' || ext === 'psb') return { kind: 'unknown', format: 'psd', label: 'Not a real PSD (signature missing)' };
  return { kind: 'unknown', format: ext || '?', label: 'Unrecognised file' };
}

// iPhone / iPad (iPadOS reports itself as a Mac with touch).
export const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const IS_TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Open the system file picker. Must be called straight from a click/tap
 * (no await before it — phones only open pickers from a fresh tap).
 *
 * `accept` on phones: iOS and Android turn every entry into a file type they
 * know. Extensions they have no type for (.eyad, .psd, .psb, .prproj, .cube,
 * .glb …) are ignored, and the picker then greys out exactly the files you
 * want. So when the list contains such an extension, phones get an unrestricted
 * picker and every file is identified afterwards by its content (detectFile).
 *
 * source: 'files' (default) | 'photos' (photo library) | 'camera' (take a
 * photo/video). `media` narrows photos/camera to 'image', 'video' or both.
 */
const PLAIN_EXT = /^\.(png|jpe?g|webp|gif|svg|bmp|avif|heic|mp4|webm|mov|m4v|mp3|wav|aac|m4a|ogg|oga|opus|flac|pdf|txt|json|zip)$/i;
export function acceptFor(accept) {
  if (!accept) return '';
  if (IS_IOS) return '';
  if ((IS_ANDROID || IS_TOUCH) && accept.split(',').some((a) => { a = a.trim(); return a.startsWith('.') && !PLAIN_EXT.test(a); })) return '';
  return accept;
}
let stalePicker = null;
export function pickFiles({ accept = '', multiple = false, source = 'files', media = 'any' } = {}) {
  // A picker that was closed without a `cancel` event (older iOS) leaves its input behind: drop it.
  if (stalePicker) { stalePicker.remove(); stalePicker = null; }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    const mediaAccept = media === 'image' ? 'image/*' : media === 'video' ? 'video/*' : 'image/*,video/*';
    if (source === 'photos') input.accept = mediaAccept;
    else if (source === 'camera') { input.accept = media === 'video' ? 'video/*' : 'image/*'; input.setAttribute('capture', 'environment'); }
    else input.accept = acceptFor(accept);
    input.multiple = multiple && source !== 'camera';
    input.tabIndex = -1;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    input.style.opacity = '0';
    input.style.fontSize = '16px'; // never let iOS zoom the page for a hidden input
    input.setAttribute('aria-hidden', 'true');
    let done = false;
    const finish = (files) => { if (done) return; done = true; if (stalePicker === input) stalePicker = null; setTimeout(() => input.remove(), 0); resolve(files); };
    input.addEventListener('change', () => finish(Array.from(input.files || [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    stalePicker = input;
    input.click();
  });
}

// ======================================================================
// SAVING — one function for every export / download in the Studio.
//
//   downloadBlob(blob, filename, opts?) → Promise<{ status, via, name }>
//     status: 'saved'      the browser took the file (download started / written by the picker)
//             'shared'     handed to the system share sheet (iPhone: "Save Image", "Save to Files", AirDrop…)
//             'cancelled'  the person closed the share sheet / picker / ready-sheet without saving
//             'failed'     nothing worked (very rare; the ready-sheet stays as the last resort)
//     via:    'download' | 'share' | 'picker' | 'sheet'
//   It never throws, and a cancelled share is NOT an error.
//
// Why it is not just <a download>:
//   · iPhone / iPad, Safari tab: blob downloads are flaky for big files and land in a hidden "Downloads" folder.
//   · iPhone / iPad, installed to the Home Screen: <a download> does nothing or opens a viewer with no way back.
//   · In-app browsers (Instagram, Facebook…): blob downloads are silently dropped.
//   There the file goes through navigator.share({ files }) which needs a fresh tap. When the file was produced
//   seconds after the tap (a render), the tap is gone, so a small "Your file is ready" sheet appears and ITS
//   button performs the save.
// ======================================================================

const UA = navigator.userAgent || '';
export const IS_ANDROID = /Android/i.test(UA);
/** Instagram / Facebook / Line / generic Android WebView: downloads of blob: URLs are dropped. */
export const IS_INAPP = /Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|; wv\)/i.test(UA);
/** Installed to the Home Screen / running as an app window. */
export function isStandalone() {
  try { return navigator.standalone === true || (typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches)); } catch (e) { return false; }
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  heic: 'image/heic', psd: 'image/vnd.adobe.photoshop', psb: 'application/octet-stream', pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', weba: 'audio/webm', flac: 'audio/flac',
  zip: 'application/zip', glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', stl: 'model/stl',
  json: 'application/json', txt: 'text/plain', srt: 'text/plain', vtt: 'text/vtt', xml: 'application/xml', cube: 'text/plain', csv: 'text/csv',
  // .eyad is a ZIP container, but it must keep its own extension: a generic binary type is the one every
  // platform shares and stores without renaming the file to .zip.
  eyad: 'application/octet-stream',
};
const EXT_FOR = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'application/zip': 'zip', 'model/gltf-binary': 'glb', 'application/json': 'json', 'text/plain': 'txt', 'text/vtt': 'vtt' };

/** The MIME type a file with this name should carry ('' when unknown). */
export function mimeFor(name) { return MIME[extOf(name)] || ''; }

/** Sanitized name with an extension, a clean MIME type (no codec parameters) and a blob that carries it. */
export function describeFile(blob, filename) {
  let name = sanitizeFilename(filename, 'eyad-file');
  let type = String((blob && blob.type) || '').split(';')[0].trim().toLowerCase();
  let ext = extOf(name);
  if (!ext && EXT_FOR[type]) { ext = EXT_FOR[type]; name += '.' + ext; }
  const want = MIME[ext];
  // the name wins over a missing / generic type; a real type wins over an unknown extension
  if (want && (!type || type === 'application/octet-stream' || ext === 'eyad' || ext === 'srt' || ext === 'mov' || ext === 'm4v')) type = want;
  if (!type) type = 'application/octet-stream';
  const kind = type.startsWith('image/') && ext !== 'psd' && ext !== 'psb' ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : type === 'application/pdf' ? 'pdf' : 'file';
  const out = blob.type === type ? blob : blob.slice(0, blob.size, type);
  return { blob: out, name, type, ext, kind, size: blob.size };
}

const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const fileOf = (it) => it.file || (it.file = new File([it.blob], it.name, { type: it.type, lastModified: Date.now() }));

/** Can these files be handed to the system share sheet? */
export function canShareFiles(files) {
  try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files })); } catch (e) { return false; }
}
/** true / false when the browser tells us; undefined when it cannot (then we simply try). */
function tapIsFresh() { const ua = navigator.userActivation; return ua ? !!ua.isActive : undefined; }

// Object URLs must outlive the download: iOS and Android read the blob lazily, long after click() returns.
const urlLife = (size) => Math.min(600000, 90000 + (size / 1048576) * 1500);
function anchorDownload(it, href) {
  const url = href || URL.createObjectURL(it.blob);
  const a = document.createElement('a');
  a.href = url; a.download = it.name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1500);
  if (!href) setTimeout(() => URL.revokeObjectURL(url), urlLife(it.size));
}

// ---- touch (Android): the download just starts; offer Share as a second way, one toast per burst
let dlBurst = [], dlTimer = 0;
function downloadStartedToast(it) {
  dlBurst.push(it);
  clearTimeout(dlTimer);
  dlTimer = setTimeout(() => {
    const items = dlBurst; dlBurst = [];
    const files = items.map(fileOf);
    const share = canShareFiles(files);
    toast(items.length === 1 ? `Download started: ${items[0].name}` : `Download started: ${items.length} files`, {
      type: 'ok', timeout: 6000, detail: 'Look in Downloads / the Files app.',
      action: share ? { label: 'Share', fn: () => { navigator.share({ files }).catch(() => {}); } } : null,
    });
  }, 350);
}

// ---- desktop "Save as…"
async function pickerSave(it) {
  const handle = await window.showSaveFilePicker({ suggestedName: it.name, types: it.ext ? [{ description: it.ext.toUpperCase() + ' file', accept: { [it.type === 'application/octet-stream' ? 'application/octet-stream' : it.type]: ['.' + it.ext] } }] : undefined });
  const w = await handle.createWritable();
  await w.write(it.blob);
  await w.close();
}

// ---- iPhone / iPad / in-app browsers: share sheet, or the "ready" sheet when the tap is gone
let sharing = false;        // a navigator.share() is on screen (a second one would throw)
let shareStart = 0;         // …some iOS versions never settle that promise, so it is only trusted for a moment
let waiting = [];           // files that arrived while it was
let ready = null;           // the open "Your file is ready" sheet

function shareFirst(it) {
  sharing = true; shareStart = Date.now();
  let p;
  try { p = navigator.share({ files: [fileOf(it)] }); } catch (e) { p = Promise.reject(e); }
  Promise.resolve(p).then(
    () => it.finish('shared', 'share'),
    (e) => {
      if (e && e.name === 'AbortError') it.finish('cancelled', 'share');   // closed the share sheet: not an error
      else openReady([it], e && e.name === 'NotAllowedError' ? '' : 'The share sheet did not open.');
    },
  ).then(() => { sharing = false; if (waiting.length) openReady(waiting.splice(0)); });
}

function openReady(items, problem = '') {
  if (ready) { items.forEach(ready.add); return; }
  const list = h('div', { class: 'studio-save-list', style: { display: 'grid', gap: '10px' } });
  const noteEl = h('p', { class: 'studio-dim studio-small', style: { margin: '0' } });
  const warnEl = h('p', { class: 'studio-small', style: { margin: '0', fontWeight: '600' } });
  const actions = h('div', { class: 'studio-save-actions', style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
  const all = [];
  const urls = new Map();
  const urlOf = (it) => { if (!urls.has(it)) urls.set(it, URL.createObjectURL(it.blob)); return urls.get(it); };
  let closeDlg = null, busy = false;
  const pending = () => all.filter((it) => !it.done);

  const row = (it) => {
    const thumb = it.kind === 'image'
      // a real <img>: on iPhone, touch-and-hold on it offers "Save to Photos" even when everything else fails
      ? h('img', { src: urlOf(it), alt: it.name, draggable: false, style: { width: '100%', maxHeight: '38vh', objectFit: 'contain', borderRadius: '10px', display: 'block', background: 'rgba(127,127,127,.14)', webkitTouchCallout: 'default', webkitUserSelect: 'auto', userSelect: 'auto' } })
      : it.kind === 'video' ? (() => { const v = h('video', { src: urlOf(it), controls: true, playsInline: true, muted: true, preload: 'metadata', style: { width: '100%', maxHeight: '38vh', borderRadius: '10px', display: 'block', background: '#000' } }); v.setAttribute('playsinline', ''); return v; })()
        : null;
    it.stateEl = h('span', { class: 'studio-dim studio-small', text: fmtSize(it.size) });
    it.thumbEl = all.length <= 6 ? thumb : null;   // previews for the first files only (memory on phones)
    it.rowEl = h('div', { class: 'studio-save-item', style: { display: 'grid', gap: '6px', alignItems: 'center' } },
      it.thumbEl,
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', justifyContent: 'space-between', minWidth: '0' } },
        h('strong', { text: it.name, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0' } }), it.stateEl));
    return it.rowEl;
  };

  let titleEl = null;
  const layout = () => {
    const many = all.length > 1;
    if (titleEl) titleEl.textContent = many ? 'Your files are ready' : 'Your file is ready';
    for (const it of all) {
      it.rowEl.style.gridTemplateColumns = many && it.thumbEl ? '56px minmax(0, 1fr)' : 'minmax(0, 1fr)';
      if (!it.thumbEl) continue;
      it.thumbEl.style.width = many ? '56px' : '100%';
      it.thumbEl.style.height = many ? '56px' : '';
      it.thumbEl.style.objectFit = many ? 'cover' : 'contain';
      if (it.thumbEl.tagName === 'VIDEO') it.thumbEl.controls = !many;
    }
  };
  const render = () => {
    layout();
    const left = pending();
    const files = left.map(fileOf);
    const share = left.length > 0 && canShareFiles(files);
    const one = left.length === 1 ? left[0] : null;
    const webm = left.some((it) => it.kind === 'video' && !/mp4|quicktime/.test(it.type));
    const kinds = new Set(left.map((it) => it.kind));
    warnEl.textContent = problem;
    warnEl.hidden = !problem;
    let note = '';
    if (!left.length) note = 'All done.';
    else if (share) {
      if (IS_IOS && webm) note = 'This video is WebM. Photos on iPhone and iPad cannot store WebM, so choose “Save to Files” in the next step. It plays in the Studio and in players such as VLC.';
      else if (kinds.size === 1 && kinds.has('image')) note = IS_IOS ? (one ? 'Tap Save, then choose “Save Image” to put it in Photos, or “Save to Files”. You can also touch and hold the picture.' : 'Tap Save, then choose “Save Images” to put them in Photos, or “Save to Files”.') : 'Tap Save and pick where it should go.';
      else if (kinds.size === 1 && kinds.has('video')) note = IS_IOS ? 'Tap Save, then choose “Save Video” to put it in Photos, or “Save to Files”.' : 'Tap Save and pick where it should go.';
      else note = IS_IOS ? 'Tap Save, then choose “Save to Files” (or send it with AirDrop, Mail…).' : 'Tap Save and pick where it should go.';
    } else {
      note = (kinds.has('image') ? 'Touch and hold the picture and choose “Save to Photos”, or use Download. ' : 'Use Download. ')
        + (IS_INAPP ? 'This in-app browser blocks saving files — if nothing happens, open the Studio in Safari or Chrome.' : isStandalone() && IS_IOS ? 'If nothing happens, open the Studio in Safari and export again.' : '');
    }
    noteEl.textContent = note;

    const btns = [];
    if (share) btns.push(h('button', { class: 'studio-btn is-primary', type: 'button', dataset: { save: 'share' }, style: { flex: '1 1 140px', minHeight: '44px' }, text: left.length > 1 ? `Save ${left.length} files…` : 'Save…', onclick: doShare }));
    // A real link the person taps themselves. In a Safari tab it downloads to Files ▸ Downloads; it is hidden in the
    // installed app when sharing works, because there it opens a viewer that cannot be closed.
    if (one && (!share || !(IS_IOS && isStandalone()))) {
      const small = !share && one.size < 1500000 && one.dataUrl;
      const a = h('a', { class: 'studio-btn' + (share ? '' : ' is-primary'), dataset: { save: 'download' }, href: small ? one.dataUrl : urlOf(one), download: one.name, rel: 'noopener', style: { flex: '1 1 110px', minHeight: '44px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }, text: 'Download' });
      a.addEventListener('click', () => { setTimeout(() => { if (!one.done) { one.stateEl.textContent = 'Download started'; one.soft = true; render(); } }, 400); });
      btns.push(a);
    }
    if (one && !share && (one.kind === 'image' || one.kind === 'video' || one.kind === 'pdf') && !(IS_IOS && isStandalone())) {
      btns.push(h('a', { class: 'studio-btn', dataset: { save: 'open' }, href: urlOf(one), target: '_blank', rel: 'noopener', style: { flex: '1 1 110px', minHeight: '44px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }, text: 'Open in a new tab' }));
    }
    const untouched = left.filter((it) => !it.soft).length;
    btns.push(h('button', { class: 'studio-btn', type: 'button', dataset: { save: 'close' }, style: { flex: '1 1 90px', minHeight: '44px' }, text: untouched ? 'Not now' : 'Done', onclick: () => closeAll() }));
    actions.replaceChildren(...btns);
  };

  async function doShare() {
    if (busy) return;
    const left = pending();
    if (!left.length) return;
    busy = true; problem = '';
    try {
      await navigator.share({ files: left.map(fileOf) });
      left.forEach((it) => { it.stateEl.textContent = 'Done'; it.finish('shared', 'share'); });
      busy = false;
      closeAll();
      toast(left.length > 1 ? `${left.length} files handed over.` : 'Done.', { type: 'ok', timeout: 1800 });
      return;
    } catch (e) {
      if (!e || e.name !== 'AbortError') problem = 'The share sheet could not open (' + ((e && e.name) || 'error') + '). Try Save again' + (left.length > 1 ? ', or save the files one at a time.' : '.');
    }
    busy = false;
    render();
  }

  function closeAll() {
    for (const it of all) if (!it.done) it.finish(it.soft ? 'saved' : 'cancelled', it.soft ? 'download' : 'sheet');
    const u = Array.from(urls.values());
    setTimeout(() => u.forEach((x) => URL.revokeObjectURL(x)), 120000);
    ready = null;
    if (closeDlg) closeDlg(null);
    if (waiting.length) openReady(waiting.splice(0));
  }

  const add = (it) => {
    all.push(it);
    list.appendChild(row(it));
    // tiny files in browsers without file sharing: a data: URL survives where blob: URLs are dropped
    if (it.size < 1500000 && !canShareFiles([fileOf(it)])) {
      const fr = new FileReader();
      fr.onload = () => { it.dataUrl = fr.result; render(); };
      fr.readAsDataURL(it.blob);
    }
    render();
  };
  ready = { add };
  items.forEach(add);
  dialog({
    title: items.length > 1 ? 'Your files are ready' : 'Your file is ready', width: 460, dismissable: false, buttons: [], className: 'studio-save-dialog',
    body: h('div', { class: 'studio-stack', style: { display: 'grid', gap: '12px' } }, list, warnEl, noteEl, actions),
    onOpen: ({ close, box }) => { closeDlg = close; titleEl = box.querySelector('.studio-dialog-title'); layout(); },
  });
}

/** The promise of the most recent downloadBlob() call (for callers that fire the save inside a helper). */
let lastSavePromise = Promise.resolve({ status: 'saved', via: 'download', name: '' });
export function lastSave() { return lastSavePromise; }

/**
 * Save / export a blob. See the header above.
 * opts.saveAs  desktop: ask where to put it (File System Access) when the browser can
 * opts.sheet   always go through the "ready" sheet on phones (skip the immediate share)
 * opts.quiet   no "download started" toast on touch devices
 */
export function downloadBlob(blob, filename, opts = {}) {
  lastSavePromise = new Promise((resolve) => {
    let it;
    try {
      if (!(blob instanceof Blob)) throw new TypeError('Nothing to save.');
      it = describeFile(blob, filename);
    } catch (e) { resolve({ status: 'failed', via: 'download', name: String(filename || ''), error: e }); return; }
    it.done = false;
    it.finish = (status, via) => { if (it.done) return; it.done = true; resolve({ status, via, name: it.name }); };

    if (IS_IOS || IS_INAPP) {
      if (ready) { ready.add(it); return; }
      if (sharing && Date.now() - shareStart < 2500) { waiting.push(it); return; }
      sharing = false;
      if (!opts.sheet && tapIsFresh() !== false && canShareFiles([fileOf(it)])) { shareFirst(it); return; }
      openReady([it]);
      return;
    }
    if (opts.saveAs && typeof window.showSaveFilePicker === 'function' && tapIsFresh() !== false) {
      pickerSave(it).then(() => it.finish('saved', 'picker'), (e) => {
        if (e && e.name === 'AbortError') { it.finish('cancelled', 'picker'); return; }
        try { anchorDownload(it); it.finish('saved', 'download'); } catch (e2) { it.finish('failed', 'download'); }
      });
      return;
    }
    try {
      anchorDownload(it);
      if (IS_TOUCH && !opts.quiet) downloadStartedToast(it);
      it.finish('saved', 'download');
    } catch (e) { openReady([it], 'The download could not start.'); }
  });
  return lastSavePromise;
}

/**
 * Tell the person what really happened. Accepts the result or the promise from downloadBlob().
 *   savedToast(downloadBlob(blob, name), 'Saved.')
 * 'saved' → okText · 'shared' → nothing more (the system sheet already confirmed) · 'cancelled' → quiet note · 'failed' → error.
 */
export function savedToast(resultOrPromise, okText = 'Saved.') {
  return Promise.resolve(resultOrPromise).then((r) => {
    if (!r) return r;
    if (r.status === 'saved' && r.via !== 'download') toast(okText, { type: 'ok', timeout: 1800 });
    else if (r.status === 'saved' && !(IS_TOUCH && !IS_IOS)) toast(okText, { type: 'ok', timeout: 1800 });   // on Android the "download started" toast already says it
    else if (r.status === 'cancelled') toast('Not saved.', { timeout: 1600 });
    else if (r.status === 'failed') toast('Could not save the file.', { type: 'error' });
    return r;
  });
}

export const ACCEPT = {
  image: '.png,.jpg,.jpeg,.webp,.gif,.svg,.bmp,.avif,image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
  psd: '.psd,.psb',
  imageAll: '.png,.jpg,.jpeg,.webp,.gif,.svg,.bmp,.avif,.psd,.psb,.eyad',
  video: '.mp4,.webm,.mov,.m4v,.mkv,video/*',
  audio: '.mp3,.wav,.aac,.m4a,.ogg,.oga,.opus,.flac,.weba,audio/*',
  media: '.mp4,.webm,.mov,.m4v,.mkv,.mp3,.wav,.aac,.m4a,.ogg,.oga,.opus,.flac,.weba,.png,.jpg,.jpeg,.webp,.gif,.svg,video/*,audio/*',
  eyad: '.eyad',
  prproj: '.prproj',
  vectorAll: '.eyad,.svg,.pdf,.ai,.eps,.fig,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp',
  model3d: '.glb,.gltf,.obj,.stl,.fbx',
  lut: '.cube',
  any: '',
};

/** Load an image file (PNG/JPG/WEBP/GIF/SVG…) into an HTMLImageElement / ImageBitmap. */
export async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url; // SVG loaded through <img> runs no scripts and fetches nothing external
    await img.decode();
    let w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) { w = 1024; h = 1024; } // SVG without intrinsic size
    const MAX = 16384;
    if (w > MAX || h > MAX) {
      const s = Math.min(MAX / w, MAX / h);
      w = Math.round(w * s); h = Math.round(h * s);
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  } catch (e) {
    throw new Error('The browser could not decode this image. It may be damaged or in an unsupported format.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
