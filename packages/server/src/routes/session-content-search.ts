import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import {
  getCollapsedSearchPreviewText,
  normalizeSearchPreviewText,
  type SessionContentSearchBatch,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { GlobalSessionsDeps } from "./global-sessions.js";
import { SourceVersionedSingleFlight } from "../lib/sourceVersionedSingleFlight.js";
import type { IssueTextBatch } from "../sessions/issue-text-reader.js";
import { getSessionSources } from "../sessions/provider-resolution.js";
import { providerResolutionDeps } from "./session-provider-resolution.js";

const requestSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    query: z.string().trim().min(1).max(512),
    roles: z
      .array(z.enum(["user", "assistant"]))
      .min(1)
      .max(2),
    after: z.number().finite().optional(),
    before: z.number().finite().optional(),
    cursor: z.string().max(32768).optional(),
  })
  .refine(
    (r) =>
      r.after === undefined || r.before === undefined || r.after <= r.before,
  );

const cursorSchema = z.object({
  key: z.string(),
  expires: z.number(),
  reader: z.string(),
  ordinal: z.number().int().nonnegative(),
  sourceVersion: z.string(),
});

/** Pull-driven batches retain no transcript or background job between requests. */
export function createSessionContentSearchRoutes(
  deps: GlobalSessionsDeps,
): Hono {
  const routes = new Hono();
  const secret = randomBytes(32);
  const reads = new SourceVersionedSingleFlight<string, IssueTextBatch>({
    maxRetainedBytes: 0,
    estimateBytes: () => 0,
    shouldRetain: () => false,
  });
  let active = 0;
  routes.post("/content-search", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ error: "Invalid content search" }, 400);
    if (!deps.retainedCollections)
      return c.json({ error: "Session catalog unavailable" }, 503);
    if (active >= 4)
      return c.json({ error: "Content search is busy; retry shortly" }, 429);
    const { cursor, ...request } = parsed.data;
    const key = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");
    let readerCursor: string | undefined;
    let ordinal = 0;
    let cursorSourceVersion: string | undefined;
    if (cursor) {
      try {
        const bytes = Buffer.from(cursor, "base64url");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          secret,
          bytes.subarray(0, 12),
        );
        decipher.setAuthTag(bytes.subarray(12, 28));
        const clear = Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]);
        const decoded = cursorSchema.parse(JSON.parse(clear.toString("utf8")));
        if (decoded.key !== key || decoded.expires < Date.now())
          throw new Error("Expired cursor");
        readerCursor = decoded.reader;
        ordinal = decoded.ordinal;
        cursorSourceVersion = decoded.sourceVersion;
      } catch {
        return c.json(
          {
            error:
              "Search cursor expired or does not match this query; restart search",
          },
          400,
        );
      }
    }
    active++;
    try {
      const catalog = await deps.retainedCollections.read();
      const session = catalog.rows.find(
        (s) => s.sessionId === request.sessionId,
      );
      if (!session)
        return c.json({ error: "Session not found in catalog" }, 404);
      if (cursorSourceVersion && cursorSourceVersion !== session.sourceVersion)
        return c.json({ error: "Transcript changed; restart search" }, 409);
      const project = await deps.scanner.getProject(session.projectId);
      if (!project) return c.json({ error: "Project unavailable" }, 404);
      const sources = getSessionSources(
        { ...project, provider: session.provider ?? session.catalogFamily },
        providerResolutionDeps(deps),
        session.provider,
      );
      const reader = sources[0]?.reader;
      if (!reader?.readIssueTextBatch) {
        return c.json({
          matches: [],
          done: true,
          partial: true,
          bytesRead: 0,
          unavailable: `Bounded turn search is unavailable for ${session.provider}`,
        } satisfies SessionContentSearchBatch);
      }
      const result = await reads.run({
        key: JSON.stringify([session.sessionId, readerCursor]),
        sourceVersion: session.sourceVersion,
        compute: () =>
          reader.readIssueTextBatch!(session.sessionId, {
            cursor: readerCursor,
            signal: AbortSignal.timeout(30_000),
            maxRecords: 128,
          }),
        isCurrent: async (version) =>
          (await deps.retainedCollections!.read()).rows.some(
            (row) =>
              row.sessionId === session.sessionId &&
              row.sourceVersion === version,
          ),
      });
      if (result.status === "stale" || (readerCursor && result.value.restarted))
        return c.json({ error: "Transcript changed; restart search" }, 409);
      const batch = result.value;
      const needle = request.query.replace(/\s+/g, " ").toLowerCase();
      const matches: SessionContentSearchBatch["matches"] = [];
      for (const message of batch.messages) {
        ordinal++;
        if (!message.role || !request.roles.includes(message.role)) continue;
        if (request.after !== undefined || request.before !== undefined) {
          const timestamp = Date.parse(message.timestamp ?? "");
          if (
            !Number.isFinite(timestamp) ||
            timestamp < (request.after ?? -Infinity) ||
            timestamp > (request.before ?? Infinity)
          )
            continue;
        }
        if (
          !normalizeSearchPreviewText(message.text)
            .replace(/\s+/g, " ")
            .toLowerCase()
            .includes(needle)
        )
          continue;
        matches.push({
          id: message.id,
          role: message.role,
          ordinal,
          timestamp: message.timestamp,
          preview: getCollapsedSearchPreviewText(message.text, request.query),
        });
      }
      let nextCursor: string | undefined;
      if (!batch.done) {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", secret, iv);
        const encrypted = Buffer.concat([
          cipher.update(
            JSON.stringify({
              key,
              expires: Date.now() + 30 * 60_000,
              reader: batch.cursor,
              ordinal,
              sourceVersion: session.sourceVersion,
            }),
          ),
          cipher.final(),
        ]);
        nextCursor = Buffer.concat([
          iv,
          cipher.getAuthTag(),
          encrypted,
        ]).toString("base64url");
      }
      return c.json({
        matches,
        cursor: nextCursor,
        done: batch.done,
        partial: batch.partial,
        bytesRead: batch.bytesRead,
      } satisfies SessionContentSearchBatch);
    } finally {
      active--;
    }
  });
  return routes;
}
