# A localhost client request has no deadline, so a slow server has no terminal state

`fetchPlainJSON` (`packages/client/src/api/plainFetch.ts:132`), `fetchPlainBlob`
and `fetchPlainResponse` pass no `AbortSignal`, and neither does
`LocalhostSourceTransport.fetch`
(`packages/client/src/lib/transport/LocalhostSourceTransport.ts:144`). A request
to a server that accepted the connection and then stopped answering stays
pending for as long as the browser allows.

The tunneled path does bound it: `RelayProtocol` rejects a request after 30
seconds (`packages/client/src/lib/connection/RelayProtocol.ts:631`, and again at
`:725`). So the same screen has a terminal state through the relay and none on
localhost, which is both the maintainer's daily path and the one that stalled.

Every view gated on a response inherits that. `ProjectsPage`
(`packages/client/src/pages/ProjectsPage.tsx:244`) returns a bare loading div,
with an error branch immediately below it at `:245` — but a request that never
settles reaches neither branch, so the page shows "Loading" with no explanation,
no elapsed indication, and no retry. `SessionPage` (`:5123`, `:5727`),
`GitStatusPage` (`:928`), `NewSessionPage` (`:182`) and
`RemoteExecutorsSettings` (`:155`) have the same shape. The user-visible
symptom on 2026-09-10 was a black Loading screen and a New Session pane stuck on
"Loading...", while `GET /health` was taking 4-13 seconds; see
[data-dir-filesystem-unchecked-for-sqlite-locks](data-dir-filesystem-unchecked-for-sqlite-locks.md)
for that server-side cause.

Note what is *not* broken, so a fix does not go looking there. The polling and
refresh layer already handles slowness correctly: incremental session refresh is
single-flight with a last-wins pending slot
(`packages/client/src/lib/sessionDetail/sessionDetailCoordinator.ts:802`), the
public-share status poll reschedules from `.finally` rather than on a fixed
interval (`packages/client/src/hooks/usePublicShareStatus.ts:156`), and
reconnect uses capped exponential backoff with jitter
(`packages/client/src/lib/connection/ConnectionManager.ts:476`). Nothing piles
up concurrent requests against a stalled server.

Cheap fix: give the localhost transport the same deadline the relay already
applies, as an `AbortSignal` the caller can override for genuinely long
operations (uploads, full-history reads). Separately, a view gated on a
response wants a third state between loading and error — still waiting, this is
taking unusually long — rather than an indefinite spinner. That second half is
the user-visible one and is worth its own pass over the gates listed above.

Found 2026-09-10 while inspecting the client for burn and blocking under the
now-fixed network-home-directory server stall.
