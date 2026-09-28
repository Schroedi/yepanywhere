import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { principalFor } from "../auth/limitedLaunchPolicy.js";
import type { TemplateSourceService } from "../projects/TemplateSourceService.js";
import {
  TemplateCreationService,
  templateCreationRequest,
} from "../projects/TemplateCreationService.js";

/** Creation routes share the existing project-registration and session-launch policies. */
export function createProjectTemplateRoutes(
  sources: TemplateSourceService,
  creations: TemplateCreationService,
  dispatch: (
    context: Context,
    path: string,
    body: unknown,
  ) => Promise<Response>,
) {
  const routes = new Hono();
  routes.use("/project-templates/*", async (c, next) => {
    if (principalFor(c).kind !== "superuser")
      return c.json({ error: "Superuser required" }, 403);
    await next();
  });
  routes.get("/project-templates/choices", async (c) => {
    const state = await sources.current();
    if (!state.config.enabled) return c.json({ enabled: false, templates: [] });
    try {
      const library = await sources.creationLibrary();
      const templates = library
        .list()
        .filter((item) => item.status === "ready")
        .map((item) => {
          const composition = library.readyComposition(item.id);
          const artwork = (name: string) => {
            const bytes = composition.files.get(
              `.project-template/${name}.svg`,
            )?.content;
            return bytes && bytes.length <= 256 * 1024
              ? `data:image/svg+xml;base64,${bytes.toString("base64")}`
              : undefined;
          };
          return {
            id: item.id,
            sourceId: library.sourceOf(item.id),
            title: item.title,
            description: item.description,
            icon: artwork("icon"),
            preview: artwork("preview"),
          };
        });
      return c.json({ enabled: true, templates });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });
  routes.get("/project-templates/operations/:id", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Invalid operation ID" }, 400);
    const operation = await creations.get(id.data);
    return operation
      ? c.json(operation)
      : c.json({ error: "Operation not found" }, 404);
  });
  routes.post("/project-templates/operations", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = templateCreationRequest.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    if (parsed.data.session.executor || parsed.data.session.attachments)
      return c.json(
        {
          error:
            "Template creation requires a local session without attachments",
        },
        400,
      );
    const call = async (
      path: string,
      payload: unknown,
    ): Promise<Record<string, unknown>> => {
      const response = await dispatch(c, path, payload);
      const result = (await response.json()) as Record<string, unknown>;
      if (!response.ok)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : `Project creation request failed (${response.status})`,
        );
      return result;
    };
    try {
      const operation = await creations.start(parsed.data, {
        register: async (path, name) => {
          const result = await call("/api/projects", { path, name });
          const project = z.object({ id: z.string() }).parse(result.project);
          return project.id;
        },
        prepare: async (projectId, message, settings) => {
          const result = await call(
            `/api/projects/${encodeURIComponent(projectId)}/sessions`,
            { ...settings, message },
          );
          if (typeof result.sessionId !== "string")
            throw new Error(
              "Preparation was queued without a session ID. Inspect the session queue; do not repeat creation.",
            );
          return result.sessionId;
        },
      });
      return c.json(operation, 202);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });
  return routes;
}
