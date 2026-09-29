// EYAD STUDIO — IndexedDB storage (local-first; nothing leaves the device).
//
// Stores
//   projects  — project metadata + thumbnail (small records)
//   files     — large binary payloads: saved .eyad containers and video media
//   recovery  — autosave snapshots used for crash recovery
//   handoff   — files passed from one Studio page to another (e.g. Projects → Image)

const DB_NAME = 'eyad-studio';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) { reject(new Error('This browser has no IndexedDB, so projects cannot be stored locally.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open local storage.'));
    req.onblocked = () => reject(new Error('Local storage is blocked by another open Studio tab. Close other tabs and reload.'));
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('Storage transaction failed'));
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted (the device may be out of space).'));
  });
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
  put: (store, value) => tx(store, 'readwrite', (s) => wrap(s.put(value))),
  del: (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key))),
  all: (store) => tx(store, 'readonly', (s) => wrap(s.getAll())),
  clear: (store) => tx(store, 'readwrite', (s) => wrap(s.clear())),
  keys: (store) => tx(store, 'readonly', (s) => wrap(s.getAllKeys())),
};

// ---------- Projects ----------

export async function listProjects() {
  const all = await db.all('projects');
  return all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export async function getProject(id) { return db.get('projects', id); }

/** Save a project: metadata record + the .eyad container blob. */
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
  await db.put('files', { id: 'project:' + meta.id, blob: eyadBlob });
  await db.put('projects', record);
  return record;
}

export async function loadProjectBlob(id) {
  const f = await db.get('files', 'project:' + id);
  return f ? f.blob : null;
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
  await db.del('projects', id);
  await db.del('files', 'project:' + id);
  await db.del('recovery', id);
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

export async function putRecovery(entry) { await db.put('recovery', { ...entry, time: Date.now() }); }
export async function listRecovery(kind) {
  const all = await db.all('recovery');
  return all.filter((r) => !kind || r.kind === kind).sort((a, b) => b.time - a.time);
}
export async function delRecovery(id) { await db.del('recovery', id); }

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

export async function storageInfo() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const est = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  return { usage: est.usage || 0, quota: est.quota || 0, persisted };
}

export async function requestPersist() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  return navigator.storage.persist();
}

export async function wipeAll() {
  for (const s of ['projects', 'files', 'recovery', 'handoff']) await db.clear(s);
}
