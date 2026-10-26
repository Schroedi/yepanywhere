# Core house cleaning

Topic: core-house-cleaning

Status: **active maintenance focus; cleanup proposal**, 2026-10-26. The
maintainer selected a substantial reduction of unused and unfinished YA
features before restarting the session-core refactor. This document records
the removal recommendations and retained boundaries. It does not claim that
any feature has already been removed; this change is documentation only.

## Purpose

YA should concentrate on supervising provider sessions: create and resume,
send and queue input, observe progress and transcripts, handle approvals,
interrupt and stop, and reconnect through direct or encrypted-relay access.
Same-host provider ownership can survive replacement of the web server.

Every additional way to inject a turn, resurrect a session, fork a helper,
select a checkout, or place execution elsewhere adds lifecycle and concurrency
obligations. A hidden or default-off feature still has a maintenance cost when
its settings, metadata, services and branches remain in those shared paths.
House cleaning is a product-scope reduction, not another general core rewrite.

The maintainer reports no remaining personal use for SSH executors and wants
YA-managed parallel checkout lanes removed. The maintainer also questions the
current use of synthetic heartbeat automation. Contributor and third-party use
have not been verified. Recommendations below rest on product value and
maintenance obligations, not on an unsupported claim that nobody uses a
feature.

## Baseline and preserved experiment

Local `main` was restored to freshly fetched remote `main` at `c00368add` on
2026-10-26. No part of the expanded session-core experiment was carried back
automatically. The investigation remains available under:

- `archive/session-core-original-main-2026-10-26` at `ca192285b`: the exact
  original local-main tip, including the 55-commit core series.
- `archive/session-core-expanded-2026-10-26` at `f0ef2546f`: the rebased
  experiment, unfinished SSH stop snapshot and scope-reset report.
- A separately verified local Git bundle containing both refs and complete
  history.

The expanded experiment did not complete queued compact followed by message
delivery end to end. Its extracted policies, storage adapters and race findings
are reference material. They are not an accepted implementation baseline, a
requirement to restore its abstractions, or authorization to continue its old
slice sequence.

## Feature recommendations

These recommendations distinguish known unfinished implementations from
working features whose value may no longer justify their complexity. A
recommendation to remove a feature is not a claim that its implementation is
broken. Open usage decisions should be resolved before the corresponding
implementation slice, without blocking unrelated selected removals.

