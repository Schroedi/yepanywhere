# Yep Anywhere iOS

Consumer SwiftUI shell with native owner SRP login and protected saved hosts.
The foreground application is the existing bundled React UI in WKWebView.
The shared [Rust core](../mobile-core/README.md) owns authentication, encryption,
requests, subscriptions, uploads and reconnect. JavaScript receives a
source-scoped document handle; it receives no password or resume/transport key.

## Build and verify

Use Apple Silicon macOS, Xcode with an installed iOS simulator runtime,
XcodeGen 2.45.3, Node 24 LTS, pnpm and the pinned Rust 1.97.0 toolchain.
The application requires iOS 17 or later, allowing separate persistent WebKit
stores for each native profile. It supports iPhone and iPad.

```sh
pnpm install --frozen-lockfile
rustup target add --toolchain 1.97.0 aarch64-apple-ios aarch64-apple-ios-sim
node packages/mobile-core/scripts/run.mjs rust
node packages/mobile-core/scripts/live.mjs
pnpm exec tsx --conditions source packages/mobile-core/scripts/live-relay.ts
node packages/ios/scripts/run.mjs test
node packages/ios/scripts/run.mjs build
```

`prepare` generates the simulator archive, Swift bindings, bundled assets and
Xcode project without running tests. `test` builds these inputs, starts an
unchanged disposable YA server with public fixture credentials, creates its
own simulator after compiling the test bundle, ad-hoc signs the app for
Keychain access, runs XCTest/XCUITest without rebuilding,
adds an ephemeral root only to that simulator for TLS trust/hostname/expiry
checks, and shuts down/deletes the owned simulator and servers. Parallel simulator
cloning is disabled, and Xcode compilation uses at most four host CPU slots.
Host CPU/memory/swap samples are recorded before, during and after execution
in build/host-*.json; compilation does not overlap simulator measurement.
Hosted native tests run first. UI acceptance then requires two consecutive
host samples with at least 20% CPU idle and 1 GiB available memory. First-use
simulator services have up to five minutes to settle; inadequate headroom
fails readiness without skipping or relaxing the 100 ms input gate.
`build` links an unsigned Release device application;
it does not install, sign for distribution or publish it. Generated projects,
bindings, archives, fixture data and xcresults remain ignored under build/.

The [iOS CI workflow](../../.github/workflows/ios-app-ci.yml) runs Rust checks,
direct/mux/legacy live probes, simulator acceptance and unsigned device linking.
It pins XcodeGen by version and archive SHA-256, Cargo through its lockfile,
libsodium by source hash/signature, and Firebase Messaging through the exact
SPM version and checked-in Package.resolved. It uses the standard arm64
[macOS 26 runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners);
the ambient Apple SDK/runtime is recorded by the build rather than bundled.

## Native storage and lifecycle

One atomic Keychain item owns the host catalog and resume credentials. Writes
read the current protected state; locked/unavailable storage cannot become an
empty catalog and overwrite saved hosts. Passwords are not persisted. Items
use WhenUnlockedThisDeviceOnly and disable synchronization. Continuity keys
are per-profile P-256 SecKey items; this is software Keychain storage, not a
Secure Enclave or attestation claim. Security-client registration/check-in uses
the unchanged capability-gated server contract and native transport context.

A selected host resumes automatically at launch. Each profile has its own
persistent WebKit store and saved application route; React owns draft storage.
Backgrounding immediately closes its native source and flushes the document's
existing pagehide draft handler before reconstruction. Foreground activation
resumes and checks continuity before handing a fresh document its source.
Switch Host retires the foreground connection and opens the native host list.
Forget first revokes the registered security client on supported servers,
recovering an interrupted registration with the same installation/request/key.
It then atomically tombstones the profile and removes its resume credential
before deleting the route, continuity key and WebKit data. Failed local cleanup
remains retryable and cannot resume. An unreachable server requires the explicit
Forget Anyway choice; local deletion cannot claim remote revocation.

Data frames are bounded to 64 KiB chunks, 32 MiB messages and 64 MiB queued
bytes, with stop-and-wait acknowledgement and a bounded operation count.
Native queue pressure suspends producers rather than dropping a healthy feed.
Incoming data yields a WebKit paint slot between fragments; controls remain
immediate. Upload acknowledgement follows native consumption. Replacement
navigation, renderer termination and host changes retire the document lease.
The privileged bundled document forbids embedded frames with a fail-closed
CSP. Frame checks alone are not claimed to distinguish same-origin parent
proxying. Embedded HTML/app frames therefore remain unavailable in this
initial shell; a later unprivileged viewer needs its own boundary. Blob download
navigation also needs a native download adapter before that action is supported.
Speech and device-stream transports retain the native adapter's existing unsupported
fallback, shared with the current Android foreground contract.

## Optional notification configuration

The unconfigured application reports push as unavailable. To configure FCM,
provide private `Config/GoogleService-Info.plist` matching the bundle identifier.
The generated project includes it and enables App/Push.entitlements only when
that file exists. Debug uses development APNs; Release uses production APNs.
An optional ignored `Config/Signing.xcconfig` can provide DEVELOPMENT_TEAM,
PRODUCT_BUNDLE_IDENTIFIER and provisioning settings. Neither private file
belongs in Git. Push capabilities and provisioning must agree in the Apple
Developer account; the build runner's unsigned device check does not prove them.

The native adapter owns OS permission, APNs-to-FCM registration, serialized
FCM-token rotation, bounded HTTPS broker calls and protected management secrets.
Notification payloads can select only a protected opaque subscription binding;
they cannot select a URL or credentials. Per-server native push enrollment is
still pending in the shared YA/Android plan, so installation registration alone
never reports notificationsEnabled. Live APNs/FCM delivery, physical phone/tablet
acceptance, App Store/TestFlight provisioning and publication remain release
gates. Limited-user login and Android's Rust migration remain deferred.

CI pins macOS 15 / Xcode 26.3 with its installed iOS 18.6 runtime. The
standard 3-core / 7 GiB macOS 26 host remained saturated throughout the
5-minute readiness window while its fresh iOS 26.5 widgets and indexing
services ran ([run 36887820073](https://github.com/kzahel/yepanywhere/actions/runs/36887820073)).
Only the disposable CI VM disables Spotlight indexing. Local runs use the
newest installed iOS runtime; `YA_IOS_SIMULATOR_VERSION=18.6` selects that
exact installed version and fails if unavailable. Device selection respects
the runtime's supported device types. Both paths retain the same 18 tests,
CPU/memory headroom requirement and 100 ms typing ceiling. Simulator
compilation targets arm64, matching the shared Rust simulator framework.
