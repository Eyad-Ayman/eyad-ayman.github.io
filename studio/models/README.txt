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

The Studio loads these from this folder first, so every AI tool works offline.
