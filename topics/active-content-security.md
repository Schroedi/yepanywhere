# Active Content Serving and Origin Isolation

> Agent- or project-authored active content must never execute with YA's
> authenticated server origin or hosted-client origin. File viewing is
> source-first and scriptless; applications that intentionally execute need a
> separate untrusted-content origin with no YA credentials or ambient API
> authority.

Topic: active-content-security

Status: **raw-file containment and opt-in isolated HTML artifact serving
implemented (2026-09-07).** Active local, project,
upload, and public-share file responses now share a lightweight native-
navigation policy. Browser-active HTML, XHTML, SVG, XML, and XSLT responses
are attachments with `nosniff`, an inert response CSP, no-referrer policy, and
a restrictive permissions policy. Interactive previews use the separately
configured artifact origin described below; the normal raw endpoints remain inert.

See also:

- [security](security.md) — the broader authenticated, relay, and public-share
  trust boundaries.
- [media-rendering-and-routing](media-rendering-and-routing.md) — the shared
  file/media viewer and transport rules.
- [interactives](interactives.md) — the proposal most directly constrained by
  executable-content isolation.
- [session-sandboxing](session-sandboxing.md) — why a confined provider must
  not be able to borrow the operator browser's authority through a file it
  writes.
- [rich-text-rendering](rich-text-rendering.md) — sanitized HTML fragments are
  a different trust class from standalone active documents.
- [active-content-security evidence](active-content-security.evidence.md) —
  reproduced behavior and the dated source audit.
- [active-content origin-isolation plan](../docs/tactical/078-active-content-origin-isolation.md)
  — implementation ledger and remaining origin-isolation verification matrix.

## Evidence and remediation state

The confirmed same-origin execution trace, why existing browser defenses did
not contain it, the route audit, and the 2026-08-21 containment evidence live
in the [evidence companion](active-content-security.evidence.md). The remaining
viewer, preview, and isolated-application work lives in
[tactical 078](../docs/tactical/078-active-content-origin-isolation.md).

## Design Decisions

- **Apply metadata-only classification and response headers everywhere** (vs.
  globally parsing or sanitizing contents): extension/MIME checks close native
  navigation cheaply, while compute-heavy precautionary inspection is useful
  only when an enforced project-write sandbox creates the extra boundary.
- **Preserve original active bytes behind attachment handling plus an inert
  CSP** (vs. rewriting the response as source text): explicit downloads remain
  faithful, and the viewer owns source presentation without making the raw
  endpoint an executable navigation target.

### Client viewer mitigation — 2026-08-09

The shared file context menu now distinguishes Source from Preview without
navigating either selection to a raw active response. Ordinary HTML opens as
source; an explicit preview in either current client viewer uses the same
client-owned `srcdoc` wrapper with an empty iframe sandbox, no-referrer policy,
and a restrictive meta CSP that denies scripts, connections, frames, objects,
workers, forms, base URLs, and ambient image/media loads. Markdown keeps its
sanitized preview default and can be requested as source.

This is defense in depth at the client presentation boundary. The later server
containment protects old clients, address-bar visits, modified browser
navigation that escapes interception, redirects, and copied raw endpoints.
The client also deliberately withholds a **Viewer link** for arbitrary
allow-listed local files rather than mislabeling `/api/local-file`; a stable
standalone coordinate is future server-backed work.

## Content Trust Classes

The implementation and future designs must keep four classes separate.

### Trusted YA application documents

YA-owned entry documents, scripts, service workers, and narrowly scoped
diagnostic pages are application code. They may execute on a YA origin only
when they are shipped as reviewed build inputs and carry the intended
production CSP. Project files, uploaded files, provider output, plugin output,
and agent-created files never become trusted merely because a YA route serves
them.

### Sanitized rich-text fragments

