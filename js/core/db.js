// EYAD STUDIO — IndexedDB storage (local-first; nothing leaves the device).
//
// Stores
//   projects  — project metadata + thumbnail (small records)
//   files     — large binary payloads: saved .eyad containers and video media
//   recovery  — autosave snapshots used for crash recovery
//   handoff   — files passed from one Studio page to another (e.g. Projects → Image)
//
// Things phones do to IndexedDB that this module absorbs:
//   · iOS drops the database connection when the app goes to the background ("Connection to Indexed
//     Database server lost") → every operation reopens the database and retries once.
//   · Some iOS versions cannot store Blob/File values (or store them and fail later) → on such a failure
//     the same record is written again with its Blobs as ArrayBuffers, and converted back on read.
//   · A failed open must not be cached forever (private mode, a blocked upgrade) → the next call retries.
//   · Quota / private-mode errors become a StorageError with a message a person can act on.
//   · Safari deletes the data of sites that are not installed after about 7 days without a visit →
//     persistence is requested at the first save, and storageInfo() reports the real state.

const DB_NAME = 'eyad-studio';
const DB_VERSION = 1;
const STORES = ['projects', 'files', 'recovery', 'handoff'];
let dbPromise = null;

/** code: 'quota' | 'private' | 'unavailable' | 'blocked' | 'lost' | 'unreadable' | 'unknown' */
export class StorageError extends Error {
  constructor(code, message, cause) { super(message); this.name = 'StorageError'; this.code = code; this.cause = cause; }
}

const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 || /quota|disk.*full|no space|out of space/i.test(e.message || ''));
const isLost = (e) => !!e && ((e.name === 'InvalidStateError') || (e.name === 'UnknownError' && /connection|lost|closed|server/i.test(e.message || '')) || /connection to indexed database server lost|database connection is closing|connection is closing/i.test(e.message || ''));

function friendly(e, what = '') {
  if (e instanceof StorageError) return e;
  if (isQuota(e)) return new StorageError('quota', 'The storage for the Studio on this device is full. Download a copy of your work, then delete old projects (Projects page) or free some space on the device.', e);
  if (e && (e.name === 'SecurityError' || (e.name === 'InvalidStateError' && what === 'open'))) return new StorageError('private', 'This browser is blocking on-device storage (private browsing, or site data is turned off). Projects cannot be kept here — download your work as a file instead.', e);
  if (isLost(e)) return new StorageError('lost', 'The connection to on-device storage was lost (the browser paused the app). Try again.', e);
  return new StorageError('unknown', (e && e.message) || 'On-device storage failed.', e);
}

function openOnce() {
  return new Promise((resolve, reject) => {
    let idb;
    try { idb = self.indexedDB; } catch (e) { reject(friendly(e, 'open')); return; }
    if (!idb) { reject(new StorageError('unavailable', 'This browser has no IndexedDB, so projects cannot be stored on this device. Download your work as a file instead.')); return; }
    let req, settled = false;
    const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
    // iOS 14 sometimes never answers the first open() after launch: give up and let the caller retry.
    const timer = setTimeout(() => done(reject, new StorageError('lost', 'On-device storage did not answer. Close other Studio tabs and try again.')), 8000);
    try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { done(reject, friendly(e, 'open')); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id' });
        s.createIndex('updated', 'updated');
        s.createIndex('kind', 'kind');
      }
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('handoff')) db.createObjectStore('handoff', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) { try { db.close(); } catch (e) { /* late answer after the timeout */ } return; }
      const drop = () => { if (current === db) { current = null; dbPromise = null; } };
      db.onversionchange = () => { try { db.close(); } catch (e) { /* ignore */ } drop(); };
      db.onclose = drop;   // the browser closed it (iOS backgrounding, storage cleared)
      current = db;
      done(resolve, db);
    };
    req.onerror = () => done(reject, friendly(req.error, 'open'));
    // "blocked" only means another tab still holds an older version; success normally follows once it closes.
    req.onblocked = () => { blockedNote = 'Another open Studio tab is using an older version of the storage. Close the other tabs.'; };
  });
}
let current = null;
let blockedNote = '';

