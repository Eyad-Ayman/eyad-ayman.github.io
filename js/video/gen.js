// EYAD VIDEO — generated clips: titles, captions, shapes and colour mattes.
// They live on video tracks like any clip (clip.gen) and need no media file.
import { str, num, bool, oneOf, color } from '../core/eyad.js';

export const TITLE_FONTS = [['Studio Oswald', 'Oswald'], ['Studio Inter', 'Inter'], ['Studio Mono', 'Mono'], ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Impact', 'Impact'], ['Times New Roman', 'Times'], ['Courier New', 'Courier']];

export const GEN_TEMPLATES = {
  title: { label: 'Title', gen: { type: 'text', text: 'YOUR TITLE', font: 'Studio Oswald', size: 140, weight: 700, color: '#ffffff', align: 'center', stroke: '#000000', strokeW: 0, bg: null, bgPad: 24, shadow: true, tracking: 0, reveal: 100, lineH: 1.05, italic: false } },
  lower: { label: 'Lower third', gen: { type: 'text', text: 'EYAD AYMAN\nDesigner · Video editor', font: 'Studio Inter', size: 54, weight: 700, color: '#ffffff', align: 'left', stroke: '#000000', strokeW: 0, bg: '#d02b2a', bgPad: 22, shadow: false, tracking: 0, reveal: 100, lineH: 1.25, italic: false }, transform: { x: -560, y: 330 } },
  caption: { label: 'Caption', gen: { type: 'caption', text: 'Caption text', font: 'Studio Inter', size: 50, weight: 600, color: '#ffffff', align: 'center', stroke: '#000000', strokeW: 0, bg: '#000000', bgPad: 14, shadow: false, tracking: 0, reveal: 100, lineH: 1.2, italic: false }, transform: { y: 400 } },
  rect: { label: 'Rectangle', gen: { type: 'shape', shape: 'rect', w: 600, h: 340, fill: '#d02b2a', stroke: '#ffffff', strokeW: 0, radius: 0 } },
  ellipse: { label: 'Ellipse', gen: { type: 'shape', shape: 'ellipse', w: 400, h: 400, fill: '#f3ede1', stroke: '#ffffff', strokeW: 0, radius: 0 } },
  line: { label: 'Line', gen: { type: 'shape', shape: 'line', w: 800, h: 8, fill: '#ffffff', stroke: '#ffffff', strokeW: 0, radius: 4 } },
  matte: { label: 'Colour matte', gen: { type: 'color', color: '#0b0b0b', color2: null, angle: 90 } },
  gradient: { label: 'Gradient matte', gen: { type: 'color', color: '#d02b2a', color2: '#0b0b0b', angle: 135 } },
};

export function genLabel(g) {
  if (g.type === 'text' || g.type === 'caption') return (g.text || '').split('\n')[0].slice(0, 40) || 'Title';
  if (g.type === 'shape') return g.shape[0].toUpperCase() + g.shape.slice(1);
  return g.color2 ? 'Gradient matte' : 'Colour matte';
}

/** Draw a generated clip centred at the origin of the current transform (units = sequence px × k). */
export function drawGen(ctx, c, r, k, W, H) {
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
  // text / caption
  const size = g.size * k;
  const tracking = (r.tracking ?? g.tracking ?? 0) / 1000 * size;
  ctx.font = `${g.italic ? 'italic ' : ''}${g.weight} ${size}px '${g.font}', sans-serif`;
  ctx.textBaseline = 'alphabetic';
  let text = String(g.text || '');
  const reveal = Math.max(0, Math.min(100, r.reveal ?? g.reveal ?? 100));
  const total = text.length;
  const shown = Math.round(total * reveal / 100);
  const lines = text.split('\n');
  const lh = size * (g.lineH || 1.2);
  const widths = lines.map((l) => measure(ctx, l, tracking));
  const maxW = Math.max(1, ...widths);
  const blockH = lh * (lines.length - 1) + size;
  let top = -blockH / 2 + size * 0.8;
  const xFor = (w) => (g.align === 'left' ? -maxW / 2 : g.align === 'right' ? maxW / 2 - w : -w / 2);
  if (g.bg) {
    const pad = (g.bgPad || 0) * k;
    ctx.fillStyle = g.bg;
    if (g.type === 'caption') lines.forEach((l, i) => { const w = widths[i]; if (!l) return; ctx.fillRect(xFor(w) - pad, top + i * lh - size * 0.82 - pad / 2, w + pad * 2, size + pad); });
    else ctx.fillRect(-maxW / 2 - pad, -blockH / 2 - pad, maxW + pad * 2, blockH + pad * 2);
  }
  if (g.shadow) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = size * 0.12; ctx.shadowOffsetY = size * 0.04; }
  let left = shown;
  lines.forEach((l, i) => {
    const vis = l.slice(0, Math.max(0, left)); left -= l.length + 1;
    if (!vis) return;
    const x = xFor(widths[i]), y = top + i * lh;
    if (g.strokeW > 0) { ctx.save(); ctx.shadowColor = 'transparent'; ctx.lineJoin = 'round'; ctx.lineWidth = g.strokeW * k * 2; ctx.strokeStyle = g.stroke; drawText(ctx, vis, x, y, tracking, true); ctx.restore(); }
    ctx.fillStyle = g.color;
    drawText(ctx, vis, x, y, tracking, false);
  });
  ctx.shadowColor = 'transparent';
}
function measure(ctx, s, tracking) { return ctx.measureText(s).width + Math.max(0, s.length - 1) * tracking; }
function drawText(ctx, s, x, y, tracking, stroke) {
  if (!tracking) { stroke ? ctx.strokeText(s, x, y) : ctx.fillText(s, x, y); return; }
  if ('letterSpacing' in ctx) { ctx.letterSpacing = tracking + 'px'; stroke ? ctx.strokeText(s, x, y) : ctx.fillText(s, x, y); ctx.letterSpacing = '0px'; return; }
  let cx = x;
  for (const ch of s) { stroke ? ctx.strokeText(ch, cx, y) : ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + tracking; }
}

