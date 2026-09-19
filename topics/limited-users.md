# Limited users

> Proposal: a second class of YA principal — a named limited user beside the
> single superuser — who logs in with their own credential (relay
> `server-username` claim, or standard HTTP auth on direct access), sees and
> acts on only the projects they own or are listed on, creates new projects
> only from templates, and whose sessions always run sandboxed; project
> membership is a per-project list of editors (later viewers) managed by the
> superuser or the project owner.

Topic: limited-users

Status: **proposal, nothing implemented (2026-09-19).** What exists today,
checked against `684687c69`:

- One account, no usernames. `AuthService` holds a single bcrypt password
  hash and cookie sessions keyed by verifier; `verifyPassword` takes only a
  password. [[security]] states YA has no roles, no project access-control
  lists, and no operator/viewer split, and that a restricted multiuser layer
  "requires new principals, server-side authorization, and an enforced
  execution boundary".
- Direct access accepts a cookie session, a desktop cookie or token, or,
  when auth is disabled and localhost-open is on, everyone reaching the
  listener (`middleware/auth.ts`). There is no HTTP Basic or Bearer auth for
  the API.
- The relay reserves one **server name** per install: `server_register`
  with `username` and `installId`, first-come-first-served, reclaimable by
  the same install id, expiring after inactivity (`relay-protocol.ts`,
  `packages/relay/src/registry.ts`). That name is also the SRP identity. The
  relay has no account or user concept beyond that claim.
- Settings have three scopes: browser-local, source-scoped client storage,
  server-wide ([[settings-ui-placement]]). No server-side per-user partition.
  Browser profiles ([[browser-profile-devices]]) are device identities with no
  authority.
- Session sandboxing is implemented on Linux ([[session-sandboxing]]) and
  requires enforced authentication, but is documented as not a hostile
  multi-tenant boundary.
- Sub-operator authority exists only as bearer links: public shares
  ([[relay-origin-and-share-gating]]) and app links
  ([[active-content-security]] § Private app links).

## The idea in brief

The **superuser** is what a YA login is today: full ownership of every
project, setting, and session. When authentication is disabled, every
localhost browser is the superuser, exactly as now. A **limited user** is a
new named principal the superuser creates. Logged in, they see the same YA UI
but scoped: their own projects, the projects where they are listed as an
editor, New Project from template, and nothing else. Every session a limited
user starts runs sandboxed; the toggle is not theirs to clear. The superuser
keeps full access to everything, including limited users' projects, and
manages a per-project **members** list.

Motivating case: the household or small-team host. One machine runs YA; the
owner wants a child, a partner, or a collaborator to make and play with their
own template-born projects ([[project-templates]]) over the same relay,
without handing them the operator credential that can reach every project on
disk.

## Principals and login

- **Superuser** — the existing single account. Unchanged semantics; the
  name is only for contrast.
- **Limited user** — `{ username, passwordHash, createdAt, disabled? }`
  in `auth.json`, created and reset only by the superuser. Usernames share
  the relay's label grammar (lowercase, 3–32 characters).
- **Relay login.** Today the relay claim is one server name and it doubles
  as the SRP identity. Proposed: the YA server additionally claims
  `<server>-<username>` for each enabled limited user, using the same
  `server_register` message and the same install id, so the relay needs no
  new concept; a limited user logs in to the hosted client with that
  compound name and their own SRP verifier. The alternative, free-form
  reserved strings not derived from the server name, is rejected in v1
  because the server-prefix form makes the owning install obvious, keeps the
  reclaim rules unchanged, and cannot collide with an unrelated server's
  name. The YA server knows which claim a connection arrived on and binds
  the principal from it before any API call.
