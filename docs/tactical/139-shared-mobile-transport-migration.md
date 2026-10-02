# Shared mobile transport migration

Status: in progress. Maintainer direction, 2026-10-02: prioritize Android's
Rust migration now and give iOS the same multi-host transport capabilities.

This continues [the iOS/core proof](138-ios-native-core-proof.md), after
simulator and physical iPhone acceptance. The existing
[mobile connection contract](../../topics/mobile-server-pairing.md) owns
source demand, route ordering, retry bounds, credential protection and isolation.
The [roadmap](../roadmap/README.md) keeps mobile publication the product goal.
The separate [WebKit viewer/download gap](../../gaps/ios-webview-viewers-and-downloads.md)
and common native push enrollment remain release work.

## Scope and compatibility

Preserve the owner principal, existing SRP protocol, configured endpoints,
saved Android profiles, encrypted credentials, continuity keys and WebView
source boundary. The server requires no new route or capability. Limited-user
login and OPAQUE remain deferred. Kotlin and Swift retain platform storage,
login/host presentation, WebView, notification and OS lifecycle adapters.

### 1 — Share physical relay sockets across independent hosts

Implemented: Rust pool/circuit isolation checks and live two-server mux sharing,
independent close, reconnect and final cleanup pass. Per-profile consumer demand
and Android adoption continue below.

Replace Rust's single-circuit wire with a bounded relay pool and circuit-local
queues. Discover mux only for eligible configured relay endpoints, retain exact
legacy fallback and direct sockets, handle overflow without losing peers, and
close idle sockets. Authentication and encryption stay independent per source.
Verify concurrent same-relay hosts, one-circuit teardown, slow-consumer isolation,
physical-socket failure and last-owner cleanup against disposable unchanged YA
servers and relays.

### 2 — Package and adopt Rust in Android

Generate Kotlin UniFFI bindings and Android libraries with pinned tooling.
Preserve the current minimum Android version and supported ABIs; package and
verify release libraries, including 16 KiB page alignment. Move production
authentication/encryption and connection work behind the existing Kotlin source
surface incrementally. Preserve route preference, scoped demand, background
ownership, three bounded retries, subscription restoration and non-replayed
requests/uploads. Convert credential representation only inside native protected
storage; preserve the authenticated protocol high-water across cancellation.
Use existing manager/bridge/storage tests plus live Rust execution and Android
instrumentation as gates. Production has one transport backend.

### 3 — Use the common connection ownership on iOS

Keep saved-host selection separate from transport demand. Multiple independent
native source owners can share a relay socket; retiring one document/profile
cannot close another owner's circuit. Preserve Keychain, per-profile WebKit
storage, route/draft restoration, source-document checks and iOS suspension
rules. iOS does not promise Android foreground-service behavior. Re-run native,
simulator UI and available physical-device acceptance.

### 4 — Record and verify the migration

Keep observable contracts and roadmap status current at each landed checkpoint.
Run Rust tests/Clippy, unchanged-server direct/mux/legacy probes, Android
unit/lint/release packaging and applicable device tests, iOS regression acceptance,
and the required root checks. Commit verified slices as work progresses.
