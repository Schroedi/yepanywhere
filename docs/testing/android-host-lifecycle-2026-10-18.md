# Android host open/recovery investigation — 2026-10-18

Scope: experimental `packages/android-host`, not the published remote companion.
The [Android host topic](../../topics/android-host.md) owns the behavior contract;
this report records evidence and limits.

## Morning failure

The supplied Pixel 9 screenshot shows the WebView's default `ERR_FAILED` page
for the local YA entry URL. Its credential is deliberately omitted here.
Read-only inspection found:

- no host foreground service, PRoot runtime or Node server;
- an old persisted status claiming the host process had started;
- retained app-private runtime and local credential;
- the last recorded main-process exit was Android's `PACKAGE UPDATED` kill
  during the previous evening's APK update;
- phone uptime exceeded three days, excluding an overnight phone reboot.

The update is the strongest recorded explanation for the stopped host. These
observations do not reconstruct every event overnight or prove a Doze kill.
An Android package update stopping its processes is expected; the defect was
that **Open Yep Anywhere** trusted the retained token and loaded a dead URL
without starting the service, waiting for readiness or offering recovery.

## Repair and controlled reproduction

Open/provider setup now verify the protected API with the current local
credential, start a stopped host on the explicit visible request, and wait with
a bounded readiness budget. A missing runtime or failed load has native Retry
and Host controls. Open reuses an existing WebView and checks availability on
return without reloading a healthy completed document. Stop/start joins the
old runtime group's bounded shutdown.

On the physical Pixel 7a, terminating only the identified app-owned launch Node
while keeping the WebView alive reproduced the same default `ERR_FAILED` page.
Debug native traces showed navigation fetch errors with `main=false`, before
the top-level navigation callback, without an ordinary page completion. Checking
`WebResourceRequest.isForMainFrame()` or page completion alone missed this
service-worker path. The repair also checks readiness on the navigation intent,
matches errors to the outstanding native-known top-level URL, clears that marker
on completion/unload, and fences results across navigation/lifecycle changes.
Fragment-only jumps preserve the document and fragments are omitted when
matching a network request. Unrelated subresources do not trigger native page
replacement. Page completion also checks backend readiness.

The first warm-resume probe was insufficient: it could inspect a WebView behind
Host controls. The retained probe uses actual Open taps, verifies the resumed
native activity, and checks the existing document's in-memory identity. It also
has a controlled server-loss regression; successful cold opening alone cannot
qualify this repair.

## Physical acceptance

The final current-source Debug APK passed all six scenarios on the physical
Pixel 7a (Android API 37):

| Scenario | Observed result |
| --- | --- |
| Open with no running host | Native startup reached the actual on-device web app without separately tapping Start. |
| Home → launcher → Open | Same in-memory document marker and URL fragment; inspected WebView was the foreground activity. |
| Terminate app-owned launch Node, navigate, Retry | Exact `ERR_FAILED` reproduction replaced with native recovery; Retry restarted the server and returned to the prior usable route. |
| Immediate Stop → Open | Host became ready after the prior group shutdown; no port-collision failure. |
| Force-stop → reopen | Host became ready again; a dedicated private state marker retained its exact contents. |
| Missing launch script → restore → Retry | Immediate native missing-runtime feedback, then successful startup using the exact restored script. |

The phone's web app was still showing its existing theme-onboarding shell. The
runner waited for that real application UI or Projects after routing settled;
it did not dismiss onboarding, create a provider session or fabricate a saved
conversation. Document identity is the warm-resume oracle, not proof of a
provider turn's resumability.

Final native build/lint cover Debug and unsigned Release. Root lint,
format-check, typecheck and workspace tests all passed. The physical captures of
connection recovery and missing-runtime feedback were inspected separately:
status-bar insets are respected, the messages wrap, and Retry/Host controls
remain distinct large touch targets. These native-only changes have no desktop
layout; the captures are actual device images rather than desktop mockups.

## Reproduce and boundaries

Install the current debug APK on an explicitly selected unlocked test phone with
the existing runtime provisioned and host stopped. Run:

```sh
node packages/android-host/tools/lifecycle.mjs --serial "$ANDROID_TEST_SERIAL"
```

The runner uses native controls and WebView CDP, not a desktop browser imitation.
It retains private captures/results under the package's ignored `.local/`,
removes its own ADB forwards, restores a briefly renamed launch script, removes
its private state marker and leaves the selected host stopped. It changes no
radio, ADB listener, permission, provider configuration or unrelated application.
The runtime root is not replaced and no real provider turn is requested.

These checks concern explicit recovery after stopping/process loss. They do not
establish unattended restart, boot recovery, an overnight screen-off/Doze run,
provider credential refresh or successful resumption of an interrupted provider
turn. A retained marker proves storage persistence only. The experimental host
still uses its existing local-token mechanism; this is not a migration to the
desktop shell's one-use bootstrap/cookie design.
