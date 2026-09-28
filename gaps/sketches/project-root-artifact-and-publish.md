# A project's own app shows in-session; public serving is a manual Publish

The selected declaration, main-pane project UI, Settings placement and
audit-preserving removal are now specified in
[project service](../../topics/project-service.md). It refines this direction;
the runner and no-vhost delivery remain unimplemented. The session broker
implementation described below is separate evidence.

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
YA serves it, and proxies an app or artifact that a sandboxed session or the
project's sandboxed app process serves, through to that logged-in principal
over whatever carries their YA login, localhost or relay, with no vhost
entry and no Publish (see the sandboxed serving section below).

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

**The served app runs sandboxed, and YA's proxy reaches it there.** User
direction, 2026-09-28: running a vhost-served app inside the project sandbox
is the more secure arrangement, and a specific hole the YA server proxies is
acceptable. Observed 2026-09-28: archer's session reported its preview at
`http://127.0.0.1:3400`, which on the host is YA itself, because its loopback
is private to the firewall's namespace.

Implemented 2026-09-28, the session half:

- A firewalled launch runs a port broker inside the sandbox's network
  namespace that only YA can reach
  ([network boundary § Inbound](../../topics/session-sandbox-network-boundary.md#inbound-the-loopback-port-broker)),
  so a server the session binds on loopback is reachable without a host
  port or a firewall change.
- A loopback URL in such a session's tool output becomes a private minted
  app host shown to the logged-in principal, a limited user included,
  locally or through the public root
  ([sandboxed session apps](../../topics/session-right-pane.md#sandboxed-session-apps)).
- Files and interactive previews a sandboxed session writes under its private
  `/tmp` are read as the session sees them through session-scoped doors
  ([session sandboxing](../../topics/session-sandboxing.md)); the client's use
  of those doors waits on a capability.

Still sketch:

- **A YA-owned app runner** so the project's app survives provider restarts
  and idle shutdown (user-directed, not essential): YA starts the project's
  serve command in its own instance of the project sandbox, not as a child of
  the session, and reaches it through the same broker; hosted in the
  provider-host process where possible so it can also outlive a YA server
  restart. A sandboxed session cannot launch a user service or other escape
  (the private `/run` and IPC unsharing deny it), so persistence has to be
  YA's. Static output (for example `dist/`) may instead be served by YA with
  no process at all. Stopped through [app lifecycle](app-lifecycle.md).
- **The persistent root artifact record**: where it lives, how a template
  declares its serve command or static root, and how it relates to a
  registered entry-point list
  ([project app entry points](project-app-entry-points.md)).
- **Publish**, above, built on the runner, including the Publish control's
  placement.

Found 2026-09-28 while fixing limited-user session lists and images.
