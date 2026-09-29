// EYAD STUDIO — minimal ZIP container reader/writer.
// Used as the physical layout of the native .eyad project format.
// Supports STORE (0) and DEFLATE (8, via the browser's Compression Streams).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const canDeflate = typeof CompressionStream !== 'undefined';
const canInflate = typeof DecompressionStream !== 'undefined';

async function streamBytes(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * entries: [{ name, data: Uint8Array | Blob | string, compress?: boolean }]
 * Returns a Blob (application/zip).
 */
export async function writeZip(entries, { onProgress } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();
  let i = 0;
  for (const e of entries) {
    let raw;
    if (typeof e.data === 'string') raw = enc.encode(e.data);
    else if (e.data instanceof Blob) raw = new Uint8Array(await e.data.arrayBuffer());
    else raw = e.data;
    if (raw.length > 0xfffffff0) throw new Error(`"${e.name}" is larger than 4 GB, which the .eyad container does not support.`);
    const crc = crc32(raw);
    let method = 0;
    let body = raw;
    if (e.compress && canDeflate && raw.length > 256) {
      const c = await streamBytes(raw, new CompressionStream('deflate-raw'));
      if (c.length < raw.length) { body = c; method = 8; }
    }
    const nameBytes = enc.encode(e.name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, method, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    parts.push(lh.buffer, nameBytes, body);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, nameBytes);
    offset += 30 + nameBytes.length + body.length;
    i++;
    if (onProgress) onProgress(i / entries.length);
  }
  let centralSize = 0;
  for (const c of central) centralSize += c.byteLength;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/**
 * Reads a ZIP blob. Returns Map(name -> { size, read(): Promise<Uint8Array>, text(), blob(type) }).
 * Validates structure and refuses suspicious entries (absolute paths, "..", huge counts).
 */
export async function readZip(blob, { maxEntries = 20000 } = {}) {
  const size = blob.size;
  if (size < 22) throw new Error('File is too small to be a project container.');
  const tailLen = Math.min(size, 65536 + 22);
  const tail = new DataView(await blob.slice(size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid container (end record missing). The file may be damaged or truncated.');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (count > maxEntries) throw new Error('Container has too many entries.');
  if (cdOffset + cdSize > size) throw new Error('Container directory points outside the file (damaged file).');
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const out = new Map();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Container directory is damaged.');
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    const csize = cd.getUint32(p + 20, true);
    const usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true);
    const xlen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    const lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (name.startsWith('/') || name.includes('..') || name.includes('\\')) continue; // never trust paths
    if (method !== 0 && method !== 8) throw new Error(`Entry "${name}" uses an unsupported compression method.`);
    const entry = {
      name, size: usize,
      async read() {
        const lh = new DataView(await blob.slice(lho, lho + 30).arrayBuffer());
        if (lh.getUint32(0, true) !== 0x04034b50) throw new Error(`Entry "${name}" is damaged.`);
        const start = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const body = new Uint8Array(await blob.slice(start, start + csize).arrayBuffer());
        let data = body;
        if (method === 8) {
          if (!canInflate) throw new Error('This browser cannot decompress this project (Compression Streams unsupported).');
          data = await streamBytes(body, new DecompressionStream('deflate-raw'));
        }
        if (data.length !== usize || crc32(data) !== crc) throw new Error(`Entry "${name}" failed its integrity check (file corrupted).`);
        return data;
      },
      async text() { return dec.decode(await this.read()); },
      async blob(type = '') {
        if (method === 0) {
          const lh = new DataView(await blob.slice(lho, lho + 30).arrayBuffer());
          const start = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
          return blob.slice(start, start + csize, type); // zero-copy for stored media
        }
        return new Blob([await this.read()], { type });
      },
    };
    out.set(name, entry);
  }
  return out;
}
