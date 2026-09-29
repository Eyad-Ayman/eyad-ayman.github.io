// EYAD VIDEO — best-effort Adobe Premiere Pro (.prproj) reader.
//
// A .prproj is gzip-compressed XML describing the project: bins, sequences,
// track groups, track items, clips, media sources and media file paths, linked
// together with ObjectID/ObjectRef and ObjectUID/ObjectURef references.
// We follow those references to rebuild sequences, tracks, clip timing and
// media references. Anything we can't reproduce is counted and reported.
// Media never comes with the project, so every file starts OFFLINE until the
// user relinks it. Nothing in the file is executed.
import { uid } from '../core/dom.js';
import { createSequence, makeTrack, makeClip } from './model.js';

const TICKS = 254016000000; // Premiere ticks per second
const MAX_XML = 600 * 1024 * 1024;
const INTRINSIC_FX = /^(Motion|Opacity|Volume|Channel Volume|Panner|Time Remapping|Audio Levels|Transform)$/i;

async function gunzipText(file, onProgress) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (!(head[0] === 0x1f && head[1] === 0x8b)) {
    // Some tools save uncompressed XML with the .prproj extension.
    const t = await file.text();
    if (!/<PremiereData[\s>]/.test(t.slice(0, 4096))) throw new Error('This file is not a Premiere Pro project (no gzip header and no PremiereData XML).');
    return t;
  }
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress Premiere projects (Compression Streams API missing). Try a current Chrome, Edge, Firefox or Safari.');
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_XML) { reader.cancel(); throw new Error('The project expands to more than 600 MB of XML, which is too large to parse in the browser.'); }
    chunks.push(value);
    onProgress && onProgress(total);
  }
  return new TextDecoder('utf-8').decode(await new Blob(chunks).arrayBuffer());
}

const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.tagName === name) : []);
const kid = (el, name) => (el ? Array.from(el.children).find((c) => c.tagName === name) || null : null);
function path(el, p) { for (const part of p.split('/')) { el = kid(el, part); if (!el) return null; } return el; }
const text = (el) => (el ? el.textContent.trim() : '');
const num = (el, d = null) => { const v = parseFloat(text(el)); return Number.isFinite(v) ? v : d; };

function extKind(name) {
  const e = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1];
  if (!e) return null;
  const x = e.toLowerCase();
  if (['mp4', 'mov', 'm4v', 'mxf', 'avi', 'mkv', 'webm', 'mts', 'm2ts', 'mpg', 'mpeg', 'r3d', 'braw', 'wmv', 'flv', '3gp'].includes(x)) return 'video';
  if (['wav', 'mp3', 'aac', 'm4a', 'aif', 'aiff', 'ogg', 'flac', 'wma', 'opus'].includes(x)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'psd', 'tif', 'tiff', 'gif', 'bmp', 'webp', 'ai', 'svg', 'heic', 'exr', 'dpx'].includes(x)) return 'image';
  return null;
}
export function baseFromPath(p) { return String(p || '').split(/[\\/]/).pop() || ''; }

