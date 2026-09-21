# Usage cost prices go stale silently, and the long-context premium is unverified

Settings → Users prices recorded token usage from
`packages/shared/src/vendor/pi-model-prices/prices.generated.ts`, a mechanical
extract of the `pi` project's per-model rates (see that directory's
`VENDORED.md`). Three things are left open, none of them blocking the report:

- **Nothing notices the table aging.** It is refreshed only when someone runs
  `scripts/generate-vendored-model-prices.mjs` against a local `pi` checkout, and
  a report drawn from a year-old table reads exactly like a current one. The
  output-token equivalent is deliberately the headline partly for this reason —
  it survives a price change — but the dollar figure does not, and says nothing
  about how old it is. Cheap fix: record the extract's upstream date in the
  generated module and have the page show it beside the dollar figures.
- **The long-context multipliers are not cross-checked.**
  `USAGE_LONG_CONTEXT_MULTIPLIERS` in `packages/shared/src/model-prices.ts`
  (prompt ×2, output ×1.5 above 200k prompt tokens) is Anthropic's published
  premium for its 1M-context models, but the vendored table models no
  context-length tier and carries no 1M-context entry, so nothing in this repo
  corroborates it. A `sonnet[1m]` or `opus[1m]` session above 200k tokens is
  therefore the one case whose cost rests on an unverified constant. They are
  applied because ignoring the tier understates such a session by about half.
- **Unlisted models get no dollar figure at all**, by design — they fall back to
  generic ratios for the output-token equivalent only
  (`unlistedEquivalentOutputTokens`). A per-project or whole-user bucket that
  contains even one unlisted model therefore shows no dollars. That is the
  honest reading, but it means a mixed install can see its project-level cost
  figures disappear entirely. Whether to show a partial total with an explicit
  "plus unpriced usage" marker is a product call nobody has made.

Not fixed in place because each needs a decision rather than code: how fresh
the table must be to quote dollars, whether to carry a hand-maintained premium
the upstream table does not model, and how to present a partial cost.

Found 2026-09-21 while adding per-model and per-project token cost to
Settings → Users usage.
