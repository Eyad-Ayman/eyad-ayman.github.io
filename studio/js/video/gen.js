// EYAD VIDEO — generated clips: titles, captions, shapes, colour mattes and
// adjustment layers. Text has a style system (stroke, shadow, box, gradient,
// glow, in/out animation, RTL) — see TEXT_DEF / TEXT_STYLES.
// They live on video tracks like any clip (clip.gen) and need no media file.
import { str, num, bool, oneOf, color } from '../core/eyad.js';
import { EXTRA_FONTS } from '../templates/fonts.js';
import { extendFontList, onFontsChanged } from '../core/fonts.js';

export const TITLE_FONTS = [['Studio Oswald', 'Oswald'], ['Studio Inter', 'Inter'], ['Studio Mono', 'Mono'], ...EXTRA_FONTS, ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Impact', 'Impact'], ['Times New Roman', 'Times'], ['Courier New', 'Courier']];
extendFontList(TITLE_FONTS);
onFontsChanged(() => extendFontList(TITLE_FONTS));

export const GEN_TEMPLATES = {
  title: { label: 'Title', gen: { type: 'text', text: 'YOUR TITLE', font: 'Studio Oswald', size: 140, weight: 700, color: '#ffffff', align: 'center', stroke: '#000000', strokeW: 0, bg: null, bgPad: 24, shadow: true, tracking: 0, reveal: 100, lineH: 1.05, italic: false } },
  lower: { label: 'Lower third', gen: { type: 'text', text: 'EYAD AYMAN\nDesigner · Video editor', font: 'Studio Inter', size: 54, weight: 700, color: '#ffffff', align: 'left', stroke: '#000000', strokeW: 0, bg: '#d02b2a', bgPad: 22, shadow: false, tracking: 0, reveal: 100, lineH: 1.25, italic: false }, transform: { x: -560, y: 330 } },
  caption: { label: 'Caption', gen: { type: 'caption', text: 'Caption text', font: 'Studio Inter', size: 50, weight: 600, color: '#ffffff', align: 'center', stroke: '#000000', strokeW: 0, bg: '#000000', bgPad: 14, shadow: false, tracking: 0, reveal: 100, lineH: 1.2, italic: false }, transform: { y: 400 } },
  rect: { label: 'Rectangle', gen: { type: 'shape', shape: 'rect', w: 600, h: 340, fill: '#d02b2a', stroke: '#ffffff', strokeW: 0, radius: 0 } },
  ellipse: { label: 'Ellipse', gen: { type: 'shape', shape: 'ellipse', w: 400, h: 400, fill: '#f3ede1', stroke: '#ffffff', strokeW: 0, radius: 0 } },
  line: { label: 'Line', gen: { type: 'shape', shape: 'line', w: 800, h: 8, fill: '#ffffff', stroke: '#ffffff', strokeW: 0, radius: 4 } },
  matte: { label: 'Colour matte', gen: { type: 'color', color: '#0b0b0b', color2: null, angle: 90 } },
  adjust: { label: 'Adjustment layer', gen: { type: 'adjust' } },
  gradient: { label: 'Gradient matte', gen: { type: 'color', color: '#d02b2a', color2: '#0b0b0b', angle: 135 } },
};

export function genLabel(g) {
  if (g.type === 'text' || g.type === 'caption') return (g.text || '').split('\n')[0].slice(0, 40) || 'Title';
  if (g.type === 'adjust') return 'Adjustment layer';
  if (g.type === 'shape') return g.shape[0].toUpperCase() + g.shape.slice(1);
  return g.color2 ? 'Gradient matte' : 'Colour matte';
}

/** Draw a generated clip centred at the origin of the current transform (units = sequence px × k). */
export function drawGen(ctx, c, r, k, W, H, lt = null, dur = 0) {
  const g = c.gen;
  if (g.type === 'color') {
    // fills the frame at 100 % scale (drawn in output pixels; the clip transform still applies)
    const w = W, hh = H;
    if (g.color2) {
      const a = (g.angle || 0) * Math.PI / 180, dx = Math.cos(a) * w / 2, dy = Math.sin(a) * hh / 2;
      const gr = ctx.createLinearGradient(-dx, -dy, dx, dy); gr.addColorStop(0, g.color); gr.addColorStop(1, g.color2); ctx.fillStyle = gr;
    } else ctx.fillStyle = g.color;
    ctx.fillRect(-w / 2, -hh / 2, w, hh);
    return;
  }
  if (g.type === 'shape') {
    const w = g.w * k, hh = g.h * k;
    ctx.beginPath();
    if (g.shape === 'ellipse') ctx.ellipse(0, 0, w / 2, hh / 2, 0, 0, Math.PI * 2);
    else if (g.shape === 'triangle') { ctx.moveTo(0, -hh / 2); ctx.lineTo(w / 2, hh / 2); ctx.lineTo(-w / 2, hh / 2); ctx.closePath(); }
    else { const rr = Math.min(g.radius * k, w / 2, hh / 2); if (ctx.roundRect) ctx.roundRect(-w / 2, -hh / 2, w, hh, rr); else ctx.rect(-w / 2, -hh / 2, w, hh); }
    if (g.fill) { ctx.fillStyle = g.fill; ctx.fill(); }
    if (g.strokeW > 0) { ctx.lineWidth = g.strokeW * k; ctx.strokeStyle = g.stroke; ctx.stroke(); }
    return;
  }
  if (g.type === 'adjust') return; // adjustment layers have no pixels of their own (engine.js applies their effects)
  drawText(ctx, g, r, k, W, lt, dur);
}

// ------------------------------------------------------------------ text

/** Every text property with the value that reproduces a pre-style-system title. */
export const TEXT_DEF = {
  caps: false, hollow: false, color2: null, gradAngle: 90,
  shadowColor: '#000000', shadowOp: 55, shadowBlur: 12, shadowX: 0, shadowY: 4,
  bgOp: 100, bgRadius: 0, glow: 0, glowColor: '#ff2bd6', dir: 'auto', wrap: 0,
  animIn: 'none', animOut: 'none', animInDur: 0.5, animOutDur: 0.5, hi: '#7c4dff',
};
export const TEXT_ANIM_IN = [['none', 'None'], ['fade', 'Fade'], ['slideUp', 'Slide up'], ['slideDown', 'Slide down'], ['slideLeft', 'Slide from right'], ['slideRight', 'Slide from left'], ['pop', 'Pop'], ['zoom', 'Zoom in'], ['typewriter', 'Typewriter'], ['words', 'Word by word'], ['wordsPop', 'Word by word (pop)'], ['karaoke', 'Karaoke highlight (whole clip)']];
export const TEXT_ANIM_OUT = [['none', 'None'], ['fade', 'Fade'], ['slideUp', 'Slide up'], ['slideDown', 'Slide down'], ['pop', 'Pop'], ['typewriter', 'Typewriter (delete)']];

const RTL = /[֑-߿יִ-﷽ﹰ-ﻼ]/;
const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const backOut = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const rgba = (hex, a) => { const n = parseInt(String(hex).slice(1), 16) || 0; return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${c01(a)})`; };

// Web fonts only reach a canvas once the browser has loaded them: ask for each
// family/weight once and repaint when it arrives.
const fontAsked = new Set();
let fontReady = () => {};
export function onGenFontLoad(fn) { fontReady = fn; }
function ensureFont(g) {
  const spec = `${g.italic ? 'italic ' : ''}${g.weight} 24px '${g.font}'`;
  if (fontAsked.has(spec) || !document.fonts || !document.fonts.load) return;
  fontAsked.add(spec);
  document.fonts.load(spec, 'Aaع').then((l) => { if (l && l.length) fontReady(); }).catch(() => {});
}

/** In/out animation at clip-local time lt — pure function of time, so export is frame-exact. */
function animState(G, lt, dur, size) {
  const st = { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1, words: null, karaoke: null };
  if (lt == null || !(dur > 0)) return st;
  const inD = Math.min(Math.max(0.01, G.animInDur), dur), outD = Math.min(Math.max(0.01, G.animOutDur), dur);
  if (G.animIn === 'karaoke') st.karaoke = c01(lt / dur);
  else if (G.animIn !== 'none' && lt < inD) {
    const p = c01(lt / inD), e = easeOut(p);
    switch (G.animIn) {
      case 'fade': st.alpha *= p; break;
      case 'slideUp': st.dy += (1 - e) * size * 0.9; st.alpha *= Math.min(1, p * 2); break;
      case 'slideDown': st.dy -= (1 - e) * size * 0.9; st.alpha *= Math.min(1, p * 2); break;
      case 'slideLeft': st.dx += (1 - e) * size * 2; st.alpha *= Math.min(1, p * 2); break;
      case 'slideRight': st.dx -= (1 - e) * size * 2; st.alpha *= Math.min(1, p * 2); break;
      case 'pop': st.scale *= Math.max(0, backOut(p)); st.alpha *= Math.min(1, p * 4); break;
      case 'zoom': st.scale *= 1 + (1 - e) * 0.6; st.alpha *= p; break;
      case 'typewriter': st.reveal = p; break;
      case 'words': st.words = { p, pop: false }; break;
      case 'wordsPop': st.words = { p, pop: true }; break;
      default: break;
    }
  }
  if (G.animOut !== 'none' && dur - lt < outD) {
    const p = c01((dur - lt) / outD), e = easeOut(p);
    switch (G.animOut) {
      case 'fade': st.alpha *= p; break;
      case 'slideUp': st.dy -= (1 - e) * size * 0.9; st.alpha *= Math.min(1, p * 2); break;
      case 'slideDown': st.dy += (1 - e) * size * 0.9; st.alpha *= Math.min(1, p * 2); break;
      case 'pop': st.scale *= e; st.alpha *= Math.min(1, p * 3); break;
      case 'typewriter': st.reveal = Math.min(st.reveal, p); break;
      default: break;
    }
  }
  return st;
}

function drawText(ctx, g, r, k, W, lt, dur) {
  const G = { ...TEXT_DEF, bgLine: g.type === 'caption', ...g };
  ensureFont(G);
  if (G.font !== 'Studio Cairo' && RTL.test(G.text || '')) ensureFont({ font: 'Studio Cairo', weight: G.weight >= 800 ? 900 : G.weight >= 600 ? 700 : 400 }); // bundled Arabic fallback
  const size = G.size * k;
  const tracking = (r.tracking ?? G.tracking ?? 0) / 1000 * size;
  ctx.font = `${G.italic ? 'italic ' : ''}${G.weight} ${size}px '${G.font}', 'Studio Cairo', sans-serif`;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  let text = String(G.text || '');
  if (G.caps) text = text.toUpperCase();
  const A = animState(G, lt, dur, size);
  // lines: explicit breaks, then optional word wrap to a share of the frame width
  const maxLine = G.wrap > 0 ? W * G.wrap / 100 : 0;
  const lines = [];
  for (const para of text.split('\n')) {
    if (!maxLine || measure(ctx, para, tracking) <= maxLine) { lines.push(para); continue; }
    let cur = '';
    for (const w of para.split(' ')) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && measure(ctx, next, tracking) > maxLine) { lines.push(cur); cur = w; } else cur = next;
    }
    lines.push(cur);
  }
  const total = lines.reduce((n, l) => n + l.length + 1, -1);
  const reveal = Math.max(0, Math.min(100, r.reveal ?? G.reveal ?? 100)) / 100 * A.reveal;
  const shown = Math.round(total * reveal);
  const lh = size * (G.lineH || 1.2);
  const widths = lines.map((l) => measure(ctx, l, tracking));
  const maxW = Math.max(1, ...widths);
  const blockH = lh * (lines.length - 1) + size;
  const top = -blockH / 2 + size * 0.8;
  const xFor = (w) => (G.align === 'left' ? -maxW / 2 : G.align === 'right' ? maxW / 2 - w : -w / 2);
  const isRtl = (l) => (G.dir === 'rtl' ? true : G.dir === 'ltr' ? false : RTL.test(l));
  const box = (x, y, w, hh, rad) => { ctx.beginPath(); if (rad > 0 && ctx.roundRect) ctx.roundRect(x, y, w, hh, Math.min(rad, w / 2, hh / 2)); else ctx.rect(x, y, w, hh); ctx.fill(); };

  ctx.save();
  if (A.dx || A.dy) ctx.translate(A.dx, A.dy);
  if (A.scale !== 1) ctx.scale(A.scale, A.scale);
  const baseAlpha = ctx.globalAlpha * A.alpha;
  ctx.globalAlpha = baseAlpha;
  if (G.bg) {
    const pad = (G.bgPad || 0) * k, rad = (G.bgRadius || 0) * k;
    ctx.fillStyle = G.bg; ctx.globalAlpha = baseAlpha * c01(G.bgOp / 100);
    if (G.bgLine) lines.forEach((l, i) => { const w = widths[i]; if (!l) return; box(xFor(w) - pad, top + i * lh - size * 0.82 - pad / 2, w + pad * 2, size + pad, rad); });
    else box(-maxW / 2 - pad, -blockH / 2 - pad, maxW + pad * 2, blockH + pad * 2, rad);
    ctx.globalAlpha = baseAlpha;
  }
  let fill = G.color;
  if (G.color2) {
    const a = (G.gradAngle || 0) * Math.PI / 180, dx = Math.cos(a) * maxW / 2, dy = Math.sin(a) * blockH / 2;
    fill = ctx.createLinearGradient(-dx, -dy, dx, dy); fill.addColorStop(0, G.color); fill.addColorStop(1, G.color2);
  }
  const shadowOn = () => { if (G.shadow) { ctx.shadowColor = rgba(G.shadowColor, G.shadowOp / 100); ctx.shadowBlur = size * G.shadowBlur / 100; ctx.shadowOffsetX = size * G.shadowX / 100; ctx.shadowOffsetY = size * G.shadowY / 100; } };
  const shadowOff = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
  /** One run of text: glow → stroke → fill. The shadow is cast by whichever is outermost. */
  const paint = (str, x, y, rtl) => {
    ctx.direction = rtl ? 'rtl' : 'ltr';
    const trk = rtl && !('letterSpacing' in ctx) ? 0 : tracking; // never split joined Arabic letters by hand
    if (G.glow > 0) {
      ctx.save(); ctx.shadowColor = G.glowColor; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.fillStyle = G.glowColor;
      for (const m of [0.6, 0.25]) { ctx.shadowBlur = size * G.glow / 100 * m; drawRun(ctx, str, x, y, trk, false); }
      ctx.restore();
    }
    const sw = G.hollow ? Math.max(1, (G.strokeW || 3) * k) : G.strokeW * k * 2;
    if (sw > 0) { ctx.save(); shadowOn(); ctx.lineJoin = 'round'; ctx.lineWidth = sw; ctx.strokeStyle = G.stroke; drawRun(ctx, str, x, y, trk, true); ctx.restore(); }
    if (!G.hollow) { ctx.save(); if (!(sw > 0)) shadowOn(); ctx.fillStyle = fill; drawRun(ctx, str, x, y, trk, false); ctx.restore(); }
    shadowOff();
  };

  if (A.words || A.karaoke != null) {
    // word mode: every word is placed on its own so it can fade, pop or be highlighted
    const all = []; let chars = 0;
    lines.forEach((l, i) => {
      const rtl = isRtl(l), x0 = xFor(widths[i]), y = top + i * lh;
      const ws = l.split(' '); let pre = '';
      ws.forEach((w) => {
        const pw = pre ? measure(ctx, pre, tracking) + tracking : 0, ww = measure(ctx, w, tracking);
        if (w) { all.push({ w, x: rtl ? x0 + widths[i] - pw - ww : x0 + pw, y, ww, rtl, c0: chars, c1: chars + w.length }); chars += w.length; }
        pre += w + ' ';
      });
    });
    const n = all.length || 1;
    all.forEach((o, i) => {
      if (A.karaoke != null) {
        const pos = A.karaoke * chars;
        if (pos >= o.c0 && (pos < o.c1 || (i === n - 1 && A.karaoke >= 1))) { const pad = size * 0.14; ctx.save(); ctx.fillStyle = G.hi; box(o.x - pad, o.y - size * 0.86, o.ww + pad * 2, size * 1.14, size * 0.2); ctx.restore(); }
        paint(o.w, o.x, o.y, o.rtl); return;
      }
      const q = c01(A.words.p * n - i); if (q <= 0) return;
      ctx.save(); ctx.globalAlpha = baseAlpha * Math.min(1, q * 2);
      if (A.words.pop) { const sc = Math.max(0.01, backOut(q)); ctx.translate(o.x + o.ww / 2, o.y - size * 0.3); ctx.scale(sc, sc); paint(o.w, -o.ww / 2, size * 0.3, o.rtl); } else paint(o.w, o.x, o.y, o.rtl);
      ctx.restore();
    });
  } else {
    let left = shown;
    lines.forEach((l, i) => {
      const vis = l.slice(0, Math.max(0, left)); left -= l.length + 1;
      if (!vis) return;
      const rtl = isRtl(l), w = widths[i];
      // a part-typed RTL line grows leftwards from the right edge of its line
      const x = rtl && vis.length < l.length ? xFor(w) + w - measure(ctx, vis, tracking) : xFor(w);
      paint(vis, x, top + i * lh, rtl);
    });
  }
  ctx.direction = 'ltr';
  ctx.restore();
}
function measure(ctx, s, tracking) {
  if (tracking && 'letterSpacing' in ctx) { ctx.letterSpacing = tracking + 'px'; const w = ctx.measureText(s).width - (s.length ? tracking : 0); ctx.letterSpacing = '0px'; return w; }
  return ctx.measureText(s).width + Math.max(0, s.length - 1) * tracking;
}
function drawRun(ctx, s, x, y, tracking, stroke) {
  if (!tracking) { stroke ? ctx.strokeText(s, x, y) : ctx.fillText(s, x, y); return; }
  if ('letterSpacing' in ctx) { ctx.letterSpacing = tracking + 'px'; stroke ? ctx.strokeText(s, x, y) : ctx.fillText(s, x, y); ctx.letterSpacing = '0px'; return; }
  let cx = x;
  for (const ch of s) { stroke ? ctx.strokeText(ch, cx, y) : ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + tracking; }
}

// ------------------------------------------------------------------ text styles

/** What a style resets before applying its own look (text, type and direction are kept). */
const STYLE_BASE = { ...TEXT_DEF, font: 'Studio Inter', size: 80, weight: 700, color: '#ffffff', align: 'center', stroke: '#000000', strokeW: 0, bg: null, bgPad: 18, bgLine: false, shadow: false, tracking: 0, reveal: 100, lineH: 1.15, italic: false };
const ST = (label, gen, extra = {}) => ({ label, gen, ...extra });
/** One-click text looks. `cap` = also offered as a caption style; `pos` = where a new clip is placed; `sample` = starter text. */
export const TEXT_STYLES = {
  boldCaption: ST('Bold caption', { font: 'Studio Poppins', weight: 800, size: 68, strokeW: 5, shadow: true, shadowOp: 60, shadowBlur: 8, shadowY: 5, animIn: 'pop', animInDur: 0.25, wrap: 84 }, { cap: true }),
  karaoke: ST('Karaoke box', { font: 'Studio Poppins', weight: 800, size: 66, strokeW: 4, animIn: 'karaoke', hi: '#7c4dff', wrap: 84 }, { cap: true }),
  wordPop: ST('Word by word', { font: 'Studio Montserrat', weight: 800, size: 72, strokeW: 5, caps: true, animIn: 'wordsPop', animInDur: 0.8, wrap: 84 }, { cap: true }),
  subtitleBg: ST('Subtitle with background', { font: 'Studio Inter', weight: 600, size: 50, bg: '#000000', bgOp: 72, bgPad: 14, bgRadius: 10, bgLine: true, lineH: 1.3, wrap: 86 }, { cap: true }),
  yellowSub: ST('Yellow subtitle', { font: 'Studio Inter', weight: 700, size: 54, color: '#ffe500', strokeW: 4, wrap: 86 }, { cap: true }),
  neon: ST('Neon', { font: 'Studio Space Grotesk', weight: 700, size: 130, color: '#ffffff', glow: 55, glowColor: '#ff2bd6', stroke: '#ff7be6', strokeW: 1, animIn: 'fade' }),
  outline: ST('Outline', { font: 'Studio Archivo Black', weight: 400, size: 150, hollow: true, stroke: '#ffffff', strokeW: 4, caps: true }),
  shadowDrop: ST('Shadow drop', { font: 'Studio Montserrat', weight: 800, size: 120, shadow: true, shadowColor: '#000000', shadowOp: 100, shadowBlur: 0, shadowX: 6, shadowY: 6 }),
  lowerThird: ST('Lower third', { font: 'Studio Inter', weight: 700, size: 52, align: 'left', bg: '#101014', bgOp: 86, bgPad: 24, bgRadius: 16, lineH: 1.25, animIn: 'slideRight', animOut: 'fade' }, { pos: { x: -0.29, y: 0.31 }, sample: 'Eyad Ayman\nDesigner · Video editor' }),
  bigTitle: ST('Big title', { font: 'Studio Bebas', weight: 400, size: 230, tracking: 40, caps: true, shadow: true, animIn: 'slideUp', animInDur: 0.6 }),
  typewriter: ST('Typewriter', { font: 'Studio Mono', weight: 400, size: 60, animIn: 'typewriter', animInDur: 1.5 }),
  chrome: ST('Y2K chrome', { font: 'Studio Archivo Black', weight: 400, size: 150, caps: true, color: '#fbfdff', color2: '#6f7dff', gradAngle: 90, stroke: '#1b1f6b', strokeW: 4, glow: 18, glowColor: '#9fb0ff' }),
  sunset: ST('Sunset gradient', { font: 'Studio Montserrat', weight: 800, size: 130, color: '#ffc04d', color2: '#ff3d81', gradAngle: 90, shadow: true }),
  minimal: ST('Clean minimal', { font: 'Studio Inter', weight: 500, size: 60, tracking: 220, caps: true, animIn: 'fade', animOut: 'fade', animInDur: 0.8, animOutDur: 0.8 }),
  hand: ST('Handwritten', { font: 'Studio Caveat', weight: 600, size: 130, shadow: true, animIn: 'typewriter', animInDur: 1 }),
  arabicBold: ST('Arabic bold — عربي', { font: 'Studio Cairo', weight: 900, size: 130, dir: 'rtl', shadow: true, lineH: 1.4, animIn: 'slideUp' }, { sample: 'عنوان رئيسي' }),
  arabicCaption: ST('Arabic caption — ترجمة', { font: 'Studio Cairo', weight: 700, size: 58, dir: 'rtl', bg: '#000000', bgOp: 72, bgPad: 16, bgRadius: 12, bgLine: true, lineH: 1.55, wrap: 86 }, { cap: true, sample: 'هذا نص الترجمة' }),
  arabicNeon: ST('Arabic outline glow', { font: 'Studio Cairo', weight: 900, size: 120, dir: 'rtl', color: '#ffffff', strokeW: 3, stroke: '#00c2a8', glow: 40, glowColor: '#00e0c0', lineH: 1.4 }, { sample: 'تصميم عربي' }),
};
/** Full property patch for a style (everything a previous style may have set is reset). */
export function textStylePatch(key, g = {}) {
  const S = TEXT_STYLES[key]; if (!S) return {};
  const keepDir = S.gen.dir ? {} : { dir: g.dir || 'auto' };
  return { ...STYLE_BASE, ...keepDir, ...S.gen };
}

export function sanitizeGen(g) {
  if (!g || typeof g !== 'object') return undefined;
  if (g.type === 'text' || g.type === 'caption') {
    const D = TEXT_DEF, anyOf = (v, list, d) => (list.some(([k]) => k === v) ? v : d);
    return {
      type: g.type, text: str(g.text, '', 5000), font: TITLE_FONTS.some(([f]) => f === g.font) ? g.font : 'Studio Inter', size: num(g.size, 80, 4, 2000), weight: num(g.weight, 700, 100, 900), color: color(g.color, '#ffffff'), align: oneOf(g.align, ['left', 'center', 'right'], 'center'), stroke: color(g.stroke, '#000000'), strokeW: num(g.strokeW, 0, 0, 200), bg: g.bg ? color(g.bg, '#000000') : null, bgPad: num(g.bgPad, 16, 0, 400), shadow: bool(g.shadow), tracking: num(g.tracking, 0, -200, 2000), reveal: num(g.reveal, 100, 0, 100), lineH: num(g.lineH, 1.2, 0.5, 4), italic: bool(g.italic),
      // style system (absent in older projects → defaults that draw exactly as before)
      caps: bool(g.caps, D.caps), hollow: bool(g.hollow, D.hollow), color2: g.color2 ? color(g.color2, '#ffffff') : null, gradAngle: num(g.gradAngle, D.gradAngle, -360, 360),
      shadowColor: color(g.shadowColor, D.shadowColor), shadowOp: num(g.shadowOp, D.shadowOp, 0, 100), shadowBlur: num(g.shadowBlur, D.shadowBlur, 0, 200), shadowX: num(g.shadowX, D.shadowX, -100, 100), shadowY: num(g.shadowY, D.shadowY, -100, 100),
      bgOp: num(g.bgOp, D.bgOp, 0, 100), bgRadius: num(g.bgRadius, D.bgRadius, 0, 400), bgLine: bool(g.bgLine, g.type === 'caption'),
      glow: num(g.glow, D.glow, 0, 100), glowColor: color(g.glowColor, D.glowColor), dir: oneOf(g.dir, ['auto', 'ltr', 'rtl'], 'auto'), wrap: num(g.wrap, D.wrap, 0, 100),
      animIn: anyOf(g.animIn, TEXT_ANIM_IN, 'none'), animOut: anyOf(g.animOut, TEXT_ANIM_OUT, 'none'), animInDur: num(g.animInDur, D.animInDur, 0.05, 30), animOutDur: num(g.animOutDur, D.animOutDur, 0.05, 30), hi: color(g.hi, D.hi),
    };
  }
  if (g.type === 'adjust') return { type: 'adjust' };
  if (g.type === 'shape') return { type: 'shape', shape: oneOf(g.shape, ['rect', 'ellipse', 'line', 'triangle'], 'rect'), w: num(g.w, 400, 1, 20000), h: num(g.h, 200, 1, 20000), fill: g.fill ? color(g.fill, '#ffffff') : null, stroke: color(g.stroke, '#ffffff'), strokeW: num(g.strokeW, 0, 0, 500), radius: num(g.radius, 0, 0, 5000) };
  if (g.type === 'color') return { type: 'color', color: color(g.color, '#000000'), color2: g.color2 ? color(g.color2, '#000000') : null, angle: num(g.angle, 90, -360, 360) };
  return undefined;
}
