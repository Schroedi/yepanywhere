# Android reports native transport failures as server 503 responses

After a fresh relay login in the Android app, opening the first session showed
`Error: API error: 503: Native connection unavailable` about 20 times over 30
seconds before the normal view appeared (user report, 2026-10-07).

The YA server never sent that 503. `YaRustProfileConnector.execute`
(`packages/android/app/src/main/java/com/yepanywhere/mobile/connection/YaRustProfileConnector.kt`,
the `catch (_: CoreException)` in the `"request"` branch) turns every native
request failure into a synthetic HTTP 503. Those failures include a full
command queue or in-flight limit (`Overflow`), a 30 s timeout, a failed send,
`fail_pending` during an internal reconnect, and a closed lease
(`packages/mobile-core/src/session.rs`, `runtime.rs`).
`YaWebTransportSession.request` then forwards that 503 to the WebView as an
ordinary server result. The client reports it through `RelayProtocol` →
`useSessionMessages` → `SessionPage` as a session error.

That bypasses both client mechanisms meant for transport churn:
`RelayProtocol.retryReadThroughReconnect` only retries a
`ConnectionReconnectingError`, and `NativeSourceTransport.setPhase` converts
pending reads only when a non-ready phase arrives. The native `RETRYING` state
reaches the WebView through the event queue after the synthetic 503s have
already been sent. The browser fixture already models the intended contract by
rejecting the bridge operation (`packages/client/e2e/native-webview.spec.ts`).

Intended fix: a native failure that the server never answered becomes a typed,
retryable bridge error. Do not add a server-shaped status, and do not match
message text on the client. `NativeSourceTransport` should map that bridge
error to `ConnectionReconnectingError`, so reads take the existing retry after
reconnecting. As supporting work, `YaServerConnectionManager` should stop
handing out the current connection while `RETRYING`, so new requests wait
instead of filling the native queue.

Not fixed in place: the change spans Kotlin, the WebView bridge contract, and
the client. This host has no Android SDK, so the Kotlin half can be compiled
only by `android-app-ci.yml`. The relogin trigger is inferred, not observed;
confirming it needs device logs of native phase changes alongside the 503
timestamps.

Found 2026-10-07 while fixing relay sign-in after a rejected saved session.
