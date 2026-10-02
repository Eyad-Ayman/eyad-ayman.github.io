// EYAD IMAGE — compositor. Draws the layer tree into a 2D context whose
// coordinate system is document pixels.
import { GCO, nodeMatrix, localSize, layoutText, fontString, makeCanvas, hasFx } from './doc.js';

// Small pool of scratch canvases, keyed by size.
const pool = [];
export function getScratch(w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  const i = pool.findIndex((c) => c.width === w && c.height === h);
  const c = i >= 0 ? pool.splice(i, 1)[0] : makeCanvas(w, h);
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  g.clearRect(0, 0, w, h);
  return c;
}
export function releaseScratch(c) { if (pool.length < 8) pool.push(c); }
export function drainScratch() { pool.length = 0; }

/**
 * opts: {
 *   rect:   {x,y,w,h} doc-space region to redraw (optional)
 *   live:   { nodeId, draw(ctx, node) } — replaces a node's content while a tool is working
 *   hide:   Set of node ids to skip (text being edited)
 *   width, height: doc size (for scratch canvases)
 * }
 */
export function renderDoc(doc, ctx, opts = {}) {
  const o = { ...opts, width: doc.width, height: doc.height };
  ctx.save();
  if (o.rect) {
    ctx.beginPath();
    ctx.rect(o.rect.x, o.rect.y, o.rect.w, o.rect.h);
    ctx.clip();
  }
  renderList(doc.layers, ctx, o);
  ctx.restore();
}

function renderList(nodes, ctx, o) {
  for (let i = 0; i < nodes.length; i++) {
    const base = nodes[i];
    // gather clipping followers
    let j = i + 1;
    while (j < nodes.length && nodes[j].clip && base.type !== 'group') j++;
    const followers = nodes.slice(i + 1, j);
    if (!base.visible || (o.hide && o.hide.has(base.id))) { i = j - 1; continue; }
    if (followers.length && base.type !== 'group') {
      const tmp = getScratch(o.width, o.height);
      const tg = tmp.getContext('2d');
      tg.setTransform(ctx.getTransform());
      renderNode(base, tg, o, true);
      for (const f of followers) {
        if (!f.visible) continue;
        tg.save();
        tg.globalCompositeOperation = 'source-atop';
        renderNode(f, tg, { ...o, forceOp: 'source-atop' });
        tg.restore();
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = GCO[base.blend] || 'source-over';
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
      releaseScratch(tmp);
      i = j - 1;
    } else {
      renderNode(base, ctx, o);
    }
  }
}

export function renderNode(n, ctx, o = {}, ignoreBlend = false) {
  if (n.type === 'group' && n.artboard && !o._inArtboard) {
    // Artboard: its own background, and everything inside is clipped to its frame.
    const a = n.artboard;
    ctx.save();
    ctx.beginPath(); ctx.rect(a.x, a.y, a.w, a.h); ctx.clip();
    if (a.bg) { ctx.save(); ctx.globalAlpha = n.opacity; ctx.fillStyle = a.bg; ctx.fillRect(a.x, a.y, a.w, a.h); ctx.restore(); }
    renderNode(n, ctx, { ...o, _inArtboard: true }, ignoreBlend);
    ctx.restore();
    return;
  }
  if (o._inArtboard) o = { ...o, _inArtboard: false };
  if (n.type === 'group') {
    const isolated = n.blend !== 'pass-through' || n.opacity < 1 || (n.mask && n.maskEnabled);
    if (!isolated) { renderList(n.children, ctx, o); return; }
    const tmp = getScratch(o.width, o.height);
    const tg = tmp.getContext('2d');
    tg.setTransform(ctx.getTransform());
    renderList(n.children, tg, o);
    if (n.mask && n.maskEnabled) applyMask(tg, n, ctx.getTransform());
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = n.opacity;
    ctx.globalCompositeOperation = ignoreBlend ? 'source-over' : (GCO[n.blend] || 'source-over');
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    releaseScratch(tmp);
    return;
  }
  const live = o.live && o.live.nodeId === n.id ? o.live : null;
  if (hasFx(n)) { renderWithFx(n, ctx, o, live, ignoreBlend); return; }
  const needsIsolation = (n.mask && n.maskEnabled) || (live && live.isolate);
  ctx.save();
  ctx.globalAlpha *= n.opacity;
  ctx.globalCompositeOperation = o.forceOp || (ignoreBlend ? 'source-over' : (GCO[n.blend] || 'source-over'));
  if (needsIsolation) {
    const tmp = getScratch(o.width, o.height);
    const tg = tmp.getContext('2d');
    const base = ctx.getTransform();
    tg.setTransform(base.multiply(nodeMatrix(n)));
    if (live) live.draw(tg, n); else drawContent(n, tg);
    if (n.mask && n.maskEnabled) applyMask(tg, n, base.multiply(nodeMatrix(n)));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tmp, 0, 0);
    releaseScratch(tmp);
  } else {
    ctx.transform(...matrixArgs(nodeMatrix(n)));
    if (live) live.draw(ctx, n); else drawContent(n, ctx);
  }
  ctx.restore();
}

