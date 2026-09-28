# Project service

> A project service declares where a project's app lives and how YA starts,
> checks, stops and serves it, independently of an agent session or an optional
> reserved hostname.

Topic: project-service

Status: **Project App, service lifecycle and project address settings implemented.**
The App entry works in direct and relay clients, with separately admitted
service and reservation APIs. The sandbox runner serializes lifecycle actions,
checks readiness through its private broker and reports interrupted state after
restart without adopting a PID. Desktop/phone browser checks cover the main
viewer, composer handoff, retained canvas/draft and simulated viewport shrink.
Native tablet keyboard acceptance remains in the linked keyboard gap.
User-directed scope, 2026-09-28:
project App access for limited users and the superuser, standardized template
service declarations, optional vhost association, and audit-preserving removal.
The [template integration gap](../gaps/project-template-standup.md) tracks
delivery. This topic refines the
[root-artifact and Publish direction](../gaps/sketches/project-root-artifact-and-publish.md);
the interactive fixture is `packages/client/mockups/project-service/`.

## Project App and Settings

Projects offers **Open app**, opening the main content pane with the same
isolated rendering and viewer controls as the session's right App pane. It
does not require opening or retaining an agent session. Keep the card's
existing session navigation and gear action. Project Settings contains **App**
and, only when server vhost serving is enabled, **App address**. Both principal
kinds use this surface; authorization determines the available actions.

Resolve the default target on entry in this order:

1. A declared project service or static app. A stopped or failed service shows
   its state and an authorized Start or Retry action, rather than silently
   substituting another artifact or starting a process on a GET.
2. Otherwise, the most recently associated artifact the principal may access.
   Use server-recorded association order, not file mtime or whichever session
   was last opened. Session-published artifacts name their canonical project
   and source session; authorization is rechecked at association and open.
3. With neither, show “No app or artifact yet” and the existing session action.

When both exist, offer **App / Latest artifact**; default to App. Keep a viewed
artifact stable while newer ones arrive and offer the new association without
replacing the iframe during interaction. Store the artifact identity, entry,
source session and association time in YA app data, never just a bearer URL.
Mint a fresh scoped viewing grant on an authorized open. Expired grants can be
renewed; missing files or a vanished session-private filesystem are explicitly
unavailable. Association does not imply copying an ephemeral artifact forever.

The project **App** entry opens the viewer itself, filling the available
main-pane height. Reuse the in-session right pane's thin top band, shared
viewer header, icon-button sizes, title truncation and window actions. Do not
surround it with a project header, inset card, margins or a second status band.
Back, Reload, Open in new tab and Copy link retain their viewer treatment;
add New session, Share, Settings and the microphone in that same top band.
New tab, Back, new session and mic are direct icon actions with accessible
labels. Keep the icon band thin, truncating its title when space is tight;
service details stay in Settings.
Closing it changes navigation only. Stop is a separate service control in
Settings. Use the existing iframe sandbox, credential
separation, and safe new-tab behavior in [active-content security](active-content-security.md).
App content never shares the authenticated YA origin. On phones the viewer
fills the main pane; Settings is a separate full-width view.

A session in a project that declares an app offers the same **App** toggle in
its header even when it was not opened from the project App entry; it starts
closed and opens this viewer in the right pane.

**New session** creates one session in this project using the user's normal
provider/model defaults and enforced locks, with the viewed app already open
in its full-height right pane when the viewport has room. The microphone is
on the app viewer's thin top bar, both in the project App view and when the app
is in-session. It delegates to the usual composer speech transaction; it is
not a separate recording form, modal, transcript buffer or send policy. From
the project App entry it establishes one new project-session context and
starts that composer's voice flow. Once in-session, it controls that same
composer rather than creating another session on each press. It does not
submit an empty turn or send speech before the ordinary voice/send policy
allows it. Request microphone permission through the existing flow; denial
leaves a usable text composer and the app. Guard duplicate taps and carry a
stable target identity, renewing its viewer grant rather than copying a stale
URL. This explicit action authorizes the pane opening for the new session
without changing the user's global right-pane preference.

