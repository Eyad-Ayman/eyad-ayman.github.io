// EYAD VIDEO — timeline edit operations. Every edit goes through edit(),
// which records a before/after snapshot of the sequence (small JSON — no
// media data) as one undoable action.
import { uid, timecode } from '../core/dom.js';
import { toast, formDialog, confirmDialog } from '../core/ui.js';
import { makeClip, makeTrack, clipEnd, clipDur, srcTime, trackById, mediaById, linked, resolveOverlaps, seqDuration, TICK } from './model.js';
import { EFFECTS, defaultParams } from './effects.js';
import { getSettings } from '../core/settings.js';

export function edit(app, label, fn, { coalesce } = {}) {
  const seq = app.seq; if (!seq) return;
  const before = structuredClone(seq);
  const r = fn(seq);
  if (r === false) return;
  const after = structuredClone(seq);
  app.history.push({
    label, coalesce,
    undo: () => app.replaceSeq(structuredClone(before)),
    redo: () => app.replaceSeq(structuredClone(after)),
    merge(next) { if (!next._after) return false; this.redo = () => app.replaceSeq(structuredClone(next._after)); return true; },
    _after: after,
  });
  app.changed();
}

export const resolve = resolveOverlaps;

function trackFor(seq, kind, preferredId, at = 0, dur = 0, ripple = false) {
  const pref = preferredId && trackById(seq, preferredId);
  if (pref && pref.kind === kind && !pref.lock) return pref;
  const open = seq.tracks.filter((t) => t.kind === kind && !t.lock);
  if (ripple) return open[0] || null; // insert edits push clips on the target track instead of avoiding them
  // prefer the first track that is free for the whole range, so adding media never cuts existing clips
  const free = open.find((t) => !seq.clips.some((c) => c.trackId === t.id && c.start < at + dur - TICK && clipEnd(c) > at + TICK));
  return free || open[0] || null;
}

/** Place media on the timeline (overwrite edit). Video with audio gets a linked audio clip. */
export async function placeMedia(app, mediaId, { time = null, trackId = null, srcIn = 0, srcOut = null, mode = 'overwrite' } = {}) {
  const p = app.project, m = mediaById(p, mediaId);
  if (!m) return;
  if (m.analysing) { const t = setTimeout(() => toast('Analysing audio…', { timeout: 1500 }), 300); await m.analysing; clearTimeout(t); }
  const s = app.seq;
  const at = time == null ? app.engine.time : Math.max(0, time);
  const dur = m.kind === 'image' ? (srcOut ?? getSettings().stillDuration) - srcIn : (srcOut ?? m.duration) - srcIn;
  if (!(dur > 0)) { toast('Nothing to place — the In/Out range is empty.', { type: 'warn' }); return; }
  const pref = trackId ? trackById(s, trackId) : null;
  const ins = mode === 'insert';
  const vTrack = m.kind !== 'audio' ? trackFor(s, 'video', pref && pref.kind === 'video' ? pref.id : null, at, dur, ins) : null;
  const aTrack = (m.kind === 'audio' || (m.kind === 'video' && m.hasAudio)) ? trackFor(s, 'audio', pref && pref.kind === 'audio' ? pref.id : null, at, dur, ins) : null;
  const wasEmpty = !s.clips.length;
  if (m.kind !== 'audio' && !vTrack) { toast('All video tracks are locked.', { type: 'warn' }); return; }
  if (m.kind === 'audio' && !aTrack) { toast('All audio tracks are locked.', { type: 'warn' }); return; }
  const linkId = vTrack && aTrack ? uid('L') : null;
  const ids = [];
  edit(app, mode === 'insert' ? 'Insert' : 'Overwrite', (seq) => {
    if (mode === 'insert') {
      // ripple: push everything at/after the insert point on the target tracks
      for (const c of [...seq.clips]) { // snapshot: splitting adds clips we must not shift twice
        if (![vTrack?.id, aTrack?.id].includes(c.trackId)) continue;
        if (c.start >= at - TICK) c.start += dur;
        else if (clipEnd(c) > at + TICK) splitInto(seq, c, at).start += dur;
      }
    }
    if (vTrack) { const c = makeClip({ trackId: vTrack.id, mediaId, name: m.name, start: at, in: srcIn, out: srcIn + dur, linkId }); seq.clips.push(c); ids.push(c.id); }
    if (aTrack) { const c = makeClip({ trackId: aTrack.id, mediaId, name: m.name, start: at, in: srcIn, out: srcIn + dur, linkId }); seq.clips.push(c); ids.push(c.id); }
    resolveOverlaps(seq, ids);
  });
  app.select(ids);
  if (wasEmpty) requestAnimationFrame(() => app.timeline.fit());
  return ids;
}