export function openDB() {
  if (dbPromise) return dbPromise;
  const p = openOnce().catch((e) => (e.code === 'lost' ? openOnce() : Promise.reject(e)));
  dbPromise = p;
  p.catch(() => { if (dbPromise === p) dbPromise = null; });   // never cache a failure
  return p;
}
function resetDB() { try { current && current.close(); } catch (e) { /* ignore */ } current = null; dbPromise = null; }

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * One transaction. `fn` gets the object store (single store name) or the transaction (array of names).
 * fn must only wait for IndexedDB requests: a transaction closes itself as soon as the code awaits anything else.
 */
async function tx(stores, mode, fn, attempt = 0) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      let t;
      try { t = db.transaction(stores, mode); } catch (e) { reject(e); return; }
      let result, failure = null;
      t.oncomplete = () => (failure ? reject(failure) : resolve(result));
      t.onerror = () => reject(failure || t.error || new Error('Storage transaction failed'));
      t.onabort = () => reject(failure || t.error || new Error('Storage transaction aborted (the device may be out of space).'));
      const fail = (e) => { failure = failure || e; try { t.abort(); } catch (x) { reject(failure); } };
      try { Promise.resolve(fn(Array.isArray(stores) ? t : t.objectStore(stores))).then((r) => { result = r; }, fail); } catch (e) { fail(e); }
    });
  } catch (e) {
    if (attempt < 1 && isLost(e) && !isQuota(e)) { resetDB(); return tx(stores, mode, fn, attempt + 1); }
    throw friendly(e);
  }
}

// ---------- Blob ⇄ ArrayBuffer fallback ----------

const MARK = '__eyadBlob';
let blobMode = 'native';   // 'native' | 'buffer' (this device cannot keep Blobs in IndexedDB)
try { if (typeof localStorage !== 'undefined' && localStorage.getItem('eyad-studio:idb-blobs') === 'buffer') blobMode = 'buffer'; } catch (e) { /* ignore */ }
const isBlob = (v) => typeof Blob !== 'undefined' && v instanceof Blob;
const isPlain = (v) => v && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype);

function hasBlob(v, depth = 0) {
  if (isBlob(v)) return true;
  if (!isPlain(v) || depth > 4) return false;
  for (const k in v) if (hasBlob(v[k], depth + 1)) return true;
  return false;
}
async function encode(v, depth = 0) {
  if (isBlob(v)) {
    const out = { [MARK]: 1, type: v.type || '', buf: await v.arrayBuffer() };
    if (typeof File !== 'undefined' && v instanceof File) { out.name = v.name; out.lastModified = v.lastModified; }
    return out;
  }
  if (!isPlain(v) || depth > 4) return v;
  if (Array.isArray(v)) { const a = []; for (const x of v) a.push(await encode(x, depth + 1)); return a; }
  const o = {};
  for (const k of Object.keys(v)) o[k] = await encode(v[k], depth + 1);
  return o;
}
function decode(v, depth = 0) {
  if (!isPlain(v) || depth > 4) return v;
  if (v[MARK] === 1 && v.buf instanceof ArrayBuffer) {
    return typeof v.name === 'string' && typeof File !== 'undefined' ? new File([v.buf], v.name, { type: v.type || '', lastModified: v.lastModified || Date.now() }) : new Blob([v.buf], { type: v.type || '' });
  }
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = decode(v[i], depth + 1); return v; }
  for (const k of Object.keys(v)) { const x = v[k]; if (x && typeof x === 'object') v[k] = decode(x, depth + 1); }
  return v;
}
function useBuffers() {
  blobMode = 'buffer';
  try { localStorage.setItem('eyad-studio:idb-blobs', 'buffer'); } catch (e) { /* ignore */ }
}

