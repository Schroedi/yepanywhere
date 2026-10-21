# AudioWorklet microphone capture

Status: sketch; the direction is recorded in
[streaming-speech-capture.md § Capture modes](../../topics/streaming-speech-capture.md#capture-modes),
and implementation is not yet scheduled.

## Current state

Every YA microphone consumer pulls samples through the deprecated
`ScriptProcessorNode`, each wired `source -> processor -> zero-gain ->
destination` so the processor fires:

- streaming STT: `YaServerProvider.doStartStreaming`
  (`packages/client/src/lib/speechProviders/YaServerProvider.ts`, buffer
  `SCRIPT_PROCESSOR_BUFFER_SIZE = 1024`), which also drives the
  first-frame `listening` gate and the audio-flow watchdog;
- waveform monitor: `startSpeechWaveformMonitor`
  (`packages/client/src/lib/speechProviders/sharedMicCapture.ts`, 1024), used
  by `YaServerProvider` and `DirectXaiSpeechProvider`; it opens its **own**
  `AudioContext` beside the capture one;
- audio memo: `AudioMemoRecorder`
  (`packages/client/src/lib/audioMemoRecording.ts`, 2048).

Chrome logs a `[Deprecation] The ScriptProcessorNode is deprecated. Use
AudioWorkletNode instead.` console warning when these nodes are created.

## Is the warning harmless?

Today, yes. It changes no behavior, and no browser has announced a removal
date; `ScriptProcessorNode` stays in the Web Audio spec, marked deprecated.
The defects are in the mechanism the warning names, not in the warning:

- `onaudioprocess` runs on the main thread, so a long React render, GC
  pause, or other main-thread stall delays or drops audio buffers. YA's
  stated latency budget is tight (100 ms PCM chunks, a keystroke budget of
  100 ms that shares this thread).
- On mobile, especially iOS Safari, the callback is unreliable. This is the
  leading hypothesis for the open "turns yellow, never red" defect, where
  the first frame never arrives
  ([streaming-speech-capture.md § Mobile](../../topics/streaming-speech-capture.md#mobile-turns-yellow-never-red-open-unresolved)).
- Buffer sizes are limited to powers of two from 256 to 16384, which adds a
  minimum latency of one buffer on top of the audio clock.

## Proposed design

One shared PCM tap worklet, `pcm-tap-processor`, loaded once per
`AudioContext` with `audioContext.audioWorklet.addModule(url)`. Its
`process()` copies channel 0 into a ring buffer and posts a
`Float32Array` batch (for example 1024 samples, transferable) on
`port`. The main thread keeps the existing consumers unchanged:
`Pcm16Chunker.writeFloatSamples`, `onAudioSamples`, and memo chunks receive
the same `Float32Array` stream they get now.

- Factor one `createMicSampleTap(context, source, onSamples)` that returns
  a disconnect function and chooses worklet or ScriptProcessor. The three
  call sites stop duplicating the graph wiring.
- Feature-detect `context.audioWorklet` and `AudioWorkletNode`. Fall back to
  `ScriptProcessorNode` when either is missing or `addModule` rejects; log a
  `[YaSTT]` mark naming the mode selected.
- Ship the module as a Vite asset
  (`new URL("./pcmTapProcessor.ts", import.meta.url)` or `?worker&url`), so
  hosted `ya.graehl.org` and local builds serve it from `'self'`.
  `addModule` falls under `script-src`, which the app CSP
  (`packages/server/src/frontend/static.ts`) already allows for `'self'`
  and `blob:`.
- Preserve contract #3: `listening` still flips on the first posted batch,
  not on node creation, and the watchdog still covers a worklet that never
  posts.
- Let the waveform monitor share the capture context's tap instead of
  opening a second `AudioContext`. This is a cleanup made possible by the
  shared tap, not a requirement.
- `addModule` is async. The first capture pays one module load, so load it
  during mic prewarm or at context creation, and keep buffering from mic-on
  (contract #2) so it adds no dead window.

Rollout follows the topic's rule: opt-in first, ScriptProcessor stays the
default until proven (§ Plan).

## Advantages

- Audio is pulled on the audio rendering thread, so main-thread stalls no
  longer drop or delay buffers. The main thread still receives the
  messages, but late delivery only adds latency; samples are not lost.
- It is the most likely fix for mobile first-frame failure, which raises its
  priority beyond cleanup.
- The deprecation console warning goes away for every client that takes the
  worklet path. Speech capture logs are easier to read, and real
  `[YaSTT]` and remote-log diagnostics are not buried under it.
- It is future-proof against eventual removal or further neglect of
  `ScriptProcessorNode` in engines.
- Frame size is free: `process()` sees 128-sample render quanta, and the
  worklet chooses the batch size, so chunking can match the 100 ms PCM
  frame directly.
- One shared tap replaces three copies of graph wiring, and the waveform
  monitor's extra `AudioContext` can go.

## Costs and risks

- One more build artifact plus a module load on cold start. AudioWorklet
  inside iOS web views has broken across versions (noted in
  [project-templates.sketches.md](../../topics/project-templates.sketches.md)),
  so the fallback is required, not optional.
- jsdom has no `AudioWorklet`. The unit tests in
  `packages/client/src/lib/__tests__/` (shared mic, speech providers, memo)
  exercise the fallback unless they get a worklet fake. Real coverage needs
  a Playwright check with a fake media stream
  (`--use-fake-device-for-media-stream`), asserting first-frame arrival in
  worklet mode.
- Older iOS Safari (before 14.5) lacks a usable AudioWorklet; the fallback
  covers it.

## Cost/benefit

On desktop Chrome, the worklet buys robustness against main-thread stalls
and a quiet console. That alone is a modest gain for roughly a day of work
plus a browser test. The case becomes strong only if the worklet fixes
mobile first-frame delivery, so measure that before committing to the full
migration.

## Plan

1. **Diagnose mobile first.** Collect the `[YaSTT]` marks from the phone
   (topic § Mobile). If the last mark is not `graph built` with no
   `first audio frame`, the processor is not the problem: AudioWorklet drops
   to a cleanup and this sketch can stay parked.
2. **Spike.** Put a worklet tap behind a developer toggle on the streaming
   STT path only, and compare first-frame arrival on the phone and on
   desktop Chrome under induced main-thread load.
3. **Decide.** Proceed if the spike fixes mobile or clearly reduces drops
   under load. Otherwise record the result here and stop. The warning is
   harmless enough not to justify the migration on its own.
4. **Migrate.** Build the shared tap, move the waveform monitor and audio
   memo onto it, add the Playwright fake-device check, and ship it as an
   opt-in capture mode.
5. **Flip the default** once the opt-in mode has proved reliable on desktop
   and mobile. Then retire or gate the `[YaSTT]` hardening marks, as the
   topic's Diagnostics section anticipates.

Found 2026-10-21 while asking whether the ScriptProcessor deprecation
console warnings are harmless.