Preserve the selected STT backend and all current
[composer speech behavior](mic-button-speech-ui.md), including Grok Smart Turn
when enabled, command handling, speech insertion, manual-edit holds, grace
windows and follow-up listening. Do not force manual Send as part of the App
entry. Both mic affordances reflect one capture state and stop the same
transaction. Speech startup does not require summoning the software keyboard.

Small phones normally have no simultaneous pane layout: App is full-screen,
and the conversation/composer is a separate full-screen surface. Switching
between them preserves the app and draft; it does not leave a shrunken app
card or a sliver of conversation. The app top bar retains recording/stop
access while its session is listening. Tablets may use the ordinary
full-height side-by-side viewer when space permits; native keyboard behavior
must not be presented as a guarantee of a keyboard confined to the session
column.

Canvas sizing under temporary keyboard occlusion and preserving the current
composer-adjacent session content are tracked in the
[keyboard-awareness gap](../gaps/sketches/keyboard-aware-app-and-session-viewport.md).

**Copy link** copies an authorized, current viewer link; it does not publish
or reserve anything. Explain when that link grants transferable access and
when it expires. **Share** offers existing public-audience artifact sharing
when this target, server and principal support it, without requiring a vhost.
For a service, it may offer reservation and serving through enabled vhosts,
subject to publication authority and the private-apps ceiling. Show an existing
association first. Opening Share alone has no side effects; confirm the
intended access before creating a grant or publishing. Publicly reachable
artifact bearer links remain link-required access, distinct from the vhost
“Public — no link required” option. With neither delivery option available,
explain that sharing is unavailable rather than sending unsupported requests.

## Standard declaration: where, start, status, stop, serving

Templates keep `.project-template/app.json` as their source-owned declaration.
An optional, explicitly versioned `service` object is validated by the YA
template loader. The template
manifest's existing `formatVersion: 1`, file composition, `setup`, `build`,
`test`, `preview`, `prepare`, and add-on contracts remain unchanged. Source
format documentation, loader validation and capability admission define the
extension together. Existing source libraries may retain their older format:
YA adapts only `{ "kind": "static", "dir": "dist" }` to a static entry
`index.html`. It never infers process commands from legacy preview/start fields.
The source library's server add-on must emit the versioned declaration before
its process can use this lifecycle.

Example for a template with an application server:

```json
{
  "service": {
    "version": 1,
    "where": { "kind": "process", "cwd": ".", "entry": "/" },
    "start": { "argv": ["npm", "run", "start"], "portEnv": "PORT" },
    "status": {
      "probe": "http",
      "path": "/health",
      "readyStatus": 200,
      "startupTimeoutMs": 30000
    },
    "stop": { "signal": "SIGTERM", "graceMs": 5000 },
    "serving": { "target": "sandbox-loopback", "protocol": "http" }
  }
}
```

| Section | Contract |
| --- | --- |
| `where` | Discriminated `static` or `process`. Process `cwd` is project-relative and `entry` is an app-relative URL path. Static declares `root` and a relative file `entry`. Resolve symlinks and reject project escapes, absolute filesystem paths and external entry URLs. |
| `start` | Process only: nonempty argv, no implicit shell, run in canonical `cwd`. YA allocates a private-namespace port and passes its decimal value through `portEnv`: `PORT` or an uppercase name ending in `_PORT`, excluding `YA_`, `YEP_` and `AGENT_` names. This cannot overwrite executable-loader or control-plane variables. The server must honor it, bind loopback and stay foreground. No daemonizing or user-service escape. |
| `status` | Process only: YA probes the declared HTTP path through that launch's broker until the exact expected response or startup timeout. Never execute a template-supplied status command. Probe only the owned endpoint; redirects cannot turn this into an arbitrary fetch. |
| `stop` | Process only: stop the owned process group with SIGTERM, wait `graceMs`, then report stopped or failed-to-stop. No arbitrary kill command, port-owner lookup, unrelated-process signaling or implicit SIGKILL. |
| `serving` | Static uses `target: "static-root"`; process uses `target: "sandbox-loopback"`, `protocol: "http"`. This names the backend, not a public hostname, bearer, PID or host port. Vhost association lives separately in YA app data. |

