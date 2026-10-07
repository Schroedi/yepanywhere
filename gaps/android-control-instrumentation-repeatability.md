# Android control instrumentation is not reliably repeatable

On a fresh API 35 emulator, the minified ordinary suite after the system-bar
repair failed `WebClientActivityTest.nativeHostDoesNotReplyToASubframe`: the
injected iframe's load marker stayed `pending` for ten seconds, before the
no-privileged-subframe-reply assertion. A focused rerun passed in 2.51 seconds.
The cause is unresolved; document readiness alone may precede React startup.
Do not weaken the security assertion or increase the timeout without diagnosis.

Repeating the entire suite on the same installation then killed instrumentation
in `recentUserActionCanResolveNotificationPermission`. Logcat explicitly says
`Killing ... com.yepanywhere.mobile ... permissions revoked` after its helper
revokes the permission granted by the first run. This is an OS process kill,
not an application exception. Permission reset should happen before starting
the instrumentation process, or the test should be isolated by the runner.
Clearing only the owned disposable emulator's test app data is the current
clean-run preparation; never do that on a user's phone.

Both failed logs are retained in `tasks/android-hardening-round2/`. Neither
failure is evidence of connection regression or a standard web defect. Keep
this bounded test-isolation work separate from the native appearance repair;
CI still runs the assertions without retries on its fresh emulator.

Found 2026-10-08 during final Release/system-bar verification.
