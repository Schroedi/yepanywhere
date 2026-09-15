# Server work continues after the client that asked for it has gone

The relay transport now honours `init.signal`
(`packages/client/src/lib/connection/RelayProtocol.ts`), so a client-side abort
finally releases the caller and its pending slot on the hosted client as it
already did on direct fetch. That closes the client half. The server half is
open: a request whose reader navigated away, closed the tab, or superseded the
query still runs to completion.

## Where it stands

`@hono/node-server` aborts `c.req.raw.signal` when a client connection closes
early, but it creates that controller lazily on first `.signal` access, so a
handler that never reads the signal is never told. Five files out of roughly
262 route handlers read it: `sessions.ts:6022`, `provider-host.ts:203`,
`browser-debug.ts:95`, `experimental-conversation.ts:29`,
`tool-commentary.ts:56`.

On the client, of 120 files combining `useEffect` with `await`, 74 use a
`cancelled`/`disposed` latch and 5 construct an `AbortController`; roughly 47
have neither. The latch is the right fix for stale `setState` and the wrong
fix for wasted work — the request completes, the body parses, and the result is
dropped. `components/session-search/ContentSearchScan.ts` is the working model
for the other shape: one controller, the signal re-checked at every yield point
(`:258`, `:272`, `:276`, `:323`, `:353`, `:407`), and `waitForCapacity` (`:84`)
parked on the signal rather than a timer.

None of the API clients accept a signal, so a page that wants to cancel mostly
cannot: `api/client.ts`, `api/fileClient.ts`, `api/gitClient.ts`,
`api/reviewClient.ts` and `api/sourceApiFetch.ts` have no `signal` parameter.
The exceptions are `api/sessionClient.ts:51` and `api/upload.ts:23`.

## Why this was not swept in place

Three obstacles make it a design pass rather than a mechanical edit, and each
one produces a wrong fix if applied blind.

**A relay client has no server-side disconnect signal at all.** Relay requests
are multiplexed over one WebSocket and replayed into Hono by
`routes/ws-relay-handlers.ts:787`, whose `RequestInit` carries either no signal
or `preauthController` — scoped to preauth public-share requests, not to a
browser tab. So `c.req.raw.signal` reflects the relay's connection to YA, never
the reader's. Giving hosted clients server-side cancellation needs a `cancel`
frame in the relay protocol, which is a wire-format change subject to
`DEVELOPMENT.md` § Client/Server Compatibility Review.

**Coalesced work has more than one owner.** `session-content-search.ts:155`
passes `AbortSignal.timeout(30_000)` where the request signal appears to
belong, but that read runs through `SourceVersionedSingleFlight.run`, which
joins concurrent callers on the same `(key, sourceVersion)` and hands them all
one promise (`lib/sourceVersionedSingleFlight.ts:143`). Aborting the shared
compute because the first caller left would fail every joiner. Cancelling
coalesced work correctly needs the abort to fire when the *last* interested
caller goes, which the single-flight has no notion of today. Note the contention
this costs: the route admits only four concurrent searches
(`session-content-search.ts` `active >= 4`), so an abandoned scan holds a slot
that a present reader waits on via the 429 path.

**Some long work must not be cancelled.** The expensive spawns in
`routes/git-status.ts` are `fetch` (`:235`), `pull --ff-only` (`:382`) and
`push` (`:468`). Interrupting those because a tab closed would abort a mutation
mid-flight. They are correctly bounded by their own timeouts and belong on a
deny-list for any cancellation sweep, not on its worklist.

## Shape of the wanted work

Ordered so each step is useful alone: give the read-only API clients an optional
`signal` and thread it from the pages that already latch; teach the single-flight
to abort on last-caller-leaves so coalesced reads become cancellable; then
decide whether a relay `cancel` frame earns its compatibility review. Server
routes reading `c.req.raw.signal` pay off only for direct-access clients until
that last step lands.

This is also the concrete form of `topics/architecture-mandates.md` § Resource
Quiescence ("closed tabs must release server subscriptions, file watchers, poll
timers...") for request-scoped work, which that mandate does not currently
enumerate.

Found 2026-09-15 while auditing abort propagation after fixing the relay
transport's dropped `signal`.
