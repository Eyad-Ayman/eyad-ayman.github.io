// EYAD VIDEO — captions (SRT / WebVTT import & export) and scene-edit detection.
import { uid } from '../core/dom.js';
import { toast, progressDialog, formDialog } from '../core/ui.js';
import { pickFiles, sanitizeFilename, downloadBlob } from '../core/files.js';
import { makeClip, makeTrack, clipEnd, clipDur, srcTime, trackById, mediaById, TICK } from './model.js';
import { GEN_TEMPLATES, TEXT_STYLES, textStylePatch } from './gen.js';
import { edit } from './ops.js';

const TC = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
function parseTime(s) {
  const m = String(s).trim().match(TC); if (!m) return NaN;
  return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4].padEnd(3, '0'), 10) / 1000;
}
/** Parse SRT or WebVTT text into cues [{start, end, text}]. Markup is stripped (plain text only). */
export function parseCaptions(text) {
  const cues = [];
  const blocks = String(text).replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  for (const b of blocks.slice(0, 20000)) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const start = parseTime(a), end = parseTime(z);
    if (!(end > start)) continue;
    const body = lines.slice(i + 1).join('\n').replace(/<[^>]{0,200}>/g, '').replace(/\{\\[^}]{0,200}\}/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
    if (body) cues.push({ start, end, text: body.slice(0, 1000) });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Caption looks offered on import ('classic' = the plain boxed caption). */
export const CAPTION_STYLES = [['classic', 'Classic box'], ...Object.entries(TEXT_STYLES).filter(([, st]) => st.cap).map(([k, st]) => [k, st.label])];
const CAP_POS = { bottom: 0.37, middle: 0, top: -0.37 };

/**
 * Import an SRT / WebVTT file as caption clips on a new “Captions” track.
 * opts.style / opts.position override the default look.
 */
export async function importCaptions(app, file, opts = {}) {
  if (!file) { const f = await pickFiles({ accept: '.srt,.vtt,text/vtt,application/x-subrip,text/plain', multiple: false }); file = f[0]; }
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Caption file is too large (max 5 MB).', { type: 'error' }); return; }
  const cues = parseCaptions(await file.text());
  if (!cues.length) { toast(`No captions found in ${sanitizeFilename(file.name)} (expected SRT or WebVTT).`, { type: 'error' }); return; }
  if (!app.project) await app.ensureProject();
  const ids = addCaptionCues(app, cues, { label: 'Import Captions', style: opts.style, position: opts.position });
  toast(`Imported ${cues.length} caption${cues.length === 1 ? '' : 's'} on a new “Captions” track`, { type: 'ok', detail: 'Pick a look for all of them under “Style for all captions”.', timeout: 6000, action: { label: 'Caption style', fn: () => app.showProperties() } });
  return ids;
}

const RTL_TEXT = /[\u0591-\u07FF\uFB50-\uFDFF\uFE70-\uFEFC]/;
/**
 * Put cues [{ start, end, text }] on a new “Captions” track as caption clips (one undo step). → clip ids.
 * Used by SRT / VTT import and by auto captions. opts: { label, style, position }.
 */
export function addCaptionCues(app, cues, opts = {}) {
  // default look: readable boxed subtitles (the Arabic variant when the text is Arabic); the style
  // picker for all captions is in Properties and in Effects ▸ Titles & graphics — no dialog in the way
  const rtl = cues.some((q) => RTL_TEXT.test(q.text));
  const style = opts.style || (rtl ? 'arabicCaption' : 'subtitleBg'), position = opts.position || 'bottom';
  const tpl = GEN_TEMPLATES.caption;
  const look = style && style !== 'classic' && TEXT_STYLES[style] ? textStylePatch(style) : { wrap: 86 };
  const track = makeTrack('video', 'Captions');
  const ids = [];
  edit(app, opts.label || 'Captions', (seq) => {
    const lastV = seq.tracks.map((x) => x.kind).lastIndexOf('video');
    seq.tracks.splice(lastV + 1, 0, track);
    for (const q of cues) {
      const c = makeClip({ trackId: track.id, name: q.text.split('\n')[0].slice(0, 40), start: q.start, in: 0, out: q.end - q.start, gen: { ...structuredClone(tpl.gen), ...look, type: 'caption', text: q.text } });
      // mixed-language captions: a line without Arabic / Hebrew letters stays left-to-right inside an RTL look
      if (rtl && look.dir === 'rtl' && !RTL_TEXT.test(q.text)) c.gen.dir = 'ltr';
      c.transform.y = Math.round(seq.height * (CAP_POS[position] ?? CAP_POS.bottom));
      seq.clips.push(c); ids.push(c.id);
    }
  });
  if (ids.length) app.select([ids[0]]);
  return ids;
}

function fmt(t, vtt) {
  const ms = Math.round(t * 1000), hh = Math.floor(ms / 3600000), mm = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60, f = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}${vtt ? '.' : ','}${p(f, 3)}`;
}
export function exportCaptions(app, kind = 'srt') {
  const s = app.seq;
  const pick = (type) => s.clips.filter((c) => c.gen && c.gen.type === type && c.enabled !== false).sort((a, b) => a.start - b.start).map((c) => ({ start: c.start, end: clipEnd(c), text: c.gen.text }));
  let list = pick('caption'); if (!list.length) list = pick('text');
  if (!list.length) { toast('No caption or text clips in this sequence.'); return; }
  const vtt = kind === 'vtt';
  const out = (vtt ? 'WEBVTT\n\n' : '') + list.map((q, i) => `${vtt ? '' : (i + 1) + '\n'}${fmt(q.start, vtt)} --> ${fmt(q.end, vtt)}\n${q.text}\n`).join('\n');
  downloadBlob(new Blob([out], { type: vtt ? 'text/vtt' : 'application/x-subrip' }), sanitizeFilename(app.project.name) + (vtt ? '.vtt' : '.srt'));
  toast(`Exported ${list.length} caption${list.length === 1 ? '' : 's'}`, { type: 'ok' });
}

/** Scene Edit Detection: find hard cuts inside the selected video clip and razor there. */
export async function detectScenes(app) {
  const s = app.seq;
  const c = s.clips.find((x) => app.selection.has(x.id) && trackById(s, x.trackId).kind === 'video' && !x.gen);
  if (!c) { toast('Select a video clip first.'); return; }
  const m = mediaById(app.project, c.mediaId);
  if (!m || m.kind !== 'video' || !app.media.online(m.id)) { toast('The clip’s media must be a video and online.'); return; }
  const v0 = await formDialog({ title: 'Scene Edit Detection', ok: 'Detect', fields: [
    { key: 'sens', label: 'Sensitivity', type: 'range', min: 1, max: 100, value: 55 },
    { key: 'step', label: 'Scan every', type: 'select', value: '0.2', options: [{ value: '0.1', label: '0.1 s (precise, slower)' }, { value: '0.2', label: '0.2 s' }, { value: '0.5', label: '0.5 s (fast)' }] },
    { type: 'note', label: 'Analyses frame colour changes on this device and cuts the clip at every detected scene change (one undo step).' },
  ] });
  if (!v0) return;
  const step = Number(v0.step), thr = 0.9 - v0.sens / 100 * 0.75;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = app.media.urlFor(m.id); v.crossOrigin = 'anonymous';
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 36;
  const g = cv.getContext('2d', { willReadFrequently: true });
  let cancelled = false;
  const p = progressDialog('Detecting scene edits'); p.onCancel(() => { cancelled = true; });
  const seek = (t) => new Promise((r) => { const done = () => { v.removeEventListener('seeked', done); r(); }; v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 2500); });
  try { await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('Could not read the video.')); }); }
  catch (e) { p.close(); toast(e.message, { type: 'error' }); return; }
  const hist = () => { g.drawImage(v, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; const hgm = new Float32Array(48); for (let i = 0; i < d.length; i += 4) { hgm[d[i] >> 4]++; hgm[16 + (d[i + 1] >> 4)]++; hgm[32 + (d[i + 2] >> 4)]++; } const n = 64 * 36 * 3; for (let i = 0; i < 48; i++) hgm[i] /= n; return hgm; };
  const cuts = [];
  let prev = null;
  const dur = clipDur(c);
  for (let lt = 0; lt <= dur && !cancelled; lt += step) {
    const st = srcTime(c, c.start + lt);
    await seek(st);
    let cur; try { cur = hist(); } catch (e) { p.close(); toast('This video can’t be analysed (cross-origin).', { type: 'error' }); return; }
    if (prev) { let d = 0; for (let i = 0; i < 48; i++) d += Math.abs(cur[i] - prev[i]); d /= 2; if (d > thr && lt > step * 1.5 && dur - lt > step) cuts.push(c.start + lt); }
    prev = cur;
    p.set(lt / dur, `${cuts.length} scene change${cuts.length === 1 ? '' : 's'} found`);
  }
  p.close(); v.removeAttribute('src'); v.load();
  if (cancelled) return;
  if (!cuts.length) { toast('No scene changes detected. Try a higher sensitivity.'); return; }
  // razor at each cut (single undo step)
  const ids = [c.id, ...(c.linkId ? s.clips.filter((x) => x.linkId === c.linkId && x.id !== c.id).map((x) => x.id) : [])];
  edit(app, 'Scene Edit Detection', (seq) => {
    for (const t of cuts) {
      for (const cl of seq.clips.filter((x) => ids.includes(x.id) || (x._from && ids.includes(x._from)))) {
        if (!(t > cl.start + TICK && t < clipEnd(cl) - TICK)) continue;
        const right = structuredClone(cl); right.id = uid('c'); right._from = cl._from || cl.id; right.in = srcTime(cl, t); right.start = t; right.fadeIn = 0; right.transIn = undefined; right.keys = undefined;
        cl.out = srcTime(cl, t); cl.fadeOut = 0; cl.transOut = undefined;
        seq.clips.push(right);
      }
    }
    const L = new Map();
    for (const cl of seq.clips) if (cl._from) { const k = Math.round(cl.start * 1000); if (!L.has(k)) L.set(k, uid('L')); if (cl.linkId) cl.linkId = L.get(k); delete cl._from; }
  });
  toast(`Cut at ${cuts.length} scene change${cuts.length === 1 ? '' : 's'}`, { type: 'ok' });
}
