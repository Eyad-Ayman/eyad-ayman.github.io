// EYAD VIDEO — media from links (Google Drive, Dropbox, OneDrive, direct URLs)
// and linked local files (no copy into browser storage, for very large media).
//
// Honest limits: a browser app can only read a file from another site when that
// site allows it (CORS). Dropbox and most direct/CDN links do; Google Drive and
// OneDrive often don't. When a host refuses, we say so and offer the fallback:
// open the link, download it, and pick the downloaded file.
import { h, formatBytes } from '../core/dom.js';
import { toast, formDialog, dialog, progressDialog } from '../core/ui.js';
import { sanitizeFilename, LIMITS } from '../core/files.js';
import { chooseFiles } from '../core/open.js';
import { db } from '../core/db.js';
import { uid } from '../core/dom.js';
import { probeVideo, probeAudio } from './media.js';

const MEDIA_EXT = /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|oga|opus|flac|jpe?g|png|webp|gif|avif)$/i;

/** Turn a share link into a direct download URL when we know how. */
export function normalizeLink(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch (e) { throw new Error('That is not a valid link.'); }
  if (u.protocol !== 'https:') throw new Error('Only https:// links are supported.');
  if (u.username || u.password) throw new Error('Links with embedded credentials are not allowed.');
  const host = u.hostname.toLowerCase();
  let service = 'Direct link', url = u.href, name = sanitizeFilename(decodeURIComponent(u.pathname.split('/').pop() || '') || 'linked-media');
  // Google Drive: /file/d/<id>/view, open?id=<id>, uc?id=<id>
  if (host === 'drive.google.com' || host === 'docs.google.com' || host === 'drive.usercontent.google.com') {
    const m = u.pathname.match(/\/d\/([\w-]{10,})/) || [null, u.searchParams.get('id')];
    if (!m[1] || !/^[\w-]{10,}$/.test(m[1])) throw new Error('Could not find the file id in this Google Drive link.');
    service = 'Google Drive'; url = `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t`; name = 'drive-' + m[1].slice(0, 8);
  } else if (host === 'www.dropbox.com' || host === 'dropbox.com' || host === 'dl.dropboxusercontent.com') {
    service = 'Dropbox';
    const d = new URL(u.href); d.hostname = 'dl.dropboxusercontent.com'; d.searchParams.delete('dl'); d.searchParams.delete('raw');
    url = d.href;
  } else if (host === '1drv.ms' || host.endsWith('onedrive.live.com') || host.endsWith('sharepoint.com')) {
    service = 'OneDrive';
    if (host.endsWith('sharepoint.com') && !u.searchParams.has('download')) { const d = new URL(u.href); d.searchParams.set('download', '1'); url = d.href; }
  }
  return { url, service, name, original: u.href };
}

function kindFromName(name, mime) {
  if (/^video\//.test(mime) || /\.(mp4|m4v|mov|webm|mkv)$/i.test(name)) return 'video';
  if (/^audio\//.test(mime) || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(name)) return 'audio';
  if (/^image\//.test(mime) || /\.(jpe?g|png|webp|gif|avif)$/i.test(name)) return 'image';
  return null;
}
function nameFromHeaders(res, fallback) {
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  let n = m ? decodeURIComponent(m[1]) : fallback;
  n = sanitizeFilename(n, 'linked-media');
  if (!MEDIA_EXT.test(n)) {
    const t = (res.headers.get('content-type') || '').split(';')[0];
    const ext = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[t];
    if (ext) n += ext;
  }
  return n;
}

export async function linkMediaDialog(app) {
  const v = await formDialog({
    title: 'Add media from a link', ok: 'Add',
    intro: 'Paste a share link from Google Drive, Dropbox, OneDrive, or any direct https:// link to a video, audio or image file. The file must be shared as “Anyone with the link”.',
    fields: [
      { key: 'url', label: 'Link', type: 'url', value: '', placeholder: 'https://drive.google.com/file/d/…', inputMode: 'url', autocomplete: 'off' },
      { key: 'mode', label: 'How', type: 'select', value: 'download', options: [
        { value: 'download', label: 'Download into the project (works offline, keeps a copy)' },
        { value: 'stream', label: 'Stream from the link (nothing copied — best for huge files)' },
      ] },
      { type: 'note', label: 'Streaming needs the link to stay public and the host to allow browser playback. Nothing is uploaded anywhere — the file only travels from the host to this device.' },
    ],
  });
  if (!v || !v.url) return;
  let L;
  try { L = normalizeLink(v.url); } catch (e) { toast(e.message, { type: 'error' }); return; }
  if (!app.project) await app.ensureProject();
  if (v.mode === 'stream') return streamLink(app, L);
  return downloadLink(app, L);
}

async function downloadLink(app, L) {
  const ctrl = new AbortController();
  const p = progressDialog('Downloading from ' + L.service);
  p.onCancel(() => ctrl.abort());
  p.set(null, 'Connecting…');
  let res;
  try {
    res = await fetch(L.url, { signal: ctrl.signal, credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error('The host answered ' + res.status + (res.status === 403 || res.status === 404 ? ' — is the file shared publicly?' : ''));
  } catch (e) {
    p.close();
    if (e.name === 'AbortError') return;
    return blocked(app, L, e);
  }
  const type = (res.headers.get('content-type') || '').split(';')[0];
  if (/text\/html/.test(type)) { p.close(); ctrl.abort(); return blocked(app, L, new Error('The link returned a web page, not a media file (the file may be private, or the host shows a confirmation page).')); }
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > LIMITS.media) { p.close(); ctrl.abort(); toast(`That file is ${formatBytes(total)} — too large to download in the browser. Use “Stream from the link” instead.`, { type: 'error', timeout: 9000 }); return; }
  const name = nameFromHeaders(res, L.name);
  const chunks = []; let got = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (got > LIMITS.media) throw new Error('The download is larger than the browser limit.');
      p.set(total ? got / total : null, `${formatBytes(got)}${total ? ' of ' + formatBytes(total) : ''}`);
    }
  } catch (e) { p.close(); if (e.name !== 'AbortError') toast('Download failed: ' + e.message, { type: 'error' }); return; }
  p.close();
  const file = new File(chunks, name, { type: type || '' });
  if (!kindFromName(name, file.type)) { toast(`${name}: this doesn’t look like a video, audio or image file.`, { type: 'error' }); return; }
  const ids = await app.importFiles([file]);
  toast(`Added ${name} from ${L.service}`, { type: 'ok' });
  return ids;
}

async function streamLink(app, L) {
  const p = progressDialog('Linking ' + L.service, { cancellable: false });
  p.set(null, 'Reading media info…');
  // media elements with crossOrigin=anonymous: needed so frames can be composited/exported
  let kind = kindFromName(L.name, '') || 'video', info;
  try {
    if (kind === 'audio') info = await probeAudio(L.url, { cors: true });
    else if (kind === 'image') {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer';
      await new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('The image could not be loaded from this link.')); img.src = L.url; });
      info = { width: img.naturalWidth, height: img.naturalHeight, img };
    } else info = await probeVideo(L.url, { cors: true });
  } catch (e) { p.close(); return blocked(app, L, e, true); }
  p.close();
  const m = await app.media.addRemote({ ...L, kind, info });
  app.project.media.push(m);
  app.changed();
  toast(`Linked ${m.name} — streaming from ${L.service}`, { type: 'ok' });
  return m;
}

