// EYAD speech-to-text engine — Whisper (OpenAI, MIT) running on this device in onnxruntime-web (WASM).
//
// This file is the whole pipeline and has no DOM dependencies, so it runs inside a Web Worker
// (stt-worker.js) or, where module workers are missing, on the main thread:
//   logMelWindow()      Whisper's log-mel spectrogram (16 kHz, n_fft 400, hop 160, 80 slaney mel bins)
//   speechBlocks()      splits the audio at real pauses, so silence is never fed to the model
//   WhisperDecoder      greedy decoding with the language / task / timestamp tokens and Whisper's
//                       timestamp rules, 30-second windows that advance on the last timestamp,
//                       no-speech skipping and a temperature fallback for repetition loops
//   SttRuntime          loads the model files (Cache Storage → studio/models/) and runs a job
//
// Models: the sherpa-onnx ONNX export of Whisper tiny / base (multilingual), weights stored as int8
// with per-channel scales (see studio/models/README.txt). Audio never leaves the device.
import { loadOrt, fetchModelBytes } from './inpaint.js';

export const SAMPLE_RATE = 16000;
const N_FFT = 400, HOP = 160, N_MELS = 80, N_FRAMES = 3000, N_BINS = 201;

/** Model registry. `files` are fetched with fetchModelBytes (split parts + sha256, cached after the first load). */
export const STT_MODELS = {
  tiny: {
    id: 'tiny', label: 'Fast', name: 'Whisper tiny', size: '39 MB', bytes: 39380305, layers: 4, state: 384, license: 'MIT',
    encoder: { file: 'whisper_tiny_encoder.onnx', bytes: 9627091, label: 'speech model (1/2)' },
    decoder: { file: 'whisper_tiny_decoder.onnx', bytes: 29753214, label: 'speech model (2/2)' },
  },
  base: {
    id: 'base', label: 'Better', name: 'Whisper base', size: '75 MB', bytes: 74643190, layers: 6, state: 512, license: 'MIT',
    encoder: { file: 'whisper_base_encoder.onnx', bytes: 24151539, label: 'speech model (1/2)' },
    decoder: { file: 'whisper_base_decoder.onnx', bytes: 50491651, label: 'speech model (2/2)' },
  },
};
export const STT_TOKENS = { file: 'whisper_tokens.txt', bytes: 816730, label: 'speech vocabulary', single: true };

// ---- Whisper multilingual vocabulary layout (tiny … medium)
const EOT = 50257, SOT = 50258, LANG0 = 50259, TRANSLATE = 50358, TRANSCRIBE = 50359, SOT_LM = 50360, SOT_PREV = 50361,
  NO_SPEECH = 50362, NO_TIMESTAMPS = 50363, TS0 = 50364, BLANK = 220, N_VOCAB = 51865, N_TEXT_CTX = 448;
export const STT_LANG_CODES = 'en,zh,de,es,ru,ko,fr,ja,pt,tr,pl,ca,nl,ar,sv,it,id,hi,fi,vi,he,uk,el,ms,cs,ro,da,hu,ta,no,th,ur,hr,bg,lt,la,mi,ml,cy,sk,te,fa,lv,bn,sr,az,sl,kn,et,mk,br,eu,is,hy,ne,mn,bs,kk,sq,sw,gl,mr,pa,si,km,sn,yo,so,af,oc,ka,be,tg,sd,gu,am,yi,lo,uz,fo,ht,ps,tk,nn,mt,sa,lb,my,bo,tl,mg,as,tt,haw,ln,ha,ba,jw,su'.split(',');
const NON_SPEECH = [1, 2, 7, 8, 9, 10, 14, 25, 26, 27, 28, 29, 31, 58, 59, 60, 61, 62, 63, 90, 91, 92, 93, 359, 503, 522, 542, 873, 893, 902, 918, 922, 931, 1350, 1853, 1982, 2460, 2627, 3246, 3253, 3268, 3536, 3846, 3961, 4183, 4667, 6585, 6647, 7273, 9061, 9383, 10428, 10929, 11938, 12033, 12331, 12562, 13793, 14157, 14635, 15265, 15618, 16553, 16604, 18362, 18956, 20075, 21675, 22520, 26130, 26161, 26435, 28279, 29464, 31650, 32302, 32470, 36865, 42863, 47425, 49870, 50254];
const SUPPRESS = NON_SPEECH.concat([TRANSCRIBE, TRANSLATE, SOT, SOT_PREV, SOT_LM, NO_SPEECH, NO_TIMESTAMPS]);

