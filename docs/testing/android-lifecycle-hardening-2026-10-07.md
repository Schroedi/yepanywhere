# Android lifecycle hardening: second experiment round

The maintainer requested emulator-first investigation of process death,
notifications, silent network failures and repeated/extended sleep, with matched
standard-web comparisons before repairs. Runtime baseline is `b317cf7f6`;
[the first study](source-lifecycle-study-2026-10-07.md) records the preceding
request/subscription/recovery repairs. Standard web behavior remains the baseline.

## Method and acceptance

The existing [lifecycle runner](../../packages/client/e2e/lifecycle-study/README.md)
uses owned fixture servers, a TCP fault gate and the production minified Android
Kotlin/Rust/WebView path. The selected API 35 emulator is disposable; no physical
phone was used. All runs retain source, harness and APK identities, page states,
input observations, captures, logs and cleanup results beneath ignored
`tasks/android-hardening-round2/`. A passing experiment requires page catch-up,
route/draft retention, sidebar freshness and no observed error/login/blank-page
transition. Failed cases are retained individually, never silently retried.

New host-owned preparation and cleanup invocations allow the test runner to exit
before the app is killed. Process-death experiments background the app, use
Android `am kill`, prove the old process absent, and use ordinary launcher
startup. This differs from `force-stop`, which also changes push-delivery policy.
Stored profiles and tab state are restored by a separate cleanup invocation.
A new page's observer starts after debugger attachment; its earliest frames are
not covered by the continuous mutation observer. Cold-entry captures and the
native UI state are separate evidence.

Mobile Chrome comparisons run on the same emulator, with its bundled Chrome
124.0.6367.219. They are not proof of behavior in every current Chrome version.
The automated Chrome launcher disables some background throttling; `--chrome=stock`
keeps normal background policy and adds only first-run suppression and a debugger
socket. A browser process restart may need explicit navigation to the saved URL;
the result records that distinction instead of claiming restored-tab behavior.

## Experiment findings

| Scenario | Android native app | Standard web comparison |
| --- | --- | --- |
| 75-second direct silent traffic stall | Pass; catch-up observed about 1 s after restoring bytes | Desktop Chromium passes, about 1 s |
| Cold process restart, service available | Pass; new PID, same route and draft | Desktop document close/reopen passes |
| Cold process restart during outage | Pass; draft available offline, full catch-up about 11 s after restoration | Emulator Chrome passes after about 50 s; temporary Host Unreachable notice |
| 75-second relay silent traffic stall | Pass; catch-up about 1 s after restoration | Emulator Chrome passes, about 1 s |
| Eight direct session sleep/outage cycles | Pass; draft and one copy of each missed message retained; subscribers remain 17 | Emulator Chrome passes; subscribers remain 17 |
| Three-minute forced deep idle, then service restoration/wake | Pass; catch-up about 0.8 s after waking | Automated Chrome about 38 s; stock Chrome about 36 s; both pass |
| Eight relay Inbox cycles with a different title each time | Pass; subscribers return to 17 each cycle | Stock emulator Chrome passes; same stable subscriber count |
| Attachment-containing draft, wake while offline | Fails: false unavailable toast; attachment survives | Desktop and stock emulator Chrome reproduce the same failure |

These are observations, not recovery timing guarantees. A 30-second Chrome
capture looked stuck on Host Unreachable, but the longer observation proved
automatic recovery; no permanent-failure defect is claimed. The Android draft-sync
waiting notice clears during a 30-second healthy observation; no stuck-sync
defect was found.

## Harness findings and limits

Two initial process-death setup attempts exposed harness defects before fault
injection: debugger discovery could select a retired instrumentation WebView,
and asynchronous launcher startup could be queried before its new PID existed.
The runner now selects the current PID and waits for Android launch completion.
Those failures are retained as `android-process-death` and
`android-process-death-v2`; they are not product escapes. The corrected v3 run
passed.

Three-minute forced idle and repeated wake cycles can falsify important
lifecycle assumptions, but cannot establish real modem handoff, manufacturer
battery policies or overnight behavior. A real-phone pass remains the final
hardware-specific check after emulator defects are repaired.

## Escapes found in this round

[Draft-attachment validation during an outage](../../gaps/draft-attachment-validation-during-outage.md)
is a shared client escape. Android App CI 498 first exposed it in sleep/wake and
real network restoration. New, isolated real-upload experiments reproduce the
same misleading toast in Android, desktop Chromium and stock emulator Chrome.
The final draft and attachment survive with draft sync enabled. New Session form
unit reproductions additionally show that the older nonsynced path clears the
references on a reconnect rejection. Existing connectivity/request tests lacked
this attachment-containing draft case. This is a narrow shared UI correction;
web reconnection policy is not implicated.

Real FCM enrollment and delivery after verified process death succeeded on the
emulator. The first online tap run invalidated its observer when native routing
loaded a new document. That incomplete run is a harness failure, not evidence of
a lost draft. The corrected observer is installed in subsequent documents, and
the online control and offline destination lookup are repeated separately.

[Offline Android notification taps](../../gaps/android-notification-tap-lost-during-outage.md)
lose their requested session while the restored Inbox recovers. This is native
routing ownership, not a web reconnect failure. The notification is delivered
through real FCM, tapped in the system tray, and resolved through the app's real
native connection. Browser cold URL reopening during an outage is a useful
partial comparison and passes; browser Web Push's service-worker tap path was
not exercised by the native FCM experiment.

The online control opens the correct session and retains its draft. Its corrected
early observer initially failed on 11 ms of empty HTML before first content in
the new document. The observer now labels initial bootstrap separately from an
already-rendered document becoming empty; both are recorded. Final emptiness
still fails, as do post-render blank transitions. These observations are not
frame-by-frame proof of visible flicker.

Both Android CI [498](https://github.com/kzahel/yepanywhere/actions/runs/37679085281)
and internal-release [499](https://github.com/kzahel/yepanywhere/actions/runs/37680945484)
failed the same two attachment-toast assertions. The release job was skipped;
that run published no internal Play release.

The finalized online notification control passes all page invariants. Two
independent offline-tap runs remain on Inbox. Direct in-flight requests with a
real attachment also reproduce the warning in Android and desktop Chromium;
the interrupted captures show the warning above the still-present attachment.