export function sanitizeGen(g) {
  if (!g || typeof g !== 'object') return undefined;
  if (g.type === 'text' || g.type === 'caption') return { type: g.type, text: str(g.text, '', 5000), font: TITLE_FONTS.some(([f]) => f === g.font) ? g.font : 'Studio Inter', size: num(g.size, 80, 4, 2000), weight: num(g.weight, 700, 100, 900), color: color(g.color, '#ffffff'), align: oneOf(g.align, ['left', 'center', 'right'], 'center'), stroke: color(g.stroke, '#000000'), strokeW: num(g.strokeW, 0, 0, 200), bg: g.bg ? color(g.bg, '#000000') : null, bgPad: num(g.bgPad, 16, 0, 400), shadow: bool(g.shadow), tracking: num(g.tracking, 0, -200, 2000), reveal: num(g.reveal, 100, 0, 100), lineH: num(g.lineH, 1.2, 0.5, 4), italic: bool(g.italic) };
  if (g.type === 'shape') return { type: 'shape', shape: oneOf(g.shape, ['rect', 'ellipse', 'line', 'triangle'], 'rect'), w: num(g.w, 400, 1, 20000), h: num(g.h, 200, 1, 20000), fill: g.fill ? color(g.fill, '#ffffff') : null, stroke: color(g.stroke, '#ffffff'), strokeW: num(g.strokeW, 0, 0, 500), radius: num(g.radius, 0, 0, 5000) };
  if (g.type === 'color') return { type: 'color', color: color(g.color, '#000000'), color2: g.color2 ? color(g.color2, '#000000') : null, angle: num(g.angle, 90, -360, 360) };
  return undefined;
}