For process delivery without a wildcard hostname, `serving.basePathEnv` names
an environment variable through which YA supplies the app's scoped URL prefix.
Use `BASE_PATH` or an uppercase name ending in `_BASE_PATH`, excluding `YA_`,
`YEP_` and `AGENT_`. The app must honor that prefix for navigation, assets and
API calls; YA prefixes its readiness probe too. A generic root-relative app
requires a dedicated hostname. YA does not rewrite arbitrary response bodies.

A static template such as the initial App canvas declares:

```json
{
  "service": {
    "version": 1,
    "where": { "kind": "static", "root": "dist", "entry": "index.html" },
    "serving": { "target": "static-root" }
  }
}
```

Static serving has no application process or Start/Stop command. YA reports
ready when the contained entry exists and can be served, otherwise missing
build. Build remains an explicit authorized operation under the project's
execution policy, never a side effect of viewing. Activating the server add-on
replaces the static declaration with a process declaration atomically, only
after its entry and commands are valid. Do not invent a server for a static
bundle merely to supply lifecycle buttons.

Reject unknown versions, conflicting kind-specific fields, malformed argv,
unsafe paths, and out-of-range timeouts before launch. The declared readiness
probe supplies configuration; observed status is YA-owned runtime data.
Settings shows the entry/root or command as read-only details, not a limited
user form accepting host paths or arbitrary targets.

## Runtime ownership and confinement

YA owns one launch generation per project service, independently of provider
session lifetime. Duplicate Start requests reuse the current launch; serialize
Start/Stop and reject stale-generation results. States are **Stopped,
Starting, Running, Stopping, Failed**, plus **Unavailable** when confinement or
delivery prerequisites are missing. “Running” requires the readiness probe;
a PID alone is not readiness. Bound probe work, retain useful failure/log
details, and do not poll an idle or unseen project indefinitely.

Every service of a sandboxed, limited-user-created project runs entirely in
its project sandbox with the network firewall on. No unconfined preview,
setup/build helper, daemon, or host service may substitute when the sandbox
is unavailable, even when the superuser presses Start for that project.
The project root is the writable project boundary; vhost publication cannot
widen it. Reuse the enforced sandbox launcher and private runtime directories
rather than treating `cwd` as confinement. Static output may be read and
served by YA without executing project code on the host.

Persist declaration identity and desired/observed state in YA app data. A YA
restart reconciles an authenticated, owned runtime before reporting Running;
otherwise mark it stopped/interrupted. Never adopt an unrelated listener or
trust a recycled PID. Provider-host survival is a later implementation choice,
not a claim of automatic restart. Stop tears down the owned sandbox and
broker after the app exits, and retains the declaration and name reservation.

## Two delivery paths, one sandbox target

**Without a reserved vhost:** authorized App viewing must work without enabling
operator vhost hosting or claiming a public name. An authenticated project
request selects the permitted app, and a scoped, isolated viewer delivery
path proxies only its backend through the sandbox broker (or serves its static
root). Static apps use existing artifact grants. A process honoring
`basePathEnv` uses `/p/<launch-token>/` on the isolated artifact origin, including
the public artifact origin for relay clients. This bearer path is cookie-less:
YA strips request credentials and response cookies, gives it an opaque sandbox
origin and allows credential-free CORS for its own API calls. The token expires
with the launch. Apps requiring cookies/storage or root-relative URLs use a
dedicated app hostname instead. Missing safe delivery configuration fails
explicitly; never iframe host loopback or serve executable HTML on YA's origin.

**With a reserved vhost:** the configured tunnel/router carries requests to
YA's app host handler, which authorizes the app request and forwards to that
same sandbox broker and service generation. The tunnel does not launch the
app outside the sandbox. Strip YA credentials and app-access credentials
before forwarding, following existing app-proxy policy. Public hostname
reachability and app health are separate status dimensions.

Existing pieces verified in source on 2026-09-28:

- `session-sandbox-port-broker.mjs` splices a YA-only Unix socket connection
  to a requested port in the sandbox namespace, with connection and idle
  bounds. It opens no host TCP port and relaxes no outbound firewall rule.
- `artifacts/vhost-proxy.ts` (`proxyLoopbackVhost`) can use that broker socket.
  Current session App links mint a transient private app host and require app
  serving to be configured; they are not the no-vhost project delivery path.
