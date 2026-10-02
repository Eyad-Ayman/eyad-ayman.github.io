// EYAD VIDEO — project model, clip helpers, validation.
import { uid } from '../core/dom.js';
import { getSettings } from '../core/settings.js';
import { num, str, bool, oneOf, color } from '../core/eyad.js';
import { sanitizeKeys } from './anim.js';
import { sanitizeGen } from './gen.js';
import { TRANSITIONS } from './effects.js';

export const TICK = 1e-6;

export function createProject({ name = 'Untitled sequence', width, height, fps } = {}) {
  const s = getSettings();
  const seq = createSequence({ name: 'Sequence 01', width: width || s.videoWidth, height: height || s.videoHeight, fps: fps || s.videoFps });
  return {
    id: uid('v'),
    name,
    created: Date.now(),
    media: [],
    sequences: [seq],
    activeSeq: seq.id,
    meta: { source: 'new' },
  };
}

export function createSequence({ name = 'Sequence', width = 1920, height = 1080, fps = 30, videoTracks = 3, audioTracks = 3 } = {}) {
  const tracks = [];
  for (let i = 1; i <= videoTracks; i++) tracks.push(makeTrack('video', 'V' + i));
  for (let i = 1; i <= audioTracks; i++) tracks.push(makeTrack('audio', 'A' + i));
  return { id: uid('s'), name, width, height, fps, background: '#000000', tracks, clips: [], markers: [], inPoint: null, outPoint: null };
}

export function makeTrack(kind, name) {
  return { id: uid('t'), kind, name, mute: false, solo: false, lock: false, hidden: false, volume: 0 };
}

export function makeClip(props) {
  return {
    id: uid('c'),
    trackId: null, mediaId: null, name: 'Clip',
    start: 0, in: 0, out: 1, speed: 1, linkId: null, enabled: true,
    transform: { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 },
    crop: { l: 0, t: 0, r: 0, b: 0 },
    fadeIn: 0, fadeOut: 0,
    volume: 0, muted: false,
    effects: [],
    ...props,
  };
}

export const clipDur = (c) => Math.max(TICK, (c.out - c.in) / (c.speed || 1));
export const clipEnd = (c) => c.start + clipDur(c);
export const srcTime = (c, t) => c.in + (t - c.start) * (c.speed || 1);

export function seqDuration(seq) {
  let d = 0;
  for (const c of seq.clips) d = Math.max(d, clipEnd(c));
  return d;
}

export function activeSeq(project) { return project.sequences.find((s) => s.id === project.activeSeq) || project.sequences[0]; }
export function trackById(seq, id) { return seq.tracks.find((t) => t.id === id); }
export function mediaById(project, id) { return project.media.find((m) => m.id === id); }
export function clipsOnTrack(seq, trackId) { return seq.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start); }
export function linked(seq, clip) { return clip.linkId ? seq.clips.filter((c) => c.linkId === clip.linkId && c.id !== clip.id) : []; }
export function videoTracks(seq) { return seq.tracks.filter((t) => t.kind === 'video'); }
export function audioTracks(seq) { return seq.tracks.filter((t) => t.kind === 'audio'); }

export const dbToGain = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));

/**
 * Overwrite edit: after clips in `movedIds` have been placed, trim/split/remove
 * other clips on the same tracks that they now overlap.
 */
export function resolveOverlaps(seq, movedIds) {
  const moved = seq.clips.filter((c) => movedIds.includes(c.id));
  const add = [];
  for (const m of moved) {
    const ms = m.start, me = clipEnd(m);
    for (const c of seq.clips) {
      if (c === m || movedIds.includes(c.id) || c.trackId !== m.trackId) continue;
      const cs = c.start, ce = clipEnd(c);
      if (ce <= ms + TICK || cs >= me - TICK) continue;
      if (cs >= ms && ce <= me) { c._remove = true; continue; }
      if (cs < ms && ce > me) {
        // split c around m
        const right = { ...structuredClone(c), id: uid('c'), linkId: c.linkId ? c.linkId + ':r' : null };
        right.in = srcTime(c, me); right.start = me;
        c.out = srcTime(c, ms);
        add.push(right);
        continue;
      }
      if (cs < ms) c.out = srcTime(c, ms); // tail overlapped
      else { const newIn = srcTime(c, me); c.in = newIn; c.start = me; } // head overlapped
    }
  }
  seq.clips = seq.clips.filter((c) => !c._remove).concat(add);
}

