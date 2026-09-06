# Codex asynchronous questions lack dedicated answer controls

Priority: high (P1), explicitly requested by the maintainer.

YA supports readable text and transport/persistence for Codex
`request_user_input_async`, but does not expose its structured questions as
answerable controls. This is partial support, not a missing tool or a completely
lost question. Users can read the question and type an ordinary message, but
cannot select its supplied choices, answer through a question-specific control,
or see question-specific pending/submitted state.

The maintainer reports seeing `Q1:` questions and reasonably reading them as
plain text. That observation is consistent with this fallback, but no specific
observed message was correlated to async metadata; the prefix alone does not
identify the tool that produced it.

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

## Required closure

1. Present each async question with its supplied choices and a free-text reply
   on desktop and mobile; support questions without choices and multiple
   questions in one message. A suggested/default selection must never submit
   automatically. Keep the source question identifiable while later agent
   output continues.
2. Submit the answer as an ordinary user message associated in visible content
   with the question being answered. Use existing main-session send/steering
   semantics, including the case where the originating turn has already ended.
   Do not respond to a nonexistent input-request RPC or mark the agent blocked
   merely because an async question is unanswered.
3. Preserve a usable pending/submitted interaction across continued output and
   reload. Do not duplicate live and durable question copies, lose a draft on
   subsequent output, or report submission as provider consumption. Decide
   dismissal, multi-question batching, and response association at the owning
   UI boundary before implementing.
4. Exercise the real client path with an async agent-message fixture while
   subsequent work streams, then answer and verify the ordinary-message
   request. Cover free text, choices, multiple questions, reload, and a late
   answer after turn completion. Confirm ordinary blocking questions and
   approvals retain their separate behavior. Run a bounded real-provider smoke
   before claiming complete support.

## Candidate interaction, not a settled layout

The maintainer suggested a pending-questions list toggled by a keystroke,
with a dismissible floating presentation and an anchor/preview of each
question's transcript context. A corresponding tappable toggle would make
the same list available on mobile. Dismissing the floating view need not
answer or discard its questions. Exact placement, shortcut, grouping, and
whether pending state is shared across viewers remain design choices.

An answer can be a formal text reply beginning with the question's tag and
enough of its title/context to identify the referent, delivered as steering
while the agent is busy or ordinary input after it becomes idle. This fits
the provider's existing ordinary-user-message reply contract. A tag such as
`Q1:` is text, not a provider answer RPC id; the async schema provides titles
and options rather than per-question ids. Avoid ambiguity when several
messages reuse a tag by retaining the source message association and quoting
the question as needed. Do not require the model to infer the referent from
a bare choice such as `yes` or `option 2`.

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
