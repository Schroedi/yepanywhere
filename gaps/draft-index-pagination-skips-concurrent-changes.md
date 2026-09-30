# Draft index pagination can acknowledge an unseen edit

**Impact: medium — a remote draft can remain stale until another change or focus refresh.**

`DraftSyncClient.refreshNow` reads `/drafts/index` in pages and assigns
`this.sequence = result.sequence` on every page. Server pages are separate reads,
not one snapshot. If a slot on an earlier page changes while a later page is
being fetched, the client retains that slot's old revision but adopts the later
page's new owner sequence. `/drafts/changes?after=<new sequence>` then reports no
change, so the earlier slot's body is not refreshed.

This affects accounts with more than one index page (100 retained slots,
including empty tombstones). It is not a typing-latency issue and does not
require a failed request.

## Evidence

A focused `DraftSyncClient.refresh` reproduction returned:

- Page one: the observed slot's already-acknowledged revision, owner sequence 1,
  and a next-page cursor.
- Between pages: the server changed that slot's text and revision.
- Page two: owner sequence 2, no updated entry for the earlier slot, end of index.

The client advanced its cursor to 2 and scheduled no body read for the changed
slot. Its local draft remained the old text. The change long-poll cannot detect
the missed edit until another sequence increment or independent refresh.

Owning contract: [`draft-synchronization.md` — What follows you between devices](../topics/draft-synchronization.md#what-follows-you-between-devices).
Relevant code: `packages/client/src/lib/draftSyncStorage.ts` (`refreshNow`,
`watch`) and `packages/server/src/routes/drafts.ts` (`/index`).

A complete index read must not acknowledge changes that its earlier pages did
not observe. Retain a safe starting cursor or detect sequence changes during
pagination and arrange another bounded refresh. Add a two-page regression with
an edit to page one's slot during the second request and no later edits.

Not fixed during the attachment-ID repair: this is a separate metadata-read
consistency change, without any need to modify the queue handoff.

Found 2026-09-30 while auditing draft sync after a failed Project Queue enqueue.
