import { basename } from "node:path";
import {
  isUrlProjectId,
  type LimitedUserGrants,
  type ProjectAppInfo,
  type ProjectAppView,
  type ProjectAppAddresses,
} from "@yep-anywhere/shared";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";
import type { ProjectAppDelivery } from "../artifacts/ProjectAppDelivery.js";
import { parseVhosts } from "../artifacts/vhosts.js";
import { principalFor } from "../auth/limitedLaunchPolicy.js";
import { levelFor, satisfies } from "../auth/limitedUserPolicy.js";
import type { SessionAccessResolver } from "../auth/sessionAccess.js";
import type { ProjectAppStore } from "../projects/ProjectAppStore.js";
import { projectAppPublicAllowed } from "../projects/projectAppPolicy.js";
import {
  readProjectService,
  projectServiceStaticEntry,
  projectServiceStaticApp,
  type ProjectServiceManager,
} from "../projects/ProjectServiceManager.js";
import type { ProjectScanner } from "../projects/scanner.js";
import { createLocalResourcePathPolicy } from "./local-resource-policy.js";
import type { SessionPathScopeResolver } from "./session-path-scope.js";

const openRequest = z.strictObject({
  target: z.enum(["app", "artifact"]),
  artifactId: z.string().uuid().optional(),
  audience: z.enum(["local", "public"]),
});

