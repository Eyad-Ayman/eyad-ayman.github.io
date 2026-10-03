// EYAD VIDEO — auto captions: the speech in a clip (or the whole sequence) becomes caption clips.
// Speech recognition runs on this device (Whisper in WebAssembly, ../core/stt.js). Nothing is uploaded.
// The recognised words are model output: they only ever reach the page as plain text (textContent / canvas text).
import { h } from '../core/dom.js';
import { toast, dialog, buildForm, alertDialog, menuSheet } from '../core/ui.js';
import { clipEnd, seqDuration, trackById, mediaById, linked, dbToGain } from './model.js';
import { addCaptionCues, importCaptions, exportCaptions } from './captions.js';

const PREFS = 'eyad:autocap', RTF = 'eyad:stt:rtf';
const MAX_SECONDS = 30 * 60;
const read = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const clock = (t) => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const human = (t) => (t < 90 ? `${Math.max(1, Math.round(t))} s` : `${Math.round(t / 60)} min`);

// ------------------------------------------------------------------ what to listen to
/** Audio clips of the selection (with their linked partners), or null when the selection has no sound. */
function selectedAudio(app) {
  const s = app.seq, set = new Set();
  for (const c of s.clips) if (app.selection.has(c.id)) { set.add(c); for (const l of linked(s, c)) set.add(l); }
  const clips = [...set].filter((c) => { const tr = trackById(s, c.trackId); return tr && tr.kind === 'audio' && c.mediaId && !c.gen; });
  return clips.length ? clips : null;
}
function sequenceAudio(app) {
  const s = app.seq, anySolo = s.tracks.some((t) => t.kind === 'audio' && t.solo);
  return s.clips.filter((c) => { const tr = trackById(s, c.trackId); return tr && tr.kind === 'audio' && c.mediaId && !c.gen && !tr.mute && !c.muted && c.enabled !== false && !(anySolo && !tr.solo); });
}
/** → { clips, from, to, kind: 'clips' | 'sequence' } for the selection (when it has sound) and for the sequence. */
export function captionScopes(app) {
  const s = app.seq, out = {};
  const sel = selectedAudio(app);
  if (sel) out.clips = { kind: 'clips', clips: sel, from: Math.min(...sel.map((c) => c.start)), to: Math.max(...sel.map(clipEnd)) };
  const all = sequenceAudio(app);
  if (all.length) out.sequence = { kind: 'sequence', clips: all, from: 0, to: seqDuration(s) };
  return out;
}

/**
 * Mix the scope down to mono 16 kHz (what the speech model listens to), peak-normalised.
 * A selected clip is heard at full volume even if it is muted in the mix; the sequence is heard as it plays.
 */
export async function renderSpeechAudio(app, scope, onStatus = () => {}) {
  const s = app.seq, dur = scope.to - scope.from;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('This browser cannot mix audio offline (no OfflineAudioContext).');
  const bufs = [];
  let skipped = 0;
  for (const c of scope.clips) {
    const m = mediaById(app.project, c.mediaId);
    if (!m || m.offline) { skipped++; continue; }
    onStatus('Reading the audio…');
    try { bufs.push([c, await app.media.audioBuffer(m.id)]); } catch (e) { skipped++; }
  }
  if (!bufs.length) throw new Error(skipped ? 'The audio of this clip could not be decoded in this browser (or its media is offline).' : 'There is no audio to listen to.');
  const mix = async (rate) => {
    const off = new OAC(1, Math.max(1, Math.ceil(dur * rate)), rate);
    for (const [c, buf] of bufs) {
      const tr = trackById(s, c.trackId), cs = c.start, ce = clipEnd(c), sp = c.speed || 1;
      if (ce <= scope.from || cs >= scope.to) continue;
      const src = off.createBufferSource(); src.buffer = buf; src.playbackRate.value = sp;
      const g = off.createGain(), base = scope.kind === 'clips' ? 1 : dbToGain(c.volume) * dbToGain(tr.volume);
      const t0 = Math.max(0, cs - scope.from), skip = Math.max(0, scope.from - cs);
      g.gain.setValueAtTime(base, 0);
      if (scope.kind === 'sequence') {
        if (c.fadeIn > 0) { g.gain.setValueAtTime(cs >= scope.from ? 0 : base * Math.min(1, skip / c.fadeIn), t0); g.gain.linearRampToValueAtTime(base, Math.max(t0, cs + c.fadeIn - scope.from)); }
        if (c.fadeOut > 0) { g.gain.setValueAtTime(base, Math.max(t0, ce - c.fadeOut - scope.from)); g.gain.linearRampToValueAtTime(0, ce - scope.from); }
      }
      src.connect(g).connect(off.destination);
      src.start(t0, c.in + skip * sp, Math.max(0, (Math.min(ce, scope.to) - Math.max(cs, scope.from)) * sp));
    }
    return off.startRendering();
  };
  onStatus('Preparing the audio…');
  let pcm;
  try { pcm = (await mix(16000)).getChannelData(0); }
  catch (e) {
    // browsers that refuse a 16 kHz offline context: mix at 48 kHz and resample here
    const { resampleTo16k } = await import('../core/stt.js');
    const b = await mix(48000); pcm = resampleTo16k([b.getChannelData(0)], 48000);
  }
  let peak = 0; for (let i = 0; i < pcm.length; i++) { const a = pcm[i] < 0 ? -pcm[i] : pcm[i]; if (a > peak) peak = a; }
  if (peak < 1e-4) throw new Error('That audio is silent.');
  const k = 0.9 / peak; if (k > 1.05 || k < 0.95) for (let i = 0; i < pcm.length; i++) pcm[i] *= k;
  return new Float32Array(pcm);
}

