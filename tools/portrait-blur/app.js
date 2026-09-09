"use strict";

// Same real on-device model as tools/bg-remover: Google's MediaPipe
// Selfie Segmenter (Apache-2.0). Here the confidence mask blends a sharp
// and a blurred copy of each photo instead of cutting the subject out.
// Batch-capable: the model loads once and every photo dropped in reuses
// it, same pattern as the Bulk WebP Converter.
import { ImageSegmenter, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const SMALL_SIDE = 220; // blur quality doesn't need full resolution — keeps every re-render fast, even across a whole batch
const PRESETS = [6, 14, 24];

var dropZone = document.getElementById("drop-zone");
var fileInput = document.getElementById("file-input");
var browseBtn = document.getElementById("browse-btn");
var controlsRow = document.getElementById("controls-row");
var presetRow = document.getElementById("preset-row");
var blurAmountInput = document.getElementById("blur-amount");
var blurVal = document.getElementById("blur-val");
var statusLine = document.getElementById("status-line");
var statusSpinner = document.getElementById("status-spinner");
var statusText = document.getElementById("status-text");
var resultGrid = document.getElementById("result-grid");
var actionsRow = document.getElementById("actions-row");
var downloadAllBtn = document.getElementById("download-all-btn");
var clearBtn = document.getElementById("clear-btn");

var segmenter = null;
var items = []; // { id, file, objectUrl, image, foregroundCanvas, smallSourceCanvas, canvasEl, downloadLinkEl, resultBlobUrl }
var nextId = 1;

function setStatus(text, kind, showSpinner) {
  statusText.textContent = text;
  statusLine.className = "status-line show" + (kind ? " " + kind : "");
  statusSpinner.style.display = showSpinner ? "inline-block" : "none";
}
function hideStatus() { statusLine.className = "status-line"; }

async function getSegmenter() {
  if (segmenter) return segmenter;
  setStatus("Loading the AI model (first time only, ~250KB)…", "", true);
  var vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "IMAGE",
    outputCategoryMask: false,
    outputConfidenceMasks: true
  });
  return segmenter;
}

function loadImage(file) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error("That file couldn't be read as an image.")); };
    img.src = URL.createObjectURL(file);
  });
}

