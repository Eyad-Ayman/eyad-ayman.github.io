// EYAD VECTOR — .fig importer (EXPERIMENTAL).
//
// A .fig file is either a ZIP (canvas.fig + meta.json + thumbnail.png + images/<sha1>)
// or a bare "fig-kiwi" container. canvas.fig = "fig-kiwi" + uint32 version + chunks of
// (uint32 LE length, bytes): chunk 0 is the compressed binary Kiwi schema, chunk 1 the
// compressed message (raw DEFLATE, or Zstandard when it starts with 28 B5 2F FD).
// The schema is decoded and INTERPRETED (no generated code — our CSP forbids eval) to
// read message.nodeChanges, which are then rebuilt into a tree and converted into the
// EYAD VECTOR model. Unsupported features are listed in the report, never faked.
//
// Libraries (vendored): fflate (MIT) for DEFLATE + ZIP, fzstd (MIT) for Zstandard,
// kiwi-decode.js (MIT, adapted from evanw/kiwi).
import { uid } from '../core/dom.js';
import { validateDoc, mul, apply, invert, FONTS, rectPath, ellipsePath } from './model.js';
import { unzipSync, inflateSync, unzlibSync } from '../../vendor/fflate/fflate.js';
import { decompress as zstdDecompress } from '../../vendor/fzstd/fzstd.js';
import { decodeBinarySchema, createDecoder } from '../../vendor/kiwi/kiwi-decode.js';

export const FIG_LIMITS = {
  bytes: 512 * 1024 * 1024,     // input file
  entry: 400 * 1024 * 1024,     // any one decompressed part
  nodes: 150000,                // node changes considered
  outNodes: 120000,             // model nodes created
  points: 2500000,
  images: 400,
  imageBytes: 60 * 1024 * 1024, // one embedded image file
  imagePixels: 4096,
  artboards: 100,
  instanceDepth: 12,
};
const PAGE_GAP = 400;

// ------------------------------------------------------------------ sniffing / container

/** True when bytes are a bare fig-kiwi container. */
export function isFigKiwi(bytes) { return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 8)) === 'fig-kiwi'; }

/** Cheap check for detectFile: File/Blob → 'fig-kiwi' | 'fig-zip' | null (reads only the ZIP directory). */
export async function sniffFig(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (isFigKiwi(head)) return 'fig-kiwi';
  if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return null;
  const size = file.size, tailLen = Math.min(size, 65557);
  const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true), count = tail.getUint16(eocd + 10, true);
  if (cdOff + cdSize > size || cdSize > 16 * 1024 * 1024) return null;
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const td = new TextDecoder();
  for (let n = 0, p = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) return null;
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    const name = td.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, Math.min(nl, cd.byteLength - p - 46)));
    if (name === 'canvas.fig') return 'fig-zip';
    p += 46 + nl + xl + cl;
  }
  return null;
}

function decompress(chunk, what) {
  if (chunk.length >= 4 && chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd) {
    const fcs = zstdContentSize(chunk);
    if (fcs !== null && fcs > FIG_LIMITS.entry) throw new Error(`The ${what} is too large to open safely.`);
    const out = zstdDecompress(chunk);
    if (out.length > FIG_LIMITS.entry) throw new Error(`The ${what} is too large to open safely.`);
    return out;
  }
  try { return inflateSync(chunk); } catch (e) { /* fall through */ }
  try { return unzlibSync(chunk); } catch (e) { throw new Error(`The ${what} could not be decompressed (damaged file?).`); }
}
/** Frame_Content_Size from a Zstandard frame header, or null when absent. */
function zstdContentSize(b) {
  if (b.length < 6) return null;
  const fhd = b[4], fcsFlag = fhd >> 6, single = (fhd >> 5) & 1, dictFlag = fhd & 3;
  let p = 5 + (single ? 0 : 1) + [0, 1, 2, 4][dictFlag];
  const n = [single ? 1 : 0, 2, 4, 8][fcsFlag];
  if (!n || p + n > b.length) return null;
  let v = 0;
  for (let i = n - 1; i >= 0; i--) v = v * 256 + b[p + i];
  return n === 2 ? v + 256 : v;
}

function parseFigKiwi(bytes) {
  if (!isFigKiwi(bytes)) throw new Error('This is not a .fig file (fig-kiwi header missing).');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(8, true);
  const chunks = [];
  let off = 12;
  while (off + 4 <= bytes.length && chunks.length < 64) {
    const len = dv.getUint32(off, true); off += 4;
    if (off + len > bytes.length) throw new Error('This .fig file is truncated or damaged.');
    chunks.push(bytes.subarray(off, off + len)); off += len;
  }
  if (chunks.length < 2) throw new Error('This .fig file has no document data.');
  const schemaBytes = decompress(chunks[0], 'document schema');
  const dataBytes = decompress(chunks[1], 'document data');
  const schema = decodeBinarySchema(schemaBytes);
  const dec = createDecoder(schema, { skipFields: new Set(['glyphs', 'derivedTextData', 'derivedLines', 'fontMetaData', 'pluginData', 'pluginRelaunchData', 'localUndoStack', 'localRedoStack', 'thumbHash', 'editInfo']) });
  if (!dec.has('Message')) throw new Error('This .fig file uses an unknown document schema.');
  const message = dec.decode('Message', dataBytes);
  return { version, message };
}

// ------------------------------------------------------------------ report

