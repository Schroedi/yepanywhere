# Codex asynchronous questions lack pending-question visibility

Priority: high (P1), explicitly requested by the maintainer.

YA supports readable text and transport/persistence for Codex
`request_user_input_async`, but does not expose its structured questions as
answerable controls. This is partial support, not a missing tool or a completely
lost question. Users can read the question and type an ordinary message, but
cannot select its supplied choices, answer through a question-specific control,
or see question-specific pending/submitted state.

The maintainer reports seeing `Q1:` questions and reasonably reading them as
plain text. The September 7 observation below now correlates a displayed
question with a confirmed async tool invocation; the prefix alone still does
not identify the tool that produced it.

Related contracts: [provider output](../topics/provider-output-contract.md),
[provider refresh](../topics/provider-refresh.md), and
[Codex question/permission mapping](../topics/codex-permission-mode.md).
This is separate from the proposed user-to-assistant
[one-shot question aside](../topics/provider-agnostic-btw-asides.sketches.md).

## Evidence and current behavior

Inspected YA at `bab9357c9` and official Codex `rust-v0.153.3`, commit
`b1a547b1f73ce86205d9222ac19cff334b3b7a2e`, on 2026-09-06.
Contributing-model: 6-Astra.

- Codex's `RequestUserInputAsyncHandler::handle` in
  `codex-rs/core/src/tools/handlers/request_user_input_async.rs` emits an
  `AgentMessage` with `delivery: async`, readable fallback text, and ordered
  structured questions. It returns `accepted: true` immediately so independent
  work continues. A later reply is ordinary user input; there is no outstanding
  `item/tool/requestUserInput` RPC to answer.
- YA's `CodexProvider.normalizeThreadItem` and `convertItemToSDKMessages` in
  `packages/server/src/sdk/providers/codex.ts` preserve the assistant text,
  provider item id, `codexAgentMessageDelivery`, and `codexAsyncQuestions`.
  `packages/server/src/sessions/normalization.ts` preserves the same metadata
  from the durable canonical `item_completed` event. The compatibility work
  landed in `dff8b3ea1`; this gap must not redo that normalization work.
- Neither `codexAsyncQuestions` nor `codexAgentMessageDelivery` has a consumer
  in `packages/client` or `packages/android` in the inspected tree. The shared
  `AppMessageExtensions` declares both, but no client rendering or answer path
  recognizes them.
- `SessionPage` renders `QuestionAnswerPanel` only for a
  `pendingInputRequest` whose `toolName` is `AskUserQuestion`. Its
  `handleQuestionSubmit` calls `api.respondToInput` with that pending request's
  id. The async assistant message does not create such a request. Reusing
  that RPC response path would be incorrect even if the visual controls are
  shared.
- The two focused existing tests pass without warnings:
  `renders asynchronously delivered agent messages` in
  `packages/server/test/sdk/providers/codex.test.ts`, and
  `keeps standalone async agent questions and skips ordinary duplicates` in
  `packages/server/test/sessions/codex-normalization.test.ts`. Despite the
  former test's name, it tests provider-to-SDK conversion, not browser UI.

Verification command:

```bash
pnpm --filter @yep-anywhere/server exec vitest run \
  test/sdk/providers/codex.test.ts \
  test/sessions/codex-normalization.test.ts \
  -t 'asynchronously delivered|standalone async'
```

Result: 2 tests passed, 155 deselected. This is a source-backed missing-client-
path finding with normalization checks, not a live browser/provider round-trip
reproduction. No runtime source was changed for this investigation.

## Confirmed live observation, 2026-09-07

Contributing-model: 6-Astra.

In Codex session `01a07aa1-1062-7342-ab8e-7781f81da6cc`, the agent called
`request_user_input_async` with a question about waiting for another YA session
or coordinating a handoff, and the options `Wait for it to finish` and
`Coordinate the handoff`. The tool immediately returned `accepted: true`.
The maintainer supplied a screenshot showing the question and both choices as
an ordinary Markdown bullet list without visible answer controls, then asked
whether the message was marked as an async question. The `Q:` prefix was
agent-authored text, not the structured discriminator.

The maintainer explicitly requested clickable choices: "it would be useful
in multi-choice for me to click the one i want". Treat supplied-choice controls
as requested delivery alongside pending-question visibility; do not leave
them indefinitely behind a count-only implementation. Preserve free-text
replies and the nonblocking lifecycle. An initial suggested selection must
never submit itself. The chosen interaction below uses deliberate click-to-send
for supplied choices and explicit submission for free-form replies.