| Surface | Current state and evidence | Recommendation | Scope and expected benefit |
| --- | --- | --- | --- |
| YA-managed workstreams, lanes and parallel checkout creation | [Workstreams](workstreams.md) and [plan 054](../docs/tactical/054-workstreams.md) record metadata, session association, UI and ordinary-clone creation. Queue targeting, lane scheduling, sync, repair and landing remain unfinished. Maintainers were not dogfooding the intended workflow. | **Remove; selected direction.** Retire the unfinished lane workflow rather than completing it. | Remove lane service/routes/types, creation and `.worktreeinclude` seeding, gate/settings, UI and launch metadata plumbing, plus dedicated tests. Preserve existing user checkouts and files. |
| Released Claude SSH/rsync executors | [Remote executors](../docs/project/remote-executors.md) are a real user-facing execution path with remote metadata, settings and transcript sync. The maintainer no longer uses it. | **Remove; selected direction.** Do not retain a frozen compatibility executor. | Remove SSH launch/resume, executor selection and dedicated sync/recovery code. Historical sessions must never silently resume in a local checkout. |
| Operator-only managed SSH executors | [Managed remote executors](managed-remote-executors.md) and [plan 119](../docs/tactical/119-managed-ssh-executor-baseline.md) own an injected runner, target/workspace preparation, auth projection and transcript mirroring. They never became a complete ordinary product flow. | **Remove; selected direction.** | Delete the dedicated runner/target/workspace/auth/mirror/diagnostic stack, probes and build commands. Retain generic worker or stdio code only where a retained consumer needs it. |
| OpenAI-compatible helper targets | [Helper sessions](openai-compatible-helper-sessions.md) documents configuration, model discovery and a hidden editor without working target execution. | **Remove dormant implementation.** | Remove unused registry/editor/discovery/selector plumbing. Preserve provider-local model selection used by retained features; do not build the missing runtime to justify the configuration. |
| Synthetic heartbeat turns, forced nudges and heartbeat auto-resume | [Heartbeat](heartbeat.md) owns configured injected user turns, quiet-period scheduling, project/session overrides, doubtful-liveness steering and unowned-session resurrection. This is implemented automation, not just a status ping. | **Recommend removal with high priority.** | Remove synthetic turn generation and its settings, candidate indexing, resume and scheduling branches where exclusively owned by this feature. Reduce unsolicited work and session-resurrection paths. Preserve transport and liveness duties below. |
| Event-driven session wake turns | [Session wake](session-wake.md) is an implemented token-authenticated path for external job completion to queue input or resume an absent process. It is distinct from timed heartbeat nudges. | **Recommend removal unless a concrete current consumer warrants retention.** | Inspect `agentctl` and other external consumers before choosing the cut. If retained, require a bounded explicit API consumer; do not keep the whole heartbeat system as its prerequisite. Retire wake routes, token/env injection and auto-resume branches together if removed. |
| Post-compaction continuation and prose replay | [Post-compact replay](post-compact-replay.md) injects a hidden continuation turn, optionally quoting recent conversation. The topic itself calls the policy tentative and potentially redundant. | **Recommend removal.** | Remove YA-generated replay/continuation, related settings and replay-only buffers. Keep provider-native compaction and ordinary user-queued messages. |
| YA-generated away recaps, including forked/tailed helpers | [Recaps](recaps.md) and [fork recap](fork-recap.md) include helper generation, return timers, cold resume, deferred work, cancellation and durable overlays. | **Recommend removing generation unless actively used.** | Remove the extra provider work and recap-only lifecycle paths. Preserve readable historical recap rows and cheap rendering of provider-native events. Viewing an old recap must not launch new work. |
| Prompt-cache keepalive | [Prompt-cache keepalive](prompt-cache-keepalive.md) owns viewer leases, provider operations and cadence/cost policy. Its no-context refresh contract differs from synthetic heartbeat turns. | **Review separately; freeze expansion. Remove if no demonstrated current benefit.** | Identify actual provider implementations and measured value before deciding. Do not call it a heartbeat or remove shared subscription/liveness leases by name. Ordinary provider-owned caching remains available without YA scheduling refreshes. |
| Alternate Conversation preview and experimental API | [Simple Client API](simple-client-api.md) and [plan 130](../docs/tactical/130-simple-client-api-and-three-client-demo.md) include `/-/preview`, a separate client state machine, schemas and server subscriptions. The original native Compose presentation was retired in favor of the full bundled web UI. | **Strong removal candidate; confirm current preview use.** | Remove the unused alternate client/API, dedicated code generation and tests together. Inventory remaining native/shared consumers first. Keep the normal web transcript compiler and transport code they actually use. |
| YA Hosts delegation preview | [Cross-host delegation](cross-host-delegation.md) describes `/-/hosts` as a nonfunctional preview with unavailable relationship sections. | **Remove the placeholder page and developer toggle.** | Small direct core savings, but removes a misleading unfinished surface. Preserve the target-owned relay/API delegation direction and actual host identity/pairing used elsewhere. |
| Duplicate Gemini ACP adapter | [`gemini-acp.ts`](../packages/server/src/sdk/providers/gemini-acp.ts) is a second Gemini supervision path; its resume catch currently falls back to a fresh session. | **Recommend retiring this alternative if unused.** | Decide the supported Gemini path explicitly. Do not silently substitute a different provider/session for old records. No need to finish an unused protocol adapter as a core prerequisite. |
| Legacy Claude + Ollama and other overlapping provider variants | The [provider registry](../packages/server/src/sdk/providers/index.ts) retains distinct `claude-ollama`, `claude-gateway` and `codex-oss` paths with separate launch and configuration behavior. They are not interchangeable or all proven incomplete. | **Inventory actual use and remove redundant unused variants individually.** | Prefer fewer maintained execution paths. Preserve a used gateway/API integration rather than treating every non-default provider as abandoned. |
| `/btw` asides and Quick Question cards | [Asides](provider-agnostic-btw-asides.md) have implemented forked flows, source-bound cleanup and context-saving behavior. They also create extra child-session and browser-owned lifecycle paths. | **Usage decision: remove the feature family if unused; freeze extensions meanwhile.** | Keep ordinary deliberate session cloning/forking independent. Do not confuse the existence of partial extensions with proof that the whole feature is nonfunctional. |
| Unfinished `/done` report-back behavior | The [aside contract](provider-agnostic-btw-asides.md) records that `/done <text>` closes with a report-back-not-implemented notice rather than drafting the promised return. | **Remove unfinished affordances rather than finish them during cleanup.** | If basic asides remain, expose only their implemented close/return behavior. Do not introduce new report-back helper turns or cross-session authority. |
| YA-specific automatic compact/handoff policies | [Compact-and-handoff](compact-and-handoff.md) and [resume compaction](resume-compaction.md) mix targeted mitigations, settings and manual/native functionality. | **Freeze expansion; inventory and remove unused automatic policies separately.** | Separate automatic threshold/continuation/handoff decisions from manual Compact, deliberate Restart and provider-native behavior. Do not delete ordinary resume or manual compaction as collateral. |
| Other providers: OpenCode, Pi, Grok, ordinary Gemini | Current provider topics/code contain substantial landed support; older [deferred backlog](deferred-roadmap.md) summaries are not a reliable maturity audit by themselves. | **Retain pending a separate product/usage decision.** | Fewer providers may be desirable, but do not label them all half-built or silently narrow supported providers inside shared cleanup. |
| Boss mode, yacron, broad cross-session orchestration, federated migration and general embeddable core | [Boss mode](boss-mode.md), [yacron](yacron.md), [agent access](agent-session-access.md), [federation](federated-super-sessions.md) and [core API](core-service-api.md) are predominantly proposals. | **Keep deferred; remove them from core acceptance prerequisites.** | Deferring a document does not delete running code. No scheduler, universal grant system, migration engine or package extraction is required to finish house cleaning. |
| Target-owned delegation over direct API or encrypted relay | [Plan 144](../docs/tactical/144-relay-peer-session-coordination.md) proposes separate sessions owned by independently installed target YA hosts. | **Retain the direction; defer implementation.** | Future callers submit to the target owner using explicit grants. Do not reintroduce SSH injection, workspace mirroring or same-conversation migration through this plan. |

