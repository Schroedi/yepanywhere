# iOS Native Shell And Provisional Rust Connection Core

Topic: ios-native-core-proof

Status: provisional, 2026-10-01. The maintainer authorized recording this
proposal and executing step 1. Adopting Rust for the mobile connection core,
implementing later steps, and migrating Android remain contingent on reviewing
step 1 evidence. A successful experiment does not itself grant that approval.

## Scope And Existing Work

The selected mobile boundary is native owner login, reauthentication, saved
hosts/Switch Host, protected resume storage, transport and notifications, with
the full bundled web UI as the foreground application. Limited-user login
remains deferred for the initial release. This introduces no new principal,
grant, delegated credential, server route or authentication protocol.

Read the [Android connection foundation](081-android-native-connection-foundation.md),
[bundled web/native transport plan](083-android-bundled-web-native-transport.md),
[mobile pairing contract](../../topics/mobile-server-pairing.md),
[trusted packaging contract](../../topics/trusted-client-packaging.md), and
[resource ownership mandates](../../topics/architecture-mandates.md).
The [CI coverage inventory](../../gaps/ci-platform-coverage-holes.md) concerns
the simulator-control server, not an existing consumer iOS app. No matching
iOS app implementation plan was found in tasks/ or gaps/.

RSTorrent provides the reference pattern for SwiftUI, an in-process Rust
service, UniFFI, XcodeGen and simulator tests. Babytrack provides a reference
for Kotlin/Swift bindings and production-derived crypto fixtures. Their
authentication protocols cannot replace YA authentication. Keep this core in
YA; do not depend on another developer checkout.

## Proposed Ownership And Tools

| Layer | Proposed responsibility |
| --- | --- |
| Existing React UI | Application screens and source operations |
| YA Rust core | SRP, proofs, resume, secretbox, connections, relay mux, reconnect, bounded requests/subscriptions/uploads |
| Swift shell | Native login/hosts, Keychain, WKWebView bridge, Apple lifecycle and notifications |
| Kotlin shell | Android platform adapters, eventually calling the same core |

Candidate tooling is pinned Rust/Cargo, UniFFI Swift/Kotlin bindings, XcodeGen
and xcodebuild, with cargo-ndk for later Android integration. Shared networking
would use Tokio, tokio-tungstenite and rustls with platform certificate
verification; network dependencies are outside step 1. Secretbox should use
libsodium through a reviewed safe wrapper around libsodium-sys-stable. Pin
the actual libsodium source as well as Cargo crates; never fetch unpinned
latest library sources during a build.

SRP remains a library decision, not an approved dependency. RustCrypto's srp
is an interoperability candidate, but upstream reports no formal crypto or
security review and no blinding/secret-erasure guarantees. Compatibility is
not a security review. Do not hand-write SRP arithmetic to make a candidate
match; stop at this gate if no acceptable library exposes YA's profile.
Preserve the current server protocol and working Kotlin implementation.

Sources: [UniFFI](https://mozilla.github.io/uniffi-rs/latest/),
[RustCrypto SRP status](https://github.com/RustCrypto/PAKEs),
[libsodium bindings](https://github.com/jedisct1/libsodium-sys-stable),
[platform TLS verifier](https://docs.rs/rustls-platform-verifier/latest/rustls_platform_verifier/).

## Implementation Sequence

### 1 — Prove the Rust crypto and native build path

Create an explicitly experimental, isolated YA Rust crate and binding harness.
Use the existing production TypeScript/Kotlin fixture as the oracle for the
2048-bit/SHA-512 SRP profile: A, M1, M2, raw S, base key, transport key,
XSalsa20-Poly1305 ciphertext, encrypted server-info proof and resume proofs.
Exercise malformed public values and tampered/wrong proofs and ciphertext.
Do not print secrets or turn fixture-only exports into shipping credentials.

Generate Swift and Kotlin bindings from the same pinned crate. Execute fixture
checks through both bindings; compile and execute the Swift proof on an owned
iOS simulator. Compile the device target separately and, where installed
tooling permits, Android arm64/x86_64 native libraries. Record actual versions,
reproducible commands, binary size and unsupported/unexecuted targets. Ignore
generated files and build output.

Produce a decision record separating wire correctness, packaging feasibility,
library security/maintenance suitability and missing integration evidence.
This step does not claim native login, networking, WebView behavior, Keychain,
background operation or release readiness. Obtain maintainer review of the
concrete evidence before adopting the architecture or executing later steps.

### 2 — Prove the WKWebView bundled application and bridge

Load the bundled UI and adapt its source transport contract to WKWebView.
Validate assets, SPA routes, storage, media, upload backpressure and sequential
keyboard input under concurrent streaming. Restrict the privileged bridge to
the owning bundled main frame/document. Measure WebKit byte transfers rather
than assuming equivalence to Android.

### 3 — Deliver native owner login and the complete iOS connection path

Implement full SRP/server proof, encrypted traffic, resume and deterministic
teardown against the disposable real YA server. Add direct and relay/mux
routes with existing legacy fallbacks, independent host ownership and bounded
requests/subscriptions/uploads. Credentials never enter JavaScript.

### 4 — Complete Apple lifecycle and mobile acceptance

Add Keychain-backed persistence, Switch Host, reauthentication and app
relaunch/suspension behavior. Run owned simulator tests and CI, then physical
phone/tablet checks, including real notifications. iOS suspension must not
pretend to provide Android foreground-service behavior. Sequential typing
must acknowledge every keystroke within 100 ms under expected concurrent load.

### 5 — Migrate Android after the core demonstrates parity

Replace Kotlin connection internals incrementally behind the current shell
and source bridge. Preserve stored profiles, wire fallbacks, ownership,
existing acceptance tests and measured interaction/upload performance. This
migration is not a prerequisite for the first iOS proof.

## Evidence

Step 1 is in progress. Rust adoption and steps 2–5 are not approved.
