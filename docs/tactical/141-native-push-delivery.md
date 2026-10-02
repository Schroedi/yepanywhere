# Native per-host push delivery

Status: implementing. Maintainer direction, 2026-10-02: finish native push
using the existing broker, commit verified slices, and prove real device delivery.

This continues [security-client registration](082-security-client-registration-and-native-push.md)
and follows [notifications](../../topics/notifications.md),
[native push](../../topics/android-fcm-push.md), and the
[security-client child contract](../../topics/security-client-audit.md#native-push-child-contract).
Limited-user login and new-client alert/dashboard work remain separate.

### 1 — enroll and deliver from YA servers

Implement the three approved native-push child routes with strict bounded
bodies, current native continuity ownership, owner-only persistence and public
secret redaction. Bind each send capability to the configured broker origin.
Connect generic delivery to the existing event policy; bound in-flight work,
disable invalid broker subscriptions and cascade client revocation.
Advertise the exact optional native-push capability and version descriptor only
with mounted support. Missing support disables enrollment without affecting SRP.

### 2 — enroll and present on Android

Add native per-profile enable, disable and test operations. Persist the opaque
subscription-to-profile binding before the server can send; compensate partial
enrollment and discard transferred send secrets. Render bounded generic messages,
resolve taps only through protected saved bindings, and resume before opening
the stored host/session. Permission, token rotation, forget and revocation must
remain independent of the WebView.

### 3 — enroll and present on iOS

Use the same optional server contract and broker capabilities with Keychain
bindings. Configure the Firebase iOS app and Apple push provisioning privately.
Complete permission, enrollment, generic presentation, safe host/session taps,
token replacement and disable/forget behavior; preserve foreground suspension.
Credential setup must not block deterministic implementation tests.

### 4 — prove device delivery and record release limits

Use disposable YA fixtures with the existing public broker. Prove explicit test
and actual event delivery in foreground/background, safe taps, two-host isolation,
disable, revocation and preserved credentials. Retire all temporary broker
capabilities. Run focused ownership/failure tests, required root checks, Android
release/lint/instrumentation and iOS native/simulator/device checks. Record exactly
which Apple provisioning and live-delivery gates passed; compilation is not push
acceptance. Repair build blockers needed to execute these tests as separate commits.
