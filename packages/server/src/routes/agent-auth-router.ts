import { Hono } from "hono";
import {
  type AgentAuthRouter,
  RouterUnavailable,
} from "../services/AgentAuthRouter.js";
/** Existing /api authorization denies this administration namespace to limited users. */
export function createAgentAuthRouterRoutes(router: AgentAuthRouter) {
  const routes = new Hono();
  routes.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof RouterUnavailable
            ? error.message
            : "Local router operation failed",
      },
      409,
    ),
  );
  routes.get("/", (c) => c.json(router.summary()));
  routes.post("/connect", async (c) => {
    const body = await c.req.json<{ socketPath?: unknown }>();
    if (
      body.socketPath !== undefined &&
      (typeof body.socketPath !== "string" || body.socketPath.length > 1024)
    )
      return c.json({ error: "Invalid socket path" }, 400);
    return c.json(await router.connect(body.socketPath as string | undefined));
  });
  routes.post("/disconnect", async (c) => c.json(await router.disconnect()));
  routes.get("/accounts", async (c) => c.json(await router.accounts()));
  routes.get("/accounts/:id/catalog", async (c) =>
    c.json(await router.catalog(c.req.param("id"))),
  );
  routes.get("/accounts/:id/quotas", async (c) =>
    c.json(await router.quotas(c.req.param("id"))),
  );
  return routes;
}
