// EYAD STUDIO — file detection, validation and download helpers.
// Imported files are untrusted: we sniff magic bytes instead of trusting
// the extension, cap sizes, and sanitize every filename we display or write.

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
 * kind: 'psd' | 'image' | 'video' | 'audio' | 'eyad' | 'prproj' | 'unknown'
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
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    if (ext === 'eyad') return { kind: 'eyad', format: 'eyad', label: 'EYAD project' };
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
 * Open the system file picker. Must be called straight from a click/tap.
 *
 * iOS note: Safari turns every entry of `accept` into a file type it knows.
 * Extensions it has no type for (.psb, .eyad, .prproj, some .psd setups) make
 * the Files app grey out the very files you want, which is why PSDs could not
 * be picked. On iOS the Files picker is therefore opened unrestricted and each
 * file is identified afterwards by its real content (detectFile sniffs bytes).
 *
 * source: 'files' (default) | 'photos' (photo library) | 'camera' (take a
 * photo/video). `media` narrows photos/camera to 'image', 'video' or both.
 */
export function pickFiles({ accept = '', multiple = false, source = 'files', media = 'any' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    const mediaAccept = media === 'image' ? 'image/*' : media === 'video' ? 'video/*' : 'image/*,video/*';
    if (source === 'photos') input.accept = mediaAccept;
    else if (source === 'camera') { input.accept = media === 'video' ? 'video/*' : 'image/*'; input.setAttribute('capture', 'environment'); }
    else input.accept = IS_IOS ? '' : accept;
    input.multiple = multiple && source !== 'camera';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.setAttribute('aria-hidden', 'true');
    let done = false;
    const finish = (files) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish(Array.from(input.files || [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
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
