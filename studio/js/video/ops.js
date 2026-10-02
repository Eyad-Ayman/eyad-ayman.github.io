// EYAD VIDEO — timeline edit operations. Every edit goes through edit(),
// which records a before/after snapshot of the sequence (small JSON — no
// media data) as one undoable action.
import { uid, timecode } from '../core/dom.js';
import { toast, formDialog, confirmDialog } from '../core/ui.js';
import { makeClip, makeTrack, clipEnd, clipDur, srcTime, trackById, mediaById, linked, resolveOverlaps, seqDuration, TICK } from './model.js';
import { EFFECTS, defaultParams, LOOK_PRESETS, MASK_MODES } from './effects.js';
import { getSettings } from '../core/settings.js';
import { TRANSITIONS } from './effects.js';
import { GEN_TEMPLATES, genLabel, TEXT_STYLES, textStylePatch } from './gen.js';
import { LOOKS } from '../core/film.js';
import { sanitizeFilename, baseName } from '../core/files.js';
import { PROPS, PRESETS, setKey, removeKeyAt, valueAt, hasKeys } from './anim.js';

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
  const cut = t - c.start;
  c.out = srcTime(c, t);
  c.fadeOut = 0;
  // transitions stay on the outer edges; keyframes follow the content
  right.transIn = undefined; c.transOut = undefined;
  if (c.keys) {
    right.keys = {};
    for (const [k, ks] of Object.entries(c.keys)) {
      const shifted = ks.map((x) => ({ ...x, t: x.t - cut }));
      const vAt = valueAt(c, k, cut, ks[0].v);
      const r = shifted.filter((x) => x.t > 1e-4); if (r.length !== shifted.length || !r.length) r.unshift({ t: 0, v: vAt, e: 'linear' });
      right.keys[k] = r;
      const l = ks.filter((x) => x.t < cut - 1e-4); if (!l.length || l.length !== ks.length) l.push({ t: cut, v: vAt, e: 'linear' });
      c.keys[k] = l;
    }
  }
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
const selFx = (app, mediaOnly = false) => app.seq.clips.filter((c) => app.selection.has(c.id) && trackById(app.seq, c.trackId).kind === 'video' && !(mediaOnly && c.gen)).map((c) => c.id);