const aborted = () => new DOMException('Cancelled', 'AbortError');

// ------------------------------------------------------------------ log-mel spectrogram
let melBank = null, hann = null, cosT = null, sinT = null;
function hzToMel(f) { return f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27); }
function melToHz(m) { return m < 15 ? m * (200 / 3) : 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)); }
/** librosa.filters.mel(sr=16000, n_fft=400, n_mels=80) — slaney scale, slaney-normalised. Row-major [80 × 201]. */
export function melFilters() {
  if (melBank) return melBank;
  const pts = new Float64Array(N_MELS + 2), lo = hzToMel(0), hi = hzToMel(SAMPLE_RATE / 2);
  for (let i = 0; i < pts.length; i++) pts[i] = melToHz(lo + (hi - lo) * i / (N_MELS + 1));
  const bank = new Float32Array(N_MELS * N_BINS);
  for (let m = 0; m < N_MELS; m++) {
    const a = pts[m], b = pts[m + 1], c = pts[m + 2], norm = 2 / (c - a);
    for (let k = 0; k < N_BINS; k++) {
      const f = k * SAMPLE_RATE / N_FFT, w = Math.min((f - a) / (b - a), (c - f) / (c - b));
      if (w > 0) bank[m * N_BINS + k] = w * norm;
    }
  }
  return (melBank = bank);
}
function tables() {
  if (hann) return;
  hann = new Float64Array(N_FFT); cosT = new Float64Array(N_FFT); sinT = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) { hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N_FFT); cosT[i] = Math.cos(2 * Math.PI * i / N_FFT); sinT[i] = Math.sin(2 * Math.PI * i / N_FFT); }
}
/**
 * Whisper's log-mel features for the 30-second window that starts at `start` (in samples).
 * → Float32Array [80 × 3000] (row-major). Same maths as whisper.audio.log_mel_spectrogram:
 * centred frames, reflect padding at the very beginning, zeros past the end, log10, clamp to max − 8, (x + 4) / 4.
 * Samples from `end` on are treated as silence (a window never runs into the next block of speech).
 */
