# Client errors persist until a window refresh: downloads fail, attachment sends stay unacknowledged

Reported by the user on 2026-10-13 (direct observations):

- **Download failure.** In the file viewer, Download for
  `/local/graehl/trtllm-speculative/pii-software-v1.5/software-v1.5.tgz`
  (19.3 MB; the file exists, and the viewer showed its type and size) failed
  with the toast "Could not download software-v1.5.tgz: Failed to fetch".
- **Unacknowledged sends.** In the same period, a message sent with an
  uploaded attachment was never shown as acknowledged, although it plainly
  arrived (the receiving agent acted on it). The user describes the error as
  the same sort of database error. Cancelling the send then left a stale
  "unsent draft" for a message that had already been delivered.
- **What cleared it.** Refreshing the browser window cleared the errors. A
  full restart of YA and its provider hosts did not, so the faulty state lives
  in the client page, not the server.

Working hypothesis (user's, unverified): client-side storage, such as an
IndexedDB connection or transaction that went bad and stays broken for the
page's lifetime, or a similar long-lived client cache. Whether the download
failure and the acknowledgement failure share one cause is not established.

## Where to look

- Attachment storage: `packages/client/src/lib/attachmentPreviewCache.ts`
  (IndexedDB). Upload-attached sends touch it; a failing write or read there
  could block the delivery bookkeeping.
- Delivery and draft reconciliation: `packages/client/src/lib/deliveryState.ts`,
  `packages/client/src/lib/draftSendReconcile.ts`,
  `packages/client/src/components/DraftSyncNotice.tsx`. A send must not
  remain "unsent" once the server has accepted it, and cancelling it must not
  resurrect a delivered draft.
- Downloads: `packages/client/src/components/FileResourceActions.tsx`
  (`useSaveResourceDownload`, the transport-backed Blob loader) and
  `packages/client/src/components/FilePathLink.tsx`.
- Client diagnostics: `packages/client/src/lib/diagnostics/` (IndexedDB-backed
  log collector) may hold the error from that window.

Related open gaps: [session-path download start delay](session-path-download-start-delay.md)
(same project's files, a different symptom),
[new-session draft clear](new-session-draft-clear-captures-after-submission.md)
and [browser upload interruption](browser-upload-interruption-unhandled-rejection.md).

## Discriminating checks

When it recurs, before refreshing: capture the browser console and the
IndexedDB error names (`InvalidStateError`, `QuotaExceededError`,
`UnknownError`, a closed or blocked connection after a `versionchange`), the
failing request in the network panel for the download, and the client
diagnostics log. Then establish whether one stuck storage handle is shared by
the download path and delivery state. The repair belongs in the owning layer:
reopen or fail clearly on a broken handle, and never leave a server-accepted
send unacknowledged.

Not fixed here: noticed while delivering PII submission files through the
file viewer; another agent will take it (user).

Found 2026-10-13 while downloading release archives through YA's file viewer.