/** Ready look: swap in a tuned stack of effects (replaces the effects a previous look added). */
export function applyLook(app, key) {
  const L = LOOK_PRESETS[key]; if (!L) return;
  const ids = selFx(app);
  if (!ids.length) { toast('Select a clip (or an adjustment layer) to apply “' + L.label + '”.'); return; }
  edit(app, 'Look: ' + L.label, (seq) => {
    for (const c of seq.clips) if (ids.includes(c.id)) c.effects = [...(c.effects || []).filter((e) => !e.look), ...L.fx.map(([type, params]) => ({ id: uid('e'), type, enabled: true, look: key, params: { ...defaultParams(type), ...params } }))];
  });
  toast(L.label + ' applied', { timeout: 1200 });
  app.showProperties();
}
export function clearLook(app) {
  const ids = selFx(app);
  if (!ids.some((id) => app.seq.clips.find((c) => c.id === id).effects.some((e) => e.look))) { toast('The selected clip has no ready look.'); return; }
  edit(app, 'Remove Look', (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) c.effects = c.effects.filter((e) => !e.look); });
}
/** Film look by code: sets the look on the clip's Film Look effect, adding the effect when it has none. */
export function setFilmLook(app, code) {
  const ids = selFx(app);
  if (!ids.length) { toast('Select a clip to apply a film look.'); return; }
  const look = code == null ? null : LOOKS.find((l) => l.code === code);
  edit(app, 'Film Look' + (look ? ': ' + look.name : ''), (seq) => {
    for (const c of seq.clips) {
      if (!ids.includes(c.id)) continue;
      const e = (c.effects || []).find((x) => x.type === 'film');
      if (e) { if (look) e.params = { ...e.params, look: look.code }; e.enabled = true; }
      else c.effects = [...(c.effects || []), { id: uid('e'), type: 'film', enabled: true, params: { ...defaultParams('film'), ...(look ? { look: look.code } : {}) } }];
    }
  });
  if (look) toast(look.name + ' applied', { timeout: 1200 });
  app.showProperties();
}
/** Auto mask (AI people) in the given mode — reuses the clip's existing auto-mask effect. */
export function addAutoMask(app, mode = 0) {
  const ids = selFx(app, true);
  if (!ids.length) { toast('Select a video or image clip for Auto mask.'); return; }
  edit(app, 'Auto Mask: ' + MASK_MODES[mode], (seq) => {
    for (const c of seq.clips) {
      if (!ids.includes(c.id)) continue;
      const e = (c.effects || []).find((x) => x.type === 'bgRemove');
      const extra = mode === 5 ? { light: 100, amount: 35 } : {};
      if (e) { e.params = { ...e.params, mode, ...extra }; e.enabled = true; }
      else c.effects = [{ id: uid('e'), type: 'bgRemove', enabled: true, params: { ...defaultParams('bgRemove'), mode, ...extra } }, ...(c.effects || [])];
    }
  });
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

export const ASPECTS = [['16:9', 1920, 1080], ['9:16', 1080, 1920], ['1:1', 1080, 1080], ['4:5', 1080, 1350], ['4:3', 1440, 1080], ['21:9', 2560, 1080]];
/** Quick aspect switch (clips stay fitted to the new frame; use Fill frame to crop in). */
export function setAspect(app, w, hh) {
  if (!app.seq || (app.seq.width === w && app.seq.height === hh)) return;
  edit(app, `Frame ${w} × ${hh}`, (seq) => { seq.width = w; seq.height = hh; });
  app.layoutMonitor();
}

// ------------------------------------------------------------------ generated clips

/** Title / shape / matte clip at the playhead on the first free video track. */
export function addGenerated(app, tpl, { time = null, dur = 5 } = {}) {
  const T = GEN_TEMPLATES[tpl]; if (!T) return;
  const s = app.seq;
  const at = time == null ? app.engine.time : Math.max(0, time);
  const mattes = T.gen.type === 'color';
  // titles go on the highest free track, mattes on the lowest
  const open = s.tracks.filter((t) => t.kind === 'video' && !t.lock);
  const free = (t) => !s.clips.some((c) => c.trackId === t.id && c.start < at + dur - TICK && clipEnd(c) > at + TICK);
  let tr = (mattes ? open : [...open].reverse()).find(free);
  let newTrack = null;
  if (!tr) { newTrack = makeTrack('video', 'V' + (open.length + 1)); tr = newTrack; }
  const c = makeClip({ trackId: tr.id, name: genLabel(T.gen), start: at, in: 0, out: dur, gen: structuredClone(T.gen) });
  if (T.transform) Object.assign(c.transform, T.transform);
  edit(app, 'New ' + T.label, (seq) => {
    if (newTrack) { const lastV = seq.tracks.map((x) => x.kind).lastIndexOf('video'); seq.tracks.splice(lastV + 1, 0, newTrack); }
    seq.clips.push(c);
  });
  app.select([c.id]);
  app.showProperties();
  return c.id;
}

export function updateGen(app, id, patch, label = 'Edit Title') {
  edit(app, label, (seq) => {
    const c = seq.clips.find((x) => x.id === id); if (!c || !c.gen) return false;
    c.gen = { ...c.gen, ...patch };
    if ('text' in patch) c.name = genLabel(c.gen);
  }, { coalesce: id + ':gen:' + Object.keys(patch).join(',') });
}

const TEXT_DEF_CAPTION = { ...textStylePatch('subtitleBg'), ...GEN_TEMPLATES.caption.gen, bgOp: 100, bgRadius: 0, bgLine: true, wrap: 86 }; // the plain boxed caption
const isText = (c) => c.gen && (c.gen.type === 'text' || c.gen.type === 'caption');

/** New title at the playhead in a text style. */
export function addStyledText(app, key, { dur = 5 } = {}) {
  const S = TEXT_STYLES[key]; if (!S) return;
  const s = app.seq, at = app.engine.time;
  const open = s.tracks.filter((t) => t.kind === 'video' && !t.lock);
  let tr = [...open].reverse().find((t) => !s.clips.some((c) => c.trackId === t.id && c.start < at + dur - TICK && clipEnd(c) > at + TICK));
  let newTrack = null;
  if (!tr) { newTrack = makeTrack('video', 'V' + (s.tracks.filter((t) => t.kind === 'video').length + 1)); tr = newTrack; }
  const gen = { type: 'text', text: S.sample || 'Your text here', ...textStylePatch(key) };
  const c = makeClip({ trackId: tr.id, name: genLabel(gen), start: at, in: 0, out: dur, gen });
  if (S.pos) { c.transform.x = Math.round(S.pos.x * s.width); c.transform.y = Math.round(S.pos.y * s.height); } else if (S.cap) c.transform.y = Math.round(s.height * 0.36);
  edit(app, 'New ' + S.label, (seq) => {
    if (newTrack) { const lastV = seq.tracks.map((x) => x.kind).lastIndexOf('video'); seq.tracks.splice(lastV + 1, 0, newTrack); }
    seq.clips.push(c);
  });
  app.select([c.id]);
  app.showProperties();
  return c.id;
}
/** Apply a text style to the selected titles/captions (keeps their words), or make a new title when none is selected. */
export function applyTextStyle(app, key) {
  const S = TEXT_STYLES[key]; if (!S) return;
  const ids = app.seq.clips.filter((c) => app.selection.has(c.id) && isText(c)).map((c) => c.id);
  if (!ids.length) return addStyledText(app, key);
  edit(app, 'Text Style: ' + S.label, (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) c.gen = { ...c.gen, ...textStylePatch(key, c.gen) }; });
  app.props.refresh(true);
}
/** One caption look for the whole sequence: a style key, or copy the style of clip `fromId`. */
export function styleAllCaptions(app, key, fromId = null) {
  const src = fromId ? app.seq.clips.find((c) => c.id === fromId) : null;
  const n = app.seq.clips.filter((c) => c.gen && c.gen.type === 'caption').length;
  if (!n) { toast('There are no caption clips in this sequence.'); return; }
  edit(app, 'Caption Style', (seq) => {
    for (const c of seq.clips) {
      if (!c.gen || c.gen.type !== 'caption') continue;
      if (src) { if (c.id !== src.id) { c.gen = { ...structuredClone(src.gen), text: c.gen.text }; c.transform = { ...c.transform, x: src.transform.x, y: src.transform.y, scale: src.transform.scale }; } }
      else if (key === 'classic') c.gen = { ...structuredClone(GEN_TEMPLATES.caption.gen), ...TEXT_DEF_CAPTION, text: c.gen.text };
      else c.gen = { ...c.gen, ...textStylePatch(key, c.gen) };
    }
  });
  app.props.refresh(true);
  toast(`Style applied to ${n} caption${n === 1 ? '' : 's'}`, { type: 'ok', timeout: 1500 });
}

