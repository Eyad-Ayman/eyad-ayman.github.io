EYAD Studio — on-device AI models (all included, nothing is downloaded at run time)

selfie_segmenter.tflite           People / Select Subject / Remove Background / camera AI effects (MediaPipe, Apache-2.0)
selfie_multiclass_256x256.tflite  Hair, skin, clothes, face-skin selection (MediaPipe, Apache-2.0)
deeplab_v3.tflite                 Select objects — 20 classes (DeepLab v3, Apache-2.0; MediaPipe metadata added)
magic_touch.tflite                Click-to-select any object (MediaPipe interactive segmenter, Apache-2.0)
blaze_face_short_range.tflite     Face detection (MediaPipe BlazeFace short range, Apache-2.0)
migan_pipeline_v2.onnx.part1      Object removal / generative fill (MI-GAN, MIT) — weights stored as float16 (14 MB)

The Studio loads these from this folder first, so every AI tool works offline.