/** Split clip c at time t inside seq; returns the new right-hand clip. */
function splitInto(seq, c, t) {
  const right = structuredClone(c);
  right.id = uid('c');
  right.in = srcTime(c, t);
  right.start = t;
  right.fadeIn = 0;
  c.out = srcTime(c, t);
  c.fadeOut = 0;
  seq.clips.push(right);
  return right;
}

export function splitClips(app, ids, t, { withLinked = true } = {}) {
  const s = app.seq;
  let targets = s.clips.filter((c) => ids.includes(c.id));
  if (withLinked) for (const c of [...targets]) for (const l of linked(s, c)) if (!targets.includes(l)) targets.push(l);
  targets = targets.filter((c) => t > c.start + TICK && t < clipEnd(c) - TICK && !trackById(s, c.trackId).lock);
  if (!targets.length) { toast('The playhead is not inside the selected clip(s).', { timeout: 1800 }); return; }
  const newIds = [];
  edit(app, 'Razor', (seq) => {
    const linkMap = new Map();
    for (const tc of targets) {
      const c = seq.clips.find((x) => x.id === tc.id);
      const r = splitInto(seq, c, t);
      if (c.linkId) { if (!linkMap.has(c.linkId)) linkMap.set(c.linkId, uid('L')); r.linkId = linkMap.get(c.linkId); }
      newIds.push(r.id);
    }
  });
  app.select(newIds);
}

export function splitAtPlayhead(app) {
  const s = app.seq, t = app.engine.time;
  let ids = [...app.selection].filter((id) => { const c = s.clips.find((x) => x.id === id); return c && t > c.start && t < clipEnd(c); });
  if (!ids.length) ids = s.clips.filter((c) => t > c.start && t < clipEnd(c) && !trackById(s, c.trackId).lock).map((c) => c.id);
  if (!ids.length) { toast('No clip under the playhead.', { timeout: 1500 }); return; }
  splitClips(app, ids, t, { withLinked: true });
}

export function deleteSelected(app, { ripple = false } = {}) {
  const s = app.seq;
  const ids = [...app.selection].filter((id) => { const c = s.clips.find((x) => x.id === id); return c && !trackById(s, c.trackId).lock; });
  if (!ids.length) return;
  edit(app, ripple ? 'Ripple Delete' : 'Delete', (seq) => {
    const removed = seq.clips.filter((c) => ids.includes(c.id));
    seq.clips = seq.clips.filter((c) => !ids.includes(c.id));
    if (ripple) {
      // close the gap on each affected track
      const byTrack = new Map();
      for (const r of removed) { const a = byTrack.get(r.trackId) || []; a.push(r); byTrack.set(r.trackId, a); }
      for (const [trackId, rs] of byTrack) {
        rs.sort((a, b) => b.start - a.start);
        for (const r of rs) {
          const gap = clipDur(r);
          for (const c of seq.clips) if (c.trackId === trackId && c.start >= clipEnd(r) - TICK) c.start = Math.max(0, c.start - gap);
        }
      }
    }
  });
  app.select([]);
}