// ------------------------------------------------------------------ segments → caption cues
const HARD = /[.!?؟…。！？]["'”’»)\]]*$/, SOFT = /[,;:،؛、，：]["'”’»)\]]*$/;
const len = (s) => Array.from(s).length;
/** Split one line of text into pieces of at most `cap` characters, preferring sentence ends, then commas, then spaces. */
export function splitCaptionText(text, cap) {
  const words = [];
  for (const w of String(text).trim().split(/\s+/).filter(Boolean)) {
    const ch = Array.from(w);                     // a "word" longer than a caption (no spaces: Chinese, Japanese, Thai…) is cut by characters
    if (ch.length <= cap) words.push(w); else for (let i = 0; i < ch.length; i += cap) words.push(ch.slice(i, i + cap).join(''));
  }
  const out = []; let cur = [], n = 0, natural = [];
  const flush = (nat) => { if (cur.length) { out.push(cur); natural.push(nat); cur = []; n = 0; } };
  for (const w of words) {
    const l = len(w);
    if (cur.length && n + 1 + l > cap) flush(false);
    cur.push(w); n += (cur.length > 1 ? 1 : 0) + l;
    if ((HARD.test(w) && n >= cap * 0.4) || (SOFT.test(w) && n >= cap * 0.6)) flush(true);
  }
  flush(true);
  // no one-word orphan at the end: even out the last two pieces when the split between them was forced by length
  for (let i = out.length - 1; i > 0; i--) {
    if (natural[i - 1]) continue;
    const a = out[i - 1], b = out[i], size = (x) => len(x.join(' '));
    while (a.length > 1 && size(b) + 1 + len(a[a.length - 1]) <= cap && size(a) - size(b) > len(a[a.length - 1]) + 1) b.unshift(a.pop());
  }
  return out.map((x) => x.join(' '));
}
/** Break a caption into at most two balanced lines of ≤ maxChars. */
function twoLines(text, maxChars) {
  if (len(text) <= maxChars) return text;
  const words = text.split(' '); if (words.length < 2) return text;
  let best = -1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = len(words.slice(0, i).join(' ')), b = len(words.slice(i).join(' '));
    if (a > maxChars || b > maxChars) continue;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  if (best < 0) best = Math.ceil(words.length / 2);
  return words.slice(0, best).join(' ') + '\n' + words.slice(best).join(' ');
}
/**
 * Where the voice actually is inside [a, b] seconds of the 16 kHz audio (20 ms frames, energy gate with hang-over).
 * → { at(fraction) → time when that share of the *spoken* time has passed, next(t) → start of speech at/after t, first, last } or null.
 * The model only gives one start and end per sentence; this keeps captions from drifting across the pauses in between.
 */
function voiceMap(pcm, a, b) {
  const F = 320, i0 = Math.max(0, Math.floor(a * 16000 / F)), i1 = Math.min(Math.ceil(b * 16000 / F), Math.floor(pcm.length / F)), n = i1 - i0;
  if (n < 10) return null;
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; const o = (i0 + i) * F; for (let k = 0; k < F; k++) s += pcm[o + k] * pcm[o + k]; rms[i] = Math.sqrt(s / F); }
  const sorted = Float32Array.from(rms).sort(), thr = Math.max(sorted[Math.floor(n * 0.9)] * 0.12, 1e-3);
  const raw = new Uint8Array(n), v = new Uint8Array(n);
  for (let i = 0; i < n; i++) raw[i] = rms[i] > thr ? 1 : 0;
  for (let i = 0; i < n; i++) if (raw[i]) for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 4); k++) v[k] = 1;
  const cum = new Float32Array(n + 1); let first = -1, last = -1;
  for (let i = 0; i < n; i++) { cum[i + 1] = cum[i] + v[i]; if (v[i]) { if (first < 0) first = i; last = i; } }
  const total = cum[n]; if (total < 10) return null;
  const t = (i) => (i0 + i) * F / 16000;
  return {
    first: t(first), last: t(last + 1),
    at(f) { const want = f * total; let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < want) lo = m + 1; else hi = m; } return t(lo); },
    next(time) { let i = Math.max(0, Math.round(time * 16000 / F) - i0); while (i < n && !v[i]) i++; return t(Math.min(i, n)); },
  };
}

