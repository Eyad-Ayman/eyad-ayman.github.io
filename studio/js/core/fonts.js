// EYAD Studio — your own fonts: add .ttf / .otf / .woff / .woff2 files from
// this device, or pick any Google Fonts family by name (downloaded once, then
// stored in this browser so it works offline). Fonts are shared by IMAGE,
// VECTOR and VIDEO. Font files are validated by their signature and are never
// executed or uploaded.
import { h, clear, formatBytes } from './dom.js';
import { icon } from './icons.js';
import { dialog, toast } from './ui.js';
import { db } from './db.js';
import { pickFiles, sanitizeFilename } from './files.js';

const LS = 'eyad-studio:user-fonts:v1';
const MAX = 25 * 1024 * 1024;
const listeners = new Set();
export const onFontsChanged = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });

/** [{ family, source: 'device' | 'google', files: n }] — kept in localStorage so font lists can be built synchronously. */
export function userFonts() {
  try { const a = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(a) ? a.filter((x) => x && typeof x.family === 'string') : []; } catch (e) { return []; }
}
function saveList(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) { /* ignore */ } }

/** Append the user's fonts to an app font list ([value, label] pairs). */
export function extendFontList(list) {
  for (const f of userFonts()) if (!list.some(([v]) => v === f.family)) list.push([f.family, f.family + (f.source === 'google' ? ' ·G' : ' ·★')]);
  return list;
}

const cleanFamily = (s) => String(s || '').replace(/\.(ttf|otf|woff2?|ttc)$/i, '').replace(/[-_]+(Regular|Bold|Italic|Light|Medium|Black|Thin|SemiBold|ExtraBold|VariableFont.*|wght.*)$/i, '').replace(/[-_]+/g, ' ').replace(/[^\w ؀-ۿ]/g, '').trim().slice(0, 60) || 'My Font';

const titleCase = (t) => t.replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** Family name from an uncompressed TTF/OTF 'name' table (typographic family 16, else family 1). Read-only parsing, bounds-checked. */
function sfntFamily(b) {
  try {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const tag = v.getUint32(0);
    if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null; // not raw sfnt (woff/woff2 are compressed)
    const n = v.getUint16(4);
    for (let i = 0; i < Math.min(n, 64); i++) {
      const r = 12 + i * 16;
      if (r + 16 > b.length) return null;
      if (v.getUint32(r) !== 0x6e616d65) continue; // 'name'
      const off = v.getUint32(r + 8); if (off + 6 > b.length) return null;
      const count = v.getUint16(off + 2), strOff = off + v.getUint16(off + 4);
      let best = null, bestScore = -1;
      for (let k = 0; k < Math.min(count, 400); k++) {
        const e = off + 6 + k * 12; if (e + 12 > b.length) break;
        const pid = v.getUint16(e), nid = v.getUint16(e + 6), len = v.getUint16(e + 8), so = strOff + v.getUint16(e + 10);
        if ((nid !== 1 && nid !== 16) || so + len > b.length || len > 200) continue;
        let str = '';
        if (pid === 0 || pid === 3) for (let j = 0; j + 1 < len; j += 2) str += String.fromCharCode(v.getUint16(so + j));
        else for (let j = 0; j < len; j++) str += String.fromCharCode(b[so + j]);
        const score = (nid === 16 ? 2 : 1) + (pid === 3 ? 1 : 0);
        if (str.trim() && score > bestScore) { best = str; bestScore = score; }
      }
      const clean = best && best.replace(/[^\w \-؀-ۿ]/g, '').trim().slice(0, 60);
      return clean || null;
    }
  } catch (e) { /* malformed: fall back to the file name */ }
  return null;
}

function sniff(b) {
  const a = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) return 'truetype';
  if (a === 'true') return 'truetype';
  if (a === 'OTTO') return 'opentype';
  if (a === 'wOFF') return 'woff';
  if (a === 'wOF2') return 'woff2';
  return null;
}

let loaded = false;
/** Load every stored font into the page (call once at start; cheap if none). */
export async function loadUserFonts() {
  if (loaded) return userFonts(); loaded = true;
  const list = userFonts(); if (!list.length) return list;
  let keys = [];
  try { keys = (await db.keys('files')).filter((k) => typeof k === 'string' && k.startsWith('font:')); } catch (e) { return list; }
  for (const k of keys) {
    try {
      const rec = await db.get('files', k);
      if (!rec || !rec.blob) continue;
      const ff = new FontFace(rec.family, await rec.blob.arrayBuffer(), { weight: String(rec.weight || 'normal'), style: rec.style || 'normal', display: 'swap' });
      document.fonts.add(await ff.load());
    } catch (e) { /* skip a damaged font */ }
  }
  changed();
  return list;
}

