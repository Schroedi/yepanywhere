# Plannotator UI reach: HTTP browser app, not an X11 display

[Plannotator](https://github.com/backnotprop/plannotator) is a **temporary
local HTTP server plus a browser page**, not a Linux GUI that needs an X
display, VNC, or xterm forwarding. The integration YA would actually need is
getting that page to the **user's** browser when the agent runs on the YA
host and the user is on localhost, Tailscale, or a hosted client through the
relay.

Docs last checked against Plannotator OSS ~v0.25–0.27 (2026-08). This checkout
has never run it.

## What it is

The `plannotator` binary starts a Bun HTTP server, prints a URL, and (locally)
opens the system browser. Plan review, annotate, HTML, and code review are
that web UI. Skills and harness hooks (`ExitPlanMode`, `submit_plan`,
`/plannotator-annotate`, `/plannotator-review`, `/plannotator-last`) launch
that server and wait for approve/deny; structured feedback returns as the
agent's next input.

It is not an X11 app. `PLANNOTATOR_BROWSER` / `BROWSER` only choose how to
**open a URL**. Headless hosts should set `BROWSER=none` (or remote mode) so
it does not try to spawn a display-side browser.

### Bind and URL (from their remote.ts and remote-access docs)

| Mode | Listen | Port | Browser open | Auth |
|---|---|---|---|---|
| Local | `127.0.0.1` | random | auto | none |
| `PLANNOTATOR_REMOTE=1` | `0.0.0.0` | 19432 default | often skip; print URL | **none** |
| `--tailscale` (v0.27+) | stays `127.0.0.1` | Serve proxy | prints HTTPS + QR | Tailscale, not Plannotator |

`PLANNOTATOR_URL_HOST` changes only the advertised URL, not the bind.
Remote mode on `0.0.0.0` is an unauthenticated HTTP server; their docs say
do not publish it. Settings use a **localhost cookie**. HTML review is a
sandboxed iframe with relative assets from the file's directory.

The old `--render-html` flag is a no-op; local `.html` renders as a page by
default.

## What YA should not do

- X11 / VNC / xterm GUI forwarding. Wrong shape.
- A second feedback injector. Plannotator already writes the next provider
  user turn. YA should show the UI and leave that loop alone.
- Reuse the artifact **file-grant** path as if Plannotator were a static
  `.html` tree. Artifact serving "does not rewrite JavaScript, emulate an
  application backend, or run a project's dev server"
  (`topics/active-content-security.md`). Plannotator **is** a live app
  (review APIs, cookies, approve/deny). Serving a captured HTML export is a
  different, weaker product.

## How the user's browser can reach it

**No extra cloudflared tunnel.** Artifacts already share YA's listening port
by Host: `http://artifacts.localhost:<YA port>` hits the same socket as
`http://localhost:<YA port>`; the main listener dispatches on `Host` before
YA APIs. One SSH/port-forward, one public artifact listener (`127.0.0.1:4402`
behind the existing tunnel). Plannotator and other loopback HTTP UIs should
ride that, not a second ingress.

Keep the child bound to loopback; do not set `PLANNOTATOR_REMOTE=1` just to
punch `0.0.0.0`. Use **`.localhost`** (RFC 6761, resolves to loopback), not
`.local` (mDNS). Grant mint stays on the authenticated YA/relay transport;
bytes go through the Host-dispatched proxy.

The YA **relay mux is not a generic HTTP reverse proxy**. It carries YA REST
and subscriptions. Do not stuff Plannotator's HTML/API into
`RelayRequest { method, path }`.

Bypass options, not YA work: Plannotator `--tailscale`; SSH `-L` of the
HTTP port (not X11).

### Local: two maps on the same YA port

Both maps are `http://X.localhost:<YA port>` on the existing artifacts
Host-dispatch socket. SSH `-L` of that one port is enough; extra forwards
per child port are what this avoids. YA reverse-proxies to
`127.0.0.1:<target-port>` after a grant.

1. **Dynamic announced port.** The launched server binds loopback and
   indicates its port (printed URL, or pin `PLANNOTATOR_PORT` in the child
   env). YA registers an ephemeral Host such as
   `plannotator-<grant>.localhost` — or a single `plannotator.localhost` if
   only one review at a time — pointing at that port. Drop the Host when
   the review ends.

2. **Static explicit map.** Operator-configured `X.localhost` →
   `127.0.0.1:<port>` for a known local server or a service already
   ssh-forwarded onto the YA host. Same Host dispatch, no child
   announcement. A laptop that only forwards the YA port can then open
   `http://X.localhost:<forwarded-port>` for every mapped name.

Same-machine client: that Host is enough (or even `http://127.0.0.1:<p>`
with no vhost).

### Public: hosted client / devices (`ya.graehl.org`)

Hosted browsers cannot use `*.localhost` — that is *their* loopback.
`ya.graehl.org` is GitHub Pages; artifact bytes already leave the relay mux
and hit `artifacts.graehl.org` (cloudflared → `127.0.0.1:4402`).

The `relay` tunnel is first-match-wins (2026-09-15):
`relay.graehl.org` → `http://localhost:4400`, then
`artifacts.graehl.org` → `http://127.0.0.1:4402`, then
`plannotator.graehl.org` → `http://127.0.0.1:4402`, then else
`*.graehl.org` → `http://127.0.0.1:4402`, then a catch-all 404.
Do not rewrite the origin Host header to `artifacts.graehl.org` — 4402
must see the public Host so YA can vhost.

**`*.artifacts.graehl.org` cannot terminate TLS on this zone today.**
The zone is Free; Universal SSL is only `graehl.org` + `*.graehl.org`.
Ordering an Advanced Certificate for `*.artifacts.graehl.org` returns
Cloudflare 1450 (Advanced Certificate Manager). Nested names would
resolve to the tunnel and then fail HTTPS. Skip that wildcard until ACM
exists.

**Landed one-level else (2026-09-15):** proxied CNAME `*.graehl.org` to
the same tunnel target as `artifacts`, plus tunnel hostname `*.graehl.org`
→ `http://127.0.0.1:4402` after the exact names. More-specific DNS still
wins (`ya` → GitHub Pages, `kyle` → kzahel Pages, `relay` / `artifacts` /
`plannotator`). `foo.graehl.org` TLS SAN is `*.graehl.org` and `/health`
returns `421 Unknown artifact host` (reached 4402). `artifacts` / `relay`
health still 200.

`plannotator.graehl.org` remains an exact published hostname to the same
port; it is now redundant with the else-rule but harmless.

Other public shape, still not built: a **path on `artifacts.graehl.org`**
(no extra DNS; needs the app to tolerate a base path).

The host's cloudflared is a dashboard-managed named tunnel (run token
only). That token cannot create DNS or hostname routes; adding a wildcard
is a Cloudflare dashboard/API change with origin-cert or API auth
([interactives](../../topics/interactives.md)). The API token needs
Tunnel write plus zone DNS write, and must allow this machine's egress
IP. YA does not install DNS or change the tunnel
([active content security](../../topics/active-content-security.md)).
R2 S3 credentials do not configure tunnels or DNS.

