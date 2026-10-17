# Android host scaffold evidence — 2026-10-17

This record covers the new `packages/android-host` scaffold, not acceptance of
a released Android host. The earlier independent feasibility repository proved
real Claude/Codex inference, arbitrary same-phone ADB via MCP, YA server/UI
hosting, and Codex's built-in shell with its extra Linux sandbox explicitly
disabled. Those results motivate this scaffold; they are not reclassified as
new-package inference/resume tests.

## Implemented and checked

- The root server/client/shared build produces one runtime bundle from this
  checkout. A common version is supplied to frontend/backend. Direct runtime
  dependencies follow the committed pnpm importer; an initially stale installed
  Claude SDK was detected and avoided. No SDK/provider protocol version changed.
- Eight SHA256-pinned base/CLI/native-library/notice artifacts and 96 signed,
  SHA256-pinned Alpine APKs form the ARM64 payload. Alpine verifies APK
  signatures offline. npm lifecycle scripts are disabled; a generated integrity
  lock and source/payload hashes are retained locally.
- Actual ARM64 Alpine Docker execution serves YA's frontend, reaches SQLite
  readiness, refuses anonymous API requests with 401, and returns disabled
  external process inventory. A project registered through YA's real API survives
  container restart. No real inference or subscription login is used by this test.
- Dedicated direct/AAR provider profiles remain separate. Tests exercise
  preservation of existing direct config, refusal of AAR endpoint substitution,
  absence of direct-mode gateway credentials, and disabled external observation.
- Android Debug and unsigned Release APKs build. Android lint passes without
  warnings. Narrow documented lint exclusions cover this deliberately ARM64-only
  payload and the explicitly requested battery exemption for uninterrupted
  user-started agent work; distribution eligibility is not established.
- On a physical Android 17/API 37 ARM64 handheld, the separate APK installs
  alongside the existing companion and original spike. Its own native Start
  control launches a real foreground service and Node under the ordinary app UID
  and untrusted-app SELinux domain, observed independently through ADB process
  inventory. The service reaches SQLite readiness and serves authenticated YA
  API responses. Anonymous access is refused, external inventory remains disabled,
  and a project is registered through the actual phone-hosted API.
- The saved project survives replacement of both the APK and runtime payload.
  Leaving the native UI also leaves the foreground service's API available.
  This is an immediate background check, not a screen-off or Doze endurance test.
- Physical Stop verification exposed that terminating only PRoot can leave Node
  running after the service disappears. The service now starts an owned process
  group, signals that group on Stop, and forcibly sweeps it after a bounded grace
  period. The repeated phone check verifies that Node/PRoot are gone, the API is
  closed, the foreground service is gone and saved state remains. This is not a
  real-provider interruption/resume test. The diagnostic forward is removed and
  USB-only debugging remains unchanged; the experimental host is left stopped.
- The native controls and existing YA frontend load on the phone. System insets
  are applied outside the WebView so its actual viewport excludes system bars.
  Visual checks are of the incubation controls/shared frontend, not approval of
  a complete guided onboarding or provider sign-in flow.
- The AAR development helper's setup/cleanup path is exercised with explicit
  existing subscription accounts, without launching an inference turn. Its
  temporary grant is revoked and 401 verified for both providers; its config,
  reverse tunnel and recovery lease are removed. Upstream OAuth remains on AAR.
- Root lint, format, typechecking and the full non-Android workspace unit suite
  pass. The suite exposed an unrelated real-Bubblewrap project-app test missing
  the availability gate used by neighboring native tests. A separate cleanup
  commit gates that scenario on actual sandbox support; route-only cases remain
  cross-platform and the native scenario remains on capable Linux.

## Evidence and remaining boundaries

Raw logs, screenshots, API witnesses, device identity, resolved npm lock and
runtime manifests remain under ignored `packages/android-host/.local/` and
`.tmp/android-host-checks/`. They contain private runtime details and do not ship
in Git. No provider secret, account id, real device selector or binary is tracked.

This is a manually provisioned Debug runtime with a native foreground service,
not a proof of Doze survival or a production packaging/update path. Direct
phone sign-in/refresh, real turn continuation after process death, same-phone
ADB registration in the new app, remote push wake, relay lifecycle, idle battery
behavior and store distribution remain open. Building unsigned Release alone
does not establish physical Release execution. Reading retained history is
not proof that a provider session resumed.

The Docker harness shares binaries, files and launch configuration, but it
neither runs PRoot nor simulates Android's kernel or service lifecycle. Its
restart persistence check is deliberately separate from physical Android
acceptance. See the [owning topic](../../topics/android-host.md) and
[development commands](../../packages/android-host/README.md).
