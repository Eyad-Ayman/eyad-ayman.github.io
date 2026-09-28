// EYAD VIDEO — media import, probing, thumbnails, waveforms, relinking.
import { uid } from '../core/dom.js';
import { detectFile, sanitizeFilename, LIMITS } from '../core/files.js';
import { putMedia, getMedia } from '../core/db.js';
import { getSettings } from '../core/settings.js';

const PEAKS_URL = new URL('../workers/peaks.worker.js', import.meta.url);
const DECODE_LIMIT = 300 * 1024 * 1024;

let audioCtx = null;
export function getAudioContext() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC({ latencyHint: 'interactive' });
  }
  return audioCtx;
}

function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

export function probeVideo(url) {
  return withTimeout(new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true;
    v.onloadedmetadata = async () => {
      let d = v.duration;
      if (!isFinite(d)) {
        // WebM from MediaRecorder often has no duration; seek far to make the browser compute it.
        d = await new Promise((r) => {
          v.ontimeupdate = () => { v.ontimeupdate = null; r(v.duration); };
          v.currentTime = 1e101;
          setTimeout(() => r(v.duration), 4000);
        });
        v.currentTime = 0;
      }
      resolve({ duration: isFinite(d) ? d : 0, width: v.videoWidth, height: v.videoHeight, el: v });
    };
    v.onerror = () => reject(new Error(mediaErrorText(v.error)));
    v.src = url;
  }), 20000, 'Timed out reading the file. The codec is probably not supported by this browser.');
}

export function probeAudio(url) {
  return withTimeout(new Promise((resolve, reject) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.onloadedmetadata = () => resolve({ duration: isFinite(a.duration) ? a.duration : 0 });
    a.onerror = () => reject(new Error(mediaErrorText(a.error)));
    a.src = url;
  }), 20000, 'Timed out reading the audio file.');
}

export function mediaErrorText(err) {
  if (!err) return 'The browser could not read this media.';
  switch (err.code) {
    case 1: return 'Loading was aborted.';
    case 2: return 'A network error occurred while reading the file.';
    case 3: return 'The file is damaged or uses a codec this browser cannot decode.';
    case 4: return 'This format or codec is not supported by this browser (e.g. ProRes/HEVC MOV). Convert it to H.264 MP4 or WebM.';
    default: return err.message || 'Unknown media error.';
  }
}

async function videoThumb(el, duration) {
  try {
    await new Promise((r, j) => {
      const t = Math.min(duration * 0.1, 2);
      el.onseeked = () => r();
      el.onerror = () => j(new Error('seek failed'));
      el.currentTime = t > 0 ? t : 0;
      setTimeout(r, 3000);
    });
    if (!el.videoWidth) return null;
    const w = 160, hh = Math.max(1, Math.round(160 * el.videoHeight / el.videoWidth));
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    c.getContext('2d').drawImage(el, 0, 0, w, hh);
    return c.toDataURL('image/jpeg', 0.7);
  } catch (e) { return null; }
}

let peaksWorker = null, peaksSeq = 0;
const peaksPending = new Map();
function peaksFrom(buffer, perSec = 100) {
  if (!peaksWorker) {
    peaksWorker = new Worker(PEAKS_URL);
    peaksWorker.onmessage = (e) => { const p = peaksPending.get(e.data.id); if (!p) return; peaksPending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data); };
  }
  return new Promise((resolve, reject) => {
    const id = ++peaksSeq;
    const channels = [];
    for (let i = 0; i < Math.min(2, buffer.numberOfChannels); i++) channels.push(buffer.getChannelData(i).slice());
    peaksPending.set(id, { resolve, reject });
    peaksWorker.postMessage({ id, channels, sampleRate: buffer.sampleRate, perSec }, channels.map((c) => c.buffer));
  });
}

