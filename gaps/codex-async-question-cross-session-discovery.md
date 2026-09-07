# Async questions are invisible outside their open transcript

The transcript UI landed in `a878de3bb`, but its question inventory is owned by
the mounted `AsyncQuestionsProvider`. Inbox and sidebar session rows cannot
show questions from a session the browser has not opened. Reading every session
transcript in the browser would violate the bounded list-view design.

The maintainer requested question counts in Inbox and beside sidebar sessions,
which are their primary navigation surface. Right-clicking a question count
should open question previews directly, grouped by session for an aggregate
count. Selecting a preview navigates to the original question and its inline
reply composer. After answering from this cross-session navigation, return to
Follow and focus the main composer. Keep the existing local dismissal, answer,
aging, and one-slider preferences; ordinary unread-session counts remain a
different quantity from question counts.

Related contract: [provider output](../topics/provider-output-contract.md).
The existing transcript behavior and its older-server fallback remain valid.

## Compatibility decision awaiting approval

The optional-feature corpus is `v0.8.0` (2026-08-31) and `v0.8.1`
(2026-09-05), the latest two stable tags and the stable releases in the prior
14 days. Both lack question summaries on list/Inbox/activity payloads.
`v0.8.1` preserves structured questions in session detail; `v0.8.0` does not.

Proposed capability: **session-async-questions**, permanent and
version-implied from the introducing release. It covers an additive question
summary on existing session-list, Inbox, and session-updated payloads, with
stable source-message/question identity, question text, and subsequent-user-turn
age. It owns no new reply route and does not extend an existing capability's
meaning. Without it, retain the current transcript question UI and omit
cross-session counts/menus; issue no new request. The earlier compatibility
approval covered transcript fields and reply routes only.

Approval was requested asynchronously in session
`01a07ae3-7a52-7231-b448-e00eb3edaa74` on 2026-09-07. Runtime work is waiting
for that decision, as required by `AGENTS.md` Client/Server Backwards
Compatibility. Do not treat this proposed contract as implemented.

## Implementation map and verification

- `CodexReader.applySummaryEntry` already recognizes canonical async
  `item_completed` records but currently increments only assistant count.
  Its retained full-summary path and live activity updates should expose the
  bounded question inventory without per-render transcript reads. Head-only
  summaries cannot honestly report absence of questions later in the file.
- `SessionUpdatedEvent`, session list summaries, Inbox serialization, and the
  client summary reducers must preserve the same optional projection. Observe
  existing generation/invalidation rules; avoid a polling loop or independent
  second summary store.
- Extract browser-local question state ownership from the mounted transcript
  provider so all surfaces share sent/dismissed/edit-age state and receive
  same-tab changes. Keep source/session isolation and cross-tab behavior.
- Reuse the question preview rows/menu presentation. `SessionListItem` owns
  both compact sidebar and card Inbox rows; `SidebarNavItem` owns aggregate
  Inbox navigation. Put interactive count controls beside links, not nested
  buttons inside anchors. Right-click and touch/keyboard access should reach
  the same menu. Aggregate menus group by session; individual menus retain
  oldest-first questions with newest at the bottom.
- Preserve original source identity through route navigation and history
  loading. Opening an off-window question must reveal its actual transcript
  site; successful reply from this entry point resumes Follow. Existing
  in-transcript navigation retains its saved reading-position behavior.
- Verify unopened-session discovery, live arrival, local answer/dismiss
  updates on all surfaces, source isolation, old-server absence behavior,
  grouped menus, late/busy replies, and desktop/phone captures.

Found 2026-09-07 while extending the maintainer's async question UI request.