class Report {
  constructor() { this.counts = { pages: 0, artboards: 0, groups: 0, paths: 0, texts: 0, images: 0, gradients: 0 }; this.approx = new Map(); this.unsupported = new Map(); this.fonts = new Map(); this.truncated = false; this.version = null; }
  a(m, n = 1) { this.approx.set(m, (this.approx.get(m) || 0) + n); }
  u(m, n = 1) { this.unsupported.set(m, (this.unsupported.get(m) || 0) + n); }
  out() {
    const list = (m) => [...m].map(([k, v]) => (v > 1 ? `${k} (×${v})` : k));
    const c = this.counts;
    return {
      source: 'fig', experimental: true, figKiwiVersion: this.version, ...c, truncated: this.truncated,
      approximations: list(this.approx), unsupported: list(this.unsupported),
      fontSubstitutions: [...this.fonts].map(([a, b]) => `${a} → ${b}`),
      summary: `${c.pages} page${c.pages === 1 ? '' : 's'}, ${c.artboards} artboard${c.artboards === 1 ? '' : 's'}: ${c.paths} path${c.paths === 1 ? '' : 's'}, ${c.texts} text object${c.texts === 1 ? '' : 's'}, ${c.images} image${c.images === 1 ? '' : 's'}.${this.truncated ? ' The file hit a safety limit, so not everything was imported.' : ''}`,
    };
  }
}

// ------------------------------------------------------------------ helpers

const gk = (g) => (g && typeof g === 'object' ? `${g.sessionID >>> 0}:${g.localID >>> 0}` : '');
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hx = (v) => clamp(Math.round(fin(v) * 255), 0, 255).toString(16).padStart(2, '0');
const hexOf = (c) => '#' + hx(c?.r) + hx(c?.g) + hx(c?.b);
const matOf = (t) => (t ? [fin(t.m00, 1), fin(t.m10), fin(t.m01), fin(t.m11, 1), fin(t.m02), fin(t.m12)] : [1, 0, 0, 1, 0, 0]);
const cleanText = (s) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f￾￿]/g, '').slice(0, 20000);
const cleanName = (s, d) => cleanText(s).replace(/\s+/g, ' ').trim().slice(0, 120) || d;
const BLEND = { NORMAL: 'normal', PASS_THROUGH: 'normal', DARKEN: 'darken', MULTIPLY: 'multiply', LINEAR_BURN: 'multiply', COLOR_BURN: 'color-burn', LIGHTEN: 'lighten', SCREEN: 'screen', LINEAR_DODGE: 'color-dodge', COLOR_DODGE: 'color-dodge', OVERLAY: 'overlay', SOFT_LIGHT: 'soft-light', HARD_LIGHT: 'hard-light', DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity' };
const bbOfSps = (sps) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of sps) for (const p of sp.pts) for (const [x, y] of [[p.x, p.y], p.hi || [p.x, p.y], p.ho || [p.x, p.y]]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const xformSps = (sps, m) => sps.map((sp) => ({ closed: sp.closed, pts: sp.pts.map((p) => { const [x, y] = apply(m, p.x, p.y); return { x, y, hi: p.hi ? apply(m, p.hi[0], p.hi[1]) : null, ho: p.ho ? apply(m, p.ho[0], p.ho[1]) : null, smooth: !!p.smooth }; }) }));
const detScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

/** commandsBlob → subpaths (local coords). 0 close, 1 moveTo, 2 lineTo, 3 quadTo, 4 cubicTo; float32 LE. */
export function decodeCommands(bytes, maxPts = 200000) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sps = [];
  let cur = null, i = 0, n = 0;
  const f = () => { const v = dv.getFloat32(i, true); i += 4; return Number.isFinite(v) ? v : 0; };
  const need = (k) => i + k * 4 <= bytes.length;
  while (i < bytes.length && n < maxPts) {
    const cmd = bytes[i++];
    if (cmd === 0) {
      if (cur && cur.pts.length) {
        cur.closed = true;
        const a = cur.pts[0], z = cur.pts[cur.pts.length - 1];
        if (cur.pts.length > 1 && Math.abs(a.x - z.x) < 1e-3 && Math.abs(a.y - z.y) < 1e-3) { a.hi = z.hi; cur.pts.pop(); }
      }
      cur = null;
    } else if (cmd === 1) { if (!need(2)) break; cur = { closed: false, pts: [{ x: f(), y: f(), hi: null, ho: null, smooth: false }] }; sps.push(cur); n++; }
    else if (cmd === 2) { if (!need(2)) break; const x = f(), y = f(); if (!cur) { cur = { closed: false, pts: [] }; sps.push(cur); } cur.pts.push({ x, y, hi: null, ho: null, smooth: false }); n++; }
    else if (cmd === 3) {
      if (!need(4)) break;
      const cx = f(), cy = f(), x = f(), y = f();
      if (!cur) { cur = { closed: false, pts: [{ x: cx, y: cy, hi: null, ho: null, smooth: false }] }; sps.push(cur); }
      const l = cur.pts[cur.pts.length - 1];
      l.ho = [l.x + (cx - l.x) * 2 / 3, l.y + (cy - l.y) * 2 / 3];
      cur.pts.push({ x, y, hi: [x + (cx - x) * 2 / 3, y + (cy - y) * 2 / 3], ho: null, smooth: false }); n++;
    } else if (cmd === 4) {
      if (!need(6)) break;
      const x1 = f(), y1 = f(), x2 = f(), y2 = f(), x = f(), y = f();
      if (!cur) { cur = { closed: false, pts: [{ x: x1, y: y1, hi: null, ho: null, smooth: false }] }; sps.push(cur); }
      cur.pts[cur.pts.length - 1].ho = [x1, y1];
      cur.pts.push({ x, y, hi: [x2, y2], ho: null, smooth: false }); n++;
    } else break; // unknown command: stop rather than misread
  }
  return sps.filter((sp) => sp.pts.length > 1);
}

