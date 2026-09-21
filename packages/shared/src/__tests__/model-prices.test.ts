import { describe, expect, it } from "vitest";
import {
  USAGE_LONG_CONTEXT_MULTIPLIERS,
  equivalentOutputTokens,
  findModelPrices,
  tokenCostUsd,
  unlistedEquivalentOutputTokens,
} from "../model-prices.js";

/** Contract: topics/limited-users.md § Delivery v1 — Usage. */

const noTokens = {
  freshInputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
};

describe("findModelPrices", () => {
  it("resolves a provider model id under that provider's price list", () => {
    expect(findModelPrices("claude", "claude-opus-4-5")).toMatchObject({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    });
  });

  it("resolves a dated id by its longest listed prefix", () => {
    // The table lists both, but a model dated past the table still resolves.
    expect(findModelPrices("claude", "claude-opus-4-5-20991231")).toMatchObject(
      { output: 25 },
    );
  });

  it("ignores the 1m context marker YA adds to an alias", () => {
    expect(findModelPrices("claude", "claude-sonnet-4-5[1m]")).toMatchObject({
      output: 15,
    });
  });

  it("reads a Codex model under OpenAI's list, where cache writes are free", () => {
    expect(findModelPrices("codex", "gpt-5.5")).toMatchObject({
      input: 5,
      output: 30,
      cacheWrite: 0,
    });
  });

  it("has no price for an unlisted or unnamed model", () => {
    expect(findModelPrices("claude", "qwen3-coder-local")).toBe(undefined);
    expect(findModelPrices("claude", undefined)).toBe(undefined);
    // A bare launch alias is not a provider model id and is not guessed at.
    expect(findModelPrices("claude", "opus")).toBe(undefined);
  });
});

describe("tokenCostUsd", () => {
  const prices = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

  it("charges each class at its own rate", () => {
    const usd = tokenCostUsd(
      {
        freshInputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
      prices,
    );
    expect(usd).toBeCloseTo(5 + 0.5 + 6.25 + 25, 9);
  });

  it("applies the long-context premium to prompt and output separately", () => {
    const classes = {
      ...noTokens,
      freshInputTokens: 1_000_000,
      outputTokens: 1_000_000,
    };
    const standard = tokenCostUsd(classes, prices);
    const long = tokenCostUsd(classes, prices, { longContext: true });
    expect(long).toBeCloseTo(
      5 * USAGE_LONG_CONTEXT_MULTIPLIERS.prompt +
        25 * USAGE_LONG_CONTEXT_MULTIPLIERS.output,
      9,
    );
    expect(long).toBeGreaterThan(standard);
  });
});

describe("equivalentOutputTokens", () => {
  const prices = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

  it("is the dollars divided by the model's output price, exactly", () => {
    const classes = {
      freshInputTokens: 1000,
      cachedInputTokens: 9000,
      cacheWriteTokens: 500,
      outputTokens: 2000,
    };
    const usd = tokenCostUsd(classes, prices);
    expect(equivalentOutputTokens(classes, prices)).toBe(
      Math.round(usd / (prices.output / 1_000_000)),
    );
  });

  it("counts a pure generation charge as itself", () => {
    expect(
      equivalentOutputTokens({ ...noTokens, outputTokens: 1234 }, prices),
    ).toBe(1234);
  });

  it("prices a cache read at a fiftieth of an output token", () => {
    expect(
      equivalentOutputTokens({ ...noTokens, cachedInputTokens: 5000 }, prices),
    ).toBe(100);
  });

  it("has no unit for a model whose output is free", () => {
    expect(
      equivalentOutputTokens(
        { ...noTokens, outputTokens: 10 },
        {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
      ),
    ).toBeNull();
  });
});

describe("unlistedEquivalentOutputTokens", () => {
  it("prices a fresh prompt token midway between the listed families", () => {
    // Anthropic's output is 5x a fresh prompt token and OpenAI's 6x, so 5.5.
    expect(
      unlistedEquivalentOutputTokens({ ...noTokens, freshInputTokens: 5500 }),
    ).toBe(1000);
  });

  it("counts generation as itself", () => {
    expect(
      unlistedEquivalentOutputTokens({ ...noTokens, outputTokens: 42 }),
    ).toBe(42);
  });

  it("prices a cache read at a tenth of a fresh prompt token", () => {
    expect(
      unlistedEquivalentOutputTokens({
        ...noTokens,
        cachedInputTokens: 55_000,
      }),
    ).toBe(1000);
  });
});
