# Agent Auth Router

YA supports an optional local Agent Auth Router (AAR) connection for manually
pinned native Claude and Codex sessions on macOS and Linux. Automatic account
selection, pools, balancing and cross-account continuation remain future work.
The design and deferred work are in [plan 143](../docs/tactical/143-agent-auth-router-integration.md).

## Set up and use

1. Enroll accounts with the separate AAR CLI and run `aar serve`. Its default
   private control socket is `~/.agent-auth-router/control.sock`.
2. As the YA owner, open **Settings → Providers → Agent Auth Router**. Use
   **Connect local router**, optionally specifying a different socket path.
   Pairing grants access to the enabled accounts present at that time. New
   accounts require an explicit disconnect and new pairing (and a router
   restart for its credential coordinator).
3. On **New Session**, choose native Claude or Codex, expand advanced options,
   choose a router account, then choose a model from that account's catalog.
   Use a local, unsandboxed launch. Normal direct-provider sessions stay opt-in
   to their existing authentication path; selecting a router never changes a
   native profile's login.
4. Settings lists granted accounts, renewal configuration and explicit usage
   refresh. The session header shows its pinned account. AAR usage snapshots
   include their observation time; these are account windows, not a promise
   that every model has the same budget. Routed session controls suppress quota
   observations from the native login. No background polling is added.
5. Disconnect revokes the integration and its derived inference credentials.
   If AAR is offline, YA persists `revocation-pending`, blocks new routed
   launches locally, and offers **Disconnect / finish revocation** again.
   Already-issued capabilities are not claimed revoked until AAR acknowledges.

The browser communicates only with YA. Socket paths refer to the YA server's
machine, even when its UI is viewed remotely. This does not route an agent
running on a remote executor back through the owner's loopback listener.

## Ownership and lifecycle

AAR owns provider credential reads, official-CLI renewal coordination,
account-scoped catalogs/quotas and inference forwarding. YA owns its control
credential and per-session inference tokens in the private
`<dataDir>/agent-auth-router/private.json` (directory 0700, file 0600).
Provider credentials are never copied into YA. Existing native client homes
retain ordinary settings, skills and transcripts.

YA persists a random allocation identity and token before sending its hash to
AAR. Only the hash crosses the control socket. AAR prepares and commits the
binding durably before YA launches the provider. Retries use the same identity,
token hash and account. Ordinary session metadata contains only the public
binding/router/account/provider IDs. It survives provisional-to-canonical ID
remapping, restart and resume; a retained worker must have the same binding.
A missing/revoked pin, unavailable account/router, protocol mismatch or changed
router identity causes an error, never direct-provider or different-account
fallback. Failed fresh provider starts request cancellation; failed cancellation
is retained privately and retried before the next allocation.

Claude receives per-launch environment and flag-settings auth overrides;
Codex receives a named Responses provider with WebSockets disabled and its token
in a dedicated environment variable. Neither adapter rewrites native auth or
configuration files. Routed Claude spawn diagnostics omit arguments and stderr
because SDK flag settings can contain the inference token. Control responses,
REST payloads and public runtime metadata do not include tokens.

The private Unix socket is the owner bootstrap boundary. Its directory/socket
must be private, owned by the YA user and not symlinks. AAR control is separate
from loopback inference, with distinct credential namespaces. New control
routes are denied to limited users by the existing default-deny route policy;
their enforced YA sandbox also excludes routed launches. Credentials authorize
provider access, not a tool sandbox, and a same-OS-user coding process is not
an isolation boundary against that user's own local files.

## Supported slice and limits

- Manual native Claude/Codex creation, streaming, tool approvals, continuation,
  termination and same-account resume. Direct and message-less creation use
  the same pin before provider launch.
- Local macOS/Linux owner launches only. Windows control transport, remote
  executors and YA project-write sandboxes are refused.
- Clone/fork, YA recap/title helper sessions and project queue selection are
  refused for routed sessions in this slice. Native child work stays inside
  its routed provider process. One-turn Codex effort modifiers are refused
  until their effort catalog is account-scoped; they must not probe the direct
  account. The new-session form uses provider-default reasoning; explicit
  API effort values remain subject to provider support.
- Account switching and pools/balancing are not implemented. Re-pairing creates
  a new integration; old sessions do not migrate to it.
- Successful inference does not verify durable OAuth renewal. Accounts without
  a configured helper report manual renewal; configured helpers remain
  unverified until separately proved. No credential exchange or refresh is
  implemented in YA. Catalog and quota upstreams are not a stable public API.
- The `agent-auth-router` optional server capability gates controls and request
  fields. Older servers show no router UI. Protocol v1 is required. Downgrading
  a YA data directory containing routed sessions is unsupported.

## Verification

Synthetic coverage exercises private socket permissions, cross-integration
isolation, pre-commit refusal, lost response/retry, disabled accounts, durable
revocation/cancellation, identity mismatch, metadata remapping, same-token resume,
limited-user denial, native Claude settings precedence and provider-host binding
checks. Existing provider adapter tests continue to cover their protocol paths.

On 2026-10-03, Claude Agent SDK 0.3.283 and Codex CLI 0.159.0 on macOS/Node
26.7.0 with isolated temporary YA/client homes completed live native Claude
and Codex creation, continuation and resume through AAR. A full YA HTTP Codex
session also resumed after both servers restarted with the same pin; a tool
approval paused and continued through YA. These prove the tested transport and
lifecycle, not refresh-token rotation, arbitrary upstream versions, Windows or
cross-account continuation. Test logs and private profiles remain outside Git.

The browser flow also passed native Claude and Codex creation with a rendered
reply and visible account pin, explicit pairing/quotas, and sequential socket
path typing (under 10 ms per keystroke in the measured run). Desktop 1000×600
and phone 375×812 captures were inspected. The test browser blocks service worker
registration; Node 26 reports the existing tsx loader deprecation. Neither is
an assertion failure. A regression covers routed creation using automatic
reasoning instead of the direct-account model's thinking default.
