# A long-silent active turn still animates progress phrases

`ProcessingIndicator` (`packages/client/src/components/ProcessingIndicator.tsx`,
rendered from `MessageList.tsx`) takes only `isProcessing`. It keeps rotating
"Cooking..." / "Pondering..." for as long as a turn is open, however long the
provider has been silent. The liveness snapshot already distinguishes
`verified-waiting-provider` and `long-silent-unverified`
(`MessageInputToolbar.tsx`), but the transcript animation ignores it, and the
animation reads as progress. `topics/session-liveness.md` says long-silent
states "should not be hidden behind calm queue wording or spinner animation".

Incident: Codex session `01a16a16-00e5-7ad3-b041-e4b33c053db9` (Codex 0.164,
code mode) looked active for about 20 minutes with no visible output. Each
large `exec` tool call ran 3–5 minutes of tool-input generation, which the
app-server does not report at all, and each user steer cancelled it. The user
reasonably suspected the animation was stale and could not tell generation
from a hang.

What YA can and cannot know for Codex:

- The `thread/read` probe proves Codex considers the turn active. It cannot
  separate tokens still arriving from a stalled upstream stream.
- The 0.164 app-server schema has no notification while tool-call input is
  generated; `item/started` for `exec` fires only at execution.
- Codex's trace log `~/.codex/logs_2.sqlite` (`logs.thread_id`) records
  `Output item item_type="custom_tool_call"` when a call starts generating.
  It is an uncontracted debug log and records only the start.
- Steers into such a turn are logged by Codex as unhandled
  `response.interrupt.accepted` / `response.output_item.interrupted` and
  discard the partial call without a rollout record.

Fix direction:

1. After a quiet threshold in an open turn, replace the phrases with plain
   status from the liveness snapshot, e.g. "Codex turn active (checked
   19:44) · no output for 3m 10s"; keep phrases only while output is recent.
2. Optional detail for Codex: "tool call generating since 19:40:33" from the
   trace log, labelled as provider-log evidence, never as user-visible
   progress, and absent when the log is unreadable.

The companion defect, steers discarding in-flight generation, is fixed: YA
launches Codex with `instant_interrupt` disabled so a steer waits for the
current tool call (`topics/steer-queue-provider-differences.md`). The status
line still matters, because a long silent generation remains silent.

Not fixed in place: this was a diagnosis session; the change touches liveness
presentation contracts and needs typing/latency checks on the composer path.

Found 2026-10-23 while diagnosing an apparently idle Codex session.
