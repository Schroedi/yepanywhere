# Project Queue rejects synced attachments from multiple batches

**Impact: medium — attachment-bearing enqueue/edit fails after cross-device merging.**

Draft synchronization permits one snapshot to contain attachments staged in
different batches by the same account. The composer preserves each reference's
batch ID and uses the first reference's batch as the envelope's `batchId`.

`ProjectQueueService.normalizeStagedAttachmentRef` still requires every
reference's `batchId` to equal the envelope's batch. A legitimate merged draft
therefore fails before attachment transfer. The staging service already accepts
the multi-batch handoff when draft protection is configured and validates every
reference against its own canonical record/account.

## Evidence

A memory-only `ProjectQueueService.createItem` request with complete references
from `device-a` and `device-b` failed with:

`message.stagedAttachments.refs[1] is missing required fields`

No queue item was accepted. Both references had all required fields; the second
batch mismatch caused the rejection. The copied-ID fix does not reach this
earlier normalization check.

Owning contracts: [`draft-synchronization.md` — Attachments](../topics/draft-synchronization.md#attachments)
and [`project-queue.md` — Attachments](../topics/project-queue.md#attachments).
Relevant code: `packages/server/src/services/ProjectQueueService.ts`
(`normalizeStagedAttachmentRef`, `normalizeStagedAttachments`) and
`packages/server/src/uploads/AttachmentStagingService.ts`
(`prepareDraftAttachmentsForQueue`, `getValidatedRecords`).

Allow each reference's canonical batch through normalization while retaining
the account/ownership checks. Cover create, edit with retained references,
reload and promotion across batches, plus a foreign-account refusal. Do not
remove the same-account staging validation to make the payload pass.

Not fixed during the single-batch copied-ID repair: captured as an additional
audit finding for a separately verified change.

Found 2026-09-30 while auditing draft sync after a failed Project Queue enqueue.