export async function editGenText(app, c) {
  const v = await formDialog({ title: 'Edit text', ok: 'Apply', fields: [{ key: 'text', label: 'Text', type: 'textarea', value: c.gen.text, maxLength: 5000 }] });
  if (v) updateGen(app, c.id, { text: String(v.text).slice(0, 5000) }, 'Edit Text');
}

// ------------------------------------------------------------------ transitions

const selVideo = (app) => app.seq.clips.filter((c) => app.selection.has(c.id) && trackById(app.seq, c.trackId).kind === 'video');

/**
 * Apply a transition to the selected clips. Where a clip touches its
 * neighbour it becomes a cut transition; free edges fade from/to background.
 */
export function applyTransition(app, type = 'dissolve', { edge = 'both', dur = null } = {}) {
  const s = app.seq;
  let targets = selVideo(app);
  app.lastTransition = type;
  if (!targets.length) {
    // no selection: the cut nearest the playhead (a real cut between two clips wins over a free edge)
    const t = app.engine.time, vid = s.clips.filter((c) => trackById(s, c.trackId).kind === 'video' && !trackById(s, c.trackId).lock);
    const touches = (c) => vid.some((o) => o.trackId === c.trackId && o !== c && Math.abs(clipEnd(o) - c.start) < 1e-3);
    const cuts = vid.filter(touches).map((c) => ({ c, d: Math.abs(c.start - t) })).sort((a, b) => a.d - b.d);
    if (cuts.length) { targets = [cuts[0].c]; edge = 'in'; }
    else {
      const cands = vid.map((c) => ({ c, d: Math.min(Math.abs(c.start - t), Math.abs(clipEnd(c) - t)) })).sort((a, b) => a.d - b.d);
      if (cands.length) targets = [cands[0].c];
    }
  }
  if (!targets.length) { toast('Add a clip to the timeline first, then pick a transition.'); return; }
  const D = dur ?? (getSettings().transitionDuration || 0.5);
  const ids = targets.map((c) => c.id);
  edit(app, 'Add ' + TRANSITIONS[type].label, (seq) => {
    for (const c of seq.clips) {
      if (!ids.includes(c.id)) continue;
      const d = Math.min(D, clipDur(c) / 2);
      const prev = seq.clips.find((o) => o.trackId === c.trackId && o !== c && Math.abs(clipEnd(o) - c.start) < 1e-3);
      if (edge !== 'out') c.transIn = { type, dur: d };
      if (edge !== 'in' && !seq.clips.some((o) => o.trackId === c.trackId && o !== c && Math.abs(o.start - clipEnd(c)) < 1e-3)) c.transOut = { type, dur: d };
      else if (edge === 'out') { const nx = seq.clips.find((o) => o.trackId === c.trackId && o !== c && Math.abs(o.start - clipEnd(c)) < 1e-3); if (nx) nx.transIn = { type, dur: Math.min(D, clipDur(nx) / 2) }; }
      if (prev && edge !== 'out') prev.transOut = undefined; // the cut is handled by the incoming clip
    }
  });
  toast(TRANSITIONS[type].label + ' applied', { timeout: 1200 });
}
/** The same transition on every cut (where two clips touch on a video track) — one undo step. */
export function applyTransitionAll(app, type = 'dissolve', { dur = null } = {}) {
  const s = app.seq, D = dur ?? (getSettings().transitionDuration || 0.5);
  app.lastTransition = type;
  let n = 0;
  const isCut = (seq, c) => trackById(seq, c.trackId).kind === 'video' && seq.clips.find((o) => o.trackId === c.trackId && o !== c && Math.abs(clipEnd(o) - c.start) < 1e-3);
  if (!s.clips.some((c) => isCut(s, c))) { toast('No cuts yet — put two clips next to each other on a video track.'); return; }
  edit(app, TRANSITIONS[type].label + ' on All Cuts', (seq) => {
    for (const c of seq.clips) {
      const prev = isCut(seq, c); if (!prev) continue;
      c.transIn = { type, dur: Math.max(0.04, Math.min(D, clipDur(c) / 2, clipDur(prev) / 2)) }; prev.transOut = undefined; n++;
    }
  });
  toast(`${TRANSITIONS[type].label} applied to ${n} cut${n === 1 ? '' : 's'}`, { type: 'ok', timeout: 1600 });
}
export function setTransition(app, id, which, patch) {
  edit(app, 'Transition', (seq) => {
    const c = seq.clips.find((x) => x.id === id); if (!c) return false;
    if (patch === null) c[which] = undefined; else c[which] = { type: 'dissolve', dur: 0.5, ...(c[which] || {}), ...patch };
  }, { coalesce: id + ':' + which });
}
export function removeTransitions(app) {
  const ids = [...app.selection];
  edit(app, 'Remove Transitions', (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) { c.transIn = undefined; c.transOut = undefined; } });
}

