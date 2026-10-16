# Android packaged artifacts and native streaming — 2026-10-16

Status: the selected emulator matrices below pass; the new eight-reader
slow-link diagnostic fails. Physical and connection-wide flow-control
acceptance remain open. Nothing was published.
[Plan 156](../tactical/156-android-secure-transport-and-artifacts.md) owns the
remaining work. The [security contract](../../topics/active-content-security.md#bundled-android-fixed-shell)
owns observable behavior, authority, limits and fallback.

## Test boundary

Tests used the actual bundled, minified Debug app on an owned Android 15/API35
ARM64 emulator with WebView 124.0.6367.219. The side-by-side artifact test package
has no production app-link filters. Every run refused an existing test install,
created temporary YA/profile/file data, paired through the real native UI,
verified the app's captured-source viewer and removed only its owned app,
forwards/reverse ports and server/relay processes. The installed primary app's
profiles were untouched. Screenshots, APKs, credentials and private selectors
are not repository artifacts.

There were two network boundaries:

- Public `wss://relay.yepanywhere.com/ws`, with a disposable identity and normal
  TLS/SRP/encrypted transport. The APK supplies its four fixed viewer assets;
  it does not use a hosted artifact tunnel.
- An owned local relay, reached by the native socket through an ADB reverse and
  a TCP fault gate. This leg uses loopback WebSocket plus the normal SRP/NaCl
  encryption, not TLS. The YA server connects directly to that owned relay;
  faults affect the native client's real socket. WebView network emulation
  would not exercise this connection.

The native interceptor supplies no artifact bytes or file authority. The same
browser service worker and trusted parent broker used by the web viewer obtain
bytes through authenticated, principal/session-bound preview leases. The
privileged main frame remains at appassets; artifact frames have no native
bridge and cannot embed the privileged parent. Fixed shell routing has a JVM
security matrix; the real pane verifies the isolation and navigation boundary.

## Passing emulator matrix

| Boundary | Measured outcome |
| --- | --- |
| Actual public-relay pane | PNG/srcset, CSS/background assets, WOFF2, classic scripts, static/computed modules, exact JSON/binary/empty files and range metadata pass. |
| Fragment compatibility | Theme, widget state across inner reload, bounded follow-up insertion without submission, find and real sequential typing pass. |
| Navigation and workers | Linked HTML, reload, explicit worker termination/restart and inert network fallback pass. |
| Warm launcher resume | Three real HOME/MAIN cycles (1 / 2.5 / 1 s background) each show ready→connecting→ready once, retain parent/artifact identity and draft, and read a fresh asset with status 200. No application console errors. |
| Pane teardown | Eighteen successive fresh admissions pass, beyond the 16-live-leases-per-principal cap. Each has a new origin/storage context and its worker registration is removed on close. |
| Large media through owned relay | Twenty distinct local PNGs and a real 150,254,617-byte H.264 movie (600 s, 640×360, 12 fps) pass. A 100,663,296-byte prefix matches a bounded-buffer SHA-256 digest tree. |
| Range fidelity | A 65,536-byte bounded seek at byte 50,000,000, an 8,191-byte suffix, an open-ended final 2 MiB and an invalid range match exact bytes/status/Content-Range. The invalid response retains `bytes */N` with status 416. |
| Playback | Real user activation starts playback; seeks reach 150.17, 450.19, 60.16 and 594.20 s. After 65 s paused, playback resumes at 300.25 s. A presented-frame callback and 72 sampled pixel colors establish decoded video, beyond metadata-only success. |
| Interrupted body | Cutting the real socket after the first 65,536 bytes of a 16 MiB response fails that body in 124 ms. Another queued 65,536 bytes arrive before failure; it does not silently splice/replay the response. A fresh artifact read succeeds. |
| Seeded recovery | Seed `156202610`: disconnect, 2,329 ms connection refusal and 3,171 ms silent stall recover. The disconnect observation lasts 2,002 ms. Draft retention, one visible recovered update and restoration of the same artifact document pass. |
| Images during faults | A separate focused run queues twenty local image reads during each of those three faults. All sixty recovered responses match their expected SHA-256 bytes. It intentionally omits the full prefix/pause media matrix, which passed separately. |
| Movie retry | Playback works again after the network faults using a fresh media request and a real play gesture. |

The full media/fault run showed two visible recovery intervals: one for the
initial cut/immediate second cut, and one for refusal. The short silent stall
needed no visible reconnect. This is a measured schedule, not proof that the
maintainer's particular physical-phone resume sequence is resolved.

The transcript assertion parks the covering modal before inspecting catch-up,
then restores it and checks document identity. Covered transcript rendering is
intentionally frozen under the existing
[covered-viewer gap](../../gaps/covered-viewer-live-transcript.md). DOM mutation
counts during typing do not establish that a covered transcript advanced.

## Typing and diagnostics

Every test types sequential trusted characters, checks each retained prefix,
and records event creation, input and animation-frame acknowledgement. Each
sample must remain within 100 ms. Android CDP command round-trip time is
reported separately; desktop retains its existing additional round-trip gate.

| Run | Artifact: 32 characters, max input/frame | Composer: 33 characters, max input/frame |
| --- | --- | --- |
| Public-relay complete baseline | 9.7 / 30.7 ms | 6.8 / 17.2 ms |
| Complete movie/fault run | 4.3 / 15.0 ms | 16.8 / 23.9 ms |
| Focused twenty-image fault bursts | 11.9 / 22.6 ms | 26.1 / 28.4 ms |
| Public-relay warm-resume run | 7.5 / 17.8 ms | 5.4 / 18.6 ms |

The complete movie run appended 33 concurrent review updates while typing.
Its command round-trip maxima were 108/279 ms, while event/input/frame clocks
passed. The emulator foundation runner's historical 2,000 ms software-renderer
allowance is **not** this strict typing qualification.

An earlier owned-relay attempt missed the unchanged frame gate at **103.2 ms**
for composer key 22. It remains a failed qualification attempt. Later runs
passing do not explain that miss or establish its absence under every load.
The manual recorder now preserves bounded long-task and per-key evidence on a
failure. Physical-device timing and further reproduction remain necessary.

Chrome 124's built-in video controls register an orientation listener; sensors
remain denied. The runner separates only that exact diagnostic from app errors,
and separately recognizes the explicit invalid-range probe's exact 416 resource
diagnostic. It keeps every other console error fatal. The
[pinned Blink implementation](https://chromium.googlesource.com/chromium/src/+/refs/tags/124.0.6367.219/third_party/blink/renderer/modules/media_controls/media_controls_rotate_to_fullscreen_delegate.cc)
explains the listener. Whole-device captures were visually inspected, including
actual colored video pixels, and presented through artifact capture.

The warm-resume run's command RTT maxima were 41/124 ms under eighteen live
updates. Android reported `document.visibilityState === "visible"` even while
the OS confirmed the app had left the resumed Activity. Native foreground and
lease state, rather than DOM visibility alone, must own this boundary. These
three short launcher cycles do not qualify phone sleep/wake or process death.

## Defects exposed and repaired

- A browser startup leading space was erased when ref/layout adoption preceded
  passive draft hydration and whitespace-only storage read back as empty.
  The controlled regression fails before the repair; new-draft hydration still
  works. The unchanged browser login/SRP/relay matrix then passes all 32 cases.
- Movie cancellation crashed the server in Node 26.7.0's Readable.toWeb adapter
  after a controller closed. Authorized file responses now use bounded
  positional reads with a cancellation latch. A 300-iteration standalone loop
  did not reproduce the original timing; the actual-pane crash is the evidence.
- A zero-read-ahead first implementation leaked descriptors for small unread
  responses inspected only for headers. The full suite caught seven GC errors.
  One bounded 64 KiB chunk plus proactive EOF closure fixes that ownership path;
  a real-file regression checks closure before consuming retained bytes.
- A warm-resume attempt retained the artifact and draft through three cycles
  and read fresh assets, but failed acceptance on settings GETs reporting the typed expected
  reconnect interruption as errors. The settings owner now retains its snapshot
  and lets the connection indicator own that transient read state. A controlled
  red/green regression preserves genuine read failures and failed writes, and
  verifies reconnect revalidation without mutation replay. The fresh actual-app
  run passes, including banner edges and eighteen more teardown cycles. One
  intervening attempt failed only the harness's OS Activity-field parser; the
  corrected parser requires a recognized resumed Activity outside the test app.
- The first new viewer status subscription assumed all transports returned
  stable, unbound snapshots. Seven existing local/relay viewer cases failed.
  The viewer now subscribes through the receiver and snapshots only the primitive
  packaged-version value; all 120 focused viewer cases and full units pass.

Native resume/credential, catch-up, writer-cancellation, source admission and
coalesced-state repairs are recorded in plan 156 and their commits. Existing
Rust real-peer tests cover per-body queues, FIFO admission, cancellation/EOF,
credential serialization and unchanged-server fallback. Kotlin queue tests
cover state/control priority, bounded event pressure and media/event fairness.
These bounds do not establish a shared bound over cancelled relay tails.

## Eight-reader slow-link reproduction — 2026-10-17

Two isolated actual-app runs requested eight 16 MiB ranges from the generated
movie, read one chunk from each response that started, and retained unread
bodies for approximately 20.5 seconds. An owned TCP gate limited downloads to
128 KiB/s per physical connection while preserving upload progress; this was
not WebView network emulation. Neither relay limits nor production framing was
changed. Both runs failed the opt-in diagnostic: the relay's `relay_closed`
circuit counter increased by one. Four requests returned 206 and four 504 in
the first run; five returned 206 and three 504 in the repeat. Every successful
first chunk contained 65,536 bytes. This is not full-range completion evidence.

The repeat's passive counters recorded **no physical mux close or reopen**
during the burst. Observed incoming message maxima remained 66,843 bytes from
the server and 1,569 bytes from the client, below the default 2 MiB frame cap.
Given the current mux close paths, those observations isolate the circuit
closure to the queue-limit path; this attribution is an inference from the
observed counters and implementation, not a newly emitted subreason. One live
circuit means its 2 MiB ceiling is reached before the 8 MiB socket queue cap.
The relay also counted twenty additional invalid requests during the burst;
their individual contents were not recorded.
After cancellation and removal of throttling, a fresh artifact read returned
200 and the owned app was removed.

Both runs began with the relay circuit `relay_closed` counter already at two.
The repeat additionally observed two physical mux closures before the stress
phase. Their cause is not classified by this probe. The stress delta above is
separate; neither the successful functional setup nor final recovery establishes
that this pre-probe baseline had no connection churn.

Eleven main-process PSS samples per run peaked at 133,318 KiB and 145,068 KiB,
respectively. The second ranged from 143,663 to 145,068 KiB. These short samples
exclude isolated WebView renderers and do not establish aggregate memory bounds
or cleanup of all downstream buffers. The test stores bounded diagnostic data,
not complete movie bodies. Its rate-control regression verifies exact ordered
bytes, independent upload progress and cancellation of a pending pacing timer.
Gate teardown also now waits for all owned upstream and downstream sockets.

The versioned connection-window proposal remains approval-pending. This red
baseline gives it a real-device-path regression target; it does not authorize
a contract edit or justify raising the relay's existing limits.

## Verification and remaining limits

Workspace lint, format and typecheck pass; full units pass with 7,022 client
and 6,589 server cases. Rust's 32 tests/fmt/warning-denying clippy and Android
BundledDebug JVM/lint/build/instrumentation compilation pass. The earlier
isolated actual-app foundation runs pass direct (17 cases) and mux/100 MiB
(16 cases), including their declared runner-owned/direct-only skips. A fresh
isolated mux main-app probe also passes: 100 MiB uploaded, 3,559
bridge frames / 106,451,685 bytes, 1,053,190-byte measured queue high water,
zero overflows, 23.5 ms maximum typing acknowledgement. Its sanitized status
proof records one initial CONNECTING→CONNECTED epoch, native credit latency
p50/p95 3,515/28,138 µs and main-thread dispatch 32/194 µs. This upload probe is
not aggregate movie-stream memory evidence.
The broader browser run finished with 406 passes, ten skips and five failures
in 16.8 minutes. Two native-WebView failures exposed lost recovery demand inside
the five-second cooldown; a controlled regression fails before retaining one
attempt for the cooldown boundary. The repaired desktop/phone browser-fixture
cases pass in 53 seconds, with 68 real keys at 20 Hz/1 MiB incoming frames and
15.2/13.4 ms maximum frame acknowledgement. This is a browser bridge fixture,
not physical Android evidence. Full units and the actual Android main-app probe
pass after that repair.

The other broad-run failures were process-app startup requiring Linux/Bubblewrap
on this macOS host, opportunistic WebRTC device streaming against the generic
native-app emulator, and a context-menu test expecting macOS Control-click to
open a page. A separately identified Chromium probe confirms Control-click
emits only contextmenu on macOS while Meta/Shift clicks open pages. The test now
uses the primary platform modifier and separately checks macOS Control-click
context suppression; the focused check passes in 25 seconds. The remaining
[App sandbox](../../gaps/e2e-local-instructions-and-project-app-failures.md) and
[WebRTC readiness](../../gaps/opportunistic-emulator-webrtc-readiness.md)
findings are tracked separately. No full-green browser result is claimed.

Unqualified or pending:

- The attached API37 phone is PIN-locked. Its earlier isolated main probe passed,
  but sleep/wake and native large-media/fault qualification are not complete.
- A separately negotiated connection-wide window is approval-pending. Eight
  independent 1 MiB body windows plus completed/cancelled tails can exceed the
  relay mux's 2 MiB queue under a slow downlink. Short fault and image-burst
  passes do not settle that defect. No new production wire mode was added.
- Eight-large-stream slow-link acceptance fails as recorded above. Only sampled
  main-process PSS is available; no aggregate process-memory high-water bound
  is established. Unit bounds are not aggregate device-memory evidence.
- The current native tab implementation keeps one active WebView; selecting a
  different native tab saves history and destroys the old document. Two live
  artifact documents across native tabs are not supplied by that topology.
  Artifact-specific tab-switch/source-switch cleanup, Activity recreation,
  long half-open sockets and radio/route transitions still need acceptance.
  Sequential viewers and worker restart are narrower evidence.
- The source/generated APK uses 256 MiB per file, 1 GiB produced bytes per viewer
  and a 120-second progress deadline. The currently deployed hosted worker keeps
  its earlier 64 MiB file limit until separately published. Old-server and custom
  viewer fallbacks retain their existing limits.
- No iOS/WebKit or Tauri implementation/qualification is implied.
- Opus 5.5 high reviewers did use tools with bypass permissions. Earlier findings
  were addressed; the account's monthly spending limit prevented a fresh final
  review. No billing limit was changed.

Reproduction commands and ownership safeguards live in
[artifact-host/README.md](../../artifact-host/README.md#packaged-android-acceptance)
and [the native testing guide](../development/testing.md). Raw receipts/captures
remain in ignored `.artifacts/managed-artifact/`, not in this report or Git.
