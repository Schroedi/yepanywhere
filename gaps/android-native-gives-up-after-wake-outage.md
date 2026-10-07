# Android native connection gives up for good when woken without network

When the screen turns on before the phone's network is back, native's
reconnect fails three times (`retryDelaysMs` 250 ms, 1 s, 3 s in
`YaServerConnectionManager`) and then calls `failTerminal(... FAILED,
"Could not connect to the paired server")`. Nothing retries after that, so the
bundled page stays offline after the network returns, until the user reloads
it. The reload releases the last lease, native drops to `IDLE`, and the next
acquire connects.

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
Native has no equivalent, so the bridge cannot meet that contract.

Fix direction: an exhausted budget for a network failure keeps the source
recoverable and retries on foreground, network-available callbacks and a slow
visible backstop. Only authentication rejection, revocation and verification
failures stay terminal. Unit-test it in `YaServerConnectionManagerTest` with
the existing fake connector, then un-ignore the instrumented scenario.

Found 2026-10-07 while reproducing the fake-503 report on an emulator.
