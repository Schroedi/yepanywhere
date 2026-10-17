# Yep Anywhere Android host (experimental)

A separate incubating Android application that hosts YA locally, like the
desktop application. The phone owns its agents, projects and sessions. Remote
access is optional future Android lifecycle work. This is separate from the
published remote companion at `../android` and the capture/control sidecar at
`../android-device-server`.

The owning [product/runtime contract](../../topics/android-host.md) distinguishes
implemented scaffold behavior, original feasibility evidence and remaining work.

## Layout

```text
app/        Java status/setup controls, foreground service and local WebView
runtime/    Shared startup/profile contract, Alpine package/artifact pins
tools/      Payload preparation, real Linux smoke, Android provisioning, AAR lease
test/       Portable profile/persistence-boundary checks (included in pnpm test)
.local/     Ignored downloads, generated bundle/locks, keys, state and evidence
```

There is one YA server/frontend build from this checkout, one Alpine payload,
and one runtime launcher. The Android service starts it through PRoot. Docker
runs that same filesystem natively as a non-root ARM64 Linux process; it does
not emulate Android. Ordinary UI/server development still uses `pnpm dev` and
the existing tests without Alpine or an emulator.

## Prepare and test without Android

Prerequisites: this checkout's installed pnpm dependencies, Python 3.11+, curl,
npm, and an available Docker engine supporting Linux ARM64. Preparing executes
the existing YA build and installs only public runtime dependencies with npm
lifecycle scripts disabled. It starts no provider inference or sign-in.

```sh
python3 packages/android-host/tools/host.py prepare
python3 packages/android-host/tools/host.py smoke
node --test packages/android-host/test/profile.test.mjs
```

`prepare --cache "$DOWNLOAD_CACHE"` can reuse previously downloaded files,
still checking every hash. `--skip-build` uses an existing `dist/npm-package`
from this checkout; rebuild it after server/client changes. No nested YA source
checkout or separately maintained server dependency list is used. Direct npm
versions come from the committed pnpm server importer, not potentially stale
host node_modules. The generated npm integrity lock is retained with the local
payload for repeat builds; it is regenerated when direct versions change.
`runtime-info.json` records source revision/dirty state, workspace lock hash,
npm lock hash and exported payload hash. Fully release-reproducible packaging
and lock publication remain future work.

The smoke creates an isolated mock-mode home, starts the actual server, checks
frontend/SQLite, requires HTTP 401 without the local credential, verifies
external process inventory is disabled, registers a project, restarts the
container, and verifies that registration survived. It removes its container
and temporary home on exit. Logs and evidence remain in `.local/`.

## Build and provision the experimental Android app

Prerequisites: JDK 17+ and Android SDK platform 36/build tools, with
`ANDROID_HOME` set. The Gradle entry point reuses the existing Android Gradle
wrapper. `prepare` supplies the hash-verified PRoot libraries and license assets.

```sh
packages/android-host/gradlew :app:assembleDebug :app:assembleRelease :app:lint
python3 packages/android-host/tools/host.py install --serial "$ANDROID_TEST_SERIAL"
python3 packages/android-host/tools/host.py stage --serial "$ANDROID_TEST_SERIAL"
```

The package id is `com.yepanywhere.host.experimental`; its launcher label is
**YA Host (Experimental)**. Open it, choose **Start local host**, then **Open
Yep Anywhere**. Closing the UI does not stop the service. **Stop local host**
stops the process tree while retaining app-private state. The service does not
automatically restart itself, arm ADB, or enroll push/remote access.

For a Codex session in the existing YA UI, choose **Full Access**: YA passes its
selected permission mode to app-server and can override the CLI profile's
sandbox default. The ordinary sandboxed modes still fail under PRoot. This does
not change Claude's permission defaults or silently override a chosen YA mode.

`stage` uses debug `run-as` only to provision the selected experimental app. It
stops that app and replaces `files/runtime`, retaining one previous root. It
never replaces `files/state`: native rollouts, YA SQLite, provider logins and
the local access credential live there. Runtime execution is owned by the app's
foreground service, not `run-as` or test instrumentation. An unsigned Release
APK is built for checks; store distribution is not configured.

The native controls are an incubation surface, not final onboarding. Notification
permission and the battery exemption are offered only through explicit actions.
Battery settings do not enable remote access or guarantee process survival.

Use **Set up Codex** or **Set up Claude** from the native controls to open the
shared focused sign-in page, then choose **Sign in**. These pages also work in
desktop/remote YA without navigating the long advanced provider settings list.
The actual CLI's output and errors stay visible. Provider links open the Android
browser; return to YA for Claude's authorization-code field. Codex uses device
code approval. Complete account authorization yourself in the provider browser.

The Android service mirrors the active network's DNS servers into Alpine while
it runs, including network changes. It does not force a public DNS service.
Encrypted DNS enforcement and unusual VPN DNS configurations need independent
validation; musl does not use Android's resolver automatically.

## Optional AAR development mode

This uses the existing computer router's **inference** listener through a scoped
USB reverse. Its private control socket remains on the computer. No global
phone configuration, provider OAuth store or host ADB private key is copied.
Direct and AAR provider homes are separate and persistent; switching mode does
not overwrite direct-provider sign-in.

```sh
python3 packages/android-host/tools/aar.py start \
  --serial "$ANDROID_TEST_SERIAL" --aar-checkout "$AAR_CHECKOUT" \
  --claude-account "$AAR_CLAUDE_ACCOUNT" --codex-account "$AAR_CODEX_ACCOUNT"
# Start the host from its launcher. No agent is launched merely by preparing AAR.

python3 packages/android-host/tools/aar.py stop --serial "$ANDROID_TEST_SERIAL"
```

Only a derived, revocable gateway grant is written to private `development.json`.
Its use in the provider API-key environment headers is a gateway launch/header
convention, not an upstream paid API credential; AAR supplies subscription OAuth.
The helper refuses existing development config/tunnels, stores a private recovery
lease, and revokes the grant before phone cleanup, verifying 401 for both
providers. A failed cleanup retains the lease for retry. It never enables TCP
adbd or modifies other device mappings. Use explicit enrolled subscription
accounts; leave real selectors and account ids outside Git. Stopping returns
future launches to direct mode. Phone-local direct subscription sign-in has
been completed and confirmed by the user for both Claude and Codex on the
Pixel 9; it does not require AAR or imported workstation credentials.

## Current boundaries

- ARM64 only, manually provisioned runtime. No first-launch downloader or updates.
- Runtime/foreground-service scaffold, not a background/Doze acceptance result.
- Existing full YA frontend is reused; no separate conversation UI.
- Focused subscription login works for both providers, confirmed by the user on
  the Pixel 9. Credential persistence across restart, refresh/sign-out, real
  session resume after process death, remote wake/relay lifecycle, same-phone
  ADB setup and agent MCP registration remain validation/integration work.
  ADB is in the payload but is not auto-started.
- External tracking/inventory is disabled. Native history discovery stays scoped
  to this app's own provider profiles; no external desktop histories are mounted.
- Downloaded Claude/native libraries retain their upstream terms and notices.
  Runtime preparation for development is not an approval to redistribute them.

See the [initial evidence record](../../docs/testing/android-host-scaffold-2026-10-17.md)
for exactly which checks have run.
