import type { UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createSessionsRoutes } from "../../src/routes/sessions.js";
import type { Supervisor } from "../../src/supervisor/Supervisor.js";
import type { Project } from "../../src/supervisor/types.js";

describe("Removed execution targets", () => {
  it.each(["sessions", "sessions/create"])(
    "refuses an explicit lane target on %s before launching locally",
    async (endpoint) => {
      const project = {
        id: "proj-removed-lane" as UrlProjectId,
        path: "/repo/main",
        name: "repo",
        sessionCount: 0,
        sessionDir: "/sessions/repo",
        activeOwnedCount: 0,
        activeExternalCount: 0,
        lastActivity: null,
        provider: "claude",
      } satisfies Project;
      const startSession = vi.fn();
      const createSession = vi.fn();
      const routes = createSessionsRoutes({
        scanner: {
          getOrCreateProject: vi.fn(async () => project),
        } as unknown as ProjectScanner,
        supervisor: { startSession, createSession } as unknown as Supervisor,
        sessionReader: {} as never,
      });

      const response = await routes.request(
        `/projects/${project.id}/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "Run in the selected checkout",
            provider: "claude",
            workstreamId: "ws-old-checkout",
          }),
        },
      );

      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({
        error: "Managed checkout lanes have been removed",
      });
      expect(startSession).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    },
  );
});