/** Write records ([[store, value], …]) in ONE transaction, falling back to ArrayBuffers when Blobs are refused. */
async function putMany(pairs) {
  const names = Array.from(new Set(pairs.map((p) => p[0])));
  const write = (list) => tx(names, 'readwrite', (t) => { let last; for (const [s, v] of list) last = t.objectStore(s).put(v); return wrap(last); });
  const blobs = pairs.some((p) => hasBlob(p[1]));
  const enc = async () => { const out = []; for (const [s, v] of pairs) out.push([s, await encode(v)]); return out; };
  if (blobs && blobMode === 'buffer') return write(await enc());
  try { return await write(pairs); } catch (e) {
    if (!blobs || e.code === 'quota' || e.code === 'private') throw e;
    // anything else with Blobs in the record: try once more without Blobs (older iOS)
    let list;
    try { list = await enc(); } catch (e2) { throw e; }
    const r = await write(list);
    useBuffers();
    return r;
  }
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))).then((v) => decode(v)),
  put: (store, value) => putMany([[store, value]]),
  del: (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key))),
  all: (store) => tx(store, 'readonly', (s) => wrap(s.getAll())).then((a) => decode(a || [])),
  clear: (store) => tx(store, 'readwrite', (s) => wrap(s.clear())),
  keys: (store) => tx(store, 'readonly', (s) => wrap(s.getAllKeys())),
};

// ---------- telling the person when storage fails (they must never lose the document) ----------

const told = new Map();
/**
 * Show a "storage failed" toast with a "Download a copy" action for `blob` (rate-limited, UI pages only).
 * Called automatically by saveProject / putRecovery; apps may call it too.
 */
export async function offerCopy(error, { name = 'project', blob = null, key = 'save', every = 45000 } = {}) {
  if (typeof document === 'undefined') return;
  const now = Date.now();
  if (told.has(key) && now - told.get(key) < every) return;
  told.set(key, now);
  try {
    const [{ toast }, { downloadBlob, sanitizeFilename, savedToast }] = await Promise.all([import('./ui.js'), import('./files.js')]);
    const eyad = blob && isBlob(blob) && !/json/.test(blob.type || '');
    const head = error && error.code === 'quota' ? 'Storage is full — this was not saved on the device.'
      : error && error.code === 'private' ? 'This browser is not keeping Studio data.'
        : 'Saving on this device failed.';
    toast(head, {
      type: 'error', timeout: 0,
      detail: eyad && error && error.code === 'quota' ? 'Download a copy now so nothing is lost, then delete old projects or free space on the device.' : (eyad ? 'Download a copy now so nothing is lost. ' : '') + ((error && error.message) || ''),
      action: eyad ? { label: 'Download a copy', fn: () => { savedToast(downloadBlob(blob, sanitizeFilename(name) + '.eyad'), 'Copy saved.'); } } : null,
    });
  } catch (e) { /* the toast is a courtesy; the caller still gets the error */ }
}

// ---------- Projects ----------