export function logMelWindow(audio, start = 0, end = audio.length) {
  tables();
  const bank = melFilters(), n = Math.min(end, audio.length);
  const out = new Float32Array(N_MELS * N_FRAMES), fr = new Float64Array(N_FFT), pw = new Float64Array(N_BINS);
  // a 400-point real DFT folded twice (x[n] ± x[400−n], then n ↔ 200−n): ~40k multiply-adds per frame
  const ee = new Float64Array(100), eo = new Float64Array(100), oe = new Float64Array(100), oo = new Float64Array(100);
  // sparse mel rows (each filter touches only a few bins)
  const first = new Int32Array(N_MELS), last = new Int32Array(N_MELS);
  for (let m = 0; m < N_MELS; m++) { let a = -1, b = -1; for (let k = 0; k < N_BINS; k++) if (bank[m * N_BINS + k] > 0) { if (a < 0) a = k; b = k; } first[m] = a < 0 ? 0 : a; last[m] = b; }
  let gmax = -Infinity;
  for (let t = 0; t < N_FRAMES; t++) {
    const c0 = start + t * HOP - N_FFT / 2;
    let any = false;
    for (let i = 0; i < N_FFT; i++) {
      let j = c0 + i;
      if (j < 0) j = -j;                       // reflect (only at the start of the recording)
      const v = j < n ? audio[j] : 0;
      if (v !== 0) any = true;
      fr[i] = v * hann[i];
    }
    if (!any) { for (let m = 0; m < N_MELS; m++) out[m * N_FRAMES + t] = -10; if (gmax < -10) gmax = -10; continue; }
    const x0 = fr[0], x200 = fr[200], e100 = fr[100] + fr[300], o100 = fr[100] - fr[300];
    for (let i = 1; i < 100; i++) {
      const e1 = fr[i] + fr[400 - i], e2 = fr[200 - i] + fr[200 + i], o1 = fr[i] - fr[400 - i], o2 = fr[200 - i] - fr[200 + i];
      ee[i] = e1 + e2; eo[i] = e1 - e2; oe[i] = o1 - o2; oo[i] = o1 + o2;
    }
    for (let k = 0; k < N_BINS; k++) {
      const odd = k & 1, E = odd ? eo : ee, O = odd ? oo : oe;
      let re = x0 + (odd ? -x200 : x200), im = 0, idx = 0;
      for (let i = 1; i < 100; i++) { idx += k; if (idx >= N_FFT) idx -= N_FFT; re += E[i] * cosT[idx]; im += O[i] * sinT[idx]; }
      const q = k & 3;                          // n = 100: cos(πk/2), sin(πk/2)
      if (q === 0) re += e100; else if (q === 2) re -= e100; else if (q === 1) im += o100; else im -= o100;
      pw[k] = re * re + im * im;
    }
    for (let m = 0; m < N_MELS; m++) {
      let s = 0; const o = m * N_BINS;
      for (let k = first[m]; k <= last[m]; k++) s += bank[o + k] * pw[k];
      const l = Math.log10(s > 1e-10 ? s : 1e-10);
      out[m * N_FRAMES + t] = l; if (l > gmax) gmax = l;
    }
  }
  const floor = gmax - 8;
  for (let i = 0; i < out.length; i++) out[i] = ((out[i] > floor ? out[i] : floor) + 4) / 4;
  return out;
}

// ------------------------------------------------------------------ where the speech is
/**
 * Blocks of sound separated by real pauses (energy gate on 20 ms frames, relative to the loud parts).
 * → [{ start, end, voiced }] in samples / seconds of sound. Pauses shorter than `gap` seconds stay inside a block.
 * Each block is transcribed on its own: silence is never fed to the model (that is where it invents
 * text), and every block can have its own language. Audio with a constant bed of music or noise is one block.
 */
const VAD_FRAME = 320;
function frameRms(audio) {
  const F = VAD_FRAME, n = Math.floor(audio.length / F), rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; const o = i * F; for (let k = 0; k < F; k++) s += audio[o + k] * audio[o + k]; rms[i] = Math.sqrt(s / F); }
  return rms;
}
/** The gate: 8 % of the level of the loud frames (95th percentile). 0 when the audio is silent. */
function gateLevel(rms) {
  if (rms.length < 5) return 0;
  const ref = Float32Array.from(rms).sort()[Math.floor(rms.length * 0.95)];
  return ref > 1e-4 ? ref * 0.08 : 0;
}
export function speechBlocks(audio, { gap = 2.0 } = {}, rms = frameRms(audio)) {
  const F = VAD_FRAME, n = rms.length, thr = gateLevel(rms);
  if (!thr) return [];
  const gapF = Math.round(gap * SAMPLE_RATE / F), out = [];
  let a = -1, last = -1, voiced = 0;
  const close = () => { if (a >= 0 && voiced >= 8) out.push({ start: Math.max(0, a - 10) * F, end: Math.min(n, last + 16) * F, voiced: voiced * F / SAMPLE_RATE }); a = -1; voiced = 0; };
  for (let i = 0; i < n; i++) {
    if (rms[i] <= thr) continue;
    if (a >= 0 && i - last > gapF) close();
    if (a < 0) a = i;
    last = i; voiced++;
  }
  close();
  for (let i = 0; i + 1 < out.length; i++) if (out[i].end > out[i + 1].start) out[i].end = out[i + 1].start;
  return out;
}
/** The longest pause (≥ 0.36 s) between frames a and b → its middle frame, or −1. */
function longestPause(rms, thr, a, b) {
  let best = -1, bestLen = 17, run = 0;
  for (let i = Math.max(0, a); i < Math.min(rms.length, b); i++) {
    if (rms[i] <= thr) { run++; if (run > bestLen) { bestLen = run; best = i - (run >> 1); } } else run = 0;
  }
  return best;
}
const voicedSeconds = (rms, thr, a, b) => { let c = 0; for (let i = Math.max(0, a); i < Math.min(rms.length, b); i++) if (rms[i] > thr) c++; return c * VAD_FRAME / SAMPLE_RATE; };

