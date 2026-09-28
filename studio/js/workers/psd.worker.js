/* EYAD IMAGE — PSD reader/writer worker.
 * Uses the MIT-licensed ag-psd library (vendor/ag-psd.min.js) — a real PSD
 * parser. Parsing runs here so huge files don't freeze the editor.
 */
/* global agPsd */
importScripts('../../vendor/ag-psd.min.js');

agPsd.initializeCanvas(
  function (w, h) { if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas unavailable'); return new OffscreenCanvas(w, h); },
  function (w, h) { return new ImageData(Math.max(1, w), Math.max(1, h)); }
);

function to8bit(img) {
  if (!img) return null;
  var w = img.width, h = img.height, d = img.data;
  if (d instanceof Uint8ClampedArray || d instanceof Uint8Array) return { width: w, height: h, data: new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength), converted: false };
  var out = new Uint8ClampedArray(w * h * 4);
  if (d instanceof Uint16Array) { for (var i = 0; i < out.length; i++) out[i] = d[i] >> 8; }
  else if (d instanceof Float32Array) { for (var j = 0; j < out.length; j++) out[j] = Math.max(0, Math.min(255, Math.pow(Math.max(0, d[j]), 1 / 2.2) * 255)); }
  else { for (var k = 0; k < out.length; k++) out[k] = d[k]; }
  return { width: w, height: h, data: out, converted: true };
}

function packImage(img, transfers) {
  var c = to8bit(img);
  if (!c || !c.width || !c.height) return null;
  // copy into its own buffer so it can be transferred
  var buf = c.data.byteOffset === 0 && c.data.byteLength === c.data.buffer.byteLength ? c.data.buffer : c.data.slice().buffer;
  transfers.push(buf);
  return { width: c.width, height: c.height, buffer: buf, converted: c.converted };
}

function safeText(layer) {
  try {
    if (!layer.text) return null;
    var st = layer.text.style || {};
    var font = st.font && st.font.name;
    var col = st.fillColor;
    var color = col && typeof col.r === 'number' ? [col.r, col.g, col.b] : null;
    return { text: String(layer.text.text || '').slice(0, 20000), font: font ? String(font).slice(0, 120) : null, size: st.fontSize || null, color: color };
  } catch (e) { return { text: '', font: null, size: null }; }
}

function convertLayer(l, transfers, depth) {
  var out = {
    name: String(l.name || 'Layer').slice(0, 250),
    hidden: !!l.hidden,
    opacity: typeof l.opacity === 'number' ? l.opacity : 1,
    fillOpacity: typeof l.fillOpacity === 'number' ? l.fillOpacity : 1,
    blendMode: l.blendMode || 'normal',
    left: l.left || 0, top: l.top || 0, right: l.right || 0, bottom: l.bottom || 0,
    clipping: !!l.clipping,
    locked: !!(l.protected && (l.protected.transparency || l.protected.composite || l.protected.position)),
    isGroup: !!l.children,
    opened: l.opened !== false,
    text: safeText(l),
    smart: !!l.placedLayer,
    adjustment: l.adjustment ? String(l.adjustment.type || 'adjustment') : null,
    effects: l.effects ? Object.keys(l.effects).filter(function (k) { return k !== 'scale' && k !== 'disabled'; }) : [],
    effectsDisabled: !!(l.effects && l.effects.disabled),
    vectorMask: !!l.vectorMask,
    vectorFill: !!l.vectorFill,
    artboard: !!l.artboard,
    image: null,
    mask: null,
    children: null,
    vector: null,
  };
  try {
    if (l.vectorMask && l.vectorMask.paths && l.vectorMask.paths.length) {
      var vf = l.vectorFill, vs = l.vectorStroke;
      var col = function (c) { return c && typeof c.r === 'number' ? [c.r, c.g, c.b] : null; };
      out.vector = {
        fill: vf && vf.type === 'color' ? col(vf.color) : null,
        fillType: vf ? vf.type : null,
        fillEnabled: !(vs && vs.fillEnabled === false),
        stroke: vs && vs.strokeEnabled ? { width: vs.lineWidth && vs.lineWidth.value || 1, color: vs.content && vs.content.type === 'color' ? col(vs.content.color) : null } : null,
        paths: l.vectorMask.paths.slice(0, 500).map(function (pa) {
          return { open: !!pa.open, op: pa.operation || 'combine', knots: (pa.knots || []).slice(0, 5000).map(function (k) { return k.points.slice(0, 6); }) };
        }),
      };
    }
  } catch (e) { out.vector = null; }
  if (l.imageData) out.image = packImage(l.imageData, transfers);
  if (l.mask && (l.mask.imageData || typeof l.mask.defaultColor === 'number')) {
    out.mask = {
      left: l.mask.left || 0, top: l.mask.top || 0, right: l.mask.right || 0, bottom: l.mask.bottom || 0,
      defaultColor: typeof l.mask.defaultColor === 'number' ? l.mask.defaultColor : 0,
      disabled: !!l.mask.disabled,
      image: l.mask.imageData ? packImage(l.mask.imageData, transfers) : null,
    };
  }
  if (l.children && depth < 60) out.children = l.children.map(function (c) { return convertLayer(c, transfers, depth + 1); });
  return out;
}

