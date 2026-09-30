// EYAD VECTOR — PDF and .ai importer.
//
// PDF pages (and .ai files saved with PDF compatibility, which are PDFs) are
// converted into EDITABLE vector nodes — nothing is rasterised except embedded
// bitmap images. pdf.js (Apache-2.0, vendored) parses the file in a worker; we
// walk each page's operator list (paths, colours, strokes, transforms, clips,
// opacity, shadings, images) and use its text layer for editable text.
//
// Legacy PostScript-only .ai files (%!PS-Adobe…) are read with a small parser
// for the basic path / colour operators; anything else is reported honestly.
//
// Files are untrusted: sizes, page counts, nodes and points are capped, fonts
// are never evaluated (isEvalSupported: false, disableFontFace: true) and all
// output goes through the model's validateDoc.
import { uid } from '../core/dom.js';
import { validateDoc, mul, apply, invert, FONTS, measure } from './model.js';
import { paperReady, toPaper, fromPaper } from './pathops.js';

const PDFJS_URL = new URL('../../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const WORKER_URL = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const CMAPS_URL = new URL('../../vendor/pdfjs/cmaps/', import.meta.url).href;

export const PDF_LIMITS = {
  bytes: 256 * 1024 * 1024,  // input file
  pages: 100,                // artboards the model allows
  nodes: 120000,             // leaves the importer will create (validateDoc budget is 200k)
  points: 2500000,           // total anchor points
  images: 400,
  imagePixels: 4096,         // longest side of an embedded bitmap after downscaling
  clipOps: 4000,             // boolean clip intersections
  textItems: 30000,
  ops: 3000000,              // operator-list entries walked per document
};
const PX = 96 / 72;          // PDF points → EYAD px (the vector PDF exporter uses the inverse)
const PAGE_GAP = 80;

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  const lib = await import(PDFJS_URL);
  lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  pdfjs = lib;
  return lib;
}

