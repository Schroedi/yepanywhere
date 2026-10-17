# On-device Android host

Status: experimental scaffold in `packages/android-host`, authorized 2026-10-17.
This is an Android distribution of the YA host, separate during incubation from
the remote companion. It is not yet an independently usable released product.

## Product and ownership

The Android device owns real Claude Code and Codex processes, projects, native
session files, and YA storage. The existing YA server and web UI are shared with
desktop. Do not fork their conversation UI or agent harness. Use Alpine/PRoot
for the current runtime; native Android builds remain an optional later spike.
PRoot shares Android's kernel and grants neither root nor workspace isolation.
The explicit full-access Codex experiment is authorized; Android app confinement
remains while Codex's incompatible additional Linux sandbox is disabled.

Normal use should eventually require only the phone and internet. A desktop
helper may bootstrap/re-arm same-phone ADB after reboot. AAR is optional
development infrastructure, not a normal-use dependency or credential service
that ships by default. Provider authentication belongs on the phone eventually.

The existing YA sign-in panel has not been validated on this device and is not
the onboarding baseline. Future guided setup should draw on the demonstrated
Buddy and AAR experiences. First prove runtime install, supported subscription
login, credential persistence/refresh and a real agent task; polish follows.

## Implemented scaffold contracts

- A separate application id coexists with the existing companion and original
  feasibility APK. No existing app data or radio/debugging setup is replaced.
- One verified Alpine payload serves Android and Linux tests. YA is built from
  this checkout, with source and dependency identity recorded in the payload.
- Android explicitly starts a visible foreground service. That service owns the
  runtime process tree independently of either activity. Stop keeps durable
  state and signals the runtime's dedicated process group, with a forced sweep
  after two seconds. Killing only the PRoot tracer is insufficient. This bounded
  stop does not promise a live provider turn has checkpointed. No boot receiver,
  restart loop or remote push wake is installed.
- The runtime binds only loopback. A private persistent local access token uses
  YA's existing desktop-token API/WebSocket mechanism; anonymous API requests
  cannot access the host. The scaffold does not use `AUTH_DISABLED=true`.
- Android supplies the guest's DNS configuration from its active network's
  advertised DNS servers. The service owns one network callback, updates the
  bound resolver file in place on network changes, and unregisters on Stop.
  There is no hard-coded public resolver fallback. Docker's empty exported
  resolver cannot establish phone networking. This does not implement Android's
  DNS-over-TLS policy inside musl; strict encrypted-DNS-only networks still need
  separate validation.
- Provider profiles, YA data, local credentials and development config are under
  the app-private persistent home, separate from the replaceable runtime. Direct,
  AAR and mock profiles remain separate. Existing direct Codex config wins over
  initialization defaults; changed AAR endpoints require explicit review.
- `YEP_EXTERNAL_SESSIONS=false` disables `ExternalSessionTracker` and prevents
  host process inventory even if editable settings enable it. Ordinary server
  deployments retain their previous default (`true`). The Android runtime also
  supplies only its own provider homes and enables only Claude/Codex. No
  workstation home, Claude Desktop store, or unrelated provider history is
  mounted or imported. Reading/indexing this host's own native transcripts for
  history and resume remains necessary; this flag does not disable that path.
- Permission actions are contextual and explicit. Notification state and battery
  optimization state are visible. Battery exemption supports continuing active
  sessions; it does not authorize remote access or promise unlimited execution.
- Native Set up Claude/Codex controls open the shared focused YA provider sign-in
  page. User-initiated HTTPS new-window links open the Android browser, with no
  privileged JS bridge or external access to local host credentials. Actual
  account authorization remains an explicit browser step by the user.
- AAR development setup creates an account-scoped temporary grant and USB
  inference tunnel. Upstream OAuth and router control stay on the computer.
  Cleanup revokes first and retains a local recovery lease on failure.

These are operator/runtime boundaries, not a new universal identity/grant
protocol. Local app access reuses the existing owner credential mechanism;
future remote access must use existing pairing/authentication and remain
explicitly opt-in. Push may request a wake, never carry arbitrary shell commands
or replace relay authentication. See [principals and grants](principals-and-grants.md)
and [native push](android-fcm-push.md).

## Test boundary

Portable unit checks protect configuration/persistence decisions. The real ARM64
Alpine Docker harness tests the same server/runtime payload, protected API,
SQLite and restart persistence without an emulator or real inference. It does
not test Android, PRoot or Doze. Keep ordinary server/UI checks in their existing
test suites rather than duplicating them under Android.

Physical tests must establish native app identity, service ownership, UI-close
survival, screen-off/Doze behavior, process termination and actual provider
resume. A container restart or retained transcript display is not a resume test.
Recovery of a host after reboot must distinguish server readiness from ADB
readiness; a push cannot re-arm TCP adbd after reboot.

## Next incubation milestones

1. Finish the service lifecycle on the physical phone, including safe shutdown,
   process-death recovery and real provider resume.
2. Use AAR for repeatable development turns; independently prove phone-local
   subscription sign-in/refresh without importing host credentials.
3. Integrate the already-demonstrated same-phone ADB bridge behind explicit
   setup/readiness and the app's own ADB key.
4. Test screen-off work and bounded idle resource use, with no external desktop
   observers. Optional remote wake/relay reconnection follows that baseline.

See [package development commands](../packages/android-host/README.md) and the
[dated scaffold evidence](../docs/testing/android-host-scaffold-2026-10-17.md).