/**
 * Recognised segments → caption cues that fit a reel: at most `maxChars` per line and `maxLines` lines;
 * a long segment is split and its time shared out by character count — over the spoken parts only when
 * `pcm` (the mono 16 kHz audio the segments came from) is given.
 */
export function segmentsToCues(segments, { maxChars = 32, maxLines = 1, offset = 0, pcm = null } = {}) {
  maxChars = Math.max(8, Math.min(120, Math.round(maxChars) || 32)); maxLines = maxLines >= 2 ? 2 : 1;
  const cues = [];
  for (const sg of segments) {
    const text = String(sg.text || '').replace(/\s+/g, ' ').trim();
    if (!text || !(sg.end > sg.start)) continue;
    const parts = splitCaptionText(text, maxChars * maxLines), total = parts.reduce((a, p) => a + len(p), 0) || 1, d = sg.end - sg.start;
    const vm = pcm ? voiceMap(pcm, sg.start, sg.end) : null;
    let acc = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], f0 = acc / total; acc += len(p); const f1 = acc / total;
      let a = sg.start + d * f0, b = sg.start + d * f1;
      if (vm) {
        a = i === 0 ? Math.max(sg.start, vm.first - 0.08) : Math.max(sg.start, vm.next(vm.at(f0)) - 0.05);
        b = i === parts.length - 1 ? Math.min(sg.end, Math.max(vm.last + 0.3, a + 0.6)) : Math.min(sg.end, vm.at(f1) + 0.12);
        if (!(b > a + 0.05)) { a = sg.start + d * f0; b = sg.start + d * f1; }
      }
      cues.push({ start: offset + a, end: offset + b, text: (maxLines === 2 ? twoLines(p, maxChars) : p).slice(0, 1000) });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < cues.length; i++) {
    if (cues[i].end > cues[i + 1].start) cues[i].end = cues[i + 1].start;
    else if (cues[i + 1].start - cues[i].end < 0.25) cues[i].end = cues[i + 1].start;   // no flicker between back-to-back captions
  }
  return cues.filter((q) => q.end - q.start > 0.02);
}

// ------------------------------------------------------------------ UI
function estimate(model, seconds) {
  const known = read(RTF, {})[model];
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const guess = (model === 'base' ? 1.2 : 0.5) * (coarse ? 2.5 : 1);
  return { seconds: seconds * (known || guess), measured: !!known };
}

