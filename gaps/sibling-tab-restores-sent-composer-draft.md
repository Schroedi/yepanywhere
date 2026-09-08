# Sibling tab restores the last sent prompt as an unsent composer draft

Opening a second tab on the same live session hydrates the composer from
localStorage with the text that tab A just sent. Tab A’s composer is
already empty and may still show `Sending` chips. The history in tab B
already contains that turn as a confirmed user prompt.

Observed 2026-09-08 on Codex session
`01a0821d-2a20-7411-992d-7f32f4e657ef`. A debug grant on the new tab
showed zero `Sending` chips and 21 confirmed user prompts; the user had
already cleared the resurrected composer text by the time of inspection.
`localStorage` key `draft-message-01a0821d-2a20-7411-992d-7f32f4e657ef`
is the per-session draft envelope.

## Mechanism

`MessageInput` calls `clearInput()` on submit
(`packages/client/src/hooks/useDraftPersistence.ts`). That empties the
live textarea and **keeps** the last text in localStorage as a recovery
copy (it refuses to write `""` over that copy).
`SessionPage.handleSend` calls `confirmInputClear()` only after POST
success, and only if the live composer is still empty. Until that
confirm, any new tab or reload reads the recovery copy as an unsent
draft.

If the POST return is delayed or the live echo is dropped, tab A stays
in the optimistic-cleared + recovery-draft state. Tab B’s REST snapshot
shows the turn as sent, then paints the same text back into the
composer.

This is independent of the `Sending` chip stall. That chip waited on a
live user-echo with no while-connected fallback; `c0c98ff80` fetches
durable history while a chip exists. It does not clear or suppress the
recovery draft for sibling tabs.

## Cheap fix

On session-detail hydrate, if the restored draft text equals the latest
self-sent user turn (normalized), discard the draft instead of filling
the composer. Alternatively, write the empty envelope on `clearInput`
and keep the recovery copy only in memory on that tab. Do not treat
`confirmInputClear` as sufficient: a second tab can load before it runs.

Found 2026-09-08 while inspecting a newly opened tab that had caught up
the same Codex session whose first tab still showed `Sending`.