- **Direct login.** The login page gains a username field, blank meaning
  superuser. For non-browser clients and for the simplest possible remote
  path, standard HTTP Basic over HTTPS is accepted as an alternative to the
  cookie flow, for limited users only: `Authorization: Basic` with
  `username:password`, verified against the same hash, rate-limited like
  login. The superuser is deliberately not reachable over Basic, so the
  operator credential never travels as a header. Basic is refused on plain
  HTTP except loopback.
- **Localhost-open and auth-disabled** are superuser-only modes; enabling a
  limited user requires enforced authentication, the same interlock
  [[session-sandboxing]] already applies.

## Authorization

A server-side check on every request, not a client filter. The principal is
attached by the auth middleware; each route family declares what a limited
user may do:

| surface | limited user |
|---|---|
| Projects list, project pages | only owned or member projects; others 404, not 403 |
| New Project | only from a template ([[project-templates]]), into a parent directory the superuser configured for that user; the created project is owned by them |
| Add existing directory | refused |
| Sessions in a member project | create, message, approve, fork, rewind; sandbox forced on; provider/model/effort within the user's lock (below) |
| Sessions elsewhere | 404 |
| Files, source control, git status | within member projects only; the same sandbox roots the session sees |
| Server-wide settings | read where harmless, write refused |
| Apps settings | only rows reserved for their projects ([[project-templates]] § App name reservation); no `public` toggle |
| Public shares, app links | within member projects only |
| Devices, push, browser profile | their own |
| Agents/process view, Inbox, All Sessions | filtered to member projects |

The superuser sees everything and additionally the members UI.

Ownership is stored server-side, keyed by project id, in a new
`project-access.json`: `{ projectId: { owner: username | "superuser",
editors: [username], viewers: [username] } }`. It is YA app data, never a
file in the project ([[project-directory-storage]]).

**Members UI.** On the project page, superuser or owner only: an editors
list (add by username, remove), and later a viewers list. Editor means
start sandboxed sessions and everything in the table above. Viewer, later:
see sessions and transcripts, open the project's app, but no turns, no new
sessions, no files outside what the transcript shows.

**Session guest.** A second, narrower grant shape for live sharing of one
session with another person ("multiplayer"): the superuser, or a project
owner, creates a username and password whose entire scope is **one named
session**. Through the relay (the "reflector") it is reserved and tracked as
its own compound name like any limited user, so the server always knows which
guest a connection is; on direct access it uses the same login or HTTP Basic
path. A guest sees that session's transcript, may send turns and approvals in
it (or is read-only, chosen at creation), and sees nothing else: no project
page, no file APIs beyond what the transcript shows, no session creation, no
fork. Anticipating the grant, the host may launch the session sandboxed at
creation so the guest's turns are confined; a guest grant on an unsandboxed
session is allowed but the members UI says so plainly. Guest records live in
`project-access.json` beside memberships as
`{ session: sessionId, guests: [{ username, mode: "turns" | "read" }] }`,
and revoking one ends its relay claim and cookie sessions. The
stale-session cutoff applies to guests too, but as **expiry rather than
redirect**: a guest grant is temporary and ends when the shared session has
been inactive for the configured cutoff, since a redirect into a new session
would fall outside the grant and an exemption would let a cold session be
resumed at full cost. The guest sees the remaining time and, once expired, a
plain "this share has ended" page; the host may re-share. A
session-continuation authority (which successor session a guest may follow
into) is not proposed here.

**Provider lock.** The superuser may pin a limited user to a provider, a
provider plus model, or provider plus model plus effort; any subset is
representable, but those three are the expected shapes. Stored on the user
record as `lock: { provider?, model?, effort? }`. Semantics:

- **New sessions** the user creates take the locked values, and the New
  Session form shows those fields fixed rather than offering a choice. A
  locked value beats [[session-defaults]] and any per-project default.
- **Existing sessions.** By default a limited user may send turns only to
  sessions whose current provider, model, and effort all fall within the
  lock; a session outside it is visible in member projects but read-only for
  that user, with the reason shown. The superuser may relax this per user
  (`lock.existingSessions: "any"`), which keeps the lock for creation only.