// ------------------------------------------------------------------ small helpers

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const rgbHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
const cmykHex = (c, m, y, k) => rgbHex(255 * (1 - Math.min(1, c + k)), 255 * (1 - Math.min(1, m + k)), 255 * (1 - Math.min(1, y + k)));
const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const detScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const cleanText = (s) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f￾￿]/g, '').slice(0, 20000);
const nearly = (a, b, e = 0.01) => Math.abs(a - b) < e;
const bbOfPts = (sps) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of sps) for (const p of sp.pts) {
    for (const [x, y] of [[p.x, p.y], p.hi || [p.x, p.y], p.ho || [p.x, p.y]]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const bbInter = (a, b) => { if (!a || !b) return null; const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const bbInside = (inner, outer, e = 0.5) => inner.x >= outer.x - e && inner.y >= outer.y - e && inner.x + inner.w <= outer.x + outer.w + e && inner.y + inner.h <= outer.y + outer.h + e;
const bbOfRectM = (m, x, y, w, h) => { const c = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => apply(m, a, b)); const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
const countPts = (sps) => sps.reduce((s, sp) => s + sp.pts.length, 0);

class Report {
  constructor(source) { this.source = source; this.counts = { pages: 0, paths: 0, texts: 0, images: 0, gradients: 0, groups: 0, artboards: 0 }; this.approx = new Map(); this.unsupported = new Map(); this.fonts = new Map(); this.truncated = false; }
  a(msg, n = 1) { this.approx.set(msg, (this.approx.get(msg) || 0) + n); }
  u(msg, n = 1) { this.unsupported.set(msg, (this.unsupported.get(msg) || 0) + n); }
  out() {
    const list = (m) => [...m].map(([k, v]) => (v > 1 ? `${k} (×${v})` : k));
    const c = this.counts;
    return {
      source: this.source, ...c, truncated: this.truncated,
      approximations: list(this.approx), unsupported: list(this.unsupported),
      fontSubstitutions: [...this.fonts].map(([from, to]) => `${from} → ${to}`),
      summary: `${c.pages} page${c.pages === 1 ? '' : 's'}: ${c.paths} path${c.paths === 1 ? '' : 's'}, ${c.texts} text object${c.texts === 1 ? '' : 's'}, ${c.images} image${c.images === 1 ? '' : 's'}${c.gradients ? `, ${c.gradients} gradient fill${c.gradients === 1 ? '' : 's'}` : ''}.${this.truncated ? ' The file hit a safety limit, so not everything was imported.' : ''}`,
    };
  }
}

// ------------------------------------------------------------------ fonts

const FONT_RULES = [
  [/^CMTT|^CMSLTT|^CMITT|^SFTT|^LMMono/i, 'Courier New'], [/^CMSS|^SFSS|^LMSans/i, 'Arial'], [/^(CM|SF|LM|MS[AB]M|EU[FRS]M)[A-Z]{1,5}\d/i, 'Times New Roman'],
  [/inter(?![a-z])|inter-|interdisplay/i, 'Studio Inter'], [/oswald/i, 'Studio Oswald'], [/jetbrains/i, 'Studio Mono'],
  [/helvetica|helv\b/i, 'Helvetica'], [/arial|liberationsans|nimbussan|arimo/i, 'Arial'],
  [/georgia/i, 'Georgia'], [/times|liberationserif|nimbusrom|tinos|tiro/i, 'Times New Roman'],
  [/courier|nimbusmon|liberationmono|cousine/i, 'Courier New'], [/consol|menlo|monaco|mono|fixed|code/i, 'Studio Mono'],
  [/verdana|tahoma|dejavusans/i, 'Verdana'], [/trebuchet/i, 'Trebuchet MS'], [/impact|anton|bebas|league.?gothic/i, 'Impact'],
  [/garamond|cambria|minion|palatino|baskerville|bookman|caslon|didot|bodoni|serif|roman|book|merriweather|lora|playfair/i, 'Times New Roman'],
  [/calibri|segoe|roboto|open.?sans|lato|montserrat|poppins|source.?sans|noto.?sans|myriad|frutiger|futura|gill|avenir|sf.?pro|ubuntu|sans|gothic|grotesk/i, 'Arial'],
];
function mapFont(rawName, generic, report) {
  const name = String(rawName || '').replace(/^[A-Z]{6}\+/, '');
  let font = null;
  for (const [re, f] of FONT_RULES) if (re.test(name)) { font = f; break; }
  if (!font) font = /serif/i.test(generic || '') && !/sans/i.test(generic || '') ? 'Times New Roman' : /mono/i.test(generic || '') ? 'Courier New' : 'Arial';
  const weight = /black|heavy|ultra.?bold|extra.?bold/i.test(name) ? 800 : /semi.?bold|demi/i.test(name) ? 600 : /bold|medi(?!um)|\.B\b|\.BI\b|-bd\b|bd$/i.test(name) ? 700 : /medium/i.test(name) ? 500 : /light|thin/i.test(name) ? 300 : 400;
  const italic = /ital|oblique|slant|-it\b|\bit$|\.I\b|\.BI\b|MI\d*$/i.test(name);
  if (!FONTS.some(([f]) => f === font)) font = 'Arial';
  const shown = name.slice(0, 60) || generic || 'unnamed font';
  const lbl = FONTS.find(([f]) => f === font)?.[1] || font;
  const flat = (v) => String(v).toLowerCase().replace(/[^a-z]/g, '');
  if (!flat(shown).includes(flat(lbl))) report.fonts.set(shown, lbl);
  return { font, weight, italic };
}

// ------------------------------------------------------------------ paint conversion

function normStops(colorStops, alpha) {
  let stops = [];
  for (const cs of colorStops || []) {
    const o = clamp(fin(Number(cs[0])), 0, 1), c = cs[1];
    if (isHex(c)) stops.push({ o, color: c.toLowerCase(), a: alpha });
    else stops.push({ o, color: null, a: 0 }); // 'transparent' background stop
  }
  stops.forEach((s, i) => { if (!s.color) s.color = (stops[i - 1] && stops[i - 1].color) || (stops.find((x) => x.color)?.color) || '#000000'; });
  stops.sort((a, b) => a.o - b.o);
  if (stops.length > 32) {
    // resample evenly (pdf.js samples functions finely; the model keeps ≤ 32 stops)
    const out = [];
    const at = (t) => { let i = 0; while (i < stops.length - 2 && stops[i + 1].o < t) i++; const a = stops[i], b = stops[i + 1]; const k = b.o > a.o ? clamp((t - a.o) / (b.o - a.o), 0, 1) : 0; const ca = parseInt(a.color.slice(1), 16), cb = parseInt(b.color.slice(1), 16); const ch = (s) => ((ca >> s) & 255) * (1 - k) + ((cb >> s) & 255) * k; return { o: t, color: rgbHex(ch(16), ch(8), ch(0)), a: a.a * (1 - k) + b.a * k }; };
    for (let i = 0; i < 32; i++) out.push(at(i / 31));
    stops = out;
  }
  if (stops.length === 1) stops.push({ ...stops[0], o: 1 });
  return stops;
}

/** Shading IR (pdf.js) + matrix into doc space → model paint relative to the target's bounds. */
function shadingToPaint(ir, m, bb, alpha, report) {
  if (!ir || !bb) return null;
  if (ir[0] === 'RadialAxial') {
    const [, type, , colorStops, p0, p1, r0, r1] = ir;
    let stops = normStops(colorStops, alpha);
    if (!stops.length) return null;
    const w = bb.w || 1, h = bb.h || 1;
    const N = (pt) => [(pt[0] - bb.x) / w, (pt[1] - bb.y) / h];
    const L = (v) => clamp(fin(v), -10, 10);
    if (type === 'axial') {
      const [x1, y1] = N(apply(m, p0[0], p0[1])), [x2, y2] = N(apply(m, p1[0], p1[1]));
      if (Math.abs(w / h - 1) > 0.05) report.a('Linear gradient angle approximated on a non-square shape');
      report.counts.gradients++;
      return { kind: 'linear', x1: L(x1), y1: L(y1), x2: L(x2), y2: L(y2), stops };
    }
    const s = detScale(m), R = Math.max(1e-6, fin(r1) * s), R0 = fin(r0) * s;
    const c = apply(m, p1[0], p1[1]);
    if (R0 > 0.01 && R > R0) stops = stops.map((st) => ({ ...st, o: clamp((R0 + st.o * (R - R0)) / R, 0, 1) }));
    if (Math.hypot(p0[0] - p1[0], p0[1] - p1[1]) * s > 0.5) report.a('Radial gradient focal point moved to the centre');
    if (Math.abs(w / h - 1) > 0.05) report.a('Radial gradient stretched to the shape’s bounding box');
    const [x1, y1] = N(c);
    report.counts.gradients++;
    return { kind: 'radial', x1: L(x1), y1: L(y1), x2: L(x1 + R / w), y2: L(y1), stops };
  }
  if (ir[0] === 'Mesh') {
    const col = ir[3];
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i + 2 < (col?.length || 0) && n < 5000; i += 3, n++) { r += col[i]; g += col[i + 1]; b += col[i + 2]; }
    report.a('Mesh / free-form gradient replaced by its average colour');
    return n ? { kind: 'solid', color: rgbHex(r / n, g / n, b / n), a: alpha } : null;
  }
  return null;
}

// ------------------------------------------------------------------ public API

/** Quick look at a PDF / .ai: { pages, kind: 'pdf'|'ai-pdf'|'ai-ps' }. */
export async function pdfInfo(input) {
  const bytes = await toBytes(input);
  const kind = sniff(bytes);
  if (kind === 'ps') return { pages: 1, kind: 'ai-ps' };
  if (kind !== 'pdf') throw new Error('This file is not a PDF.');
  const lib = await loadPdfjs();
  const task = lib.getDocument(docParams(lib, bytes));
  try { const doc = await task.promise; return { pages: doc.numPages, kind: isAiName(input) ? 'ai-pdf' : 'pdf' }; }
  catch (e) { throw friendly(e); }
  finally { task.destroy(); }
}

/**
 * Import a PDF or .ai (File | Blob | ArrayBuffer | Uint8Array).
 * opts.pages: 'all' | [1, 3, …] (1-based). opts.onProgress(fraction, label).
 * Returns { doc, report }.
 */
export async function importPdf(input, { pages = 'all', onProgress = null, name = null } = {}) {
  const bytes = await toBytes(input);
  const baseName = cleanText(name || (input && input.name ? String(input.name).replace(/\.[a-z0-9]{1,5}$/i, '') : 'Imported PDF')).slice(0, 120) || 'Imported PDF';
  const kind = sniff(bytes);
  if (kind === 'ps') return importLegacyAI(bytes, baseName);
  if (kind !== 'pdf') throw new Error('This file is not a PDF (no %PDF header found).');
  const lib = await loadPdfjs();
  const report = new Report(isAiName(input) ? 'ai' : 'pdf');
  const task = lib.getDocument(docParams(lib, bytes));
  let pdf;
  try { pdf = await task.promise; } catch (e) { task.destroy(); throw friendly(e); }
  try {
    let list = pages === 'all' || !Array.isArray(pages) ? Array.from({ length: pdf.numPages }, (_, i) => i + 1) : [...new Set(pages.map((p) => Math.round(Number(p))))].filter((p) => p >= 1 && p <= pdf.numPages).sort((a, b) => a - b);
    if (!list.length) throw new Error('None of the requested pages exist in this PDF.');
    if (list.length > PDF_LIMITS.pages) { report.u(`Only the first ${PDF_LIMITS.pages} pages were imported (artboard limit)`); list = list.slice(0, PDF_LIMITS.pages); report.truncated = true; }
    const ocConfig = await pdf.getOptionalContentConfig().catch(() => null);
    const budget = { nodes: 0, points: 0, images: 0, clipOps: 0, text: 0, ops: 0 };
    const doc = { id: uid('d'), name: baseName, created: Date.now(), artboards: [], items: [], meta: { source: 'pdf' } };
    let x = 0;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      onProgress?.(i / list.length, `Page ${n} of ${pdf.numPages}`);
      const page = await pdf.getPage(n);
      const res = await convertPage(lib, page, n, x, ocConfig, report, budget);
      doc.artboards.push(res.artboard);
      if (res.group.children.length) { doc.items.push(res.group); report.counts.groups++; }
      x += res.artboard.w + PAGE_GAP;
      report.counts.pages++;
      page.cleanup();
      if (budget.nodes >= PDF_LIMITS.nodes || budget.points >= PDF_LIMITS.points || budget.ops >= PDF_LIMITS.ops) {
        if (i < list.length - 1) report.u(`Stopped after page ${n}: the document is too complex to import in full`);
        report.truncated = true; break;
      }
    }
    onProgress?.(1, 'Done');
    report.counts.artboards = doc.artboards.length;
    const clean = validateDoc(doc);
    clean.name = baseName;
    clean.meta = { source: report.source };
    return { doc: clean, report: report.out() };
  } finally {
    task.destroy();
  }
}

function isAiName(input) { return !!(input && typeof input.name === 'string' && /\.ai$/i.test(input.name)); }
async function toBytes(input) {
  let bytes;
  if (input instanceof Uint8Array) bytes = input;
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (input && typeof input.arrayBuffer === 'function') {
    if (input.size > PDF_LIMITS.bytes) throw new Error(`This file is too large to import (over ${Math.round(PDF_LIMITS.bytes / 1048576)} MB).`);
    bytes = new Uint8Array(await input.arrayBuffer());
  } else throw new Error('Nothing to import.');
  if (bytes.length > PDF_LIMITS.bytes) throw new Error(`This file is too large to import (over ${Math.round(PDF_LIMITS.bytes / 1048576)} MB).`);
  if (bytes.length < 8) throw new Error('This file is empty or truncated.');
  return bytes;
}
/** 'pdf' when %PDF- appears in the first 1 KB (the spec allows leading junk), 'ps' for %!PS-Adobe. */
export function sniff(bytes) {
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(1024, bytes.length)));
  if (head.startsWith('%!PS-Adobe')) {
    // Some .ai files wrap PDF data after a PostScript header; prefer the PDF part when present.
    return 'ps';
  }
  return head.includes('%PDF-') ? 'pdf' : 'unknown';
}
function docParams(lib, bytes) {
  return {
    data: bytes.slice(), // pdf.js transfers the buffer to its worker
    isEvalSupported: false, disableFontFace: true, fontExtraProperties: false, useSystemFonts: false,
    isOffscreenCanvasSupported: false, enableXfa: false, stopAtErrors: false,
    cMapUrl: CMAPS_URL, cMapPacked: true,
    verbosity: lib.VerbosityLevel ? lib.VerbosityLevel.ERRORS : 0,
    maxImageSize: 64e6,
  };
}
function friendly(e) {
  const n = e && e.name;
  if (n === 'PasswordException') return new Error('This PDF is password-protected. Remove the password in the app that made it, then import again.');
  if (n === 'InvalidPDFException') return new Error('This PDF is damaged or not a valid PDF file.');
  return new Error('Could not read this PDF: ' + String((e && e.message) || e).slice(0, 200));
}

