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
behind the existing tunnel). Plannotator should ride that, not a second
ingress.

Preferred shape: another virtual host on that **same port**, like
`http://plannotator.localhost:<YA port>`. Use **`.localhost`** (RFC 6761,
resolves to loopback), not `.local` (mDNS). YA reverse-proxies that Host to
loopback Plannotator (`127.0.0.1:<session port>`), after a grant minted on
the authenticated YA/relay transport. Keep Plannotator bound to loopback;
do not set `PLANNOTATOR_REMOTE=1` just to punch `0.0.0.0`.

Same-machine client: that Host is enough (or even `http://127.0.0.1:<p>`
with no vhost). Hosted client: `*.localhost` on the user's box is *their*
loopback, so the public artifact origin's hostname is the one that already
reaches 4402 through cloudflared. Add a **path** on that existing public
origin (no new DNS/tunnel), or a second Host name only if the tunnel
already multiplexes Hosts — do not add a tunnel. Path-prefix needs
Plannotator's UI to tolerate a base path (cookies, asset URLs); if it
assumes `/`, Host on the same forwarded port is easier **when the browser
is on the YA host or using the same port-forward as artifacts**.

The YA **relay mux is not a generic HTTP reverse proxy**. It carries YA REST
and subscriptions. Do not stuff Plannotator's HTML/API into
`RelayRequest { method, path }`.

Bypass options, not YA work: Plannotator `--tailscale`; SSH `-L` of the
HTTP port (not X11).

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
path on the public origin) reverse-proxies loopback Plannotator. Authz,
cookie/Host, base-path vs Host, and grant lifetime are undesigned. No one
here has used Plannotator.

Related: [active content security](../../topics/active-content-security.md)
(artifact origins, public listener, cloudflared-shaped tunnel, grant
transport vs byte path),
[source transport](../../topics/source-transport.md) (relay is YA REST, not
a generic proxy),
[agent context injection](../../topics/agent-context-injection.md).

Found 2026-09-15; narrowed to same-port `.localhost` Host dispatch, not a
second tunnel.

Contributing-model: grok-4.6