- **Mid-session changes** ([[mid-session-effort-change]], model switches)
  are refused for a locked field.
- The lock bounds what the user can spend and which provider account they
  reach; it is enforced server-side at session create and message routes,
  never only hidden in the form.

The check reuses the same provider, model, and effort identifiers the
session-create route already validates, so a lock names only values the
server could launch. An unlaunchable locked value blocks the user's session
creation with a clear message rather than silently falling back.

**Stale-session cutoff.** A child or casual user does not know that
resuming a session idle for a day misses its prompt cache and costs far more
than a fresh one. A per-user setting, a time slider (`staleAfter`), makes YA
redirect: when the user sends a turn to a session whose last activity is
older than the cutoff, the message instead opens a **new session** in the
same project. The slider is an **offset against the believed cache-warm
window of the session's provider and model**, not an absolute duration: the
per-provider retention window that [[prompt-cache-keepalive]] already
tracks is the zero point (currently configured as one hour for Claude and
ten minutes for Codex, which is fine for now). The slider ranges from −5
minutes (redirect slightly before the cache is believed cold) to +60 minutes
of grace, with a separate off position; the default offset is 0. One user
setting therefore behaves sensibly across providers without the user
knowing either window. The new session's first turn is
the user's text, prefixed with a short reference to the previous session
(its YA id and title) and a hint that the agent should read it if the
request refers to something not otherwise explained; the previous session is
left untouched. Beyond the cutoff the old session's composer shows the
redirect plainly ("this will start a new session"), so the behavior is
visible rather than surprising, and the superuser may set the slider to off
to keep ordinary resume behavior. The redirect is server-side at the message
route, keyed by the session's last activity time, so a stale client cannot
bypass it. The superuser may opt into the same setting for their own account
(decided 2026-09-19); it is off for the superuser by default and required
only for limited users. For session guests the cutoff expires the grant
instead of redirecting, as stated above.

## Grants management

Guest grants that are temporary by default make an explicit **permanent**
grant a deliberate act, and that act needs a place where everything the
host has handed out can be seen at once. Today the sub-operator grants are
scattered: public session shares have their own authenticated management
routes, app links are revoked per row in Settings → Apps, and interactive
artifact links have no inventory at all
([`gaps/artifact-grant-revocation-ui.md`](../gaps/artifact-grant-revocation-ui.md),
[`gaps/app-artifact-access-control.md`](../gaps/app-artifact-access-control.md)).

Proposed: a **Settings → Limited Users** category, superuser only, that is
both the user directory and the grants recap:

- **Users.** Each limited user with lock, stale cutoff, parent directory,
  enabled/disabled, last login, and reset/disable/delete actions.
- **Project memberships.** Every project's owner, editors, and viewers, the
  same data the per-project members UI edits, listed across projects so a
  name can be found and removed everywhere in one place.
- **Live shares.** Every session guest grant: session, guest name, mode,
  temporary or permanent, remaining time, last seen, revoke. A permanent
  guest is created only here or from the session's share menu with an
  explicit "does not expire" choice, and is marked in this list.
- **Document and app grants.** A read-only recap of the other bearer
  grants the host has outstanding, with revoke: public session shares, app
  links per vhost row and their generation, and interactive artifact links.
  This is the inventory the two gaps above ask for; landing it here rather
  than as three panes is the point of the recap.

Each row links to the surface that owns it (the project page, the Apps row,
the session), and the recap never becomes a second editor for those
records; it lists and revokes. Counts of outstanding grants by kind appear
at the top so a host can tell at a glance whether anything is shared at
all. The category is hidden entirely when no limited user, guest, or bearer
grant exists, in keeping with [[settings-ui-placement]] and
[[vanilla-defaults]].

## Execution boundary