self.onmessage = function (e) {
  var msg = e.data;
  try {
    if (msg.op === 'read') {
      var psd = agPsd.readPsd(msg.buffer, {
        useImageData: true,
        skipThumbnail: false,
        throwForMissingFeatures: false,
        logMissingFeatures: false,
      });
      var transfers = [];
      var res = psd.imageResources || {};
      var thumb = null;
      try { if (res.thumbnail && res.thumbnail instanceof ImageData) thumb = packImage(res.thumbnail, transfers); } catch (err) { thumb = null; }
      var out = {
        width: psd.width, height: psd.height,
        bitsPerChannel: psd.bitsPerChannel || 8,
        colorMode: psd.colorMode,
        channels: psd.channels,
        composite: psd.imageData ? packImage(psd.imageData, transfers) : null,
        thumbnail: thumb,
        resolution: res.resolutionInfo ? { h: res.resolutionInfo.horizontalResolution, unit: res.resolutionInfo.horizontalResolutionUnit } : null,
        hasIcc: !!res.iccProfile,
        hasXmp: !!res.xmpMetadata,
        layerComps: res.layerComps ? (res.layerComps.list || []).length : 0,
        guides: res.gridAndGuidesInformation && res.gridAndGuidesInformation.guides ? res.gridAndGuidesInformation.guides.map(function (g) { return { location: g.location, direction: g.direction }; }) : [],
        children: (psd.children || []).map(function (c) { return convertLayer(c, transfers, 0); }),
      };
      self.postMessage({ id: msg.id, result: out }, transfers);
    } else if (msg.op === 'write') {
      var toImg = function (p) { return p ? new ImageData(new Uint8ClampedArray(p.buffer), p.width, p.height) : undefined; };
      var mapLayer = function (l) {
        var o = { name: l.name, hidden: l.hidden, opacity: l.opacity, blendMode: l.blendMode, clipping: l.clipping };
        if (l.children) { o.children = l.children.map(mapLayer); o.opened = l.opened; }
        else { o.left = l.left; o.top = l.top; o.imageData = toImg(l.image); }
        if (l.mask) o.mask = { left: l.mask.left, top: l.mask.top, imageData: toImg(l.mask.image), defaultColor: 0 };
        return o;
      };
      var doc = { width: msg.doc.width, height: msg.doc.height, imageData: toImg(msg.doc.composite), children: msg.doc.children.map(mapLayer) };
      var buf = agPsd.writePsd(doc, { generateThumbnail: false, trimImageData: false, noBackground: false });
      self.postMessage({ id: msg.id, result: buf }, [buf]);
    }
  } catch (err) {
    self.postMessage({ id: msg.id, error: String(err && err.message || err) });
  }
};