// ------------------------------------------------------------------ keyframes

/** Toggle animation for a property (Premiere stopwatch). */
export function toggleAnimate(app, id, prop) {
  edit(app, 'Toggle Animation', (seq) => {
    const c = seq.clips.find((x) => x.id === id); if (!c) return false;
    if (hasKeys(c, prop)) { delete c.keys[prop]; if (!Object.keys(c.keys).length) c.keys = undefined; return; }
    const lt = Math.max(0, Math.min(clipDur(c), app.engine.time - c.start));
    setKey(c, prop, lt, currentValue(c, prop, lt));
  });
}
function currentValue(c, prop, lt) {
  if (prop.startsWith('fx:')) { const [, eid, p] = prop.split(':'); const e = (c.effects || []).find((x) => x.id === eid); return valueAt(c, prop, lt, e ? e.params[p] ?? defaultParams(e.type)[p] : 0); }
  return valueAt(c, prop, lt, PROPS[prop].get(c));
}
/** Set a property; when it is animated this writes a keyframe at the playhead. */
export function setProp(app, id, prop, v, label = 'Change') {
  edit(app, label, (seq) => {
    const c = seq.clips.find((x) => x.id === id); if (!c) return false;
    if (hasKeys(c, prop)) { const lt = Math.max(0, Math.min(clipDur(c), app.engine.time - c.start)); setKey(c, prop, lt, v); }
    else if (prop.startsWith('fx:')) { const [, eid, p] = prop.split(':'); const e = c.effects.find((x) => x.id === eid); if (e) e.params = { ...e.params, [p]: v }; }
    else PROPS[prop].set(c, v);
  }, { coalesce: id + ':p:' + prop });
}
export function addOrRemoveKey(app, id, prop) {
  edit(app, 'Keyframe', (seq) => {
    const c = seq.clips.find((x) => x.id === id); if (!c) return false;
    const lt = Math.max(0, Math.min(clipDur(c), app.engine.time - c.start));
    const ks = c.keys && c.keys[prop];
    if (ks && ks.some((k) => Math.abs(k.t - lt) < 1 / 60)) { removeKeyAt(c, prop, lt); if (c.keys && !Object.keys(c.keys).length) c.keys = undefined; }
    else setKey(c, prop, lt, currentValue(c, prop, lt));
  });
}
export function setKeyEase(app, id, prop, e) {
  edit(app, 'Keyframe Easing', (seq) => {
    const c = seq.clips.find((x) => x.id === id); const ks = c && c.keys && c.keys[prop]; if (!ks) return false;
    const lt = app.engine.time - c.start;
    // the segment the playhead is in (or the keyframe on it)
    let k = [...ks].reverse().find((x) => x.t <= lt + 1 / 60) || ks[0];
    k.e = e;
  });
}
export function jumpKey(app, dir) {
  const c = app.seq.clips.find((x) => app.selection.has(x.id) && x.keys); if (!c) return;
  const ts = [...new Set(Object.values(c.keys).flat().map((k) => c.start + k.t))].sort((a, b) => a - b);
  const t = app.engine.time;
  const target = dir > 0 ? ts.find((x) => x > t + 1e-3) : [...ts].reverse().find((x) => x < t - 1e-3);
  if (target != null) app.engine.seek(target);
}
export function clearKeys(app) {
  const ids = [...app.selection];
  edit(app, 'Remove Keyframes', (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) c.keys = undefined; });
}
export function applyPreset(app, key) {
  const P = PRESETS[key]; const s = app.seq;
  const ids = selVideo(app).filter((c) => !P.text || (c.gen && c.gen.type !== 'color' && c.gen.type !== 'shape')).map((c) => c.id);
  if (!ids.length) { toast(P.text ? 'Select a title clip for this preset.' : 'Select a video, image or title clip first.'); return; }
  edit(app, 'Preset: ' + P.label, (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) P.apply(c, clipDur(c), s); });
  app.showProperties();
}

