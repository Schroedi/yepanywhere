# Patient topic shifts within an existing session

Status: sketch, not implemented. Requested 2026-10-18 while reviewing the
patient-queue setting. This is an optional manual action, not a change to
default sends or a new-session workflow.

## Intent

Queue a new topic for after the current work finishes, optionally suggesting
compaction when context usage exceeds a chosen percentage. Keep default
steering immediate. Waiting and compaction are separate choices: a user may
want either without the other.

## What YA already knows

- Claude patient delivery waits for verified idle and a quiet interval;
  provider-reported background work can prevent that idle state. Codex patient
  entries currently retain ordinary turn-end delivery timing.
- YA's `CodexProviderWorkTracker` records unified-exec terminals and subagent
  activity, plus foreground sleep/wait operations. Terminal inventory is
  reconciled at turn completion and updated from notifications between turns.
  Its snapshot deliberately returns `retained: false`: recorded Codex work
  does not currently block idle reaping or patient delivery.
- Foreground waits already keep a turn active. Waiting beyond turn completion
  matters for work left running afterward. A dev server is one counterexample
  to treating every surviving terminal as unfinished work for the current task.
- The inventory is incomplete by design; detached descendants and missing
  provider events cannot establish that all work finished. We have not measured
  how often finite Codex work outlives its parent turn in ordinary use.

See [provider work](../../topics/provider-wait-and-background-work.md),
[queue intent](../../topics/message-control-steer-queue-btw-later-interrupt.md),
and the current tracker in
`packages/server/src/sdk/providers/codex-provider-work.ts`.

## Proposed waiting behavior

An explicit **Next topic when done** action creates per-message intent. It
waits for an idle turn plus relevant reported work, then a short quiet interval
to avoid racing a follow-up turn. Recheck eligibility immediately before
delivery. Ordinary steer and queue actions retain their current behavior.

Do not simply make all Codex background work retain the session globally.
The open design problem is which jobs count: finite work being awaited versus
services deliberately left running. Prefer explicit provider/agent evidence
over guesses from command names. Show the blocking jobs and allow an explicit
send-now override; never silently kill them to unblock the message. Unknown
work must remain visibly unknown rather than being described as finished.

Before implementation, establish how the pending message retains its provider
process, survives restart, and resumes when a relevant job completes. Reuse
the existing durable queue and event-driven promotion owner; add no standing
idle polling. Provider support must describe available evidence, not promise
complete background-task visibility.

## Compaction suggestion and execution

Evaluate context pressure at the delivery boundary, not just when the message
was queued. Reuse YA's context-usage calculation and the session's effective
context limit. Missing or stale usage must not be treated as above threshold.
The percentage and whether to act remain explicit user choices.

A soft hint has two possible recipients:

- **The user in YA:** offer compact-before-delivery when the threshold is
  crossed. No automatic compaction is implied by accepting a waiting policy.
- **The model:** an optional visible advisory can accompany the next topic,
  but merely saying “consider compacting” does not invoke a native operation.
  Do not assume the model has an authorized tool for initiating compaction.

For a separately authorized **Compact first if above threshold** choice, YA
should own the operation. Existing Claude `/compact` accepts focus instructions;
YA's Codex adapter uses `thread/compact/start`, accepts no instructions, and
refuses it during an active turn. Preserve the pending message until the actual
compact completion, then deliver once. Rejection or interruption should leave
the message visibly pending with an explicit continue-without-compacting action,
not cause a retry loop or silently discard it.

Reuse [session context actions](../../topics/session-context-actions.md#user-initiated-compaction)
and existing compact-first sequencing. The model-specific guard described in
[compact and handoff](../../topics/compact-and-handoff.md) currently excludes
deferred delivery; it is not already this feature.

## Acceptance before shipping

Exercise a finite background build, an intentionally persistent dev server,
subagent completion, a new turn racing delivery, missing inventory, restart,
and compaction failure. In each case the next topic delivers at most once,
blockers remain inspectable, and default-steer sends stay immediate. Establish
the classification rule and supported providers before adding the control.

Contributing-model: gpt-6-astra
