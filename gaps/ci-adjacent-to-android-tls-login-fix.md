# CI fixes awaiting confirmation on the next CI run

Every known CI failure as of `98ab07df6` (2026-10-04) has a diagnosed
mechanism and a landed fix, but these could not be run on the development
host, so only the next CI run can show them fixed. Delete this entry once
that run is green for them; keep any that still fail as a narrower gap.

- **iPad WebKit, `e2e/ipad-home-screen.spec.ts` limited-user relay login.**
  `0746085f4` moved the limited-user field behind "Show Advanced Options" and
  updated `relay-integration.spec.ts`, not this spec, which filled the field
  before opening Advanced. The reordered spec passes in Chromium here;
  WebKit cannot launch on this host (missing system libraries).
- **Desktop CI, all three `build-tauri` jobs** on `graehl/yepanywhere` only.
  The fork has no `v*` tags, so the bundled `yepVersion` is a bare commit,
  which the packaged server reports as `unknown` by design; the runtime
  smoke demanded equality. The smoke now expects
  `reportedYaVersion(yepVersion)` (`packages/desktop/scripts/runtime-manifest.mjs`)
  and prints both values on mismatch. Not built here (no Tauri toolchain).
- **Android App CI, `YaNativeWebAppInstrumentedTest`.** Fails on every run
  since `1a9a33258` on both repositories, alternately exceeding the 100 ms
  keystroke budget on the software-rendered emulator (159 and 487 ms
  observed) and never settling the input-readiness gate. Hosted run
  37198873999 passed, but 37200938972 delivered only the last 21 of 29
  characters after the readiness check was allowed to proceed unsettled.
  The probe now taps the editor through Android accessibility and requires
  window focus and input readiness on every device before injecting keys.
  Key delivery stays strict everywhere; physical devices keep 100 ms and
  software-rendered emulators keep the measured 2000 ms frame budget.
  Hosted acceptance of this setup correction is pending.
- **`packages/server/test/projects/HostedProjectServices.test.ts`, worker-loss
  case:** the service failed with `listen EADDRINUSE 127.0.0.1:40614` once.
  `ProjectServiceProcess` drew its port from 10000–59999, overlapping the
  ephemeral range that outgoing connections inside the sandbox's network
  namespace use; it now draws from 10000–32767. The test skips on this host
  when the sandbox is unavailable.

The browser-shard flake in `e2e/blob-retention.spec.ts` is fixed and proven
here: its zero-filled media fail to decode, and on a slow runner the file
viewer replaced the `<video>` with its download fallback before the count.
Reproduced with a delay and fixed by stopping media decode errors in the
fixture.

Found 2026-10-04 while preparing the Android 0.1.1 internal login fix;
diagnosed and fixed 2026-10-04.