// ------------------------------------------------------------------ vocabulary
/** tokens.txt → Array<Uint8Array> (each line: base64(token bytes) + space + id). */
export function parseTokens(text) {
  const out = new Array(N_VOCAB);
  for (const line of text.split('\n')) {
    const sp = line.lastIndexOf(' '); if (sp <= 0) continue;
    const id = parseInt(line.slice(sp + 1), 10); if (!(id >= 0 && id < EOT)) continue; // special tokens are never text
    let bin; try { bin = atob(line.slice(0, sp)); } catch (e) { continue; }
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    out[id] = b;
  }
  return out;
}
const utf8 = new TextDecoder('utf-8');
function tokensToText(vocab, toks) {
  let n = 0; const parts = [];
  for (const t of toks) { if (t >= EOT) continue; const b = vocab[t]; if (b) { parts.push(b); n += b.length; } }
  const buf = new Uint8Array(n); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  return utf8.decode(buf).replace(/�/g, '');
}

// ------------------------------------------------------------------ decoding
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** log-softmax in place over lg[0 … n); returns nothing. −Infinity entries stay −Infinity. */
function logSoftmax(lg, n) {
  let mx = -Infinity; for (let i = 0; i < n; i++) if (lg[i] > mx) mx = lg[i];
  let s = 0; for (let i = 0; i < n; i++) s += Math.exp(lg[i] - mx);
  const z = mx + Math.log(s);
  for (let i = 0; i < n; i++) lg[i] -= z;
}
/** A decoded window that keeps repeating itself (few distinct token trigrams) is a hallucination loop. */
function looksRepetitive(text) {
  if (text.length < 24) return false;
  const seen = new Set();
  for (let i = 0; i + 2 < text.length; i++) seen.add(text[i] * 4294967296 + text[i + 1] * 65536 + text[i + 2]);
  return seen.size / (text.length - 2) < 0.45;
}
/** Segments that are only a sound annotation ("[Music]", "(applause)", "♪ ♪") are not captions. */
const NOISE_ONLY = /^[\s♪♫*.\-–—…]*$|^[\[(（【*][^\])）】]{0,40}[\])）】*]$/;

