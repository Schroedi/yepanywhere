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
   launches locally, and offers **Finish disconnecting**.
   Already-issued capabilities are not claimed revoked until AAR acknowledges.

## Status and recovery

Settings distinguishes a **saved pairing** from an on-demand reachability check.
Opening the panel or choosing **Check status** checks the same router identity
and granted accounts, and reports unavailable, revoked, incompatible or insecure
connections without copying raw router responses or filesystem paths to the UI.
There is no background polling, automatic reconnect or account substitution.
Status reads never retry cleanup or change pairing/revocation state.

- **Pairing incomplete:** Retry connection reuses the saved pairing and socket
  unless the operator explicitly supplies another socket. Identity checks still
  forbid substituting another router.
- **Router unavailable:** Start AAR on the YA server and check again. A saved
  pairing does not establish that existing workers can currently infer.
- **Account disabled:** Settings labels it and disables usage refresh. The new
  session selector retains the selected account on failure; disabled choices
  cannot be selected. Enable the same account in AAR to resume its sessions,
  or deliberately select an available account for a new session.
- **Failed-launch cleanup pending:** The count survives restart. **Retry
  failed-launch cleanup** sends only recorded cancellations, starts no provider
  process, and does not allocate or change an account. Failed acknowledgements
  remain pending. Cancellation remains allowed after an account is disabled.
- **Disconnect pending:** **Finish disconnecting** retries revocation with the
  retained grant. New routed launches stay blocked and the UI does not claim
  existing workers lost access. Connecting a different router or pairing is
  refused until the original revocation is acknowledged.
- **Revoked grant:** Finish disconnecting and pair again for new sessions.
  Retained sessions cannot adopt that new pairing. Missing or cancelled pins,
  unavailable accounts, and mismatched router identities remain explicit launch
  or resume errors with recovery guidance; they never use direct credentials.

Health/account observations are point-in-time evidence, not an inference or
renewal probe. Usage snapshots retain their observation time. Requests and
results belong to the selected YA source; switching hosts cannot apply an old
response or start an old action's follow-up request against the new host.

Owner-only `GET /api/agent-auth-router/recovery` reports connection state,
reachability, a check timestamp, granted accounts, pending cancellation count
and an optional safe issue. `POST /api/agent-auth-router/retry-cancellations`
explicitly retries recorded failed-launch cancellations under the saved grant.
Limited-user default-deny applies to both routes. No provider credentials,
inference/control tokens or socket/profile paths appear in these responses.

The separate optional `agent-auth-router-recovery` capability (ID 114) gates
these routes and controls. The 2026-10-03 optional release review checked
v0.9.0 (September 22), v0.9.1 (September 24), and v0.9.2 (September 26); all
lack AAR routes. Without the recovery bit, a client with the original
`agent-auth-router` bit uses only the original status/account/connect/disconnect
routes and omits cleanup retry. Without either bit the original router UI stays
hidden. The original capability retains its meaning; no protocol floor rises.
Recovery routes live in their own route module so the capability audit checks
their contract independently of the original pairing and discovery routes.

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

AAR owns a SHA-pinned cross-repository suite exercising real YA HTTP routes,
supervisor and native adapters with synthetic CLI peers and loopback upstreams.
It covers both providers' continuation, restart, streaming interruption, durable
failed-launch cancellation, disconnect recovery and refusal of direct fallback.
See [AAR integration tests](https://github.com/kzahel/agent-auth-router/tree/main/integration/yepanywhere).

Recovery-specific service/component tests cover read-only observations, explicit
retry, safe errors, disabled-account refusal, older-server fallback and stale
source responses. A narrow browser component fixture checks sequential socket
typing during status refresh with 48 synthetic accounts and concurrent rendering,
plus desktop/phone recovery controls. It uses synthetic API responses; actual
control/credential boundaries are covered by the server and cross-repo suites.

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
