# iOS Native Shell And Shared Rust Connection Core

Topic: ios-native-core-proof

Status: direction accepted, 2026-10-01. Step 1's compatibility/build experiment
and engineering review are complete. The maintainer accepted the shared Rust
core and pinned SRP 0.7.0-rc.3, preserving the existing YA server protocol.
Production authentication and lifecycle gates remain before real credentials.
The production core and consumer iOS app are not yet implemented; the next
checkpoint is the bundled WKWebView and bridge proof. Android migration follows
shared-core parity.

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

## Accepted Ownership And Tools

| Layer | Proposed responsibility |
| --- | --- |
| Existing React UI | Application screens and source operations |
| YA Rust core | SRP, proofs, resume, secretbox, connections, relay mux, reconnect, bounded requests/subscriptions/uploads |
| Swift shell | Native login/hosts, Keychain, WKWebView bridge, Apple lifecycle and notifications |
| Kotlin shell | Android platform adapters, eventually calling the same core |

Selected tooling is pinned Rust/Cargo, UniFFI Swift/Kotlin bindings, XcodeGen
and xcodebuild, with cargo-ndk for later Android integration. Shared networking
would use Tokio, tokio-tungstenite and rustls with platform certificate
verification; network dependencies are outside step 1. Secretbox should use
libsodium through a reviewed safe wrapper around libsodium-sys-stable. Pin
the actual libsodium source as well as Cargo crates; never fetch unpinned
latest library sources during a build.