export class WhisperDecoder {
  constructor(ort, encoder, decoder, vocab, spec) {
    this.ort = ort; this.enc = encoder; this.dec = decoder; this.vocab = vocab; this.spec = spec;
    this.lp = new Float64Array(N_VOCAB);
  }
  emptyCache() { return new this.ort.Tensor('float32', new Float32Array(this.spec.layers * N_TEXT_CTX * this.spec.state), [this.spec.layers, 1, N_TEXT_CTX, this.spec.state]); }
  async encode(mel) {
    const r = await this.enc.run({ mel: new this.ort.Tensor('float32', mel, [1, N_MELS, N_FRAMES]) });
    return { k: r.n_layer_cross_k, v: r.n_layer_cross_v };
  }
  async step(tokens, k, v, cross, offset) {
    const O = this.ort;
    return this.dec.run({
      tokens: new O.Tensor('int64', BigInt64Array.from(tokens, (t) => BigInt(t)), [1, tokens.length]),
      in_n_layer_self_k_cache: k, in_n_layer_self_v_cache: v, n_layer_cross_k: cross.k, n_layer_cross_v: cross.v,
      offset: new O.Tensor('int64', BigInt64Array.from([BigInt(offset)]), [1]),
    });
  }
  /** Most likely spoken language of an encoded window → { code: 'en' | 'ar' | …, prob } (probability among the languages). */
  async detectLanguage(cross) {
    const r = await this.step([SOT], this.emptyCache(), this.emptyCache(), cross, 0), lg = r.logits.data;
    let best = 0, bv = -Infinity;
    for (let i = 0; i < STT_LANG_CODES.length; i++) { const x = lg[LANG0 + i]; if (x > bv) { bv = x; best = i; } }
    let z = 0; for (let i = 0; i < STT_LANG_CODES.length; i++) z += Math.exp(lg[LANG0 + i] - bv);
    return { code: STT_LANG_CODES[best], prob: 1 / z };
  }
  /** Greedy (temp 0) or sampled decode of one encoded window → { tokens, avgLogProb, noSpeech }. */
  async decodeWindow(cross, lang, temp, rng, check, onTokens) {
    const init = [SOT, LANG0 + Math.max(0, STT_LANG_CODES.indexOf(lang)), TRANSCRIBE], lp = this.lp, maxLen = N_TEXT_CTX / 2;
    let r = await this.step(init, this.emptyCache(), this.emptyCache(), cross, 0);
    let data = r.logits.data;
    // P(no speech) is read at the start-of-transcript position
    for (let i = 0; i < N_VOCAB; i++) lp[i] = data[i];
    logSoftmax(lp, N_VOCAB);
    const noSpeech = Math.exp(lp[NO_SPEECH]);
    const toks = [], text = []; let sum = 0, offset = init.length, lastTs = -1, base = (init.length - 1) * N_VOCAB, looped = false;
    for (;;) {
      check();
      for (let i = 0; i < N_VOCAB; i++) lp[i] = data[base + i];
      for (const t of SUPPRESS) lp[t] = -Infinity;
      const n = toks.length;
      if (!n) { lp[BLANK] = -Infinity; lp[EOT] = -Infinity; }
      // Whisper's timestamp rules: timestamps come in pairs, never go backwards, and the first token is one (≤ 1 s)
      const last = n >= 1 && toks[n - 1] >= TS0, pen = n < 2 || toks[n - 2] >= TS0;
      if (last) { if (pen) lp.fill(-Infinity, TS0); else lp.fill(-Infinity, 0, EOT); }
      if (lastTs >= 0) lp.fill(-Infinity, TS0, (last && !pen) ? lastTs : lastTs + 1);
      if (!n) { lp.fill(-Infinity, 0, TS0); lp.fill(-Infinity, TS0 + 51); }
      logSoftmax(lp, N_VOCAB);
      let tsMax = -Infinity, txMax = -Infinity;
      for (let i = TS0; i < N_VOCAB; i++) if (lp[i] > tsMax) tsMax = lp[i];
      for (let i = 0; i < TS0; i++) if (lp[i] > txMax) txMax = lp[i];
      if (tsMax > -Infinity) {
        let s = 0; for (let i = TS0; i < N_VOCAB; i++) s += Math.exp(lp[i] - tsMax);
        if (tsMax + Math.log(s) > txMax) { lp.fill(-Infinity, 0, TS0); logSoftmax(lp, N_VOCAB); }
      }
      let next = 0;
      if (!temp) { let bv = -Infinity; for (let i = 0; i < N_VOCAB; i++) if (lp[i] > bv) { bv = lp[i]; next = i; } }
      else {
        // sample from softmax(logits / temp)
        let mx = -Infinity; for (let i = 0; i < N_VOCAB; i++) if (lp[i] > mx) mx = lp[i];
        let z = 0; for (let i = 0; i < N_VOCAB; i++) if (lp[i] > -Infinity) z += Math.exp((lp[i] - mx) / temp);
        let u = rng() * z; next = EOT;
        for (let i = 0; i < N_VOCAB; i++) if (lp[i] > -Infinity) { u -= Math.exp((lp[i] - mx) / temp); if (u <= 0) { next = i; break; } }
      }
      sum += lp[next];
      if (next === EOT || toks.length >= maxLen) break;
      toks.push(next); if (next >= TS0) lastTs = next; else text.push(next);
      if (text.length >= 32 && text.length % 8 === 0 && looksRepetitive(text.slice(-48))) { looped = true; break; }  // stuck in a loop: stop paying for it
      if (onTokens && toks.length % 4 === 0) onTokens(toks, lastTs);
      r = await this.step([next], r.out_n_layer_self_k_cache, r.out_n_layer_self_v_cache, cross, offset++);
      data = r.logits.data; base = 0;
    }
    return { tokens: toks, avgLogProb: sum / (toks.length + 1), noSpeech, looped: looped || looksRepetitive(text) };
  }

