/**
 * Pricing recorded token usage: what a set of token counts cost, and the same
 * cost as a count of that model's output tokens.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Usage.
 *
 * The two numbers are one calculation. Dollars come from the vendored
 * per-model price table; the output-token equivalent is those dollars divided
 * by the one constant that model charges per output token. So the equivalent
 * is exactly "what this would have cost as plain generation on this model",
 * and the dollar figure is a supplement to it rather than a separate estimate
 * that could disagree.
 *
 * Why the equivalent leads: a model's prices change, and a report that reads
 * in output tokens keeps meaning the same thing when they do. Dollars are what
 * the table happened to say when the report was drawn.
 */

import type { UsageTokenClasses } from "./user-usage.js";
import {
  VENDORED_MODEL_PRICES,
  type VendoredModelPrices,
} from "./vendor/pi-model-prices/prices.generated.js";

/**
 * Which upstream price list a YA provider reads. `pi` is absent because it
 * proxies whatever model it was pointed at; those resolve by searching every
 * list instead.
 */
const UPSTREAM_PROVIDER_BY_YA_PROVIDER: Readonly<Record<string, string>> = {
  claude: "anthropic",
  "claude-gateway": "anthropic",
  "claude-ollama": "anthropic",
  codex: "openai-codex",
  "codex-oss": "openai",
  opencode: "opencode",
  grok: "xai",
  gemini: "google",
  "gemini-acp": "google",
};

/**
 * Strip what YA adds to a model name that the price table never has: the
 * `[1m]` context-window marker and a `provider/` prefix.
 */
function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^[a-z-]+\//u, "")
    .replace(/\[1m\]$/u, "")
    .replace(/-1m$/u, "");
}

/** Longest id in `prices` that the model starts with, so a dated id resolves. */
function longestPrefixMatch(
  prices: Readonly<Record<string, VendoredModelPrices>>,
  model: string,
): VendoredModelPrices | undefined {
  let best: VendoredModelPrices | undefined;
  let bestLength = 0;
  for (const [id, entry] of Object.entries(prices)) {
    if (model.startsWith(id) && id.length > bestLength) {
      best = entry;
      bestLength = id.length;
    }
  }
  return best;
}

/**
 * Prices for one model, or undefined when the table does not name it — a
 * launch alias such as `opus` with no resolved provider id behind it, a
 * self-hosted model, or a model newer than the vendored table. Undefined is
 * reported as "no price" rather than guessed at.
 */
export function findModelPrices(
  provider: string,
  model: string | undefined,
): VendoredModelPrices | undefined {
  if (!model) return undefined;
  const normalized = normalizeModelId(model);
  const upstream = UPSTREAM_PROVIDER_BY_YA_PROVIDER[provider];
  const lists = upstream
    ? [VENDORED_MODEL_PRICES[upstream]]
    : Object.values(VENDORED_MODEL_PRICES);
  for (const prices of lists) {
    if (!prices) continue;
    const exact = prices[normalized];
    if (exact) return exact;
  }
  for (const prices of lists) {
    if (!prices) continue;
    const prefixed = longestPrefixMatch(prices, normalized);
    if (prefixed) return prefixed;
  }
  return undefined;
}

/**
 * Above this prompt length a request is in the long-context tier. YA's
 * `sonnet[1m]` and `opus[1m]` aliases reach it. The recorder decides a
 * request's tier from the prompt it actually sent, because nothing downstream
 * can recover one request's length from a sum.
 */
export const USAGE_LONG_CONTEXT_THRESHOLD_TOKENS = 200_000;

/**
 * Anthropic's published premium above the threshold for its 1M-context models.
 *
 * **Not from the vendored table**, which models no context-length-dependent
 * rate and carries no 1M-context entry, so nothing there corroborates these
 * two numbers. They are applied because ignoring the tier would report a
 * long-context session at roughly half what it cost, which is the larger
 * error — but they are the one part of this calculation that is not
 * cross-checked, and a session that never crosses 200k tokens never uses them.
 */
export const USAGE_LONG_CONTEXT_MULTIPLIERS = {
  prompt: 2,
  output: 1.5,
} as const;

/**
 * What one token of each class costs in output tokens of the same model, for a
 * model the price table does not name — a local or self-hosted one, or one
 * newer than the vendored table.
 *
 * Midway between the two listed families: Anthropic prices output at five
 * times a fresh prompt token and OpenAI's Codex models at six, so 5.5; both
 * price a cache read at a tenth of a fresh token; Anthropic bills a cache
 * write at 1.25 fresh tokens and OpenAI at nothing, so 0.625.
 *
 * These are list-price ratios, which track the real compute asymmetry only
 * roughly — generation is serial while prompt processing batches, and the true
 * ratio moves with how much of the cost is attention over the whole context
 * versus per-token work. For a usage estimate on an unlisted model that is the
 * right precision; it is why this yields an output-token equivalent and never
 * a dollar figure.
 */
const UNLISTED_MODEL_OUTPUT_EQUIVALENTS = {
  freshInput: 1 / 5.5,
  cachedInput: 1 / 55,
  cacheWrite: 0.625 / 5.5,
} as const;

/**
 * An unlisted model's counts in its own output tokens, from the ratios above.
 * No dollars: nothing here knows what that model's output token costs.
 */
export function unlistedEquivalentOutputTokens(
  classes: UsageTokenClasses,
  options: { longContext?: boolean } = {},
): number {
  const tier = options.longContext
    ? USAGE_LONG_CONTEXT_MULTIPLIERS
    : { prompt: 1, output: 1 };
  const prompt =
    classes.freshInputTokens * UNLISTED_MODEL_OUTPUT_EQUIVALENTS.freshInput +
    classes.cachedInputTokens * UNLISTED_MODEL_OUTPUT_EQUIVALENTS.cachedInput +
    classes.cacheWriteTokens * UNLISTED_MODEL_OUTPUT_EQUIVALENTS.cacheWrite;
  return Math.round(prompt * tier.prompt + classes.outputTokens * tier.output);
}

/** What one set of counts cost in US dollars, at one model's prices. */
export function tokenCostUsd(
  classes: UsageTokenClasses,
  prices: VendoredModelPrices,
  options: { longContext?: boolean } = {},
): number {
  const tier = options.longContext
    ? USAGE_LONG_CONTEXT_MULTIPLIERS
    : { prompt: 1, output: 1 };
  const prompt =
    classes.freshInputTokens * prices.input +
    classes.cachedInputTokens * prices.cacheRead +
    classes.cacheWriteTokens * prices.cacheWrite;
  const output = classes.outputTokens * prices.output;
  return (prompt * tier.prompt + output * tier.output) / 1_000_000;
}

/**
 * The same cost as a count of that model's standard-tier output tokens: the
 * dollars divided by the model's one dollars-per-output-token constant. A
 * model whose output price is zero — a free or self-hosted entry — has no such
 * unit, so this reports null rather than dividing by zero.
 */
export function equivalentOutputTokens(
  classes: UsageTokenClasses,
  prices: VendoredModelPrices,
  options: { longContext?: boolean } = {},
): number | null {
  if (prices.output <= 0) return null;
  const usd = tokenCostUsd(classes, prices, options);
  return Math.round(usd / (prices.output / 1_000_000));
}