async function storeFace(family, bytes, { weight = 'normal', style = 'normal', source = 'device', mime = 'font/ttf' } = {}) {
  const ff = new FontFace(family, bytes, { weight: String(weight), style, display: 'swap' });
  await ff.load(); // throws if the browser can't use it
  document.fonts.add(ff);
  await db.put('files', { id: `font:${family}:${weight}:${style}`, family, weight, style, blob: new Blob([bytes], { type: mime }), created: Date.now() });
  const list = userFonts();
  const e = list.find((x) => x.family === family);
  if (e) e.files = (e.files || 1) + 1; else list.push({ family, source, files: 1 });
  saveList(list);
}

/** Add font files from this device. Returns the families added. */
export async function addFontFiles(files) {
  const added = [];
  for (const f of files) {
    const name = sanitizeFilename(f.name);
    if (f.size > MAX) { toast(`${name} is larger than 25 MB.`, { type: 'error' }); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) { toast(`${name} is not a font file (TTF, OTF, WOFF or WOFF2).`, { type: 'error' }); continue; }
    const family = sfntFamily(bytes) || titleCase(cleanFamily(f.name).replace(/\b(latin|ext|arabic|cyrillic|greek|vietnamese|normal|\d{3})\b/gi, '').replace(/\s+/g, ' ').trim() || cleanFamily(f.name));
    const weight = /black|heavy/i.test(f.name) ? 900 : /extra ?bold/i.test(f.name) ? 800 : /semi ?bold/i.test(f.name) ? 600 : /bold/i.test(f.name) ? 700 : /medium/i.test(f.name) ? 500 : /light/i.test(f.name) ? 300 : /thin/i.test(f.name) ? 100 : 400;
    const style = /italic|oblique/i.test(f.name) ? 'italic' : 'normal';
    try { await storeFace(family, bytes.buffer, { weight, style, source: 'device', mime: 'font/' + kind }); added.push(family); }
    catch (e) { toast(`${name} could not be loaded by the browser.`, { type: 'error' }); }
  }
  if (added.length) { changed(); toast(`Added ${[...new Set(added)].join(', ')}`, { type: 'ok' }); }
  return [...new Set(added)];
}