Current checkout `84891372f` still declares `AgentMessage.delivery` and
`questions` in the generated Codex protocol and preserves their normalized
fields in `CodexProvider`. This is a confirmed tool-call/screenshot correlation,
not a captured browser network trace or a verified answer round trip. The
screenshot remains in the originating session attachments; its readable
content and reproduction inputs are recorded here for a fresh checkout.

## Delivery requested by the maintainer

The minimum is an indication of how many unanswered questions the user has
not yet seen, especially recent questions that have scrolled away during
continued agent output. The proposed access point is a small count in the
composer bottom bar, within the content width even on wide screens.
The count should lead to the questions and their source context, with both
keyboard and tappable access. A count-only first delivery can be incremental,
but does not close the September 7 request for clickable supplied choices.

Keep unseen and unanswered distinct. Receiving or rendering a message does
not mean the user saw it; scrolling it offscreen does not mean it was
answered. Closing the floating list does not resolve its questions. The
chosen unaddressed indicator below makes recent pending questions noticeable;
aging and explicit dismissal reduce reminders without asserting an answer.

Define seen detection, the scope of "recent", and state across reloads or
multiple viewers before implementation. A proposed seen signal is actual
visibility of the question or its contextual preview, not merely DOM mounting
or receipt while a tab is hidden. Count individual questions, not message
envelopes. Ordinary free-form replies do not carry a provider answer id, so
answered-state association needs an explicit design; a random subsequent user
message must not clear every pending question.

## Minimum verification and subsequent coverage

1. Exercise the real client path with async questions arriving while later
   work streams. Verify the count for offscreen/unseen questions, discovery
   through the indicator, and separate seen versus answered state. Include
   multiple questions in one message, live/durable deduplication, reload, and
   desktop/mobile access.
2. Preserve normal agent progress and the main composer. Do not create a
   blocking input request merely to obtain an unanswered-question indicator.
   Ordinary blocking questions and approvals retain their separate behavior.
3. Any question-specific reply action submits an ordinary user message with
   the question identified, using steering while busy and ordinary sending
   after turn completion. Do not respond to a nonexistent input-request RPC
   or label a sent reply as proven provider consumption. Verify a late reply
   as well as an active-turn reply when adding that action.
4. Before claiming complete rich-answer support, cover supplied choices,
   free-text-only questions, multiple questions, retained drafts during output,
   and no automatic submission of a suggested/default selection. Run a bounded
   real-provider smoke; passing normalization tests alone is insufficient.

## Chosen reply interaction, 2026-09-07

Contributing-model: 6-Astra.

The maintainer chose a separate in-transcript composer directly beneath the
question for free-form replies, with return-position and focus restoration on
submit. This records the design decision; implementation and browser/provider
verification remain open.

- Navigate to the original question before answering, including free-form
  replies. Close the discovery menu, highlight the question, and leave some
  preceding context visible. The menu locates questions; answers belong at
  their transcript locations.
- Render supplied options as clickable bullet rows from `codexAsyncQuestions`,
  preserving text and order. Codex provides structured `title` and optional
  `options: string[]` plus generated Markdown fallback text. Do not infer
  answer controls from arbitrary Markdown lists. Make click-to-send explicit
  and keyboard accessible; a preselected option never sends itself.
- Entering the question's reply view opens its separate composer and places
  keyboard focus in the free-form field, with choices above it. Do not trap
  focus or repeatedly reclaim it after the user moves elsewhere. Streaming
  and rerendering must not steal focus or lose the draft. Keyboard opening
  and layout changes must keep the question visible on phones.
- The inline draft belongs to the source question and survives menu dismissal
  and transcript virtualization. Preserve the main composer's existing draft.
  Merely focusing or filling a field neither submits nor resolves a question.
- Retain `Quote reply in main composer` as a secondary action, not the primary
  free-form flow. It navigates to the question, then inserts the quote and
  focuses the main composer while preserving existing text and undo. The
  maintainer expects little need for this once inline reply restores position.

Both choice and free-form submission produce an ordinary user turn quoting
the complete question, followed by the exact chosen option or authored reply:

```markdown
> Q: Should I wait for the other session or coordinate a handoff?

Coordinate the handoff.
```

Preserve an existing question tag, but do not depend on tags being unique.
Associate the reply internally with the source message id and question index;
keep these identifiers out of ordinary prose. A `Q1:` tag is not a provider
answer RPC id. Send through steering while busy and ordinary input when idle.
Show `Reply sent` after successful submission, without claiming provider
consumption. Failed submission retains the answer/draft and pending status.

### Return position, Follow, and keyboard focus

