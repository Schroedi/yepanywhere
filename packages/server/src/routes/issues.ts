import { Hono, type MiddlewareHandler } from "hono";
import type { IssueSettings } from "@yep-anywhere/shared";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import type { IssueIndexer } from "../services/issues/IssueIndexer.js";
import { issueUrl } from "../services/issues/extract.js";
import { randomUUID } from "node:crypto";

export function createIssueRoutes(
  indexer: IssueIndexer,
  settings: ServerSettingsService,
  validSource: (
    projectId: string,
    sessionId: string,
  ) => Promise<{ available: boolean; title?: string }>,
) {
  const routes = new Hono();
  routes.get("/issues/settings", (c) => c.json(indexer.coverage()));
  routes.put("/issues/settings", async (c) => {
    const body = (await c.req.json().catch(() => null)) as IssueSettings | null;
    if (
      !body ||
      typeof body.enabled !== "boolean" ||
      !["viewed", "recent"].includes(body.scope) ||
      !Number.isInteger(body.recentDays) ||
      body.recentDays < 1 ||
      body.recentDays > 90
    )
      return c.json(
        {
          error:
            "Expected enabled, scope (viewed/recent), and recentDays (1–90)",
        },
        400,
      );
    await settings.updateSettings({
      issueAssociations: {
        enabled: body.enabled,
        scope: body.scope,
        recentDays: body.recentDays,
      },
    });
    return c.json(indexer.coverage());
  });
  const requireEnabled: MiddlewareHandler = async (c, next) => {
    if (!indexer.settings().enabled)
      return c.json({ error: "Issue associations are disabled" }, 403);
    await next();
  };
  routes.use("/issues", requireEnabled);
  routes.use("/issues/*", requireEnabled);
  const page = (limit: string | undefined, offset: string | undefined) => {
    const size = limit === undefined ? 50 : Number(limit),
      start = offset === undefined ? 0 : Number(offset);
    if (
      !Number.isInteger(size) ||
      size < 1 ||
      size > 100 ||
      !Number.isSafeInteger(start) ||
      start < 0
    )
      return null;
    return { size, start };
  };
  routes.get("/issues", (c) => {
    const p = page(c.req.query("limit"), c.req.query("offset"));
    const query = c.req.query("q") ?? "";
    if (!p || query.length > 4096)
      return c.json({ error: "Invalid search or pagination" }, 400);
    const items = indexer.store.list(
      issueUrl(query)?.url ?? query,
      c.req.query("projectId") ?? "",
      c.req.query("sessionId") ?? "",
      c.req.query("dismissed") === "1",
      p.size,
      p.start,
    );
    return c.json({
      items,
      coverage: indexer.coverage(),
      nextOffset: items.length === p.size ? p.start + p.size : null,
    });
  });
  routes.get("/issues/evidence", async (c) => {
    const p = page(c.req.query("limit"), c.req.query("offset")),
      id = c.req.query("id");
    if (!p || !id || id.length > 4096)
      return c.json({ error: "Invalid evidence request" }, 400);
    try {
      const evidence = indexer.store.evidence(id, p.size, p.start);
      const available = new Map<
        string,
        { available: boolean; title?: string }
      >();
      // At most one head lookup per session, bounded by the requested page.
      for (const item of evidence) {
        if (!available.has(item.sessionId))
          available.set(
            item.sessionId,
            await validSource(item.projectId, item.sessionId),
          );
        item.sourceAvailable = available.get(item.sessionId)!.available;
        item.sessionTitle = available.get(item.sessionId)!.title;
      }
      return c.json({
        evidence,
        nextOffset: evidence.length === p.size ? p.start + p.size : null,
      });
    } catch {
      return c.json({ error: "Evidence unavailable" }, 503);
    }
  });
  routes.post("/issues/decision", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.id !== "string" ||
      body.id.length > 4096 ||
      typeof body.sessionId !== "string" ||
      !["confirmed", "dismissed", "discovered"].includes(body.state)
    )
      return c.json({ error: "Invalid association decision" }, 400);
    try {
      indexer.store.decide(body.id, body.sessionId, body.state);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "Decision could not be saved" }, 400);
    }
  });
  routes.patch("/issues/item", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.id !== "string" ||
      body.id.length > 4096 ||
      (body.title !== null &&
        (typeof body.title !== "string" || body.title.length > 512))
    )
      return c.json({ error: "Invalid title" }, 400);
    indexer.store.title(body.id, body.title);
    return c.json({ ok: true });
  });
  routes.delete("/issues/item", async (c) => {
    const id = c.req.query("id");
    if (!id || id.length > 4096) return c.json({ error: "Invalid item" }, 400);
    try {
      indexer.delete(id);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "Item could not be deleted" }, 400);
    }
  });
  routes.post("/issues/resolve", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.url !== "string" ||
      !issueUrl(body.url) ||
      typeof body.projectId !== "string" ||
      typeof body.sessionId !== "string" ||
      (body.note !== undefined &&
        (typeof body.note !== "string" || body.note.length > 512))
    )
      return c.json(
        { error: "A supported issue URL and source session are required" },
        400,
      );
    if (body.key !== undefined && issueUrl(body.url)?.key !== body.key)
      return c.json({ error: "URL does not identify this reference" }, 400);
    if (!(await validSource(body.projectId, body.sessionId)).available)
      return c.json({ error: "Session unavailable in this project" }, 404);
    // Authorization/settings may have changed while the session was resolved.
    if (!indexer.settings().enabled)
      return c.json({ error: "Issue associations are disabled" }, 403);
    const id = `manual-${randomUUID()}`;
    indexer.store.capture(
      { projectId: body.projectId, sessionId: body.sessionId },
      { id, text: body.url },
    );
    indexer.store.run(
      "UPDATE session_issue_evidence SET kind='manual',excerpt=? WHERE message_id=?",
      body.note ?? "",
      id,
    );
    indexer.resumePendingWork();
    return c.json({ ok: true });
  });
  return routes;
}
