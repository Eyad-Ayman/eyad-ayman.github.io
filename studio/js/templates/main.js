// EYAD STUDIO — Templates (/studio/templates/).
// A gallery of original, code-generated designs. "Use template" builds the
// vector document, packs it as a .eyad file and hands it to EYAD VECTOR through
// the IndexedDB hand-off (the same route Projects uses) — nothing is uploaded.
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, dialog } from '../core/ui.js';
import { ROUTES } from '../core/shell.js';
import { putHandoff } from '../core/db.js';
import { writeEyad } from '../core/eyad.js';
import { sanitizeFilename } from '../core/files.js';
import { exportSVG, walk } from '../vector/model.js';
import { page } from '../pages/common.js';
import { TEMPLATES, CATEGORIES, BLANKS, blankDoc } from './data.js';
import { embedFontCss, loadFaces } from './fonts.js';

const CAT_LABEL = Object.fromEntries(CATEGORIES);
const q0 = new URLSearchParams(location.search);
let filter = q0.get('cat') || 'all';
let query = (q0.get('q') || '').toLowerCase();

// ------------------------------------------------------------------ rendering

function fontUsage(doc) {
  const usage = new Map();
  walk(doc.items, (n) => {
    if (n.type !== 'text' || n.hidden) return;
    if (!usage.has(n.font)) usage.set(n.font, new Set());
    usage.get(n.font).add(`${n.weight || 400}/${n.italic ? 1 : 0}`);
  });
  return usage;
}
/** Standalone SVG for a doc's first artboard, with its fonts embedded. */
async function svgOf(doc) {
  const usage = fontUsage(doc);
  await loadFaces(usage); // text wrapping measures with the page's copy of the fonts
  return exportSVG(doc, doc.artboards[0], { fonts: await embedFontCss(usage) });
}
async function decodeSvg(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image(); img.src = url;
  try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
  // Chromium decodes an SVG image before the data: fonts inside it are ready;
  // drawing in the same task paints the text blank. One short wait fixes it.
  await new Promise((r) => setTimeout(r, 40));
  return { img, url };
}
/** Raster render of a doc. max = longest side in px (0 = 1:1). */
async function rasterize(doc, { max = 0, type = 'image/png', quality = 0.9 } = {}) {
  const ab = doc.artboards[0];
  const { img, url } = await decodeSvg(await svgOf(doc));
  try {
    const s = max ? Math.min(1, max / Math.max(ab.w, ab.h)) : 1;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(ab.w * s)); c.height = Math.max(1, Math.round(ab.h * s));
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Render failed'))), type, quality));
  } finally { URL.revokeObjectURL(url); }
}

// thumbnails: rendered lazily as cards scroll into view, two at a time
const thumbs = new Map();       // id → object URL
const queue = [];
let running = 0;
function requestThumb(tpl, img) {
  if (thumbs.has(tpl.id)) { img.src = thumbs.get(tpl.id); return; }
  queue.push([tpl, img]); pump();
}
function pump() {
  while (running < 2 && queue.length) {
    const [tpl, img] = queue.shift();
    if (thumbs.has(tpl.id)) { img.src = thumbs.get(tpl.id); continue; }
    running++;
    rasterize(tpl.build(), { max: 560, type: 'image/webp', quality: 0.86 })
      .then((b) => { const u = URL.createObjectURL(b); thumbs.set(tpl.id, u); img.src = u; })
      .catch(() => { img.closest('.tpl-thumb')?.classList.add('is-failed'); })
      .finally(() => { running--; img.closest('.tpl-thumb')?.classList.remove('is-loading'); pump(); });
  }
}
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); const tpl = byId.get(e.target.dataset.tpl); if (tpl) requestThumb(tpl, e.target.querySelector('img')); }
}, { rootMargin: '600px 0px' });
const byId = new Map(TEMPLATES.map((x) => [x.id, x]));

// ------------------------------------------------------------------ open in an editor

let busy = false;
async function openInVector(doc) {
  if (busy) return; busy = true;
  const t = toast('Opening in EYAD VECTOR…', { timeout: 8000 });
  try {
    let thumb = null;
    try { thumb = await rasterize(doc, { max: 360 }); } catch (e) { /* thumbnail is optional */ }
    const blob = await writeEyad({ kind: 'vector', name: doc.name, document: JSON.parse(JSON.stringify(doc)), thumb, created: Date.now() });
    const file = new File([blob], sanitizeFilename(doc.name, 'Template') + '.eyad', { type: 'application/zip' });
    const id = await putHandoff([file]);
    location.href = ROUTES.vector + '?handoff=' + id;
  } catch (e) { busy = false; toast('Could not open the template', { type: 'error', detail: e.message || String(e) }); }
  void t;
}
async function openInImage(doc) {
  if (busy) return; busy = true;
  toast('Rendering for EYAD IMAGE…', { timeout: 8000 });
  try {
    const png = await rasterize(doc);
    const file = new File([png], sanitizeFilename(doc.name, 'Template') + '.png', { type: 'image/png' });
    const id = await putHandoff([file]);
    location.href = ROUTES.image + '?handoff=' + id;
  } catch (e) { busy = false; toast('Could not render the template', { type: 'error', detail: e.message || String(e) }); }
}

