# Bundled app WebViews connect with the native resume credential

Status: decided direction, not implemented. Maintainer-directed, 2026-10-07.
Contract and security rationale:
[mobile-server-pairing § Decided replacement](../../topics/mobile-server-pairing.md#decided-replacement-shared-resume-credential-2026-10-07).

## Purpose

Today the bundled Android and iOS WebViews send all API, subscription and
upload traffic through the native transport bridge (`window.yaNativeTransport`,
client `NativeSourceTransport`). That gives the WebView a second connection
state machine. Its reconnect behavior diverges from the web transport; see
[the fake 503 gap](../android-native-unavailable-fake-503.md). Instead, native
hands the WebView the profile's existing SRP resume credential, and the WebView
connects through the ordinary web secure transport, resuming that same server
session.

Hard requirement: the user is never prompted for a password again. A rejected
resume asks native to reauthenticate, which returns a fresh credential. The
WebView never navigates to web login.

The server needs no change. Resume is a per-connection challenge proof against
a stable stored key, and concurrent connections already share one session.

## Design constraints found while sizing

- **Bundled-only check inside the handler.** Android installs `window.yaNative`
  for every document, including hosted-`latest`, whose allowed origin is
  `config.origin` (`WebClientActivity.kt`, `installNativeHost`). The credential
  operation must itself require `config.bundled` and an active profile. The
  channel's existence is not a gate. A debug URL override already clears
  `bundled`. iOS accepts control messages only from `yepapp://bundle`.
- **Memory only.** All Android tabs share one WebView origin and storage, and
  the web client keeps one credential under `yep-anywhere-remote-credentials`.
  In app mode, never call `saveCredentials`, `updateStoredSession`,
  `upsertRelayHost` or `clearStaleResumeSession` for the credential. Fetch it
  from native on every document boot.
- **Read the live credential.** Native clears its stored credential while
  resuming (`YaRustProfileConnector.kt`, Rust `session.rs`). Serve the
  in-memory session (`credential_data()`), or wait for the resume to finish.
- **Relay URL rewrite.** In relay mode the web client redirects
  `/projects/...` to `/-/relay/<user>/...` (`RemoteApp.tsx`,
  `remoteRoutePaths.ts`). Native tab paths, push-destination checks and iOS
  route storage assume `/projects/...`, so app mode suppresses that rewrite.
- **Mount before connect.** The bridge mounts the page before connecting (the
  offline cold-entry contract in mobile-server-pairing). `ConnectionGate`
  mounts routes only after the first connect, so app mode must keep the
  mount-first behavior.
- **Route order.** Native orders routes preferred-first, then direct before
  relay. Add a small ordered-route resume loop (about 40 lines) rather than
  handing over a single URL.
- **Security posture.** The WebView becomes an ordinary browser connection on
  native's session, without per-connection device-key verification, and it
  appears among connected browsers. Revoking native invalidates the session,
  which the WebView sees as a rejected resume.
- **Cleartext in tests.** The page loads over HTTPS with mixed content
  forbidden, so the WebView cannot open `ws://`. Release builds already require
  TLS. Debug instrumentation and the live probes need a TLS test server.
- **Background socket.** `ConnectionManager` does not close a hidden socket;
  native used to release the lease on background. Measure the battery effect.
- **Gains.** Speech, device signaling and the live tool-output preference work
  in the app. Implementing this closes
  `gaps/native-bridges-drop-live-tool-output-preference.md`.

## Landing sequence

Web assets ship inside the APK/IPA with native, so versions never drift. The
"flag" is which control-plane features native advertises in `host.describe`.
Every step leaves the app working.

1. **Client app-credential mode.** Extend `src/lib/nativeHost.ts`, which
   currently has no production caller, with `session.credential`
   (`{profileId, label, username, sessionId, sessionKey, resumeProtocolVersion,
   routes[], preferredRouteId}`), `session.reauthenticate` (long timeout) and
   `host.switch`. In `RemoteConnectionContext`, add a credential source that
   reuses the auto-resume path, either relay (`openRelayClientSocket` and
   `SecureConnection.forResumeOnlyWithSocket`) or direct
   (`SecureConnection.forResumeOnly`), and never persists. Add the ordered-route
   loop. Route `requiresResumeLogin` to `session.reauthenticate`. Suppress the
   relay rewrite and mount before connect. Keep the source key
   `native:<profileId>` so source-keyed drafts and caches survive. Choose this
   mode only when `host.describe` advertises `session.credential`; otherwise
   keep the bridge and then the plain web path. The mode is inert on current
   native builds. Add unit tests for `nativeHost`, and a native-mode test for
   the connection context.
2. **Android operations behind a toggle.** Implement the three operations in
   `WebClientActivity`'s native-host handler: bundled-only, bound to
   `activeProfileId`, and served from the live credential. Reauthenticate shows
   native sign-in and then supplies the credential, or remounts the document.
   Host switch calls `showHostManagement()`. Advertise them only behind a
   debug/BuildConfig toggle, off by default. Add a TLS test server and
   instrumentation for the new mode. Android compiles and unit-tests locally
   (`/local/graehl/android-sdk`, `./gradlew test`). Instrumented tests need an
   emulator.
3. **iOS operations behind a toggle.** Do the same in `NativeBridge.swift`'s
   control channel and `HostModel.show`. Keep `security.ensure` and push
   registration on a short native session, then hand over the credential. iOS
   builds only in `ios-app-ci.yml`.
4. **Switch the default.** Advertise `session.credential` and stop installing
   `yaNativeTransport` (Android `WebClientActivity`, iOS `NativeBridge`).
   Rewrite `e2e/native-webview.spec.ts` to fake only `window.yaNative`, handing
   over a real server session. It asserts sequential typing, no persisted
   credential, and a reauthentication request on rejection. Rewrite the
   Android `YaNativeWebAppInstrumentedTest`, the iOS live tests and
   `scripts/live-transport.ts`. Update the `android-app-ci.yml` path filters.
   Close the fake-503 and tool-output gaps.
5. **Delete the bridge.**
   - Client: `nativeTransportBridge.ts`, `NativeSourceTransport.ts`,
     `NativeConnectionProvider.tsx` and their tests.
   - Android: `YaNativeTransportHost`, `YaWebTransportSession`,
     `NativeTransportFrames` and `NativeTransportMetrics`.
   - iOS: the source channel, `NativeFrames.swift` and `RustSource.swift`.
   - In a separate commit, remove upload support that only the WebView used
     (Kotlin manager/connector, Rust `runtime.rs`/`session.rs`/`events.rs`).
     Keep the Rust lease model; native push, host management and the planned
     foreground service still use it.
   - Pin the last revision that contains the bridge.
6. **Docs.** In `topics/mobile-server-pairing.md`:
   - Bundled Web Client Transport becomes the shared-credential contract.
   - Implemented bridge contract becomes a retired-design record pinned to the
     revision from step 5, so the bridge can be revived if a credential-free
     WebView becomes a requirement.
   - Update the tab-lease and offline-entry wording.

   Also update:
   - `topics/trusted-client-packaging.md`, `topics/security-client-audit.md`
     (the WebView is an unverified browser on a native session),
     `topics/client-source-runtime-topology.md` and
     `topics/active-content-security.md`;
   - tacticals 080, 081, 083, 084, 138, 139 and 146;
   - `docs/project/mobile-companion-app.md`, `docs/roadmap/README.md` and
     `ARCHITECTURE.md`.

Estimated size: about 3,000–3,500 lines deleted and 1,000–1,400 added or
rewritten across 25–30 files, ±30%.
