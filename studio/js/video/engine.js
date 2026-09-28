// EYAD VIDEO — playback & compositing engine (browser media APIs + Web Audio).
import { clipEnd, clipDur, srcTime, seqDuration, mediaById, trackById, dbToGain } from './model.js';
import { filterFor, canvasFilterSupported } from './effects.js';
import { getAudioContext } from './media.js';

export class Engine {
  constructor(app) {
    this.app = app;
    this.time = 0;
    this.playing = false;
    this.rate = 1;
    this.loop = false;
    this.volume = 1;
    this.muted = false;
    this.els = new Map(); // clipId -> { el, kind, mediaId, src, gain, lastUse }
    this.listeners = new Set();
    this.canvas = null;
    this.ctx = null;
    this.raf = 0;
    this.last = 0;
    this.exporting = null;
    this.filterOK = canvasFilterSupported();
    this.needsRender = true;
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
    this.master.connect(ctx.destination);
    this.applyMaster();
    return ctx;
  }
  applyMaster() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }
  setVolume(v) { this.volume = v; this.applyMaster(); }
  setMuted(m) { this.muted = m; this.applyMaster(); }

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

  activeClips(t, kind) {
    const s = this.seq;
    const out = [];
    for (const tr of s.tracks) {
      if (tr.kind !== kind) continue;
      if (kind === 'video' && tr.hidden) continue;
      for (const c of s.clips) if (c.trackId === tr.id && c.enabled !== false && t >= c.start && t < clipEnd(c)) out.push({ c, tr });
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
            r.gain = ctx.createGain();
            r.source.connect(r.gain).connect(this.master);
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
    try { r.source && r.source.disconnect(); r.gain && r.gain.disconnect(); } catch (e) { /* ignore */ }
    this.els.delete(key);
  }
  releaseAll() { for (const k of Array.from(this.els.keys())) this.releaseEl(k); }

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
      const m = mediaById(this.project, c.mediaId);
      if (!m || m.kind !== 'video' || m.offline) continue;
      const r = this.ensureEl(c, 'video'); if (!r) continue;
      live.add(c.id + ':video');
      syncEl(r, c);
    }
    // audio
    const anySolo = s.tracks.some((tr) => tr.kind === 'audio' && tr.solo);
    for (const { c, tr } of this.activeClips(t, 'audio')) {
      const m = mediaById(this.project, c.mediaId);
      if (!m || m.offline || m.kind === 'image') continue;
      const r = this.ensureEl(c, 'audio'); if (!r) continue;
      live.add(c.id + ':audio');
      const audible = !tr.mute && !c.muted && (!anySolo || tr.solo);
      const g = audible ? dbToGain(c.volume) * dbToGain(tr.volume) * this.fadeAt(c, t) : 0;
      if (r.gain) r.gain.gain.value = g; else { r.el.volume = Math.max(0, Math.min(1, g * (this.muted ? 0 : this.volume))); }
      syncEl(r, c);
    }
    // pre-roll upcoming clips while playing, pause/release everything else
    if (playing) {
      for (const c of s.clips) {
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
    // While paused/scrubbing, keep the previous frame on screen until the new
    // one is decoded (avoids black flashes); 'seeked' triggers a re-render.
    if (!target && !this.playing && !this.framesReady(this.time)) {
      if (!this._waitSince) this._waitSince = performance.now();
      if (performance.now() - this._waitSince < 1500) return;
    }
    this._waitSince = 0;
    this.needsRender = false;
    this.drawFrame(ctx, cv.width, cv.height, this.time);
    if (!target && this.exporting && this.exporting.canvas) this.drawFrame(this.exporting.canvas.getContext('2d'), this.exporting.canvas.width, this.exporting.canvas.height, this.time);
  }

  drawFrame(ctx, W, H, t) {
    const s = this.seq;
    const k = W / s.width;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none';
    ctx.fillStyle = s.background || '#000';
    ctx.fillRect(0, 0, W, H);
    for (const { c } of this.activeClips(t, 'video')) {
      const m = mediaById(this.project, c.mediaId);
      if (!m || m.offline || !this.app.media.online(m.id)) { this.drawOffline(ctx, W, H, c, m); continue; }
      let src = null, sw = 0, sh = 0;
      if (m.kind === 'video') {
        const r = this.els.get(c.id + ':video');
        if (!r || r.el.readyState < 2 || !r.el.videoWidth) continue;
        if (m.relinkedDuration && srcTime(c, t) > m.relinkedDuration + 0.05) continue;
        src = r.el; sw = r.el.videoWidth; sh = r.el.videoHeight;
      } else if (m.kind === 'image') {
        src = this.app.media.bitmapFor(m.id);
        if (!src) continue;
        sw = src.width; sh = src.height;
      } else continue;
      const tr = c.transform, cr = c.crop;
      const fit = Math.min(s.width / sw, s.height / sh) * k;
      const sc = fit * tr.scale / 100;
      const sx0 = sw * cr.l / 100, sy0 = sh * cr.t / 100;
      const cw = sw * (1 - (cr.l + cr.r) / 100), ch = sh * (1 - (cr.t + cr.b) / 100);
      if (cw <= 0 || ch <= 0) continue;
      ctx.save();
      ctx.translate(W / 2 + tr.x * k, H / 2 + tr.y * k);
      if (tr.rotation) ctx.rotate(tr.rotation * Math.PI / 180);
      ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity / 100 * this.fadeAt(c, t)));
      if (this.filterOK) ctx.filter = filterFor(c, k);
      ctx.imageSmoothingQuality = 'high';
      try { ctx.drawImage(src, sx0, sy0, cw, ch, (-sw / 2 + sx0) * sc, (-sh / 2 + sy0) * sc, cw * sc, ch * sc); } catch (e) { /* frame not ready */ }
      ctx.restore();
    }
    ctx.restore();
  }

  drawOffline(ctx, W, H, c, m) {
    ctx.save();
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