const QUICK = ['Headline', 'Subhead', 'Kicker', 'Caption text', 'Question', 'Option A', 'Option B', 'Date', 'Price', 'Handle', 'Website', 'Call to action', 'Button label', 'Brand name', 'Number', 'Highlight', 'Tags'];

async function preview(tpl) {
  const doc = tpl.build();
  const img = h('img', { alt: tpl.name + ' — preview', src: thumbs.get(tpl.id) || '' });
  const stage = h('div', { class: 'tpl-preview-stage', style: { aspectRatio: `${tpl.w} / ${tpl.h}` } }, img);
  stage.style.setProperty('--r', String(tpl.w / tpl.h));
  let big = null, timer = 0;
  const redraw = () => svgOf(doc).then((svg) => { const old = big; big = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); img.src = big; if (old) setTimeout(() => URL.revokeObjectURL(old), 500); }).catch(() => {});
  redraw();
  // Quick edit: the main words of the design, changed right here before opening.
  const texts = [];
  walk(doc.items, (n) => { if (n.type === 'text' && QUICK.includes(n.name) && texts.length < 6) texts.push(n); });
  const quick = texts.length ? h('div', { class: 'tpl-quick' }, h('span', { class: 'studio-label', text: 'Quick edit' }),
    texts.map((n) => {
      const clean = n.text.replace(/\u200f/g, '');
      const multi = clean.includes('\n');
      const inp = h(multi ? 'textarea' : 'input', { class: 'studio-input', rows: multi ? Math.min(4, clean.split('\n').length) : null, value: clean, 'aria-label': n.name, maxLength: 300 });
      if (multi) inp.value = clean;
      inp.addEventListener('input', () => {
        const v = inp.value.slice(0, 300);
        n.text = /[\u0600-\u06ff]/.test(v) ? v.split('\n').map((l) => (/[\u0600-\u06ff]/.test(l) ? '\u200f' + l + '\u200f' : l)).join('\n') : v;
        clearTimeout(timer); timer = setTimeout(redraw, 180);
      });
      return h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: n.name }), inp);
    })) : null;
  const body = h('div', { class: 'tpl-preview' },
    h('div', { class: 'tpl-preview-art' }, stage),
    h('div', { class: 'tpl-preview-info' },
      h('span', { class: 'studio-badge is-muted', text: tpl.cat.map((c) => CAT_LABEL[c]).join(' · ') }),
      h('span', { class: 'studio-dim studio-small', text: `${tpl.w} × ${tpl.h} px` }),
      quick,
      h('p', { class: 'studio-dim studio-small tpl-preview-note', text: 'Opens as an editable vector document: every shape and text box is a named layer. Replace the grey photo frames by placing your own images.' })));
  const v = await dialog({ title: tpl.name, body, width: 940, className: 'tpl-dialog', buttons: [
    { label: 'Open in EYAD IMAGE', value: 'image' },
    { label: 'Use template', value: 'vector', primary: true },
  ] });
  clearTimeout(timer);
  if (big) setTimeout(() => URL.revokeObjectURL(big), 1000);
  if (v === 'vector') openInVector(doc);
  else if (v === 'image') openInImage(doc);
}

// ------------------------------------------------------------------ UI

function card(tpl) {
  const img = h('img', { alt: '', decoding: 'async', draggable: 'false' });
  const ratio = tpl.w / tpl.h;
  const thumb = h('button', { class: 'tpl-thumb is-loading', type: 'button', dataset: { tpl: tpl.id }, 'aria-label': `Preview ${tpl.name}`, onclick: () => preview(tpl) },
    h('span', { class: 'tpl-art', style: ratio >= 1 ? { width: '86%', aspectRatio: `${tpl.w} / ${tpl.h}` } : { height: '86%', aspectRatio: `${tpl.w} / ${tpl.h}` } }, img),
    h('span', { class: 'tpl-hover', 'aria-hidden': 'true' }, icon('eye', 15), 'Preview'),
    tpl.cat.includes('trend') ? h('span', { class: 'tpl-trend-badge', text: 'Trending' }) : null);
  io.observe(thumb);
  return h('div', { class: 'tpl-card', role: 'listitem' },
    thumb,
    h('div', { class: 'tpl-meta' },
      h('div', { class: 'tpl-name', text: tpl.name, title: tpl.name }),
      h('div', { class: 'tpl-sub' }, h('span', { text: CAT_LABEL[tpl.cat[0]] }), h('span', { class: 'tpl-dot', text: '·' }), h('span', { text: `${tpl.w}×${tpl.h}` }))),
    h('button', { class: 'studio-btn is-small is-primary tpl-use', type: 'button', onclick: () => openInVector(tpl.build()) }, icon('vector', 13), h('span', { text: 'Use template' })));
}