// Masks are alpha canvases positioned in the layer's local space (they follow
// the layer when it is moved or transformed). Opaque = visible.
function applyMask(tg, n, maskTransform) {
  tg.save();
  tg.setTransform(maskTransform);
  tg.globalCompositeOperation = 'destination-in';
  tg.globalAlpha = 1;
  tg.drawImage(n.mask.canvas, n.mask.x, n.mask.y);
  tg.restore();
}

export function matrixArgs(m) { return [m.a, m.b, m.c, m.d, m.e, m.f]; }

/** Draws a node's own content in its local coordinate space. */
export function drawContent(n, ctx) {
  if (n.type === 'raster') { ctx.drawImage(n.canvas, 0, 0); return; }
  if (n.type === 'text') { drawText(n, ctx); return; }
  if (n.type === 'shape') { drawShape(n, ctx); }
}

export function drawText(n, ctx) {
  const l = layoutText(n);
  ctx.font = fontString(n);
  if ('letterSpacing' in ctx) ctx.letterSpacing = (n.tracking || 0) + 'px';
  ctx.fillStyle = n.color;
  ctx.textBaseline = 'alphabetic';
  const ascent = n.size * 0.8 + (l.lh - n.size) / 2;
  l.lines.forEach((line, i) => {
    let x = 0;
    if (n.align === 'center') x = (l.w - l.widths[i]) / 2;
    else if (n.align === 'right') x = l.w - l.widths[i];
    ctx.fillText(line, x, ascent + i * l.lh);
  });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

export function shapePath(n) {
  const p = new Path2D();
  if (n.shape === 'rect') {
    const r = Math.min(n.radius || 0, n.w / 2, n.h / 2);
    if (r > 0 && p.roundRect) p.roundRect(0, 0, n.w, n.h, r); else p.rect(0, 0, n.w, n.h);
  } else if (n.shape === 'ellipse') {
    p.ellipse(n.w / 2, n.h / 2, n.w / 2, n.h / 2, 0, 0, Math.PI * 2);
  } else if (n.shape === 'path' && n.subpaths && n.subpaths.length) {
    for (const sp of n.subpaths) {
      const pts = sp.points; if (!pts.length) continue;
      p.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) p.bezierCurveTo(pts[i - 1].ox, pts[i - 1].oy, pts[i].ix, pts[i].iy, pts[i].x, pts[i].y);
      if (sp.closed && pts.length > 1) { const a = pts[pts.length - 1], b = pts[0]; p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y); p.closePath(); }
    }
  } else if (n.shape === 'path' && n.points && n.points.length) {
    const pts = n.points;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.bezierCurveTo(pts[i - 1].ox, pts[i - 1].oy, pts[i].ix, pts[i].iy, pts[i].x, pts[i].y);
    if (n.closed && pts.length > 2) {
      const a = pts[pts.length - 1], b = pts[0];
      p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y);
      p.closePath();
    }
  }
  return p;
}