// ------------------------------------------------------------------ freeze frame

/** Hold the frame under the playhead for `dur` seconds: the frame becomes a still that is rippled in at the playhead. */
export async function freezeFrame(app, dur = 2) {
  const s = app.seq, t = app.engine.time;
  const under = s.clips.filter((c) => !c.gen && t > c.start + TICK && t < clipEnd(c) - TICK && trackById(s, c.trackId).kind === 'video' && mediaById(app.project, c.mediaId)?.kind === 'video');
  const c = under.find((x) => app.selection.has(x.id)) || under[under.length - 1];
  if (!c) { toast('Park the playhead inside a video clip to freeze its frame.'); return; }
  const rec = app.engine.els.get(c.id + ':video');
  if (!rec || rec.el.readyState < 2 || rec.el.seeking) { toast('The frame is still loading — try again in a moment.'); return; }
  const cv = document.createElement('canvas'); cv.width = rec.el.videoWidth; cv.height = rec.el.videoHeight;
  let blob = null;
  try { cv.getContext('2d').drawImage(rec.el, 0, 0); blob = await new Promise((r) => cv.toBlob(r, 'image/png')); } catch (e) { blob = null; }
  if (!blob) { toast('This video can’t be captured (linked from another site).', { type: 'error' }); return; }
  const file = new File([blob], sanitizeFilename(baseName(c.name) + ' freeze.png'), { type: 'image/png' });
  const [still] = await app.importFiles([file]);
  if (!still) return;
  let id = null;
  edit(app, 'Freeze Frame', (seq) => {
    const links = new Map();
    for (const o of [...seq.clips]) { // ripple every unlocked track so picture and sound stay in sync
      if (trackById(seq, o.trackId).lock) continue;
      if (o.start >= t - TICK) o.start += dur;
      else if (clipEnd(o) > t + TICK && o.gen) o.out += dur * (o.speed || 1); // titles, mattes and adjustment layers just last longer
      else if (clipEnd(o) > t + TICK) { const r = splitInto(seq, o, t); r.start += dur; if (o.linkId) { if (!links.has(o.linkId)) links.set(o.linkId, uid('L')); r.linkId = links.get(o.linkId); } }
    }
    const src = seq.clips.find((x) => x.id === c.id);
    const f = makeClip({ trackId: c.trackId, mediaId: still.id, name: still.name, start: t, in: 0, out: dur, transform: { ...src.transform }, crop: { ...src.crop }, effects: (src.effects || []).map((e) => ({ ...structuredClone(e), id: uid('e') })) });
    seq.clips.push(f); id = f.id;
  });
  if (id) app.select([id]);
  toast(`Freeze frame added (${dur} s)`, { type: 'ok', timeout: 1500 });
}

