// EYAD STUDIO — native project format (.eyad)
//
// A .eyad file is a ZIP container:
//   manifest.json   { format: "eyad", version, kind: "image"|"video", name, app, created, saved }
//   document.json   the editor document (layers / sequences) — plain JSON, never executed
//   thumb.png       preview thumbnail (optional)
//   assets/…        layer pixels (PNG), masks
//   media/…         embedded video/audio/image media (video projects, optional)

import { writeZip, readZip } from './zip.js';

export const EYAD_VERSION = 1;
const MAX_DOC_JSON = 64 * 1024 * 1024;

export async function writeEyad({ kind, name, document, assets = [], thumb = null, created }) {
  const manifest = {
    format: 'eyad',
    version: EYAD_VERSION,
    kind,
    name,
    app: 'EYAD STUDIO',
    created: created || Date.now(),
    saved: Date.now(),
  };
  const entries = [
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2), compress: true },
    { name: 'document.json', data: JSON.stringify(document), compress: true },
  ];
  if (thumb) entries.push({ name: 'thumb.png', data: thumb });
  for (const a of assets) entries.push({ name: a.path, data: a.blob, compress: !!a.compress });
  return writeZip(entries);
}

export async function readEyad(blob) {
  let zip;
  try {
    zip = await readZip(blob);
  } catch (e) {
    throw new Error('This is not a valid .eyad project. ' + e.message);
  }
  const m = zip.get('manifest.json');
  const d = zip.get('document.json');
  if (!m || !d) throw new Error('This .eyad project is missing its manifest or document.');
  let manifest, document;
  try { manifest = JSON.parse(await m.text()); } catch (e) { throw new Error('The project manifest is not valid JSON.'); }
  if (!manifest || manifest.format !== 'eyad') throw new Error('The file is a ZIP archive but not an EYAD project.');
  if (typeof manifest.version !== 'number' || manifest.version > EYAD_VERSION) {
    throw new Error(`This project was made by a newer version of EYAD STUDIO (format v${manifest.version}). Please update the Studio.`);
  }
  if (!['image', 'video', 'vector'].includes(manifest.kind)) throw new Error('Unknown project type in manifest.');
  if (d.size > MAX_DOC_JSON) throw new Error('Project document is too large to open safely.');
  try { document = JSON.parse(await d.text()); } catch (e) { throw new Error('The project document is damaged (invalid JSON).'); }
  if (!document || typeof document !== 'object') throw new Error('The project document is empty.');
  return {
    manifest,
    document,
    has: (path) => zip.has(path),
    asset: async (path, type = '') => { const e = zip.get(path); return e ? e.blob(type) : null; },
    thumb: async () => { const e = zip.get('thumb.png'); return e ? e.blob('image/png') : null; },
    entries: () => Array.from(zip.keys()),
  };
}

/** Read only the manifest (cheap) — used for listing and detection. */
export async function peekEyad(blob) {
  try {
    const zip = await readZip(blob);
    const m = zip.get('manifest.json');
    if (!m) return null;
    const manifest = JSON.parse(await m.text());
    return manifest && manifest.format === 'eyad' ? manifest : null;
  } catch (e) { return null; }
}

// ---- helpers for validating untrusted document values --------------------

export const num = (v, d = 0, min = -1e9, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
export const str = (v, d = '', max = 2000) => (typeof v === 'string' ? v.slice(0, max) : d);
export const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
export const oneOf = (v, list, d) => (list.includes(v) ? v : d);
export const color = (v, d = '#000000') => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