  /**
   * Transcribe mono 16 kHz audio. → { segments: [{ start, end, text }], language }
   * onWindow({ processed, total, segments, partial? }) while decoding and after every window; check() throws to cancel.
   * language 'auto': each block of speech is identified on its own (a short or unclear block reuses the last clear answer).
   */
  async transcribe(audio, { language = 'auto', onWindow = () => {}, check = () => {} } = {}) {
    const dur = audio.length / SAMPLE_RATE, segs = [], rng = mulberry32(1);
    const auto = STT_LANG_CODES.indexOf(language) < 0, heard = {};
    let sure = null;
    const rms = frameRms(audio), gate = gateLevel(rms), queue = speechBlocks(audio, {}, rms).map((b) => ({ ...b, depth: 0 }));
    while (queue.length) {
      const blk = queue.shift();
      const blkEnd = Math.floor(blk.end / HOP), blkEndT = blk.end / SAMPLE_RATE;
      let seek = Math.floor(blk.start / HOP), lang = auto ? null : language;
      const emit = (a, b, toks) => {
        const text = tokensToText(this.vocab, toks).replace(/\s+/g, ' ').trim();
        b = Math.min(b, blkEndT);
        if (!text || !(b > a) || NOISE_ONLY.test(text)) return;
        const prev = segs[segs.length - 1];
        if (prev && prev.text === text && a - prev.end < 0.2) { prev.end = b; return; } // identical neighbour = stutter loop
        segs.push({ start: Math.round(a * 100) / 100, end: Math.round(b * 100) / 100, text });
        heard[lang] = (heard[lang] || 0) + (b - a);
      };
      while (blkEnd - seek > 5) {
        check();
        const s0 = seek * HOP, offs = s0 / SAMPLE_RATE, segSize = Math.min(N_FRAMES, blkEnd - seek), before = segs.length;
        const cross = await this.encode(logMelWindow(audio, s0, blk.end));
        check();
        if (!lang) {
          if (sure && blk.voiced < (blk.depth ? 1 : 3)) lang = sure;
          else { const d = await this.detectLanguage(cross); lang = d.prob >= 0.5 || !sure ? d.code : sure; if (d.prob >= 0.5) sure = d.code; }
        }
        // while a window is being decoded: the words so far and how far the timestamps have got
        const partial = (toks, lastTs) => {
          let i = toks.length - 1; while (i >= 0 && toks[i] < TS0) i--;
          const text = tokensToText(this.vocab, toks.slice(i + 1)).replace(/\s+/g, ' ').trim();
          onWindow({ processed: Math.min(dur, offs + (lastTs >= TS0 ? Math.min(29.5, (lastTs - TS0) * 0.02) : 0)), total: dur, segments: [], partial: text, language: lang });
        };
        let res = null, split = false;
        for (const temp of [0, 0.4, 0.8]) {
          res = await this.decodeWindow(cross, lang, temp, rng, check, temp ? null : partial);
          // retry warmer only when the result looks wrong — and not when the model says "no speech" (Whisper's rule)
          if (!(res.avgLogProb < -1 || res.looped) || res.noSpeech > 0.6) break;
          if (!temp && auto && blk.depth < 3) {
            // automatic language and the window came out wrong: it may hold two languages (Whisper takes one per
            // window). Cut the block at its longest pause and let each side be identified on its own.
            const f0 = Math.round(s0 / VAD_FRAME), f1 = Math.round(Math.min(blk.end, s0 + N_FRAMES * HOP) / VAD_FRAME), cut = longestPause(rms, gate, f0 + 50, f1 - 50);
            if (cut > 0) {
              const fe = Math.round(blk.end / VAD_FRAME);
              queue.unshift({ start: s0, end: cut * VAD_FRAME, voiced: voicedSeconds(rms, gate, f0, cut), depth: blk.depth + 1 }, { start: cut * VAD_FRAME, end: blk.end, voiced: voicedSeconds(rms, gate, cut, fe), depth: blk.depth + 1 });
              split = true; break;
            }
          }
        }
        if (split) break;
        const toks = res.tokens, n = toks.length;
        if ((res.noSpeech > 0.6 && res.avgLogProb < -1) || res.looped) seek += segSize;   // nothing said here, or still a loop after every retry
        else {
          const isT = (i) => toks[i] >= TS0;
          const single = (n >= 2 && !isT(n - 2) && isT(n - 1)) || (n === 1 && isT(0));
          const cons = []; for (let i = 1; i < n; i++) if (isT(i) && isT(i - 1)) cons.push(i);
          if (cons.length) {
            if (single) cons.push(n);
            let lastSl = 0;
            for (const c of cons) { const sl = toks.slice(lastSl, c); emit(offs + (sl[0] - TS0) * 0.02, offs + (sl[sl.length - 1] - TS0) * 0.02, sl); lastSl = c; }
            seek += single ? segSize : Math.max(1, (toks[lastSl - 1] - TS0) * 2);
          } else {
            let d = segSize * HOP / SAMPLE_RATE;
            const ts = toks.filter((t) => t >= TS0);
            if (ts.length && ts[ts.length - 1] !== TS0) d = (ts[ts.length - 1] - TS0) * 0.02;
            emit(offs, offs + d, toks); seek += segSize;
          }
        }
        onWindow({ processed: Math.min(dur, Math.min(seek, blkEnd) * HOP / SAMPLE_RATE), total: dur, segments: segs.slice(before), language: lang });
      }
    }
    onWindow({ processed: dur, total: dur, segments: [], language: sure });
    // the language most of the captions are in
    let top = null; for (const k of Object.keys(heard)) if (top === null || heard[k] > heard[top]) top = k;
    return { segments: segs, language: top || (auto ? sure : language) };
  }
}