export async function listProjects() {
  const all = await db.all('projects');
  return all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export async function getProject(id) { return db.get('projects', id); }

/** Save a project: metadata record + the .eyad container blob (one transaction: never half-saved). */
export async function saveProject(meta, eyadBlob) {
  const now = Date.now();
  const record = {
    id: meta.id,
    name: meta.name || 'Untitled',
    kind: meta.kind,
    source: meta.source || 'eyad',
    created: meta.created || now,
    updated: now,
    opened: meta.opened || now,
    size: eyadBlob.size,
    width: meta.width || 0,
    height: meta.height || 0,
    duration: meta.duration || 0,
    thumb: meta.thumb || null,
    mediaIds: Array.isArray(meta.mediaIds) ? meta.mediaIds.slice(0, 5000) : [],
  };
  try {
    await putMany([['files', { id: 'project:' + meta.id, blob: eyadBlob }], ['projects', record]]);
  } catch (e) {
    gateFailed();
    offerCopy(e, { name: record.name, blob: eyadBlob, key: 'project:' + meta.id });
    throw e;
  }
  ensurePersist();
  return record;
}

export async function loadProjectBlob(id) {
  const f = await db.get('files', 'project:' + id);
  if (!f || !f.blob) return null;
  // Some iOS versions hand back a Blob whose bytes are gone: find out now, with a clear message.
  try { await f.blob.slice(0, 4).arrayBuffer(); } catch (e) {
    throw new StorageError('unreadable', 'The data of this project can no longer be read from this device (the browser removed or damaged it).', e);
  }
  return f.blob;
}

export async function touchProject(id) {
  const p = await db.get('projects', id);
  if (p) { p.opened = Date.now(); await db.put('projects', p); }
}

export async function renameProject(id, name) {
  const p = await db.get('projects', id);
  if (p) { p.name = name; p.updated = Date.now(); await db.put('projects', p); }
}

export async function deleteProject(id) {
  const rec = await db.get('projects', id);
  await tx(['projects', 'files', 'recovery'], 'readwrite', (t) => {
    t.objectStore('projects').delete(id);
    t.objectStore('files').delete('project:' + id);
    return wrap(t.objectStore('recovery').delete(id));
  });
  // remove stored media that no other project still references
  if (rec && rec.mediaIds && rec.mediaIds.length) {
    const others = await db.all('projects');
    const keep = new Set(others.flatMap((p) => p.mediaIds || []));
    for (const m of rec.mediaIds) if (!keep.has(m)) await db.del('files', 'media:' + m);
  }
}

// ---------- Media blobs (video editor) ----------

export async function putMedia(id, blob) { await db.put('files', { id: 'media:' + id, blob, created: Date.now() }); }
export async function getMedia(id) { const f = await db.get('files', 'media:' + id); return f ? f.blob : null; }
export async function delMedia(id) { await db.del('files', 'media:' + id); }

/** Remove stored media no project or recovery snapshot references (older than a day). */
export async function cleanupOrphanMedia() {
  try {
    const keys = (await db.keys('files')).filter((k) => typeof k === 'string' && k.startsWith('media:'));
    if (!keys.length) return 0;
    const used = new Set();
    for (const p of await db.all('projects')) for (const m of p.mediaIds || []) used.add(m);
    for (const r of await db.all('recovery')) for (const m of r.mediaIds || []) used.add(m);
    let n = 0;
    for (const k of keys) {
      const id = k.slice(6);
      if (used.has(id)) continue;
      const rec = await db.get('files', k);
      if (rec && rec.created && Date.now() - rec.created < 86400000) continue;
      await db.del('files', k); n++;
    }
    return n;
  } catch (e) { return 0; }
}

// ---------- Recovery ----------

export async function putRecovery(entry) {
  try { await db.put('recovery', { ...entry, time: Date.now() }); } catch (e) {
    gateFailed();
    // once every few minutes is enough: autosave runs again and again
    offerCopy(e, { name: entry.name, blob: entry.blob, key: 'recovery', every: 300000 });
    throw e;
  }
}
export async function listRecovery(kind) {
  const all = await db.all('recovery');
  return all.filter((r) => !kind || r.kind === kind).sort((a, b) => b.time - a.time);
}
export async function delRecovery(id) { await db.del('recovery', id); }

// ---------- Autosave pacing ----------
// Building a recovery copy is the expensive part, so each editor's autosave TIMER asks first:
//   setInterval(() => { if (autosaveGate('image')) autosaveNow(app); }, …)
// (explicit flushes — leaving the page, visibilitychange → hidden — call autosaveNow directly and are never gated)
// · the page is hidden → no: the editor already flushed when it became hidden, and iOS freezes timers anyway
// · phones / tablets → at most one timed autosave every 15 s (every 5 s elsewhere)
// · after a failed write (storage full) → wait 2 minutes before trying again
const gates = new Map();
let failedAt = 0;
function gateFailed() { failedAt = Date.now(); }
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export function autosaveGate(key = 'app') {
  const now = Date.now();
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  if (failedAt && now - failedAt < 120000) return false;
  if (now - (gates.get(key) || 0) < (COARSE ? 15000 : 5000) - 250) return false;
  gates.set(key, now);
  return true;
}

// ---------- Hand-off between Studio pages ----------

export async function putHandoff(files) {
  const id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await db.put('handoff', { id, files, created: Date.now() });
  return id;
}
export async function takeHandoff(id) {
  const r = await db.get('handoff', id);
  if (r) await db.del('handoff', id);
  // Clean stale hand-offs (older than a day).
  try {
    const all = await db.all('handoff');
    for (const x of all) if (Date.now() - x.created > 86400000) await db.del('handoff', x.id);
  } catch (e) { /* ignore */ }
  return r ? r.files : null;
}

// ---------- Storage info ----------

let persistAsked = false;
/** Ask the browser not to evict Studio data. Safe to call often; asks once per page. */
export function ensurePersist() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    const st = navigator.storage;
    if (!st || !st.persist) return;
    Promise.resolve(st.persisted ? st.persisted() : false).then((on) => (on ? true : st.persist())).catch(() => {});
  } catch (e) { /* ignore */ }
}