export function drawShape(n, ctx) {
  const p = shapePath(n);
  if (n.fillOn && (n.shape !== 'path' || n.closed || n.subpaths)) { ctx.fillStyle = n.fill; ctx.fill(p, n.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); }
  if (n.strokeOn && n.strokeWidth > 0) {
    ctx.strokeStyle = n.stroke; ctx.lineWidth = n.strokeWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke(p);
  }
}

/** Render a single node (or group) into a new canvas at doc size — used for merge/rasterize/export. */
export function rasterizeNode(doc, n) {
  const c = makeCanvas(doc.width, doc.height);
  const g = c.getContext('2d');
  renderNode({ ...n, blend: n.type === 'group' ? n.blend : 'normal', opacity: 1, visible: true }, g, { width: doc.width, height: doc.height });
  return c;
}

/** Flatten the whole document into a canvas. */
export function flatten(doc, { background = null } = {}) {
  const c = makeCanvas(doc.width, doc.height);
  const g = c.getContext('2d');
  if (background) { g.fillStyle = background; g.fillRect(0, 0, c.width, c.height); }
  renderDoc(doc, g, {});
  return c;
}

/** Thumbnail of a node, fitted in size×size. */
export function nodeThumb(doc, n, size = 40) {
  const s = Math.min(size / doc.width, size / doc.height);
  const c = makeCanvas(Math.max(1, Math.round(doc.width * s)), Math.max(1, Math.round(doc.height * s)));
  const g = c.getContext('2d');
  g.scale(s, s);
  try {
    renderNode({ ...n, visible: true, opacity: 1, blend: n.type === 'group' ? 'pass-through' : 'normal', children: n.children }, g, { width: doc.width, height: doc.height });
  } catch (e) { /* ignore */ }
  return c;
}

export function localBoxSize(n) { return localSize(n); }