/** Download a Google Fonts family (regular, bold and italics when available) and keep it offline. */
export async function addGoogleFont(name, onStatus) {
  const family = String(name || '').trim().replace(/[^\w \-]/g, '').slice(0, 60);
  if (!family) throw new Error('Type a font name.');
  onStatus && onStatus('Looking up “' + family + '”…');
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@0,400;0,700;1,400&display=swap`, { credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error(r.status === 400 ? `“${family}” is not on Google Fonts (check the spelling).` : 'Google Fonts answered ' + r.status); return r.text(); })
    .catch((e) => { throw new Error(e.message && !/fetch/i.test(e.message) ? e.message : 'Could not reach Google Fonts — are you online?'); });
  // one @font-face per weight/style/subset; keep the latin (last) + arabic subsets
  const faces = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g)].map(([, subset, body]) => ({
    subset,
    style: /font-style:\s*italic/.test(body) ? 'italic' : 'normal',
    weight: (body.match(/font-weight:\s*(\d+)/) || [])[1] || '400',
    url: (body.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/) || [])[1],
    range: (body.match(/unicode-range:\s*([^;]+);/) || [])[1],
  })).filter((f) => f.url && ['latin', 'latin-ext', 'arabic'].includes(f.subset));
  if (!faces.length) throw new Error(`No usable files were found for “${family}”.`);
  let n = 0;
  for (const f of faces) {
    onStatus && onStatus(`Downloading ${family} ${f.weight}${f.style === 'italic' ? ' italic' : ''} (${f.subset})…`);
    const bytes = await (await fetch(f.url, { credentials: 'omit' })).arrayBuffer();
    try {
      const ff = new FontFace(family, bytes, { weight: f.weight, style: f.style, unicodeRange: f.range, display: 'swap' });
      await ff.load(); document.fonts.add(ff);
      await db.put('files', { id: `font:${family}:${f.weight}:${f.style}:${f.subset}`, family, weight: f.weight, style: f.style, blob: new Blob([bytes], { type: 'font/woff2' }), created: Date.now() });
      n++;
    } catch (e) { /* skip one face */ }
  }
  if (!n) throw new Error('The font files could not be loaded.');
  const list = userFonts();
  if (!list.some((x) => x.family === family)) list.push({ family, source: 'google', files: n });
  saveList(list); changed();
  return family;
}

export async function removeFont(family) {
  try { for (const k of await db.keys('files')) if (typeof k === 'string' && k.startsWith(`font:${family}:`)) await db.del('files', k); } catch (e) { /* ignore */ }
  saveList(userFonts().filter((x) => x.family !== family));
  for (const ff of [...document.fonts]) if (ff.family.replace(/"/g, '') === family) document.fonts.delete(ff);
  changed();
}

export const POPULAR = ['Anton', 'Bebas Neue', 'Archivo Black', 'Syne', 'Space Grotesk', 'Unbounded', 'Bricolage Grotesque', 'Big Shoulders Display', 'Rubik Mono One', 'Monoton', 'Bungee', 'Rubik Glitch', 'Righteous', 'Russo One',
  'Playfair Display', 'DM Serif Display', 'Fraunces', 'Instrument Serif', 'Cormorant Garamond', 'Libre Baskerville', 'Abril Fatface', 'Bodoni Moda',
  'Inter', 'Manrope', 'Poppins', 'Montserrat', 'Outfit', 'Plus Jakarta Sans', 'Sora', 'Urbanist', 'Work Sans', 'Barlow Condensed', 'Oswald', 'Roboto Condensed',
  'JetBrains Mono', 'Space Mono', 'IBM Plex Mono', 'VT323', 'Press Start 2P', 'Silkscreen',
  'Permanent Marker', 'Caveat', 'Rock Salt', 'Pacifico', 'Great Vibes', 'Dancing Script', 'Shadows Into Light', 'Gloria Hallelujah', 'Rubik Spray Paint', 'Rubik Wet Paint',
  'Cairo', 'Tajawal', 'Almarai', 'El Messiri', 'Reem Kufi', 'Aref Ruqaa', 'Lalezar', 'Changa', 'Rakkas', 'Marhey', 'Noto Kufi Arabic', 'Readex Pro', 'Blaka'];

/** Fonts dialog: this device, add files, Google Fonts. */
export async function fontManagerDialog() {
  const listEl = h('div', { class: 'fm-list' });
  const status = h('div', { class: 'studio-small studio-dim fm-status', role: 'status' });
  const render = () => {
    clear(listEl);
    const list = userFonts();
    if (!list.length) listEl.appendChild(h('p', { class: 'studio-dim studio-small', text: 'No fonts added yet. Add files from this device or pick from Google Fonts below.' }));
    for (const f of list) listEl.appendChild(h('div', { class: 'fm-row' },
      h('span', { class: 'fm-sample', style: { fontFamily: `'${f.family}', sans-serif` }, text: f.family }),
      h('span', { class: 'studio-badge is-muted', text: f.source === 'google' ? 'Google Fonts' : 'This device' }),
      h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Remove ' + f.family, title: 'Remove', onclick: async () => { await removeFont(f.family); render(); } }, icon('trash', 14))));
  };
  render();
  const search = h('input', { class: 'studio-input', type: 'search', placeholder: 'Any Google Fonts name, e.g. “Anton” or “Tajawal”', 'aria-label': 'Google font name' });
  const addG = async (name) => {
    try { const fam = await addGoogleFont(name, (t) => { status.textContent = t; }); status.textContent = `“${fam}” added — it now works offline too.`; render(); }
    catch (e) { status.textContent = e.message; }
  };
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && search.value.trim()) addG(search.value); });
  const chips = h('div', { class: 'fm-chips' }, POPULAR.map((n) => h('button', { class: 'fm-chip', type: 'button', text: n, onclick: () => addG(n) })));
  search.addEventListener('input', () => { const q = search.value.trim().toLowerCase(); for (const c of chips.children) c.hidden = !!q && !c.textContent.toLowerCase().includes(q); });
  const body = h('div', { class: 'studio-stack fm' },
    h('div', { class: 'fm-sec', text: 'Your fonts' }), listEl,
    h('button', { class: 'studio-btn', type: 'button', onclick: async () => { const f = await pickFiles({ accept: '.ttf,.otf,.woff,.woff2,font/*', multiple: true }); if (f.length) { await addFontFiles(f); render(); } } }, icon('upload', 15), h('span', { text: 'Add font files from this device…' })),
    h('div', { class: 'fm-sec', text: 'Find on Google Fonts (1,700+ free families)' }),
    h('div', { class: 'studio-row' }, search, h('button', { class: 'studio-btn is-primary', type: 'button', text: 'Add', onclick: () => search.value.trim() && addG(search.value) })),
    chips, status,
    h('p', { class: 'studio-small studio-faint', text: 'Google Fonts are free and open-licensed. Only the font name is sent to Google; your designs never leave this device. Added fonts appear in every font menu (IMAGE, VECTOR, VIDEO).' }));
  await dialog({ title: 'Fonts', body, width: 560, buttons: [{ label: 'Done', value: true, primary: true }] });
}
export { formatBytes };
