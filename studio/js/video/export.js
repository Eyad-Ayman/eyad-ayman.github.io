// EYAD VIDEO — export: real-time video render (MediaRecorder), offline WAV
// mixdown (OfflineAudioContext), and single-frame PNG.
import { toast, formDialog, progressDialog, alertDialog } from '../core/ui.js';
import { downloadBlob, sanitizeFilename } from '../core/files.js';
import { clipEnd, clipDur, seqDuration, trackById, mediaById, dbToGain } from './model.js';

export function recorderMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  // Prefer H.264 MP4 (widest compatibility); otherwise WebM. Generic "video/mp4"
  // last: Chrome fills it with VP9, while Safari uses H.264.
  const cands = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return cands.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || null;
}

export async function exportVideoDialog(app) {
  const s = app.seq;
  const dur = seqDuration(s);
  if (!dur) { toast('The sequence is empty.'); return; }
  const mime = recorderMime();
  const canvasCapture = typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  if (!mime || !canvasCapture) {
    alertDialog('Video export unavailable', 'This browser does not support recording a canvas (MediaRecorder / captureStream). You can still export frames and a WAV mixdown.');
    return;
  }
  const offline = s.clips.filter((c) => { if (c.gen) return false; const m = mediaById(app.project, c.mediaId); return !m || m.offline; }).length;
  const hasIO = s.inPoint != null || s.outPoint != null;
  const v = await formDialog({
    title: 'Export video', ok: 'Render',
    intro: `Renders in real time (${dur.toFixed(1)} s for the whole sequence). Keep this tab visible while it records. Format: ${mime.split(';')[0]} (chosen by your browser).${offline ? ` ${offline} offline clip(s) will render as MEDIA OFFLINE.` : ''}`,
    fields: [
      { key: 'name', label: 'File name', type: 'text', value: app.project.name },
      { key: 'range', label: 'Range', type: 'select', value: hasIO ? 'io' : 'all', options: [{ value: 'all', label: 'Entire sequence' }, ...(hasIO ? [{ value: 'io', label: 'In to Out' }] : [])] },
      { key: 'size', label: 'Resolution', type: 'select', value: 'seq', options: [{ value: 'seq', label: `Sequence (${s.width} × ${s.height})` }, { value: '1080', label: '1080p' }, { value: '720', label: '720p' }, { value: '480', label: '480p' }] },
      { key: 'mbps', label: 'Bitrate', type: 'select', value: '8', options: [['4', '4 Mbps'], ['8', '8 Mbps'], ['16', '16 Mbps'], ['25', '25 Mbps']].map(([value, label]) => ({ value, label })) },
    ],
  });
  if (!v) return;
  let W = s.width, H = s.height;
  if (v.size !== 'seq') { const target = Number(v.size); const k = target / Math.min(s.width, s.height); W = Math.round(s.width * k / 2) * 2; H = Math.round(s.height * k / 2) * 2; }
  const from = v.range === 'io' ? (s.inPoint ?? 0) : 0;
  const to = v.range === 'io' ? Math.min(dur, s.outPoint ?? dur) : dur;
  await renderVideo(app, { name: v.name, W, H, from, to, bitrate: Number(v.mbps) * 1e6, mime });
}

async function renderVideo(app, { name, W, H, from, to, bitrate, mime }) {
  const eng = app.engine;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const fps = Math.min(60, Math.round(app.seq.fps));
  const vStream = canvas.captureStream(fps);
  const tracks = [...vStream.getVideoTracks()];
  const actx = eng.ensureAudio();
  let dest = null;
  if (actx) {
    if (actx.state === 'suspended') await actx.resume().catch(() => {});
    dest = actx.createMediaStreamDestination();
    eng.exportDest = dest;
    for (const r of eng.els.values()) if (r.gain) r.gain.connect(dest);
    tracks.push(...dest.stream.getAudioTracks());
  }
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const p = progressDialog('Rendering video');
  let cancelled = false;
  const wasLoop = eng.loop;
  const cleanup = () => {
    eng.exporting = null; eng.loop = wasLoop;
    if (dest) { for (const r of eng.els.values()) if (r.gain) try { r.gain.disconnect(dest); } catch (e) { /* ignore */ } eng.exportDest = null; }
    tracks.forEach((t) => t.stop());
  };
  await new Promise((resolve) => {
    p.onCancel(() => { cancelled = true; eng.pause(); try { rec.stop(); } catch (e) { /* ignore */ } });
    rec.onstop = resolve;
    eng.pause();
    eng.loop = false;
    eng.seek(from);
    eng.exporting = {
      canvas, to,
      progress: (t) => p.set((t - from) / Math.max(0.001, to - from), `Recording ${(t - from).toFixed(1)} / ${(to - from).toFixed(1)} s`),
      finish: () => { eng.pause(); setTimeout(() => { try { rec.stop(); } catch (e) { /* ignore */ } }, 120); },
    };
    // let elements seek to the first frame before recording
    setTimeout(() => { eng.render(); rec.start(250); eng.play(); }, 400);
  });
  cleanup();
  p.close();
  if (cancelled) { toast('Export cancelled.'); return; }
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  if (!blob.size) { toast('Export produced an empty file.', { type: 'error' }); return; }
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  downloadBlob(blob, sanitizeFilename(name || 'export') + '.' + ext);
  toast(`Exported ${W} × ${H} ${ext.toUpperCase()}`, { type: 'ok', detail: `${(blob.size / 1048576).toFixed(1)} MB` });
}

