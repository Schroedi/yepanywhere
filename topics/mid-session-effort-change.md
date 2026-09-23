# Mid-session effort change

> A mid-session effort change misses the provider's prompt cache (Claude
> keys its cache by effort; Codex sends effort at request level), so on a
> long-context session the next request re-reads the whole prompt; YA warns
> before such a change on enabled providers past a configurable token
> threshold and offers a fork at the new effort instead.

Topic: mid-session-effort-change

Status: implemented 2026-09-19. The per-provider enablement and token
threshold live in Settings → Providers; the warning fires from both effort
surfaces (the composer's thinking chooser and the provider-badge model panel).
Per-model configuration is deferred; see
[mid-session-effort-change.sketches.md](mid-session-effort-change.sketches.md).
Browser check: `packages/client/e2e/long-context-effort-warning.spec.ts`
drives both surfaces against a mocked long-context session and records the
dialog captures.

Related topics: [claude-thinking-config](claude-thinking-config.md) (how the
live effort control is applied), [provider-fork-support](provider-fork-support.md)
(the fork the dialog offers), [cache-miss-accounting](cache-miss-accounting.md)
(how a re-read shows up afterwards), [prompt-cache-keepalive](prompt-cache-keepalive.md),
[settings-ui-placement](settings-ui-placement.md).

## Why

On Claude, the prompt cache is keyed by effort: changing it mid-session
makes the next request miss the whole cached prefix, tools and system
prompt included, and re-read the conversation at cache-write price. The
request text does not change; only the `output_config.effort` parameter
does (measured 2026-09-23, § Claude cache measurement). On Codex the
effort is the request-level `reasoning.effort`, and OpenAI's own guidance is
to keep that unchanged to preserve the cached prefix. Either way a
routine-looking control can silently cost a full re-read of a 200k-token
session, which is the same
class of cost the [cache-miss-accounting](cache-miss-accounting.md) monitor
exists to surface after the fact. This topic surfaces it before.

## Contract

- **Trigger.** Before YA applies a thinking option whose *effort component*
  differs from the session's current one. The effort component is the level
  of an `on:<level>` option and absent for `auto` and `off`, so `auto` →
  `on:high` and `on:high` → `off` count as changes while `auto` → `off` does
  not. Both mid-session surfaces route through one guard: the composer's
  live thinking chooser (`SessionPage.handleLiveThinkingChange`) and the
  provider-badge model panel (`ModelSwitchModal.applyConfig`).
- **Condition.** The session's provider is checked in the setting, the
  session's last request size (`contextUsage.inputTokens`, the whole prompt
  including cached reads on Claude) is known and at least the threshold, and
  no cache-safe mechanism exists for the provider/model pair
  (`effortChangeKeepsPromptCache` in
  `packages/shared/src/long-context-effort-warning.ts`, currently false for
  every pair; see § Codex Astra below).
- **Dialog.** States the last request size and the from/to efforts, and
  offers three choices: **Change anyway** applies the change exactly as it
  would have without the warning; **Fork at <effort>** creates a
  `clone-latest-complete` fork whose launch settings carry the new thinking
  option and navigates to it, leaving the source session untouched at its old
  effort; **Cancel** applies nothing. The fork choice is hidden when the
  session cannot be forked now (provider without fork support, session owned
  elsewhere, or a turn in flight). Fork eligibility remains live while the
  dialog is open and is checked again on selection, including when initial
  metadata reconciliation establishes that the session is idle. Dismissing
  the dialog is Cancel.
- **Fork launch settings.** The fork route accepts an optional `thinking`
  option and, when present, records it as the fork's effective launch
  settings with the inherited model and the source's permission mode and
  service tier. The fork's composer therefore sends that effort on its first
  turn instead of the browser's per-model default, and server-side turns use
  it too. A fork without `thinking` keeps today's behavior.
- **Setting.** `longContextEffortWarning` is a server-persisted setting
  ([settings-ui-placement](settings-ui-placement.md) mechanism 3) with
  per-provider checkboxes and `thresholdTokens`. Default: Claude and Codex
  checked, 5,000 tokens. The slider spans 0–500,000 tokens; the exact field
  accepts any non-negative integer. 0 warns on every effort change. It is
  edited in Settings → Providers beside the other per-provider rows.
- **Older servers.** A server that does not return the setting never warns
  and never receives a `thinking` fork field; the client offers nothing
  extra. Presence of the setting is the gate, since the setting and the fork
  field shipped together.
- **Default-on rationale.** This is a warning about a hidden cost of an
  existing control, not a new behavior of the session; the change still
  happens on confirmation and the previous one-click path remains one extra
  click. That is the bounded exception the maintainer chose over
  [vanilla-defaults](vanilla-defaults.md)' default-off rule; unchecking a
  provider restores the silent path.

## Provider notes