function blankTile(name, w, hh) {
  const r = w / hh, box = 64;
  const bw = r >= 1 ? box : box * r, bh = r >= 1 ? box / r : box;
  return h('button', { class: 'tpl-blank', type: 'button', title: `New blank ${name} (${w}×${hh})`, onclick: () => openInVector(blankDoc(name, w, hh)) },
    h('span', { class: 'tpl-blank-box' }, h('span', { class: 'tpl-blank-shape', style: { width: bw + 'px', height: bh + 'px' } })),
    h('span', { class: 'tpl-blank-name', text: name }),
    h('span', { class: 'tpl-blank-size', text: `${w} × ${hh}` }));
}

const grid = h('div', { class: 'tpl-grid', role: 'list', 'aria-label': 'Templates' });
const blanks = h('section', { class: 'studio-section tpl-blanks', 'aria-label': 'Blank sizes' },
  h('div', { class: 'studio-section-head' }, h('h2', { class: 'studio-section-title', text: 'Start blank' }), h('span', { class: 'studio-dim studio-small', text: 'Empty vector document at a ready-made size' })),
  BLANKS.map(([group, list]) => h('div', { class: 'tpl-blank-group' }, h('h3', { class: 'tpl-blank-head', text: group }), h('div', { class: 'tpl-blank-row' }, list.map(([n, w, hh]) => blankTile(n, w, hh))))));
const trendRow = h('section', { class: 'tpl-trending', 'aria-label': 'Trending now' },
  h('div', { class: 'studio-section-head' }, h('h2', { class: 'studio-section-title', text: 'Trending now' }), h('span', { class: 'studio-dim studio-small', text: 'The formats everyone is posting this season — tap one, change the words, done.' })),
  h('div', { class: 'tpl-trend-strip', role: 'list' }, TEMPLATES.filter((x) => x.cat.includes('trend')).map(card)));
const countEl = h('span', { class: 'studio-dim studio-small tpl-count' });
const search = h('input', { class: 'studio-input hub-search tpl-search', type: 'search', placeholder: 'Search templates — e.g. wedding, sale, arabic', 'aria-label': 'Search templates', value: query });
search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
const chipDefs = [['all', 'All'], ...CATEGORIES.filter(([k]) => TEMPLATES.some((x) => x.cat.includes(k))), ['blank', 'Blank sizes']];
const chips = h('div', { class: 'hub-chips tpl-chips', role: 'tablist', 'aria-label': 'Categories' }, chipDefs.map(([k, l]) => h('button', { class: 'hub-chip', type: 'button', role: 'tab', dataset: { f: k }, text: l, onclick: () => { filter = k; render(); } })));

page('templates',
  h('section', { class: 'hub-pagehead tpl-head' },
    h('div', {},
      h('p', { class: 'studio-label', text: 'Start from a design · trends updated for 2026' }),
      h('h1', { class: 'studio-page-title' }, 'Templates'),
      h('p', { class: 'studio-page-lede', text: `${TEMPLATES.length} original layouts — posts, stories, thumbnails, slides, posters, cards, menus, CVs and Arabic designs. Every one opens as a fully editable vector document; swap the words, colours and photos and make it yours.` })),
    h('div', { class: 'hub-actions' },
      h('a', { class: 'studio-btn', href: ROUTES.vector + '?new=1' }, icon('vector', 16), 'New blank vector'),
      h('a', { class: 'studio-btn is-ghost', href: ROUTES.home }, icon('back', 16), 'Studio home'))),
  h('div', { class: 'tpl-toolbar' }, search, countEl),
  chips,
  trendRow,
  grid,
  blanks);

function matches(tpl) {
  if (filter !== 'all' && filter !== 'blank' && !tpl.cat.includes(filter)) return false;
  if (!query) return true;
  const hay = [tpl.name, ...tpl.tags, ...tpl.cat.map((c) => CAT_LABEL[c])].join(' ').toLowerCase();
  return query.split(/\s+/).every((w) => hay.includes(w));
}
function render() {
  chips.querySelectorAll('.hub-chip').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.f === filter)));
  const list = filter === 'blank' ? [] : TEMPLATES.filter(matches);
  grid.hidden = filter === 'blank';
  trendRow.hidden = filter !== 'all' || !!query;
  countEl.textContent = filter === 'blank' ? '' : `${list.length} template${list.length === 1 ? '' : 's'}`;
  if (filter !== 'blank' && !list.length) grid.replaceChildren(h('div', { class: 'studio-empty' }, icon('search', 28), h('h3', { text: 'Nothing matches' }), h('p', { text: 'Try another word or category — or start from a blank size below.' })));
  else grid.replaceChildren(...list.map(card));
  blanks.hidden = !!query && filter !== 'blank';
  const u = new URL(location.href);
  if (filter !== 'all') u.searchParams.set('cat', filter); else u.searchParams.delete('cat');
  if (query) u.searchParams.set('q', query); else u.searchParams.delete('q');
  history.replaceState(null, '', u.pathname + u.search);
}
render();
// Coming back from an editor (back/forward cache) re-enables the buttons.
addEventListener('pageshow', () => { busy = false; });