/** The options dialog. Resolves to { scope, language, model, maxChars, maxLines } or null. */
async function askOptions(app, scopes) {
  const stt = await import('../core/stt.js');
  const prefs = read(PREFS, { language: 'auto', model: stt.STT_DEFAULT_MODEL, maxChars: 32, maxLines: 1 });
  const status = {};
  await Promise.all(Object.keys(stt.STT_MODEL_INFO).map(async (k) => { status[k] = await stt.sttStatus(k).catch(() => ({ state: 'missing' })); }));
  const usable = Object.keys(status).filter((k) => !['missing', 'unsupported'].includes(status[k].state));
  if (!usable.length) {
    await alertDialog('Auto captions', 'The speech model can’t be loaded right now.', { detail: status[stt.STT_DEFAULT_MODEL].state === 'unsupported' ? 'This browser has no WebAssembly.' : 'It downloads once (39 MB) and then works offline — connect to the internet and try again.' });
    return null;
  }
  if (!usable.includes(prefs.model)) prefs.model = usable[0];
  const others = Object.entries(stt.STT_LANGUAGES).filter(([c]) => c !== 'ar' && c !== 'en').sort((a, b) => a[1].localeCompare(b[1]));
  const scopeOpts = [];
  if (scopes.clips) scopeOpts.push({ value: 'clips', label: `Selected clip${scopes.clips.clips.length > 1 ? 's' : ''} — ${clock(scopes.clips.to - scopes.clips.from)}` });
  if (scopes.sequence) scopeOpts.push({ value: 'sequence', label: `Whole sequence — ${clock(scopes.sequence.to - scopes.sequence.from)}` });
  const est = h('p', { class: 'vid-autocap-est', role: 'status' });
  const fields = [
    { key: 'scope', label: 'Listen to', type: 'select', value: scopeOpts[0].value, options: scopeOpts },
    { key: 'language', label: 'Spoken language', type: 'select', value: prefs.language, hint: 'One language per clip works best — for mixed speech, pick the main one.', options: [{ value: 'auto', label: 'Detect automatically' }, { value: 'ar', label: 'Arabic — العربية' }, { value: 'en', label: 'English' }, ...others.map(([value, label]) => ({ value, label }))] },
    { key: 'model', label: 'Quality', type: 'select', value: prefs.model, options: usable.map((k) => { const m = stt.STT_MODEL_INFO[k]; return { value: k, label: `${m.label} — ${m.name}, ${m.size}${k === 'base' ? ' (about 2–3× slower)' : ''}` }; }) },
    { key: 'maxChars', label: 'Max characters per line', type: 'number', value: prefs.maxChars, min: 8, max: 120, step: 1, inputMode: 'numeric' },
    { key: 'maxLines', label: 'Lines per caption', type: 'select', value: String(prefs.maxLines), options: [{ value: '1', label: '1 line' }, { value: '2', label: '2 lines' }] },
  ];
  const update = (v) => {
    const sc = scopes[v.scope] || scopes[scopeOpts[0].value], d = sc.to - sc.from, e = estimate(v.model, d), st = status[v.model] || {};
    const dl = st.state === 'included' ? ` First time: a one-time ${stt.STT_MODEL_INFO[v.model].size} download, then it works offline.` : '';
    est.textContent = d > MAX_SECONDS ? `That is ${clock(d)} of audio — auto captions handle up to ${MAX_SECONDS / 60} minutes at a time. Select a clip instead.`
      : `About ${human(e.seconds)} for ${clock(d)} of audio${e.measured ? ' on this device' : ' — a rough guess until the first run; phones are several times slower than laptops'}.${dl}`;
  };
  const form = buildForm(fields, update);
  update(form.values());
  const body = h('div', { class: 'vid-autocap-body' }, form.el, est,
    h('p', { class: 'vid-autocap-note studio-dim studio-small', text: 'Runs on your device. Small models make mistakes — especially with music, noise, or Egyptian dialect — so read the captions before you export. Nothing is uploaded.' }));
  const v = await dialog({ title: 'Auto captions', body, width: 440, className: 'vid-autocap', buttons: [{ label: 'Cancel', value: null }, { label: 'Start', value: () => form.values(), primary: true }] });
  if (!v) return null;
  const out = { scope: scopes[v.scope] || scopes[scopeOpts[0].value], language: v.language, model: v.model, maxChars: Math.max(8, Math.min(120, Math.round(v.maxChars) || 32)), maxLines: v.maxLines === '2' ? 2 : 1 };
  write(PREFS, { language: out.language, model: out.model, maxChars: out.maxChars, maxLines: out.maxLines });
  return out;
}

/** A small progress window with the words appearing as they are recognised. */
function progressWindow() {
  const bar = h('div', { class: 'studio-progress-bar is-indeterminate' });
  const label = h('div', { class: 'vid-autocap-status studio-dim studio-small', role: 'status', text: 'Starting…' });
  const heard = h('div', { class: 'vid-autocap-heard', dir: 'auto', 'aria-live': 'off' });
  let closeFn = null, onCancel = null;
  const done = dialog({
    title: 'Auto captions', className: 'vid-autocap vid-autocap-progress', dismissable: false, width: 440,
    body: h('div', { class: 'studio-stack' }, h('div', { class: 'studio-progress' }, bar), label, heard),
    buttons: [{ label: 'Cancel', value: 'cancel' }],
    onOpen: ({ close }) => { closeFn = close; },
  });
  done.then((v) => { if (v === 'cancel' && onCancel) onCancel(); });
  return {
    set(frac, text) {
      if (frac == null) bar.classList.add('is-indeterminate');
      else { bar.classList.remove('is-indeterminate'); bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; }
      if (text) label.textContent = text;
    },
    heard(text) { heard.textContent = text; },   // plain text only
    onCancel(fn) { onCancel = fn; },
    close() { if (closeFn) closeFn('done'); },
  };
}

