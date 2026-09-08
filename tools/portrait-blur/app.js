"use strict";

// Same real on-device model as tools/bg-remover: Google's MediaPipe
// Selfie Segmenter (Apache-2.0). Here the confidence mask blends a sharp
// and a blurred copy of the same photo instead of cutting the subject out.
import { ImageSegmenter, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

var dropZone = document.getElementById("drop-zone");
var fileInput = document.getElementById("file-input");
var browseBtn = document.getElementById("browse-btn");
var controlsRow = document.getElementById("controls-row");
var blurAmountInput = document.getElementById("blur-amount");
var blurVal = document.getElementById("blur-val");
var statusLine = document.getElementById("status-line");
var statusSpinner = document.getElementById("status-spinner");
var statusText = document.getElementById("status-text");
var resultArea = document.getElementById("result-area");
var previewBefore = document.getElementById("preview-before");
var previewAfter = document.getElementById("preview-after");
var actionsRow = document.getElementById("actions-row");
var downloadBtn = document.getElementById("download-btn");
var clearBtn = document.getElementById("clear-btn");

var segmenter = null;
var currentObjectUrl = null;
var resultBlobUrl = null;
var currentImage = null;
var foregroundCanvas = null; // sharp subject cutout, computed once per photo
var smallSourceCanvas = null; // downscaled copy of the photo, for fast blurring
var SMALL_SIDE = 220; // blur quality doesn't need full resolution — this keeps every slider move fast

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

// One box-blur pass along one axis, edge pixels clamped (never treated as
// transparent/empty — the actual bug this replaces). Three passes of box
// blur is a standard, cheap approximation of a real Gaussian blur.
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

// Cheap, re-runs on every slider move — no model inference here. Blurs a
// small cached copy of the photo (blur quality doesn't need full
// resolution) with a manual box blur instead of ctx.filter's CSS blur,
// which measured leaving over half the canvas transparent at higher blur
// values here — it samples past the edge of the drawn image as empty
// space instead of real pixels, and enlarging the draw to compensate
// didn't fully fix it either. A manual blur on raw pixel data has no such
// edge case: every sample is clamped to a real pixel, always opaque.
function render(blurPx) {
  if (!currentImage || !foregroundCanvas || !smallSourceCanvas) return;
  var w = currentImage.naturalWidth;
  var h = currentImage.naturalHeight;
  previewAfter.width = w;
  previewAfter.height = h;

  // smallSourceCanvas itself is never modified — read a fresh copy of its
  // pixels every call and blur that, so repeated slider moves always blur
  // from the original sharp image rather than an already-blurred one.
  var sw = smallSourceCanvas.width, sh = smallSourceCanvas.height;
  var scale = sw / w;
  var imageData = smallSourceCanvas.getContext("2d").getImageData(0, 0, sw, sh);
  boxBlur(imageData, Math.max(1, Math.round(blurPx * scale)));

  var blurredCanvas = document.createElement("canvas");
  blurredCanvas.width = sw;
  blurredCanvas.height = sh;
  blurredCanvas.getContext("2d").putImageData(imageData, 0, 0);

  var ctx = previewAfter.getContext("2d");
  ctx.drawImage(blurredCanvas, 0, 0, sw, sh, 0, 0, w, h);
  ctx.drawImage(foregroundCanvas, 0, 0);
}

function flattenToBlob(callback) {
  // previewAfter already IS the flattened composite (blurred bg + sharp
  // subject drawn on top in the same canvas), so just export it directly.
  previewAfter.toBlob(callback, "image/png");
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

function resetOutputs() {
  if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
  if (resultBlobUrl) { URL.revokeObjectURL(resultBlobUrl); resultBlobUrl = null; }
  currentImage = null;
  foregroundCanvas = null;
  smallSourceCanvas = null;
  resultArea.classList.remove("show");
  actionsRow.classList.remove("show");
  controlsRow.classList.remove("show");
  var actx = previewAfter.getContext("2d");
  if (actx) actx.clearRect(0, 0, previewAfter.width, previewAfter.height);
}

async function handleFile(file) {
  if (!file || !/^image\//.test(file.type)) {
    setStatus("That doesn't look like an image file.", "err", false);
    return;
  }
  resetOutputs();
  hideStatus();

  try {
    var img = await loadImage(file);
    currentObjectUrl = img.src;
    currentImage = img;
    previewBefore.src = img.src;
    resultArea.classList.add("show");

    setStatus("Finding the subject…", "", true);
    foregroundCanvas = await extractForeground(img);
    smallSourceCanvas = makeSmallSourceCanvas(img);

    render(+blurAmountInput.value);
    flattenToBlob(function (blob) {
      if (resultBlobUrl) URL.revokeObjectURL(resultBlobUrl);
      resultBlobUrl = URL.createObjectURL(blob);
    });

    setStatus("Done — drag the slider to adjust the blur.", "ok", false);
    actionsRow.classList.add("show");
    controlsRow.classList.add("show");
  } catch (err) {
    setStatus(err && err.message ? err.message : "Something went wrong processing that photo.", "err", false);
  }
}

browseBtn.addEventListener("click", function () { fileInput.click(); });
fileInput.addEventListener("change", function () {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach(function (evt) {
  dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.add("is-drag"); });
});
["dragleave", "drop"].forEach(function (evt) {
  dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.remove("is-drag"); });
});
dropZone.addEventListener("drop", function (e) {
  if (e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
dropZone.addEventListener("click", function (e) {
  if (e.target === browseBtn) return;
  fileInput.click();
});

var renderQueued = false;
blurAmountInput.addEventListener("input", function () {
  blurVal.textContent = blurAmountInput.value + "px";
  // Dragging fires many "input" events per second — collapse them to one
  // render per animation frame instead of rendering every single one.
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(function () {
    renderQueued = false;
    render(+blurAmountInput.value);
  });
});
blurAmountInput.addEventListener("change", function () {
  flattenToBlob(function (blob) {
    if (resultBlobUrl) URL.revokeObjectURL(resultBlobUrl);
    resultBlobUrl = URL.createObjectURL(blob);
  });
});

downloadBtn.addEventListener("click", function () {
  if (!resultBlobUrl) return;
  var a = document.createElement("a");
  a.href = resultBlobUrl;
  a.download = "portrait-blur.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

clearBtn.addEventListener("click", function () {
  resetOutputs();
  hideStatus();
});
