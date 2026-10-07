# Android wake outage exhausts native retries and leaves the page waiting

When the screen turns on before the phone's network is back, native's
reconnect fails three times (`retryDelaysMs` 250 ms, 1 s, 3 s in
`YaServerConnectionManager`) and then calls `failTerminal(... FAILED,
"Could not connect to the paired server")`. The bundled page can remain
offline for roughly a minute after the network returns. The original
30-second observation incorrectly described this as permanent failure.

Reproduced on an API 35 emulator, 2 of 2 runs:
`YaNativeReconnectInstrumentedTest.wakingBeforeTheNetworkReturnsShowsNoSyntheticServerErrors`
(ignored until fixed). The probe server's `/__probe/outage` refuses native's
sockets while the screen is off and for 8 s after wake. Phases:

```
22063ms CONNECTING
22217ms RETRYING attempt=1
22518ms RETRYING attempt=2
23588ms RETRYING attempt=3
26656ms FAILED  Could not connect to the paired server
```

The page still showed its connection-status bar 30 s after the outage ended.
While native was failed, a page request also failed with "Native connection
timed out".

The web transport's contract treats an exhausted retry budget as
`reconnecting`, not terminal: visible sources keep probing every 60–78 s and
probe immediately on visibility, focus, network-online and user activity
([source transport § Recovery after a temporary outage](../topics/source-transport.md#recovery-after-a-temporary-outage)).
`NativeSourceTransport` already has recovery signals and a 60-second visible
backstop. Native's exhausted `FAILED` phase nevertheless maps to caller-facing
`disconnected`, so the bridge does not faithfully express that recoverability.

Longer [matched browser/emulator experiments](../docs/testing/source-lifecycle-study-2026-10-07.md)
on 2026-10-07 observed passive Android recovery after about 57 seconds twice.
One native trace goes from `FAILED` at 23,273 ms to `CONNECTING` at 83,298 ms,
then `CONNECTED` at 83,411 ms. Real typing after restoration recovered in about
one second in a separate run. The opt-in
[`native.repro.ts`](../packages/client/e2e/lifecycle-study/native.repro.ts)
checks the existing 60-second timer and fails on the disconnected status.
Do not repair this by blindly adding a second timer.

The fixture refuses server connections while Android stays online. Restoring
the server does not necessarily produce a device network-available callback;
service recovery and radio recovery need separate tests.

Fix direction: an exhausted budget for a network failure keeps the source
recoverable, with explicit ownership of foreground, network-available callbacks
and the existing slow visible backstop. Only authentication rejection,
revocation and verification
failures stay terminal. Unit-test it in `YaServerConnectionManagerTest` with
the existing fake connector, then un-ignore the instrumented scenario.

Found 2026-10-07 while reproducing the fake-503 report on an emulator.