export async function importPrproj(file, { onProgress } = {}) {
  onProgress && onProgress(null, 'Decompressing project…');
  const xml = await gunzipText(file, (n) => onProgress && onProgress(null, `Decompressing… ${(n / 1048576).toFixed(1)} MB`));
  onProgress && onProgress(null, 'Parsing XML…');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const perr = dom.getElementsByTagName('parsererror')[0];
  if (perr) {
    const raw = text(perr);
    const detail = ((/error on line \d+ at column \d+:[^\n]*/i.exec(raw) || [])[0] || raw.replace(/This page contains the following errors:/i, '').slice(0, 120)).replace(/Below is a rendering.*$/i, '');
    throw new Error('The project XML is malformed or truncated (' + detail.trim().replace(/\s+/g, ' ') + '). The file may be damaged or only partially downloaded.');
  }
  const root = dom.documentElement;
  if (!root || root.tagName !== 'PremiereData') throw new Error('The XML is not Premiere project data (root element is <' + (root && root.tagName) + '>).');

  onProgress && onProgress(null, 'Resolving references…');
  const byId = new Map(), byUid = new Map();
  for (const el of root.children) {
    const id = el.getAttribute('ObjectID'); if (id) byId.set(id, el);
    const u = el.getAttribute('ObjectUID'); if (u) byUid.set(u, el);
  }
  const deref = (el) => {
    if (!el) return null;
    const r = el.getAttribute('ObjectRef'); if (r) return byId.get(r) || null;
    const u = el.getAttribute('ObjectURef'); if (u) return byUid.get(u) || null;
    return null;
  };
  const countTag = (t) => root.getElementsByTagName(t).length;

  const stats = {
    premiereDataVersion: root.getAttribute('Version') || '?',
    projectVersion: (() => { const p = kids(root, 'Project').find((e) => e.getAttribute('ObjectID')); return p ? p.getAttribute('Version') : null; })(),
    sequences: 0, videoTracks: 0, audioTracks: 0, clipItems: 0, videoItems: 0, audioItems: 0, reconstructed: 0,
    transitions: 0, effects: 0, effectNames: new Map(), markers: 0, nested: 0, graphics: 0, unresolved: 0, speedChanged: 0, keyframed: 0,
    bins: countTag('BinProjectItem'), multicam: countTag('MulticamSource') + countTag('MultiCameraSource'), captions: countTag('CaptionStreamSource') + countTag('CaptionDataClip'),
    adjustmentLayers: countTag('AdjustmentLayer'), lockedTracks: 0, mutedTracks: 0,
  };

  // ---------- media
  const mediaMap = new Map(); // Media element → our media entry
  const mediaFor = (mEl) => {
    if (!mEl) return null;
    if (mediaMap.has(mEl)) return mediaMap.get(mEl);
    const fp = text(kid(mEl, 'ActualMediaFilePath')) || text(kid(mEl, 'FilePath')) || text(kid(mEl, 'RelativePath'));
    const title = text(kid(mEl, 'Title'));
    const name = baseFromPath(fp) || title || 'Untitled media';
    const isStill = /true/i.test(text(kid(mEl, 'IsStill')));
    const m = {
      id: uid('m'), name: name.slice(0, 300), kind: isStill ? 'image' : (extKind(name) || extKind(title) || 'video'),
      mime: '', size: 0, duration: 0, width: 0, height: 0, hasAudio: false, hasVideo: true, stored: false,
      originalPath: fp.slice(0, 2000), offline: true, thumb: null, peaks: null, peaksPerSec: 100, usedAsAudio: false, usedAsVideo: false,
    };
    mediaMap.set(mEl, m);
    return m;
  };
  // Media elements that aren't used in any sequence still belong to the project bin.
  for (const el of root.children) if (el.tagName === 'Media' && (text(kid(el, 'FilePath')) || text(kid(el, 'ActualMediaFilePath')))) mediaFor(el);

  // ---------- markers (two storage styles across versions)
  const readMarkers = (scope) => {
    const out = [];
    const walkEls = (el) => {
      for (const c of el.getElementsByTagName('*')) {
        if (c.tagName === 'Marker' || c.tagName === 'DVAMarker') {
          const t = num(kid(c, 'Start')) ?? num(kid(c, 'StartTime'));
          if (t != null) out.push({ time: t / TICKS, name: text(kid(c, 'Name')) || text(kid(c, 'Comment')) || 'Marker' });
        }
      }
    };
    if (scope) walkEls(scope);
    return out;
  };
  const jsonMarkers = () => {
    const out = [];
    const re = /"DVAMarker"/;
    for (const el of root.getElementsByTagName('*')) {
      if (el.children.length) continue;
      const t = el.textContent;
      if (!t || t.length > 2e6 || !re.test(t)) continue;
      try {
        const data = JSON.parse(t);
        const list = Array.isArray(data) ? data : [data];
        for (const d of list) {
          const mk = d && (d.DVAMarker || d);
          const ticks = mk && mk.mStartTime && Number(mk.mStartTime.ticks);
          if (Number.isFinite(ticks)) out.push({ time: ticks / TICKS, name: String(mk.mName || mk.mComment || 'Marker').slice(0, 200), owner: el });
        }
      } catch (e) { /* not JSON */ }
    }
    return out;
  };
  const allJsonMarkers = jsonMarkers();

  // ---------- sequences
  const sequences = [];
  const seqEls = kids(root, 'Sequence').filter((e) => e.getAttribute('ObjectUID') || e.getAttribute('ObjectID'));
  for (const sEl of seqEls) {
    const name = text(kid(sEl, 'Name')) || 'Sequence ' + (sequences.length + 1);
    let width = 1920, height = 1080, fps = 30;
    const groups = kids(path(sEl, 'TrackGroups'), 'TrackGroup').map((g) => deref(kid(g, 'Second'))).filter(Boolean);
    const vGroup = groups.find((g) => g.tagName === 'VideoTrackGroup');
    const aGroup = groups.find((g) => g.tagName === 'AudioTrackGroup');
    if (vGroup) {
      const fr = text(kid(vGroup, 'FrameRect'));
      const parts = fr.split(',').map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) { width = Math.abs(parts[2] - parts[0]) || width; height = Math.abs(parts[3] - parts[1]) || height; }
      const rate = num(path(vGroup, 'TrackGroup/FrameRate'));
      if (rate) fps = Math.round(TICKS / rate * 1000) / 1000;
    }
    const seq = createSequence({ name: name.slice(0, 200), width, height, fps, videoTracks: 0, audioTracks: 0 });
    const readGroup = (g, kind) => {
      if (!g) return;
      const trackEls = kids(path(g, 'TrackGroup/Tracks'), 'Track').map((t) => deref(t)).filter(Boolean);
      trackEls.forEach((tEl, i) => {
        const tr = makeTrack(kind, (kind === 'video' ? 'V' : 'A') + (i + 1));
        const tInfo = path(tEl, 'ClipTrack/Track');
        if (/true/i.test(text(kid(tInfo, 'IsLocked')))) { tr.lock = true; stats.lockedTracks++; }
        if (/true/i.test(text(kid(tInfo, 'IsMuted')))) { if (kind === 'video') tr.hidden = true; else tr.mute = true; stats.mutedTracks++; }
        seq.tracks.push(tr);
        if (kind === 'video') stats.videoTracks++; else stats.audioTracks++;
        stats.transitions += kids(path(tEl, 'ClipTrack/TransitionItems/TrackItems'), 'TrackItem').length;
        const items = kids(path(tEl, 'ClipTrack/ClipItems/TrackItems'), 'TrackItem').map((ti) => deref(ti)).filter(Boolean);
        for (const it of items) {
          stats.clipItems++;
          if (kind === 'video') stats.videoItems++; else stats.audioItems++;
          const cti = kid(it, 'ClipTrackItem');
          const start = num(path(cti, 'TrackItem/Start'), 0);
          const end = num(path(cti, 'TrackItem/End'), null);
          const sub = deref(kid(cti, 'SubClip'));
          const clipOuter = deref(kid(sub, 'Clip'));
          const clipIn = kid(clipOuter, 'Clip');
          const source = deref(kid(clipIn, 'Source'));
          let mEl = source ? deref(path(source, 'MediaSource/Media')) : null;
          const clipName = text(kid(sub, 'Name')) || text(kid(clipIn, 'Name'));
          // components (effects)
          const chain = deref(path(cti, 'ComponentOwner/Components'));
          const comps = kids(path(chain, 'ComponentChain/Components'), 'Component').map((c) => deref(c)).filter(Boolean);
          let fxCount = 0;
          for (const comp of comps) {
            const dn = text(path(comp, 'Component/DisplayName')) || text(path(comp, 'Component/MatchName')) || comp.tagName;
            if (comp.getElementsByTagName('Keyframes').length || comp.getElementsByTagName('StartKeyframe').length) stats.keyframed++;
            if (INTRINSIC_FX.test(dn)) continue;
            fxCount++;
            stats.effectNames.set(dn, (stats.effectNames.get(dn) || 0) + 1);
          }
          if (fxCount) stats.effects += fxCount;
          if (end == null) { stats.unresolved++; continue; }
          const dur = (end - start) / TICKS;
          if (!(dur > 0)) { stats.unresolved++; continue; }
          const inPt = num(kid(clipIn, 'InPoint'), 0) / TICKS;
          const outPt = num(kid(clipIn, 'OutPoint'), null);
          let speed = num(kid(clipIn, 'PlaybackSpeed'), null);
          if (!(speed > 0)) speed = outPt != null && outPt / TICKS > inPt ? Math.max(0.05, ((outPt / TICKS) - inPt) / dur) : 1;
          if (Math.abs(speed - 1) > 1e-3) stats.speedChanged++;
          let m = null, missing = null;
          if (source && source.tagName === 'SequenceSource') { stats.nested++; missing = 'Nested sequence: ' + (clipName || 'sequence'); }
          else if (!mEl) {
            if (/Graphic|Text|Title|Caption|Matte|Bars|Countdown|Adjustment/i.test((source && source.tagName) || '') || /Graphic|Title|Text/i.test(clipName)) { stats.graphics++; missing = 'Generated item (graphics/title/matte): ' + (clipName || source?.tagName || 'item'); }
            else { stats.unresolved++; missing = 'Unresolved source: ' + (clipName || 'clip'); }
          } else m = mediaFor(mEl);
          if (m) { if (kind === 'audio') m.usedAsAudio = true; else m.usedAsVideo = true; m.duration = Math.max(m.duration, inPt + dur * speed); }
          const c = makeClip({
            trackId: tr.id, mediaId: m ? m.id : null, name: (clipName || (m && m.name) || 'Clip').slice(0, 300),
            start: start / TICKS, in: inPt, out: inPt + dur * speed, speed,
          });
          if (!m) { c.missing = missing; c.offline = true; }
          seq.clips.push(c);
          stats.reconstructed++;
        }
      });
    };
    readGroup(vGroup, 'video');
    readGroup(aGroup, 'audio');
    if (!seq.tracks.some((t) => t.kind === 'video')) seq.tracks.unshift(makeTrack('video', 'V1'));
    if (!seq.tracks.some((t) => t.kind === 'audio')) seq.tracks.push(makeTrack('audio', 'A1'));
    // link video+audio items from the same media with identical timing (how Premiere links A/V by default)
    for (const v of seq.clips) {
      if (!v.mediaId || v.linkId) continue;
      const vt = seq.tracks.find((t) => t.id === v.trackId);
      if (vt.kind !== 'video') continue;
      const a = seq.clips.find((x) => !x.linkId && x.mediaId === v.mediaId && Math.abs(x.start - v.start) < 1e-3 && Math.abs(x.out - x.in - (v.out - v.in)) < 1e-3 && seq.tracks.find((t) => t.id === x.trackId).kind === 'audio');
      if (a) { const L = uid('L'); v.linkId = L; a.linkId = L; }
    }
    // markers: elements under this sequence, then JSON markers owned by it
    const mk = [...readMarkers(sEl), ...allJsonMarkers.filter((j) => sEl.contains(j.owner))];
    for (const x of mk) seq.markers.push({ id: uid('k'), time: Math.max(0, x.time), name: x.name, color: '#e2a93b' });
    stats.markers += mk.length;
    sequences.push(seq);
    stats.sequences++;
  }
  // markers stored at project level (not inside a sequence element)
  const orphan = allJsonMarkers.filter((j) => !seqEls.some((s) => s.contains(j.owner)));
  if (orphan.length && sequences[0]) { for (const x of orphan) sequences[0].markers.push({ id: uid('k'), time: Math.max(0, x.time), name: x.name, color: '#3d8bfd' }); stats.markers += orphan.length; stats.orphanMarkers = orphan.length; }

  const media = [...mediaMap.values()];
  for (const m of media) {
    if (m.kind === 'video' && !m.usedAsVideo && m.usedAsAudio && extKind(m.name) !== 'video') m.kind = 'audio';
    m.hasAudio = m.usedAsAudio || m.kind === 'audio';
    delete m.usedAsAudio; delete m.usedAsVideo;
  }
  if (!sequences.length && !media.length) throw new Error('No sequences or media were found. This Premiere version may store data in a structure EYAD VIDEO does not understand, or the file is damaged.');
  const project = {
    id: uid('v'), name: file.name.replace(/\.prproj$/i, '').slice(0, 200), created: Date.now(),
    media, sequences: sequences.length ? sequences : [createSequence({ name: 'Sequence 01' })],
    activeSeq: null, meta: { source: 'prproj', prproj: { file: file.name, version: stats.projectVersion } },
  };
  project.activeSeq = project.sequences[0].id;
  return { project, report: buildReport(stats, project) };
}

