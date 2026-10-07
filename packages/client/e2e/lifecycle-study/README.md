# Browser and Android source lifecycle study

An **opt-in diagnostic**, not a passing CI acceptance test. It runs the built
remote web client or the real minified Android app against an owned fixture,
with the same TCP fault controller and page observer. No runtime application
code is replaced. Android uses its production Kotlin/UniFFI/Rust connection;
Playwright attaches to its actual WebView solely for observation and input.

See [the investigation](../../../../docs/testing/source-lifecycle-study-2026-10-07.md)
for findings, limitations, and the proposed next work. The existing
[conformance sketch](../../../../gaps/sketches/source-transport-lifecycle-conformance.md)
remains the broader scenario inventory.

## Prepare once

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @yep-anywhere/android prepare-frontend
pnpm --filter @yep-anywhere/client exec playwright install chromium
cd packages/android
./gradlew assembleBundledDebug assembleBundledDebugAndroidTest \
  -PyaNativeProbeCleartext=true -PyaNativeProbeMinify=true --no-daemon
```

Boot an owned API 35 emulator. The study requires `ANDROID_SERIAL=emulator-…`
and refuses physical devices. Do not run two Android studies or instrumentation
runners concurrently on one emulator. The runner installs the prepared APKs;
it does not silently rebuild them. Rebuild after changing native or bundled
client source. The HTML hash, source revision, dirty paths, and harness hash
are recorded. The finalized runner also records APK hashes or the browser
version; earlier investigation runs predate those fields. Initial execution
evidence is macOS ARM64 only.

## Run matched experiments

```bash
pnpm exec tsx --conditions source packages/client/e2e/lifecycle-study/run.mjs \
  --client=browser --route=direct --surface=session --fault=in-flight --observe-ms=30000

ANDROID_SERIAL=emulator-5554 pnpm exec tsx --conditions source \
  packages/client/e2e/lifecycle-study/run.mjs \
  --client=android --route=direct --surface=session --fault=in-flight --observe-ms=30000
```

Options use `--name=value`:

- `client`: `browser` or `android`.
- `route`: `direct` or `mux`. Each run owns a fresh relay and username; ordinary
  production relay limits remain enabled. The browser fixture's exact local
  origin is explicitly allowed by its private relay, without changing defaults.
- `surface`: `session` or `inbox`.
- `fault`: `control`, `disconnect`, `in-flight`, `outage`, `wake-outage`, `silent`.
- `observe-ms`: passive post-restoration observation, default 90000, at most 180000.
  This is an experiment duration, **not an accepted product recovery deadline**.
- `outage-ms`: outage/silent duration, default 16000, at most 120000.
- `activity`: `none` (default) or `typing` (session only). Typing deliberately
  signals recovery after network restoration and must be compared separately.
- `out`: new, nonexistent output directory. Defaults under ignored
  `tasks/source-lifecycle-study/`.

`disconnect` destroys established client sockets but immediately accepts new
ones. `in-flight` waits until the fixture reports a real delayed API request
before disconnecting. `outage` also refuses new connections. `silent` stalls
both byte streams without announcing closure, preserving order and bounded
stream backpressure. It is an application-path stall, not a packet-level radio
simulator: each half's OS TCP connection remains locally established.

`wake-outage` sleeps the emulator (freezes the browser page) for eight seconds,
then wakes it while connections remain refused for another eight seconds.
Freezing is not the same as hiding a tab, Android Doze, or killing an app.
These need separate experiments; this runner does not claim to simulate them.

The server appends a known response and changes the session title/star while
the connection is interrupted. After restoration, the default run observes
without clicking, typing, focusing or injecting `online`. It records a separate
keyboard recovery attempt if the session remains stale or the bar remains.
Sidebar inspection is an explicit interaction **after** passive measurement.

## Read the evidence

- `result.json`: recipe, source/build identity, host samples, outcomes, page
  transitions and input observations. `completed: true` means the experiment
  completed; **it does not mean the product passed**. A missing `firstHealthyAt`
  means the full recovery condition was never observed within the window.
- `timeline.json`: controller actions, sampled page state, console errors and
  route changes, timestamped by the host/page wall clocks.
- `native-phases.json`, `native-errors.log`, `instrumentation.log`: Android's
  native state and fabricated-response evidence. Native phase times are relative
  to instrumentation setup, not the host timeline's time origin.
- PNG captures are presented through the repository artifact capture helper.
  Browser runs also retain a WebM recording. Android currently has checkpoint
  WebView captures plus mutation observations, not continuous device video.

Recovery requires no connection bar, no observed error/login screen, and the
updated title; a session must also show the appended message. Snapshots poll
once per second, so recovery figures are approximate and not paint timings.
Mutation observations retain intermediate states, including short error flashes.
The observer is bounded and uses known error selectors; it is not proof that
every possible error component or visual flicker was detected.

The fixture has one project/session and 50 starting transcript messages.
Input is sequential through browser debugging input, including on WebView;
it does not replace native hardware-key/IME acceptance or establish large-data
100 ms performance. The host samples are diagnostic, without benchmark capacity
gating. Do not compare these timings as performance regressions across hosts.

## Lower-level reproduction

```bash
node --test packages/client/e2e/lifecycle-study/network-gate.checks.mjs
pnpm --filter @yep-anywhere/client exec vitest run \
  --config e2e/lifecycle-study/vitest.config.mjs
```

The first command checks the fault controller. The second deliberately exits
nonzero on the current source: retry exhaustion is exposed as `disconnected`
instead of the promised `reconnecting`. Its other test establishes the
60-second backstop. The fabricated-503 repair now has normal Kotlin and
`NativeSourceTransport.test.ts` coverage, including error/state ordering,
abandoned operations, mutation non-replay and genuine server 503 preservation.
These explicit reproductions are outside ordinary `pnpm test`; they are not
silently converted to passing expectations or retries. Move repaired acceptance
cases into the normal suite as the relevant fixes land.

The opt-in Android method `hostDrivenLifecycleStudy` owns pairing, the Activity,
and cleanup. A bounded rendezvous file lets the host run the experiment while
the real app stays alive. Without its explicit instrumentation argument the
method does not run in normal live acceptance.
