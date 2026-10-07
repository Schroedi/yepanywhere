# Browser and Android interruption study — 2026-10-07

The reported Android error is reproducible on the session page with both a
direct connection and a relay. A second finding changes the diagnosis: Android
does eventually recover from the wake/outage case, but can leave a visible page
waiting nearly a minute. Typing after connectivity returns causes much faster
recovery. The browser has its own temporary error messages in these experiments.

This is an investigation and working comparison harness, not a completed repair
or a release acceptance claim. No production transport implementation changed.
The native connection remains the Android app's only authenticated connection.

## What was exercised

[The opt-in runner](../../packages/client/e2e/lifecycle-study/README.md) runs
either the built remote web client in Playwright Chromium or the actual Android
app in an owned API 35 emulator. The Android probe uses the minified build,
Kotlin, UniFFI, Rust and its real WebView. Playwright observes and types into
that WebView; it does not substitute a JavaScript native bridge.

Both use the same fixture server, an optional real local mux relay, a TCP fault
controller, and the same page observer. The controller can disconnect sockets,
refuse new connections, or silently stall both byte streams. It does not alter
the authentication or WebSocket protocol. The private relay allows the exact
local browser fixture origin; production origin policy and rate limits are
unchanged. Each experiment owns a fresh server, relay and identity.

The fixture has one project, one session and 50 initial transcript messages.
While the connection is interrupted, the server appends a known message and
changes the title and star. The session starts with a typed draft. The runner
observes recovery without user interaction, then explicitly opens the sidebar
to inspect it. An optional separate variant types during recovery.

Evidence includes timestamped controller actions, page mutations, error and
navigation observations, draft/input observations, screenshots, browser video,
Android state transitions and synthetic-response logs. Runs record the source
revision, dirty paths, harness hash, bundled HTML hash and host samples. An
experiment completing successfully does **not** mean the product passed.

