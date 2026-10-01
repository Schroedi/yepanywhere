# Draft sync rereads the complete index after each observed change

`DraftSyncClient.watch` receives an account change counter from `/drafts/changes`
and calls `refresh`, which reads every `/drafts/index` page. It receives no list
of changed slots. Pages include cleared records retained for 30 days, so a user
with few active drafts can still accumulate many pages. At 100 distinct synced
session drafts per day, the retained index can approach 3,000 records and roughly
30 requests per complete refresh. Coalescing avoids overlapping refreshes but
does not reduce the records read by each one.

The pagination correctness repair retains a safe first-page cursor, so changes
made during a scan trigger catch-up instead of being missed. It deliberately
leaves this separate traffic cost and the clear-record retention unchanged.

Consider bounded metadata catch-up by sequence, including clears, with a full
index for discovery/recovery and explicit behavior after retention gaps. Preserve
account/resource authorization, offline deletion reconciliation, expiry safety,
coalescing, teardown, and immediate local input. Measure request counts and
handoff latency under a 3,000-record index before choosing the follow-up protocol;
avoid claiming a latency improvement from local unit-test durations.

Owning contract: [Draft synchronization](../topics/draft-synchronization.md).
Relevant paths: `packages/client/src/lib/draftSyncStorage.ts` (`watch`,
`refreshNow`) and `packages/server/src/routes/drafts.ts` (`/changes`, `/index`).

Found 2026-10-01 while repairing draft-index catch-up for frequent multi-device
switching. Incremental synchronization remains a separate follow-up.
