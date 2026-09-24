# A YA provider-worker failure reads as a user interrupt

When the hosted provider worker fails (for example the replay-bound overflow in
`packages/server/src/sdk/providers/provider-session-owner.ts` `bufferEvent`),
YA tears down the Codex app-server and Codex records the turn as
`turn_aborted` with `reason: "interrupted"`. The transcript then shows
"Interrupted" exactly as if the user had pressed stop. The only attribution is
the live `error` event `Process` emits (`packages/server/src/supervisor/Process.ts`,
the `process_error` path) and the server log; after a reload, nothing
distinguishes a YA-caused teardown from a deliberate interrupt.

Not fixed in place: the durable transcript is provider-owned
([stream-persisted-render-parity](../topics/stream-persisted-render-parity.md)
forbids a parallel YA record for provider output), so a durable marker needs a
deliberate display-history exception, like the goal-command receipts, or a
session-metadata annotation keyed by the aborted turn id. The cheap partial
fix is to make the live `error` event render as a visible, attributed row
("YA provider worker failed: …") until reload.

Found 2026-09-24 while diagnosing two "Interrupted" Codex turns caused by
cumulative live command-output snapshots overflowing the replay buffer.