- That proxy refuses WebSocket upgrades with 501. Ordinary HTTP/SSE is the
  first service boundary; do not promise Vite HMR or WebSocket applications
  until [WebSocket forwarding](../gaps/vhost-websocket-forwarding.md) is closed.

The separate project runner reuses these sandbox facilities. Viewing never
starts it. Settings refreshes status on entry and after lifecycle actions;
explicit Reload renews the current target, without background replacement of
an interacting iframe. A changed declaration is shown alongside the active
launch; stopping that launch remains possible even if the new file is invalid.

## App address in project Settings

Hide the entire vhost section when server vhost serving is disabled or the
server lacks the required capability. Retain any previous association in
storage; disabling the feature does not release a name. Re-enabling displays
the existing association before offering a new reservation.

When enabled, show the current/previous reserved hostname, owner, private or
public visibility, and **Reserved / Serving / Unavailable** separately from
service status. A stopped app still shows its reserved address. With none,
offer **Reserve address** to an authorized principal, prefilled with an
available-looking `username-project` suggestion but validated atomically by
the server. Never silently replace an existing association or take over a
name. Reservation alone neither starts the app nor publishes it.

**Serve at this address** is an explicit separate operation, gated by the
superuser or the limited user's publication grant. Initially only the
superuser may publish; name-prefix restrictions and the **Private apps only**
ceiling apply server-side. A private link remains a transferable app bearer,
so label it “Private link required”, not “Only me”. Public access is a separate
unchecked choice where allowed. A reservation grant does not imply publishing
authority. Keep first-claim-wins persistence and superuser-only release from
[project templates](project-templates.md#persistent-app-name-reservations).

The initial implementation keeps every limited-owned project/reservation
private, including an administrator's claim for that project. Fine-grained
limited-user publication grants and the configurable ceiling remain future
work. Release rotates the address bearer before freeing the claim. Static
reservations redirect authorized opens to a contained artifact grant; process
reservations proxy the same sandbox. Previous namespace rows stay visible in
Settings while vhosts are enabled, and cannot silently be reassigned.

## Authorization and audit-preserving removal

Reuse the authenticated YA principal and existing project grants; do not add
a service-local identity system. View requires project read access, lifecycle
actions require project execution authority, and publication requires the
separate ceiling above. Recheck grants and confinement at execution, including
queued operations and after reconnect. Unknown or inaccessible projects do
not leak service state, artifact paths, reservations or logs.

A limited user's project delete action means **Remove from my projects**.
Confirm that meaning and persist a principal-scoped hidden marker, actor and
time. It does not delete files, unregister the canonical project, erase
sessions/audit records, stop a service, release an address, or remove the
project from the superuser's view. Apply hiding consistently across that
user's project lists and selectors; it does not revoke access grants.
The superuser sees “Removed from archer's view” and can inspect the retained
project. Restoration clears the marker with an audit event. See
[limited users](limited-users.md#approved-project-removal-retention).

Personal hiding and audit storage are implemented under
`personal-project-hiding`; project App Settings shows retained removal records
to the administrator and provides Restore with a fresh audit event.

## Delivery acceptance

Before calling this implemented, verify the real main-pane path for both
principal kinds and both client transports: latest artifact, static starter,
running/stopped/failed service, absent/disabled vhosts, previous reservation,
and insufficient grants. Cover concurrent claims and lifecycle requests,
provider exit, YA restart, expired/missing artifacts, revoked access and
symlink escapes. Prove writes and direct network access outside the project's
sandbox stay denied with and without vhost serving. Removing a project as a
limited user must survive reconnect/restart as a personal hide while the
superuser still sees the project, sessions, service and reservation.

Advertise new project-service and reservation behavior under separate precise
capabilities; existing template or session-app capabilities do not imply it.
Compatibility plan approved by the user on 2026-09-28 (`Qcompat`): reviewed
stable releases v0.9.0, v0.9.1 and v0.9.2 lack this contract. Introduce separate
capabilities for App/service routes, reservations and personal project hiding.
Absent a capability, keep existing project/session behavior and send no new
requests. Do not broaden existing capability meanings. Rendered mockups
establish layout only, not these guarantees.
