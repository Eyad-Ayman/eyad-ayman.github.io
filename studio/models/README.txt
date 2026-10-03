EYAD Studio — on-device AI models (all included, nothing is downloaded at run time)

selfie_segmenter.tflite           People / Select Subject / Remove Background / camera AI effects (MediaPipe, Apache-2.0)
selfie_multiclass_256x256.tflite  Hair, skin, clothes, face-skin selection (MediaPipe, Apache-2.0)
deeplab_v3.tflite                 Select objects — 20 classes (DeepLab v3, Apache-2.0; MediaPipe metadata added)
magic_touch.tflite                Click-to-select any object (MediaPipe interactive segmenter, Apache-2.0)
blaze_face_short_range.tflite     Face detection (MediaPipe BlazeFace short range, Apache-2.0)
migan_pipeline_v2.onnx.part1      Object removal / generative fill (MI-GAN, MIT) — weights stored as float16 (14 MB)
depth_anything_v2_vits.onnx.part1/.part2 (+ .parts.json)
                                  Depth for Kamera "3D x4" — Depth Anything V2 Small (Apache-2.0), 28.5 MB in two 14.2 MB parts.
                                  Source: https://github.com/fabio-sim/Depth-Anything-ONNX (release v2.0.0, dynamic-shape export of
                                  https://github.com/DepthAnything/Depth-Anything-V2 "Small"); MatMul weights quantised to uint8,
                                  other weights stored as float16 (computation stays float32).
style_candy.onnx, style_mosaic.onnx, style_pointilism.onnx, style_rain_princess.onnx, style_udnie.onnx
                                  "Describe a look" painted styles — fast neural style transfer, 3.4 MB each (BSD-3-Clause).
                                  Source: https://github.com/onnx/models (validated/vision/style_transfer/fast_neural_style, opset 9),
                                  exported from https://github.com/pytorch/examples/tree/main/fast_neural_style; input made dynamic-size.
realesr_general_x4v3.onnx (2.4 MB), realesr_animevideo_x4v3.onnx (1.2 MB)
                                  Quick tools "AI upscale" x4 — Real-ESRGAN compact networks (SRVGGNetCompact, BSD-3-Clause).
                                  Source: https://github.com/xinntao/Real-ESRGAN release v0.2.5.0 (realesr-general-x4v3.pth,
                                  realesr-animevideov3.pth); the ONNX graph (opset 17, dynamic size) was built directly from the
                                  official weights; weights stored as float16 (computation stays float32).
whisper_tiny_encoder.onnx.part1, whisper_tiny_decoder.onnx.part1/.part2 (+ .parts.json)   39 MB — default ("Fast")
whisper_base_encoder.onnx.part1/.part2, whisper_base_decoder.onnx.part1-.part3 (+ .parts.json)   75 MB — optional ("Better")
whisper_tokens.txt                EYAD Video "Auto captions" — speech to text. OpenAI Whisper tiny / base, multilingual (MIT).
                                  Source: https://github.com/k2-fsa/sherpa-onnx releases, tag asr-models
                                  (sherpa-onnx-whisper-tiny.tar.bz2, sherpa-onnx-whisper-base.tar.bz2: the float32 encoder / decoder
                                  ONNX exports of https://github.com/openai/whisper, opset 13, with self-attention cache, and tokens.txt
                                  = base64 token bytes + id). Every weight tensor of 4096+ values is stored as int8 with a per-channel
                                  float scale and a Cast + Mul in front of its consumer (onnxruntime folds that at load, so the
                                  computation stays float32 — no activation quantisation). The base files are only fetched when
                                  "Better" is chosen; deleting the whisper_base_* files just removes that option.

The Studio loads these from this folder first, so every AI tool works offline.