// ------------------------------------------------------------------ runtime (model loading + jobs)
export class SttRuntime {
  constructor() { this.loaded = new Map(); this.vocabP = null; }
  /** Fetch / cache / compile one model. onProgress(fraction | null, label). */
  load(modelId, onProgress = () => {}, signal = null) {
    const spec = STT_MODELS[modelId]; if (!spec) return Promise.reject(new Error('Unknown speech model'));
    if (!this.loaded.has(modelId)) {
      const p = (async () => {
        const ort = await loadOrt();
        if (!this.vocabP) this.vocabP = fetchModelBytes(STT_TOKENS, { signal }).then((b) => parseTokens(new TextDecoder().decode(b))).catch((e) => { this.vocabP = null; throw e; });
        const vocab = await this.vocabP;
        const total = spec.encoder.bytes + spec.decoder.bytes;
        const label = `Loading the speech model (${spec.size}, first time only)…`;
        const encBytes = await fetchModelBytes(spec.encoder, { signal, onProgress: (f) => onProgress(f * spec.encoder.bytes / total, label) });
        const decBytes = await fetchModelBytes(spec.decoder, { signal, onProgress: (f) => onProgress((spec.encoder.bytes + f * spec.decoder.bytes) / total, label) });
        if (signal && signal.aborted) throw aborted();
        onProgress(null, 'Preparing the speech model…');
        const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
        const enc = await ort.InferenceSession.create(encBytes, opt);
        const dec = await ort.InferenceSession.create(decBytes, opt);
        return new WhisperDecoder(ort, enc, dec, vocab, spec);
      })();
      this.loaded.set(modelId, p);
      p.catch(() => this.loaded.delete(modelId));
    }
    return this.loaded.get(modelId);
  }
  async release() {
    for (const p of this.loaded.values()) { try { const d = await p; await d.enc.release?.(); await d.dec.release?.(); } catch (e) { /* ignore */ } }
    this.loaded.clear();
  }
}