The [[session-sandboxing]] Linux mechanism is the enforcement floor: a
limited user's session is confined to its project tree with the sandbox's
fixed private roots, and cannot be launched unsandboxed or on a non-Linux
host or remote executor until those gain an equivalent boundary. That topic
currently declines to call itself a hostile multi-tenant sandbox; this
proposal does not change that claim by fiat. Before limited users ship, the
sandbox's threat model must be re-read for the case "the person typing the
prompt is not the machine owner", in particular: provider credentials in the
child environment, the project parent directory the user may create into,
shared caches between users' sessions, and `!!` bang commands, which run in
the project directory outside the provider and must run inside the same
sandbox or be refused for limited users.

Sessions of different users on one host share YA's process, event bus, and
data dir. The isolation claim is authorization plus per-session filesystem
confinement, not process-level tenancy; [[security]] should say so in its
trust-boundary section when this lands.

## App access for members and the public

Today an app is reached either by a bearer URL or by the row's explicit
`public` flag; URL possession is the authorization unit
([[active-content-security]]). Members get bearer links for their projects'
apps through the existing links route, filtered by membership. Viewers,
later, get the same links read-only.

Wanting an app open to the public while still knowing who is visiting is a
distinct request: it is about fetching the bundle at all, not the app's own
accounts. It is tracked as
[`gaps/sketches/app-public-access-with-identity.md`](../gaps/sketches/app-public-access-with-identity.md)
rather than decided here.

## Phases

1. **Principals.** Limited-user records, superuser-managed creation and
   reset, username on the direct login page, HTTP Basic for limited users,
   principal attached by middleware. No authorization changes yet, so a
   limited user is refused everywhere until phase 2; the phase is only
   useful as a landing for tests. ‖
2. **Project access.** `project-access.json`, owner and editors, route-family
   checks from the table, members UI, 404 scoping of lists and pages,
   forced sandbox, bang-command refusal or confinement, provider lock and
   stale-session cutoff at create and message routes. ‖
3. **Relay.** Compound `server-username` claims, per-user SRP verifiers,
   hosted-client login with a username, pairing flow update
   ([[mobile-server-pairing]]). ‖
4. **Viewers**, **session guests**, and the template-only New Project for
   limited users, plus the Settings → Limited Users grants recap, once
   [[project-templates]] phase 2 exists. Guests may land
   earlier than viewers since their scope is one session and needs no
   project-level filtering beyond a 404 for everything else.

## Open decisions

- Whether the relay should instead learn a real second-level concept
  (server plus user) so a compound name cannot be squatted by a different
  server choosing `alice-bob` as its own name; the compound form is the v1
  bet because it needs no relay change.
- Per-user settings partition: which browser-local preferences should become
  server-side per-user (theme, session defaults) and whether that is worth a
  fourth settings scope in [[settings-ui-placement]].
- Whether owners may add editors themselves or only the superuser may.
- Per-user parent directory for created projects: one configured root per
  user, or a per-user subdirectory under one root.
- Whether limited users may use provider accounts of the host at all, or
  must bring their own ([[copilot-provider]] already notes per-user tokens
  for a hosted case).
- Rate limits and session caps per limited user, extending the relay's
  five-session cap.
- Session-continuation authority for guests: when a shared session is
  forked, rewound into a new session, or redirected by the host's own stale
  cutoff, which successor if any the guest may follow into.

## See also

- [[security]] — current single-user trust boundary this proposal extends.
- [[session-sandboxing]], [[session-sandbox-network-boundary]] — the
  execution floor.
- [[project-templates]] — the only project-creation path for limited users.
- [[active-content-security]], [[relay-origin-and-share-gating]] — bearer
  authority for apps and shares.
- [[mobile-server-pairing]], [[relay-client-mux]] — the relay claim and
  login flow the compound name joins.
- [[settings-ui-placement]], [[browser-profile-devices]] — existing settings
  and device scopes.
- [[cross-host-delegation]] — the nearest existing permission-grant design.