export class MediaStore {
  constructor(onChange) {
    this.rt = new Map(); // id -> { blob, url, bitmap }
    this.buffers = new Map(); // id -> Promise<AudioBuffer>
    this.onChange = onChange || (() => {});
  }

  urlFor(id) { const r = this.rt.get(id); return r ? r.url : null; }
  bitmapFor(id) { const r = this.rt.get(id); return r ? r.bitmap : null; }
  online(id) { return this.rt.has(id); }

  async setBlob(m, blob) {
    const old = this.rt.get(m.id);
    if (old && old.url) URL.revokeObjectURL(old.url);
    const r = { blob, url: URL.createObjectURL(blob), bitmap: null };
    if (m.kind === 'image') { try { r.bitmap = await createImageBitmap(blob); } catch (e) { r.bitmap = null; } }
    this.rt.set(m.id, r);
    this.buffers.delete(m.id);
  }

  /** Import files → media entries (validated, probed, stored locally). */
  async importFile(file, { onStatus } = {}) {
    const info = await detectFile(file);
    const name = sanitizeFilename(file.name);
    if (!['video', 'audio', 'image'].includes(info.kind)) throw new Error(`${name}: ${info.label} can’t be used as media.`);
    if (file.size > LIMITS.media) throw new Error(`${name} is too large for browser editing.`);
    const m = { id: uid('m'), name, kind: info.kind, mime: file.type || info.format, size: file.size, duration: 0, width: 0, height: 0, hasAudio: false, hasVideo: info.kind !== 'audio', stored: false, originalPath: name, offline: false, thumb: null, peaks: null, peaksPerSec: 100, format: info.format };
    const url = URL.createObjectURL(file);
    try {
      if (info.kind === 'video') {
        onStatus && onStatus('Reading ' + name);
        const p = await probeVideo(url);
        if (!p.width && !p.height) {
          // audio-only file inside a video container (e.g. .webm / .mp4 audio)
          m.kind = 'audio'; m.hasVideo = false; m.duration = p.duration; m.hasAudio = true;
        } else {
          Object.assign(m, { duration: p.duration, width: p.width, height: p.height });
          m.thumb = await videoThumb(p.el, p.duration);
          p.el.removeAttribute('src'); p.el.load();
        }
        if (!m.duration) throw new Error(`${name}: could not determine the duration.`);
      } else if (info.kind === 'audio') {
        const p = await probeAudio(url);
        m.duration = p.duration; m.hasAudio = true; m.hasVideo = false;
        if (!m.duration) throw new Error(`${name}: could not determine the duration.`);
      } else {
        const bmp = await createImageBitmap(file).catch(() => null);
        if (bmp) { m.width = bmp.width; m.height = bmp.height; bmp.close && bmp.close(); }
        else if (info.format === 'svg') { m.width = 1920; m.height = 1080; }
        else throw new Error(`${name}: the browser could not decode this image.`);
        m.duration = getSettings().stillDuration || 5;
        m.hasVideo = true;
        const c = document.createElement('canvas'); const b2 = await createImageBitmap(file).catch(() => null);
        if (b2) { c.width = 160; c.height = Math.max(1, Math.round(160 * b2.height / b2.width)); c.getContext('2d').drawImage(b2, 0, 0, c.width, c.height); m.thumb = c.toDataURL('image/jpeg', 0.7); }
      }
    } finally {
      URL.revokeObjectURL(url);
    }
    await this.setBlob(m, file);
    if (getSettings().storeMedia) {
      try { await putMedia(m.id, file); m.stored = true; }
      catch (e) { m.stored = false; }
    }
    return m;
  }