// ------------------------------------------------------------------ page conversion

function objGet(page, id) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 8000);
    const store = typeof id === 'string' && id.startsWith('g_') ? page.commonObjs : page.objs;
    try { store.get(id, (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } }); }
    catch (e) { clearTimeout(t); resolve(null); }
  });
}
function objGetSync(page, id) {
  try { const store = typeof id === 'string' && id.startsWith('g_') ? page.commonObjs : page.objs; return store.has(id) ? store.get(id) : null; } catch (e) { return null; }
}

async function convertPage(lib, page, pageNo, offsetX, ocConfig, report, budget) {
  const OPS = lib.OPS;
  let vp = page.getViewport({ scale: PX });
  let s = 1;
  if (vp.width > 20000 || vp.height > 20000) { s = 20000 / Math.max(vp.width, vp.height); vp = page.getViewport({ scale: PX * s }); report.a(`Page ${pageNo} was scaled down to fit the 20000 px artboard limit`); }
  const W = Math.max(1, Math.round(vp.width * 100) / 100), H = Math.max(1, Math.round(vp.height * 100) / 100);
  const base = mul([1, 0, 0, 1, offsetX, 0], vp.transform);
  const artboard = { id: uid('ab'), name: 'Page ' + pageNo, x: offsetX, y: 0, w: W, h: H, bg: '#ffffff' };
  const pageRect = { x: offsetX, y: 0, w: W, h: H };
  const group = { id: uid('n'), type: 'group', name: 'Page ' + pageNo, hidden: false, locked: false, style: { opacity: 1, blend: 'normal' }, children: [] };
  const out = group.children;

  const opList = await page.getOperatorList({ annotationMode: lib.AnnotationMode ? lib.AnnotationMode.ENABLE_FORMS : undefined });
  const { fnArray, argsArray } = opList;
  const N = Math.min(fnArray.length, Math.max(0, PDF_LIMITS.ops - budget.ops));
  if (N < fnArray.length) report.truncated = true;
  budget.ops += N;

  const init = () => ({ ctm: base, fill: { t: 'solid', color: '#000000' }, stroke: { t: 'solid', color: '#000000' }, fa: 1, sa: 1, ga: 1, lw: 1, cap: 'butt', join: 'miter', dash: null, blend: 'normal', clip: [], textMode: 0, patternBase: base, smask: false });
  let st = init();
  const stack = [];
  let overflow = 0;
  const push = () => { if (stack.length < 400) stack.push({ ...st }); else overflow++; };
  const pop = () => { if (overflow) overflow--; else if (stack.length) st = stack.pop(); };
  const ocStack = [];
  let visible = true;
  let path = [];          // subpaths in doc coords
  let cur = null;         // current subpath
  let pendingClip = null; // 'nonzero' | 'evenodd'
  const textRuns = [];    // colours of shown glyphs for the text layer
  const stop = () => budget.nodes >= PDF_LIMITS.nodes || budget.points >= PDF_LIMITS.points;
  const P = (x, y) => apply(st.ctm, x, y);

  const moveTo = (x, y) => { const [X, Y] = P(x, y); cur = { closed: false, pts: [{ x: X, y: Y, hi: null, ho: null, smooth: false }] }; path.push(cur); };
  const lineTo = (x, y) => { if (!cur) { moveTo(x, y); return; } const [X, Y] = P(x, y); cur.pts.push({ x: X, y: Y, hi: null, ho: null, smooth: false }); };
  const curveTo = (x1, y1, x2, y2, x3, y3) => {
    if (!cur) moveTo(x1, y1);
    const last = cur.pts[cur.pts.length - 1];
    last.ho = P(x1, y1);
    const [X, Y] = P(x3, y3);
    cur.pts.push({ x: X, y: Y, hi: P(x2, y2), ho: null, smooth: false });
  };
  const closePath = () => {
    if (!cur || cur.closed) return;
    cur.closed = true;
    const a = cur.pts[0], z = cur.pts[cur.pts.length - 1];
    if (cur.pts.length > 1 && nearly(a.x, z.x) && nearly(a.y, z.y)) { a.hi = z.hi; cur.pts.pop(); }
    // a new subpath starts at the same point if drawing continues
    const start = cur.pts[0];
    cur = { closed: false, pts: [{ x: start.x, y: start.y, hi: null, ho: null, smooth: false }], _implicit: true };
    path.push(cur);
  };
  const livePath = () => path.filter((sp) => sp.pts.length > 1).map((sp) => ({ closed: sp.closed, pts: sp.pts }));

  function clipDecision(bb) {
    // → 'in' (fully visible), 'out' (fully clipped), or 'partial'
    if (!bb) return 'out';
    let partial = false;
    for (const c of st.clip) {
      if (!bbInter(c.bb, bb)) return 'out';
      if (!(c.isRect && bbInside(bb, c.bb))) partial = true;
    }
    return partial ? 'partial' : 'in';
  }
  async function clipSubpaths(sps, rule) {
    // Returns clipped subpaths, [] when fully clipped, or null when clipping could not be applied.
    if (budget.clipOps >= PDF_LIMITS.clipOps) return null;
    try {
      await paperReady();
      let shape = toPaper({ type: 'path', subpaths: sps, fillRule: rule });
      for (const c of st.clip) {
        const bb = bbOfPts(sps);
        if (c.isRect && bb && bbInside(bb, c.bb)) continue;
        budget.clipOps++;
        const cp = toPaper({ type: 'path', subpaths: c.sps, fillRule: c.rule });
        const res = shape.intersect(cp, { insert: false });
        shape = res;
        sps = fromPaper(res);
        if (!sps.length) return [];
      }
      return fromPaper(shape);
    } catch (e) { return null; }
  }

  function strokeStyle() {
    const sc = detScale(st.ctm);
    let dash = '';
    if (st.dash && st.dash[0] && st.dash[0].length) {
      const arr = st.dash[0].slice(0, 16).map((v) => Math.max(0, fin(Number(v)) * sc));
      if (arr.some((v) => v > 0)) dash = arr.map((v) => String(Math.round(v * 100) / 100)).join(' ');
      if (fin(st.dash[1])) report.a('Dash phase offsets ignored');
    }
    const lw = st.lw > 0 ? st.lw * sc : 1;
    if (!(st.lw > 0)) report.a('Hairline strokes set to 1 px');
    if (Math.abs(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2]) - (st.ctm[0] ** 2 + st.ctm[1] ** 2)) > 0.01 * (st.ctm[0] ** 2 + st.ctm[1] ** 2) + 1e-9) report.a('Stroke width averaged under non-uniform scaling');
    return { sw: Math.min(1000, lw), cap: st.cap, join: st.join, dash };
  }
  function paintFor(p, alpha, bb) {
    if (!p) return null;
    if (p.t === 'solid') return { kind: 'solid', color: p.color, a: clamp(alpha, 0, 1) };
    if (p.t === 'shading') return shadingToPaint(p.ir, p.m, bb, alpha, report);
    if (p.t === 'flat') return { kind: 'solid', color: p.color, a: clamp(alpha, 0, 1) };
    return null;
  }

  async function emitPath(fill, stroke, evenodd) {
    const sps = livePath();
    path = []; cur = null;
    const clipRule = pendingClip; pendingClip = null;
    // W / W* take effect after the painting operator that ends the path.
    const clipEntry = !clipRule ? null : sps.length
      ? { sps: sps.map((sp) => ({ closed: true, pts: sp.pts.map((q) => ({ ...q, hi: q.hi && [...q.hi], ho: q.ho && [...q.ho] })) })), rule: clipRule, bb: bbOfPts(sps) || { x: 0, y: 0, w: 0, h: 0 }, isRect: isAxisRect(sps) }
      : { sps: [], rule: clipRule, bb: { x: -1e9, y: -1e9, w: 0, h: 0 }, isRect: true };
    try { await paintPath(sps, fill, stroke, evenodd); }
    finally { if (clipEntry) st.clip = [...st.clip, clipEntry]; }
  }
  async function paintPath(sps, fill, stroke, evenodd) {
    if ((!fill && !stroke) || !sps.length || !visible || stop()) return;
    const doFill = fill && st.fill && sps.length;
    const doStroke = stroke && st.stroke;
    if (!doFill && !doStroke) return;
    let geo = sps;
    let bb = bbOfPts(geo);
    const decision = clipDecision(bb);
    if (decision === 'out') return;
    if (decision === 'partial') {
      if (doFill && !doStroke) {
        const c = await clipSubpaths(geo, evenodd ? 'evenodd' : 'nonzero');
        if (c === null) report.a('Clipping masks not applied (shapes kept whole)');
        else if (!c.length) return;
        else { geo = c; bb = bbOfPts(geo); }
      } else report.a('Clipping masks not applied to strokes (shapes kept whole)');
    }
    const ga = st.ga;
    const style = { fill: null, stroke: null, sw: 1, cap: 'butt', join: 'miter', dash: '', opacity: 1, blend: st.blend };
    if (doFill) style.fill = paintFor(st.fill, st.fa * ga, bb);
    if (doStroke) {
      const sp = paintFor(st.stroke, st.sa * ga, bb);
      style.stroke = sp && sp.kind !== 'solid' && sp.kind !== 'linear' && sp.kind !== 'radial' ? null : sp;
      Object.assign(style, strokeStyle());
    }
    if (!style.fill && !style.stroke) return;
    const pts = countPts(geo);
    if (budget.points + pts > PDF_LIMITS.points) { report.truncated = true; budget.points = PDF_LIMITS.points; return; }
    budget.points += pts; budget.nodes++;
    const node = { id: uid('n'), type: 'path', name: style.fill && style.stroke ? 'Path' : style.stroke ? 'Stroke' : 'Shape', hidden: false, locked: false, subpaths: geo.map((sp) => ({ closed: sp.closed, pts: sp.pts })), fillRule: evenodd ? 'evenodd' : 'nonzero', style };
    node.keepStroke = true;
    out.push(node);
    report.counts.paths++;
  }

  function isAxisRect(sps) {
    if (sps.length !== 1) return false;
    const p = sps[0].pts;
    if (p.length !== 4 || p.some((q) => q.hi || q.ho)) return false;
    const xs = new Set(p.map((q) => Math.round(q.x * 100))), ys = new Set(p.map((q) => Math.round(q.y * 100)));
    return xs.size <= 2 && ys.size <= 2;
  }

  async function emitShadingFill(objId) {
    if (!visible || stop()) return;
    const ir = await objGet(page, objId);
    if (!ir) return;
    // Region = current clip (intersected), else the page.
    let region = [{ closed: true, pts: [[pageRect.x, pageRect.y], [pageRect.x + pageRect.w, pageRect.y], [pageRect.x + pageRect.w, pageRect.y + pageRect.h], [pageRect.x, pageRect.y + pageRect.h]].map(([x, y]) => ({ x, y, hi: null, ho: null, smooth: false })) }];
    let rule = 'nonzero';
    const clips = st.clip.filter((c) => c.sps.length);
    if (clips.length) {
      const last = clips[clips.length - 1];
      region = last.sps.map((sp) => ({ closed: true, pts: sp.pts.map((q) => ({ ...q })) })); rule = last.rule;
      if (clips.length > 1) {
        const saved = st.clip; st.clip = clips.slice(0, -1);
        const c = await clipSubpaths(region, rule);
        st.clip = saved;
        if (c && !c.length) return;
        if (c) { region = c; rule = 'nonzero'; }
      }
    }
    const bb = bbOfPts(region);
    if (!bb || !bbInter(bb, pageRect)) return;
    const paint = shadingToPaint(ir, st.ctm, bb, st.fa * st.ga, report);
    if (!paint) { report.u('Unsupported shading type skipped'); return; }
    budget.nodes++; budget.points += countPts(region);
    out.push({ id: uid('n'), type: 'path', name: 'Gradient', hidden: false, locked: false, subpaths: region, fillRule: rule, style: { fill: paint, stroke: null, sw: 1, cap: 'butt', join: 'miter', dash: '', opacity: 1, blend: st.blend } });
    report.counts.paths++;
  }

  async function emitImage(img, m, { mask = false, name = 'Image' } = {}) {
    if (!visible || stop() || !img) return;
    if (budget.images >= PDF_LIMITS.images) { report.u(`Images beyond the first ${PDF_LIMITS.images} were skipped`); report.truncated = true; return; }
    const w = img.width | 0, h = img.height | 0;
    if (!(w > 0 && h > 0) || w * h > 64e6) { report.u('Oversized or empty image skipped'); return; }
    let tf = mul(m, [1 / w, 0, 0, -1 / h, 0, 1]);
    const bb = bbOfRectM(tf, 0, 0, w, h);
    const decision = clipDecision(bb);
    if (decision === 'out') return;
    // source canvas
    let c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    try {
      if (img.bitmap) g.drawImage(img.bitmap, 0, 0);
      else if (img.data) {
        const id = g.createImageData(w, h), d = id.data, src = img.data;
        if (mask) {
          const col = st.fill && (st.fill.t === 'solid' || st.fill.t === 'flat') ? parseInt(st.fill.color.slice(1), 16) : 0;
          const r = (col >> 16) & 255, gg = (col >> 8) & 255, b = col & 255, stride = (w + 7) >> 3;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const bit = (src[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1, o = (y * w + x) * 4;
            d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = bit ? 0 : 255;
          }
        } else if (img.kind === 3) d.set(src.subarray(0, d.length));
        else if (img.kind === 2) { for (let i = 0, j = 0; i < w * h; i++, j += 3) { d[i * 4] = src[j]; d[i * 4 + 1] = src[j + 1]; d[i * 4 + 2] = src[j + 2]; d[i * 4 + 3] = 255; } }
        else if (img.kind === 1) {
          const stride = (w + 7) >> 3;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = (src[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0, o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }
        } else { report.u('Image in an unsupported pixel format skipped'); return; }
        g.putImageData(id, 0, 0);
      } else return;
    } catch (e) { report.u('Undecodable image skipped'); return; }
    let W2 = w, H2 = h;
    // Crop to an axis-aligned rectangular clip (the common "cropped photo" case).
    if (decision === 'partial') {
      const axis = Math.abs(tf[1]) < 1e-9 && Math.abs(tf[2]) < 1e-9;
      if (axis && st.clip.every((cl) => cl.isRect || bbInside(bb, cl.bb))) {
        let r = { ...bb };
        for (const cl of st.clip) r = bbInter(r, cl.bb) || { x: 0, y: 0, w: 0, h: 0 };
        if (r.w < 0.5 || r.h < 0.5) return;
        const inv = invert(tf);
        const [ax, ay] = apply(inv, r.x, r.y), [bx, by] = apply(inv, r.x + r.w, r.y + r.h);
        const x0 = clamp(Math.floor(Math.min(ax, bx)), 0, w), y0 = clamp(Math.floor(Math.min(ay, by)), 0, h), x1 = clamp(Math.ceil(Math.max(ax, bx)), 0, w), y1 = clamp(Math.ceil(Math.max(ay, by)), 0, h);
        if (x1 - x0 < 1 || y1 - y0 < 1) return;
        if (x0 > 0 || y0 > 0 || x1 < w || y1 < h) {
          const cc = document.createElement('canvas'); cc.width = x1 - x0; cc.height = y1 - y0;
          cc.getContext('2d').drawImage(c, -x0, -y0);
          c = cc; tf = mul(tf, [1, 0, 0, 1, x0, y0]); W2 = cc.width; H2 = cc.height;
        }
      } else report.a('Clipping masks not applied to images');
    }
    // downscale very large bitmaps
    const k = Math.min(1, PDF_LIMITS.imagePixels / Math.max(W2, H2));
    if (k < 1) {
      const cc = document.createElement('canvas'); cc.width = Math.max(1, Math.round(W2 * k)); cc.height = Math.max(1, Math.round(H2 * k));
      cc.getContext('2d').drawImage(c, 0, 0, cc.width, cc.height);
      tf = mul(tf, [W2 / cc.width, 0, 0, H2 / cc.height, 0, 0]); c = cc; W2 = cc.width; H2 = cc.height;
      report.a('Very large images downscaled to 4096 px');
    }
    const alpha = mask || img.kind === 3 || img.bitmap;
    const src = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
    if (!/^data:image\/(png|jpeg);base64,/.test(src)) return;
    budget.images++; budget.nodes++;
    out.push({ id: uid('n'), type: 'image', name, hidden: false, locked: false, src, w: W2, h: H2, tf, style: { opacity: clamp(st.fa * st.ga, 0, 1), blend: st.blend } });
    report.counts.images++;
  }

  // ---------------------------------------------------------- walk operators
  const O = OPS;
  for (let i = 0; i < N; i++) {
    const fn = fnArray[i], args = argsArray[i];
    switch (fn) {
      case O.save: push(); break;
      case O.restore: pop(); break;
      case O.transform: st.ctm = mul(st.ctm, args.map((v) => fin(v))); break;
      case O.setLineWidth: st.lw = fin(args[0], 1); break;
      case O.setLineCap: st.cap = ['butt', 'round', 'square'][args[0]] || 'butt'; break;
      case O.setLineJoin: st.join = ['miter', 'round', 'bevel'][args[0]] || 'miter'; break;
      case O.setDash: st.dash = [Array.isArray(args[0]) ? args[0] : [], args[1]]; break;
      case O.setGState:
        for (const [key, value] of args[0] || []) {
          if (key === 'LW') st.lw = fin(value, 1);
          else if (key === 'LC') st.cap = ['butt', 'round', 'square'][value] || 'butt';
          else if (key === 'LJ') st.join = ['miter', 'round', 'bevel'][value] || 'miter';
          else if (key === 'D') st.dash = [value[0] || [], value[1]];
          else if (key === 'CA') st.sa = clamp(fin(value, 1), 0, 1);
          else if (key === 'ca') st.fa = clamp(fin(value, 1), 0, 1);
          else if (key === 'BM') { const b = value === 'source-over' ? 'normal' : String(value); st.blend = ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].includes(b) ? b : 'normal'; }
          else if (key === 'SMask' && value) { st.smask = true; report.a('Soft masks (luminosity/alpha masks) ignored'); }
          else if (key === 'TR' && value) report.a('Transfer functions ignored');
        }
        break;
      case O.setFillRGBColor: st.fill = { t: 'solid', color: typeof args[0] === 'string' && isHex(args[0]) ? args[0] : rgbHex(args[0], args[1], args[2]) }; break;
      case O.setStrokeRGBColor: st.stroke = { t: 'solid', color: typeof args[0] === 'string' && isHex(args[0]) ? args[0] : rgbHex(args[0], args[1], args[2]) }; break;
      case O.setFillGray: st.fill = { t: 'solid', color: rgbHex(args[0] * 255, args[0] * 255, args[0] * 255) }; break;
      case O.setStrokeGray: st.stroke = { t: 'solid', color: rgbHex(args[0] * 255, args[0] * 255, args[0] * 255) }; break;
      case O.setFillCMYKColor: st.fill = { t: 'solid', color: cmykHex(...args) }; break;
      case O.setStrokeCMYKColor: st.stroke = { t: 'solid', color: cmykHex(...args) }; break;
      case O.setFillTransparent: st.fill = null; break;
      case O.setStrokeTransparent: st.stroke = null; break;
      case O.setFillColorN: case O.setStrokeColorN: {
        const isFill = fn === O.setFillColorN;
        let paint = null;
        if (args[0] === 'Shading') {
          const ir = await objGet(page, args[1]);
          paint = ir ? { t: 'shading', ir, m: mul(st.patternBase, args[2] || [1, 0, 0, 1, 0, 0]) } : null;
        } else if (args[0] === 'TilingPattern') {
          let color = null;
          if (args[7] === 2 && args[1]) color = typeof args[1] === 'string' ? args[1] : rgbHex(args[1][0], args[1][1], args[1][2]);
          else {
            const ol = args[2];
            const k = ol && ol.fnArray ? ol.fnArray.indexOf(O.setFillRGBColor) : -1;
            if (k >= 0) { const a = ol.argsArray[k]; color = typeof a[0] === 'string' ? a[0] : rgbHex(a[0], a[1], a[2]); }
          }
          report.a('Tiling (repeating) patterns replaced by a flat colour');
          paint = { t: 'flat', color: isHex(color) ? color : '#808080' };
        }
        if (isFill) st.fill = paint; else st.stroke = paint;
        break;
      }
      case O.constructPath: {
        const [ops, coords] = args;
        let j = 0;
        for (const op of ops) {
          if (op === O.moveTo) { moveTo(coords[j], coords[j + 1]); j += 2; }
          else if (op === O.lineTo) { lineTo(coords[j], coords[j + 1]); j += 2; }
          else if (op === O.curveTo) { curveTo(coords[j], coords[j + 1], coords[j + 2], coords[j + 3], coords[j + 4], coords[j + 5]); j += 6; }
          else if (op === O.curveTo2) { // v: first control point = current point
            const cp = cur ? cur.pts[cur.pts.length - 1] : null;
            const inv = invert(st.ctm), q = cp ? apply(inv, cp.x, cp.y) : [coords[j], coords[j + 1]];
            curveTo(q[0], q[1], coords[j], coords[j + 1], coords[j + 2], coords[j + 3]); j += 4;
          } else if (op === O.curveTo3) { curveTo(coords[j], coords[j + 1], coords[j + 2], coords[j + 3], coords[j + 2], coords[j + 3]); j += 4; }
          else if (op === O.closePath) closePath();
          else if (op === O.rectangle) {
            const x = coords[j], y = coords[j + 1], w = coords[j + 2], h = coords[j + 3]; j += 4;
            moveTo(x, y); lineTo(x + w, y); lineTo(x + w, y + h); lineTo(x, y + h); closePath();
          }
        }
        break;
      }
      case O.closePath: closePath(); break;
      case O.fill: await emitPath(true, false, false); break;
      case O.eoFill: await emitPath(true, false, true); break;
      case O.stroke: await emitPath(false, true, false); break;
      case O.closeStroke: closePath(); await emitPath(false, true, false); break;
      case O.fillStroke: await emitPath(true, true, false); break;
      case O.eoFillStroke: await emitPath(true, true, true); break;
      case O.closeFillStroke: closePath(); await emitPath(true, true, false); break;
      case O.closeEOFillStroke: closePath(); await emitPath(true, true, true); break;
      case O.endPath: await emitPath(false, false, false); break;
      case O.clip: pendingClip = 'nonzero'; break;
      case O.eoClip: pendingClip = 'evenodd'; break;
      case O.shadingFill: await emitShadingFill(args[0]); break;
      case O.paintFormXObjectBegin: {
        push();
        if (args[0]) st.ctm = mul(st.ctm, args[0]);
        st.patternBase = st.ctm;
        const bb = args[1];
        if (Array.isArray(bb) && bb.length === 4) {
          const [x0, y0, x1, y1] = bb, m = st.ctm;
          const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => apply(m, x, y));
          const sps = [{ closed: true, pts: corners.map(([x, y]) => ({ x, y, hi: null, ho: null, smooth: false })) }];
          st.clip = [...st.clip, { sps, rule: 'nonzero', bb: bbOfPts(sps), isRect: isAxisRect(sps) }];
        }
        break;
      }
      case O.paintFormXObjectEnd: pop(); break;
      case O.beginGroup: {
        push();
        const grp = args[0] || {};
        st.ga = st.ga * st.fa; st.fa = 1; st.sa = 1;
        if (grp.smask) report.a('Soft masks (luminosity/alpha masks) ignored');
        if (grp.knockout) report.a('Knockout groups flattened');
        break;
      }
      case O.endGroup: pop(); break;
      case O.beginAnnotation: {
        push();
        const [, rect, transform, matrix] = args;
        st = init();
        if (Array.isArray(rect)) {
          const sps = [{ closed: true, pts: [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]].map(([x, y]) => { const [X, Y] = apply(base, x, y); return { x: X, y: Y, hi: null, ho: null, smooth: false }; }) }];
          st.clip = [{ sps, rule: 'nonzero', bb: bbOfPts(sps), isRect: isAxisRect(sps) }];
        }
        if (transform) st.ctm = mul(st.ctm, transform);
        if (matrix) st.ctm = mul(st.ctm, matrix);
        st.patternBase = st.ctm;
        break;
      }
      case O.endAnnotation: pop(); break;
      case O.paintImageXObject: { const img = await objGet(page, args[0]); await emitImage(img, st.ctm); break; }
      case O.paintInlineImageXObject: await emitImage(args[0], st.ctm, { name: 'Inline image' }); break;
      case O.paintImageXObjectRepeat: {
        const img = await objGet(page, args[0]);
        const [, sx, sy, pos] = args;
        for (let k = 0; img && pos && k < pos.length && k < 400; k += 2) await emitImage(img, mul(st.ctm, [sx, 0, 0, sy, pos[k], pos[k + 1]]));
        break;
      }
      case O.paintImageMaskXObject: {
        const a = args[0]; const img = typeof a?.data === 'string' ? await objGet(page, a.data) : a;
        await emitImage(img && { ...img, width: img.width || a.width, height: img.height || a.height }, st.ctm, { mask: true, name: 'Stencil mask' });
        break;
      }
      case O.paintImageMaskXObjectGroup: for (const im of (args[0] || []).slice(0, 400)) await emitImage(im, mul(st.ctm, im.transform || [1, 0, 0, 1, 0, 0]), { mask: true, name: 'Stencil mask' }); break;
      case O.paintImageMaskXObjectRepeat: {
        const a = args[0]; const img = typeof a?.data === 'string' ? await objGet(page, a.data) : a;
        const [, sx, kx, ky, sy, pos] = args;
        for (let k = 0; img && pos && k < pos.length && k < 400; k += 2) await emitImage({ ...img, width: img.width || a.width, height: img.height || a.height }, mul(st.ctm, [sx, kx, ky, sy, pos[k], pos[k + 1]]), { mask: true, name: 'Stencil mask' });
        break;
      }
      case O.paintSolidColorImageMask: {
        const sps = [{ closed: true, pts: [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => { const [X, Y] = P(x, y); return { x: X, y: Y, hi: null, ho: null, smooth: false }; }) }];
        path = sps; cur = null; await emitPath(true, false, false);
        break;
      }
      case O.paintInlineImageXObjectGroup: report.u('Inline image atlases (rare) skipped'); break;
      case O.setTextRenderingMode: st.textMode = args[0] | 0; break;
      case O.showText: case O.showSpacedText: case O.nextLineShowText: case O.nextLineSetSpacingShowText: {
        const glyphs = args[args.length - 1];
        if (!Array.isArray(glyphs)) break;
        const mode = st.textMode & 3;
        const p = mode === 1 ? st.stroke : st.fill;
        const color = p && (p.t === 'solid' || p.t === 'flat') ? p.color : p && p.t === 'shading' ? (p.ir?.[3]?.[0]?.[1] || '#000000') : '#000000';
        let txt = '';
        for (const gl of glyphs) if (gl && typeof gl === 'object' && typeof gl.unicode === 'string') txt += gl.unicode;
        if (txt) textRuns.push({ at: out.length, txt: txt.normalize('NFKC').replace(/\s+/g, ''), color: isHex(color) ? color : '#000000', a: (mode === 1 ? st.sa : st.fa) * st.ga, invisible: mode === 3, visible, stroke: mode === 1 });
        break;
      }
      case O.beginMarkedContentProps: {
        let vis = true;
        if (args[0] === 'OC' && ocConfig && args[1]) { try { vis = ocConfig.isVisible(args[1]); } catch (e) { vis = true; } }
        ocStack.push(vis); visible = ocStack.every(Boolean);
        if (!vis) report.a('Hidden optional-content layers skipped');
        break;
      }
      case O.beginMarkedContent: ocStack.push(true); break;
      case O.endMarkedContent: ocStack.pop(); visible = ocStack.every(Boolean); break;
      default: break;
    }
    if (budget.nodes >= PDF_LIMITS.nodes || budget.points >= PDF_LIMITS.points) { report.truncated = true; break; }
  }

  // ---------------------------------------------------------- text layer
  if (budget.text < PDF_LIMITS.textItems && !stop()) {
    let tc = null;
    try { tc = await page.getTextContent({ includeMarkedContent: false }); } catch (e) { report.u('Text layer could not be read'); }
    if (tc) {
      // Stream of shown glyphs (no whitespace) with colours, to colour text items.
      let stream = '', colors = [];
      for (const r of textRuns) { stream += r.txt; for (let k = 0; k < r.txt.length; k++) colors.push(r); }
      let ptr = 0;
      let invisible = 0;
      const placed = [];
      const LIG = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
      for (const it of tc.items) {
        if (budget.text >= PDF_LIMITS.textItems || stop()) { report.truncated = true; break; }
        if (!it || typeof it.str !== 'string') continue;
        const text = cleanText(it.str).replace(/[ﬀ-ﬆ]/g, (c) => LIG[c]);
        if (!text.trim()) continue;
        const key = text.normalize('NFKC').replace(/\s+/g, '');
        let idx = -1, exact = false;
        if (key && stream.length) {
          // Text items and shown glyphs come from the same content stream in the same
          // order: align sequentially, tolerating small encoding differences.
          if (stream.startsWith(key, ptr)) { idx = ptr; exact = true; }
          else {
            const k = stream.indexOf(key, ptr);
            if (k >= 0 && k - ptr < 400) { idx = k; exact = true; }
            else { const pr = key.slice(0, 4), k2 = stream.indexOf(pr, ptr); idx = k2 >= 0 && k2 - ptr < 40 ? k2 : ptr; }
          }
          ptr = Math.min(stream.length, idx + key.length);
        }
        const runAt = (j) => (idx >= 0 && colors.length ? colors[Math.min(idx + j, colors.length - 1)] : null);
        const run = runAt(0);
        if (run && !run.visible) continue;
        const style = tc.styles?.[it.fontName] || {};
        const fontObj = objGetSync(page, it.fontName);
        const fm = mapFont(fontObj?.name || style.fontFamily, style.fontFamily, report);
        const full = mul(base, it.transform);
        const size = Math.hypot(full[2], full[3]);
        if (!(size > 0.2) || size > 2000) continue;
        const tf = mul(full, [1 / size, 0, 0, -1 / size, 0, 0]);
        if (style.vertical) report.a('Vertical text laid out horizontally');
        const mk = (str, r) => ({ id: uid('n'), type: 'text', name: str.trim().slice(0, 24) || 'Text', hidden: !!r?.invisible, locked: false, text: str, font: fm.font, size: Math.round(size * 100) / 100, weight: fm.weight, italic: fm.italic, tracking: 0, leading: 1.2, align: 'left', width: 0, tf: [...tf],
          style: { fill: r?.stroke ? null : { kind: 'solid', color: r ? r.color : '#000000', a: clamp(r ? r.a : 1, 0, 1) }, stroke: r?.stroke ? { kind: 'solid', color: r.color, a: 1 } : null, sw: 1, cap: 'butt', join: 'miter', dash: '', opacity: 1, blend: 'normal' } });
        const node = mk(text, run);
        // Match the original run width with letter spacing (fonts are substituted).
        const expected = fin(it.width) * Math.hypot(base[0], base[1]);
        if (expected > 0 && text.length > 1) {
          try {
            const w0 = measure(node, text);
            if (w0 > 0) {
              const tr = (expected - w0) / ((text.length - 1) * node.size) * 1000;
              if (Math.abs(tr) > 8) { node.tracking = Math.round(clamp(tr, -150, 400)); report.a('Letter spacing adjusted to match the original line widths'); }
            }
          } catch (e) { /* measuring is best-effort */ }
        }
        // Split the item where the colour changes (links, highlights inside a line).
        const segs = [];
        if (exact && text.length === text.normalize('NFKC').length) {
          let j = 0;
          for (let c = 0; c < text.length; c++) {
            const ch = text[c], r = /\s/.test(ch) ? null : runAt(j++);
            const lastSeg = segs[segs.length - 1];
            if (!lastSeg || (r && lastSeg.r && (r.color !== lastSeg.r.color || r.stroke !== lastSeg.r.stroke || r.invisible !== lastSeg.r.invisible))) segs.push({ start: c, str: ch, r });
            else { lastSeg.str += ch; if (!lastSeg.r) lastSeg.r = r; }
          }
        }
        const nodes = [];
        if (segs.length > 1 && segs.length <= 40) {
          const gap = node.tracking / 1000 * node.size;
          for (const sg of segs) {
            if (!sg.str.trim()) continue;
            const n2 = mk(sg.str, sg.r || run); n2.tracking = node.tracking;
            let off = 0;
            try { off = sg.start ? measure(node, text.slice(0, sg.start)) + gap : 0; } catch (e) { off = 0; }
            n2.tf = mul(tf, [1, 0, 0, 1, off, 0]);
            nodes.push(n2);
          }
        } else nodes.push(node);
        for (const n2 of nodes) {
          if (n2.hidden) invisible++;
          budget.text++; budget.nodes++;
          placed.push([run ? run.at : out.length, n2]);
          report.counts.texts++;
        }
      }
      // Keep the page's stacking order: each text object goes where its glyphs were drawn.
      placed.sort((p1, p2) => p1[0] - p2[0]);
      for (let k = placed.length - 1; k >= 0; k--) out.splice(Math.min(placed[k][0], out.length), 0, placed[k][1]);
      if (invisible) report.a(`Invisible (OCR / searchable) text kept as hidden text layers`, invisible);
    }
  }
  return { artboard, group };
}