Capture the former reading anchor and Follow intent before navigating to the
question. Navigating among questions during that visit must not replace the
original return destination. Offer an explicit return action during the visit.
If the question is already in view, capture the current state before entering
its reply editor.

Every successful choice or free-form submit restores that former state and
places keyboard focus in the main composer. If Follow was active, return to
the current live bottom and restore Follow; otherwise restore the saved
content anchor and offset with Follow off. Return after each answer even if
other questions in the message remain pending. Their count and navigation
remain available for another visit.

Focus the main composer without allowing browser focus scrolling to override
the restored transcript position. A failed send keeps the current position
and draft; it does not perform the successful-submit focus/return transition.
If submission completes asynchronously after the user explicitly navigates or
focuses elsewhere, do not override that newer intent with stale restoration.

The existing send path forces bottom-follow. Implement this reply-specific
policy through the owning scroll transition, preserving the stability contract
in [scrollback view stability](../topics/scrollback-view-stability.md), rather
than jumping to the bottom and then correcting the position afterward. Verify
both prior regimes, choice/free-form sends, mobile keyboard geometry, failure,
and focus movement during submission.

### Chosen indicator, preview menu, and dismissal

The small toolbar rectangle uses an outlined speech bubble containing `?`,
muted warm amber (`#D8B477` in the mockup), a faint amber fill, and a subdued
border. It should be noticeable but ignorable: no pulse, warning banner, or
focus theft. With room, show `3 questions · latest 1 turn ago`; the age is
that of the most recent question still counted. Drop the age first, then the
word `questions`, retaining the icon and count at compact widths. Preserve
an informative accessible label regardless of visible text. Keep the indicator
in the persistent composer toolbar when the input itself is compact/collapsed;
composer expansion is not a prerequisite for discovering questions. Available
width controls label detail; reminder aging controls visibility.

Use `Questions` as the menu heading and quiet button label. The preview menu
opens upward and may temporarily cover the composer without
altering its draft. It can be wider than the button, aligned to its right edge
and capped by the viewport. List oldest questions at the top and newest at the
bottom, nearest the trigger. Each row shows a muted bare turn-age number in
the left margin (for example, `2`), outside the question's differently colored,
outlined box. Align the age with the question text; use muted color with
legible contrast against the menu background. Keep the dismiss control inside
the box at the right. Show actual question text on one line with an ellipsis
if necessary. Do not add a separate age line or visible `turns ago`
suffix per row; retain that meaning in the accessible label. Thin horizontal
rules separate rows. Selecting the row closes the menu and reveals the full
question with its inline reply field in transcript context. Answer choices there can
wrap across multiple lines; menu previews are navigation, not answer controls.

The maintainer confirmed `×` for a small dismiss control at each row's right
edge, with a generous mobile tap target. Its click must not also navigate.
Right-click or long-press opens a one-action `Dismiss` menu; long-press alone
does not remove an item. Dismiss silently removes that reminder and updates
the count, without confirmation or toast. It does not delete transcript text
or mark the question answered. Provide `Show dismissed` in the menu so the
user can recover dismissed items. Closing the menu alone dismisses nothing.

### Reminder aging and remaining decisions

Use two stages of reduced visibility based on subsequent composer typing or
conversation turns. First, age questions out of the visible unaddressed count
and remove the amber emphasis when none remain recent; retain a quiet menu
button without the count or age. After a longer interval, hide that dedicated
button entirely. Keep access to older questions through the ordinary overflow
menu. A new question restores the indicator; it must not silently count old
aged-out or dismissed questions as new again. Aging only changes reminder
visibility, never answered state or transcript content.

Exact decay thresholds, what counts as a turn or meaningful composer typing,
shortcut, seen detection, and state persistence
across reloads/viewers remain implementation decisions. Avoid retiring a
control while its menu is open or focused. Verify both decay stages, arrival
of a new question, explicit dismissal and recovery, chronological ordering,
and that the full question remains reachable from an ellipsized preview.
The source-message association specifies reply identity, but does not by
itself provide durable or cross-viewer answered/dismissed state.

Likely approach: build an async-question adapter over the already-normalized
assistant fields and reuse bounded question-control presentation where useful,
with an ordinary-message submit callback. The existing question panel's
pending-approval lifecycle is not the async question lifecycle. Prefer existing
server fields and routes; any newly required client/server contract still needs
the normal compatibility review.

Not fixed in place because the request authorized investigation and a gap,
and correct closure spans answer UI, nonblocking lifecycle, delivery, and
live/durable behavior. It is not a one-line provider registration fix.

Found 2026-09-06 while distinguishing Codex assistant-to-user async questions
from YA's user-to-assistant question-aside proposal.