// Same mask-to-alpha technique as tools/bg-remover/app.js's removeBackground.
async function extractForeground(imgEl) {
  var seg = await getSegmenter();
  var result = seg.segment(imgEl);
  var mask = result.confidenceMasks && result.confidenceMasks[0];
  if (!mask) throw new Error("The model didn't return a mask for this image.");

  var maskData = mask.getAsFloat32Array();
  var mw = mask.width;
  var mh = mask.height;
  var w = imgEl.naturalWidth;
  var h = imgEl.naturalHeight;

  var canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, w, h);
  var imageData = ctx.getImageData(0, 0, w, h);
  var px = imageData.data;

  for (var y = 0; y < h; y++) {
    var my = Math.min(mh - 1, (y / h * mh) | 0);
    var rowBase = my * mw;
    for (var x = 0; x < w; x++) {
      var mx = Math.min(mw - 1, (x / w * mw) | 0);
      var alpha = maskData[rowBase + mx];
      px[(y * w + x) * 4 + 3] = alpha <= 0 ? 0 : alpha >= 1 ? 255 : (alpha * 255) | 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  mask.close();
  if (result.confidenceMasks) {
    result.confidenceMasks.forEach(function (m, i) { if (i > 0) m.close(); });
  }

  return canvas;
}

function makeSmallSourceCanvas(img) {
  var w = img.naturalWidth, h = img.naturalHeight;
  var scale = Math.min(1, SMALL_SIDE / Math.max(w, h));
  var sw = Math.max(1, Math.round(w * scale));
  var sh = Math.max(1, Math.round(h * scale));
  var c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  c.getContext("2d").drawImage(img, 0, 0, sw, sh);
  return c;
}

// One box-blur pass along one axis, edge pixels clamped (never treated as
// transparent/empty — ctx.filter's CSS blur() measured leaving over half
// a canvas transparent at higher blur values in testing; this doesn't
// have that failure mode at all, since every sample is a real pixel).
function boxBlurPass(src, dst, w, h, radius, horizontal) {
  var lineLen = horizontal ? w : h;
  var lines = horizontal ? h : w;
  for (var line = 0; line < lines; line++) {
    for (var i = 0; i < lineLen; i++) {
      var r = 0, g = 0, b = 0, count = 0;
      for (var k = -radius; k <= radius; k++) {
        var idx = i + k;
        if (idx < 0) idx = 0;
        else if (idx >= lineLen) idx = lineLen - 1;
        var srcOff = (horizontal ? line * w + idx : idx * w + line) * 4;
        r += src[srcOff]; g += src[srcOff + 1]; b += src[srcOff + 2];
        count++;
      }
      var dstOff = (horizontal ? line * w + i : i * w + line) * 4;
      dst[dstOff] = r / count; dst[dstOff + 1] = g / count; dst[dstOff + 2] = b / count;
      dst[dstOff + 3] = 255;
    }
  }
}

function boxBlur(imageData, radius) {
  if (radius < 1) return;
  var w = imageData.width, h = imageData.height;
  var a = imageData.data;
  var b = new Uint8ClampedArray(a.length);
  for (var pass = 0; pass < 2; pass++) {
    boxBlurPass(a, b, w, h, radius, true);
    boxBlurPass(b, a, w, h, radius, false);
  }
}

// Re-runs on every slider move / preset click — no model inference here,
// just a blur over a small cached copy of the photo scaled back up, with
// the pre-computed sharp cutout laid on top.
function renderItem(item, blurPx) {
  var w = item.image.naturalWidth;
  var h = item.image.naturalHeight;
  item.canvasEl.width = w;
  item.canvasEl.height = h;

  var sw = item.smallSourceCanvas.width, sh = item.smallSourceCanvas.height;
  var scale = sw / w;
  var imageData = item.smallSourceCanvas.getContext("2d").getImageData(0, 0, sw, sh);
  boxBlur(imageData, Math.max(1, Math.round(blurPx * scale)));

  var blurredCanvas = document.createElement("canvas");
  blurredCanvas.width = sw;
  blurredCanvas.height = sh;
  blurredCanvas.getContext("2d").putImageData(imageData, 0, 0);

  var ctx = item.canvasEl.getContext("2d");
  ctx.drawImage(blurredCanvas, 0, 0, sw, sh, 0, 0, w, h);
  ctx.drawImage(item.foregroundCanvas, 0, 0);
}

function refreshDownloadLink(item) {
  item.canvasEl.toBlob(function (blob) {
    if (item.resultBlobUrl) URL.revokeObjectURL(item.resultBlobUrl);
    item.resultBlobUrl = URL.createObjectURL(blob);
    item.downloadLinkEl.href = item.resultBlobUrl;
  }, "image/png");
}

var renderQueued = false;
function renderAll(blurPx, alsoRefreshLinks) {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(function () {
    renderQueued = false;
    items.forEach(function (item) {
      if (!item.ready) return;
      renderItem(item, blurPx);
      if (alsoRefreshLinks) refreshDownloadLink(item);
    });
  });
}

function currentBlur() { return +blurAmountInput.value; }

function syncPresetActive() {
  var val = currentBlur();
  presetRow.querySelectorAll(".preset-btn").forEach(function (btn) {
    btn.classList.toggle("active", +btn.getAttribute("data-blur") === val);
  });
}

function makeCard(item) {
  var card = document.createElement("div");
  card.className = "result-card is-pending";

  var h3 = document.createElement("h3");
  h3.textContent = item.file.name;

  var frame = document.createElement("div");
  frame.className = "frame";
  frame.textContent = "Working…";

  card.appendChild(h3);
  card.appendChild(frame);
  resultGrid.appendChild(card);
  item.cardEl = card;
  item.frameEl = frame;
}

function markCardReady(item) {
  item.frameEl.textContent = "";
  item.frameEl.appendChild(item.canvasEl);

  var a = document.createElement("a");
  a.className = "download-link";
  a.textContent = "Download";
  var base = item.file.name.replace(/\.[^.]+$/, "");
  a.download = "blurred-" + base + ".png";
  item.downloadLinkEl = a;
  item.cardEl.appendChild(a);
  item.cardEl.classList.remove("is-pending");
}

async function processFile(file) {
  var item = {
    id: nextId++,
    file: file,
    ready: false,
    resultBlobUrl: null
  };
  items.push(item);
  makeCard(item);

  try {
    var img = await loadImage(file);
    item.image = img;
    item.objectUrl = img.src;

    item.foregroundCanvas = await extractForeground(img);
    item.smallSourceCanvas = makeSmallSourceCanvas(img);
    item.canvasEl = document.createElement("canvas");

    renderItem(item, currentBlur());
    item.ready = true;
    markCardReady(item);
    refreshDownloadLink(item);
  } catch (err) {
    item.frameEl.textContent = err && err.message ? err.message : "Couldn't process this photo.";
  }
}

async function handleFiles(fileList) {
  var files = Array.prototype.filter.call(fileList, function (f) { return /^image\//.test(f.type); });
  if (files.length === 0) {
    setStatus("None of those look like image files.", "err", false);
    return;
  }
  hideStatus();
  resultGrid.classList.add("show");
  controlsRow.classList.add("show");
  actionsRow.classList.add("show");

  setStatus("Processing " + files.length + " photo" + (files.length === 1 ? "" : "s") + "…", "", true);
  for (var i = 0; i < files.length; i++) {
    await processFile(files[i]);
  }
  var readyCount = items.filter(function (it) { return it.ready; }).length;
  setStatus("Done — " + readyCount + " of " + items.length + " photo" + (items.length === 1 ? "" : "s") + " blurred.", "ok", false);
}

function resetAll() {
  items.forEach(function (item) {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    if (item.resultBlobUrl) URL.revokeObjectURL(item.resultBlobUrl);
  });
  items = [];
  resultGrid.innerHTML = "";
  resultGrid.classList.remove("show");
  controlsRow.classList.remove("show");
  actionsRow.classList.remove("show");
}

browseBtn.addEventListener("click", function () { fileInput.click(); });
fileInput.addEventListener("change", function () {
  if (fileInput.files.length) handleFiles(fileInput.files);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach(function (evt) {
  dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.add("is-drag"); });
});
["dragleave", "drop"].forEach(function (evt) {
  dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.remove("is-drag"); });
});
dropZone.addEventListener("drop", function (e) {
  if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});
dropZone.addEventListener("click", function (e) {
  if (e.target === browseBtn) return;
  fileInput.click();
});

presetRow.querySelectorAll(".preset-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var val = +btn.getAttribute("data-blur");
    blurAmountInput.value = val;
    blurVal.textContent = val + "px";
    syncPresetActive();
    renderAll(val, true);
  });
});

blurAmountInput.addEventListener("input", function () {
  blurVal.textContent = blurAmountInput.value + "px";
  syncPresetActive();
  renderAll(currentBlur(), false);
});
blurAmountInput.addEventListener("change", function () {
  renderAll(currentBlur(), true);
});

downloadAllBtn.addEventListener("click", function () {
  items.forEach(function (item, i) {
    if (!item.ready || !item.resultBlobUrl) return;
    setTimeout(function () {
      var a = document.createElement("a");
      a.href = item.resultBlobUrl;
      a.download = item.downloadLinkEl.download;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 180); // stagger so the browser doesn't block a burst of downloads
  });
});

clearBtn.addEventListener("click", function () {
  resetAll();
  hideStatus();
});
