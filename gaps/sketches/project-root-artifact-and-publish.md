# A project's own app shows in-session; public serving is a manual Publish

User direction, 2026-09-28, prompted by an App canvas project whose limited
user saw no app: the preparation session served its starter only on a
loopback port for its own checks, so nothing registered an app and the
session's App action had nothing to open. A limited user is also refused app
links outright in v1 ([limited users](../../topics/limited-users.md)), so the
session page offers them none.

**In-session display comes from the project, not from a vhost.** Each
project, at least each project a template created, may carry one optional
root artifact, persistently associated with the project. It opens
automatically or toggles from the App action, and stays associated and
re-activatable after an intervening artifact such as a mockup takes the pane.
Automatic display is scoped to the principal it belongs to: shown when
logged in as that limited user (and to the superuser), without a public name.

**Hostname serving is an extraordinary manual step.** A project **Publish**
action adds a vhost entry for an untaken name, or updates one the same
limited user created earlier; it never takes over another principal's name,
and reservations stay first-come as in
[project templates](../../topics/project-templates.md#persistent-app-name-reservations).
A `username-project-name` form is an acceptable easy default. Entries are
private (bearer) by default, never public-vhost by default. Initially only the
superuser may publish. The right to publish is a per-limited-user setting,
which may further limit names to the `username-` prefix or allow any unused
name, and true vhost serving is enabled per project, subject to that setting.

**A sandboxed session cannot supply it.** With the network firewall the
session has its own loopback
([network boundary](../../topics/session-sandbox-network-boundary.md#network-enforcement)),
so a preview server it starts is unreachable from the host and from YA's
proxy, and the YA API is blocked on purpose. Observed 2026-09-28: archer's
session reported its preview as running at `http://127.0.0.1:3400`, which on
the host is YA itself, after its artifact grant failed. The root artifact must
therefore be YA serving the project's built output (for example `dist/`) or
another YA-side registration, not a sandbox process or an agent API call.

TBD: where the root artifact is recorded and how a template declares it; how
it relates to a registered entry-point list
([project app entry points](project-app-entry-points.md)); the Publish control's
placement; and how a limited user reaches a private app they own without the
general app-link route v1 refuses. Lifecycle rules stay with
[app lifecycle](app-lifecycle.md).

Found 2026-09-28 while fixing limited-user session lists and images.