/** Project authorization is refreshed at entry and again when queued work executes. */
export function createProjectAppRoutes(deps: {
  scanner: Pick<ProjectScanner, "getProject" | "listProjects">;
  store: ProjectAppStore;
  services: ProjectServiceManager;
  artifacts: ArtifactServer;
  sessionAccess: SessionAccessResolver;
  sessionPathScope: SessionPathScopeResolver;
  activeGrants: (username: string) => LimitedUserGrants | null;
  onVisibilityChanged?: (projectId: string) => void;
  delivery?: ProjectAppDelivery;
  openService: (
    projectId: string,
    audience: "local" | "public",
  ) => Promise<ProjectAppView>;
}) {
  const routes = new Hono();
  /**
   * `view` admits anyone who can see the project, which is also enough to
   * start its declared app; `new-session` is required to stop it or change
   * how it is served (topics/project-service.md § Project App and Settings).
   */
  const authorize = async (
    c: Context,
    required: "view" | "new-session" = "view",
  ) => {
    const projectId = c.req.param("projectId");
    if (!projectId || !isUrlProjectId(projectId))
      throw new HTTPException(404, { message: "Project not found" });
    const principal = principalFor(c);
    if (principal.kind === "limited") {
      const grants = deps.activeGrants(principal.username);
      const level = grants ? levelFor(grants, projectId) : "none";
      if (level === "none")
        throw new HTTPException(404, { message: "Project not found" });
      if (!satisfies(level, required))
        throw new HTTPException(403, {
          message: "Project execution is not permitted",
        });
    }
    const project = await deps.scanner.getProject(projectId);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    return project;
  };

  routes.get("/projects/:projectId/app", async (c) => {
    const project = await authorize(c);
    const principal = principalFor(c);
    const latest = await deps.store.latestArtifact(project.id);
    const history =
      principal.kind === "superuser"
        ? await deps.store.visibilityHistory(project.id)
        : [];
    const visibility = new Map<string, { username: string; at: string }>();
    for (const event of history) {
      if (event.hidden)
        visibility.set(event.username, {
          username: event.username,
          at: event.at,
        });
      else visibility.delete(event.username);
    }
    const info: ProjectAppInfo = {
      projectId: project.id,
      declaration: null,
      state: "none",
      latestArtifact: latest
        ? {
            id: latest.id,
            label: basename(latest.path),
            sessionId: latest.sessionId,
            associatedAt: latest.associatedAt,
          }
        : null,
      canExecute:
        principal.kind === "superuser" ||
        satisfies(levelFor(principal.grants, project.id), "new-session"),
      // Reaching this read already required a view grant.
      canStart: true,
      canPublish: principal.kind === "superuser",
      canShare: !!deps.artifacts.config.publicOrigin,
      removedFrom: [...visibility.values()],
    };
    try {
      info.declaration = await readProjectService(project.path);
      if (info.declaration?.where.kind === "static") {
        await projectServiceStaticEntry(project.path, info.declaration);
        info.state = "ready";
      } else if (info.declaration) {
        const runtime = await deps.services.status(project.id);
        info.state = runtime?.observed ?? "stopped";
        info.generation = runtime?.generation;
        info.error = runtime?.error;
      }
    } catch (error) {
      info.state =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : "unavailable";
      info.error = error instanceof Error ? error.message : String(error);
    }
    const runtime = await deps.services.status(project.id);
    if (runtime && deps.services.ownsLaunch(project.id)) {
      info.activeDeclaration = runtime.declaration;
      info.restartRequired =
        JSON.stringify(info.declaration) !==
        JSON.stringify(runtime.declaration);
      info.state = runtime.observed;
      info.generation = runtime.generation;
      info.error = runtime.error ?? info.error;
    }
    if (
      deps.artifacts.config.vhostPublicRoot &&
      (info.activeDeclaration ?? info.declaration)?.where.kind === "process"
    )
      info.canShare = true;
    info.canCopyLink =
      principal.kind === "superuser" ||
      principal.grants.allowPrivateAppLinks !== false;
    if (!info.canCopyLink) info.canShare = false;
    return c.json(info);
  });

  routes.post("/projects/:projectId/app/start", async (c) => {
    const project = await authorize(c, "view");
    await deps.services.start(project.id, project.path, async () => {
      await authorize(c, "view");
    });
    return c.json({ started: true });
  });
  routes.post("/projects/:projectId/app/stop", async (c) => {
    const project = await authorize(c, "new-session");
    await deps.services.stop(project.id, async () => {
      await authorize(c, "new-session");
    });
    return c.json({ stopped: true });
  });

  routes.post("/projects/:projectId/app/open", async (c) => {
    const project = await authorize(c);
    const parsed = openRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: "Expected app/artifact target and local/public audience" },
        400,
      );
    const request = parsed.data;
    let path: string;
    let declaredRoot: string | undefined;
    let id: string;
    let kind: ProjectAppView["kind"];
    if (request.target === "artifact") {
      const association = request.artifactId
        ? await deps.store.artifact(project.id, request.artifactId)
        : await deps.store.latestArtifact(project.id);
      if (!association)
        throw new HTTPException(404, {
          message: "Artifact association is unavailable",
        });
      const scope = association.sessionId
        ? deps.sessionPathScope(c, association.path, association.sessionId)
        : { allowedPaths: () => [project.path], includeProjects: () => false };
      if ("status" in scope)
        throw new HTTPException(404, {
          message: "Artifact source session is unavailable",
        });
      if (
        association.sessionId &&
        (await deps.sessionAccess.resolve(association.sessionId))?.projectId !==
          project.id
      )
        throw new HTTPException(404, {
          message: "Artifact source session is unavailable",
        });
      // The retained path is already host-canonical; do not remap private /tmp a second time.
      const allowed = await createLocalResourcePathPolicy({
        ...scope,
        scanner: deps.scanner,
      }).resolveAllowedFilePath(association.path);
      if (!allowed.ok)
        throw new HTTPException(allowed.status, { message: allowed.error });
      path = allowed.file.resolvedPath;
      id = association.id;
      kind = "artifact";
    } else {
      if (deps.services.upstream(project.id))
        return c.json(await deps.openService(project.id, request.audience));
      const declaration = await readProjectService(project.path);
      if (!declaration)
        throw new HTTPException(404, {
          message: "Project has no app declaration",
        });
      if (declaration.where.kind === "process")
        return c.json(await deps.openService(project.id, request.audience));
      const staticApp = await projectServiceStaticApp(
        project.path,
        declaration,
      );
      path = staticApp.entry;
      declaredRoot = staticApp.root;
      id = `static:${project.id}`;
      kind = "static";
    }
    await authorize(c);
    const grant = await deps.artifacts.createGrant(
      path,
      request.audience,
      false,
      declaredRoot,
    );
    const view: ProjectAppView = {
      id,
      kind,
      url: grant.url,
      expiresAt: grant.expiresAt,
      label: basename(path),
      transferable: true,
    };
    return c.json(view);
  });

  routes.post("/projects/:projectId/app/restore", async (c) => {
    const project = await authorize(c);
    if (principalFor(c).kind !== "superuser")
      throw new HTTPException(403, {
        message:
          "Only the administrator can restore another user's project visibility",
      });
    const parsed = z
      .strictObject({ username: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Expected username" }, 400);
    await deps.store.setHidden(
      project.id,
      parsed.data.username,
      false,
      "superuser",
    );
    deps.onVisibilityChanged?.(project.id);
    return c.json({ restored: true });
  });
  const namespace = () => deps.artifacts.config.vhostPublicRoot ?? null;
  const publisher = async (c: Context, release = false) => {
    await authorize(c, "new-session");
    const principal = principalFor(c);
    if (
      principal.kind !== "superuser" &&
      (release ||
        deps.activeGrants(principal.username)?.allowPublicApps !== true)
    )
      throw new HTTPException(403, {
        message: "Only the administrator can publish or release an app address",
      });
  };
  routes.get("/projects/:projectId/app/address", async (c) => {
    const project = await authorize(c);
    const principal = principalFor(c);
    const current = namespace();
    const addresses: ProjectAppAddresses = {
      enabled: !!current,
      namespace: current,
      requiredPrefix:
        principal.kind === "limited" ? `${principal.username}-` : "",
      canReserve:
        principal.kind === "superuser" ||
        satisfies(levelFor(principal.grants, project.id), "new-session"),
      canPublish:
        principal.kind === "superuser" ||
        (principal.grants.allowPublicApps === true &&
          satisfies(levelFor(principal.grants, project.id), "new-session")),
      canRelease: principal.kind === "superuser",
      reservations: current
        ? await Promise.all(
            (await deps.store.reservations(project.id)).map(async (stored) => {
              const allowed = projectAppPublicAllowed(
                project.ownerUsername,
                stored,
                deps.activeGrants,
              );
              const row = {
                ...stored,
                privateOnly: !allowed,
                public: stored.public && allowed,
              };
              const canCopy =
                row.public ||
                principal.kind === "superuser" ||
                principal.grants.allowPrivateAppLinks !== false;
              return {
                ...row,
                ...(canCopy && row.namespace === current && deps.delivery
                  ? { url: await deps.delivery.addressLink(row) }
                  : {}),
              };
            }),
          )
        : [],
    };
    return c.json(addresses);
  });
  routes.post("/projects/:projectId/app/address/reserve", async (c) => {
    const project = await authorize(c, "new-session");
    const principal = principalFor(c);
    const current = namespace();
    if (!current)
      throw new HTTPException(409, { message: "App addresses are disabled" });
    const parsed = z
      .strictObject({ name: z.string().min(1).max(63) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Expected an app name" }, 400);
    const name = parsed.data.name.trim().toLowerCase();
    try {
      parseVhosts([{ name, port: 1 }]);
    } catch {
      return c.json({ error: "Invalid app name" }, 400);
    }
    if (/^(?:app-|sbx-)/.test(name))
      return c.json({ error: "This name prefix is reserved" }, 400);
    if (
      principal.kind === "limited" &&
      !name.startsWith(`${principal.username}-`)
    )
      return c.json(
        { error: `App names must start with ${principal.username}-` },
        403,
      );
    if (deps.artifacts.config.vhosts?.some((row) => row.name === name))
      return c.json({ error: "App address is already configured" }, 409);
    try {
      const reservation = await deps.store.reserve(
        {
          namespace: current,
          name,
          projectId: project.id,
          owner:
            principal.kind === "limited" ? principal.username : "superuser",
          privateOnly: principal.kind === "limited" || !!project.ownerUsername,
        },
        async () => {
          await authorize(c, "new-session");
          if (
            namespace() !== current ||
            deps.artifacts.config.vhosts?.some((row) => row.name === name)
          )
            throw new HTTPException(409, {
              message: "App address configuration changed",
            });
        },
      );
      await deps.delivery?.refreshHosts();
      return c.json(reservation);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      if (
        error instanceof Error &&
        /already (?:reserved|has an address)/.test(error.message)
      )
        return c.json({ error: error.message }, 409);
      throw error;
    }
  });
  routes.post("/projects/:projectId/app/address/serve", async (c) => {
    const project = await authorize(c, "new-session");
    await publisher(c);
    const current = namespace();
    if (!current)
      throw new HTTPException(409, { message: "App addresses are disabled" });
    const parsed = z
      .strictObject({ serving: z.boolean(), public: z.boolean() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Expected serving and public choices" }, 400);
    const reservation = (await deps.store.reservations(project.id)).find(
      (row) => row.namespace === current,
    );
    if (!reservation) return c.json({ error: "Reserve an address first" }, 409);
    if (
      parsed.data.public &&
      !projectAppPublicAllowed(
        project.ownerUsername,
        reservation,
        deps.activeGrants,
      )
    )
      return c.json({ error: "This owner's apps require a private link" }, 403);
    return c.json(
      await deps.store.setServing(
        project.id,
        current,
        parsed.data.serving,
        parsed.data.public,
        async () => {
          await publisher(c);
          const freshProject = await authorize(c, "new-session");
          const allowed = projectAppPublicAllowed(
            freshProject.ownerUsername,
            reservation,
            deps.activeGrants,
          );
          if (parsed.data.public && !allowed)
            throw new HTTPException(403, {
              message: "This owner's apps require a private link",
            });
          return allowed;
        },
      ),
    );
  });
  routes.post("/projects/:projectId/app/address/release", async (c) => {
    const project = await authorize(c, "new-session");
    await publisher(c, true);
    const parsed = z
      .strictObject({ namespace: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Expected namespace" }, 400);
    await deps.store.release(project.id, parsed.data.namespace, async () => {
      await publisher(c, true);
      const row = (await deps.store.reservations(project.id)).find(
        (entry) => entry.namespace === parsed.data.namespace,
      );
      if (row)
        await deps.artifacts.vhostAccess.rotate({
          name: row.name,
          projectId: project.id,
        });
    });
    return c.json({ released: true });
  });
  return routes;
}
