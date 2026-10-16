# Android secure transport and packaged artifact delivery

Status: accepted direction, implementation in progress, 2026-10-16.
Series: `android-secure-transport`.

The maintainer approved incremental commits, browser SRP regression protection,
Android reconnect/streaming improvements, emulator and physical-device fault
testing, and final artifact acceptance with large movies and many images.
Publication is separate from this implementation.

## Accepted Android viewer design

Keep the bundled privileged UI at `https://appassets.androidplatform.net`.
Package the fixed managed-viewer bootstrap, service worker and helpers in the
APK, generated from the same sources as the hosted viewer. Reuse the existing
per-viewer isolated HTTPS origins, browser service worker, captured-source
parent broker and principal/session-bound server preview leases. Android's
native interception supplies only the fixed shell; it never fetches artifact
files or arbitrary URLs on behalf of untrusted content. Install the process-wide
ServiceWorkerClient once without retaining an Activity. Keep third-party cookies
disabled and the exact-origin main-frame native bridge unchanged.

This extends [plan 155](155-managed-artifact-viewer.md); it adds neither an
authentication principal nor a public bearer grant. Server-side authorization
and file containment remain authoritative. Explicit custom deployments retain
precedence. An explicit shell capability/version selects packaged delivery;
unsupported clients/servers retain their existing fallback. No privileged
parent-origin migration or independent native artifact fetch bridge is selected.

The isolated spike `669c09840` measured this shape on Android 17/API 37,
WebView 154, through fresh native pairing and the public encrypted relay.
Relative images, CSS, fonts, scripts, modules, JSON and linked HTML worked;
native authority was absent in content, parent access was denied, and worker
restart/cancellation and sequential typing passed. Its 64 KiB HTTP-range
adapter is experimental evidence, **not** the production streaming design.
Large explicit/suffix ranges, movies and older WebViews remain unqualified.

## Existing work and limits

- [Source lifecycle conformance](../../gaps/sketches/source-transport-lifecycle-conformance.md)
  owns recovery contracts and the remaining shared-suite work.
- [October 7 hardening](../testing/android-lifecycle-hardening-2026-10-07.md)
  and the existing `packages/client/e2e/lifecycle-study/` harness provide real
  native/browser comparisons, outage gates, repeated wakes and bounded cleanup.
- [Warm resume](146-android-tabs-and-warm-resume.md) intentionally releases
  background native leases while retaining the document. One recovery edge
  is expected; the maintainer reports several rapid reconnect cycles on phone
  resume. Their cause is unproven, and final healthy state alone is insufficient.
- The duplicate-subscription gap now has a deterministic reproduction and repair:
  restore must finish before publishing the connected transport. It is not yet
  proven to cause the reported physical-phone UI cycles.

## 1 — Protect ordinary browser password login and SRP recovery

Establish the existing direct and relay full-password login, verified resume,
interrupted requests, subscription catch-up, cancellation and credential-scope
coverage. Add focused real-boundary checks only for missing regression risks.
Capture a passing baseline before changing shared framing or response delivery.
Preserve ordinary browser connection ownership and old-server compatibility;
Android work must not hand native credentials to JavaScript.

## 2 — Diagnose and repair Android resume state

Correlate foreground/document and lease generations, actual connection attempts,
native phase, bridge messages and client status. Reproduce controlled races
with deterministic scheduling before changing recovery. On device and emulator,
exercise repeated short resumes, longer sleep, in-flight reads, pending retries,
server/relay cuts and restoration. Distinguish socket churn from subscription
reattachment or stale UI state. No banner debounce hiding real failures.

One native owner coalesces recovery; obsolete work cannot publish over a newer
connection. Hidden/closed consumers release subscriptions, queued work and
timers. Terminal authentication failures stop; transient network failures keep
credentials. Verify missed messages exactly once, route/draft preservation and
all sequential input acknowledgements within 100 ms during concurrent updates.

## 3 — Deliver progressive bytes with bounded backpressure

Use the existing encrypted response stream protocol where available. Extend
native request/session and bridge interfaces for status/headers followed by
bounded body chunks, demand/credits and cancellation; avoid whole-file JSON or
base64 reassembly. Bound per-stream and aggregate queues and concurrent reads.
Cancellation, disconnect, backgrounding and document teardown release both
native and server producers. Keep control/chat traffic responsive beside media.
Do not blindly replay writes, or silently splice file generations after a cut.
Keep buffered JSON APIs and older-server behavior compatible.

## 4 — Integrate the packaged viewer

Generate and version shared shell assets, install application-owned interception,
advertise explicit availability and reuse the existing managed pane. Preserve
custom viewers, MCP frames, top-level link routing and fallback behavior. Test
two viewers/tabs, source switching, worker restart, Activity recreation, close
and resume without leaking file authority or process-wide callbacks.

## 5 — Qualify large artifacts under faults