export function duplicateSelected(app) {
  const s = app.seq;
  const sel = s.clips.filter((c) => app.selection.has(c.id));
  if (!sel.length) return;
  const end = Math.max(...sel.map(clipEnd)), start = Math.min(...sel.map((c) => c.start));
  const newIds = [];
  edit(app, 'Duplicate Clip', (seq) => {
    const links = new Map();
    for (const c of sel) {
      const d = structuredClone(c); d.id = uid('c'); d.start = c.start + (end - start);
      if (c.linkId) { if (!links.has(c.linkId)) links.set(c.linkId, uid('L')); d.linkId = links.get(c.linkId); }
      seq.clips.push(d); newIds.push(d.id);
    }
    resolveOverlaps(seq, newIds);
  });
  app.select(newIds);
}

export function link(app) {
  const ids = [...app.selection]; if (ids.length < 2) { toast('Select a video and an audio clip to link.'); return; }
  const L = uid('L');
  edit(app, 'Link', (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) c.linkId = L; });
}
export function unlink(app) {
  const ids = [...app.selection];
  edit(app, 'Unlink', (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) c.linkId = null; });
}

export function updateClips(app, ids, props, label, opts) {
  edit(app, label, (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) Object.assign(c, typeof props === 'function' ? props(c) : props); }, opts);
}
export function updateClipDeep(app, id, path, value, label) {
  edit(app, label, (seq) => {
    const c = seq.clips.find((x) => x.id === id); if (!c) return false;
    const [a, b] = path.split('.');
    if (b) c[a] = { ...c[a], [b]: value }; else c[a] = value;
  }, { coalesce: id + ':' + path });
}

export function updateTrack(app, tr, props, label) { edit(app, label, (seq) => { const t = trackById(seq, tr.id); if (t) Object.assign(t, props); }); }

export function addTrack(app, kind) {
  edit(app, kind === 'video' ? 'Add Video Track' : 'Add Audio Track', (seq) => {
    const n = seq.tracks.filter((t) => t.kind === kind).length + 1;
    const t = makeTrack(kind, (kind === 'video' ? 'V' : 'A') + n);
    if (kind === 'video') { const lastV = seq.tracks.map((x) => x.kind).lastIndexOf('video'); seq.tracks.splice(lastV + 1, 0, t); }
    else seq.tracks.push(t);
  });
}
export async function deleteTrack(app, tr) {
  const s = app.seq;
  const n = s.clips.filter((c) => c.trackId === tr.id).length;
  if (s.tracks.filter((t) => t.kind === tr.kind).length <= 1) { toast('A sequence needs at least one track of each kind.'); return; }
  if (n && !(await confirmDialog('Delete track', `${tr.name} has ${n} clip(s). Delete the track and its clips?`, { ok: 'Delete', danger: true }))) return;
  edit(app, 'Delete Track', (seq) => { seq.tracks = seq.tracks.filter((t) => t.id !== tr.id); seq.clips = seq.clips.filter((c) => c.trackId !== tr.id); });
}

export function addMarker(app, name) {
  const t = app.engine.time;
  edit(app, 'Add Marker', (seq) => { seq.markers.push({ id: uid('k'), time: t, name: name || 'Marker ' + (seq.markers.length + 1), color: '#e2a93b' }); });
  toast('Marker added at ' + timecode(t, app.seq.fps), { timeout: 1200 });
}
export function jumpMarker(app, dir) {
  const t = app.engine.time, ms = app.seq.markers.map((m) => m.time).sort((a, b) => a - b);
  const target = dir > 0 ? ms.find((x) => x > t + 1e-3) : [...ms].reverse().find((x) => x < t - 1e-3);
  if (target != null) app.engine.seek(target);
}
export function jumpEdit(app, dir) {
  const t = app.engine.time, pts = [0, ...app.seq.clips.flatMap((c) => [c.start, clipEnd(c)])].sort((a, b) => a - b);
  const target = dir > 0 ? pts.find((x) => x > t + 1e-3) : [...pts].reverse().find((x) => x < t - 1e-3);
  if (target != null) app.engine.seek(target);
}

export function setIn(app) { const t = app.engine.time; edit(app, 'Mark In', (seq) => { seq.inPoint = t; if (seq.outPoint != null && seq.outPoint <= t) seq.outPoint = null; }); }
export function setOut(app) { const t = app.engine.time; edit(app, 'Mark Out', (seq) => { seq.outPoint = t; if (seq.inPoint != null && seq.inPoint >= t) seq.inPoint = null; }); }
export function clearInOut(app) { edit(app, 'Clear In/Out', (seq) => { seq.inPoint = null; seq.outPoint = null; }); }