The current checkout began at `29d7ceae1`. Execution was on macOS ARM64 and
`ya-ci-api35`, selected as `emulator-5554`. No physical phone was operated.
The requested personal GitHub wrapper is absent here; read-only public GitHub
API checks show [Android App CI passed for that revision](https://github.com/kzahel/yepanywhere/actions/runs/37644336741).
Main CI was cancelled, the SQLite/runtime workflow passed, and iOS CI was still
running when checked. This does not establish a green full CI baseline.

## Observations

These are individual diagnostic observations, rounded to seconds, not latency
targets, distributions or cross-platform performance rankings. Recovery means
the updated title is visible, the session has the appended message where
applicable, and the page has no observed error, login form or connection bar.
Polling is once per second. Some errors clear later than the connection itself.

| Experiment | Browser | Android | What it establishes |
| --- | --- | --- | --- |
| Session, direct: disconnect with page reads pending | Recovered in about 3 s; briefly showed `WebSocket closed with code 1006` | About 11 s; visible fabricated 503; seven synthetic responses logged | The exact Android symptom is reproducible with ordinary page reads |
| Session, mux: same pending-read interruption | Updated page observed at first post-restoration sample; brief code 1006 error | About 1 s; visible fabricated 503; eight synthetic responses logged | The error crosses both connection routes; duration varies |
| Inbox, mux: refuse connections for 16 s | About 8 s; temporary connection-failed error | About 65 s; temporary `Source transport secure is disconnected` error | Inbox also exposes connection state as a page error |
| Session, direct: wake while connections remain refused | About 20 s in the later full-page check | About 57 s; an earlier run also took about 57 s | Passive recovery exists but can leave the foreground page waiting |
| Same wake recipe, type after restoration | About 2 s | About 1 s | User activity is already an effective recovery signal |
| Session, direct: silently stall traffic for 60 s, then release it | About 1 s; no observed error | About 1 s; no observed error | Both consume buffered traffic after restoration; this does not prove dead-peer detection |

No unexpected login screen or lost draft was observed in these completed cases.
The sidebar showed the updated title when opened after recovery. Opening it can
itself trigger work: this is not evidence that a closed sidebar had already
caught up. The typing variants delivered all 38 characters. Maximum observed
input-to-next-frame delay was 8.3 ms in Chromium and 15.4 ms in the WebView;
these small-fixture, debugger-input observations are not native IME or
large-data typing acceptance.

### Why the minute-long wait matters

The original [wake outage gap](../../gaps/android-native-gives-up-after-wake-outage.md)
observed only 30 seconds after restoration and described permanent failure.
Longer observation disproves that description for these runs. Native exhausts
its quick retries and reports `FAILED`; the JavaScript native transport already
schedules a visible recovery attempt 60 seconds later. One recorded sequence:

```text
23273ms FAILED       Could not connect to the paired server
83298ms CONNECTING   (60,025 ms after FAILED)
83411ms CONNECTED
```

An earlier run measured the same interval at 60,042 ms. A small unit test now
checks the exact 60-second behavior. Another intentionally fails because this
recoverable state is exposed to callers as `disconnected`, contrary to the
shared recovery contract. Native terminal failures and exhausted network
retries need distinct treatment; blindly adding another retry timer would hide
the ownership problem.

The controlled outage refuses server connections while the device remains
online. Restoring the server therefore need not cause an Android network-online
callback. Native network callbacks are useful, but cannot by themselves solve
this case. Keep a visible backstop and distinguish service recovery from radio
recovery in future experiments.

### Why the 503 reaches the page

Disconnecting while the session's initial reads are pending produces the exact
`API error: 503: Native connection unavailable` text in the actual WebView.
Rust fails pending work, Kotlin manufactures an HTTP response, and the page
receives that response before the later reconnect state can rescue the read.
The [existing gap](../../gaps/android-native-unavailable-fake-503.md) describes
the source path. A lower-level characterization reproduces why the client does
not retry this HTTP-shaped failure. It is **not** a reason to retry genuine
server 503 responses indiscriminately.

The browser's brief code 1006 error is a separate uncovered user experience
problem. The browser is a useful comparison, not a definition of correct
behavior. Both should meet the same page-level expectations.

The relay session trace also records responses and heartbeat/status events for
request and subscription IDs the page has abandoned. The page ignores them;
the trace alone does not prove an unbounded leak. It strengthens the case for
testing cancellation and stale callbacks across reconnect/document replacement,
including a count that returns to baseline after repeated cycles.

## Reproduction and evidence index

Commands and setup are in the
[runner README](../../packages/client/e2e/lifecycle-study/README.md).
For the visible Android error, use `--client=android --route=direct
--surface=session --fault=in-flight --observe-ms=30000`. Repeat with
`--route=mux` or `--client=browser`. For passive wake recovery use
`--fault=wake-outage --observe-ms=90000`, and separately add `--activity=typing`.

Local raw evidence is under the ignored directory
`tasks/source-lifecycle-study/`. Each run below contains `result.json`,
`timeline.json`, captures and its platform-specific evidence. These are local
artifacts, not committed or hosted public attachments. Run identifiers are UTC.

| Evidence | Run directory (prefix `2026-10-07T`) |
| --- | --- |
| Android direct visible 503; `interrupted.png` | `16-11-58-412Z-android-direct-session-in-flight` |
| Browser direct transient error and recovery | `16-16-47-511Z-browser-direct-session-in-flight` |
| Android relay visible 503 | `16-23-32-451Z-android-mux-session-in-flight` |
| Browser relay pending reads | `16-21-19-136Z-browser-mux-session-in-flight` |
| Android / browser relay Inbox | `16-13-55-218Z-android-mux-inbox-outage` / `16-11-57-087Z-browser-mux-inbox-outage` |
| Android / browser passive wake | `16-16-46-257Z-android-direct-session-wake-outage` / `16-15-27-758Z-browser-direct-session-wake-outage` |
| Android / browser wake with typing | `16-25-32-000Z-android-direct-session-wake-outage` / `16-23-33-708Z-browser-direct-session-wake-outage` |
| Android / browser 60 s traffic stall | `16-19-25-810Z-android-direct-session-silent` / `16-18-14-510Z-browser-direct-session-silent` |

Early control experiments loaded both clients normally and retained the draft.
Pilot setup failures (unsupported desktop CDP command on WebView, missing
private relay origin, missing fixture metadata service) were corrected and
excluded. The `16-12-59-980Z` silent pilot discarded stream bytes incorrectly;
it is excluded and replaced by the two bounded, order-preserving stall runs
above. Earlier wake pilots establish recovery but used a less complete page
observer, so the later run is used for the comparative table. Harness hashes
record these diagnostic iterations; this was not a preregistered benchmark.

## Proposed repair order

1. **Stop inventing server errors.** Preserve a typed native operation failure
   through Kotlin and the bridge. Retryable connection loss should reach the
   existing read-recovery path even if the operation reply arrives before the
   state event. Start with the now-visible direct and relay reproductions;
   add the owning connector unit test before changing it. Preserve genuine
   HTTP responses, terminal authentication errors and cancellation separately.
2. **Make recovery ownership explicit.** Trace Rust's internal reconnect,
   Kotlin's short retry cycle and the WebView's existing signals/backstop as
   one documented sequence. An exhausted network attempt stays recoverable.
   Keep authentication rejection, revocation and verification failure terminal.
   Let native own platform wake/network signals; decide explicitly who owns
   long recovery after exhaustion, then remove overlapping policy. Keep the
   browser's independent recovery implementation under the same contract.
3. **Make page recovery observable and consistent.** A connected socket is not
   enough: Inbox, the session and sidebar must have current data. Handle the
   browser's code 1006 error as well as Android errors. Test subscription
   catch-up, bounded stale UI and cancellation when a document or source is
   replaced. Preserve drafts and do not redirect to login for network loss.

For new reads during reconnect, the proposal is one bounded readiness wait at
the transport boundary, cancellable with the caller. Avoid stacking queues in
JavaScript, Kotlin and Rust. In-flight reads interrupted by a connection loss
get a typed retryable failure; existing safe-read policy decides whether to
retry. A write or upload may already have reached the server: never replay it
automatically on ambiguous disconnect. This distinction needs explicit tests,
including genuine 503 responses that must retain their original meaning.

Keep native as the connection owner. Its advantage is independent ownership
and access to platform signals, not a promise that Android will keep every
socket alive indefinitely. No evidence here calls for moving authentication
back into the WebView. A WebAssembly experiment would require separating the
Rust core's native networking/runtime dependencies; it would not itself fix
error classification, overlapping recovery policy or stale page data.

## The autonomous loop

For each defect: save a deterministic emulator recipe and evidence, reproduce
it at the owning unit layer, repair under that test, rerun the same emulator
recipe and its browser counterpart, then run the normal regression checks.
Each accepted repair converts the opt-in reproduction into a normal passing
acceptance test. Removing the relevant existing Android `@Ignore` is still
required; increasing its timeout alone is not the repair.

The first shared unit scenarios should be deliberately small: pending read
interrupted before a state event, quick retry exhaustion, activity/online/wake
after exhaustion, real rejection, and abandoned operations/subscriptions.
Drive every applicable `SourceTransport` through the same assertions. Extend
the [conformance sketch](../../gaps/sketches/source-transport-lifecycle-conformance.md)
from evidence rather than building a huge simulator before its first useful
failure. Kotlin fake-connector tests and Rust session tests remain necessary;
a fake JavaScript native peer cannot establish the native implementation.

Track an **escape** whenever a device/browser run catches something the lower
tests missed. Initial ledger:

| Escape | Evidence now | Next lower-level coverage |
| --- | --- | --- |
| Native operation becomes a fake 503 before the reconnect event | Visible direct/mux WebView errors; client characterization | Kotlin error encoding plus client order permutations |
| Recoverable native exhaustion appears disconnected to callers | Red unit reproduction; 60 s native phase trace | Kotlin exhaustion policy and shared transport status assertions |
| Browser session displays raw code 1006 during recoverable loss | Direct/mux page mutation trace | Read failure classification and session error rendering |
| Passive page waits roughly a minute despite available server | Repeated wake runs; activity variant recovers promptly | Signal scheduling, bounded visible recovery, rate limits |

Start with a few deterministic end-to-end cases in CI after they are repaired,
and run longer seeded sequences nightly: cut, restore, freeze, wake, navigate,
cancel, repeat. Save the seed and actions and reduce failures to the shortest
reproduction. Never count a retry-until-green run as a pass. Record separate
milestones for network restoration, connection readiness and current page data.
Use the escape ledger to judge whether unit tests are becoming sufficient.

A lighter JVM/Kotlin/Rust plus Chromium harness may be worthwhile later. This
study already attaches Chromium automation to the real emulator WebView, so
there is a practical baseline before building another environment. Extract
only a demonstrated slow, platform-independent bottleneck into a desktop
harness, and require the same failure to reproduce in both. Retain emulator
tests for Activity lifecycle, WebView suspension, Android networking and process
death. Measure runtime and escaped defects before deciding that investment.

## Missing evidence and simulation limits

- Browser freezing is not a hidden tab; emulator screen-off is not Doze or
  process death. Test those separately, including long idle/expired sessions,
  renderer replacement and app recreation. Device power-off tests cold restart,
  not recovery of the same running process.
- TCP stream stalling leaves each proxy-side OS connection established. The
  60 s native run remained `CONNECTED` until traffic was released. It does not
  prove heartbeat detection of a vanished peer or packet-level radio behavior.
  Next separate one-way loss, a never-returning peer and actual network toggles.
- The current mux fault cuts the client's relay path. Add relay restart,
  server-to-relay loss, server restart and rate-limit exhaustion separately.
- No forced authentication rejection, revocation, verification failure,
  ambiguous write/upload, duplicate-event assertion or unknown-response leak
  stress was performed here. No login redirects observed is not coverage of
  those cases.
- Current screenshots and mutation records demonstrate specific errors, not
  absence of all visual flicker. Android has checkpoint WebView screenshots,
  not continuous device video. Add continuous native capture when examining
  short blank frames, keyboard or native-shell presentation.
- Large Inbox/sidebar data, simultaneous streams, multiple servers and native
  IME input remain necessary. Diagnostic runs have host samples but no benchmark
  capacity gate; timings should not become performance thresholds.

## Validation

The opt-in unit reproduction has two passing characterizations and one
intentional failing contract assertion. It is outside the normal test suite
and documented as red, not skipped inside a supposedly green acceptance suite.
The fault controller has passing actual-socket checks for ordered recovery,
refusal and closing while stalled.

The normal workspace tests passed: shared 955, push 45, relay 130, server 6447
(63 skipped), client 6770, plus the mobile sodium checks. Type checking,
format verification and console scan passed. The minified Android app and
instrumentation APK built. Workspace lint exited successfully with 11 existing
warnings in the provider sign-in feature. Before committing this study, a
separate cleanup documented the intentional polling dependency and terminal
control-character matches without changing behavior; lint then passed without
warnings and the eight provider-login unit tests passed.

The existing direct Android live portion passed (11 successful cases, three
known ignored defects and one opt-in study assumption skip). The combined
command then failed before mux instrumentation because ADB briefly reported the
emulator offline. That infrastructure failure is retained in `existing-live.log`;
it is not a clean full-suite pass. A separate mux-only invocation passed seven
cases, with three known ignored defects and four assumption skips for direct-only
or opt-in cases. JUnit's printed `OK (12 tests)` and `OK (11 tests)` include
assumption skips; those are not additional executed acceptance cases.

The focused `native-webview.spec.ts` browser regressions passed both desktop and
phone cases, including 68 sequential keys at 20 Hz alongside 1 MiB frames.
Final end-to-end harness smoke runs passed on browser and Android, exercising
output-directory creation and cleanup separately from the comparative
observations. Android instrumentation completed successfully; its APK hashes
are retained in the final smoke result. The owned emulator was shut down after
verification. Local check logs are
under `tasks/source-lifecycle-study/`; the broad workspace check logs from the
investigation are also retained under `/tmp/ya-lifecycle-*` on this host.