Use owned YA profiles, relay/server processes, isolated test application data
and a separately identified browser/emulator. Never replace the user's installed
app or mutate its saved profiles. Keep screenshots, APKs and device selectors
out of Git. Use seeded reproducible faults and retain the seed/action timeline.

Prove the actual Android YA pane loads a page with at least 20 local images
and a large playable movie. Exercise open-ended, bounded, suffix and invalid
ranges, seeking, concurrent reads, slow consumers and mid-stream cancellation.
Check exact bytes/headers against the file, bounded memory/queues, prompt
producer cleanup and continued chat/typing. Repeat on emulator and the attached
phone with disconnections, relay loss, stalls and resume. Label untested engine,
server and release boundaries explicitly. Run required workspace/native gates,
review via an authorized Opus 5.5 high YA session, address findings, and record
the measured acceptance before calling this reliable.

## Progress

- [x] Accepted service-worker design and ordered qualification recorded.
- [ ] Browser SRP regression baseline and missing coverage.
- [ ] Resume diagnosis, regression repair and physical/emulator validation.
- [ ] Progressive native responses, backpressure and cancellation.
- [ ] Packaged viewer integration and lifecycle compatibility.
- [ ] Large-media/many-image acceptance, fault matrix and review.

## Measured progress

The initial unchanged browser password-login/SRP/relay run passed 31 of 32
cases in 1.9 minutes. Full login, verified resume after refresh/disconnect,
credential rejection/scope, relay recovery and a streamed download beyond the
single-message limit passed. The separate new-session startup typing case
lost its initial space; that remains under investigation, not a clean baseline.

Four deterministic native-bridge cases reproduce old reconnect completions
overwriting newer native states. A native state revision now prevents those
old successes/failures from publishing status. The four cases fail before the
repair; all 44 focused bridge/transport/subscription cases pass afterward in
4 seconds. This establishes a state-ordering defect, not the cause of the
maintainer's particular physical-phone observation. Device diagnosis remains.
Root lint (zero warnings), format, typecheck and the full unit suite pass
(6,999 client / 6,583 server; about 125 seconds). Native Rust baseline fmt,
tests and warning-denying clippy pass. Existing intentional negative-path test
logs and console-budget debt remain recorded in their existing gaps.

Progressive native responses now pass the real unchanged-server probes over
native direct SRP, relay mux and exact legacy relay: 40 MiB original bytes,
suffix ranges, concurrent ordinary requests and independent lease cancellation.
The body path uses bounded byte queues and pull-driven binary bridge replies,
not the spike's repeated HTTP ranges. Rust fmt/tests/clippy, Android JVM tests,
workspace lint/format/typecheck and the full unit suite pass (7,008 client /
6,583 server, about 123 seconds). Device and artifact qualification remain.
The Opus 5.5 high read-only review accepted the reconnect-revision fix and
identified further recovery/bridge-pressure races to reproduce and repair;
its recommendations are hypotheses until checked against the current code.

Resume regressions now cover native reachability independent of WebView online
state, one recovery interval across lease edges, five-second recovery coalescing,
late operation replies, native status reconciliation and coalesced lease
reattachment. The focused bridge suite passes 54 cases in 4 seconds. Android JVM
checks reproduce the duplicate subscribe before its repair and pass afterward;
a real encrypted TCP peer also reproduces cancellation of an admitted blocked
request disrupting sibling demand, and passes after preserving the frame write.
The bounded outbound queue drains 200 ordered events while prioritizing lifecycle
state and control, and releases blocked producers/budget on close. Rust fmt,
27 tests and warning-denying clippy pass. Further stream compatibility/admission
findings from the Opus review are being addressed before device acceptance.

The streaming review reproduced two defects against a real encrypted peer:
a 2 MiB buffered JavaScript response was rejected and an invalid body length
killed the source. Fallback now preserves the existing encrypted message bound;
stream-local errors cancel only that body, preserving ordinary sibling requests.
The JS bridge suite passes 59 cases, including twenty concurrent consumers,
queued cancellation/seek, a quiet read beyond 30 seconds, redirect/error parity
and pre-header resume retry. Native slots return on cancel or consumed EOF,
while completed unread buffers stay bounded. Media and catch-up alternate
behind small state/control messages. The physical isolated app's main probe
passed upload and sequential typing; its screen-wake test was blocked by secure
keyguard, so it is not accepted as a passing lifecycle run. No primary app data
was replaced. Emulator and unlocked-phone qualification continue.

Source-wide native FIFO admission now also prevents concurrent documents from
racing the eight-body limit; a real encrypted peer proves cancellation admits
the next body before the old native object is destroyed. Rust fmt, 31 tests
and warning-denying clippy pass; actual mux and legacy relay fixture checks
pass. Android lint/JVM checks and workspace lint/format/typecheck/full units
pass (7,016 client / 6,583 server; about 140 seconds). These are foundation
checks, not completed movie or device-lifecycle qualification.