export async function speedDialog(app) {
  const s = app.seq;
  const sel = s.clips.filter((c) => app.selection.has(c.id));
  if (!sel.length) { toast('Select a clip first.'); return; }
  const c0 = sel[0];
  const v = await formDialog({
    title: 'Clip speed / duration', ok: 'Apply',
    fields: [
      { key: 'speed', label: 'Speed', type: 'number', value: Math.round(c0.speed * 100), min: 5, max: 1600, suffix: '%' },
      { key: 'ripple', label: 'Ripple following clips', type: 'checkbox', value: false },
      { type: 'note', label: 'Audio pitch follows the browser’s playback-rate behaviour (pitch-corrected in most browsers).' },
    ],
  });
  if (!v) return;
  const sp = Math.max(0.05, Math.min(16, v.speed / 100));
  edit(app, 'Speed', (seq) => {
    for (const c of seq.clips) {
      if (!app.selection.has(c.id)) continue;
      const oldEnd = clipEnd(c);
      c.speed = sp;
      const delta = clipEnd(c) - oldEnd;
      if (v.ripple) for (const o of seq.clips) if (o.trackId === c.trackId && o !== c && o.start >= oldEnd - TICK) o.start += delta;
    }
    if (!v.ripple) resolveOverlaps(seq, [...app.selection]);
  });
}

export function addEffect(app, type) {
  const s = app.seq;
  const ids = s.clips.filter((c) => app.selection.has(c.id) && trackById(s, c.trackId).kind === 'video').map((c) => c.id);
  if (!ids.length) { toast('Select a video clip to apply ' + EFFECTS[type].label + '.'); return; }
  edit(app, 'Add ' + EFFECTS[type].label, (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) c.effects = [...(c.effects || []), { id: uid('e'), type, enabled: true, params: defaultParams(type) }]; });
  app.showProperties();
}
export function removeEffect(app, clipId, effId) { edit(app, 'Remove Effect', (seq) => { const c = seq.clips.find((x) => x.id === clipId); if (c) c.effects = c.effects.filter((e) => e.id !== effId); }); }
export function setEffect(app, clipId, effId, patch, label = 'Effect') {
  edit(app, label, (seq) => { const c = seq.clips.find((x) => x.id === clipId); if (!c) return false; c.effects = c.effects.map((e) => (e.id === effId ? { ...e, ...patch, params: { ...e.params, ...(patch.params || {}) } } : e)); }, { coalesce: clipId + ':' + effId });
}

export async function sequenceSettings(app) {
  const s = app.seq;
  const v = await formDialog({
    title: 'Sequence settings', ok: 'Apply',
    fields: [
      { key: 'name', label: 'Name', type: 'text', value: s.name, maxLength: 120 },
      { key: 'preset', label: 'Frame size', type: 'select', value: `${s.width}x${s.height}`, options: ['3840x2160', '2560x1440', '1920x1080', '1280x720', '1080x1920', '1080x1350', '1080x1080', '720x1280', `${s.width}x${s.height}`].filter((x, i, a) => a.indexOf(x) === i).map((x) => ({ value: x, label: x.replace('x', ' × ') })) },
      { key: 'fps', label: 'Frame rate', type: 'select', value: String(s.fps), options: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', String(s.fps)].filter((x, i, a) => a.indexOf(x) === i).map((x) => ({ value: x, label: x + ' fps' })) },
      { key: 'background', label: 'Background', type: 'color', value: s.background },
    ],
  });
  if (!v) return;
  const [w, hh] = v.preset.split('x').map(Number);
  edit(app, 'Sequence Settings', (seq) => { seq.name = v.name || seq.name; seq.width = w; seq.height = hh; seq.fps = Number(v.fps); seq.background = v.background; });
  app.layoutMonitor();
}

export { seqDuration };