Server-rendered Markdown, syntax highlighting, diffs, and declared rich-input
forms may be inserted into an existing trusted YA document as inert fragments.
Their renderer/sanitizer must reject executable elements, event handlers,
unsafe URL schemes, active embeds, and other DOM authority. This class does not
need a separate origin. CommonMark embedded HTML may enter the Markdown parser
only when the resulting fragment immediately crosses the same sanitizer as
renderer-generated markup. It is never unsanitized pass-through or a standalone
HTML preview.

`dangerouslySetInnerHTML` describes a React insertion mechanism, not a trust
decision. Only output from the owning reviewed renderer/sanitizer belongs in
this class.

### Untrusted active documents

HTML, XHTML, SVG, and other browser-active formats supplied by a project,
agent, upload, or share are data to YA's normal file-viewing surfaces. They are
shown as source, downloaded, or rendered in a scriptless opaque sandbox. They
must not execute as top-level documents on a YA origin.

Initial active-type classification must include at least:

- `text/html` and `.html` / `.htm`;
- `application/xhtml+xml` and `.xhtml` when accepted;
- `image/svg+xml` and `.svg`; and
- XML/XSLT-capable responses until their browser behavior and type policy are
  deliberately narrowed.

Classification uses the final response type plus a conservative extension
check, so a caller-provided MIME type cannot opt an active extension out of the
policy. Lightweight content checks may be added when they materially improve
coverage. Precautionary parsing or sanitization that is computationally heavy
is reserved for enforced project-write sandbox sessions rather than imposed on
every file response. PDF and other document formats need an explicit browser-
capability review; absence from the initial confirmed list is not a declaration
that they are inert.

### Untrusted executable applications

An Interactive or another deliberately runnable agent-built app is allowed to
execute only inside an isolated application environment. An interactive file
preview uses that same boundary and cannot use the authenticated YA or
hosted-client origin.

## Observable Safety Contract

The following behavior is required across direct, desktop-loopback, hosted
relay, and public-share contexts.

1. An ordinary click, modified click, context-menu open, viewer toolbar action,
   copied viewer URL, browser restore, or redirect must never turn an untrusted
   active file into a top-level document on a YA application origin.
2. The normal action for an active file opens the unified viewer in source
   mode. An explicit static preview may use a sandbox with scripts disabled.
3. "Open in new tab" means the standalone YA viewer route, not the raw-file
   endpoint. "Download" is the action that returns original active bytes.
4. Raw active responses use attachment disposition, `nosniff`, and the inert
   response policy below. Source display belongs to the viewer rather than a
   native top-level navigation; explicit downloads preserve the original
   bytes and declared type.
5. Client interception is convenience, not containment. Server responses are
   safe when reached by an old client, a copied link, direct address-bar
   navigation, or a non-browser HTTP caller.
6. Scriptless HTML preview does not load network resources, submit forms,
   create workers, open popups, navigate the top level, or access YA APIs.
7. SVG follows the active-document policy even when the UI calls it an image.
   If inline SVG display is required, sanitize/rasterize it or render it under
   equivalent isolation; object URLs alone are not an execution boundary.
8. Public-share and hosted-client routes preserve the same active-type policy.
   A missing local `/api` backend does not make executing content safe because
   the hosted origin can hold browser-local login/resume state.

## Response CSP Is a Backstop, Not the Primary Boundary

CSP belongs in HTTP response headers on the response being protected. YA does
not need to inject a `<meta>` element into an untrusted file. A scriptless
static preview policy can begin from:

```http
Content-Security-Policy: sandbox; default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

The exact asset allowances belong to the preview design. Local/project assets
should be fetched by the trusted viewer and brokered as bounded blob/data
resources rather than reopening authenticated network access inside the
document. Add a restrictive `Permissions-Policy` where browser support makes
it useful.

For source-only responses, `text/plain` or attachment handling is simpler and
stronger; CSP remains defense in depth. For applications that intentionally
run scripts, `script-src` changes cannot create a trust boundary on a shared
origin. Those applications require origin isolation.

The implemented raw-file classifier inspects only the response MIME type and
file extension, then applies headers. It is cheap enough to run for every
session and transport mode. Additional precautionary content parsing,
sanitization, or rasterization that is computationally heavy is enabled only
for enforced project-write sandbox sessions; a feature that promises inline
rendering must still provide its required safety boundary by design.

## Executable Application Origin Contract

Any feature that runs project- or agent-authored JavaScript must satisfy all of
these constraints before it ships:

- **No shared YA origin.** A path such as `/apps/:project/:name/*` on the main
  server or `ya.graehl.org/apps/...` is not isolation. A different port is an
  origin boundary for DOM access but cookies are not port-scoped, so it is not
  the preferred credential boundary either. Use a different host at minimum;
  a dedicated registrable user-content domain is stronger.
- **No YA credentials.** The application host does not receive or accept the
  YA session cookie, Authorization headers, relay resume secrets, public-share
  secrets, or browser-local YA storage. YA auth cookies remain host-only and
  must never acquire a parent-domain scope that includes user content.
- **No YA API namespace.** `/api`, `/public-api`, WebSocket control channels,
  and native/desktop bridges are absent or fail closed on the application
  host. YA does not grant credentialed CORS to it. Mutations remain
  non-GET and require the custom header as defense in depth.
- **Scoped entry capability.** If access control is needed, use a short-lived
  or revocable capability accepted only by the one interactive/asset broker.
  Disclosure by the running app must not grant session, project, or general YA
  API access.
- **Sandboxed embedding.** Default embedding uses an opaque-origin iframe with
  `allow-scripts` only when execution is intended and without
  `allow-same-origin`. A dedicated untrusted origin may later receive narrowly
  justified sandbox tokens for storage/workers; it never gains YA origin.
- **Brokered host communication.** `postMessage` is schema-validated,
  capability-scoped, and tied to the expected child window. With an opaque
  origin, `event.origin` is `"null"`, so the parent must verify `event.source`
  and never send ambient secrets through a wildcard channel.
- **Safe top-level opens.** A script-enabled new-tab view exists only on the
  isolated application host and is opened with `noopener`. A blob URL or
  `srcdoc` created by the trusted client is not used as an unsandboxed
  top-level substitute.
- **Worker containment.** Untrusted applications cannot register a service
  worker on a YA or hosted-client origin. Any worker scope remains entirely on
  the isolated application host and is cleaned up/revoked with that app's
  lifecycle where feasible.

One common application origin isolates apps from YA but not from one another.
If applications may hold mutually sensitive state, the design must add
per-app origins or another storage/process boundary.

### Direct and relay delivery

Direct delivery needs a distinct application host/virtual host whose handler
serves or proxies app assets but exposes no YA control routes. A proxy must
strip YA cookies, Authorization, forwarding headers that carry identity, and
other ambient credentials before contacting the loopback app.

Hosted relay delivery cannot place agent content at a path on the hosted YA
client origin. It needs either:

- a dedicated untrusted-content host reachable through a scoped relay/broker;
  or
- a trusted client that fetches the bundle over the encrypted connection and
  constructs a strictly sandboxed opaque-origin iframe with a complete asset
  broker.

The second option is suitable for controlled static bundles but does not
automatically support arbitrary navigation, workers, storage, WebSockets, or
multi-file apps. Optional Tailscale and Cloudflare transport changes
reachability, not this isolation requirement.

## Open Decisions

- The direct and hosted untrusted-content hostnames/registrable domains and how
  local development resolves them.
- Whether static HTML preview needs any network-loaded asset class, or all
  assets should be brokered blobs/data.
- Whether executable Interactives share one untrusted origin or receive
  per-app origins for storage isolation.
- The scoped app-admission token shape and revocation/lifetime policy.
- Which PDF and XML-family capabilities require attachment-only handling.
- Whether the standalone rendered-Markdown document has enough browser-native
  value to retain after unified-viewer convergence.
- The stable standalone viewer coordinate for an allow-listed file outside the
  active project, and whether the server should resolve it to another scanned
  project's viewer without exposing raw paths in URLs.
- The bounded asset-broker contract for relative images and styles in static
  HTML preview across direct and relay connections. The current client preview
  intentionally denies ambient network loads.
- Whether trusted hosted-client headers justify moving the primary static
  deployment; this is hardening, not the active-content fix.

## Interactive HTML artifacts

The operator can enable interactive previews of ordinary `.html`/`.htm` files
from project sessions and allowed local paths. A directory of neighboring
files is sufficient; no YA manifest or ZIP packaging is required. Artifact
producers provide compatible relative asset URLs and any mocked or real
services needed by the application. YA serves original bytes; it does not
rewrite JavaScript, emulate an application backend, or run a project's dev server.

### Configuration and delivery

Settings → Local Access and Remote Access expose the same artifact settings.
Serving defaults off. Enabling local access pre-fills
`http://artifacts.localhost:<YA port>`; the complete address remains editable.
A blank public address disables hosted artifact access. With both addresses
absent, no grants are available and no artifact listener runs.

The main YA listener dispatches the configured artifact Host to the isolated
handler before application routes, authentication, or the development proxy.
Consequently, `localhost:3400` and `artifacts.localhost:3400` can use the same
SSH forward while retaining different browser hosts. The operator must arrange
client-side resolution if their browser/OS does not resolve `*.localhost`.
The local address's port is the browser's forwarded port, which can differ
from YA's actual listening port.

A configured public HTTPS address additionally starts a plain HTTP listener on
`127.0.0.1:<artifact port>`, default port 4402, for a reverse proxy or tunnel.
The proxy preserves the artifact Host and terminates HTTPS. No second SSH
forward is needed for the local same-port route. The listener port is editable;
changing it also requires updating the operator's proxy route. YA does not
install DNS records or change the tunnel configuration.

`YEP_ARTIFACT_PORT` pins the artifact settings at launch, together with
`YEP_ARTIFACT_LOCAL_ORIGIN` and `YEP_ARTIFACT_PUBLIC_ORIGIN`. An absent port uses
persisted settings; `0` overrides them and disables serving. Positive ports
must be 1–65535. Origins must be bare HTTP(S) origins with separate hostnames;
public origins require HTTPS. The public listener starts only when a public
origin is configured. Configuration changes revoke outstanding grants.
Failed listener binding or settings persistence restores the previous
configuration; a failed startup is reported rather than quietly changing ports.

Grant management uses the current source's authenticated YA transport, including
encrypted relay connections. Artifact documents and assets themselves travel
directly to the selected artifact origin. They are outside YA's encrypted relay
protocol: a TLS-terminating proxy can read them. No session, relay-resume, or
public-share credentials are attached to artifact requests by YA.

### Preview and authority

HTML continues to open as source or scriptless preview. An explicit **Run
interactive preview** first performs one credential-free `/health` request to
the selected origin, with redirects rejected and a 2.5-second deadline.
Loopback browser access selects the local origin; other browser access selects
the public origin. Failure leaves the static preview with an explicit Retry
action; there is no polling, grant request, or interactive frame on failure.
The client rejects a selected origin sharing YA's hostname and refuses mixed
HTTPS-page/HTTP-frame configuration.

In the full file viewer, the existing top-row source/preview toggle starts
interactive HTML directly when clicked from source; no second Run button is
needed. Switching back to source unmounts the preview and revokes its grant.
The context menu's explicit Preview action uses the same path. Merely opening
a file, restoring a source view, or receiving a link does not request a grant.
An initially requested scriptless presentation retains its explicit Run action.
Older/disabled servers retain scriptless viewing without unsupported requests.

A browser-enforced parent `frame-src` violation replaces the broken frame with
an explanation and an **Open interactive preview in a new tab** link to the
same grant. The new tab has no opener or referrer; stopping/closing the owning
viewer still revokes that grant. The viewer never relaxes the browser policy.
A stale frontend policy requires an operator-owned restart and page reload
for embedding to work; the separate artifact tab can be used independently.

The granted directory supports relative stylesheets, images/SVG, webfonts,
classic scripts, modules/dynamic imports, JSON fetches, and linked HTML files.
Root-relative paths address the artifact host itself and are not mapped to a
grant. Directory indexes, history-router fallback, service workers, nested
frames, popups, forms, downloads, native bridges, and device permissions are
not supplied. External HTTP(S)/WebSocket services remain subject to the
browser's ordinary network/CORS rules and the artifact author's setup.

Both iframe sandbox and artifact response CSP allow scripts and same-origin
behavior on the **separate artifact host**. This deliberate allowance preserves
module fetches and artifact-local storage. Artifact applications share that
origin's storage and authority with each other; this is for an operator's own
artifacts, not mutually hostile tenants. They never receive YA storage or a
host bridge. YA's parent-document CSP permits HTTP(S) frames so configuration
can change without reloading an already open document; only the validated
artifact URL is used by the interactive viewer.

The artifact handler exposes only GET/HEAD health and granted files. `/api`,
`/public-api`, desktop bootstrap, and WebSocket upgrades are unavailable.
Registered artifact hostnames stay excluded from YA host/CORS/WebSocket trust
until process exit, including after disable/reconfiguration and with wildcard
allowed-host settings. Opaque `Origin: null` is also rejected once an artifact
host has been registered, preventing a navigated artifact from borrowing that
legacy origin allowance. Native named Tauri origins keep their existing rules.

Admission authorizes the selected HTML file's containing directory, subject to
the current file-access allow-set on every read. Relative traversal, hidden
path components, and symlinks escaping that directory are rejected. A random
256-bit bearer URL permits reads for 24 hours or until revocation/reconfiguration;
the application can disclose that URL, so it is not a secret from the artifact.
Limits are 256 live grants, 1,024 distinct files per grant, and 64 MiB per file.
Responses are streamed, range-capable, and marked `no-store`. Closing/stopping
the preview revokes its grant; offline revocation falls back to expiry. This
does not erase files already read or artifact-origin local storage.

The frame remains in the existing viewer owner while parked; no cooperative
suspension or CPU/memory containment is claimed. Dedicated HTML viewport,
drag/pinch inspection, and broader viewer-navigation work remain tracked in
[the HTML viewer gap](../gaps/html-document-viewer.md).

### Compatibility and verification

Optional permanent capability `artifact-viewer` (ID 59) gates grants. The
reviewed optional-feature corpus was v0.8.0 (2026-08-31) and v0.8.1
(2026-09-05); neither has this contract. Without the capability, clients keep
source/scriptless viewing and never POST or DELETE grants. New servers expose
`version.artifactViewer` configuration metadata even while disabled; its
presence independently gates PUT `/api/artifacts/config` and the settings UI.
Public shares never request private artifact grants. Existing capability
meanings and transport formats do not change.

Focused tests cover actual main-port hostname dispatch, original bytes,
revocation, ranges, traversal rejection, wildcard/opaque-origin exclusion,
older-server fallback, and failed reachability. The browser fixture in
`packages/server/test/fixtures/artifact` exercises fonts, media, modules,
mocked JSON, local state, controls, and linked documents with no source dev
server. Run `pnpm --filter @yep-anywhere/client exec playwright test --config
playwright.artifacts.config.ts`. Chromium was verified at desktop and phone
sizes; this host lacks WebKit's required system libraries. After the operator
restarted YA on 2026-09-07, a live public HTTPS tunnel served the demo with
working fonts, modules, mocked JSON, menu, and save interaction in Chromium.
The same grant also returned HTTP 200 through local same-port Host dispatch.
The complete hosted-client embedded flow, Safari/WebKit, macOS, and Windows
verification remain outstanding.