export function snapPoints(seq, excludeIds, playhead) {
  const pts = [0, playhead];
  for (const c of seq.clips) { if (excludeIds.includes(c.id)) continue; pts.push(c.start, clipEnd(c)); }
  for (const mk of seq.markers) pts.push(mk.time);
  if (seq.inPoint != null) pts.push(seq.inPoint);
  if (seq.outPoint != null) pts.push(seq.outPoint);
  return pts;
}

// ---------------------------------------------------------------- serialization

export function serializeProject(p) {
  return {
    id: p.id, name: p.name, created: p.created, activeSeq: p.activeSeq, meta: p.meta,
    media: p.media.map((m) => ({ ...m, url: undefined })),
    sequences: p.sequences,
  };
}

export function deserializeProject(o) {
  if (!o || typeof o !== 'object') throw new Error('Project data is empty.');
  const p = {
    id: str(o.id, uid('v'), 64), name: str(o.name, 'Untitled sequence', 200), created: num(o.created, Date.now()),
    media: [], sequences: [], activeSeq: str(o.activeSeq, '', 64), meta: o.meta && typeof o.meta === 'object' ? { source: str(o.meta.source, 'eyad', 20), prproj: o.meta.prproj || undefined } : { source: 'eyad' },
  };
  const mediaIds = new Set();
  for (const m of Array.isArray(o.media) ? o.media.slice(0, 5000) : []) {
    if (!m || typeof m !== 'object') continue;
    const mm = {
      id: str(m.id, uid('m'), 64), name: str(m.name, 'media', 300), kind: oneOf(m.kind, ['video', 'audio', 'image'], 'video'), mime: str(m.mime, '', 100),
      size: num(m.size, 0, 0), duration: num(m.duration, 0, 0, 1e7), width: num(m.width, 0, 0, 1e5), height: num(m.height, 0, 0, 1e5),
      hasAudio: bool(m.hasAudio, false), hasVideo: bool(m.hasVideo, true), stored: bool(m.stored, false), originalPath: str(m.originalPath, '', 2000),
      offline: bool(m.offline, false), thumb: typeof m.thumb === 'string' && m.thumb.length < 400000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.thumb) ? m.thumb : null,
      peaks: Array.isArray(m.peaks) ? m.peaks.slice(0, 2e6).map((v) => num(v, 0, 0, 1)) : null, peaksPerSec: num(m.peaksPerSec, 100, 1, 1000),
      fps: num(m.fps, 0, 0, 1000),
      linkedLocal: m.linkedLocal ? true : undefined, service: m.service ? str(m.service, '', 40) : undefined,
      link: typeof m.link === 'string' && /^https:\/\/[^\s"'<>]{4,2000}$/.test(m.link) ? m.link : undefined,
    };
    mediaIds.add(mm.id);
    p.media.push(mm);
  }
  for (const s of Array.isArray(o.sequences) ? o.sequences.slice(0, 100) : []) {
    if (!s || typeof s !== 'object') continue;
    const seq = {
      id: str(s.id, uid('s'), 64), name: str(s.name, 'Sequence', 200), width: Math.round(num(s.width, 1920, 16, 8192)), height: Math.round(num(s.height, 1080, 16, 8192)),
      fps: num(s.fps, 30, 1, 240), background: color(s.background, '#000000'), tracks: [], clips: [], markers: [],
      inPoint: s.inPoint == null ? null : num(s.inPoint, 0, 0), outPoint: s.outPoint == null ? null : num(s.outPoint, 0, 0),
    };
    const tids = new Set();
    for (const t of Array.isArray(s.tracks) ? s.tracks.slice(0, 200) : []) {
      if (!t) continue;
      const tr = { id: str(t.id, uid('t'), 64), kind: oneOf(t.kind, ['video', 'audio'], 'video'), name: str(t.name, 'Track', 60), mute: bool(t.mute), solo: bool(t.solo), lock: bool(t.lock), hidden: bool(t.hidden), volume: num(t.volume, 0, -60, 12) };
      tids.add(tr.id); seq.tracks.push(tr);
    }
    if (!seq.tracks.some((t) => t.kind === 'video')) seq.tracks.unshift(makeTrack('video', 'V1'));
    if (!seq.tracks.some((t) => t.kind === 'audio')) seq.tracks.push(makeTrack('audio', 'A1'));
    for (const c of Array.isArray(s.clips) ? s.clips.slice(0, 20000) : []) {
      if (!c || !tids.has(c.trackId)) continue;
      const t = c.transform || {}, cr = c.crop || {};
      const cl = makeClip({
        id: str(c.id, uid('c'), 64), trackId: c.trackId, mediaId: mediaIds.has(c.mediaId) ? c.mediaId : null, name: str(c.name, 'Clip', 300),
        start: num(c.start, 0, 0), in: num(c.in, 0, 0), out: num(c.out, 1, 0), speed: num(c.speed, 1, 0.05, 16), linkId: c.linkId ? str(c.linkId, null, 80) : null, enabled: bool(c.enabled, true),
        transform: { x: num(t.x), y: num(t.y), scale: num(t.scale, 100, 0, 2000), rotation: num(t.rotation, 0, -3600, 3600), opacity: num(t.opacity, 100, 0, 100), ax: num(t.ax, 0, -8000, 8000), ay: num(t.ay, 0, -8000, 8000) },
        crop: { l: num(cr.l, 0, 0, 100), t: num(cr.t, 0, 0, 100), r: num(cr.r, 0, 0, 100), b: num(cr.b, 0, 0, 100) },
        fadeIn: num(c.fadeIn, 0, 0, 3600), fadeOut: num(c.fadeOut, 0, 0, 3600), volume: num(c.volume, 0, -60, 24), muted: bool(c.muted),
        effects: Array.isArray(c.effects) ? c.effects.slice(0, 50).filter((e) => e && typeof e.type === 'string').map((e) => ({ id: str(e.id, uid('e'), 64), type: str(e.type, '', 40), enabled: bool(e.enabled, true), params: sanitizeParams(e.params), ...(typeof e.look === 'string' && /^[a-zA-Z0-9]{1,40}$/.test(e.look) ? { look: e.look } : {}) })) : [],
        offline: c.offline ? true : undefined, missing: c.missing ? str(c.missing, '', 300) : undefined,
        keys: sanitizeKeys(c.keys), gen: sanitizeGen(c.gen),
        transIn: sanTrans(c.transIn), transOut: sanTrans(c.transOut),
        audioFx: sanAudio(c.audioFx),
        anim: c.anim && typeof c.anim === 'object' ? { blur: num(c.anim.blur, 0, 0, 100) } : undefined,
      });
      if (cl.out <= cl.in) cl.out = cl.in + 0.1;
      seq.clips.push(cl);
    }
    for (const mk of Array.isArray(s.markers) ? s.markers.slice(0, 2000) : []) if (mk) seq.markers.push({ id: str(mk.id, uid('k'), 64), time: num(mk.time, 0, 0), name: str(mk.name, 'Marker', 200), color: color(mk.color, '#e2a93b') });
    p.sequences.push(seq);
  }
  if (!p.sequences.length) p.sequences.push(createSequence({}));
  if (!p.sequences.some((s) => s.id === p.activeSeq)) p.activeSeq = p.sequences[0].id;
  return p;
}

function sanitizeParams(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o).slice(0, 20)) if (/^[a-z][a-zA-Z0-9]{0,30}$/.test(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

function sanTrans(t) {
  if (!t || typeof t !== 'object' || !(t.type in TRANSITIONS)) return undefined;
  return { type: t.type, dur: num(t.dur, 0.5, 0.04, 30) };
}
function sanAudio(a) {
  if (!a || typeof a !== 'object') return undefined;
  return { low: num(a.low, 0, -24, 24), mid: num(a.mid, 0, -24, 24), high: num(a.high, 0, -24, 24), comp: bool(a.comp), threshold: num(a.threshold, -24, -60, 0), ratio: num(a.ratio, 4, 1, 20), pan: num(a.pan, 0, -100, 100) };
}
