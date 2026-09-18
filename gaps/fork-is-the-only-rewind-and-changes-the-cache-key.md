# Fork is YA's only rewind, and a fork changes the provider cache key

YA's only way to continue from an earlier point of a conversation is
`forkSession` ([provider fork support](../topics/provider-fork-support.md)):
a new provider session id carrying a copied or reference-backed prefix. On
both wired providers the cache identity follows the session id, so the child's
first request is a cache-miss candidate even when the parent's prefix is warm.
[Quick Answer forks](quick-answer-fork-cache-efficiency.md) measured that miss
on Codex (94% uncached input across three forks; 85% on a native `/side`
reproduction). YA has no control over which cache shard a new id lands on.

Both providers expose an **in-place rewind** that keeps the session id, which
YA's provider control surface does not offer as an operation. This entry
records what each harness actually does, what YA already has, and the gap.

## Codex 0.154.0 (pinned `references/codex`)

- **Cache key follows the thread id.** `prompt_cache_key` is
  `responses_metadata.session_id` (`codex-rs/core/src/client.rs:504-514`),
  which for a root thread is the thread id
  (`codex-rs/core/src/session/session.rs:776-796`). A fork
  (`InitialHistory::Forked`) is explicitly given a fresh session id, so the
  child requests under a new key. The only override
  (`prompt_cache_key_override`) is internal to guardian review sessions; the
  app-server protocol exposes none.
- **Esc-Esc backtrack forks in every released Codex.** The TUI's backtrack
  "forks before the selected turn and restores its prompt in the new composer"
  (`codex-rs/tui/src/app_backtrack.rs:1-14`), through `fork_thread_at` with
  `before_turn_id` (`codex-rs/tui/src/app_server_session.rs:891-966`). The
  installed 0.155.0 is unchanged (`git show rust-v0.155.0:` of both files).
  So the released TUI's own rewind has exactly the fork cache exposure YA
  has. Unreleased `main` (commit `7498521`, 2026-09-18) switches backtrack to
  `thread/revert` in place: `app_backtrack.rs` reads "Revert the current
  thread before the selected prompt", `event_dispatch.rs` calls
  `revert_thread`, and `thread-store/src/local/thread_rollout_resolver.rs`
  states "`thread/revert` keeps the thread ID stable while switching the
  thread to a new rollout file". That is the direction to follow, and a
  future Codex release will ship it as the TUI default.
- **The in-place primitives exist, and the TUI does not use them for
  backtrack.** `thread/rollback {threadId, numTurns}` drops the last N turns
  of a legacy-history thread and rejects paginated threads
  (`codex-rs/app-server/src/request_processors/thread_processor.rs:2311-2333`).
  `thread/revert {threadId, beforeTurnId}` replaces a paginated thread's
  durable history with the prefix before one turn, shuts the runtime down, and
  rebuilds it from the truncated history (`thread_processor.rs:2085-2175`).
  Neither changes the thread id, so `prompt_cache_key` is unchanged; neither
  reverts local file changes. YA never passes `historyMode` to
  `thread/start`, and Codex defaults a persisted thread to paginated when the
  store supports it (`thread_processor.rs:1434-1437`), so `thread/revert` is
  the primitive for YA-started threads and `thread/rollback` for older legacy
  rollouts.
- **YA already speaks `thread/rollback`, but only to a fork child.**
  `packages/server/src/sdk/providers/codex.ts:2504-2527` forks first and then
  rolls the child back when the caller supplied `upToMessageId` without a
  turn boundary. Because Codex fork children are paginated
  ([tactical 121](../docs/tactical/121-codex-reference-backed-fork-history.md)),
  that rollback call is refused on current Codex; the live client path passes
  a turn boundary and skips it. The live per-session `CodexAppServerClient`
  can send `thread/revert` to the running thread today.

## Claude (Agent SDK 0.3.273, CLI 2.1.276)

- **The SDK's truncating resume keeps the session id.** `resume` plus
  `resumeSessionAt` resumes "up to and including" a chain UUID; the optional
  `resumeDropsTurn` makes the CLI refuse when the discarded tail contains
  anything other than the named turn (`claude-agent-sdk/sdk.d.ts:1951-2000`).
  The pair is honored only on the headless lane, which is the lane YA uses.
  YA already sends it: the resume guard picks the last good assistant UUID
  before an API-error tail and resumes there instead of forcing a handoff
  (`packages/server/src/routes/session-claude-resume-guard.ts`,
  `routes/sessions.ts:4469-4510`, `supervisor/Supervisor.ts:2580`). The
  primitive is wired end to end; only the trigger is limited to that blocker.