- **Claude.** The fork keeps the source's prefix byte-identical, and forks
  at the *same* effort within the cache window hit the parent's cache
  ([fork-is-the-only-rewind gap](../gaps/fork-is-the-only-rewind-and-changes-the-cache-key.md)
  § Claude). A fork at a *different* effort does not: the cache is keyed by
  effort, so its first request re-reads the whole context just as an
  in-place change would (§ Claude cache measurement). The fork saves nothing
  on the re-read; it only keeps the source session unchanged and warm at its
  old effort. The dialog says so.
- **Codex.** A Codex fork changes the thread id and therefore the
  `prompt_cache_key`, and measured forks re-read most of the context
  ([quick-answer fork gap](../gaps/quick-answer-fork-cache-efficiency.md)),
  so the fork choice does not save the re-read on Codex today; it only keeps
  the source session unchanged. The dialog states this. The Codex-side
  remedies are tracked in [codex-cache-features](../gaps/codex-cache-features.md).
- **Codex GPT-6 Astra.** OpenAI documents an in-place effort change for
  Astra through `configuration_update` items that leave the request-level
  effort, and so the cached prefix, unchanged. The pinned Codex 0.154.0
  source implements it (`core/src/session/reasoning_effort.rs`) behind the
  `reasoning_effort_override` feature, which is under development and
  default-off, and only for models whose catalog entry sets
  `use_responses_lite` (Astra and Sol in the local catalog). YA does not
  enable Codex features, so today an Astra effort change still goes through
  `thread/settings/update` at request level and the warning applies. Once
  that feature is enabled and a warm-session measurement shows the cache
  survives, `effortChangeKeepsPromptCache` exempts Astra; details in
  [codex-cache-features](../gaps/codex-cache-features.md).

## Claude cache measurement (2026-09-23)

Setup: Agent SDK 0.3.280 (`claude-agent-sdk-darwin-arm64` CLI), model
`claude-sonnet-5`, adaptive thinking with summarized display, 1h cache TTL.
Numbers are `cache_read_input_tokens` / `cache_creation_input_tokens` from
the session JSONL or the CLI's JSON result.

**Live YA session.** Started through `POST /api/projects/:projectId/sessions`
at `on:medium` with ~98k tokens of repository source as the first message
(one-word replies thereafter). Effort changed through
`POST /api/processes/:processId/config` (`{"thinking":"on:high"}`), the path
the dialog's Change anyway uses; it calls `applyFlagSettings({effortLevel})`
on the live query without a restart.

| Turn | Effort | Read | Created |
|---|---|---|---|
| 1 | medium | 0 | 97,770 |
| 2 | medium | 97,770 | 100 |
| 3 | changed to high | 0 | 97,971 |
| 4 | changed back to medium | 97,870 | 202 |

Turn 4 reused turn 2's medium entry: each effort keeps its own cache entry,
and returning to an effort still inside its TTL hits it.

**Request capture.** The same sequence driven directly through the SDK
behind a logging HTTP proxy (`ANTHROPIC_BASE_URL`). Between the requests
before and after `applyFlagSettings`, `system` and `tools` were
byte-identical and `messages` was a pure append; the only other difference
was `output_config.effort` (`medium` → `high`). The request still read 0.
Claude Code places a cache breakpoint on the system prompt, so an unchanged
tools+system prefix missing as well means effort partitions the cache for
the whole prompt, the way a model change does. Whether the API renders
effort into the prompt internally is not observable from the client.

**Cold standalone control.** `claude -p` with a unique
`--append-system-prompt` nonce and ~53k-token prompt, fresh process per
run: medium 0 / 52,759; high 0 / 52,821; high again 52,821 / 0; low
0 / 52,821. Earlier runs without a system-prompt nonce appeared to show
effort-independent hits, but they were confounded by entries warmed at
other efforts moments before; keep every effort cold when repeating this.

**Forks** (`POST .../fork` with `clone-latest-complete` and `thinking`, then
`POST .../resume`), from the session above while its medium and high
entries were warm:

| Fork effort | Read | Created |
|---|---|---|
| xhigh (never used by the source) | 0 | 98,493 |
| medium (source's current effort) | 98,072 | 422 |

A fork at high read 97,971, but only because turn 3 had already cached that
prefix at high; it is not evidence that forks bridge efforts.

Two incidental findings: the first attempt, using random NATO-alphabet
filler, was refused by a safety classifier (`stop_reason: refusal`), so
use real source text as filler; and the session's first turn created a
new tools prefix after MCP tools loaded, an unrelated one-time miss.

## Copy corrections (2026-09-23)

The measurement above corrected the dialog copy; the trigger, condition,
threshold, and fork mechanics in § Contract did not change.

- The body says the prompt cache is kept separately for each effort, so the
  next request re-reads the whole context. It previously said the change
  "changes the system prompt", a mechanism the request capture ruled out.
- One fork hint serves every provider: the fork also re-reads the context
  and only keeps this session as it is, still cached at its current effort.
  The previous Claude hint claimed the fork's first request could reuse this
  session's cache, which holds only for a fork at the same effort.
- This is API behavior, not YA or Claude Code behavior, so re-measure on a
  model or SDK refresh before relaxing `effortChangeKeepsPromptCache` for
  Claude.
