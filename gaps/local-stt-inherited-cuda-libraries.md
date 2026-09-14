# Inherited CUDA libraries break local Parakeet transcription

The local speech workers inherit the server's `LD_LIBRARY_PATH`. A server
launched with system CUDA library directories can mix those libraries with the
different CUDA/cuDNN versions installed in its isolated pixi environments.
Backend validation checks imports, so the menu can advertise a backend whose
first GPU transcription fails.

Observed on gra after host migration, with system CUDA 13.3 directories in
`LD_LIBRARY_PATH`: the production workers loaded their default models, but
Transformers Parakeet aborted with `Cannot load symbol cublasLtGetVersion`
(exit 134), and NeMo returned `CUDNN_STATUS_SUBLIBRARY_LOADING_FAILED` during
convolution. Whisper's default CPU/int8 path transcribed successfully.

Repeating the same synthetic WAV through all three production workers with
only `LD_LIBRARY_PATH` removed made every transcription pass: distilled
Whisper v3.5 on CPU, Parakeet TDT 0.6B v3 on GPU, and NeMo unified English
0.6B on GPU all returned "The quick brown fox jumps over the lazy dog"
(punctuation varied). The shared server's environment was not changed.

The owning spawn boundaries are `localWhisperBackend.ts`,
`localParakeetBackend.ts`, and `localNemoBackend.ts`, under
`packages/server/src/services/voice/`; shared runtime support lives in
`localSttRuntime.ts`. Investigate isolating CUDA library selection at that
boundary without changing other provider subprocesses or global shell setup.
Preserve intentionally configured runtime paths where needed. Verify actual
transcription, since import and model-load checks missed this failure.

Captured during a requested migration check; runtime repair remains open.
See [speech recognition](../topics/pluggable-speech-recognition.md).

Found 2026-09-14 while checking local STT after migration from gr6 to gra.