let busy = false;
/**
 * Transcribe `scope` and add the captions (one undo step). opts: { scope, language, model, maxChars, maxLines }.
 * Returns the new clip ids ([] when cancelled or nothing was said).
 */
export async function runAutoCaptions(app, opts) {
  if (busy) { toast('Auto captions are already running.'); return []; }
  busy = true;
  const win = progressWindow(), ac = new AbortController();
  win.onCancel(() => ac.abort());
  try {
    const stt = await import('../core/stt.js');
    const scope = opts.scope, dur = scope.to - scope.from;
    if (dur > MAX_SECONDS) throw new Error(`Auto captions handle up to ${MAX_SECONDS / 60} minutes at a time — select a clip instead.`);
    const pcm = await renderSpeechAudio(app, scope, (t) => win.set(null, t));
    if (ac.signal.aborted) return [];
    const model = opts.model || stt.STT_DEFAULT_MODEL;
    let t0 = 0;
    const segs = await stt.transcribe(pcm, {
      language: opts.language || 'auto', model, signal: ac.signal,
      onProgress: (p) => {
        if (p.phase === 'load') { win.set(p.frac == null ? null : p.frac, p.label || 'Loading the speech model…'); return; }
        if (!t0) t0 = performance.now() - (p.ms || 0);
        const left = p.processed > 1 ? (performance.now() - t0) / p.processed * (p.total - p.processed) / 1000 : 0;
        win.set(p.processed > 0 ? p.processed / p.total : null, `Listening… ${clock(p.processed)} of ${clock(p.total)}${p.processed < p.total && left > 1 ? ` · about ${human(left)} left` : ''}`);
        const last = p.segments && p.segments[p.segments.length - 1], words = last ? last.text : p.partial;
        if (words) win.heard(Array.from(String(words)).slice(-110).join(''));
      },
    });
    if (ac.signal.aborted) return [];
    if (segs.ms && dur > 5) { const r = read(RTF, {}); r[model] = Math.round(segs.ms / 1000 / dur * 100) / 100; write(RTF, r); }
    const cues = segmentsToCues(segs, { maxChars: opts.maxChars, maxLines: opts.maxLines, offset: scope.from, pcm });
    win.close();
    if (!cues.length) { toast('No speech was found in that audio.', { detail: 'Music, noise or very quiet voices are not recognised.', timeout: 6000 }); return []; }
    const ids = addCaptionCues(app, cues, { label: 'Auto Captions' });
    const lang = segs.language && stt.STT_LANGUAGES[segs.language];
    toast(`Added ${cues.length} caption${cues.length === 1 ? '' : 's'}${lang ? ` (${lang})` : ''} on a new “Captions” track`, {
      type: 'ok', timeout: 9000, detail: 'Read them before you export — tap a caption to fix its words. Undo removes them all.',
      action: { label: 'Export SRT', fn: () => exportCaptions(app, 'srt') },
    });
    return ids;
  } catch (e) {
    win.close();
    if (!(e && e.name === 'AbortError')) toast('Auto captions failed', { type: 'error', detail: (e && e.message) || String(e), timeout: 8000 });
    return [];
  } finally { busy = false; }
}

/** Entry point for every menu / button: ask, then run. `clipId` = start from that clip (context menu). */
export async function autoCaptions(app, { clipId = null } = {}) {
  if (!app.project || !app.seq) { toast('Add a video or audio clip first.'); return []; }
  if (busy) { toast('Auto captions are already running.'); return []; }
  if (clipId && !app.selection.has(clipId)) app.select([clipId], { withLinked: true });
  const scopes = captionScopes(app);
  if (!scopes.clips && !scopes.sequence) { toast('There is no audio in this sequence to caption.', { detail: 'Import a video or audio clip with speech first.' }); return []; }
  const opts = await askOptions(app, scopes);
  if (!opts) return [];
  return runAutoCaptions(app, opts);
}

/** Phones: the dock's “Captions” button opens this list. */
export function captionsSheet(app) {
  const has = () => !!app.project;
  return menuSheet('Captions', [
    { label: 'Auto captions from speech…', action: () => autoCaptions(app), enabled: has },
    { label: 'Import SRT / VTT…', action: () => importCaptions(app) },
    { label: 'Export captions (SRT)', action: () => exportCaptions(app, 'srt'), enabled: has },
    { label: 'Export captions (WebVTT)', action: () => exportCaptions(app, 'vtt'), enabled: has },
    { label: 'Caption styles…', action: () => app.showEffects('gen'), enabled: has },
  ]);
}