// ---------------------------------------------------------------- layer styles (fx)
function rgba(hex, a) { const v = parseInt(hex.slice(1), 16); return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${a})`; }
function renderWithFx(n, ctx, o, live, ignoreBlend) {
  const base = ctx.getTransform();
  const k = Math.sqrt(Math.abs(base.a * base.d - base.b * base.c)) || 1; // doc px → device px
  const W = o.width, H = o.height;
  // 1) the layer's own pixels (with its mask), full alpha, in device space
  const content = getScratch(W, H);
  const cg = content.getContext('2d');
  cg.setTransform(base.multiply(nodeMatrix(n)));
  if (live) live.draw(cg, n); else drawContent(n, cg);
  if (n.mask && n.maskEnabled) applyMask(cg, n, base.multiply(nodeMatrix(n)));
  cg.setTransform(1, 0, 0, 1, 0, 0);
  const fx = n.fx || {};
  const out = getScratch(W, H), og = out.getContext('2d');
  const FAR = 20000;
  const shadowOf = (e, blurPx, dx, dy, color) => { og.save(); og.shadowColor = color; og.shadowBlur = blurPx; og.shadowOffsetX = dx + FAR; og.shadowOffsetY = dy; og.drawImage(content, -FAR, 0); og.restore(); };
  if (fx.dropShadow && fx.dropShadow.on) {
    const e = fx.dropShadow, a = (e.angle || 0) * Math.PI / 180;
    shadowOf(e, e.size * k, -Math.cos(a) * e.distance * k, Math.sin(a) * e.distance * k, rgba(e.color, e.opacity));
  }
  if (fx.outerGlow && fx.outerGlow.on) { const e = fx.outerGlow; shadowOf(e, e.size * k, 0, 0, rgba(e.color, e.opacity)); shadowOf(e, e.size * k * 0.4, 0, 0, rgba(e.color, e.opacity * 0.6)); }
  // silhouette helper
  const sil = (color) => { const s = getScratch(W, H), sg = s.getContext('2d'); sg.drawImage(content, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = color; sg.fillRect(0, 0, W, H); return s; };
  if (fx.stroke && fx.stroke.on && fx.stroke.position !== 'inside') {
    const e = fx.stroke, s = sil(rgba(e.color, 1)), r = Math.max(1, e.size * k * (e.position === 'center' ? 0.5 : 1));
    og.save(); og.globalAlpha = e.opacity;
    const steps = Math.min(48, Math.max(12, Math.round(r * 1.5)));
    for (let i = 0; i < steps; i++) { const t = i / steps * Math.PI * 2; og.drawImage(s, Math.cos(t) * r, Math.sin(t) * r); }
    og.drawImage(s, 0, 0);
    og.restore(); releaseScratch(s);
  }
  // 2) content (Fill opacity), overlays clipped to it
  const body = getScratch(W, H), bg = body.getContext('2d');
  bg.drawImage(content, 0, 0);
  if (fx.gradientOverlay && fx.gradientOverlay.on) {
    const e = fx.gradientOverlay, a = e.angle * Math.PI / 180, cx = W / 2, cy = H / 2, L = Math.max(W, H) / 2;
    const gr = bg.createLinearGradient(cx - Math.cos(a) * L, cy + Math.sin(a) * L, cx + Math.cos(a) * L, cy - Math.sin(a) * L);
    gr.addColorStop(0, e.from); gr.addColorStop(1, e.to);
    bg.save(); bg.globalCompositeOperation = 'source-atop'; bg.globalAlpha = e.opacity; bg.fillStyle = gr; bg.fillRect(0, 0, W, H); bg.restore();
  }
  if (fx.colorOverlay && fx.colorOverlay.on) { const e = fx.colorOverlay; bg.save(); bg.globalCompositeOperation = 'source-atop'; bg.globalAlpha = e.opacity; bg.fillStyle = e.color; bg.fillRect(0, 0, W, H); bg.restore(); }
  if (fx.innerShadow && fx.innerShadow.on) {
    const e = fx.innerShadow, a = (e.angle || 0) * Math.PI / 180;
    const inv = getScratch(W, H), ig = inv.getContext('2d');
    ig.fillStyle = '#000'; ig.fillRect(0, 0, W, H); ig.globalCompositeOperation = 'destination-out'; ig.drawImage(content, 0, 0);
    bg.save(); bg.globalCompositeOperation = 'source-atop';
    bg.shadowColor = rgba(e.color, e.opacity); bg.shadowBlur = e.size * k; bg.shadowOffsetX = -Math.cos(a) * e.distance * k + FAR; bg.shadowOffsetY = Math.sin(a) * e.distance * k;
    bg.drawImage(inv, -FAR, 0); bg.restore(); releaseScratch(inv);
  }
  if (fx.stroke && fx.stroke.on && fx.stroke.position !== 'outside') {
    const e = fx.stroke, r = Math.max(1, e.size * k * (e.position === 'center' ? 0.5 : 1));
    const inv = getScratch(W, H), ig = inv.getContext('2d');
    ig.fillStyle = e.color; ig.fillRect(0, 0, W, H); ig.globalCompositeOperation = 'destination-out';
    const steps = Math.min(48, Math.max(12, Math.round(r * 1.5)));
    for (let i = 0; i < steps; i++) { const t = i / steps * Math.PI * 2; ig.drawImage(content, Math.cos(t) * r, Math.sin(t) * r); }
    bg.save(); bg.globalCompositeOperation = 'source-atop'; bg.globalAlpha = e.opacity; bg.drawImage(inv, 0, 0); bg.restore(); releaseScratch(inv);
  }
  og.save(); og.globalAlpha = n.fillOpacity == null ? 1 : n.fillOpacity; og.drawImage(body, 0, 0); og.restore();
  releaseScratch(body); releaseScratch(content);
  // 3) onto the canvas with the layer's opacity and blend mode
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= n.opacity;
  ctx.globalCompositeOperation = o.forceOp || (ignoreBlend ? 'source-over' : (GCO[n.blend] || 'source-over'));
  ctx.drawImage(out, 0, 0);
  ctx.restore();
  releaseScratch(out);
}
