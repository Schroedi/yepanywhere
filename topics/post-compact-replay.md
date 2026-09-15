# Post-compact replay

> Post-compact replay is a default-off, per-provider YA setting that
> injects a hidden continuation user turn after compaction settles, with
> an optional copy of the last N user/assistant prose turns in the same
> format as **Handoff from…**.

Topic: post-compact-replay

Related topics: [compact-and-handoff](compact-and-handoff.md),
[resume-compaction](resume-compaction.md),
[injected-message visibility](injected-message-visibility.md),
[fork-from-turn](fork-from-turn.md) (Handoff from… format),
[agent context injection](agent-context-injection.md),
[vanilla defaults](vanilla-defaults.md),
[settings UI placement](settings-ui-placement.md).

## Why this is tentative

A provider-native compact already rewrites history, usually with a model-written
summary plus a preserved tail. Replaying a fixed N prose turns on top of that
is a blunt substitute for that summary, and it is redundant for providers that
already continue the same turn through compaction (Codex commonly does). The
setting exists so an operator can try it where a harness instead goes idle
after compact and loses recent prose.

## Contract

- **Default off.** No provider receives a YA continuation until its checkbox
  is enabled. Novel injected provider text stays vanilla-off.
- **Placement.** Settings → Providers → Continue after compaction. One N slider
  (0–20) and one checkbox per provider. Older servers omit the field and the
  client hides the row.
- **When it fires.** After a `compact_boundary` (or compact-success status)
  settles, once the process is idle, not retaining provider work, and has no
  queued or deferred user input. A new human turn that arrived during compact
  cancels the pending continuation.
- **N = 0.** The injected turn is the stable opener plus `continue.`
- **N > 0.** The turn copies the last N user/assistant prose turns (tools,
  thinking, compact banners, and slash commands omitted). User rows use the
  `user: ` prefix from **Handoff from…**. The opener states that this is a
  replay, not a new request. The turn still ends with `continue.`
- **Visibility.** The turn is `metadata.hidden` and
  `automaticSource: "post-compact-replay"`. Transcript projection also hides
  persisted user rows that start with the stable opener, so the replay is
  model-visible and not painted as a user bubble. The compact boundary remains
  the visible marker.
- **Skip.** Disabled provider, failed compact, process death, existing queue
  or deferred messages, or automation paused until a user turn.

## Not a compact summary

This path does not replace provider compaction, resume-compaction, or restart
handoff. It does not ask a model to summarize. It copies recent prose YA
already observed on the live process, so a process that just started has
nothing to replay and degrades to continue-only.
