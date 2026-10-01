# iOS Native Shell And Provisional Rust Connection Core

Topic: ios-native-core-proof

Status: provisional, 2026-10-01. Step 1's compatibility/build experiment
passes; the shipping SRP library and Rust adoption await maintainer review.
The maintainer authorized recording this
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

### Crypto and binding results — 2026-10-01

The isolated [proof crate](../../packages/mobile-core-proof/README.md) has no
production app dependents. The original TypeScript/Kotlin fixture remains
byte-for-byte unchanged and its production generator check passes. Two extra
production-generated fixtures cover a Unicode password with minimal A/salt
and a leading-zero M1. They catch the padding and integer-encoding differences
that a single full-width transcript would miss.

RustCrypto srp 0.6.0 and 0.7.0-rc.3 both match A, x, verifier, k, padded u,
client/server S, server B, M1 and M2 without replacing their modular arithmetic.
YA's existing password-only hash and minimal M1/M2 encoding require an adapter;
neither candidate's high-level login API is a drop-in implementation.

Each of the three fixtures passes 27 compatibility properties and 17 rejection
checks. Generated Kotlin/JVM and host Swift bindings execute these same checks
and reject externally corrupted M2 and malformed JSON through typed errors.
Rust's three tests and all-feature Clippy pass. This is fixture compatibility,
not a live YA handshake or a protocol/session security assessment.

### Native packaging results — 2026-10-01

| Gate | Actual evidence |
| --- | --- |
| iOS simulator execution | Owned iPhone 17, iOS 26.5; two XCTest cases pass with zero failures through generated Swift bindings, including all three fixtures |
| iOS device build | arm64 Rust static library and unsigned Release app link successfully; no physical-device execution or signing claimed |
| iOS runtime linkage | Both app executables define the Rust proof entry point and have no Rust dylib dependency |
| Android compilation | cargo-ndk produces arm64-v8a and x86_64 libraries at API 26; no Android instrumentation claimed |
| Dependency advisory check | cargo audit reports no advisories in the final 146-dependency lockfile; this does not audit SRP or native libsodium |
| Repository checks | Root lint, format check, typecheck and all non-Android unit suites pass |
| Cleanup | Owned simulator shut down and deleted; generated bindings/build output remain ignored |

Final uncompressed sizes, including both SRP candidates and fixture harness
code rather than a selected shipping core:

| Artifact | Bytes |
| --- | ---: |
| iOS simulator static archive | 20,128,192 |
| iOS device static archive | 20,142,008 |
| Simulator statically linked app executable | 879,384 |
| Device statically linked app executable | 888,432 |
| Android arm64-v8a shared library | 918,928 |
| Android x86_64 shared library | 912,984 |

Static archives include object metadata/debug information; their sizes are not
installed app costs. Linked executable sizes include the empty SwiftUI test
host and generated bindings; no full YA app or APK size delta is established.

Tool versions: Rust 1.97.0; UniFFI 0.32.2; srp 0.6.0 and 0.7.0-rc.3;
crypto-bigint 0.7.5; libsodium-sys-stable 1.24.0 with hash/signature-verified
libsodium 1.0.22-stable source; Xcode 26.6 (17F113), Swift 5.10 language mode;
XcodeGen 2.45.3; Kotlin 2.0.21/JNA 5.17.0; Gradle 8.13; cargo-ndk 4.1.2;
Android NDK 27.0.12077973; Node 24.19.0 for fixture/check commands.

Reproduce from packages/mobile-core-proof with `node scripts/run.mjs all`.
The final local xcresult is ignored build/ios-1790836988462.xcresult. The runner
chooses an available runtime and creates/deletes its own simulator, so the
result filename and runtime may differ on another host. Linux/Windows, Intel
iOS simulator execution, physical iOS and Android execution remain unproved.

The first simulator build exposed Release @testable-import configuration and
an unbundled dylib chosen by `-l` over a colocated archive. The harness now uses
the public API and explicit static archive paths, then verifies final Mach-O
symbols/dependencies. Final platform compiler checks emit no warnings. The
repository unit run includes expected application warning logs from negative
fixtures; the touched native checks produce no runtime/compiler warnings.

### Decision still required

Wire interoperability and native packaging are feasible. This supports Rust
as an architectural option but does not approve it or select a shipping SRP
dependency. The 0.6 num-bigint backend is variable-time and cannot establish
secret erasure; do not adopt it for production from this experiment. The newer
0.7 prerelease uses arithmetic designed for constant-time use, but still
reports no independent SRP audit, and adapter conversions/secret handling need
review. Compatibility is not a whole-protocol constant-time or security claim.

Before real credentials or step 2, review whether to adopt a shared Rust core
and which backend is acceptable. The installed Android app, server protocol,
owner-only release scope and deferred limited-user login are unchanged.
Rust adoption and steps 2–5 remain unapproved.