// ------------------------------------------------------------------ legacy PostScript .ai

/**
 * Minimal reader for PostScript-only .ai files: path operators (m l L c C v V y Y),
 * painting (f F s S b B n N h, compound paths *u/*U, groups u/U), colours
 * (g G k K x X Xa XA Xx XX rg RG), line width / cap / join / dash.
 */
function importLegacyAI(bytes, baseName) {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 128 * 1024 * 1024)));
  const report = new Report('ai-ps');
  const bbm = /%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(text) || /%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(text);
  let [llx, lly, urx, ury] = bbm ? bbm.slice(1).map(Number) : [0, 0, 612, 792];
  if (!(urx > llx && ury > lly)) [llx, lly, urx, ury] = [0, 0, 612, 792];
  const W = clamp((urx - llx) * PX, 1, 20000), H = clamp((ury - lly) * PX, 1, 20000);
  const T = [PX, 0, 0, -PX, -llx * PX, ury * PX];
  // Script region: after the setup / prolog, before the trailer.
  let start = text.indexOf('%%EndSetup'); if (start < 0) start = text.indexOf('%%EndProlog'); if (start < 0) start = 0;
  let end = text.indexOf('%%Trailer', start); if (end < 0) end = text.length;
  const src = text.slice(start, end);

  const root = { id: uid('n'), type: 'group', name: 'Artwork', hidden: false, locked: false, style: { opacity: 1, blend: 'normal' }, children: [] };
  const groups = [root];
  const stackV = [];
  let fill = '#000000', stroke = '#000000', lw = 1, cap = 'butt', join = 'miter', dash = '', evenodd = false;
  let path = [], cur = null, compound = null;
  let nodes = 0, points = 0, tokens = 0, textBlocks = 0;
  const num = () => { const v = stackV.pop(); return typeof v === 'number' ? v : 0; };
  const pt = (x, y) => { const [X, Y] = apply(T, x, y); return { x: X, y: Y, hi: null, ho: null, smooth: false }; };
  const close = () => { if (cur && cur.pts.length > 1) { cur.closed = true; const a = cur.pts[0], z = cur.pts[cur.pts.length - 1]; if (nearly(a.x, z.x) && nearly(a.y, z.y)) { a.hi = z.hi; cur.pts.pop(); } } };
  const paint = (doFill, doStroke, doClose) => {
    if (doClose) close();
    const sps = path.filter((sp) => sp.pts.length > 1);
    path = []; cur = null;
    if (!sps.length) return;
    if (compound) { compound.sps.push(...sps); if (doFill || doStroke) compound.style = { doFill, doStroke, fill, stroke, lw, cap, join, dash }; return; }
    emit(sps, { doFill, doStroke, fill, stroke, lw, cap, join, dash }, evenodd);
  };
  const emit = (sps, s, eo) => {
    if (!s.doFill && !s.doStroke) return;
    if (nodes >= PDF_LIMITS.nodes || points >= PDF_LIMITS.points) { report.truncated = true; return; }
    nodes++; points += countPts(sps);
    groups[groups.length - 1].children.push({ id: uid('n'), type: 'path', name: 'Path', hidden: false, locked: false, subpaths: sps, fillRule: eo ? 'evenodd' : 'nonzero', keepStroke: true,
      style: { fill: s.doFill ? { kind: 'solid', color: s.fill, a: 1 } : null, stroke: s.doStroke ? { kind: 'solid', color: s.stroke, a: 1 } : null, sw: Math.max(0.1, s.lw * PX), cap: s.cap, join: s.join, dash: s.dash, opacity: 1, blend: 'normal' } });
    report.counts.paths++;
  };
  const re = /\s*(%[^\r\n]*|\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]*>|\[|\]|\{|\}|\/[^\s()<>\[\]{}\/%]*|[^\s()<>\[\]{}\/%]+)/y;
  let braces = 0, inText = false;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src)) && tokens < 5e6) {
    tokens++;
    const t = m[1];
    if (!t) break;
    if (t[0] === '%') continue;
    if (t === '{') { braces++; continue; }
    if (t === '}') { braces = Math.max(0, braces - 1); continue; }
    if (braces) continue;
    if (inText) { if (t === 'TO') inText = false; continue; }
    if (t[0] === '(' || t[0] === '<' || t[0] === '/' || t === '[' || t === ']') { stackV.push(t[0] === '[' ? '[' : t[0] === ']' ? ']' : t); continue; }
    const v = Number(t);
    if (Number.isFinite(v) && /^[-+.\d]/.test(t)) { if (stackV.length < 10000) stackV.push(v); continue; }
    switch (t) {
      case 'm': { const y = num(), x = num(); cur = { closed: false, pts: [pt(x, y)] }; path.push(cur); break; }
      case 'l': case 'L': { const y = num(), x = num(); if (!cur) { cur = { closed: false, pts: [] }; path.push(cur); } cur.pts.push(pt(x, y)); break; }
      case 'c': case 'C': { const y3 = num(), x3 = num(), y2 = num(), x2 = num(), y1 = num(), x1 = num(); if (!cur) break; cur.pts[cur.pts.length - 1].ho = apply(T, x1, y1); const q = pt(x3, y3); q.hi = apply(T, x2, y2); cur.pts.push(q); break; }
      case 'v': case 'V': { const y3 = num(), x3 = num(), y2 = num(), x2 = num(); if (!cur) break; const q = pt(x3, y3); q.hi = apply(T, x2, y2); cur.pts.push(q); break; }
      case 'y': case 'Y': { const y3 = num(), x3 = num(), y1 = num(), x1 = num(); if (!cur) break; cur.pts[cur.pts.length - 1].ho = apply(T, x1, y1); cur.pts.push(pt(x3, y3)); break; }
      case 'h': close(); break;
      case 'H': break;
      case 'f': paint(true, false, true); break;
      case 'F': paint(true, false, false); break;
      case 's': paint(false, true, true); break;
      case 'S': paint(false, true, false); break;
      case 'b': paint(true, true, true); break;
      case 'B': paint(true, true, false); break;
      case 'n': paint(false, false, true); break;
      case 'N': paint(false, false, false); break;
      case '*u': compound = { sps: [], style: null }; break;
      case '*U': if (compound) { const c = compound; compound = null; if (c.style && c.sps.length) emit(c.sps, c.style, true); } break;
      case 'u': if (groups.length < 40) { const g = { id: uid('n'), type: 'group', name: 'Group', hidden: false, locked: false, style: { opacity: 1, blend: 'normal' }, children: [] }; groups[groups.length - 1].children.push(g); groups.push(g); report.counts.groups++; } break;
      case 'U': if (groups.length > 1) groups.pop(); break;
      case 'g': { const g = num(); fill = rgbHex(g * 255, g * 255, g * 255); break; }
      case 'G': { const g = num(); stroke = rgbHex(g * 255, g * 255, g * 255); break; }
      case 'k': { const k = num(), y = num(), mm = num(), c = num(); fill = cmykHex(c, mm, y, k); break; }
      case 'K': { const k = num(), y = num(), mm = num(), c = num(); stroke = cmykHex(c, mm, y, k); break; }
      case 'x': case 'X': { const tint = num(); stackV.pop(); const k = num(), y = num(), mm = num(), c = num(); const f = 1 - clamp(tint, 0, 1); const col = cmykHex(c * f, mm * f, y * f, k * f); if (t === 'x') fill = col; else stroke = col; break; }
      case 'Xx': case 'XX': { const type = num(), tint = num(); stackV.pop(); const f = 1 - clamp(tint, 0, 1); let col; if (type === 1) { const b = num(), g = num(), r = num(); col = rgbHex(255 - (255 - r * 255) * f, 255 - (255 - g * 255) * f, 255 - (255 - b * 255) * f); } else { const k = num(), y = num(), mm = num(), c = num(); col = cmykHex(c * f, mm * f, y * f, k * f); } if (t === 'Xx') fill = col; else stroke = col; break; }
      case 'Xa': case 'rg': case 'setrgbcolor': { const b = num(), g = num(), r = num(); fill = rgbHex(r * 255, g * 255, b * 255); if (t === 'setrgbcolor') stroke = fill; break; }
      case 'XA': case 'RG': { const b = num(), g = num(), r = num(); stroke = rgbHex(r * 255, g * 255, b * 255); break; }
      case 'setgray': { const g = num(); fill = stroke = rgbHex(g * 255, g * 255, g * 255); break; }
      case 'XR': evenodd = num() === 1; break;
      case 'w': lw = Math.max(0, num()); break;
      case 'j': join = ['miter', 'round', 'bevel'][num()] || 'miter'; break;
      case 'J': cap = ['butt', 'round', 'square'][num()] || 'butt'; break;
      case 'd': {
        stackV.pop(); // phase
        const arr = []; let v2;
        while (stackV.length && (v2 = stackV.pop()) !== '[') if (typeof v2 === 'number') arr.unshift(v2);
        dash = arr.some((q) => q > 0) ? arr.slice(0, 16).map((q) => String(Math.round(Math.max(0, q) * PX * 100) / 100)).join(' ') : '';
        break;
      }
      case 'To': inText = true; textBlocks++; break;
      default: stackV.length = 0; break;
    }
  }
  if (!report.counts.paths) {
    throw new Error('This .ai was saved without PDF compatibility and its artwork could not be read. Re-save it with the “PDF compatible” option turned on (or export it as PDF or SVG), then import again.');
  }
  if (textBlocks) report.u('Text in PostScript-only .ai files is not imported', textBlocks);
  report.u('Placed images, gradients and effects in PostScript-only .ai files are not imported');
  report.counts.pages = 1; report.counts.artboards = 1; report.counts.groups++;
  const doc = { id: uid('d'), name: baseName, created: Date.now(), artboards: [{ id: uid('ab'), name: 'Artboard 1', x: 0, y: 0, w: W, h: H, bg: '#ffffff' }], items: [root], meta: { source: 'ai' } };
  const clean = validateDoc(doc);
  clean.name = baseName; clean.meta = { source: 'ai' };
  return { doc: clean, report: report.out() };
}
