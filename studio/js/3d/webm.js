// EYAD 3D — minimal WebM (Matroska) writer for one VP8/VP9 video track.
// Used with WebCodecs so renders are frame-accurate regardless of how long
// each frame takes to draw. Writes EBML header, Info (with duration),
// Tracks, one Cluster per key frame group, and Cues for seeking.

const enc = new TextEncoder();

function idBytes(id) {
  const out = [];
  while (id > 0) { out.unshift(id & 0xff); id = Math.floor(id / 256); }
  return out;
}
function sizeBytes(n) {
  // minimal-length EBML variable size integer
  for (let len = 1; len <= 8; len++) {
    const max = Math.pow(2, 7 * len) - 2;
    if (n <= max) {
      const out = new Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error('Element too large');
}
function uintBytes(v) {
  const out = [];
  do { out.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  return out;
}
const concat = (parts) => {
  let len = 0;
  for (const p of parts) len += p.length;
  const u = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { u.set(p, o); o += p.length; }
  return u;
};
function el(id, payload) {
  const body = payload instanceof Uint8Array ? payload : concat(payload);
  return concat([new Uint8Array(idBytes(id)), new Uint8Array(sizeBytes(body.length)), body]);
}
const u = (id, v) => el(id, new Uint8Array(uintBytes(v)));
const s = (id, v) => el(id, enc.encode(v));
function f64(id, v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return el(id, b); }

export class WebMWriter {
  constructor({ width, height, codec = 'V_VP9', fps = 30 }) {
    this.width = width; this.height = height; this.codec = codec; this.fps = fps;
    this.clusters = []; // { time(ms), blocks: Uint8Array[] }
    this.lastTime = 0;
  }
  /** chunk: EncodedVideoChunk */
  add(chunk) {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const ms = Math.round(chunk.timestamp / 1000);
    let c = this.clusters[this.clusters.length - 1];
    if (!c || chunk.type === 'key' || ms - c.time > 30000) { c = { time: ms, blocks: [], key: chunk.type === 'key' }; this.clusters.push(c); }
    const rel = ms - c.time;
    const head = new Uint8Array(4);
    head[0] = 0x81; // track 1
    new DataView(head.buffer).setInt16(1, rel);
    head[3] = chunk.type === 'key' ? 0x80 : 0;
    c.blocks.push(el(0xA3, concat([head, data])));
    this.lastTime = Math.max(this.lastTime, ms + Math.round(1000 / this.fps));
  }
  finish() {
    const header = el(0x1A45DFA3, [u(0x4286, 1), u(0x42F7, 1), u(0x42F2, 4), u(0x42F3, 8), s(0x4282, 'webm'), u(0x4287, 2), u(0x4285, 2)]);
    const info = el(0x1549A966, [u(0x2AD7B1, 1000000), s(0x4D80, 'EYAD 3D'), s(0x5741, 'EYAD 3D'), f64(0x4489, this.lastTime)]);
    const tracks = el(0x1654AE6B, [el(0xAE, [u(0xD7, 1), u(0x73C5, 1), u(0x83, 1), s(0x86, this.codec), u(0x9C, 0), u(0x23E383, Math.round(1e9 / this.fps)),
      el(0xE0, [u(0xB0, this.width), u(0xBA, this.height)])])]);
    const parts = [info, tracks];
    let offset = info.length + tracks.length;
    const cues = [];
    for (const c of this.clusters) {
      const cl = el(0x1F43B675, [u(0xE7, c.time), ...c.blocks]);
      if (c.key) cues.push(el(0xBB, [u(0xB3, c.time), el(0xB7, [u(0xF7, 1), u(0xF1, offset)])]));
      parts.push(cl);
      offset += cl.length;
    }
    if (cues.length) parts.push(el(0x1C53BB6B, cues));
    const segment = el(0x18538067, parts);
    return new Blob([header, segment], { type: 'video/webm' });
  }
}