async function blocked(app, L, err, stream = false) {
  const v = await dialog({
    title: L.service + ' didn’t hand the file to the browser',
    body: h('div', { class: 'studio-stack' },
      h('p', { text: stream ? 'The host doesn’t allow this file to be played inside another web app.' : 'The host doesn’t allow web apps to read this file directly (a browser security rule called CORS).' }),
      h('p', { class: 'studio-small studio-dim', text: 'Reason: ' + (err && err.message ? err.message : 'blocked') }),
      h('p', { class: 'studio-small', text: 'Do this instead — it takes a few seconds: 1) open the link and download the file, 2) come back and pick it. On iPhone the download lands in Files ▸ Downloads.' })),
    buttons: [{ label: 'Close', value: null }, { label: 'Open link', value: 'open' }, { label: 'Pick downloaded file', value: 'pick', primary: true }],
  });
  if (v === 'open') { window.open(L.original, '_blank', 'noopener,noreferrer'); return blocked(app, L, err, stream); }
  if (v === 'pick') { const files = await chooseFiles({ title: 'Pick the downloaded file', media: 'any', multiple: true }); if (files.length) return app.importFiles(files); }
}

// ------------------------------------------------------------------ linked local files

export const canLinkLocal = () => typeof window.showOpenFilePicker === 'function';

/** Link big local files by reference (File System Access): nothing is copied into browser storage. */
export async function linkLocalFiles(app) {
  if (!canLinkLocal()) { toast('Linking files by reference needs Chrome or Edge on a computer. Import instead — large files are still read straight from disk.', { timeout: 7000 }); return; }
  let handles;
  try {
    handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Media', accept: { 'video/*': ['.mp4', '.m4v', '.mov', '.webm', '.mkv'], 'audio/*': ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac'], 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif'] } }] });
  } catch (e) { return; }
  if (!app.project) await app.ensureProject();
  const files = [];
  for (const hd of handles) { try { files.push([hd, await hd.getFile()]); } catch (e) { /* skip */ } }
  const ids = await app.importFiles(files.map(([, f]) => f), { store: false });
  // remember each handle so the project can reconnect next time
  const media = app.project.media.slice(-files.length);
  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    m.linkedLocal = true;
    try { await db.put('files', { id: 'handle:' + m.id, handle: files[i][0], created: Date.now() }); } catch (e) { /* not storable */ }
  }
  app.changed();
  toast(`${files.length} file(s) linked from disk — no copy stored`, { type: 'ok' });
  return ids;
}

/** Try to reconnect linked local files (needs a user gesture on first use per session). */
export async function reconnectLocal(app, m, { ask = false } = {}) {
  try {
    const rec = await db.get('files', 'handle:' + m.id);
    if (!rec || !rec.handle) return false;
    const opts = { mode: 'read' };
    let perm = await rec.handle.queryPermission(opts);
    if (perm !== 'granted' && ask) perm = await rec.handle.requestPermission(opts);
    if (perm !== 'granted') return false;
    const f = await rec.handle.getFile();
    await app.media.setBlob(m, f);
    m.offline = false;
    return true;
  } catch (e) { return false; }
}

export function newId() { return uid('m'); }