## Heartbeat removal boundary

The removal target is autonomous provider work: synthetic heartbeat messages,
forced nudges and heartbeat-driven resurrection of sessions without a live
owner. A configurable idle timer must not survive under another feature name
as an implicit replacement.

Keep these independently required mechanisms:

- WebSocket, relay and subscription heartbeats that establish transport health
  or deliver status without prompting the provider.
- Server-owned liveness snapshots, provider-progress evidence and UI activity
  reporting. An open socket is not evidence that the provider is progressing.
- Ordinary deferred/patient queue readiness and delivery, including any shared
  scheduler/deadline infrastructure they still consume.
- Stale-owner detection, process cleanup, shutdown fencing and cancellation of
  admitted background reads. Removing automation is not permission to weaken
  safe termination or leak resources.
- User-requested resume and explicit session continuation. Existing stopped or
  archived sessions must not be resurrected as an accidental fallback.

`autoResumeDisabled` and similar metadata may have consumers beyond heartbeat
turns, including recap and wake paths. Inventory those consumers before
removing a field or its protections. Delete an exclusively owned scheduler,
index or setting when the feature is gone; do not delete shared maintenance
just because its current name contains “heartbeat”.

## Retained product boundary

Retain local provider execution, same-host provider host/workers, ordinary
session queues and single-checkout Project Queue, approvals, manual controls,
stable YA session identity, native transcript/history reading and reconnect.
Keep direct and encrypted-relay transport, authentication, supported client
compatibility and saved-host switching.

