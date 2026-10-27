# Restart compaction retains its observer after dispatch refusal or throw

At baseline `1aba656fb`, `tryRestartCompact` in
`packages/server/src/routes/sessions.ts:1241` starts a boundary observer before
calling `queueMessage`. A refused dispatch returns `failed` without cancelling
that observer; a throwing dispatch propagates with the observer still alive.
Its listener and referenced timer remain until an event or the 12-second
deadline. This is bounded resource retention, not an indefinite leak.

The observation helper also creates its timer inside a promise executor before
subscribing. If subscription setup threw, dispatch would still proceed with
a rejected wait promise; a refused queue result would leave that rejection
unobserved. The current `Process.subscribe` only adds to a Set and does not
throw in ordinary operation, so this is structural failure-path analysis.

[Plan 163](../docs/tactical/163-http-independent-restart-compaction.md)
proposes a move first, then an explicit observer-lifetime fix in a separate
commit. No implementation is selected yet. After extraction, the cheap repair
is owned cleanup on refusal/throw and setup before dispatch. Keep result and
dispatch-exception semantics intact; verify real terminal paths with controlled
events/timers. Delete this gap in the fixing commit.

Found 2026-10-27 during independent review of the bounded HTTP-separation plan.