YA today matches artifact Hosts **exactly** (`localOrigin` /
`publicOrigin` in `ArtifactServer.matchesHost`). Dynamic names need a
grant-scoped Host table, and unknown Hosts must not fall through to YA
APIs.

### Proxy constraints

- Preserve `Host` or cookie/settings break (their UI cookie is host-scoped).
- Forward the full session (HTML, XHR/fetch APIs, relative assets). If they
  later add WebSocket, the proxy must upgrade; not verified in-tree here.
- Do not enable `PLANNOTATOR_AGENT_TERMINAL_REMOTE=1` on a public or
  cloudflared path: that lets the browser run commands on the agent host.
- A grant must be session-scoped and revoked when the review ends; a sticky
  public URL to an unauthenticated Plannotator is a hole.
- Port discovery: parse the URL Plannotator prints, or fix
  `PLANNOTATOR_PORT` in the child env and proxy that loopback port.

## Skills / briefing (still needed, smaller than the proxy)

Sessions that opt in should know: call Plannotator as usual; do not expect a
local GUI; print or return the URL; YA will open it for the user. Prototype
HTML/plans stay files Plannotator can open (`plannotator annotate
report.html`). YA does not need to re-implement their renderer.

Optional child env: `BROWSER=none` so a headless host does not spawn
xdg-open; maybe `PLANNOTATOR_PORT` so the proxy has a stable target. Avoid
`PLANNOTATOR_REMOTE=1` unless we deliberately want `0.0.0.0`.

## Why not implement now

Insertion point is the existing artifacts port + Host dispatch, not a new
tunnel. The file-grant handler is still the wrong app; a sibling Host (or
path on the public origin) reverse-proxies loopback Plannotator. Local
needs both a dynamic announced-port map and a static `X.localhost` map.
Public `*.graehl.org` else-rule now reaches 4402; YA still 421s unknown
Hosts.
Authz, cookie/Host, grant lifetime, and Host-table vs exact
`matchesHost` are undesigned. No one here has used Plannotator.

Related: [active content security](../../topics/active-content-security.md)
(artifact origins, public listener, cloudflared-shaped tunnel, grant
transport vs byte path),
[source transport](../../topics/source-transport.md) (relay is YA REST, not
a generic proxy),
[interactives](../../topics/interactives.md) (named-tunnel run token cannot
add hostnames; reuse the existing tunnel),
[agent context injection](../../topics/agent-context-injection.md).

Found 2026-09-15; narrowed to same-port `.localhost` Host dispatch, then to
dynamic vs static local maps. Nested `*.artifacts` blocked by Universal
SSL; public else-rule `*.graehl.org` mapped to 4402.

Contributing-model: grok-4.6
