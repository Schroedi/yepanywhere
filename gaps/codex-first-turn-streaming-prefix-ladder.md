# Live Codex commentary can render as a ladder of cumulative prefixes

During the first assistant turn of a new Codex session, the live transcript
showed the completed commentary paragraph followed by one bulleted row per
streaming snapshot: "I'll", "I'll read", "I'll read the", and so on. A page
reload removes every extra row. The observed case was a Codex 0.157.0 Astra
session in multi-agent mode whose first message carried a skill
(`01a0d957-2d1a-7331-b603-2f934dfe01d6`, 2026-09-25T16:12–16:14Z, on the
shared 3400 server, desktop browser).

## Earlier evidence (2026-09-25)

- **Codex's stream.** A captured 0.157.0 Astra turn sends every
  `item/agentMessage/delta` with the same `itemId` as `item/completed`, and
  that id equals the durable `msg_…` response-item id in the rollout.
- **Persisted state.** The rollout holds one message per commentary item, and
  the session detail API returns one assistant row with one text block.
- **Server accumulation.** `buildStreamingAssistantMessage` in
  `packages/server/src/sdk/providers/codex.ts` keys the accumulated text by
  turn and item and emits every snapshot under `uuid = itemId`. Each rung
  being a longer prefix shows that accumulator worked.
- **The client merges by id.** `mergeStreamMessage` and `mergeMessage` in
  `packages/client/src/lib/mergeMessages.ts` replace a same-id row rather
  than appending, and never concatenate content blocks.
- **Stale provider code.** The session's worker started at 16:12:39 on
  current source.

## Reproduction attempts that stayed clean

On an isolated instance from this worktree (fresh data, desktop viewport),
DOM text was sampled every 250–300 ms for a real Astra first turn with a
four-sentence commentary preamble and two commands. No prefix rows appeared
either when the session was started through the API and opened directly, or
when it was started through the `/new-session` composer, whose navigation
state connects the stream before the first transcript load and replays
buffered stream messages.

## Earlier candidate differences (superseded by the reproduction below)

1. The reporter's long-lived tab, including parked sessions kept mounted
   across A/B switches, versus a fresh page.
2. The temporary-to-real session id handoff: the server logged
   `session_id_mapping_updated` from a temporary id. Only one of the
   composer repro runs received a temporary id.
3. Multi-agent mode and code-mode (`custom_tool_call`) items, plus a skill
   attached to the first message.
4. Client appearance settings: the reporter's rows had bullet markers where
   the default view shows `>`, so the rendering view differed.

The earlier inference that each rung needed a distinct row identity was
incorrect: a bulk load can supply duplicate IDs, violating React's key
contract before normal stream merging runs.

## 2026-09-26 — reproduced server/client failure

Contributing-model: gpt-6-astra

The user reported the same ladder on the first prose response of session
`01a0df6d-6dbc-73a3-83fa-c46584427bc8`, with streaming display enabled.
Its rollout contains one completed commentary response item,
`msg_04161e038efac61d016ab82c691ec887d094aa2a168d0233af`, at
20:34:50.802Z. The original browser's REST response was not captured;
the exact historical timing remains inferred.

At `91c5aaaee`, deterministic probes reproduced this failure chain:

1. `Process.processMessages` retains `_isStreaming` assistant snapshots in
   replay history; it excludes `stream_event`, not these snapshots.
2. The session-detail route's `!session && process` fallback calls
   `sdkMessagesToClientMessages` on that history. The converter returns every
   snapshot without collapsing equal IDs. An actual route invocation with
   four cumulative snapshots returned four assistant messages, all with
   `uuid = id = msg-commentary`.
3. Client `loadPersistedTranscript` tags that response as JSONL and does not
   perform exact-ID deduplication. With Codex ID alignment enabled, the
   reducer and real transcript compiler produced four text render items
   with the same key.
4. A durable catch-up collapsed client state to one message. The compiler
   changed its render key from the string-content message ID to the
   array-content block ID (`msg-commentary-0`). A minimal React list keyed
   exactly as `MessageList` retained four DOM paragraphs despite having one
   message in state. React emitted duplicate-key warnings. Unmount/remount
   produced exactly one paragraph.

This reproduces the prefix ladder and reload-only cleanup without changing
provider IDs, generating a real model turn, or relying on multiple agents.
The first-turn trigger fits a detail read that initially misses the new
transcript, then reads replay history after asynchronous metadata lookup.
Long prompts and prose-before-tools are possible timing influences, not
demonstrated prerequisites. Pure WebSocket same-ID merging does not exercise
this bulk-load route, explaining why the earlier checks were insufficient.

The violated invariant is one current message per canonical identity at the
replay-to-transcript boundary. Fix the process-history projection to replace
same-ID snapshots in their original position, keeping the latest content;
also enforce exact-ID uniqueness at client bulk ingestion before projection.
Do not introduce prefix/content heuristics or alter Codex item IDs. Add route
and rendered reconciliation regression coverage, including distinct IDs with
identical text and streaming disabled. These probes diagnosed the defect;
production behavior remains unchanged pending implementation.

Separately, the generic markdown lane appends cumulative snapshots as deltas;
see [cumulative snapshot markdown](streaming-markdown-cumulative-snapshots.md).
That defect is not needed for the duplicate-key reproduction.

Found 2026-09-25 while diagnosing a user report after the Codex 0.157.0
refresh.
