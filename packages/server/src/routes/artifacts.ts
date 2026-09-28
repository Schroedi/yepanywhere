import { isAbsolute, resolve } from "node:path";
import { Hono } from "hono";
import { createLocalResourcePathPolicy } from "./local-resource-policy.js";
import type { SessionPathScopeResolver } from "./session-path-scope.js";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";
import {
  validateArtifactConfig,
  type ArtifactConfig,
} from "../artifacts/config.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import { expandHomePath } from "../utils/expandHomePath.js";

export function createArtifactRoutes(options: {
  server: ArtifactServer;
  scanner: Pick<ProjectScanner, "getProject" | "listProjects">;
  settings?: ServerSettingsService;
  locked: boolean;
  /** Resolves paths as a session names them, for the session-scoped grant. */
  sessionPathScope?: SessionPathScopeResolver;
}) {
  const routes = new Hono();
  let updating = false;
  routes.put("/artifacts/config", async (c) => {
    if (options.locked || !options.settings)
      return c.json(
        { error: "Artifact configuration is controlled at launch" },
        409,
      );
    if (updating)
      return c.json({ error: "Artifact configuration is being updated" }, 409);
    let config: ArtifactConfig;
    try {
      config = validateArtifactConfig(
        await c.req.json(),
        options.server.config.expiryDays,
        options.server.config,
      );
      const requestHost = new URL(
        `http://${c.req.header("Host") ?? new URL(c.req.url).host}`,
      ).hostname;
      const clientBase = options.settings.getSetting("yaClientBaseUrl");
      const yaHosts = [
        requestHost,
        clientBase ? new URL(clientBase).hostname : undefined,
      ];
      if (
        [config.localOrigin, config.publicOrigin].some(
          (origin) => origin && yaHosts.includes(new URL(origin).hostname),
        )
      ) {
        throw new Error("Artifacts require a different hostname from YA");
      }
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid artifact configuration",
        },
        400,
      );
    }
    updating = true;
    const previous = options.server.config;
    try {
      await options.server.configure(config);
      try {
        await options.settings.updateSettings({ artifactViewer: config });
      } catch (error) {
        await options.server.configure(previous);
        throw error;
      }
      return c.json({ success: true });
    } finally {
      updating = false;
    }
  });
  routes.post("/artifacts", async (c) => {
    if (!options.server.available)
      return c.json({ error: "Artifact serving is disabled" }, 409);
    const body = await c.req.json<unknown>();
    if (!body || typeof body !== "object")
      return c.json({ error: "Invalid artifact request" }, 400);
    const { path, projectId, audience, owned } = body as Record<
      string,
      unknown
    >;
    if (
      typeof path !== "string" ||
      (audience !== "local" && audience !== "public") ||
      (projectId !== undefined && typeof projectId !== "string") ||
      (owned !== undefined && typeof owned !== "boolean")
    )
      return c.json(
        {
          error: "Expected path, optional projectId, and local/public audience",
        },
        400,
      );
    let filePath = expandHomePath(path);
    if (projectId) {
      const project = await options.scanner.getProject(projectId);
      if (!project) return c.json({ error: "Project not found" }, 404);
      filePath = resolve(project.path, filePath);
    }
    return c.json(
      await options.server.createGrant(
        filePath,
        audience,
        owned as boolean | undefined,
      ),
    );
  });
  /**
   * An interactive preview of a file as a session named it: a sandboxed
   * session's /tmp is its private one, and a limited user may grant only
   * files in the session's project or its sandbox's private temp directories
   * (topics/limited-users.md § Authorization). The grant borrows its
   * directory; ownership is reserved for callers that produced it.
   */
  routes.post("/sessions/:sessionId/artifacts", async (c) => {
    if (!options.server.available)
      return c.json({ error: "Artifact serving is disabled" }, 409);
    const scope = options.sessionPathScope;
    if (!scope) return c.json({ error: "Not available" }, 404);
    const body = await c.req.json<unknown>().catch(() => undefined);
    const { path, audience } = (body ?? {}) as Record<string, unknown>;
    if (
      typeof path !== "string" ||
      (audience !== "local" && audience !== "public")
    )
      return c.json({ error: "Expected path and local/public audience" }, 400);
    if (!isAbsolute(expandHomePath(path)))
      return c.json({ error: "Path must be absolute" }, 400);
    const scoped = scope(c, path);
    if ("status" in scoped)
      return c.json({ error: scoped.error }, scoped.status);
    const allowed = await createLocalResourcePathPolicy({
      ...scoped,
      scanner: options.scanner,
    }).resolveAllowedFilePath(scoped.hostPath);
    if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);
    return c.json(
      await options.server.createGrant(
        allowed.file.resolvedPath,
        audience,
        false,
      ),
    );
  });
  routes.delete("/artifacts/:id", async (c) => {
    await options.server.revoke(c.req.param("id"));
    return c.json({ success: true });
  });
  return routes;
}
