# Provider Waits And Background Work

> How Claude and Codex wait, keep work running after a turn, and wake
> themselves; what YA records about it today; and the provider-neutral record
> YA should capture before choosing new indicators or lifecycle behavior.

Related topics: [session liveness](session-liveness.md) owns liveness
statuses, retention and idle reaping; [Claude provider control](claude.md)
owns the Claude background-task retention contract.
Dated observations, prompts, versions and source citations:
[evidence](provider-wait-and-background-work.evidence.md).

Provider behavior below was observed on 2026-10-15 with Claude Agent SDK
0.3.296 / CLI 2.1.296 (`claude-sonnet-5-5`) and Codex CLI 0.160.0
(`gpt-6.1-sol`), and checked against Codex source `rust-v0.162.1`. It is
provider behavior, not YA contract, and can change with any provider
release. Recheck it during a [provider refresh](provider-refresh.md) and add
a new dated section to the evidence file rather than editing old ones.

## Vocabulary

- **Foreground wait** — the provider turn is still active, but the model is
  not generating: it is sleeping, waiting on a running command, or waiting on
  a subagent. The session is genuinely `in-turn`.
- **Background work** — the turn has ended and something the session started
  is still alive: a shell or monitor process, a background subagent or
  workflow.
- **Scheduled wake** — a provider-owned timer that will start a new turn
  without user input (Claude session crons and `ScheduleWakeup`).
- **Self-started turn** — a turn the provider begins without a YA
  `turn/start` or user message: a finished Claude background task, a fired
  Claude cron, a Codex goal or thread-queue continuation.

## Provider Behavior (observed 2026-10-15)

| Situation | Claude | Codex |
|---|---|---|
| "Check in with me in N minutes" | Background Bash `sleep`, turn ends; the task's completion wakes a new turn | Turn stays active, chaining `clock.sleep` items (≤60 s observed) between model steps |
| "Remind me in N minutes" | One-shot `CronCreate`, turn ends; the cron fires a new turn | Same as check-in |
| "Check back in N minutes" | Background task plus `ScheduleWakeup`, turn ends | Sleeps inside the active turn |
| "Let me know when the build finishes" | Background Bash; completion wakes a new turn | Turn stays active and polls the running command |
| Dev server left running | Background Bash task retains the session; a `nohup … &` launch escapes tracking entirely | Turn ends `idle`; the process is visible only through `thread/backgroundTerminals/list` |
| Background process exits after the turn | `task_notification` and a new turn | Late `item/completed`; no new turn |
| Subagent | `local_agent` task; foreground in the probe, backgrounding possible | Separate child thread with its own turns; parent waits in its turn |
| Provider status while waiting in the background | SDK reports idle; `background_tasks_changed` lists tasks; crons only in Stop-hook input | `ThreadStatus` `idle` with no flags; no change notification |
| Process teardown | Kills tracked background tasks | Kills all background terminals (`killpg`) |

Two provider facts matter for any later design:

- Claude session crons, including `ScheduleWakeup`, were held back while a
  background task was running; a check-in scheduled beside a running dev
  server did not fire on time.
- Codex's `clock.sleep` is offered only for models whose catalog lists the
  `clock` tool (bundled gpt-6 models), and a single sleep may last up to
  12 hours.

## Current YA Behavior

- **Claude.** `ClaudeProviderRetentionTracker` reduces provider state to
  counts: live SDK tasks, Stop-hook background tasks and session crons. An
  idle process with any of them is `verified-waiting-provider`, reports
  `activity: "in-turn"` on every row surface (see
  [session liveness](session-liveness.md)), and is not idle-reaped. Task
  type, description, command and cron schedule are discarded, so a
  background subagent, a dev server and a pending reminder look identical.
- **Codex.** Nothing feeds retention. A thread with live background
  terminals is `verified-idle`, shows no activity and is eligible for idle
  reaping; teardown then kills those terminals. A late background
  `item/completed` updates raw-event cadence only. In-turn `clock.sleep`
  items render in the transcript as `sleep` tool calls and keep the session
  `in-turn` / `verified-progressing`.
- **Session Info.** The Info tab of the session model panel
  (`ProcessInfoBody`) shows the retention counts and reasons and the last
  wake reason from the liveness snapshot.

## Contracts

- Codex background terminals do not retain a session and do not defer idle
  reaping. Reaping may therefore end a dev server Codex started. A future
  setting may make them retain the session; until then this is deliberate,
  not a defect. (Decided 2026-10-15.)
- Claude provider retention keeps its existing contract: background tasks
  and session crons defer idle reaping.

## Proposed Normalized Record

Not implemented. The first goal is correct underlying data, shown in the
Session Info tab; row indicators, queue behavior, done notifications and
reaping changes come later and are out of scope for the first slice.

The liveness snapshot (or a sibling field on process info) should carry two
optional, provider-neutral parts alongside the existing coarse state:

- **Foreground wait**, present only while the turn is active:
  `{ kind: "sleep" | "command" | "subagent", since, until?, label? }`.
  Codex supplies it from live `sleep` items (`durationMs`), unified-exec
  commands the turn is polling, and `collabAgentToolCall` waits; Claude from a
  running foreground Bash or `Agent` call.
- **Background work**, a list present after the turn ends:
  `{ kind: "shell" | "monitor" | "subagent" | "workflow" | "mcp" | "cron",
  id, label, startedAt?, schedule?, source }`, where `source` names the
  provider evidence. Claude supplies it from the latest
  `background_tasks_changed` snapshot (keeping `task_type`, `description`,
  `subagent_type`, `parent_task_id`, excluding `ambient`) and from Stop-hook
  `background_tasks` and `session_crons` (command, schedule, prompt). Codex
  supplies it from unified-exec items left `inProgress` at turn end,
  reconciled with `thread/backgroundTerminals/list` at turn end and on
  resume or reconnect, and cleared by the late `item/completed`.

Constraints on collecting it:

- No timer polling of idle sessions. Per the
  [architecture mandates](architecture-mandates.md), an idle provider
  session must not indefinitely consume server resources; Codex
  reconciliation happens at turn boundaries and reconnects only.
- Retention stays a separate decision. Recording Codex background work must
  not by itself make it retain the session (see Contracts).
- Untracked descendants (Claude `nohup` launches, daemons a command forks)
  are invisible to both providers; YA must not imply the list is a complete
  process inventory.
- Codex self-started turns carry no trigger field over app-server; YA can
  record that a turn began without a YA `turn/start`, not why.
