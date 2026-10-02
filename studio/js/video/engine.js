// EYAD VIDEO — playback & compositing engine (browser media APIs + Web Audio + WebGL).
// Per clip and frame: keyframed transform/opacity/crop/blur, GPU colour
// effects, transitions, generated titles/shapes, adjustment layers, AI auto mask and
// per-clip audio effects (EQ, compressor, pan) — identical in preview and export.
import { clipEnd, clipDur, srcTime, seqDuration, mediaById, trackById, dbToGain } from './model.js';
import { effectState, canvasFilterSupported, CROSS } from './effects.js';
import { resolve, valueAt } from './anim.js';
import { drawGen } from './gen.js';
import { glProcess } from './gl.js';
import { createLiveRenderer, lookByCode } from '../core/film.js';
import { getAudioContext } from './media.js';
import { perfLevel } from '../core/settings.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Engine {
  constructor(app) {
    this.app = app;
    this.time = 0;
    this.playing = false;
    this.rate = 1;
    this.loop = false;
    this.volume = 1;
    this.muted = false;
    this.els = new Map(); // clipId:kind -> { el, kind, mediaId, src, gain, lastUse }
    this.listeners = new Set();
    this.canvas = null;
    this.ctx = null;
    this.raf = 0;
    this.last = 0;
    this.exporting = null;
    this.filterOK = canvasFilterSupported();
    this.needsRender = true;
    this.work = document.createElement('canvas');
    this.ai = { seg: null, loading: false, failed: false };
    this.pvScale = 1; // preview working-resolution factor for effects (see render)
    this.loopTick = this.loopTick.bind(this);
    this.raf = requestAnimationFrame(this.loopTick);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.playing && !this.exporting) this.pause(); });
  }

  get seq() { return this.app.seq; }
  get project() { return this.app.project; }
  get duration() { return this.seq ? seqDuration(this.seq) : 0; }
  get fps() { return this.seq ? this.seq.fps : 30; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind) { for (const fn of this.listeners) fn(kind, this); }

  setCanvas(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.invalidate(); }
  invalidate() { this.needsRender = true; }

  // ------------------------------------------------------------ audio graph
  ensureAudio() {
    if (this.actx) return this.actx;
    const ctx = getAudioContext();
    if (!ctx) return null;
    this.actx = ctx;
    this.master = ctx.createGain();
    this.analyser = ctx.createChannelSplitter ? ctx.createChannelSplitter(2) : null;
    this.master.connect(ctx.destination);
    try {
      this.meterL = ctx.createAnalyser(); this.meterR = ctx.createAnalyser();
      this.meterL.fftSize = this.meterR.fftSize = 512;
      this.master.connect(this.analyser); this.analyser.connect(this.meterL, 0); this.analyser.connect(this.meterR, 1);
    } catch (e) { this.meterL = this.meterR = null; }
    this.applyMaster();
    return ctx;
  }
  applyMaster() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }
  setVolume(v) { this.volume = v; this.applyMaster(); }
  setMuted(m) { this.muted = m; this.applyMaster(); }
  /** Peak levels (0..1) for the L/R meters. */
  levels() {
    if (!this.meterL) return [0, 0];
    const buf = new Float32Array(this.meterL.fftSize);
    const peak = (an) => { an.getFloatTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); return m; };
    return [peak(this.meterL), peak(this.meterR)];
  }

  // ------------------------------------------------------------ transport
  play() {
    if (!this.seq) return;
    if (this.duration <= 0) return;
    const end = this.rangeEnd();
    if (this.time >= end - 1 / this.fps) this.time = this.rangeStart();
    const ctx = this.ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (this.rate < 0) this.rate = 1;
    this.playing = true;
    this.last = performance.now();
    this.emit('play');
  }
  pause() {
    this.playing = false;
    if (this.rate !== 1 && Math.abs(this.rate) !== 1) this.rate = 1;
    for (const r of this.els.values()) if (!r.el.paused) r.el.pause();
    this.emit('pause');
    this.invalidate();
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  rangeStart() { const s = this.seq; return this.loop && s.inPoint != null ? s.inPoint : 0; }
  rangeEnd() { const s = this.seq; const d = this.duration; return this.loop && s.outPoint != null ? Math.min(d, s.outPoint) : d; }

  seek(t) {
    const d = Math.max(this.duration, 0);
    this.time = Math.max(0, Math.min(d, t));
    this.invalidate();
    this.emit('time');
  }
  step(frames) { this.pause(); this.seek(Math.round(this.time * this.fps + frames) / this.fps); }

  /** J/K/L shuttle */
  shuttle(dir) {
    if (dir === 0) { this.rate = 1; this.pause(); return; }
    if (dir > 0) {
      if (!this.playing || this.rate < 0) { this.rate = 1; this.play(); }
      else this.rate = Math.min(8, this.rate * 2);
    } else {
      this.rate = this.playing && this.rate < 0 ? Math.max(-8, this.rate * 2) : -1;
      this.playing = true; this.last = performance.now();
      for (const r of this.els.values()) if (!r.el.paused) r.el.pause();
    }
    this.emit('rate');
  }

  // ------------------------------------------------------------ main loop
  loopTick(now) {
    this.raf = requestAnimationFrame(this.loopTick);
    if (!this.seq) return;
    if (this.playing) {
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      let t = this.time + dt * this.rate;
      const start = this.rangeStart(), end = this.rangeEnd();
      if (this.rate > 0 && t >= end) {
        if (this.loop && !this.exporting) t = start;
        else { t = end; this.time = t; this.sync(); this.render(); this.pause(); if (this.exporting) this.exporting.finish(); this.emit('time'); return; }
      }
      if (this.rate < 0 && t <= 0) { t = 0; this.time = 0; this.pause(); this.emit('time'); return; }
      if (this.exporting && t >= this.exporting.to) { this.time = this.exporting.to; this.sync(); this.render(); this.exporting.finish(); return; }
      this.time = t;
      this.sync();
      this.render();
      this.emit('time');
      if (this.exporting) this.exporting.progress(this.time);
    } else if (this.needsRender) {
      this.sync();
      this.render();
    }
  }

  /** Clips visible/audible at t, bottom track first. Cross transitions add the outgoing clip as a "tail". */
  activeClips(t, kind) {
    const s = this.seq;
    const out = [];
    for (const tr of s.tracks) {
      if (tr.kind !== kind) continue;
      if (kind === 'video' && tr.hidden) continue;
      const onTrack = s.clips.filter((c) => c.trackId === tr.id && c.enabled !== false);
      for (const c of onTrack) {
        if (t >= c.start && t < clipEnd(c)) {
          const ti = c.transIn;
          if (kind === 'video' && ti && CROSS.has(ti.type) && t - c.start < ti.dur) {
            const prev = onTrack.find((p) => p !== c && Math.abs(clipEnd(p) - c.start) < 1 / this.fps + 1e-3);
            if (prev) out.push({ c: prev, tr, tail: { of: c, p: (t - c.start) / ti.dur } });
          }
          out.push({ c, tr });
        }
      }
    }
    return out;
  }

  ensureEl(c, kind) {
    let r = this.els.get(c.id + ':' + kind);
    const url = this.app.media.urlFor(c.mediaId);
    if (!url) return null;
    if (r && r.src !== url) { this.releaseEl(c.id + ':' + kind); r = null; }
    if (!r) {
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      el.preload = 'auto'; el.playsInline = true; el.setAttribute('playsinline', '');
      el.muted = kind === 'video';
      el.crossOrigin = 'anonymous';
      el.src = url;
      el.addEventListener('seeked', () => this.invalidate());
      el.addEventListener('loadeddata', () => this.invalidate());
      el.addEventListener('error', () => { r.error = el.error; this.invalidate(); });
      r = { el, kind, src: url, mediaId: c.mediaId, gain: null, source: null, lastUse: performance.now() };
      if (kind === 'audio') {
        const ctx = this.ensureAudio();
        if (ctx) {
          try {
            r.source = ctx.createMediaElementSource(el);
            // per-clip chain: EQ (low/mid/high) → compressor → pan → gain
            r.low = ctx.createBiquadFilter(); r.low.type = 'lowshelf'; r.low.frequency.value = 180;
            r.mid = ctx.createBiquadFilter(); r.mid.type = 'peaking'; r.mid.frequency.value = 1400; r.mid.Q.value = 0.9;
            r.high = ctx.createBiquadFilter(); r.high.type = 'highshelf'; r.high.frequency.value = 6000;
            r.comp = ctx.createDynamicsCompressor();
            r.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
            r.gain = ctx.createGain();
            let node = r.source.connect(r.low).connect(r.mid).connect(r.high).connect(r.comp);
            if (r.pan) node = node.connect(r.pan);
            node.connect(r.gain).connect(this.master);
            if (this.exportDest) r.gain.connect(this.exportDest);
          } catch (e) { r.gain = null; }
        }
      }
      this.els.set(c.id + ':' + kind, r);
    }
    r.lastUse = performance.now();
    return r;
  }
  releaseEl(key) {
    const r = this.els.get(key); if (!r) return;
    try { r.el.pause(); r.el.removeAttribute('src'); r.el.load(); } catch (e) { /* ignore */ }
    try { for (const n of [r.source, r.low, r.mid, r.high, r.comp, r.pan, r.gain]) n && n.disconnect(); } catch (e) { /* ignore */ }
    this.els.delete(key);
  }
  releaseAll() { for (const k of Array.from(this.els.keys())) this.releaseEl(k); }

  applyAudioFx(r, c) {
    const fx = c.audioFx || {};
    const set = (p, v) => { if (p && Math.abs(p.value - v) > 1e-4) p.value = v; };
    if (r.low) { set(r.low.gain, fx.low || 0); set(r.mid.gain, fx.mid || 0); set(r.high.gain, fx.high || 0); }
    if (r.comp) {
      const on = !!fx.comp;
      set(r.comp.threshold, on ? (fx.threshold ?? -24) : 0); set(r.comp.ratio, on ? (fx.ratio ?? 4) : 1);
      set(r.comp.knee, on ? 12 : 0); set(r.comp.attack, 0.005); set(r.comp.release, 0.2);
    }
    if (r.pan) set(r.pan.pan, (fx.pan || 0) / 100);
  }

  sync() {
    const s = this.seq; if (!s) return;
    const t = this.time;
    const playing = this.playing && this.rate > 0;
    const live = new Set();
    const tol = playing ? 0.3 : 0.5 / this.fps;
    const syncEl = (r, c) => {
      const el = r.el;
      const want = srcTime(c, t);
      const rate = (c.speed || 1) * (playing ? this.rate : 1);
      if (playing) {
        if (Math.abs(el.playbackRate - rate) > 1e-3) { try { el.playbackRate = rate; } catch (e) { /* unsupported rate */ } }
        if (el.paused) { if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want; el.play().catch(() => {}); }
        else if (Math.abs(el.currentTime - want) > tol) el.currentTime = want;
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - want) > tol) el.currentTime = want;
      }
    };
    // video
    for (const { c } of this.activeClips(t, 'video')) {
      if (c.gen) continue;
      const m = mediaById(this.project, c.mediaId);
      if (!m || m.kind !== 'video' || m.offline) continue;
      const r = this.ensureEl(c, 'video'); if (!r) continue;
      live.add(c.id + ':video');
      syncEl(r, c);
    }
    // audio
    const anySolo = s.tracks.some((tr) => tr.kind === 'audio' && tr.solo);
    for (const { c, tr } of this.activeClips(t, 'audio')) {
      if (c.gen) continue;
      const m = mediaById(this.project, c.mediaId);
      if (!m || m.offline || m.kind === 'image') continue;
      const r = this.ensureEl(c, 'audio'); if (!r) continue;
      live.add(c.id + ':audio');
      const audible = !tr.mute && !c.muted && (!anySolo || tr.solo);
      const vol = valueAt(c, 'volume', t - c.start, c.volume);
      const g = audible ? dbToGain(vol) * dbToGain(tr.volume) * this.fadeAt(c, t) : 0;
      if (r.gain) { r.gain.gain.value = g; this.applyAudioFx(r, c); } else { r.el.volume = Math.max(0, Math.min(1, g * (this.muted ? 0 : this.volume))); }
      syncEl(r, c);
    }
    // pre-roll upcoming clips while playing, pause/release everything else
    if (playing) {
      for (const c of s.clips) {
        if (c.gen) continue;
        if (c.start > t && c.start - t < 1.5) {
          const m = mediaById(this.project, c.mediaId);
          if (!m || m.offline || m.kind === 'image') continue;
          const tr = trackById(s, c.trackId);
          const kind = tr.kind === 'audio' ? 'audio' : 'video';
          if (kind === 'video' && m.kind !== 'video') continue;
          const r = this.ensureEl(c, kind);
          if (r) { live.add(c.id + ':' + kind); if (!r.el.paused) r.el.pause(); if (Math.abs(r.el.currentTime - c.in) > 0.1 && !r.el.seeking) r.el.currentTime = c.in; }
        }
      }
    }
    const now = performance.now();
    for (const [k, r] of this.els) {
      if (live.has(k)) continue;
      if (!r.el.paused) r.el.pause();
      if (now - r.lastUse > 20000 || !s.clips.some((c) => k.startsWith(c.id + ':'))) this.releaseEl(k);
    }
  }

  fadeAt(c, t) {
    const local = t - c.start, dur = clipDur(c);
    let a = 1;
    if (c.fadeIn > 0 && local < c.fadeIn) a = Math.max(0, local / c.fadeIn);
    if (c.fadeOut > 0 && dur - local < c.fadeOut) a = Math.min(a, Math.max(0, (dur - local) / c.fadeOut));
    return a;
  }

  /** True when every visible video clip at time t has a decoded frame. */
  framesReady(t) {
    for (const { c } of this.activeClips(t, 'video')) {
      if (c.gen) continue;
      const m = mediaById(this.project, c.mediaId);
      if (!m || m.offline || m.kind !== 'video') continue;
      const r = this.els.get(c.id + ':video');
      if (!r || r.error) continue;
      if (r.el.readyState < 2 || r.el.seeking) return false;
    }
    return true;
  }

  render(target) {
    const ctx = target ? target.getContext('2d') : this.ctx;
    const cv = target || this.canvas;
    if (!ctx || !this.seq) return;
    if (!target && !this.playing && !this.framesReady(this.time)) {
      if (!this._waitSince) this._waitSince = performance.now();
      if (performance.now() - this._waitSince < 1500) return;
    }
    this._waitSince = 0;
    this.needsRender = false;
    // adaptive preview: while playing, heavy effect stacks drop their working resolution instead of
    // dropping frames; a paused frame (and every exported frame) is always rendered at full quality
    const t0 = performance.now();
    this.drawFrame(ctx, cv.width, cv.height, this.time);
    if (!target) {
      const ms = performance.now() - t0;
      if (this.playing) { if (ms > 45 && this.pvScale > 0.3) this.pvScale = Math.max(0.3, this.pvScale * 0.8); else if (ms < 18 && this.pvScale < 1) this.pvScale = Math.min(1, this.pvScale * 1.1); }
      else if (this.pvScale !== 1) { this.pvScale = 1; this.needsRender = true; }
    }
    if (!target && this.exporting && this.exporting.canvas) this.drawFrame(this.exporting.canvas.getContext('2d'), this.exporting.canvas.width, this.exporting.canvas.height, this.time, true);
    if (!target && this.app.onFrame) this.app.onFrame();
  }

  // ------------------------------------------------------------ transitions
  transitionFx(c, t, tail) {
    // returns { alpha, dx, dy, scale, blur, rot, sx:{s,ax}, clip: fn(ctx,W,H)|null, clipRule, mask: fn(ctx,W,H)|null,
    //           smear:{n,dx,dy,ds,dr}, gl:{uniform overrides}, overlay:{color|kind,a} }
    const fx = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, rot: 0, sx: null, clip: null, clipRule: 'nonzero', mask: null, smear: null, gl: null, overlay: null };
    const W = this.seq.width, H = this.seq.height;
    const whip = (p) => (p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2); // very fast in the middle
    const bump = (p) => Math.sin(Math.PI * p);
    const step = (p, n, salt) => { const x = Math.sin((Math.floor(p * n) + salt) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    if (tail) {
      // outgoing clip under a cross transition
      const p = clamp01(tail.p), e = p * p * (3 - 2 * p), ty = tail.of.transIn.type;
      switch (ty) {
        case 'pushLeft': fx.dx = -W * e; break;
        case 'pushRight': fx.dx = W * e; break;
        case 'pushUp': fx.dy = -H * e; break;
        case 'pushDown': fx.dy = H * e; break;
        case 'zoomIn': fx.scale = 1 + p * 0.3; fx.alpha = 1 - p; break;
        case 'blurT': fx.blur = p * 30; break;
        case 'whipLeft': fx.dx = -W * whip(p); fx.smear = { n: 14, dx: W * 0.38 * bump(p), dy: 0, ds: 0, dr: 0 }; break;
        case 'whipRight': fx.dx = W * whip(p); fx.smear = { n: 14, dx: W * 0.38 * bump(p), dy: 0, ds: 0, dr: 0 }; break;
        case 'spin': fx.rot = whip(p) * Math.PI * 0.75; fx.scale = 1 + 0.6 * bump(p); fx.alpha = 1 - p; fx.smear = { n: 6, dx: 0, dy: 0, ds: 0, dr: 0.5 * bump(p) }; break;
        case 'zoomBlur': fx.scale = 1 + e * 0.9; fx.alpha = 1 - e; fx.smear = { n: 7, dx: 0, dy: 0, ds: 0.35 * bump(p), dr: 0 }; break;
        case 'glitchCut': fx.gl = { glitch: Math.min(1, p * 1.4), split: 0.02 * p }; break;
        case 'pixelT': fx.gl = { pix: 0.004 + e * 0.09 }; break;
        case 'squeeze': fx.sx = { s: 1 - e, ax: 0 }; break;
        default: break; // the incoming clip does the work
      }
      return fx;
    }
    const lt = t - c.start, D = clipDur(c);
    const ti = c.transIn, to = c.transOut;
    if (ti && lt < ti.dur) {
      const p = clamp01(lt / ti.dur), e = p * p * (3 - 2 * p);
      switch (ti.type) {
        case 'dissolve': fx.alpha *= p; break;
        case 'filmDissolve': fx.alpha *= Math.pow(p, 1.6); break;
        case 'dipBlack': fx.overlay = { color: '#000', a: 1 - p }; break;
        case 'dipWhite': fx.overlay = { color: '#fff', a: 1 - p }; break;
        case 'wipeLeft': fx.clip = (g, w, hh) => g.rect(w * (1 - e), 0, w * e, hh); break;
        case 'wipeRight': fx.clip = (g, w, hh) => g.rect(0, 0, w * e, hh); break;
        case 'wipeUp': fx.clip = (g, w, hh) => g.rect(0, hh * (1 - e), w, hh * e); break;
        case 'wipeDown': fx.clip = (g, w, hh) => g.rect(0, 0, w, hh * e); break;
        case 'pushLeft': fx.dx = W * (1 - e); break;
        case 'pushRight': fx.dx = -W * (1 - e); break;
        case 'pushUp': fx.dy = H * (1 - e); break;
        case 'pushDown': fx.dy = -H * (1 - e); break;
        case 'slideUp': fx.dy = H * (1 - e); break;
        case 'slideDown': fx.dy = -H * (1 - e); break;
        case 'slideLeft': fx.dx = W * (1 - e); break;
        case 'slideRight': fx.dx = -W * (1 - e); break;
        case 'zoomIn': fx.scale *= 0.7 + 0.3 * e; fx.alpha *= p; break;
        case 'zoomOut': fx.scale *= 1.4 - 0.4 * e; fx.alpha *= p; break;
        case 'blurT': fx.blur = (1 - e) * 30; fx.alpha *= Math.min(1, p * 2); break;
        case 'irisRound': fx.clip = (g, w, hh) => { g.arc(w / 2, hh / 2, Math.hypot(w, hh) / 2 * e, 0, Math.PI * 2); }; break;
        // ---- ready-to-use extras
        case 'flash': fx.overlay = { color: '#fff', a: Math.pow(1 - p, 1.5) }; break;
        case 'leakBurn': fx.alpha *= e; fx.overlay = { kind: 'leak', a: bump(p), p }; break;
        case 'lumaFade': fx.gl = { lumaIn: p }; break;
        case 'softWipeRight': case 'softWipeLeft': case 'softWipeDown': {
          const ty = ti.type;
          fx.mask = (g, w, hh) => {
            const L = ty === 'softWipeDown' ? hh : w, soft = L * 0.3, x1 = e * (L + soft), x0 = x1 - soft;
            const gr = ty === 'softWipeDown' ? g.createLinearGradient(0, x0, 0, x1) : ty === 'softWipeRight' ? g.createLinearGradient(x0, 0, x1, 0) : g.createLinearGradient(w - x0, 0, w - x1, 0);
            gr.addColorStop(0, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, hh);
          };
          break;
        }
        case 'circleOpen': fx.mask = (g, w, hh) => {
          const R = Math.hypot(w, hh) / 2 * 1.3 * e + 1, gr = g.createRadialGradient(w / 2, hh / 2, R * 0.7, w / 2, hh / 2, R);
          gr.addColorStop(0, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, hh);
        }; break;
        case 'circleClose': fx.clipRule = 'evenodd'; fx.clip = (g, w, hh) => { g.rect(0, 0, w, hh); g.arc(w / 2, hh / 2, Math.hypot(w, hh) / 2 * (1 - e), 0, Math.PI * 2); }; break;
        case 'squeeze': fx.sx = { s: e, ax: 1 }; break;
        case 'whipLeft': fx.dx = W * (1 - whip(p)); fx.smear = { n: 14, dx: W * 0.38 * bump(p), dy: 0, ds: 0, dr: 0 }; break;
        case 'whipRight': fx.dx = -W * (1 - whip(p)); fx.smear = { n: 14, dx: W * 0.38 * bump(p), dy: 0, ds: 0, dr: 0 }; break;
        case 'spin': fx.rot = -(1 - whip(p)) * Math.PI * 0.75; fx.scale *= 1 + 0.6 * bump(p); fx.alpha *= Math.min(1, p * 1.6); fx.smear = { n: 6, dx: 0, dy: 0, ds: 0, dr: 0.5 * bump(p) }; break;
        case 'zoomBlur': fx.scale *= 1.7 - 0.7 * e; fx.alpha *= e; fx.smear = { n: 7, dx: 0, dy: 0, ds: 0.35 * bump(p), dr: 0 }; break;
        case 'glitchCut': fx.alpha *= step(p, 9, 3) < p * 1.3 ? 1 : 0; fx.gl = { glitch: Math.min(1, (1 - p) * 1.4), split: 0.02 * (1 - p) }; break;
        case 'pixelT': fx.alpha *= clamp01((p - 0.35) / 0.3); fx.gl = { pix: 0.004 + (1 - e) * 0.09 }; break;
        default: break;
      }
    }
    if (to && D - lt < to.dur) {
      const p = clamp01((D - lt) / to.dur), e = p * p * (3 - 2 * p);
      switch (to.type) {
        case 'dipBlack': fx.overlay = { color: '#000', a: 1 - p }; break;
        case 'dipWhite': case 'flash': fx.overlay = { color: '#fff', a: 1 - p }; break;
        case 'zoomOut': fx.scale *= 1 + (1 - e) * 0.4; fx.alpha *= p; break;
        case 'zoomIn': fx.scale *= 0.7 + 0.3 * e; fx.alpha *= p; break;
        case 'blurT': fx.blur = Math.max(fx.blur, (1 - e) * 30); fx.alpha *= Math.min(1, p * 2); break;
        case 'wipeLeft': fx.clip = (g, w, hh) => g.rect(0, 0, w * e, hh); break;
        case 'wipeRight': fx.clip = (g, w, hh) => g.rect(w * (1 - e), 0, w * e, hh); break;
        case 'pushLeft': case 'slideLeft': case 'whipLeft': fx.dx = -W * (1 - e); break;
        case 'pushRight': case 'slideRight': case 'whipRight': fx.dx = W * (1 - e); break;
        case 'pushUp': case 'slideUp': fx.dy = -H * (1 - e); break;
        case 'pushDown': case 'slideDown': fx.dy = H * (1 - e); break;
        case 'glitchCut': fx.gl = { glitch: Math.min(1, (1 - p) * 1.4), split: 0.02 * (1 - p) }; fx.alpha *= Math.min(1, p * 3); break;
        case 'pixelT': fx.gl = { pix: 0.004 + (1 - e) * 0.09 }; fx.alpha *= Math.min(1, p * 3); break;
        case 'lumaFade': fx.gl = { lumaIn: p }; break;
        case 'spin': fx.rot = (1 - e) * Math.PI * 0.75; fx.scale *= e; fx.alpha *= p; break;
        default: fx.alpha *= p; break; // dissolve & others fade out to what's below
      }
    }
    return fx;
  }

  // ------------------------------------------------------------ AI auto mask (people)
  /**
   * Auto mask: segment people in the frame and return a canvas (sw×sh) for the chosen mode —
   * 0 remove background · 1 blur background · 2 background colour · 3 B&W background ·
   * 4 keep background only · 5 outline / sticker stroke. Null while the model is loading.
   */
  aiCut(src, sw, sh, params, key) {
    const a = this.ai;
    if (!a.seg && !a.loading && !a.failed) {
      a.loading = true;
      import('../core/ai.js').then((m) => m.videoSegmenter()).then((seg) => { a.seg = seg; a.loading = false; this.invalidate(); })
        .catch((e) => { a.failed = true; a.loading = false; a.error = e.message; this.app.onAIError && this.app.onAIError(e); });
    }
    if (!a.seg) return null;
    // preview + export canvas draw the same frame back to back: segment it once
    if (key && key === this._aiKey && this._aiOut && this._aiOut.width === sw) return this._aiOut;
    const cv = (name) => { const c = this[name] || (this[name] = document.createElement('canvas')); if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; } return c; };
    const S = 256, k = Math.min(1, S / Math.max(sw, sh));
    const w = Math.max(16, Math.round(sw * k)), hh = Math.max(16, Math.round(sh * k));
    const small = this._aiSmall || (this._aiSmall = document.createElement('canvas'));
    if (small.width !== w || small.height !== hh) { small.width = w; small.height = hh; }
    small.getContext('2d').drawImage(src, 0, 0, w, hh);
    let res;
    try { res = a.seg.segmentForVideo(small, performance.now()); } catch (e) { return null; }
    try {
      const m = res.confidenceMasks && res.confidenceMasks[0]; if (!m) return null;
      const f = m.getAsFloat32Array(), mw = m.width, mh = m.height;
      const mc = this._aiMask || (this._aiMask = document.createElement('canvas'));
      if (mc.width !== mw || mc.height !== mh) { mc.width = mw; mc.height = mh; }
      const g = mc.getContext('2d'), im = g.createImageData(mw, mh);
      const th = params.threshold / 100, soft = Math.max(0.02, params.feather / 250);
      for (let i = 0; i < f.length; i++) im.data[i * 4 + 3] = clamp01((f[i] - th) / soft + 0.5) * 255;
      g.putImageData(im, 0, 0);
      const mode = Math.round(params.mode || 0);
      // the person, cut out
      const person = cv('_aiPerson'), pg = person.getContext('2d');
      pg.globalCompositeOperation = 'source-over'; pg.clearRect(0, 0, sw, sh);
      pg.drawImage(src, 0, 0, sw, sh);
      pg.globalCompositeOperation = 'destination-in'; pg.imageSmoothingEnabled = true; pg.drawImage(mc, 0, 0, sw, sh);
      pg.globalCompositeOperation = 'source-over';
      this._aiKey = key;
      if (mode === 0) return (this._aiOut = person);
      const out = cv('_aiComp'), og = out.getContext('2d');
      og.globalCompositeOperation = 'source-over'; og.filter = 'none'; og.clearRect(0, 0, sw, sh);
      const big = Math.max(sw, sh), col = `hsl(${Math.round(params.hue ?? 140)}, 85%, ${Math.round(params.light ?? 50)}%)`;
      if (mode === 1) {
        const px = Math.max(1, (params.amount ?? 40) / 100 * 0.05 * big);
        if (this.filterOK) { og.filter = `blur(${px.toFixed(1)}px)`; og.drawImage(src, -px, -px, sw + px * 2, sh + px * 2); og.filter = 'none'; }
        else { // no canvas filters (iOS): blur by shrinking and stretching back
          const d = Math.max(4, Math.round(big / (px * 2))), tw = Math.max(2, Math.round(sw / big * d)), tH = Math.max(2, Math.round(sh / big * d));
          const tiny = this._aiTiny || (this._aiTiny = document.createElement('canvas')); tiny.width = tw; tiny.height = tH;
          tiny.getContext('2d').drawImage(src, 0, 0, tw, tH); og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high'; og.drawImage(tiny, 0, 0, tw, tH, 0, 0, sw, sh);
        }
        og.drawImage(person, 0, 0);
      } else if (mode === 2) { og.fillStyle = col; og.fillRect(0, 0, sw, sh); og.drawImage(person, 0, 0); }
      else if (mode === 3) {
        og.drawImage(src, 0, 0, sw, sh);
        og.globalCompositeOperation = 'saturation';
        if (og.globalCompositeOperation === 'saturation') { og.fillStyle = '#808080'; og.fillRect(0, 0, sw, sh); og.globalCompositeOperation = 'destination-in'; og.drawImage(src, 0, 0, sw, sh); og.globalCompositeOperation = 'source-over'; } // (destination-in keeps a transparent source transparent)
        else if (this.filterOK) { og.globalCompositeOperation = 'source-over'; og.filter = 'grayscale(1)'; og.drawImage(src, 0, 0, sw, sh); og.filter = 'none'; }
        og.drawImage(person, 0, 0);
      } else if (mode === 4) {
        og.drawImage(src, 0, 0, sw, sh);
        og.globalCompositeOperation = 'destination-out'; og.drawImage(mc, 0, 0, sw, sh); og.globalCompositeOperation = 'source-over';
      } else {
        // sticker: a solid silhouette stamped around a circle makes the stroke, the person goes on top
        const sil = cv('_aiSil'), sg = sil.getContext('2d');
        sg.globalCompositeOperation = 'source-over'; sg.clearRect(0, 0, sw, sh); sg.drawImage(mc, 0, 0, sw, sh);
        sg.globalCompositeOperation = 'source-in'; sg.fillStyle = col; sg.fillRect(0, 0, sw, sh); sg.globalCompositeOperation = 'source-over';
        const rad = Math.max(1, (params.amount ?? 40) / 100 * 0.03 * big);
        for (let i = 0; i < 16; i++) { const an = i / 16 * Math.PI * 2; og.drawImage(sil, Math.cos(an) * rad, Math.sin(an) * rad); }
        og.drawImage(sil, 0, 0); og.drawImage(person, 0, 0);
      }
      return (this._aiOut = out);
    } finally { res.close && res.close(); }
  }

  // ------------------------------------------------------------ compositing
  /** Scratch frame-sized layer (soft-edge transition masks, effects on titles). */
  layer(W, H) {
    const cv = this._layer || (this._layer = document.createElement('canvas'));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    g.clearRect(0, 0, W, H);
    return { cv, g };
  }
  /** Run a whole frame-sized canvas through the GPU effects and/or a film look; returns a canvas to draw at once, or null. */
  frameFx(src, W, H, es, t, lim = 1) {
    let img = null;
    if (es.needsGL) { const g = glProcess(src, 0, 0, W, H, W * lim, H * lim, es.u, t); if (g) img = g; }
    if (es.film) { const f = this.filmPass(img || src, 0, 0, (img || src).width, (img || src).height, W * lim, H * lim, es.film, t); if (f) img = f; }
    return img;
  }
  /** Film Look: the shared Film Lab engine, one live renderer per effect instance. */
  filmPass(img, ix, iy, iw, ih, outW, outH, film, t) {
    const look = lookByCode(film.code); if (!look) return null;
    this.filmR = this.filmR || new Map();
    let fr = this.filmR.get(film.key);
    if (!fr) { const cv = document.createElement('canvas'); fr = { cv, r: createLiveRenderer(cv) }; this.filmR.set(film.key, fr); }
    try { const out = fr.r.render(img, look.id, { strength: film.strength }, t, { crop: { x: ix, y: iy, w: iw, h: ih }, width: Math.max(2, outW), height: Math.max(2, outH) }); return out ? fr.cv : null; }
    catch (e) { return null; /* keep the ungraded frame */ }
  }

  drawFrame(ctx, W, H, t, forExport = false) {
    const s = this.seq;
    const k = W / s.width;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none';
    ctx.fillStyle = s.background || '#000';
    ctx.fillRect(0, 0, W, H);
    const quality = forExport ? 'quality' : perfLevel();
    this._lim = forExport ? 1 : (quality === 'performance' ? 0.6 : 1) * this.pvScale;
    for (const { c, tail } of this.activeClips(t, 'video')) {
      const r = resolve(c, t);
      const tx = this.transitionFx(c, t, tail);
      const alpha = clamp01(r.opacity / 100 * this.fadeAt(c, t) * tx.alpha);
      if (alpha <= 0.001) { if (tx.overlay) this.overlay(ctx, W, H, tx.overlay); continue; }
      const es = effectState(c, r.fx, k);
      if (tx.gl) { Object.assign(es.u, tx.gl); es.needsGL = true; }
      if (c.gen && c.gen.type === 'adjust') { this.drawAdjust(ctx, W, H, t, alpha, es, r, k); continue; }
      // motion-blurred transitions (whip pan, spin, zoom blur) average several offset copies
      const sm = tx.smear, n = sm ? (quality === 'performance' ? 4 : sm.n) : 1;
      for (let i = 0; i < n; i++) {
        const f = n > 1 ? i / (n - 1) - 0.5 : 0;
        const txi = n > 1 ? { ...tx, dx: tx.dx + f * sm.dx, dy: tx.dy + f * sm.dy, scale: tx.scale * (1 + f * sm.ds), rot: tx.rot + f * sm.dr } : tx;
        this.paintClip(ctx, W, H, k, t, c, r, txi, alpha / (i + 1), es, quality);
      }
      if (tx.overlay) this.overlay(ctx, W, H, tx.overlay);
    }
    ctx.restore();
  }

  /** One clip onto the frame — directly, or through the scratch layer when it needs a soft mask or frame-space effects. */
  paintClip(ctx, W, H, k, t, c, r, tx, alpha, es, quality) {
    const genFx = !!c.gen && (es.needsGL || !!es.film);
    if (!tx.mask && !genFx) { this.drawClip(ctx, W, H, k, t, c, r, tx, alpha, es, quality); return; }
    const L = this.layer(W, H);
    this.drawClip(L.g, W, H, k, t, c, r, tx, alpha, es, quality);
    if (genFx) { // titles & shapes: effects run on the rendered layer
      const fxd = this.frameFx(L.cv, W, H, es, t, this._lim);
      if (fxd) { L.g.setTransform(1, 0, 0, 1, 0, 0); L.g.globalAlpha = 1; L.g.filter = 'none'; L.g.globalCompositeOperation = 'copy'; L.g.drawImage(fxd, 0, 0, W, H); L.g.globalCompositeOperation = 'source-over'; }
    }
    if (tx.mask) { L.g.setTransform(1, 0, 0, 1, 0, 0); L.g.globalAlpha = 1; L.g.filter = 'none'; L.g.globalCompositeOperation = 'destination-in'; tx.mask(L.g, W, H); L.g.globalCompositeOperation = 'source-over'; }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.drawImage(L.cv, 0, 0); ctx.restore();
  }

  /** Adjustment layer: its effects grade everything already composited below it. */
  drawAdjust(ctx, W, H, t, alpha, es, r, k) {
    const blurPx = (r.blur || 0) * k;
    const filt = [es.filter !== 'none' ? es.filter : '', blurPx > 0.1 ? `blur(${blurPx.toFixed(2)}px)` : ''].filter(Boolean).join(' ');
    if (!es.needsGL && !es.film && !filt && !es.glow) return;
    let img = this.frameFx(ctx.canvas, W, H, es, t, this._lim);
    if (!img) { // blur / glow only: work from a copy of the frame
      const L = this.layer(W, H); L.g.drawImage(ctx.canvas, 0, 0); img = L.cv;
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha;
    if (filt && this.filterOK) ctx.filter = filt;
    try { ctx.drawImage(img, 0, 0, W, H); } catch (e) { /* not ready */ }
    if (es.glow && this.filterOK) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha * es.glow.amount; ctx.filter = `blur(${es.glow.radius.toFixed(1)}px) brightness(1.3)`; try { ctx.drawImage(img, 0, 0, W, H); } catch (e) { /* ignore */ } }
    ctx.restore();
  }

  drawClip(ctx, W, H, k, t, c, r, tx, alpha, es, quality) {
    const s = this.seq;
    const blurPx = (r.blur || 0) * k + tx.blur * k;
    const filt = [es.filter !== 'none' ? es.filter : '', blurPx > 0.1 ? `blur(${blurPx.toFixed(2)}px)` : ''].filter(Boolean).join(' ') || 'none';
    ctx.save();
    if (tx.clip) { ctx.beginPath(); tx.clip(ctx, W, H); ctx.clip(tx.clipRule || 'nonzero'); }
    if (tx.sx) { ctx.translate(tx.sx.ax * W, 0); ctx.scale(Math.max(0.0001, tx.sx.s), 1); ctx.translate(-tx.sx.ax * W, 0); }
    if (tx.rot) { ctx.translate(W / 2, H / 2); ctx.rotate(tx.rot); ctx.translate(-W / 2, -H / 2); }
    ctx.translate(W / 2 + (r.x + tx.dx) * k, H / 2 + (r.y + tx.dy) * k);
    if (r.rotation) ctx.rotate(r.rotation * Math.PI / 180);
    ctx.globalAlpha = alpha;
    if (this.filterOK) ctx.filter = filt;
    ctx.imageSmoothingQuality = quality === 'performance' ? 'low' : 'high';
    if (c.gen) {
      const sc = r.scale / 100 * tx.scale;
      ctx.scale(sc, sc);
      ctx.translate(-(r.ax || 0) * k, -(r.ay || 0) * k);
      drawGen(ctx, c, r, k, W, H, t - c.start, clipDur(c));
      if (es.glow && this.filterOK && c.gen.type !== 'color') { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha * es.glow.amount; ctx.filter = `blur(${es.glow.radius.toFixed(1)}px) brightness(1.3)`; drawGen(ctx, c, r, k, W, H, t - c.start, clipDur(c)); }
      ctx.restore();
      return;
    }
    const m = mediaById(this.project, c.mediaId);
    if (!m || m.offline || !this.app.media.online(m.id)) { ctx.restore(); this.drawOffline(ctx, W, H, c, m); return; }
    let src = null, sw = 0, sh = 0, stamp = 0;
    if (m.kind === 'video') {
      const rr = this.els.get(c.id + ':video');
      if (!rr || rr.el.readyState < 2 || !rr.el.videoWidth) { ctx.restore(); return; }
      if (m.relinkedDuration && srcTime(c, t) > m.relinkedDuration + 0.05) { ctx.restore(); return; }
      src = rr.el; sw = rr.el.videoWidth; sh = rr.el.videoHeight; stamp = rr.el.currentTime;
    } else if (m.kind === 'image') {
      src = this.app.media.bitmapFor(m.id);
      if (!src) { ctx.restore(); return; }
      sw = src.width; sh = src.height;
    } else { ctx.restore(); return; }
    const fit = Math.min(s.width / sw, s.height / sh) * k;
    const sc = fit * r.scale / 100 * tx.scale;
    const cl = { l: r.cropL, t: r.cropT, r: r.cropR, b: r.cropB };
    const sx0 = sw * cl.l / 100, sy0 = sh * cl.t / 100;
    const cw = sw * (1 - (cl.l + cl.r) / 100), ch = sh * (1 - (cl.t + cl.b) / 100);
    if (cw <= 0 || ch <= 0) { ctx.restore(); return; }
    const dx = (-sw / 2 + sx0 - (r.ax || 0) / fit * k) * sc, dy = (-sh / 2 + sy0 - (r.ay || 0) / fit * k) * sc;
    let img = src, ix = sx0, iy = sy0, iw = cw, ih = ch;
    if (es.ai) {
      const cut = this.aiCut(src, sw, sh, es.ai, c.id + '|' + stamp + '|' + JSON.stringify(es.ai));
      if (cut) { img = cut; }
    }
    const lim = this._lim;
    if (es.needsGL) {
      const outW = Math.max(1, cw * sc * lim), outH = Math.max(1, ch * sc * lim);
      const g = glProcess(img, ix, iy, iw, ih, outW, outH, es.u, t);
      if (g) { img = g; ix = 0; iy = 0; iw = g.width; ih = g.height; }
    }
    if (es.film) {
      const f = this.filmPass(img, ix, iy, iw, ih, cw * sc * lim, ch * sc * lim, es.film, t);
      if (f) { img = f; ix = 0; iy = 0; iw = f.width; ih = f.height; }
    }
    try { ctx.drawImage(img, ix, iy, iw, ih, dx, dy, cw * sc, ch * sc); } catch (e) { /* frame not ready */ }
    if (es.glow && this.filterOK) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * es.glow.amount;
      ctx.filter = `blur(${es.glow.radius.toFixed(1)}px) brightness(1.3)`;
      try { ctx.drawImage(img, ix, iy, iw, ih, dx, dy, cw * sc, ch * sc); } catch (e) { /* ignore */ }
    }
    ctx.restore();
  }
  overlay(ctx, W, H, o) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = clamp01(o.a); ctx.filter = 'none';
    if (o.kind === 'leak') {
      // light-leak burn: warm blobs sweeping across the cut, screened over the picture
      ctx.globalCompositeOperation = 'screen';
      const blob = (cx, cy, rad, c0) => { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, c0); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
      blob(W * (-0.2 + 1.4 * o.p), H * 0.35, W * 0.75, 'rgba(255,150,40,1)');
      blob(W * (1.1 - 1.2 * o.p), H * 0.7, W * 0.6, 'rgba(255,60,60,.9)');
      blob(W * (0.2 + 0.6 * o.p), H * 0.5, W * 0.45, 'rgba(255,240,180,.9)');
    } else { ctx.fillStyle = o.color; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  drawOffline(ctx, W, H, c, m) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#8b0000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs = Math.max(12, Math.round(H / 14));
    ctx.font = `700 ${fs}px 'Studio Oswald', 'Arial Narrow', sans-serif`;
    ctx.fillText('MEDIA OFFLINE', W / 2, H / 2 - fs * 0.4);
    ctx.font = `500 ${Math.round(fs * 0.42)}px 'Studio Inter', sans-serif`;
    ctx.fillText(m ? m.name : (c.missing || c.name || 'Unknown media'), W / 2, H / 2 + fs * 0.55);
    ctx.restore();
  }

  destroy() { cancelAnimationFrame(this.raf); this.releaseAll(); }
}
