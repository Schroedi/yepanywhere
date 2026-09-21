// @vitest-environment jsdom

import {
  EMPTY_USAGE_TOTALS,
  type UsageReport,
  type UsageTokenBucket,
  type UsageTotals,
} from "@yep-anywhere/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n";
import { UserUsageTable, formatTokenCount, formatUsd } from "../UserUsageTable";

/** Contract: topics/limited-users.md § Delivery v1 — Usage. */

const DAY_MS = 24 * 60 * 60 * 1000;

function bucket(overrides: Partial<UsageTokenBucket>): UsageTokenBucket {
  return {
    name: "opus",
    tokens: {
      freshInputTokens: 1000,
      cachedInputTokens: 9000,
      cacheWriteTokens: 0,
      outputTokens: 2000,
    },
    equivalentOutputTokens: 2400,
    costUsd: 0.06,
    ...overrides,
  };
}

function totals(overrides: Partial<UsageTotals> = {}): UsageTotals {
  return {
    ...EMPTY_USAGE_TOTALS,
    sessions: 8,
    turns: 141,
    words: 4913,
    activeMs: 4 * 60 * 60 * 1000 + 25 * 60 * 1000,
    tokens: {
      freshInputTokens: 1000,
      cachedInputTokens: 9000,
      cacheWriteTokens: 0,
      outputTokens: 2000,
    },
    byModel: [bucket({})],
    byProject: [bucket({ name: "yepanywhere", equivalentOutputTokens: null })],
    ...overrides,
  };
}

function report(overrides: Partial<UsageReport> = {}): UsageReport {
  const now = new Date("2026-09-21T12:00:00").getTime();
  return {
    now,
    since: now - 13 * DAY_MS,
    users: [{ username: null, total: totals(), lastWeek: totals() }],
    ...overrides,
  };
}

function renderTable(value: UsageReport) {
  return render(
    <I18nProvider>
      <UserUsageTable report={value} />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe("UserUsageTable", () => {
  it("names the calendar days the ledger spans in the all-recorded column", () => {
    renderTable(report());
    expect(screen.getByText("All recorded (14 days)")).toBeTruthy();
  });

  it("says 7 days rather than 'last week', which reads as a calendar week", () => {
    renderTable(report());
    expect(screen.getByText("Over last 7 days")).toBeTruthy();
    expect(screen.queryByText("Last week")).toBeNull();
  });

  it("shows a model's cost in its own output tokens with dollars beside it", () => {
    renderTable(report());
    // Both windows render the same totals, so the line appears twice.
    expect(screen.getAllByText(/opus ≈2,400 out \$0\.06/).length).toBe(2);
  });

  it("shows a cross-model project bucket dollars alone", () => {
    renderTable(report());
    const line = screen.getAllByText(/yepanywhere/)[0];
    expect(line?.textContent).toContain("$0.06");
    expect(line?.textContent).not.toContain("out");
  });

  it("shows raw volume for a bucket with neither figure", () => {
    const unpriced = totals({
      byModel: [
        bucket({
          name: "qwen-local",
          equivalentOutputTokens: null,
          costUsd: null,
        }),
      ],
      byProject: [],
    });
    renderTable(
      report({
        users: [{ username: null, total: unpriced, lastWeek: unpriced }],
      }),
    );
    expect(screen.getAllByText(/qwen-local 12\.0k/).length).toBe(2);
  });

  it("omits every token line when nothing was charged", () => {
    const noTokens = totals({
      tokens: EMPTY_USAGE_TOTALS.tokens,
      byModel: [],
      byProject: [],
    });
    renderTable(
      report({
        users: [{ username: null, total: noTokens, lastWeek: noTokens }],
      }),
    );
    // The header hint mentions tokens; the cell must not.
    expect(screen.queryByText(/by model/)).toBeNull();
    expect(screen.queryByText(/by project/)).toBeNull();
    expect(screen.queryByText(/^[\d.,]+[kM]? tokens$/)).toBeNull();
  });

  it("says nothing is recorded rather than reporting an empty span", () => {
    renderTable(report({ since: null, users: [] }));
    expect(screen.getByText(/Nothing recorded yet/)).toBeTruthy();
  });
});

describe("formatTokenCount", () => {
  it("is exact below ten thousand and abbreviated above", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(9999)).toBe("9,999");
    expect(formatTokenCount(12_345)).toBe("12.3k");
    expect(formatTokenCount(2_500_000)).toBe("2.5M");
  });
});

describe("formatUsd", () => {
  it("keeps two cheap sessions distinguishable and rounds large ones", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0.06)).toBe("$0.06");
    expect(formatUsd(9.5)).toBe("$9.50");
    expect(formatUsd(1234.5)).toBe("$1235");
  });

  it("shows an exact zero as zero, not as under a cent", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });
});
