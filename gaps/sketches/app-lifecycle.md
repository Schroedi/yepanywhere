# Define a managed app lifecycle alongside artifact grants

Use the artifact lifecycle as a reference for app lifetime, expiry, revocation,
and owner controls. Keep authorization lifetime distinct from process lifetime:
revoking a bearer blocks access; stopping an app signals its identified
listener; temporarily dismissing its pane does neither.

Initially, app lifecycle actions must **never delete working data**. YA does
not know a proxied app's working dataset or own its directories. Artifact grants
have an explicit ownership/deletion contract; do not infer that contract from
an app URL, process cwd, executable location, or vhost port.

Plan how Apps settings presents active/stopped apps, expiry, bearer revocation,
and process-stop results. Persist authorization/lifecycle state across YA
restart, while clearly distinguishing an independently exited app from an
expired or revoked link. Automatic process restart is a separate future policy.

Project-owned services now have the explicit start/stop, retained state and
private-broker delivery contract in [project service](../../topics/project-service.md).
They are independent of provider sessions, but stop with YA. The remaining
optional persistence direction is to host the runner in the provider-host
process, or another YA-owned supervisor, so a live app can survive YA server
restart. Reconnect only to an authenticated owned generation; never adopt a
PID or listener merely because it matches a persisted record. Until then,
YA reports interruption and requires explicit Start. This preserves the
nonessential persistence follow-up from the retired root-artifact sketch.

See [session right pane](../../topics/session-right-pane.md),
[access control](../app-artifact-access-control.md),
[restart durability](../../topics/active-content-security.md#private-app-links), and
[artifact lifecycle](../../topics/active-content-security.md).

Found 2026-09-16 while adding explicit Kill app controls.
