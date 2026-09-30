// Kiwi binary schema + message DECODER that interprets the schema at runtime.
//
// Adapted from the Kiwi schema runtime by Evan Wallace (https://github.com/evanw/kiwi,
// MIT — see LICENSE in this folder). The upstream compileSchema() generates code and
// runs it with `new Function`, which a strict Content-Security-Policy forbids, so this
// file walks the decoded schema field by field instead (same wire format: STRUCT
// fields in order, MESSAGE fields tagged and terminated by 0, deprecated fields
// skipped, ENUMs as varuint).
//
// Hardened for untrusted input: every read is bounds-checked, array lengths are
// validated against the remaining bytes, nesting depth and total value count are capped.

const TYPES = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'];
const KINDS = ['ENUM', 'STRUCT', 'MESSAGE'];
const f32 = new Float32Array(1);
const i32 = new Int32Array(f32.buffer);

export class ByteBuffer {
  constructor(data) { this.data = data instanceof Uint8Array ? data : new Uint8Array(data); this.i = 0; }
  get remaining() { return this.data.length - this.i; }
  readByte() { if (this.i >= this.data.length) throw new Error('Kiwi: read past end of data'); return this.data[this.i++]; }
  readByteArray() {
    const n = this.readVarUint();
    if (n > this.remaining) throw new Error('Kiwi: byte array out of bounds');
    const out = this.data.subarray(this.i, this.i + n); this.i += n; return out;
  }
  readVarFloat() {
    const d = this.data, i = this.i;
    if (i >= d.length) throw new Error('Kiwi: read past end of data');
    if (d[i] === 0) { this.i = i + 1; return 0; }
    if (i + 4 > d.length) throw new Error('Kiwi: read past end of data');
    let bits = d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24);
    this.i = i + 4;
    bits = (bits << 23) | (bits >>> 9);
    i32[0] = bits;
    return f32[0];
  }
  readVarUint() {
    let v = 0, shift = 0, b;
    do { b = this.readByte(); v |= (b & 127) << shift; shift += 7; } while (b & 128 && shift < 35);
    return v >>> 0;
  }
  readVarInt() { const v = this.readVarUint() | 0; return v & 1 ? ~(v >>> 1) : v >>> 1; }
  readVarUint64() {
    let v = 0n, shift = 0n, b;
    while ((b = this.readByte()) & 128 && shift < 56n) { v |= BigInt(b & 127) << shift; shift += 7n; }
    return v | (BigInt(b) << shift);
  }
  readVarInt64() { const v = this.readVarUint64(); return v & 1n ? ~(v >> 1n) : v >> 1n; }
  readString() {
    // NUL-terminated UTF-8
    const d = this.data, start = this.i;
    let end = start;
    while (end < d.length && d[end] !== 0) end++;
    if (end >= d.length) throw new Error('Kiwi: unterminated string');
    this.i = end + 1;
    return TD.decode(d.subarray(start, end));
  }
}
const TD = new TextDecoder();

/** Decode a binary Kiwi schema → { definitions: [{ name, kind, fields: [{ name, type, isArray, value }] }] }. */
export function decodeBinarySchema(bytes) {
  const bb = bytes instanceof ByteBuffer ? bytes : new ByteBuffer(bytes);
  const count = bb.readVarUint();
  if (count > 20000) throw new Error('Kiwi: schema has too many definitions');
  const defs = [];
  for (let i = 0; i < count; i++) {
    const name = bb.readString(), kind = KINDS[bb.readByte()], fieldCount = bb.readVarUint();
    if (!kind) throw new Error('Kiwi: invalid definition kind');
    if (fieldCount > 5000) throw new Error('Kiwi: definition has too many fields');
    const fields = [];
    for (let j = 0; j < fieldCount; j++) {
      const fname = bb.readString(), type = bb.readVarInt(), isArray = !!(bb.readByte() & 1), value = bb.readVarUint();
      fields.push({ name: fname, type: kind === 'ENUM' ? null : type, isArray, value });
    }
    defs.push({ name, kind, fields });
  }
  for (const d of defs) for (const f of d.fields) {
    if (f.type === null) continue;
    if (f.type < 0) { if (~f.type >= TYPES.length) throw new Error('Kiwi: invalid field type'); f.type = TYPES[~f.type]; }
    else { if (f.type >= defs.length) throw new Error('Kiwi: invalid field type'); f.type = defs[f.type].name; }
  }
  return { package: null, definitions: defs };
}

/**
 * Build a decoder for a schema. decoder.decode(typeName, bytes) → plain object tree.
 * opts: { maxDepth = 64, maxValues = 30e6, skipFields: Set of field names never kept }.
 */
export function createDecoder(schema, { maxDepth = 64, maxValues = 30e6, skipFields = null } = {}) {
  const defs = new Map();
  for (const d of schema.definitions) {
    const byTag = new Map(), enumByValue = new Map();
    for (const f of d.fields) { if (d.kind === 'ENUM') enumByValue.set(f.value, f.name); else byTag.set(f.value, f); }
    defs.set(d.name, { ...d, byTag, enumByValue });
  }
  let values = 0;
  const readValue = (type, bb, depth) => {
    if (++values > maxValues) throw new Error('Kiwi: document is too large to decode safely');
    switch (type) {
      case 'bool': return !!bb.readByte();
      case 'byte': return bb.readByte();
      case 'int': return bb.readVarInt();
      case 'uint': return bb.readVarUint();
      case 'float': return bb.readVarFloat();
      case 'string': return bb.readString();
      case 'int64': return bb.readVarInt64();
      case 'uint64': return bb.readVarUint64();
      default: {
        const d = defs.get(type);
        if (!d) throw new Error('Kiwi: unknown type ' + String(type).slice(0, 40));
        if (d.kind === 'ENUM') { const v = bb.readVarUint(); return d.enumByValue.has(v) ? d.enumByValue.get(v) : v; }
        return readObject(d, bb, depth + 1);
      }
    }
  };
  const readField = (f, bb, depth, out) => {
    if (f.isArray) {
      if (f.type === 'byte') { const v = bb.readByteArray(); if (!(skipFields && skipFields.has(f.name))) out[f.name] = v; return; }
      const n = bb.readVarUint();
      if (n > bb.remaining) throw new Error('Kiwi: array length out of bounds');
      const arr = new Array(n);
      for (let i = 0; i < n; i++) arr[i] = readValue(f.type, bb, depth);
      if (!(skipFields && skipFields.has(f.name))) out[f.name] = arr;
      return;
    }
    const v = readValue(f.type, bb, depth);
    if (!(skipFields && skipFields.has(f.name))) out[f.name] = v;
  };
  const readObject = (d, bb, depth) => {
    if (depth > maxDepth) throw new Error('Kiwi: nesting is too deep');
    const out = {};
    if (d.kind === 'STRUCT') { for (const f of d.fields) readField(f, bb, depth, out); return out; }
    for (;;) {
      const tag = bb.readVarUint();
      if (tag === 0) return out;
      const f = d.byTag.get(tag);
      if (!f) throw new Error('Kiwi: invalid field tag in ' + d.name);
      readField(f, bb, depth, out);
    }
  };
  return {
    has: (name) => defs.has(name),
    decode(typeName, bytes) {
      values = 0;
      const d = defs.get(typeName);
      if (!d || d.kind === 'ENUM') throw new Error('Kiwi: no message type ' + typeName);
      return readObject(d, bytes instanceof ByteBuffer ? bytes : new ByteBuffer(bytes), 0);
    },
  };
}