  /** Waveform + audio detection (runs after import, in the background). */
  async analyse(m) {
    if (m.kind === 'image') return;
    const r = this.rt.get(m.id); if (!r) return;
    if (r.blob.size > DECODE_LIMIT) { if (m.kind === 'video') m.hasAudio = true; m.peaksNote = 'File too large for waveform preview'; return; }
    try {
      const buf = await this.audioBuffer(m.id);
      const res = await peaksFrom(buf, 100);
      m.peaksPerSec = 100;
      m.hasAudio = res.max > 0.0005 || m.kind === 'audio';
      const k = res.max > 0 ? 1 / res.max : 1;
      m.peaks = Array.from(res.peaks, (v) => Math.round(Math.min(1, v * k) * 100) / 100);
    } catch (e) {
      if (m.kind === 'video') m.hasAudio = false; // no decodable audio track
      else m.peaksNote = 'Waveform unavailable (' + (e.message || 'decode failed') + ')';
    }
    this.onChange(m);
  }

  audioBuffer(id) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    const r = this.rt.get(id);
    if (!r) return Promise.reject(new Error('Media is offline.'));
    const ctx = getAudioContext();
    if (!ctx) return Promise.reject(new Error('Web Audio is not available.'));
    const p = r.blob.arrayBuffer().then((ab) => new Promise((res, rej) => {
      const done = ctx.decodeAudioData(ab, res, (e) => rej(e || new Error('No decodable audio')));
      if (done && done.catch) done.catch(rej);
    }));
    this.buffers.set(id, p);
    p.catch(() => this.buffers.delete(id));
    return p;
  }

  /** Restore runtime blobs for stored media when a project opens. */
  async attachAll(project) {
    const missing = [];
    for (const m of project.media) {
      if (this.rt.has(m.id)) continue;
      if (m.stored) {
        const blob = await getMedia(m.id).catch(() => null);
        if (blob) { await this.setBlob(m, blob); m.offline = false; continue; }
      }
      m.offline = true;
      missing.push(m);
    }
    return missing;
  }

  async relink(m, file) {
    const info = await detectFile(file);
    const want = m.kind === 'image' ? 'image' : m.kind;
    if (info.kind !== want && !(want === 'audio' && info.kind === 'video') && !(want === 'video' && info.kind === 'video')) {
      throw new Error(`“${sanitizeFilename(file.name)}” is ${info.label}, but “${m.name}” is ${m.kind}.`);
    }
    const url = URL.createObjectURL(file);
    let dur = m.duration, w = m.width, hh = m.height, thumb = m.thumb;
    try {
      if (info.kind === 'video') { const p = await probeVideo(url); dur = p.duration; w = p.width; hh = p.height; thumb = (await videoThumb(p.el, p.duration)) || thumb; p.el.removeAttribute('src'); p.el.load(); }
      else if (info.kind === 'audio') { dur = (await probeAudio(url)).duration; }
      else { const b = await createImageBitmap(file); w = b.width; hh = b.height; dur = m.duration || getSettings().stillDuration; }
    } finally { URL.revokeObjectURL(url); }
    const warnings = [];
    if (m.duration && dur + 0.05 < m.duration && m.kind !== 'image') warnings.push(`The new file is shorter (${dur.toFixed(2)} s) than the original (${m.duration.toFixed(2)} s); clips past the end will show as missing frames.`);
    if (sanitizeFilename(file.name).toLowerCase() !== m.name.toLowerCase()) warnings.push(`File name differs: “${sanitizeFilename(file.name)}”.`);
    Object.assign(m, { duration: m.duration || dur, width: w, height: hh, thumb, offline: false, size: file.size, mime: file.type || m.mime });
    m.relinkedDuration = dur;
    await this.setBlob(m, file);
    if (getSettings().storeMedia) { try { await putMedia(m.id, file); m.stored = true; } catch (e) { m.stored = false; } }
    this.analyse(m);
    return warnings;
  }

  release(ids) {
    for (const [id, r] of this.rt) {
      if (ids && !ids.includes(id)) continue;
      if (r.url) URL.revokeObjectURL(r.url);
      if (r.bitmap && r.bitmap.close) r.bitmap.close();
      this.rt.delete(id);
      this.buffers.delete(id);
    }
  }
}
