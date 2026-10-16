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
- [Duplicate subscription](../../gaps/android-connection-manager-duplicate-subscribe-flake.md)
  records a potentially related restore/first-dispatch race, not a proven cause
  of the reported UI cycles.

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