The accepted backend is pinned RustCrypto srp 0.7.0-rc.3, using crypto-bigint
arithmetic designed for constant-time use. Its version-specific README reports
no independent third-party SRP audit; the maintainer accepts that limit with
the production gates recorded below. SRP 0.6.0 remains a variable-time
num-bigint differential oracle, not a shipping dependency. Do not hand-write
SRP arithmetic. The accepted compatibility and secret-ownership contract now
lives in [mobile pairing](../../topics/mobile-server-pairing.md#ios-and-shared-rust-direction).
No server changes, password resets or credential re-enrollment are needed.

Sources: [UniFFI](https://mozilla.github.io/uniffi-rs/latest/),
[RustCrypto SRP status](https://github.com/RustCrypto/PAKEs/tree/master/srp),
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
background operation or release readiness. The maintainer reviewed the proof
and accepted the shared architecture and pinned backend on 2026-10-01.

### 2 — Prove the WKWebView bundled application and bridge

Create the consumer iOS SwiftUI/WKWebView shell, separate from the empty crypto
proof test host. Load the bundled UI and adapt its source transport contract
to WKWebView. Initially exercise the bridge with a deterministic native
SourceTransport test double, without borrowing web login or exporting keys.
Validate assets, SPA routes, storage, media, upload backpressure and sequential
keyboard input under concurrent streaming. Restrict the privileged bridge to
the owning bundled main frame/document. Measure WebKit byte transfers rather
than assuming equivalence to Android.

The checkpoint is a reproducible simulator test of the real bundled app:
source requests and subscriptions cross the native bridge, stale/foreign-frame
handles fail, streaming/uploads remain bounded, and each sequential keystroke
appears within 100 ms under expected volume. It is a bridge proof, not live
authentication. Avoid using the fixture verifier as a production login API.

### 3 — Deliver native owner login and the complete iOS connection path

Build the production Rust core with the pinned 0.7 backend and a reviewed
YA-profile adapter. First prove full SRP/server proof, encrypted requests and
subscriptions, resume and deterministic teardown on a direct connection to
the unchanged disposable YA server. Connect native Swift login and the
WKWebView bridge to that core. Add direct and relay/mux
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
migration is not a prerequisite for iOS or Android publication on their current
paths. It can begin once the iOS/Rust authentication, transport and lifecycle
checks pass; it does not require waiting for App Store publication.

## Current Checkpoint And Next Work

Step 1 is complete and accepted. Steps 2–5 are pending implementation.
Proceed iOS-first: Android already has the working native-login/bundled-web
path recorded in [tactical 083](083-android-bundled-web-native-transport.md),
while iOS has only the crypto test host. Migrating Android first would delay
proving the missing platform without delivering its application.

The next bounded slice is step 2's simulator-backed bundled WKWebView and
source bridge. Step 3 then replaces the test transport with the production
Rust core and delivers a live native login → web application → disconnect and
resume path against the existing server. Keep Kotlin as a working parity
reference and continue Android release acceptance independently. No protocol
migration is part of these slices.

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

### Accepted Checkpoint And Remaining Production Gates

Wire interoperability and native packaging are feasible; the maintainer has
accepted the shared Rust direction and pinned 0.7 backend. The production
adapter and session lifecycle still need the verification below. The 0.6
num-bigint backend is variable-time and cannot establish
secret erasure; do not adopt it for production from this experiment. The newer
0.7 prerelease uses arithmetic designed for constant-time use, but still
reports no independent SRP audit, and adapter conversions/secret handling need
review. Compatibility is not a whole-protocol constant-time or security claim.

Before real credentials, verify hostile-input handling, proof ordering,
randomness, secret lifetimes and live session teardown/retry. Acceptance of
the RC is not a whole-protocol security certification. The installed Android
app, server protocol, owner-only scope and deferred limited-user login remain
unchanged until their explicitly planned implementation work.

### Independent engineering review — 2026-10-01

At the maintainer's request, Daybreak Blue reviewed fixed commit
`a0a964f64f462bb13975a4a2dc9f9508c2097714` through the local YA API.
The resolved model was `gpt-daybreak-blue-latest`, effort high, permission mode
plan/read-only. Session `01a0f642-4d87-7c00-a069-db22a1ee3215` completed with
verified-idle liveness and no queued work. Its detached checkout remained
clean. The reviewer inspected source and pinned dependencies; it did not
rerun the recorded tests. This is an independent implementation-agent review,
not a formal independent cryptographic audit.

**Verdict:** the isolated compatibility/build proof is valid. No critical
finding invalidates it. Provisional development use of 0.7.0-rc.3 is reasonable
behind a reviewed YA adapter. The review's high-severity findings are
conditions for the future credential-bearing implementation, not deployed
vulnerabilities in this fixture-only crate. The review itself did not authorize
architecture adoption; the maintainer subsequently accepted the checkpoint.

The accepted checkpoint decision is adoption of the shared Rust core and
pinned 0.7 backend, with the credential-bearing gates below verified before
real use. A modern authentication-suite migration
can follow separately; it need not delay the initial mobile release.

The implementation agent checked the substantive findings against source and
classified them below. Existing owner authentication remains the principal;
this work introduces no new grant or authority boundary.

| Finding | Disposition and next verification |
| --- | --- |
| Low-level 0.7 hooks rely on caller validation | Before real credentials, put a bounded, fallible YA-profile parser ahead of arithmetic. Exercise public values 0/N/2N/N±1, oversized input, malformed hex, salt/proof limits and zero u through the complete adapter/FFI entry point. Preserve supported minimal encodings: odd-length hex such as `1` is valid in existing YA fixtures, not automatically an error. |
| 0.6 variable-time arithmetic | Keep only as a differential test oracle. Exclude 0.6 and num-bigint secret arithmetic from the shipping core. No specific remote timing exploit was demonstrated. |
| 0.7 adapter timing and secret lifetime | Use fixed-width secret exponents and OS-generated private values; inventory copies and zeroizing owners. The proof still converts secrets through BigUint and variable-time encodings. Crypto-bigint's optional zeroization support is not enabled, and enabling it alone would not clear every temporary on drop. Whole-protocol constant-time behavior and complete erasure remain unproved. |
| Authentication ordering | Before persisting keys or notifying callers of authentication, verify M2 and server metadata according to YA's existing authenticated-version and legacy-fallback policy. Tampered, missing or mismatched proof fields must never produce an authenticated session outside that policy. Preserve the ordering in `packages/client/src/lib/connection/SecureConnection.ts` and the Android core. |
| Entropy, nonces, resume and retry lifecycle | Fixed fixtures do not prove these. Add live disposable-server tests for failed RNG, cancellation/retry, fresh challenges, stale proofs and sequence handling. Prove Android execution before migrating Android; its native libraries have only been compiled. |
| Sodium FFI bounds | No memory-safety defect was identified in the proof calls. The current 64 KiB fixture cap bounds allocations; unchecked `message.len() + 16` is not an unbounded-input attack through this API. Production wrappers need checked arithmetic, frame limits and fixed-size key/nonce types. |
| Build provenance | Rust/libsodium pins are effective for this proof. Release CI should pin ambient tools and verify Gradle/dependency artifacts. The reviewer cited a nonexistent proof-local Gradle wrapper; the actual shared wrapper is `packages/android/gradle/wrapper/gradle-wrapper.properties`, which lacks `distributionSha256Sum`. This is release hardening, not a failed crypto/build experiment. |
| Offline guessing after verifier theft | Inherited protocol risk: YA's password-only SHA-512 profile has no memory-hard password KDF. A stolen salt/verifier permits offline guessing. Record this in any shipping risk decision; strong owner passwords and protected server storage matter. Rust adoption does not create or remove this property. |

"Needs review" therefore means assessing the exact library/adapter, verifying
the security-critical login lifecycle, and naming the risks the maintainer
accepts. Lack of a third-party audit does not establish a vulnerability or
automatically require commissioning an audit. Review dependency changes when
upgrading the pinned release candidate. Randomized differential tests,
hostile-input fuzzing and focused state-machine tests can extend the three
fixed transcripts without treating passing tests as a security certification.

### Possible later authentication-suite migration

Keeping SRP for compatibility while evaluating a newer PAKE is a reasonable
option. [OPAQUE, specified in RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html),
is a candidate, not a selected replacement or a prerequisite for the first
mobile release. Protocol age alone does not decide implementation safety.
The 0.6/0.7 numbers above identify library releases of the same SRP protocol.

A future `authSuite`/full-handshake version would be distinct from
`resumeProtocolVersion`, which versions proof and key-derivation semantics
for an existing credential. Authenticate the offered/selected suites and
identities, and retain an enrolled client's protection against silent
downgrade. A new protocol does not excuse incorrect validation, randomness,
proof ordering or storage in the current implementation.

The server stores an SRP salt/verifier, not the password. It cannot generally
convert that record into OPAQUE registration material. Migration requires
password re-entry/re-enrollment, or registration over an authenticated channel
during a successful full SRP login while the client still has the password.
A resume-only credential is insufficient. Select the OPAQUE configuration,
key stretching, libraries, browser/native interoperability, enrollment trust
and old-server transition policy in a separate reviewed migration plan.
