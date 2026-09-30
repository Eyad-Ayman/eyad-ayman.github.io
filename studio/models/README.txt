EYAD STUDIO — on-device AI models (served from this folder, so the Studio works offline).

selfie_segmenter.tflite  People segmentation (Select Subject / People, Remove Background,
                         video background removal). MediaPipe model, Apache License 2.0.

More models can be added here without code changes (same file names as in js/core/ai.js):
  selfie_multiclass_256x256.tflite, deeplab_v3.tflite, magic_touch.tflite,
  blaze_face_short_range.tflite, and migan_pipeline_v2.onnx (object removal, split into
  <24 MB parts — see scripts/fetch-models.py).
Easiest way: open Studio ▸ Settings ▸ Offline & AI models ▸ "Build models folder for GitHub"
in your browser — it downloads every model and gives you a zip of this folder to upload.
