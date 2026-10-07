# Android lifecycle hardening: second experiment round

The maintainer requested emulator-first investigation, matched web comparisons,
recorded gaps and repairs before physical-device handoff. Runtime baseline is
`b317cf7f6`; [the first study](source-lifecycle-study-2026-10-07.md) records the
preceding request/subscription/recovery repairs. The extended harness first
landed in `0f24af3ad`. Native remains the app's only SRP owner. Standard web
reconnection policy remains unchanged.

## Method and acceptance

The [lifecycle runner](../../packages/client/e2e/lifecycle-study/README.md) uses
owned fixture servers, a TCP fault gate and the production minified Android
Kotlin/Rust/WebView path. The API 35 emulator is disposable; no physical phone
was used. Runs retain source, harness and APK identities, page observations,
input timing, captures, logs and cleanup outcomes beneath ignored
`tasks/android-hardening-round2/`. Failed attempts remain separately recorded.

Acceptance requires automatic page catch-up, route/draft retention, a fresh
sidebar, every sequentially typed character acknowledged within 100 ms, and no
observed error/login/post-render blank transition. Session cycles additionally
require exactly one copy of each missed message; resource observations check
that subscriptions do not accumulate. Recovery timings are observations, not
performance promises or cross-host benchmarks. The fixture has one project,
one session and 50 starting messages; it does not establish large-data typing
performance.

Process-death preparation exits instrumentation before backgrounding and killing
the app with Android `am kill`. The runner proves the old process absent and
uses ordinary launcher startup. It does not simulate process death by reloading
a page or by force-stopping YA, which changes push-delivery policy. Separate
cleanup restores saved profiles/tabs and retires owned push subscriptions.

Mobile Chrome comparisons use Chrome 124.0.6367.219 on the same emulator, not
proof of every current Chrome version. Stock Chrome adds only first-run
suppression and a debugger socket. Its normal background policy stays enabled;
Playwright's automated launcher additionally disables some background throttling.
A browser restart may need explicit navigation to the saved URL; results record
that distinction rather than claiming the tab restored automatically.

## Experiment findings

| Scenario | Android native app | Standard web comparison |
| --- | --- | --- |
| 75-second direct silent traffic stall | Pass; catch-up about 1 s after restoring bytes | Desktop Chromium passes, about 1 s |
| Cold process restart, service available | Pass; new PID, same route and draft | Desktop document close/reopen passes |
| Cold process restart during outage | Pass; draft available offline, full catch-up about 11 s after restoration | Automated emulator Chrome passes after about 50 s; temporary Host Unreachable notice |
| 75-second relay silent traffic stall | Pass; catch-up about 1 s after restoration | Emulator Chrome passes, about 1 s |
| Eight direct session sleep/outage cycles | Pass; draft and one copy of each missed message retained; subscribers remain 17 | Automated emulator Chrome passes; subscribers remain 17 |
| Eight relay Inbox cycles with a new title every time | Pass; subscribers return to 17 each cycle | Stock emulator Chrome passes; same stable subscriber count |
| Three-minute forced deep idle, restore service and wake | Pass; catch-up about 0.8 s after waking | Automated Chrome about 38 s; stock Chrome about 36 s; both pass |
| Draft-sync notice after a silent stall | Clears within the extended 30-second healthy observation | No stuck-sync defect established |
| Real FCM, absent app process, asleep screen, online tap | Pass with corrected observer; opens the session and retains its draft | Web Push delivery/service-worker routing not exercised |
| Same notification tapped while server sockets are refused | Fails 2/2 before repair: Inbox recovers but the destination is lost for the entire three-minute window | Cold URL reopening during outage is a partial comparison and recovers |
| Attachment validation interrupted in flight | Candidate repair passes after fixing the fixture and targeting validation specifically | Connection rejection is a raw `WebSocketCloseError`; the existing raw page-error gap also reproduces |

A 30-second Chrome capture initially looked stuck on Host Unreachable; the
longer observation proved automatic recovery. No permanent-failure defect is
claimed from that capture. Initial Inbox-cycle runs reused one title and were
insufficient proof of catch-up on every cycle; the repeated runs above change
the title each time.

