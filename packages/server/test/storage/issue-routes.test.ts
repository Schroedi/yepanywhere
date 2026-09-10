import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { DiscoverySqliteService } from "../../src/storage/discovery-sqlite.js";
import { IssueStore } from "../../src/services/issues/IssueStore.js";
import {
  IssueIndexer,
  DEFAULT_ISSUE_SETTINGS,
} from "../../src/services/issues/IssueIndexer.js";
import { createIssueRoutes } from "../../src/routes/issues.js";
import { getServerCapabilities } from "../../src/routes/version.js";

it("gates all data routes, validates settings, saves through the shared settings service, and resolves Jira references", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-issue-routes-"));
  const settings = new ServerSettingsService({ dataDir });
  await settings.initialize();
  const db = new DiscoverySqliteService({ dataDir, mode: "auto" });
  const store = new IssueStore(db.getDatabase()!);
  const indexer = new IssueIndexer(store, {
    settings: () =>
      settings.getSetting("issueAssociations") ?? DEFAULT_ISSUE_SETTINGS,
    candidates: async function* () {},
    read: async () => null,
  });
  const unsub = settings.onSettingsChanged(() => indexer.configure());
  const app = createIssueRoutes(indexer, settings, async (p, s) => ({
    available: p === "p" && s === "s",
    title: "Source conversation",
  }));
  const request = (path: string, method = "GET", body?: unknown) =>
    app.request(`/issues${path.replace(/^\/(?=\?|$)/, "")}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    expect((await request("/")).status).toBe(403);
    expect((await request("/evidence?id=anything")).status).toBe(403);
    expect((await request("/settings")).status).toBe(200);
    expect(
      (
        await request("/settings", "PUT", {
          enabled: true,
          scope: "recent",
          recentDays: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/settings", "PUT", {
          enabled: true,
          scope: "viewed",
          recentDays: 7,
        })
      ).status,
    ).toBe(200);
    indexer.observe({ sessionId: "s", projectId: "p" }, [
      { type: "user", uuid: "m", content: "ABC-123" },
    ]);
    await indexer.settled();
    const found = await (await request("/?q=ABC-123")).json();
    expect(found.items[0].unresolved).toBe(true);
    // Resolution must continue beyond one SQL batch without another session view.
    for (let i = 0; i < 55; i++)
      store.capture(
        { sessionId: "s", projectId: "p" },
        { id: `extra-${i}`, text: "ABC-123" },
      );
    expect(
      (
        await request("/resolve", "POST", {
          url: "https://jira.test/browse/ABC-123",
          projectId: "p",
          sessionId: "wrong",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request("/resolve", "POST", {
          url: "https://jira.test/browse/ABC-123",
          projectId: "p",
          sessionId: "s",
        })
      ).status,
    ).toBe(200);
    await indexer.settled();
    const resolved = await (await request("/?q=ABC-123")).json();
    expect(resolved.items).toHaveLength(1);
    expect(
      store.rows("SELECT 1 FROM session_issue_evidence WHERE link_id IS NULL"),
    ).toHaveLength(0);
    expect(resolved.items[0].unresolved).toBe(false);
    const proof = await (
      await request(`/evidence?id=${encodeURIComponent(resolved.items[0].id)}`)
    ).json();
    expect(
      proof.evidence.every(
        (entry: { sourceAvailable: boolean }) => entry.sourceAvailable,
      ),
    ).toBe(true);
    store.capture(
      { sessionId: "missing", projectId: "p" },
      { id: "historic", text: "https://jira.test/browse/ABC-123" },
    );
    const retained = await (
      await request(`/evidence?id=${encodeURIComponent(resolved.items[0].id)}`)
    ).json();
    expect(
      retained.evidence.find(
        (entry: { sessionId: string }) => entry.sessionId === "missing",
      ).sourceAvailable,
    ).toBe(false);
    store.decide(resolved.items[0].id, "missing", "dismissed");
    expect((await request("/?limit=101")).status).toBe(400);
    expect(
      (
        await request("/decision", "POST", {
          id: resolved.items[0].id,
          sessionId: "s",
          state: "dismissed",
        })
      ).status,
    ).toBe(200);
    expect((await (await request("/")).json()).items).toHaveLength(0);
    expect((await (await request("/?dismissed=1")).json()).items).toHaveLength(
      1,
    );
    const second = new ServerSettingsService({ dataDir });
    await second.initialize();
    expect(second.getSetting("issueAssociations")?.enabled).toBe(true);
  } finally {
    unsub();
    await indexer.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
it("advertises only when SQLite and the implementation are both available", () => {
  const capability = "issue-session-associations-v1";
  expect(
    getServerCapabilities({ getSqliteStatus: () => ({ state: "ready" }) }),
  ).not.toContain(capability);
  expect(
    getServerCapabilities({
      getSqliteStatus: () => ({ state: "ready" }),
      getIssueAssociationsAvailable: () => true,
    }),
  ).toContain(capability);
  expect(
    getServerCapabilities({
      getSqliteStatus: () => ({ state: "error" }),
      getIssueAssociationsAvailable: () => true,
    }),
  ).not.toContain(capability);
});
