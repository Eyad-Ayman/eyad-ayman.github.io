"use strict";

// Real on-device AI, not a gimmick: Google's MediaPipe Tasks Vision
// ImageSegmenter running the "Selfie Segmenter" model (Apache-2.0,
// https://ai.google.dev/edge/mediapipe). Pinned to one version so a
// future MediaPipe release can't change behavior under us without a
// deliberate bump here.
import { ImageSegmenter, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

var dropZone = document.getElementById("drop-zone");
var fileInput = document.getElementById("file-input");
var browseBtn = document.getElementById("browse-btn");
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

function setStatus(text, kind, showSpinner) {
  statusText.textContent = text;
  statusLine.className = "status-line show" + (kind ? " " + kind : "");
  statusSpinner.style.display = showSpinner ? "inline-block" : "none";
}

function hideStatus() {
  statusLine.className = "status-line";
}

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

async function removeBackground(imgEl) {
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

  // The mask's own resolution rarely matches the source photo's — map each
  // output pixel back to its nearest mask sample (the model's confidence
  // field is already smooth, so nearest-neighbor doesn't add blockiness).
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

function resetOutputs() {
  if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
  if (resultBlobUrl) { URL.revokeObjectURL(resultBlobUrl); resultBlobUrl = null; }
  resultArea.classList.remove("show");
  actionsRow.classList.remove("show");
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
    previewBefore.src = img.src;
    resultArea.classList.add("show");

    setStatus("Removing the background…", "", true);
    var resultCanvas = await removeBackground(img);

    previewAfter.width = resultCanvas.width;
    previewAfter.height = resultCanvas.height;
    previewAfter.getContext("2d").drawImage(resultCanvas, 0, 0);

    resultCanvas.toBlob(function (blob) {
      if (resultBlobUrl) URL.revokeObjectURL(resultBlobUrl);
      resultBlobUrl = URL.createObjectURL(blob);
    }, "image/png");

    setStatus("Done — check the preview below.", "ok", false);
    actionsRow.classList.add("show");
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

downloadBtn.addEventListener("click", function () {
  if (!resultBlobUrl) return;
  var a = document.createElement("a");
  a.href = resultBlobUrl;
  a.download = "background-removed.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

clearBtn.addEventListener("click", function () {
  resetOutputs();
  hideStatus();
});
