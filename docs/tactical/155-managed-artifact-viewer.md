# First-party hosted artifact viewing without a tunnel

Status: implementation authorized 2026-10-16. Owner: hosted artifact/file viewer.
Series: `relay-artifact-frame`.

## Product decision

The first-party hosted Yep Anywhere client supplies an isolated, managed
artifact viewer out of the box. Opening agent HTML with neighboring local
assets needs no extension, domain, tunnel, or artifact-listener configuration.
The trusted YA client reads files through its existing authenticated source
transport; remote bytes stay inside the encrypted relay. The content host
serves only the fixed viewer bootstrap and browser service worker.

The maintainer approved this default and autonomous end-to-end implementation,
real HTTPS verification, and incremental commits. No permanent staging stack
is needed. Existing explicitly configured custom artifact deployments retain
their current behavior and precedence. Local/direct and native clients retain
their existing paths until their respective delivery environments qualify.

This implements the [relay proposal](../../gaps/sketches/relay-artifact-frame.md)
and the hosted delivery portion of the [HTML viewer gap](../../gaps/html-document-viewer.md).
The [localhost follow-up](../../research/content-worker-localhost-spike/README.md)
proves native resource loading and lifecycle over the actual encrypted
transport, using a research parent. WebKit's larger-fetch failure remains
unresolved; it is not mobile acceptance. The extension adapter remains a
separate alternative, not a dependency.

## 1 — Preserve the experiment and infrastructure

Commit the localhost fixture, selected JSON evidence and findings without
screenshots. Commit the private DNS migration and DDNS maintenance separately
in dotfiles. Preserve unrelated extension work in the primary checkout.

## 2 — Enforce read-only preview leases on the YA server

Add authenticated preview admission and reads independently of the existing
public/local artifact listener. Reuse local file policy, session path scope,
canonical containment checks and opened-file response helpers. Existing durable
artifact grants retain their URLs, ownership and expiry/deletion semantics.
A preview lease never owns or deletes user files or creates project storage.

Proposed new API, relative to `/api`:

- `POST /artifact-previews` accepts an entry path and optional project id.
- `GET /artifact-previews/:id/file?path=<relative>` streams only admitted files.
- `DELETE /artifact-previews/:id` releases a lease.
- Session-scoped equivalents under `/sessions/:sessionId/artifact-previews`
  preserve sandbox path mapping and limited-user authorization on every read.

A lease identifies the admitting principal and optional session, canonical
root and entry; it expires and is revocable, process-bounded and read-only.
Recheck current file/session policy on reads. Reject traversal, encoded path
escapes, dotfiles, symlinks outside the root, cross-principal/session use and
excess file sizes/concurrency. Close streams on abort; expiry/release cannot
leave a general privileged fetch bridge. Server restart invalidates leases;
the viewer may re-admit its original entry once through the trusted parent.

This is a resource grant under the existing authenticated principal, not a
new identity system, hosted issuer or public bearer share.

## 3 — Publish a fixed, isolated HTTPS content host

Use per-viewer same-site origins under the first-party domain and an explicit
reserved hostname grammar. Prefer first-level labels to fit ordinary wildcard
TLS; verify the exact DNS/Worker arrangement before enabling the client.
Cloudflare's Worker serves only versioned bootstrap/worker files. Artifact
paths and API paths return inert failures on the network, never file bytes.

Restrict bootstrap embedding/handshakes to approved first-party client origins.
Use Origin-Agent-Cluster, response CSP, sandbox and no-referrer headers. Content
receives no YA credentials, storage, cookies, general URLs or arbitrary APIs.
The trusted parent validates source window, exact origin, protocol and viewer
identity; the server enforces the lease even if content forges all messages.

The browser worker scopes itself to the artifact subtree. Native relative
images, srcset, CSS imports/URLs, fonts, classic scripts, module graphs, JSON
fetches and linked documents resolve there without document rewriting.
Pull-driven streams have byte, request, concurrency and timeout bounds. Worker
restart discovers a live bootstrap rather than relying on worker-memory maps.
Closing a viewer aborts reads, closes ports, unregisters its worker and removes
its frames. Missing owners and lost control fail closed; versioned deployment
keeps active viewers compatible with their bootstrap.

## 4 — Use the existing managed file viewer

Capture the source runtime when opening each viewer. Never forward a request
through whichever host later becomes selected. Mount the managed viewer in
the existing pane and keep Source, reload, stop/retry, standalone YA viewer,
find and download/share flows coherent. Explicit custom artifact origins keep
their existing controls and URLs. Managed content URLs are not public shares.

Support standalone HTML and neighboring assets first, then the Visualize
fragment wrapper with bounded theme/widget-state and composer follow-up
messages. A follow-up populates the composer; it never submits automatically.
No running-app backend, arbitrary filesystem reads, WebSocket proxy, or new
public sharing system is part of this feature.

## 5 — Keep supported servers and deployments working

Compatibility corpus: latest stable servers `v0.9.2` and `v0.9.1`; no stable
server releases in the preceding 14 days on 2026-10-16. Both expose the older
listener-based `artifact-viewer` contract and lack the new preview API.

Add a separate permanent `artifact-relay-preview` capability introduced with
the next server contract release (`0.9.4` in the current registry). Support is
available in every official new server independently of listener settings, so
use version-implied advertisement with source-ahead capability metadata.
Do not broaden `artifact-viewer` or any existing flag. The parent makes no
new API call without the new gate. Missing gate or unsupported browser keeps
the configured custom viewer or today's scriptless/source fallback. Preserve
that fallback beyond the minimum release horizon.

The approved first-party default applies to recognized official hosted client
origins. Custom clients do not silently send traffic to first-party content
infrastructure; their existing custom viewer remains supported.

## 6 — Verify real HTTPS and the real YA pane, then land

First acceptance: an agent-generated `report.html` references `chart.png`;
opening the path in hosted YA displays an interactive report over encrypted
relay with no public artifact tunnel. Use temporary YA/relay/browser profiles
and a separately identified test browser. Keep all screenshots untracked.

Retain targeted server integration coverage for authority, traversal/symlinks,
policy changes, revocation/expiry and stream cleanup. Real browser evidence
must cover native resource types, blocked third-party cookies, navigation,
reload, worker stop/restart, concurrent viewers, teardown, denied reads and
network fallback, plus real sequential artifact/composer typing during live
updates (every key within 100 ms). Verify desktop and phone-width presentation
through the artifact capture facility. Qualify Chrome first; preserve fallback
for unqualified WebKit/native environments rather than claiming mobile support.

Run required lint, format, typecheck and unit gates, focused browser acceptance,
capability audit, CSS/console checks as applicable. Update the owning active-
content and compatibility contracts, record measured outcomes and commit each
reviewable slice. Deploy/verify the fixed content host before enabling hosted
client selection; do not publish a client that assumes old servers upgraded.

## Progress

- [x] Product/default and custom-deployment behavior selected.
- [x] DNS moved to Cloudflare; existing 18 records and service health preserved.
- [x] Localhost service-worker/real encrypted transport feasibility measured.
- [ ] Server preview lease and capability implemented and verified.
- [ ] Managed HTTPS host deployed and verified.
- [ ] Actual YA pane integrated, including compatibility fallbacks.
- [ ] End-to-end acceptance and required checks pass; slices committed.
