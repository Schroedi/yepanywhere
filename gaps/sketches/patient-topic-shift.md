# Patient topic shifts within an existing session

Status: sketch, not implemented. Requested and refined 2026-10-18 while
reviewing the patient-queue setting. The direction includes a new manual send
action and a possible generalization of the existing patient-queue default;
its final label and UI remain TBD. Default steering remains unchanged.

## Intent

Queue a new topic for after the current work finishes, optionally suggesting
compaction when context usage exceeds a chosen percentage. Keep default
steering immediate. Waiting and compaction are separate choices: a user may
want either without the other.

The manual action gets its own independently hideable toolbar button. Users
may show it instead of Project Queue, or show both: a soft topic shift can
depend on the current conversation, whereas project scheduling better suits
work the typed request describes independently. Neither action implies a new
session, and the topic-shift action preserves context unless compaction was
separately enabled.

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

An explicit **Next topic when done** action creates per-message intent.
Provider adapters own how patient topic shifts wait and use hints; YA owns
durable queue state, promotion ordering, cancellation, and delivery once.
Claude's initial implementation reuses its current patient delivery behavior:
verified idle after reported background work, followed by the quiet interval.
Do not build a parallel Claude waiting mechanism.

The provider contract should report eligibility, blockers, and the events
that can change them. Recheck eligibility immediately before delivery. New
provider implementations need evidence-backed waiting behavior rather than
assuming Claude's lifecycle. The existing queue-default option can eventually
select this same patient intent across providers; its final presentation is
TBD. Steer remains independent of both entry points.

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

## Defaults and migration

Keep the source of intent on each item: an explicit topic-shift click or the
patient queue default. Both use the provider's patient implementation, but
their compaction thresholds are independently configurable. The default-queue
threshold should probably be higher than the explicit-click threshold; exact
new-user values remain undecided. This reflects the stronger topic-shift signal
from a deliberate click.

Existing `patientQueueDefault: true` users retain enabled patient queue intent
with automatic compaction disabled. In a percentage control, **100% means
Off**, not “compact at full context”: normalize it to an explicitly disabled
policy so an over-capacity estimate cannot accidentally trigger compaction.
This migration applies to the default-queue threshold, not a separately chosen
explicit-click threshold. Existing false/absent values stay off; fresh YA
installs currently default to off. Already accepted queue entries keep their
original policy. Native provider auto-compaction is unaffected.

## Compaction suggestion and execution

Evaluate context pressure at the delivery boundary, not just when the message
was queued. Reuse YA's context-usage calculation and the session's effective
context limit. Missing or stale usage must not be treated as above threshold.
The percentage and whether to act remain explicit user choices, separately
for the two entry points above.

YA-managed threshold compaction is the optional common implementation wherever
native manual compaction is supported. Disable that YA-managed path for a
provider only after verifying that its own patient-topic-shift hint produces
better behavior and implementing that alternative in the adapter. Expose the
reason and use the verified provider path; do not both hint and manually
compact for the same item. Merely accepting arbitrary prompt text is not
evidence of such support. No provider is designated for this exemption yet.

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
Also cover independent button visibility, both threshold policies, existing
enabled-user migration, 100%-as-Off even with usage above the reported limit,
and mutual exclusion between provider-managed hints and YA-managed compaction.

Contributing-model: gpt-6-astra
