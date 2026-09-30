"use strict";

// Real on-device AI: Google's MediaPipe Face Detector (BlazeFace,
// Apache-2.0, https://ai.google.dev/edge/mediapipe), the same library and
// license as tools/bg-remover.
import { FaceDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

var FORMATS = [
  { name: "Square (1:1)", file: "square", ratio: 1, bias: 0 },
  { name: "Portrait (4:5)", file: "portrait-4x5", ratio: 4 / 5, bias: 0.08 },
  { name: "Story / Reel (9:16)", file: "story-9x16", ratio: 9 / 16, bias: 0.1 },
  { name: "Wide Cover (16:9)", file: "cover-16x9", ratio: 16 / 9, bias: 0 }
];

var dropZone = document.getElementById("drop-zone");
var fileInput = document.getElementById("file-input");
var browseBtn = document.getElementById("browse-btn");
var statusLine = document.getElementById("status-line");
var statusSpinner = document.getElementById("status-spinner");
var statusText = document.getElementById("status-text");
var sourcePreview = document.getElementById("source-preview");
var sourceFrame = document.getElementById("source-frame");
var previewImg = document.getElementById("preview-img");
var cropResults = document.getElementById("crop-results");

var detector = null;

function setStatus(text, kind, showSpinner) {
  statusText.textContent = text;
  statusLine.className = "status-line show" + (kind ? " " + kind : "");
  statusSpinner.style.display = showSpinner ? "inline-block" : "none";
}
function hideStatus() { statusLine.className = "status-line"; }

async function getDetector() {
  if (detector) return detector;
  setStatus("Loading the face-detection model (first time only, ~230KB)…", "", true);
  var vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  detector = await FaceDetector.createFromOptions(vision, {
    // delegate: "GPU" silently returned zero detections on every test photo
    // here — a real MediaPipe/GPU-delegate issue, not a tuning problem;
    // found by testing, not guessed. CPU actually detects faces.
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    runningMode: "IMAGE",
    // This "short_range" model is built for close-up selfie-camera shots;
    // on real environmental/candid portraits (what this tool is actually
    // for) its own confidence scores run much lower even for genuine,
    // correct detections — measured 0.11-0.37 across real test photos,
    // never above 0.5. 0.5 (a sane-sounding default) silently rejected
    // every real face; even 0.15 still missed the lowest-scoring real
    // ones. 0.1 is calibrated against that real data, not a guess — it's
    // a deliberately permissive floor for a model that runs this
    // underconfident on non-selfie photos, accepting more false positives
    // on non-portrait input in exchange for actually catching real faces.
    minDetectionConfidence: 0.1
  });
  return detector;
}

function loadImage(file) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error("That file couldn't be read as an image.")); };
    img.src = URL.createObjectURL(file);
  });
}

function bestFace(detections) {
  // Picking by highest confidence rather than largest box — at this
  // model's low real-world confidence range (see getDetector's comment),
  // a spurious detection on a busy/textured region can outsize a real,
  // lower-confidence face; the score the model itself is most sure about
  // is the more reliable signal here.
  var best = null;
  var bestScore = -1;
  detections.forEach(function (d) {
    if (!d.boundingBox) return;
    var score = (d.categories && d.categories[0] && d.categories[0].score) || 0;
    if (score > bestScore) { bestScore = score; best = d.boundingBox; }
  });
  return best;
}