// ------------------------------------------------------------------ audio

export function setAudioFx(app, id, patch) {
  edit(app, 'Audio Effect', (seq) => {
    const c = seq.clips.find((x) => x.id === id); if (!c) return false;
    c.audioFx = { low: 0, mid: 0, high: 0, comp: false, threshold: -24, ratio: 4, pan: 0, ...(c.audioFx || {}), ...patch };
  }, { coalesce: id + ':afx:' + Object.keys(patch).join(',') });
}

// ------------------------------------------------------------------ trimming / selection

export function setSpeed(app, sp) {
  const ids = [...app.selection]; if (!ids.length) { toast('Select a clip first.'); return; }
  edit(app, 'Speed ' + Math.round(sp * 100) + '%', (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) c.speed = sp; resolveOverlaps(seq, ids); });
}
export function reverseKeys(app) { /* reserved */ }

/** Q / W: ripple-trim the clip under the playhead to the playhead (previous / next edit). */
export function rippleTrim(app, side) {
  const s = app.seq, t = app.engine.time;
  const pool = s.clips.filter((c) => t > c.start + TICK && t < clipEnd(c) - TICK && !trackById(s, c.trackId).lock);
  const sel = pool.filter((c) => app.selection.has(c.id));
  let targets = sel.length ? sel : pool;
  for (const c of [...targets]) for (const l of linked(s, c)) if (!targets.includes(l) && pool.includes(l)) targets.push(l);
  if (!targets.length) { toast('Park the playhead inside a clip.', { timeout: 1400 }); return; }
  const ids = targets.map((c) => c.id);
  const origStart = Math.min(...targets.map((c) => c.start));
  edit(app, side === 'start' ? 'Ripple Trim Previous Edit to Playhead' : 'Ripple Trim Next Edit to Playhead', (seq) => {
    const shifts = [];
    for (const c of seq.clips) {
      if (!ids.includes(c.id)) continue;
      const oldEnd = clipEnd(c);
      if (side === 'start') { const gap = t - c.start; c.in = srcTime(c, t); shifts.push([c.trackId, oldEnd, -gap]); }
      else { c.out = srcTime(c, t); shifts.push([c.trackId, oldEnd, t - oldEnd]); }
    }
    for (const [tid, at, delta] of shifts) for (const o of seq.clips) if (o.trackId === tid && !ids.includes(o.id) && o.start >= at - TICK) o.start = Math.max(0, o.start + delta);
  });
  if (side === 'start') app.engine.seek(origStart);
}

/** A: select this clip and everything after it on all tracks (Track Select Forward). */
export function selectForward(app, allTracks = true) {
  const s = app.seq, t = app.engine.time;
  const ids = s.clips.filter((c) => clipEnd(c) > t + TICK && (allTracks || app.selection.size === 0 || [...app.selection].some((id) => s.clips.find((x) => x.id === id)?.trackId === c.trackId))).map((c) => c.id);
  app.select(ids);
  toast(ids.length + ' clip(s) selected forward', { timeout: 1100 });
}

/** Nudge selected clips by n frames (Alt+← / Alt+→). */
export function nudge(app, frames) {
  const ids = [...app.selection]; if (!ids.length) return;
  const d = frames / app.seq.fps;
  edit(app, 'Nudge', (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) c.start = Math.max(0, c.start + d); resolveOverlaps(seq, ids); }, { coalesce: 'nudge' });
}

/** Move a clip on the monitor (keyframe-aware: writes keys when X/Y are animated). */
export function moveClipTo(app, id, x, y) {
  edit(app, 'Move', (seq) => {
    const c = seq.clips.find((q) => q.id === id); if (!c) return false;
    const lt = Math.max(0, Math.min(clipDur(c), app.engine.time - c.start));
    for (const [p, v] of [['x', x], ['y', y]]) { if (hasKeys(c, p)) setKey(c, p, lt, v); else PROPS[p].set(c, v); }
  });
}

export { seqDuration };