The provider host already exists on the restored upstream baseline. Preserve
its actual runtime/platform availability, fallback behavior and the macOS
default-off containment in the [interruption gap](../gaps/macos-provider-host-turn-interruptions.md).
Keeping it does not require expanding its distribution support during cleanup.

Retain ordinary Source Control, project discovery and correct file/source
identity. YA-managed lanes are not the same as read-only recognition of a
user's Git worktrees. The [worktree file-link gap](../gaps/session-worktree-file-links.md)
can remain relevant after lane creation is removed; do not close it merely
because the workstreams feature disappeared. Likewise, Git's use of SSH and
Machine Control's own transport choices are outside the YA executor deletion.

No user checkouts, remote workspaces, branches, credentials, transcripts or
other durable user data should be destroyed as a side effect of source
removal. Obsolete configuration may become inert; it must not enable an
alternative local execution path. Historical feature records may remain
readable without retaining a compatibility runtime for the removed feature.

## Proposed order and stopping conditions

### 1 — settle the feature decisions and map retained consumers

Use the table as the decision ledger. Resolve the conditional usage questions
for each upcoming cut; do not investigate every optional feature before
starting selected removals. Record a concrete keep/remove boundary, the active
consumers and any external caller. No new telemetry service is needed.

### 2 — remove lanes and both SSH executor stacks

Make bounded deletion slices with their own complete outcomes. Remove source,
routes, settings/UI, launch plumbing, dedicated build/probe commands and tests
whose subject no longer exists. Preserve generic facilities with real retained
consumers. Completion means no active launch or recovery path still selects a
YA lane or SSH executor, and historical records cannot execute locally by
accident. This step does not complete lane scheduling or remote recovery first.

### 3 — remove synthetic heartbeat automation and approved related policies

Start with synthetic heartbeat turns and resurrection, then handle wake,
post-compact replay, generated recaps and keepalive according to their separate
decisions. Prove absence of unsolicited provider work, preserve shared queue
scheduling and liveness, and remove obsolete knobs and exclusive state owners.
An inert collection of feature flags is not a completed deletion.

### 4 — retire dormant alternatives and partial affordances

Remove dormant helper targets, the delegation placeholder and any approved
Conversation preview/API, provider alternatives or aside features. Inspect
transitive consumers before deleting shared schemas, compiler code or transport
facilities. Do not replace each removed surface with a new framework.

### 5 — verify the smaller product and close each cut

Run the checks required by [development](../DEVELOPMENT.md), with focused
integration evidence for retained lifecycle/queue/ownership interactions and
affected browser flows. Follow [test value and CI cost](../docs/development/testing.md#test-value-and-ci-cost):
retain meaningful regressions, remove tests dedicated to deleted behavior, and
avoid new shallow tests that merely assert wiring disappeared. Preserve real
sequential typing within 100 ms under representative data and concurrent
updates when changing input/navigation paths.

Review hosted-client/server compatibility for affected public surfaces under
[server capabilities](server-capabilities.md) and
[hosted compatibility](remote-hosted-compatibility.md). Define deliberate
unavailability for removed features without weakening ordinary access or
inventing a general migration/compatibility subsystem. Update owning contracts,
this decision ledger and roadmap as behavior actually changes; leave unresolved
defects open until their remaining complaint is gone.

Only after the selected removals work should the maintainer choose the next
core outcome. Queued compaction and API delegation remain separate possible
projects. Neither resumes automatically because house cleaning exposed another
interesting abstraction or because archived code is available.

## Scope control

This effort should be substantial in deletion and modest in new mechanisms.
Each implementation slice must name its deleted behavior, retained behavior,
verification and stopping condition. A discovered requirement for a new
placement, recovery subsystem, public API or generalized runtime returns to
scope discussion rather than silently extending the prerequisite chain.

Useful findings from the archive can inform a specific retained defect. They
do not justify importing the expanded architecture wholesale. Success is a
smaller supported product with fewer execution and automatic-input paths,
working ordinary sessions and clear ownership—not a particular commit count
or a growing set of extracted policy modules.