// fonts
const FONT_RULES = [
  [/^inter\b|inter display/i, 'Studio Inter'], [/oswald/i, 'Studio Oswald'], [/jetbrains|mono/i, 'Studio Mono'],
  [/helvetica/i, 'Helvetica'], [/arial|arimo|liberation sans/i, 'Arial'], [/georgia/i, 'Georgia'], [/times|tinos/i, 'Times New Roman'],
  [/courier|cousine/i, 'Courier New'], [/verdana|tahoma/i, 'Verdana'], [/trebuchet/i, 'Trebuchet MS'], [/impact|anton|bebas/i, 'Impact'],
  [/serif|garamond|playfair|merriweather|lora|georgia|baskerville|bodoni|didot|caslon|crimson|libre ?baskerville|pt serif|dm serif/i, 'Times New Roman'],
];
function mapFont(fontName, report) {
  const fam = cleanText(fontName?.family || '').slice(0, 60), st = String(fontName?.style || '');
  let font = null;
  for (const [re, f] of FONT_RULES) if (re.test(fam)) { font = f; break; }
  if (/sans/i.test(fam) && font === 'Times New Roman') font = null;
  if (!font) font = /^(sf|roboto|open sans|lato|montserrat|poppins|nunito|work sans|dm sans|manrope|ibm plex sans|source sans|noto sans|raleway|rubik|karla|mulish|figtree|geist)/i.test(fam) ? 'Studio Inter' : 'Arial';
  const weight = /thin|hairline/i.test(st) ? 100 : /extra ?light|ultra ?light/i.test(st) ? 200 : /light/i.test(st) ? 300 : /medium/i.test(st) ? 500 : /semi ?bold|demi/i.test(st) ? 600 : /extra ?bold|ultra ?bold/i.test(st) ? 800 : /black|heavy/i.test(st) ? 900 : /bold/i.test(st) ? 700 : 400;
  const italic = /italic|oblique/i.test(st);
  const lbl = FONTS.find(([f]) => f === font)?.[1] || font;
  const substituted = !!fam && fam.toLowerCase() !== lbl.toLowerCase() && !(font === 'Studio Inter' && /^inter\b/i.test(fam));
  if (substituted) report.fonts.set(fam, lbl);
  return { font, weight, italic, substituted };
}

// ------------------------------------------------------------------ public API

/**
 * Import a .fig file (File | Blob | ArrayBuffer | Uint8Array). EXPERIMENTAL.
 * Returns { doc, report }.
 */