function computeCrop(imgW, imgH, faceBox) {
  var cx = faceBox.originX + faceBox.width / 2;
  var cy = faceBox.originY + faceBox.height / 2;
  var faceSize = Math.max(faceBox.width, faceBox.height);
  var base = faceSize * 2.8; // generous headroom, not a tight face-only crop

  return FORMATS.map(function (fmt) {
    var w, h;
    if (fmt.ratio >= 1) { h = base; w = base * fmt.ratio; }
    else { w = base; h = base / fmt.ratio; }

    // Shift the anchor up a bit for tall formats so there's headroom above
    // the face instead of it sitting dead-center.
    var anchorY = cy - h * fmt.bias;

    var x = cx - w / 2;
    var y = anchorY - h / 2;

    // Keep the exact target ratio while fitting inside the source image —
    // scale both dimensions down together rather than clamping independently.
    var scale = Math.min(1, imgW / w, imgH / h);
    w *= scale; h *= scale;

    x = Math.max(0, Math.min(x, imgW - w));
    y = Math.max(0, Math.min(y, imgH - h));

    return { name: fmt.name, file: fmt.file, ratio: fmt.ratio, x: x, y: y, w: w, h: h };
  });
}

function centerCrop(imgW, imgH) {
  // Fallback used when no face is found — a plain center-crop per format.
  return FORMATS.map(function (fmt) {
    var w, h;
    if (fmt.ratio >= imgW / imgH) { w = imgW; h = w / fmt.ratio; }
    else { h = imgH; w = h * fmt.ratio; }
    return {
      name: fmt.name, file: fmt.file, ratio: fmt.ratio,
      x: (imgW - w) / 2, y: (imgH - h) / 2, w: w, h: h
    };
  });
}

function renderCrops(img, crops) {
  cropResults.innerHTML = "";
  crops.forEach(function (c) {
    var card = document.createElement("div");
    card.className = "crop-card";
    card.style.setProperty("--ratio", c.ratio);

    var h3 = document.createElement("h3");
    h3.textContent = c.name;

    var thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb";
    var canvas = document.createElement("canvas");
    var outW = Math.round(Math.min(1080, c.w));
    var outH = Math.round(outW / c.ratio);
    canvas.width = outW;
    canvas.height = outH;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, outW, outH);
    thumbWrap.appendChild(canvas);

    var a = document.createElement("a");
    a.className = "download-link";
    a.textContent = "Download";
    canvas.toBlob(function (blob) {
      a.href = URL.createObjectURL(blob);
      a.download = "crop-" + c.file + ".png";
    }, "image/png");

    card.appendChild(h3);
    card.appendChild(thumbWrap);
    card.appendChild(a);
    cropResults.appendChild(card);
  });
  cropResults.classList.add("show");
}

function drawFaceBox(img, faceBox) {
  var existing = sourceFrame.querySelector(".face-box");
  if (existing) existing.remove();
  if (!faceBox) return;
  var box = document.createElement("div");
  box.className = "face-box";
  var pctLeft = (faceBox.originX / img.naturalWidth) * 100;
  var pctTop = (faceBox.originY / img.naturalHeight) * 100;
  var pctW = (faceBox.width / img.naturalWidth) * 100;
  var pctH = (faceBox.height / img.naturalHeight) * 100;
  box.style.left = pctLeft + "%";
  box.style.top = pctTop + "%";
  box.style.width = pctW + "%";
  box.style.height = pctH + "%";
  sourceFrame.appendChild(box);
}

async function handleFile(file) {
  if (!file || !/^image\//.test(file.type)) {
    setStatus("That doesn't look like an image file.", "err", false);
    return;
  }
  cropResults.classList.remove("show");
  cropResults.innerHTML = "";
  hideStatus();

  try {
    var img = await loadImage(file);
    previewImg.src = img.src;
    sourcePreview.classList.add("show");

    setStatus("Finding the face…", "", true);
    var det = await getDetector();
    var result = det.detect(img);
    var faceBox = bestFace(result.detections || []);
    drawFaceBox(img, faceBox);

    var crops = faceBox
      ? computeCrop(img.naturalWidth, img.naturalHeight, faceBox)
      : centerCrop(img.naturalWidth, img.naturalHeight);

    renderCrops(img, crops);

    setStatus(
      faceBox ? "Done — face found, crops centered on it below." : "No face found — used a plain center-crop instead.",
      faceBox ? "ok" : "err",
      false
    );
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