function buildReport(s, project) {
  const rows = [];
  const add = (status, label, detail) => rows.push({ status, label, detail });
  const offline = project.media.length;
  if (s.sequences) add('ok', `Sequence metadata (${s.sequences})`, 'Names, frame size and frame rate.');
  else add('no', 'Sequences', 'No sequences could be read — only the media list was imported.');
  if (s.clipItems) add('ok', `Clip timing (${s.reconstructed} of ${s.clipItems} clips)`, 'Timeline position, source in/out points and duration.');
  add('ok', `Track structure (${s.videoTracks} video, ${s.audioTracks} audio)`, s.lockedTracks || s.mutedTracks ? `${s.lockedTracks} locked, ${s.mutedTracks} muted/hidden state kept.` : null);
  if (offline) add('ok', `Media references (${offline})`, 'File names and original paths are kept for relinking.');
  if (s.speedChanged) add('ok', `Speed changes (${s.speedChanged} clip${s.speedChanged > 1 ? 's' : ''})`);
  if (s.markers) add('part', `Markers (${s.markers})`, s.orphanMarkers ? `${s.orphanMarkers} project-level marker(s) were placed on the first sequence.` : 'Imported on a best-effort basis; durations and marker types are simplified.');
  if (s.effects) add('part', `Effects (${s.effects})`, 'Detected but not reproduced: ' + [...s.effectNames.entries()].slice(0, 8).map(([n, c]) => `${n}${c > 1 ? ' ×' + c : ''}`).join(', ') + (s.effectNames.size > 8 ? '…' : ''));
  if (s.keyframed) add('part', 'Keyframed motion/opacity/volume', 'Keyframes are not imported; clips use default transform, opacity and volume.');
  else add('part', 'Motion, opacity & volume settings', 'Premiere’s intrinsic effect values are not imported; defaults are used.');
  if (s.transitions) add('part', `Transitions (${s.transitions})`, 'Not reproduced — add fades in EYAD VIDEO instead.');
  add('part', 'Audio processing', 'Channel mapping, pan and audio effects use EYAD VIDEO defaults.');
  if (s.nested) add('no', `Nested sequences (${s.nested})`, 'Shown as offline placeholder clips.');
  if (s.graphics) add('no', `Graphics, titles & generated items (${s.graphics})`, 'Shown as offline placeholder clips.');
  if (s.multicam) add('no', 'Multicam sequences');
  if (s.captions) add('no', 'Captions');
  if (s.unresolved) add('no', `Unresolved items (${s.unresolved})`, 'Their structure could not be followed; they were skipped or shown as placeholders.');
  add('no', 'Proprietary features', 'Lumetri looks, Essential Graphics, dynamic links, proxies and project settings.');
  return {
    title: 'Project import',
    intro: `Premiere project imported with limited compatibility.${offline ? ` ${offline} media file(s) are offline until you relink them.` : ''}`,
    stats: [['Sequences', s.sequences], ['Video tracks', s.videoTracks], ['Audio tracks', s.audioTracks], ['Media files', offline], ['Clips', s.clipItems]],
    rows,
  };
}

export { TICKS };