export async function importFig(input, { onProgress = null, name = null } = {}) {
  let bytes;
  if (input instanceof Uint8Array) bytes = input;
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (input && typeof input.arrayBuffer === 'function') {
    if (input.size > FIG_LIMITS.bytes) throw new Error('This .fig file is too large to import.');
    bytes = new Uint8Array(await input.arrayBuffer());
  } else throw new Error('Nothing to import.');
  if (bytes.length > FIG_LIMITS.bytes) throw new Error('This .fig file is too large to import.');
  const report = new Report();
  const baseName = cleanName(name || (input && input.name ? String(input.name).replace(/\.fig$/i, '') : ''), 'Imported design');
  onProgress?.(0.05, 'Reading file…');

  let canvas = null, zipBytes = null, meta = null;
  if (isFigKiwi(bytes)) canvas = bytes;
  else if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    zipBytes = bytes;
    let files;
    try {
      files = unzipSync(bytes, { filter: (f) => (f.name === 'canvas.fig' || f.name === 'meta.json') && f.originalSize <= FIG_LIMITS.entry });
    } catch (e) { throw new Error('This .fig archive is damaged.'); }
    canvas = files['canvas.fig'];
    if (!canvas) throw new Error('This ZIP file has no canvas.fig inside, so it is not a .fig design file.');
    try { if (files['meta.json'] && files['meta.json'].length < 1e6) meta = JSON.parse(new TextDecoder().decode(files['meta.json'])); } catch (e) { meta = null; }
  } else throw new Error('This is not a .fig file.');

  onProgress?.(0.2, 'Decoding document…');
  let parsed;
  try { parsed = parseFigKiwi(canvas); }
  catch (e) { throw new Error((e && e.message && /^(This|The)/.test(e.message)) ? e.message : 'This .fig file could not be decoded: ' + String(e && e.message || e).slice(0, 160)); }
  report.version = parsed.version;
  const msg = parsed.message;
  const ncs = Array.isArray(msg.nodeChanges) ? msg.nodeChanges : [];
  if (!ncs.length) throw new Error('This .fig file contains no layers.');
  if (ncs.length > FIG_LIMITS.nodes) { report.truncated = true; report.u(`Only the first ${FIG_LIMITS.nodes} layers were read`); }
  const blobs = Array.isArray(msg.blobs) ? msg.blobs.map((b) => (b && b.bytes instanceof Uint8Array ? b.bytes : new Uint8Array(0))) : [];

  // ---------------------------------------------------------- tree
  const byId = new Map(), kids = new Map();
  for (const nc of ncs.slice(0, FIG_LIMITS.nodes)) {
    if (!nc || !nc.guid || nc.phase === 'REMOVED') continue;
    byId.set(gk(nc.guid), nc);
  }
  for (const [id, nc] of byId) {
    const p = nc.parentIndex && gk(nc.parentIndex.guid);
    if (!p || !byId.has(p) || p === id) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(nc);
  }
  for (const list of kids.values()) list.sort((a, b) => { const pa = String(a.parentIndex.position || ''), pb = String(b.parentIndex.position || ''); return pa < pb ? -1 : pa > pb ? 1 : 0; });
  const childrenOf = (nc) => kids.get(gk(nc.guid)) || [];
  const docNode = [...byId.values()].find((n) => n.type === 'DOCUMENT');
  let pages = docNode ? childrenOf(docNode).filter((n) => n.type === 'CANVAS') : [...byId.values()].filter((n) => n.type === 'CANVAS');
  if (!pages.length) throw new Error('This .fig file has no pages.');
  const internal = pages.filter((p) => p.internalOnly);
  pages = pages.filter((p) => !p.internalOnly);
  if (!pages.length) pages = internal;

  // ---------------------------------------------------------- images
  const imageHashes = new Set();
  for (const nc of byId.values()) for (const p of nc.fillPaints || []) if (p && p.type === 'IMAGE' && p.image && p.image.hash) imageHashes.add(hashHex(p.image.hash));
  const imageFiles = new Map();
  if (zipBytes && imageHashes.size) {
    try {
      const want = new Set([...imageHashes].slice(0, FIG_LIMITS.images).map((h) => 'images/' + h));
      const files = unzipSync(zipBytes, { filter: (f) => want.has(f.name) && f.originalSize <= FIG_LIMITS.imageBytes });
      for (const [k, v] of Object.entries(files)) imageFiles.set(k.slice(7), v);
    } catch (e) { report.u('Embedded images could not be unpacked'); }
  }
  const imageCache = new Map();

  // ---------------------------------------------------------- conversion
  const budget = { out: 0, points: 0, images: 0 };
  const full = () => budget.out >= FIG_LIMITS.outNodes || budget.points >= FIG_LIMITS.points;
  const doc = { id: uid('d'), name: baseName, created: Date.now(), artboards: [], items: [], meta: { source: 'fig' } };
  if (meta && typeof meta.file_name === 'string' && !name) doc.name = cleanName(meta.file_name, baseName);

  const group = (nm, children, nc) => ({ id: uid('n'), type: 'group', name: cleanName(nm, 'Group'), hidden: nc ? nc.visible === false : false, locked: !!(nc && nc.locked), style: { opacity: clamp(fin(nc?.opacity, 1), 0, 1), blend: BLEND[nc?.blendMode] || 'normal' }, children });

  function paintOf(p, sps, M, w, h) {
    // Figma paint → model paint (solid / linear / radial), or null.
    if (!p || p.visible === false) return null;
    const op = clamp(fin(p.opacity, 1), 0, 1);
    if (p.type === 'SOLID') return { kind: 'solid', color: hexOf(p.color), a: clamp(fin(p.color?.a, 1) * op, 0, 1) };
    if (/^GRADIENT_/.test(p.type)) {
      const stops = (p.stops || []).slice(0, 32).map((s) => ({ o: clamp(fin(s.position), 0, 1), color: hexOf(s.color), a: clamp(fin(s.color?.a, 1) * op, 0, 1) })).sort((a, b) => a.o - b.o);
      if (!stops.length) return null;
      if (stops.length === 1) stops.push({ ...stops[0], o: 1 });
      const bb = bbOfSps(sps) || { x: 0, y: 0, w: 1, h: 1 };
      const inv = invert(matOf(p.transform));
      const toDoc = (u, v) => { const [x, y] = apply(inv, u, v); return apply(M, x * w, y * h); };
      const N = ([x, y]) => [clamp((x - bb.x) / (bb.w || 1), -10, 10), clamp((y - bb.y) / (bb.h || 1), -10, 10)];
      report.counts.gradients++;
      if (p.type === 'GRADIENT_LINEAR') {
        const [x1, y1] = N(toDoc(0, 0.5)), [x2, y2] = N(toDoc(1, 0.5));
        if (Math.abs((bb.w || 1) / (bb.h || 1) - 1) > 0.05) report.a('Linear gradient angle approximated on a non-square shape');
        return { kind: 'linear', x1, y1, x2, y2, stops };
      }
      if (p.type !== 'GRADIENT_RADIAL') report.a(p.type === 'GRADIENT_ANGULAR' ? 'Angular gradients approximated as radial' : 'Diamond gradients approximated as radial');
      const [x1, y1] = N(toDoc(0.5, 0.5)), [x2, y2] = N(toDoc(1, 0.5));
      const T = p.transform;
      if (T && (Math.abs(fin(T.m01)) > 1e-4 || Math.abs(fin(T.m10)) > 1e-4 || Math.abs(Math.abs(fin(T.m00, 1)) - Math.abs(fin(T.m11, 1))) > 1e-3)) report.a('Rotated / skewed radial gradient approximated');
      return { kind: 'radial', x1, y1, x2, y2, stops };
    }
    return null;
  }
  function strokeProps(nc, M) {
    const cap = { NONE: 'butt', ROUND: 'round', SQUARE: 'square' }[nc.strokeCap] || 'butt';
    if (nc.strokeCap && !['NONE', 'ROUND', 'SQUARE'].includes(nc.strokeCap)) report.u('Arrow / marker stroke end caps');
    const join = { MITER: 'miter', BEVEL: 'bevel', ROUND: 'round' }[nc.strokeJoin] || 'miter';
    const s = detScale(M);
    const dash = Array.isArray(nc.dashPattern) && nc.dashPattern.some((v) => v > 0) ? nc.dashPattern.slice(0, 16).map((v) => String(Math.round(Math.max(0, fin(v)) * s * 100) / 100)).join(' ') : '';
    return { sw: clamp(fin(nc.strokeWeight, 1) * s, 0, 1000), cap, join, dash };
  }
  function pushPath(out, sps, style, nm, nc, evenodd = false) {
    if (!sps.length || full()) { if (full()) report.truncated = true; return null; }
    const pts = sps.reduce((a, sp) => a + sp.pts.length, 0);
    if (budget.points + pts > FIG_LIMITS.points) { report.truncated = true; budget.points = FIG_LIMITS.points; return null; }
    budget.points += pts; budget.out++;
    const n = { id: uid('n'), type: 'path', name: cleanName(nm, 'Path'), hidden: nc ? nc.visible === false : false, locked: !!(nc && nc.locked), subpaths: sps, fillRule: evenodd ? 'evenodd' : 'nonzero', style: { fill: null, stroke: null, sw: 1, cap: 'butt', join: 'miter', dash: '', opacity: 1, blend: 'normal', ...style } };
    out.push(n); report.counts.paths++;
    return n;
  }
  function geometry(nc, key) {
    const out = [];
    let evenodd = false;
    for (const g of nc[key] || []) {
      const b = blobs[g && g.commandsBlob];
      if (!b || !b.length) continue;
      if (g.windingRule === 'ODD' || g.windingRule === 'EVENODD') evenodd = true;
      out.push(...decodeCommands(b));
    }
    return { sps: out, evenodd };
  }

  async function imageNode(p, nc, M, w, h) {
    if (budget.images >= FIG_LIMITS.images) { report.u(`Images beyond the first ${FIG_LIMITS.images} were skipped`); return null; }
    const hash = p.image && p.image.hash ? hashHex(p.image.hash) : null;
    let data = hash ? imageFiles.get(hash) : null;
    if (!data && p.image && typeof p.image.dataBlob === 'number') data = blobs[p.image.dataBlob] || null;
    if (!data) { report.u('Image fills whose picture is not inside the file'); return null; }
    let bmp = imageCache.get(hash || data);
    if (bmp === undefined) {
      bmp = null;
      const type = data[0] === 0x89 && data[1] === 0x50 ? 'image/png' : data[0] === 0xff && data[1] === 0xd8 ? 'image/jpeg' : data[0] === 0x47 && data[1] === 0x49 ? 'image/gif' : data[0] === 0x52 && data[8] === 0x57 ? 'image/webp' : null;
      if (type) { try { bmp = { img: await createImageBitmap(new Blob([data], { type })), type }; } catch (e) { bmp = null; } }
      imageCache.set(hash || data, bmp);
    }
    if (!bmp) { report.u('Undecodable image fill skipped'); return null; }
    const iw = bmp.img.width, ih = bmp.img.height;
    if (!(iw > 0 && ih > 0 && w > 0 && h > 0)) return null;
    // crop / fit according to the scale mode
    const mode = p.imageScaleMode || 'FILL';
    let sx = 0, sy = 0, sw = iw, sh = ih, dx = 0, dy = 0, dw = w, dh = h;
    if (mode === 'FILL') { const s = Math.max(w / iw, h / ih); sw = w / s; sh = h / s; sx = (iw - sw) / 2; sy = (ih - sh) / 2; }
    else if (mode === 'FIT') { const s = Math.min(w / iw, h / ih); dw = iw * s; dh = ih * s; dx = (w - dw) / 2; dy = (h - dh) / 2; }
    else if (mode === 'TILE') report.a('Tiled image fills stretched to the layer');
    else if (p.transform) report.a('Cropped image fills shown uncropped');
    const k = Math.min(1, FIG_LIMITS.imagePixels / Math.max(sw, sh));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(bmp.img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const src = bmp.type === 'image/jpeg' ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png');
    const tf = mul(M, [dw / c.width, 0, 0, dh / c.height, dx, dy]);
    budget.images++; budget.out++; report.counts.images++;
    return { id: uid('n'), type: 'image', name: cleanName(nc.name, 'Image'), hidden: nc.visible === false, locked: !!nc.locked, src, w: c.width, h: c.height, tf, style: { opacity: clamp(fin(p.opacity, 1), 0, 1), blend: BLEND[p.blendMode] || 'normal' } };
  }

  /** Shape layers (fills + strokes) for a node whose local outline is `local` (subpaths). */
  async function shapeNodes(nc, M, local, evenodd, out) {
    const w = fin(nc.size?.x), h = fin(nc.size?.y);
    const sps = xformSps(local, M);
    const fills = (nc.fillPaints || []).filter((p) => p && p.visible !== false);
    const strokes = (nc.strokePaints || []).filter((p) => p && p.visible !== false);
    const hasStroke = strokes.length && fin(nc.strokeWeight, 1) > 0;
    let n = 0;
    for (const p of fills) {
      if (p.type === 'IMAGE') {
        const img = await imageNode(p, nc, M, w, h);
        if (img) { out.push(img); n++; if (nc.type !== 'RECTANGLE' && nc.type !== 'FRAME' || fin(nc.cornerRadius) > 0) report.a('Image fills are not masked to rounded or non-rectangular shapes'); }
        continue;
      }
      const paint = paintOf(p, sps, M, w, h);
      if (!paint) { report.u(`${String(p.type || 'Unknown').replace(/_/g, ' ').toLowerCase()} fills`); continue; }
      if (pushPath(out, sps.map((sp) => ({ closed: sp.closed, pts: sp.pts.map((q) => ({ ...q })) })), { fill: paint, blend: BLEND[p.blendMode] || 'normal' }, nc.name, nc, evenodd)) n++;
    }
    if (hasStroke) {
      const align = nc.strokeAlign || 'CENTER';
      const sp = strokes[strokes.length - 1];
      if (strokes.length > 1) report.a('Multiple strokes reduced to the top one');
      const outline = align !== 'CENTER' ? geometry(nc, 'strokeGeometry') : { sps: [] };
      if (outline.sps.length) {
        const osps = xformSps(outline.sps, M);
        const paint = paintOf(sp, osps, M, w, h);
        if (paint && pushPath(out, osps, { fill: paint }, (nc.name || 'Path') + ' stroke', nc, false)) { n++; report.a('Inside / outside strokes converted to outlined shapes'); }
      } else {
        const paint = paintOf(sp, sps, M, w, h);
        if (paint) {
          if (align !== 'CENTER') report.a('Inside / outside strokes drawn centred');
          const last = n && out[out.length - 1];
          if (last && last.type === 'path' && !last.style.stroke && fills.length === 1) Object.assign(last.style, { stroke: paint, ...strokeProps(nc, M) });
          else if (pushPath(out, sps, { stroke: paint, ...strokeProps(nc, M) }, nc.name, nc, evenodd)) n++;
        }
      }
    }
    return n;
  }

  function mergeOverride(nc, overrides) {
    if (!overrides || !overrides.size) return nc;
    const o = overrides.get(gk(nc.guid)) || (nc.overrideKey && overrides.get(gk(nc.overrideKey)));
    if (!o) return nc;
    const merged = { ...nc };
    for (const [k, v] of Object.entries(o)) if (!['guid', 'guidPath', 'parentIndex', 'type', 'phase', 'overrideKey'].includes(k) && !/Tag$/.test(k)) merged[k] = v;
    return merged;
  }
  function childOverrides(nc, overrides) {
    // overrides addressed "through" this nested instance: strip its key from the path
    const out = new Map();
    if (!overrides) return out;
    const keys = [gk(nc.guid), nc.overrideKey ? gk(nc.overrideKey) : null].filter(Boolean);
    for (const [k, v] of overrides) for (const key of keys) if (k.startsWith(key + '/')) out.set(k.slice(key.length + 1), v);
    return out;
  }

  async function convert(nc0, parentM, out, ctx) {
    if (full()) { report.truncated = true; return; }
    const nc = mergeOverride(nc0, ctx.overrides);
    const type = nc.type;
    if (type === 'SLICE' || type === 'CANVAS' || type === 'DOCUMENT') return;
    const M = mul(parentM, matOf(nc.transform));
    const w = fin(nc.size?.x), h = fin(nc.size?.y);
    for (const e of nc.effects || []) if (e && e.visible !== false) report.u(`${String(e.type || 'Unknown').replace(/_/g, ' ').toLowerCase()} effects are not rendered`);
    if (nc.mask) report.a('Mask layers kept as hidden shapes (masking not applied)');
    const before = out.length;

    if (type === 'FRAME' || type === 'SYMBOL' || type === 'INSTANCE' || type === 'SECTION' || type === 'COMPONENT_SET' || type === 'GROUP' || (type === 'BOOLEAN_OPERATION' && !(nc.fillGeometry || []).length)) {
      const inner = [];
      if (type !== 'GROUP' && type !== 'BOOLEAN_OPERATION' && ((nc.fillPaints || []).length || (nc.strokePaints || []).length)) {
        const r = fin(nc.cornerRadius);
        const local = nc.rectangleCornerRadiiIndependent ? (geometry(nc, 'fillGeometry').sps.length ? geometry(nc, 'fillGeometry').sps : rectPath(0, 0, w, h, r)) : rectPath(0, 0, w, h, r);
        await shapeNodes({ ...nc, name: (nc.name || 'Frame') + ' background', effects: null, visible: true, opacity: 1 }, M, local, false, inner);
      }
      let kidsList = childrenOf(nc0);
      let kidCtx = ctx;
      if (type === 'INSTANCE' && !kidsList.length && nc.symbolData && nc.symbolData.symbolID) {
        const sym = byId.get(gk(nc.symbolData.symbolID));
        if (!sym) report.u('Component instances whose main component is not in this file');
        else if (ctx.depth >= FIG_LIMITS.instanceDepth || ctx.stack.has(gk(sym.guid))) report.u('Deeply nested / recursive component instances');
        else {
          const ov = new Map(childOverrides(nc0, ctx.overrides));
          for (const o of nc.symbolData.symbolOverrides || []) { const path = (o.guidPath?.guids || []).map(gk).join('/'); if (path) ov.set(path, o); }
          kidsList = childrenOf(sym);
          const sw = fin(sym.size?.x, w), sh = fin(sym.size?.y, h);
          const scale = sw > 0 && sh > 0 && (Math.abs(sw - w) > 0.5 || Math.abs(sh - h) > 0.5) ? [w / sw, 0, 0, h / sh, 0, 0] : null;
          if (scale) report.a('Resized component instances scaled (constraints / auto layout not re-run)');
          kidCtx = { depth: ctx.depth + 1, stack: new Set([...ctx.stack, gk(sym.guid)]), overrides: ov, pre: scale };
          report.a('Component instances converted to plain groups');
        }
      } else if (type === 'INSTANCE') {
        report.a('Component instances converted to plain groups');
        kidCtx = { ...ctx, overrides: childOverrides(nc0, ctx.overrides) };
      }
      const childM = kidCtx.pre && kidCtx !== ctx ? mul(M, kidCtx.pre) : M;
      if (kidCtx.pre) kidCtx = { ...kidCtx, pre: null };
      for (const k of kidsList) await convert(k, childM, inner, kidCtx);
      if (type === 'SYMBOL') report.a('Main components converted to plain groups');
      if (nc.stackMode && nc.stackMode !== 'NONE') report.a('Auto layout baked into fixed positions');
      if ((type === 'FRAME' || type === 'SYMBOL' || type === 'INSTANCE') && nc.frameMaskDisabled !== true && inner.length) {
        const fb = bbOfSps(xformSps(rectPath(0, 0, w, h, 0), M));
        const over = (b) => b && fb && (b.x < fb.x - 0.5 || b.y < fb.y - 0.5 || b.x + b.w > fb.x + fb.w + 0.5 || b.y + b.h > fb.y + fb.h + 0.5);
        const check = (n) => n.type === 'group' ? n.children.some(check) : n.type === 'path' ? over(bbOfSps(n.subpaths)) : n.type === 'image' ? over(bbOfSps([{ pts: [[0, 0], [n.w, 0], [0, n.h], [n.w, n.h]].map(([x, y]) => { const q = apply(n.tf, x, y); return { x: q[0], y: q[1] }; }) }])) : false;
        if (inner.some(check)) report.a('Content overflowing a clipping frame is not clipped');
      }
      if (type === 'BOOLEAN_OPERATION') report.a('Boolean groups without stored result kept as separate shapes');
      if (inner.length) { out.push(group(nc.name || type.toLowerCase(), inner, nc)); report.counts.groups++; }
    } else if (type === 'TEXT') {
      const t = textNode(nc, M);
      if (t) { out.push(t); budget.out++; report.counts.texts++; }
    } else {
      let local = null, evenodd = false;
      if ((type === 'RECTANGLE' || type === 'ROUNDED_RECTANGLE') && !nc.rectangleCornerRadiiIndependent) local = rectPath(0, 0, w, h, fin(nc.cornerRadius));
      else if (type === 'ELLIPSE' && !(nc.arcData && (Math.abs(fin(nc.arcData.startingAngle)) > 1e-4 || Math.abs(fin(nc.arcData.endingAngle, Math.PI * 2) - Math.PI * 2) > 1e-4 || fin(nc.arcData.innerRadius) > 0))) local = ellipsePath(w / 2, h / 2, w / 2, h / 2);
      else if (type === 'LINE') local = [{ closed: false, pts: [{ x: 0, y: 0, hi: null, ho: null, smooth: false }, { x: w, y: 0, hi: null, ho: null, smooth: false }] }];
      if (!local) {
        const g = geometry(nc, 'fillGeometry');
        if (g.sps.length) { local = g.sps; evenodd = g.evenodd; }
      }
      if (!local && (type === 'STAR' || type === 'REGULAR_POLYGON') && w > 0 && h > 0) {
        const count = Math.max(3, Math.min(100, fin(nc.count, type === 'STAR' ? 5 : 3)));
        const inner = type === 'STAR' ? clamp(fin(nc.starInnerScale, 0.38), 0.01, 1) : 1;
        const pts = [];
        const steps = type === 'STAR' ? count * 2 : count;
        for (let i = 0; i < steps; i++) { const a = -Math.PI / 2 + i / steps * Math.PI * 2, r = type === 'STAR' && i % 2 ? inner : 1; pts.push({ x: w / 2 + Math.cos(a) * w / 2 * r, y: h / 2 + Math.sin(a) * h / 2 * r, hi: null, ho: null, smooth: false }); }
        local = [{ closed: true, pts }];
      }
      if (!local) {
        // Open vectors store only the outlined stroke: draw it as a filled shape.
        const g = geometry(nc, 'strokeGeometry');
        const sp = (nc.strokePaints || []).filter((p) => p && p.visible !== false).pop();
        if (g.sps.length && sp) {
          const sps = xformSps(g.sps, M);
          const paint = paintOf(sp, sps, M, w, h);
          if (paint) { pushPath(out, sps, { fill: paint, opacity: clamp(fin(nc.opacity, 1), 0, 1), blend: BLEND[nc.blendMode] || 'normal' }, nc.name, nc, false); report.a('Open vector strokes imported as outlined shapes'); }
        } else if (!['VECTOR', 'STAR', 'REGULAR_POLYGON', 'BOOLEAN_OPERATION', 'ELLIPSE', 'RECTANGLE', 'ROUNDED_RECTANGLE'].includes(type)) report.u(`${String(type || 'Unknown').replace(/_/g, ' ').toLowerCase()} layers`);
        else report.u('Vector layers without stored geometry');
      } else {
        const tmp = [];
        await shapeNodes(nc, M, local, evenodd, tmp);
        const op = clamp(fin(nc.opacity, 1), 0, 1), blend = BLEND[nc.blendMode] || 'normal';
        if (tmp.length === 1) { const t = tmp[0]; t.style.opacity = (t.style.opacity ?? 1) * op; if (blend !== 'normal') t.style.blend = blend; t.name = cleanName(nc.name, t.name); out.push(t); }
        else if (tmp.length > 1) { out.push(group(nc.name || 'Shape', tmp, nc)); report.counts.groups++; }
        if (type === 'BOOLEAN_OPERATION') report.a('Boolean groups flattened to their result shape');
      }
    }
    if (nc.mask) for (let i = before; i < out.length; i++) out[i].hidden = true;
    if (nc.visible === false) for (let i = before; i < out.length; i++) out[i].hidden = true;
  }

  function textNode(nc, M) {
    const td = nc.textData || {};
    let text = cleanText(td.characters);
    if (!text) return null;
    const size = clamp(fin(nc.fontSize, 12), 1, 2000);
    const fm = mapFont(nc.fontName, report);
    const tc = nc.textCase;
    if (tc === 'UPPER') text = text.toUpperCase(); else if (tc === 'LOWER') text = text.toLowerCase(); else if (tc === 'TITLE') text = text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    if (tc && tc !== 'ORIGINAL') report.a('Text case applied to the characters');
    if (nc.textDecoration && nc.textDecoration !== 'NONE') report.u('Underline / strikethrough text decoration');
    if (Array.isArray(td.characterStyleIDs) && new Set(td.characterStyleIDs).size > 1) report.a('Mixed text styles in one text layer flattened to the base style');
    let tracking = 0;
    const ls = nc.letterSpacing;
    if (ls && fin(ls.value)) tracking = ls.units === 'PERCENT' ? fin(ls.value) * 10 : fin(ls.value) / size * 1000;
    let leading = 1.2;
    const lh = nc.lineHeight;
    if (lh && fin(lh.value) > 0) {
      if (lh.units === 'PIXELS') leading = fin(lh.value) / size;
      else if (lh.units === 'PERCENT') leading = fin(lh.value) === 100 ? 1.2 : fin(lh.value) / 100;
      else leading = fin(lh.value);
    }
    leading = clamp(leading, 0.5, 5);
    const align = { CENTER: 'center', RIGHT: 'right' }[nc.textAlignHorizontal] || 'left';
    if (nc.textAlignHorizontal === 'JUSTIFIED') report.a('Justified text set left-aligned');
    const w = fin(nc.size?.x);
    const area = nc.textAutoResize !== 'WIDTH_AND_HEIGHT' && w > 0;
    const b0 = Array.isArray(td.baselines) && td.baselines[0];
    const baseline = b0 ? (b0.position && Number.isFinite(b0.position.y) ? b0.position.y : fin(b0.lineY) + fin(b0.lineAscent)) : (size * leading - size) / 2 + size * 0.8;
    let x0 = 0;
    if (!area) { if (align === 'center') x0 = w / 2; else if (align === 'right') x0 = w; }
    const fill = (nc.fillPaints || []).filter((p) => p && p.visible !== false && p.type === 'SOLID').pop();
    if ((nc.fillPaints || []).some((p) => p && p.visible !== false && p.type !== 'SOLID')) report.a('Gradient / image text fills replaced by a solid colour');
    if (!area && fm.substituted) report.a('Auto-width text measured with a substitute font (widths may differ)');
    return {
      id: uid('n'), type: 'text', name: cleanName(nc.name, text.slice(0, 24)), hidden: nc.visible === false, locked: !!nc.locked, text, font: fm.font, size, weight: fm.weight, italic: fm.italic,
      tracking: Math.round(clamp(tracking, -500, 2000)), leading, align, width: area ? w : 0, tf: mul(M, [1, 0, 0, 1, x0, baseline]),
      style: { fill: fill ? { kind: 'solid', color: hexOf(fill.color), a: clamp(fin(fill.color?.a, 1) * fin(fill.opacity, 1), 0, 1) } : { kind: 'solid', color: '#000000', a: 1 }, stroke: null, sw: 1, cap: 'butt', join: 'miter', dash: '', opacity: clamp(fin(nc.opacity, 1), 0, 1), blend: BLEND[nc.blendMode] || 'normal' },
    };
  }

  // ---------------------------------------------------------- pages → artboards
  let cursorX = null;
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    onProgress?.(0.3 + 0.65 * pi / pages.length, cleanName(page.name, 'Page ' + (pi + 1)));
    const top = childrenOf(page);
    if (!top.length) continue;
    // page bounds (from sizes + transforms) to lay pages out side by side
    let minX = Infinity, maxX = -Infinity;
    for (const t of top) { const m = matOf(t.transform), w = fin(t.size?.x), h = fin(t.size?.y); for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) { const p = apply(m, x, y); minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); } }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 0; }
    const dx = cursorX === null ? 0 : cursorX - minX;
    cursorX = maxX + dx + PAGE_GAP;
    const P = [1, 0, 0, 1, dx, 0];
    const pageName = cleanName(page.name, 'Page ' + (pi + 1));
    report.counts.pages++;
    for (const t of top) {
      if (full()) { report.truncated = true; break; }
      const isBoard = (t.type === 'FRAME' || t.type === 'SYMBOL' || t.type === 'COMPONENT_SET') && doc.artboards.length < FIG_LIMITS.artboards && fin(t.size?.x) >= 1 && fin(t.size?.y) >= 1;
      if (isBoard) {
        const m = mul(P, matOf(t.transform)), w = fin(t.size?.x), h = fin(t.size?.y);
        const cs = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => apply(m, x, y));
        const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
        const fills = (t.fillPaints || []).filter((p) => p && p.visible !== false);
        const solidBg = fills.length === 1 && fills[0].type === 'SOLID' && fin(fills[0].color?.a, 1) * fin(fills[0].opacity, 1) >= 0.999 && Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6 && !fin(t.cornerRadius) && !(t.strokePaints || []).some((p) => p && p.visible !== false);
        doc.artboards.push({ id: uid('ab'), name: cleanName((pages.length > 1 ? pageName + ' / ' : '') + (t.name || 'Frame'), 'Artboard'), x: Math.min(...xs), y: Math.min(...ys), w: clamp(Math.max(...xs) - Math.min(...xs), 1, 20000), h: clamp(Math.max(...ys) - Math.min(...ys), 1, 20000), bg: solidBg ? hexOf(fills[0].color) : null });
        report.counts.artboards++;
        const tt = solidBg ? { ...t, fillPaints: [] } : t;
        const before = doc.items.length;
        await convert(tt, P, doc.items, { depth: 0, stack: new Set(), overrides: null });
        if (doc.items.length === before) { /* empty frame: artboard only */ }
      } else await convert(t, P, doc.items, { depth: 0, stack: new Set(), overrides: null });
    }
  }
  if (!doc.artboards.length) {
    // no top-level frames: one artboard around everything
    const all = [];
    const walkB = (n) => { if (n.type === 'group') n.children.forEach(walkB); else if (n.type === 'path') { const b = bbOfSps(n.subpaths); if (b) all.push(b); } else if (n.tf) all.push({ x: n.tf[4], y: n.tf[5] - (n.size || 0), w: n.w || (n.size || 12) * 4, h: n.h || n.size || 12 }); };
    doc.items.forEach(walkB);
    const x0 = Math.min(...all.map((b) => b.x), 0), y0 = Math.min(...all.map((b) => b.y), 0), x1 = Math.max(...all.map((b) => b.x + b.w), 100), y1 = Math.max(...all.map((b) => b.y + b.h), 100);
    doc.artboards.push({ id: uid('ab'), name: 'Artboard 1', x: x0 - 40, y: y0 - 40, w: clamp(x1 - x0 + 80, 1, 20000), h: clamp(y1 - y0 + 80, 1, 20000), bg: '#ffffff' });
    report.counts.artboards = 1;
  }
  if (!doc.items.length) report.u('No drawable layers were found');
  onProgress?.(1, 'Done');
  const clean = validateDoc(doc);
  clean.name = doc.name; clean.meta = { source: 'fig' };
  return { doc: clean, report: report.out() };
}

function hashHex(h) {
  if (h instanceof Uint8Array) return Array.from(h.subarray(0, 64), (b) => b.toString(16).padStart(2, '0')).join('');
  if (Array.isArray(h)) return h.slice(0, 64).map((b) => (b & 255).toString(16).padStart(2, '0')).join('');
  if (h && typeof h === 'object') return Object.keys(h).sort((a, b) => a - b).slice(0, 64).map((k) => (h[k] & 255).toString(16).padStart(2, '0')).join('');
  return '';
}