// ---------------------------------------------------------------- WAV mixdown

export async function exportWav(app) {
  const s = app.seq, eng = app.engine;
  const dur = seqDuration(s);
  if (!dur) { toast('The sequence is empty.'); return; }
  if (typeof OfflineAudioContext === 'undefined') { alertDialog('Audio export unavailable', 'This browser has no OfflineAudioContext.'); return; }
  const from = s.inPoint ?? 0, to = Math.min(dur, s.outPoint ?? dur);
  const rate = 48000;
  const len = Math.ceil((to - from) * rate);
  if (len > rate * 60 * 60 * 2) { toast('Mixdowns are limited to 2 hours.', { type: 'error' }); return; }
  const p = progressDialog('Mixing audio', { cancellable: false });
  p.set(null, 'Decoding audio…');
  try {
    const off = new OfflineAudioContext(2, Math.max(1, len), rate);
    const anySolo = s.tracks.some((t) => t.kind === 'audio' && t.solo);
    let used = 0, skipped = 0;
    for (const c of s.clips) {
      const tr = trackById(s, c.trackId);
      if (tr.kind !== 'audio' || tr.mute || c.muted || c.enabled === false || (anySolo && !tr.solo)) continue;
      const cs = c.start, ce = clipEnd(c);
      if (ce <= from || cs >= to) continue;
      const m = mediaById(app.project, c.mediaId);
      if (!m || m.offline) { skipped++; continue; }
      let buf;
      try { buf = await app.media.audioBuffer(m.id); } catch (e) { skipped++; continue; }
      const src = off.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = c.speed;
      const g = off.createGain();
      const base = dbToGain(c.volume) * dbToGain(tr.volume);
      const t0 = Math.max(0, cs - from);
      const skip = Math.max(0, from - cs);
      g.gain.setValueAtTime(base, 0);
      if (c.fadeIn > 0) { g.gain.setValueAtTime(cs >= from ? 0 : base * Math.min(1, skip / c.fadeIn), t0); g.gain.linearRampToValueAtTime(base, Math.max(t0, cs + c.fadeIn - from)); }
      if (c.fadeOut > 0) { g.gain.setValueAtTime(base, Math.max(t0, ce - c.fadeOut - from)); g.gain.linearRampToValueAtTime(0, ce - from); }
      src.connect(g).connect(off.destination);
      const offset = c.in + skip * c.speed;
      const playDur = (Math.min(ce, to) - Math.max(cs, from)) * c.speed;
      src.start(t0, offset, Math.max(0, playDur));
      used++;
    }
    p.set(null, 'Rendering mixdown…');
    const out = await off.startRendering();
    const wav = encodeWav(out);
    downloadBlob(wav, sanitizeFilename(app.project.name) + '.wav');
    toast(`Exported WAV mixdown (${used} clip${used === 1 ? '' : 's'})`, { type: 'ok', detail: skipped ? `${skipped} offline or undecodable clip(s) skipped` : '' });
  } catch (e) {
    toast('Audio export failed', { type: 'error', detail: e.message });
  } finally { p.close(); }
  void eng; void clipDur;
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

export async function exportFrame(app) {
  const s = app.seq;
  const c = document.createElement('canvas');
  c.width = s.width; c.height = s.height;
  app.engine.drawFrame(c.getContext('2d'), c.width, c.height, app.engine.time);
  c.toBlob((b) => { if (b) { downloadBlob(b, `${sanitizeFilename(app.project.name)}-frame-${Math.round(app.engine.time * s.fps)}.png`); toast('Frame exported', { type: 'ok', timeout: 1400 }); } }, 'image/png');
}

export { encodeWav };
