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
YA-managed parallel checkout lanes removed. The Hosts placeholder and Gemini
ACP are also selected; the alternate Conversation API/preview is deferred. The current pass focuses on Kyle/kzahel-led features. Work led by
`graehl@gmail.com`, including synthetic heartbeat automation, is deferred.
This supersedes the initial ordering that prioritized heartbeat removal.
Recommendations below do not claim that nobody uses a feature.

## Current pass and contributor attribution

The authorized implementation set is **rows 1, 2, 3, 11 and 12**: managed
checkout lanes, released SSH executors, managed SSH executors, the YA Hosts
placeholder, and Gemini ACP. Row 10 (Conversation API/preview) remains deferred
from implementation in this pass. Other Kyle-led surfaces remain follow-up candidates; finding
another candidate does not automatically enlarge these first deletions.

The table uses these contributor labels:

- **Kyle**: Kyle Graehl / kzahel, `kgraehl@gmail.com`, the requesting maintainer.
- **graehl**: the separate Git author identity `graehl@gmail.com`.
- **Mixed**: a row combines features introduced by both identities; its
  contributor cell identifies the individual parts.

Lead attribution is inferred from the introducing implementation or design
commits linked in each row, checked against the current Git history. It is
feature provenance, not exclusive authorship, current ownership, a line-count
ranking or evidence of present usage. In particular, shared files and later
repairs often include both contributors. Removing a Kyle-led feature does not
mean reverting another contributor's shared safety fixes. Mixed rows must be
split by actual consumer boundaries rather than deleted wholesale.

The row numbers are stable discussion handles, not implementation-order codes.
Keep them when recommendations change. The earlier technical recommendations
for deferred rows remain recorded so they can be revisited separately; they
are not part of this pass's deletion scope.

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
The last column describes the potential cut if selected; it does not override
an explicit deferred recommendation for the current pass.