- **Interactive `/rewind` "Restore conversation" stays in the session.** The
  checkpointing docs describe it as rewinding to a message while keeping the
  code, and the sessions docs call it "checkpoint-based rewind within a single
  session", in contrast to `/branch` and `--fork-session`, which "get their
  own session IDs". The Claude Code changelog refers to "rewound timelines"
  inside one source session, so a rewind is a parent-pointer branch in the
  same transcript, which is what `buildDag`'s active branch already renders.
  YA cannot invoke the interactive menu; the SDK truncating resume above is
  the same operation on the headless lane.
- **The Claude cache-shard premise is unsupported.** Anthropic's prompt
  caching docs name only exact prefix match and organization/workspace
  isolation as cache determinants; there is no explicit cache key, and
  `metadata.user_id` is documented only as an abuse-detection identifier.
  Two Claude Code changelog entries are direct evidence that a new session id
  can reuse a parent's cache: `/fork` was improved to "keep the original
  conversation's prompt cache in the new background session", and a
  `subagent_type: "fork"` subagent "inherits the full conversation and prompt
  cache". YA's Claude fork keeps the prefix byte-identical, so the Codex
  measurement in the Quick Answer gap should not be assumed to transfer.
  Measure a warm-parent Claude fork before treating rewind as necessary on
  that provider; the sticky-routing writeups found were about proxies
  (LiteLLM), not Anthropic.

## The gap

Neither provider adapter offers a `rewindSession` operation, and the session
control surface (`routes/sessions.ts` fork endpoints, `Supervisor`) has no
verb for "drop the tail of this live session and keep its id". The pieces are
present and already partly exercised:

| Provider | In-place primitive | YA status |
|---|---|---|
| Codex paginated thread | `thread/revert {threadId, beforeTurnId}` | in the pinned 0.154.0 schema, absent from YA's generated protocol types; needs a protocol refresh |
| Codex legacy thread | `thread/rollback {threadId, numTurns}` | called only on a fresh fork child |
| Claude | `resume` + `resumeSessionAt` (+ `resumeDropsTurn`) | used only for API-error tail recovery |

An in-place rewind is the right shape for "try that turn again" and for the
recap/aside flows that fork only because they need a parent prefix; it is not
a replacement for fork when the parent must keep running. The kept prefix is
the same bytes under the same id, which is the strongest cache-reuse position
either provider offers a client. That is an argument from key identity, not a
measurement; the first implementation must measure first-request cached
tokens on warm parents exactly as the Quick Answer gap requires.

Constraints the implementation inherits:

- Codex `thread/revert` restarts the thread runtime, so it is a
  between-turns operation on an idle thread; YA must hold the turn and replay
  the resulting thread state to clients. Neither Codex primitive reverts
  files, and Claude's conversation-only truncation does not either; a
  code-restoring rewind is the separate file-checkpoint story
  ([fork with worktree checkpoint](sketches/fork-with-worktree-checkpoint.md)).
- Claude's truncation is a resume, so it applies when the process is
  restarted; YA's activation path already restarts on resume, and
  `resumeDropsTurn` should be passed so an absorbed queued message or task
  notification in the discarded tail refuses rather than silently vanishes.
- The transcript readers must show the rewound state: Claude branches by
  `parentUuid`, which `buildDag` already resolves to an active branch; Codex
  `thread/revert` rewrites durable history, which the reader re-reads.

## Follow-on: repeat a prompt from the same parent

A `/rep N <prompt>` operation is N sends of the same prompt from the same
parent state, equivalent to prompt, rewind, prompt, rewind, ... (N-1 rewinds),
with every attempt starting from an identical warm prefix under one session
id. It composes directly from the rewind verb above plus a cursor over the
attempts' results; nothing beyond that is needed on the provider side.

No harness or wrapper ships it (web survey 2026-09-18). Closest matches, each
single-shot and interactive: Claude Code `/branch`, `--fork-session`, and SDK
`forkSession`; Codex `/fork` and Esc-Esc; opencode `/undo`, `/redo`, and
fork. `agentoptics/rewind` replays a recorded agent run from a step for
debugging, not sampling, and targets OpenAI Agents SDK, Pydantic AI,
LangGraph, and CrewAI rather than Claude Code or Codex. The gwpl Claude Code
branching gist issues three `claude --resume --fork-session -p` calls off one
parent, but with different prompts as an isolation test. Parallel-worktree
runners such as vibe-kanban and ralph-harness start fresh sessions per
attempt with no shared prefix. On Claude, N parallel `forkSession` calls are
the simpler route and, per the changelog fork entries above, plausibly still
hit the parent's cache; on Codex the rewind verb is required.

Found 2026-09-18 while researching whether harness-native rewind avoids the
fork cache misses recorded in the Quick Answer gap.
Contributing-model: fable-5.1