## Escapes and corrected diagnoses

### Fixture omitted attachment-validation routes

Android CI [498](https://github.com/kzahel/yepanywhere/actions/runs/37679085281)
and internal-release [499](https://github.com/kzahel/yepanywhere/actions/runs/37680945484)
failed the same two attachment-toast assertions. The initial interpretation was
that every toast came from an interrupted request. Diagnostic tracing disproved
that: the fixture accepted staged uploads over its native WebSocket but did not
supply `upgradeWebSocket` to `createApp`. Consequently the HTTP upload-route
family, including validation and materialization, was absent. Revalidation after
recovery received a real 404. The release job was skipped; run 499 published no
internal Play release.

The corrected fixture uses one upgrade function for both the full HTTP app and
native socket, as production does. Attachment experiments preflight validation
and wait for a delayed validation request specifically before dropping the
socket. This prevents an unrelated session read from triggering the cut too
early. A missing fixture route must not be hidden by weakening the page-error
assertion or suppressing arbitrary 404s in the client.

### Interrupted validation misreports or clears attachment drafts

A separate shared client defect remains reproducible with the complete fixture:
`SessionPage` and `NewSessionForm` treat rejected validation as proof that files
are unavailable. Synced drafts retain references but show a false notice; the
legacy path clears references. Unit reproductions cover both capabilities and
both native connection replacement and browser socket closure. These fail
before the correction. Keeping the reference without its visible chip is also
insufficient and has its own red/green observation.

The correction retains references and chips after a failed request. Known
recoverable connection interruptions are quiet. Other validation failures remain
visible with an accurate check-failed notice, rather than claiming files vanished.
A completed response confirming missing files still follows the existing missing
file behavior. No transport recovery policy, request replay or server contract
changes. This is a bounded shared UI/data-preservation correction.

The browser's separate [raw socket-error gap](../../gaps/browser-reconnect-shows-raw-websocket-error.md)
still reproduces when page reads are interrupted. It predates this round and is
kept as baseline behavior; attachment validation must not disguise that remaining
page-error failure as a clean whole-page pass.

### Android discards an offline notification tap

Real FCM delivery succeeds after process death. The app was last on Inbox; after
tapping during an outage, Inbox and the sidebar recover but the notified session
never opens. `MainActivity` consumes the extras and drops the action on its first
failed authenticated lookup. Two independent runs reproduce this failure.

The repair retains the opaque pending tap while the existing foreground native
owner recovers. It resolves only when connected and rechecks the enabled binding
before opening the server-provided destination. Terminal authentication,
revocation and definitive lookup failures stop it. Backgrounding cancels lookup
work and releases its lease; foreground/recreation can resume the pending tap.
A newer tap or host-management choice supersedes it. No new retry timer or
background connection owner is introduced.

Seven Kotlin cases cover exhaustion, disconnect during lookup, typed operation
failure, terminal rejection, revocation during lookup, retired bindings and
cancellation. The first repaired APK passes real online and offline taps, and a
second process death while the offline tap is pending. The latter proves new
PIDs and recovery of the saved action, not merely restoration of Inbox.

## Harness limits and verification

Two initial process-death setup attempts selected a retired instrumentation
WebView or queried the PID before asynchronous launcher startup completed.
Selecting the current PID and waiting for launch completion repaired setup.
The first notification control also lost its observer when native routing loaded
a new document. The observer now reinstalls in subsequent documents.

The early observer measured 11 ms of empty HTML before the new document's first
content. Initial bootstrap is recorded separately from a rendered page becoming
empty; final emptiness and post-render blank transitions still fail. Cold-entry
observers and checkpoint captures do not establish frame-by-frame visible flicker.
Some frames before debugger attachment and replaced-document observations are
unavailable. Those limits are not evidence that a user's draft was erased.

The broader post-repair acceptance and CI results are recorded after the final
build is verified. Three-minute forced idle, debugger-driven input and repeated
wake cycles can falsify important lifecycle assumptions, but cannot establish
real modem handoff, manufacturer battery policy or overnight behavior. Those
remain the final physical-phone checks after emulator defects are repaired.