| # | Surface | Lead contributor (Git evidence) | Current state and evidence | Recommendation for this pass | Potential deletion scope and retained boundary |
| --- | --- | --- | --- | --- | --- |
| 1 | YA-managed workstreams, lanes and parallel checkout creation | **Kyle** ([45c32b0f7](https://github.com/kzahel/yepanywhere/commit/45c32b0f7)). | [Workstreams retirement](workstreams.md): lane owners, UI, scanner grouping and launch plumbing are removed; explicit stale-client lane targets receive HTTP 410 before launch. | **Removed, 2026-10-26.** See [plan 160](../docs/tactical/160-remove-managed-checkout-lanes.md) for verification. | Remove lane service/routes/types, creation and `.worktreeinclude` seeding, gate/settings, UI and launch metadata plumbing, plus dedicated tests. Preserve existing user checkouts and files. |
| 2 | Released Claude SSH/rsync executors | **Kyle** ([eb97a951b](https://github.com/kzahel/yepanywhere/commit/eb97a951b)). | [Retirement contract](../docs/project/remote-executors.md): released SSH/rsync execution, configuration and selector are removed; historical labels remain read-only. | **Removed, 2026-10-26.** Explicit requests fail; saved remote-session execution actions return 410. Verification: [plan 161](../docs/tactical/161-remove-ssh-executors.md). | Remove SSH launch/resume, executor selection and dedicated sync/recovery code. Historical sessions must never silently resume in a local checkout. |
| 3 | Operator-only managed SSH executors | **Kyle** ([2da0bb622](https://github.com/kzahel/yepanywhere/commit/2da0bb622)). | [Managed executor retirement](managed-remote-executors.md): the injected runner, workspace/auth/mirror stack, dedicated stdio protocol, probes and placement types are removed. | **Removed, 2026-10-26.** Same-host provider ownership remains; verification is recorded in [plan 161](../docs/tactical/161-remove-ssh-executors.md). | Delete the dedicated runner/target/workspace/auth/mirror/diagnostic stack, probes and build commands. Retain generic worker or stdio code only where a retained consumer needs it. |
| 4 | OpenAI-compatible helper targets | **graehl** ([9ffa55aa4](https://github.com/kzahel/yepanywhere/commit/9ffa55aa4)). | [Helper sessions](openai-compatible-helper-sessions.md) documents configuration, model discovery and a hidden editor without working target execution. | **Deferred: graehl-led.** Earlier recommendation: remove the dormant implementation. | Remove unused registry/editor/discovery/selector plumbing. Preserve provider-local model selection used by retained features; do not build the missing runtime to justify the configuration. |
| 5 | Synthetic heartbeat turns, forced nudges and heartbeat auto-resume | **graehl** ([58e9f85ec](https://github.com/kzahel/yepanywhere/commit/58e9f85ec)). | [Heartbeat](heartbeat.md) owns configured injected user turns, quiet-period scheduling, project/session overrides, doubtful-liveness steering and unowned-session resurrection. This is implemented automation, not just a status ping. | **Deferred: graehl-led.** Earlier recommendation: remove synthetic turns and resurrection; no removal in this pass. | Remove synthetic turn generation and its settings, candidate indexing, resume and scheduling branches where exclusively owned by this feature. Reduce unsolicited work and session-resurrection paths. Preserve transport and liveness duties below. |
| 6 | Event-driven session wake turns | **graehl** ([ff029de3a](https://github.com/kzahel/yepanywhere/commit/ff029de3a)). | [Session wake](session-wake.md) is an implemented token-authenticated path for external job completion to queue input or resume an absent process. It is distinct from timed heartbeat nudges. | **Deferred: graehl-led.** Earlier recommendation: remove unless a concrete current consumer warrants retention. | Inspect `agentctl` and other external consumers before choosing the cut. If retained, require a bounded explicit API consumer; do not keep the whole heartbeat system as its prerequisite. Retire wake routes, token/env injection and auto-resume branches together if removed. |
| 7 | Post-compaction continuation and prose replay | **graehl** ([30a2c0178](https://github.com/kzahel/yepanywhere/commit/30a2c0178)). | [Post-compact replay](post-compact-replay.md) injects a hidden continuation turn, optionally quoting recent conversation. The topic itself calls the policy tentative and potentially redundant. | **Deferred: graehl-led.** Earlier recommendation: remove YA-generated continuation/replay. | Remove YA-generated replay/continuation, related settings and replay-only buffers. Keep provider-native compaction and ordinary user-queued messages. |
| 8 | YA-generated away recaps, including forked/tailed helpers | **graehl** ([af6bce7fa](https://github.com/kzahel/yepanywhere/commit/af6bce7fa), [9682c7687](https://github.com/kzahel/yepanywhere/commit/9682c7687)). | [Recaps](recaps.md) and [fork recap](fork-recap.md) include helper generation, return timers, cold resume, deferred work, cancellation and durable overlays. | **Deferred: graehl-led.** Earlier recommendation: remove generation unless actively used. | Remove the extra provider work and recap-only lifecycle paths. Preserve readable historical recap rows and cheap rendering of provider-native events. Viewing an old recap must not launch new work. |
| 9 | Prompt-cache keepalive | **graehl** ([5404e0dab](https://github.com/kzahel/yepanywhere/commit/5404e0dab)). | [Prompt-cache keepalive](prompt-cache-keepalive.md) owns viewer leases, provider operations and cadence/cost policy. Its no-context refresh contract differs from synthetic heartbeat turns. | **Deferred: graehl-led.** Earlier recommendation: assess measured benefit separately; no removal in this pass. | Identify actual provider implementations and measured value before deciding. Do not call it a heartbeat or remove shared subscription/liveness leases by name. Ordinary provider-owned caching remains available without YA scheduling refreshes. |
| 10 | Alternate Conversation preview and experimental API | **Kyle** ([0a8af0963](https://github.com/kzahel/yepanywhere/commit/0a8af0963), [89356dbb9](https://github.com/kzahel/yepanywhere/commit/89356dbb9)). | [Simple Client API](simple-client-api.md) and [plan 130](../docs/tactical/130-simple-client-api-and-three-client-demo.md) include `/-/preview`, a separate client state machine, schemas and server subscriptions. The original native Compose presentation was retired in favor of the full bundled web UI. | **Deferred from this implementation pass.** Earlier removal recommendation remains for later consideration. | Remove the unused alternate client/API, dedicated code generation and tests together. Inventory remaining native/shared consumers first. Keep the normal web transcript compiler and transport code they actually use. |
| 11 | YA Hosts delegation preview | **Kyle** ([77fc0fa1b](https://github.com/kzahel/yepanywhere/commit/77fc0fa1b)). | [Cross-host delegation](cross-host-delegation.md) describes `/-/hosts` as a nonfunctional preview with unavailable relationship sections. | **Authorized this pass: remove.** Preserve actual host switching and delegation design. | Small direct core savings, but removes a misleading unfinished surface. Preserve the target-owned relay/API delegation direction and actual host identity/pairing used elsewhere. |
| 12 | Duplicate Gemini ACP adapter | **Kyle** ([3f58e0172](https://github.com/kzahel/yepanywhere/commit/3f58e0172)). | The registry currently maps both `gemini` and `gemini-acp` to ACP; the separate stream-JSON adapter is deprecated. ACP is therefore the current ordinary Gemini execution path, not merely an unused alternative. | **Authorized retirement; scope choice pending.** Decide whether to retain the older CLI adapter, remove Gemini execution, or defer this row before changing the current mapping. | Decide the supported Gemini path explicitly. Do not silently substitute a different provider/session for old records. No need to finish an unused protocol adapter as a core prerequisite. |
| 13 | Legacy Claude + Ollama and other overlapping provider variants | **Mixed:** Kyle — Claude + Ollama ([fa5124fba](https://github.com/kzahel/yepanywhere/commit/fa5124fba)), Codex OSS ([7e3f6225c](https://github.com/kzahel/yepanywhere/commit/7e3f6225c)); graehl — Claude Gateway ([2d570447c](https://github.com/kzahel/yepanywhere/commit/2d570447c)). | The [provider registry](../packages/server/src/sdk/providers/index.ts) retains distinct `claude-ollama`, `claude-gateway` and `codex-oss` paths with separate launch and configuration behavior. They are not interchangeable or all proven incomplete. | **Review Kyle-led variants only; defer Claude Gateway.** Inventory actual use before removing Claude + Ollama or Codex OSS. | Prefer fewer maintained execution paths. Preserve a used gateway/API integration rather than treating every non-default provider as abandoned. |
| 14 | `/btw` asides and Quick Question cards | **graehl** ([22580999d](https://github.com/kzahel/yepanywhere/commit/22580999d), [d9e24be17](https://github.com/kzahel/yepanywhere/commit/d9e24be17)). | [Asides](provider-agnostic-btw-asides.md) have implemented forked flows, source-bound cleanup and context-saving behavior. They also create extra child-session and browser-owned lifecycle paths. | **Deferred: graehl-led.** Earlier recommendation: remove the feature family if unused; no removal in this pass. | Keep ordinary deliberate session cloning/forking independent. Do not confuse the existence of partial extensions with proof that the whole feature is nonfunctional. |
| 15 | Unfinished `/done` report-back behavior | **graehl** ([e5e139224](https://github.com/kzahel/yepanywhere/commit/e5e139224)). | The [aside contract](provider-agnostic-btw-asides.md) records that `/done <text>` closes with a report-back-not-implemented notice rather than drafting the promised return. | **Deferred: graehl-led.** Earlier recommendation: remove unfinished report-back affordances rather than finish them. | If basic asides remain, expose only their implemented close/return behavior. Do not introduce new report-back helper turns or cross-session authority. |
| 16 | YA-specific automatic compact/handoff policies | **graehl** ([70bac4a4d](https://github.com/kzahel/yepanywhere/commit/70bac4a4d), [6c7d14212](https://github.com/kzahel/yepanywhere/commit/6c7d14212)). | [Compact-and-handoff](compact-and-handoff.md) and [resume compaction](resume-compaction.md) mix targeted mitigations, settings and manual/native functionality. | **Deferred: graehl-led compact policies.** Preserve current manual/native and automatic behavior during this pass. | Separate automatic threshold/continuation/handoff decisions from manual Compact, deliberate Restart and provider-native behavior. Do not delete ordinary resume or manual compaction as collateral. |
| 17 | Other providers: OpenCode, Pi, Grok, ordinary Gemini | **Mixed:** Kyle — OpenCode ([bc3214afe](https://github.com/kzahel/yepanywhere/commit/bc3214afe)), ordinary Gemini ([6b956331d](https://github.com/kzahel/yepanywhere/commit/6b956331d)); graehl — Pi ([0dbe625e3](https://github.com/kzahel/yepanywhere/commit/0dbe625e3)), Grok ([9ecd2a53f](https://github.com/kzahel/yepanywhere/commit/9ecd2a53f)). | Current provider topics/code contain substantial landed support; older [deferred backlog](deferred-roadmap.md) summaries are not a reliable maturity audit by themselves. | **Retain.** Kyle-led providers are not selected for removal; Pi/Grok review is deferred with graehl-led work. | Fewer providers may be desirable, but do not label them all half-built or silently narrow supported providers inside shared cleanup. |
| 18 | Boss mode, yacron, broad cross-session orchestration, federated migration and general embeddable core | **Mixed:** graehl — boss ([be9a7a4cc](https://github.com/kzahel/yepanywhere/commit/be9a7a4cc)), yacron ([e25c25489](https://github.com/kzahel/yepanywhere/commit/e25c25489)), agent access ([f8f30a616](https://github.com/kzahel/yepanywhere/commit/f8f30a616)), core API ([f4337a4ed](https://github.com/kzahel/yepanywhere/commit/f4337a4ed)); Kyle — federation ([33d51a825](https://github.com/kzahel/yepanywhere/commit/33d51a825)). | [Boss mode](boss-mode.md), [yacron](yacron.md), [agent access](agent-session-access.md), [federation](federated-super-sessions.md) and [core API](core-service-api.md) are predominantly proposals. | **Keep deferred.** Do not implement or delete graehl-led proposals in this pass. Kyle-led federation remains deferred, outside core acceptance. | Deferring a document does not delete running code. No scheduler, universal grant system, migration engine or package extraction is required to finish house cleaning. |
| 19 | Target-owned delegation over direct API or encrypted relay | **Kyle** ([14a135a90](https://github.com/kzahel/yepanywhere/commit/14a135a90)). | [Plan 144](../docs/tactical/144-relay-peer-session-coordination.md) proposes separate sessions owned by independently installed target YA hosts. | **Retain the direction; defer implementation.** | Future callers submit to the target owner using explicit grants. Do not reintroduce SSH injection, workspace mirroring or same-conversation migration through this plan. |

## Deferred heartbeat review boundary

**Rows 5–9 are deferred for this pass because they are graehl-led.** Existing
heartbeat, wake, recap, replay and keepalive behavior remains in place. The
following boundary preserves the earlier technical analysis for a later
review; it is not an instruction to remove these features now.

If heartbeat removal is selected later, its target would be autonomous
provider work: synthetic messages, forced nudges and heartbeat-driven
resurrection of sessions without a live owner. It must not reappear under
another feature name as an implicit replacement.

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

### 3 — remove the Hosts placeholder and Gemini ACP

Complete rows 11 and 12 independently, committing and pushing each removal.
Remove the nonfunctional Hosts page/developer toggle while preserving actual
saved-host selection, identity and relay/API delegation design. Retire the
Gemini ACP adapter without replacing it with ordinary Gemini on a stale
request or historical resume. Keep other ACP consumers and ordinary Gemini.
Row 10's Conversation API/preview remains unchanged in this implementation pass.

### 4 — review remaining Kyle-led candidates separately

After rows 1, 2, 3, 11 and 12 work, consider the remaining Kyle-led variants in row
13. Preserve the graehl-led portions of mixed rows, including Claude Gateway.
Rows 4–9 and 14–16 remain deferred, as do the graehl-led proposals and providers
identified in rows 17–18. Do not remove dormant helper targets, heartbeat
policies, recaps or aside affordances under the old broader sequence.

Inspect transitive consumers before deleting shared schemas, compiler code or
transport facilities. Do not replace each removed surface with a new framework.

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
