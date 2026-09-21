# Vendored: pi model token prices

`prices.generated.ts` is a mechanical extract of per-model token prices from
the `pi` coding-agent repository, used by `packages/shared/src/model-prices.ts`
to price recorded token usage. See `topics/limited-users.md` § Delivery v1 —
Usage for what the prices are used for.

## Source

| | |
|---|---|
| Upstream | `pi` (Mario Zechner), local checkout `~/pi` |
| Revision | `371adcf37130629ffb9bbeed9f5548ce08ffa93b` |
| Upstream date | 2026-06-24 |
| Upstream version | `0.0.3` |
| License | MIT — `Copyright (c) 2025 Mario Zechner` |

MIT permits this copy with its notice retained; the copyright line above is
that notice.

## What was taken

Only each model's `id` and its `cost` block — `input`, `output`, `cacheRead`
and `cacheWrite`, in US dollars per million tokens — from these upstream files:

| Upstream file | SHA-256 (first 16) | Models |
|---|---|---|
| `packages/ai/src/providers/anthropic.models.ts` | `63ec93ca875cdb0c` | 25 |
| `packages/ai/src/providers/openai.models.ts` | `d0be3b188ab82739` | 42 |
| `packages/ai/src/providers/openai-codex.models.ts` | `455c5cd18e6aedda` | 4 |
| `packages/ai/src/providers/google.models.ts` | `151bd921f3c336fd` | 16 |
| `packages/ai/src/providers/xai.models.ts` | `0ae1c7d5610d6276` | 7 |
| `packages/ai/src/providers/opencode.models.ts` | `6f435505c847f1e2` | 45 |

`prices.generated.ts`, 139 models:
`d07376f1e8647a6650be2ec90fa8d138c4e1fe74256e5ca52a9e908bed6035d6`.

Upstream carries more providers than these six; the extract covers the ones a
YA provider can reach.

## Local divergences

- **Extracted, not copied.** The upstream files are TypeScript modules
  declaring full `Model` records — api, base URL, context window, thinking
  levels. Only id and prices are kept, as one nested record keyed by upstream
  provider then model id. Nothing else of pi's is in this repo.
- **None of pi's cost code is vendored.** Its `calculateCost` also models
  Anthropic's 1-hour cache-write rate and OpenAI's service-tier multipliers,
  neither of which YA records. YA's own weighting lives in
  `packages/shared/src/model-prices.ts`.
- **No long-context tier upstream.** pi models no context-length-dependent
  rate. YA's per-provider tiers are therefore its own, read from the providers'
  pricing pages: OpenAI reprices above 272k prompt tokens, and Anthropic has no
  tier at all since it removed its over-200k premium on 2026-03-13.
- **Missing current models.** The extract predates Claude Opus 5, Sonnet 5 and
  Fable/Mythos 5.1, and the whole GPT-5.6 family, GPT-6 Astra and the Daybreak
  alias. `PUBLISHED_MODEL_PRICES` in `packages/shared/src/model-prices.ts`
  covers those and is read first; regenerating this extract does not remove the
  need for it until upstream catches up.

## Regenerating

```bash
node scripts/generate-vendored-model-prices.mjs ~/pi \
  packages/shared/src/vendor/pi-model-prices/prices.generated.ts
```

Then update the revision, dates, hashes and model counts above. The script
prints a model count per provider: a count that drops to zero means upstream
changed the shape the extract matches on, not that the models went away.