/**
 * { usage, quota, persisted: true|false|null, estimate: bool, installed: bool, ios: bool, blobs: 'native'|'buffer' }
 * Never throws. Without { detail: true } it returns null when usage cannot be estimated (as before).
 */
export async function storageInfo({ detail = false } = {}) {
  // older callers expect null when the browser cannot estimate usage
  if (!detail && (!navigator.storage || !navigator.storage.estimate)) return null;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installed = false;
  try { installed = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) { /* ignore */ }
  const out = { usage: 0, quota: 0, persisted: null, estimate: false, installed, ios, blobs: blobMode };
  const st = navigator.storage;
  if (!st) return out;
  try { if (st.estimate) { const est = await st.estimate(); out.usage = est.usage || 0; out.quota = est.quota || 0; out.estimate = true; } } catch (e) { /* Safari < 17 has no estimate() */ }
  try { if (st.persisted) out.persisted = !!(await st.persisted()); } catch (e) { /* ignore */ }
  return out;
}

export async function requestPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    return !!(await navigator.storage.persist());
  } catch (e) { return false; }
}

/**
 * Write, read back and delete a small record with a Blob in it.
 * → { ok: true, blobs: 'native' | 'buffer', ms }  or  { ok: false, code, reason }
 */
export async function dbSelfTest() {
  const t0 = Date.now();
  const id = '__selftest:' + t0.toString(36);
  const bytes = new Uint8Array(2048);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 255;
  try {
    await db.put('files', { id, blob: new Blob([bytes], { type: 'application/octet-stream' }), created: t0 });
    const back = await db.get('files', id);
    if (!back || !isBlob(back.blob)) throw new StorageError('unreadable', 'The test record did not come back from storage.');
    let got;
    try { got = new Uint8Array(await back.blob.arrayBuffer()); } catch (e) {
      // stored, but the Blob cannot be read back: switch to ArrayBuffers and try once more
      if (blobMode === 'buffer') throw new StorageError('unreadable', 'Stored files cannot be read back on this device.', e);
      useBuffers();
      await db.put('files', { id, blob: new Blob([bytes]), created: t0 });
      got = new Uint8Array(await (await db.get('files', id)).blob.arrayBuffer());
    }
    if (got.length !== bytes.length || got[5] !== bytes[5] || got[2047] !== bytes[2047]) throw new StorageError('unreadable', 'Stored data came back damaged.');
    await db.del('files', id);
    return { ok: true, blobs: blobMode, ms: Date.now() - t0, note: blockedNote };
  } catch (e) {
    const err = friendly(e);
    try { await db.del('files', id); } catch (x) { /* ignore */ }
    return { ok: false, code: err.code, reason: err.message };
  }
}

export async function wipeAll() {
  for (const s of STORES) await db.clear(s);
}
