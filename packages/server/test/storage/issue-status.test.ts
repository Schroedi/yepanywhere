import type { IssueItem, IssueSettings } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import { IssueCredentials } from "../../src/services/issues/credentials.js";
import { IssueStatusRefresher } from "../../src/services/issues/status.js";

const MERGED = "github:github.com:o/app:1";
const DRAFT = "github:github.com:o/app:2";
const CLOSED = "github:github.com:o/lib:3";
const MISSING = "github:github.com:o/gone:4";
const JIRA = "jira:t.test:ABC-1";

function item(id: string): IssueItem {
  return {
    id,
    key: id,
    title: null,
    url: null,
    provider: id.startsWith("jira") ? "jira" : "github",
    kind: "pr",
    sessionCount: 1,
    unresolved: false,
  };
}

/** GitHub's answer shape: one field per repository, one per number inside. */
function graphql(answers: Record<string, unknown>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const query = JSON.parse(String(init?.body)).query as string;
    const data: Record<string, Record<string, unknown> | null> = {};
    let repo = "";
    let alias = "";
    for (const field of query.matchAll(
      /(r\d+): repository\(owner: "(\w+)", name: "(\w+)"\)|(i\d+): issueOrPullRequest\(number: (\d+)\)/g,
    )) {
      if (field[1]) {
        [alias, repo] = [field[1], `${field[2]}/${field[3]}`];
        data[alias] = field[3] === "gone" ? null : {};
      } else if (data[alias])
        data[alias]![field[4]!] = answers[`${repo}#${field[5]}`] ?? null;
    }
    return new Response(JSON.stringify({ data }));
  });
}

function harness(answers: Record<string, unknown>) {
  let now = Date.parse("2026-10-13T10:00:00Z");
  let settings: IssueSettings = {
    enabled: true,
    scope: "viewed",
    recentDays: 7,
    confirmation: { enabled: true },
  };
  const fetch = graphql(answers);
  const refresher = new IssueStatusRefresher({
    settings: () => settings,
    credentials: new IssueCredentials({
      env: { GITHUB_TOKEN: "gh-secret" },
      cliToken: async () => null,
    }),
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => now,
  });
  return {
    fetch,
    refresher,
    advance: (ms: number) => {
      now += ms;
    },
    set: (next: Partial<IssueSettings>) => {
      settings = { ...settings, ...next };
    },
    read: (...ids: string[]) => refresher.annotate(ids.map(item)),
  };
}

describe("tracker status refresh", () => {
  it("asks once per batch, reports states, and asks again only when stale and unmerged", async () => {
    const h = harness({
      "o/app#1": { __typename: "PullRequest", state: "MERGED", isDraft: false },
      "o/app#2": { __typename: "PullRequest", state: "OPEN", isDraft: true },
      "o/lib#3": { __typename: "Issue", state: "CLOSED" },
    });
    const ids = [MERGED, DRAFT, CLOSED, MISSING, JIRA];
    const first = h.read(...ids);
    expect(first.refreshing).toBe(true);
    expect(first.items.some((x) => x.trackerStatus)).toBe(false);
    // A second reader joins the pass instead of starting its own.
    expect(h.read(...ids).refreshing).toBe(true);
    await h.refresher.settled();
    expect(h.fetch).toHaveBeenCalledTimes(1);

    const second = h.read(...ids);
    expect(second.refreshing).toBe(false);
    expect(second.items.map((x) => x.trackerStatus?.state)).toEqual([
      "merged",
      "draft",
      "closed",
      undefined,
      undefined,
    ]);
    expect(second.items[0]!.trackerStatus!.checkedAt).toBe(
      "2026-10-13T10:00:00.000Z",
    );

    // Fresh answers and recent failures are reused; nothing is asked.
    h.advance(60_000);
    expect(h.read(...ids).refreshing).toBe(false);
    await h.refresher.settled();
    expect(h.fetch).toHaveBeenCalledTimes(1);

    // Past five minutes the unmerged ones are asked again, merged never.
    h.advance(5 * 60_000);
    expect(h.read(...ids).refreshing).toBe(true);
    await h.refresher.settled();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    const query = JSON.parse(String(h.fetch.mock.calls[1]![1]!.body)).query;
    expect(query).not.toContain("number: 1)");
    expect(query).toContain("number: 2)");
  });

  it("keeps the last state through a failed lookup and asks nothing while off", async () => {
    const h = harness({
      "o/app#2": { __typename: "PullRequest", state: "OPEN", isDraft: false },
    });
    h.read(DRAFT);
    await h.refresher.settled();
    h.fetch.mockRejectedValueOnce(new Error("offline"));
    h.advance(5 * 60_000);
    h.read(DRAFT);
    await h.refresher.settled();
    expect(h.read(DRAFT).items[0]!.trackerStatus).toEqual({
      state: "open",
      checkedAt: "2026-10-13T10:00:00.000Z",
    });
    expect(h.fetch).toHaveBeenCalledTimes(2);

    h.set({ confirmation: { enabled: false } });
    h.advance(5 * 60_000);
    expect(h.read(DRAFT)).toEqual({ items: [item(DRAFT)], refreshing: false });
    await h.refresher.settled();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
});
