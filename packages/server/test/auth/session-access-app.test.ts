import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppResult } from "../../src/app.js";
import { AuthService } from "../../src/auth/AuthService.js";
import { LimitedUsersService } from "../../src/auth/LimitedUsersService.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/routes.js";
import { MockClaudeSDK } from "../../src/sdk/mock.js";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { SessionCatalogService } from "../../src/services/SessionCatalogService.js";
import type { SessionCatalogRow } from "../../src/sessions/catalog-types.js";
import type { SessionSeenEvent } from "../../src/watcher/EventBus.js";
import { createApp } from "../setup/create-app.js";

/**
 * Session-scoped limited-user decisions read the session catalog the app
 * itself keeps, through `createApp`: an idle session with no process and no
 * pinned project resolves to its project, and the join-freshness rule sees its
 * real last activity. topics/limited-users.md § Delivery v1 — Freshness,
 * Authorization.
 */
describe("limited-user session access through the app's session catalog", () => {
  const projectPath = "/home/user/granted";
  const projectId = toUrlProjectId(projectPath);
  const sessionId = "idle-session";
  // Well past Claude's believed 60-minute cache-warm window.
  const lastActivity = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  let testDir: string;
  let instance: AppResult;
  let limitedCookie: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `session-access-app-${randomUUID()}`);
    const dataDir = join(testDir, "data");
    const projectsDir = join(testDir, "claude");
    const encodedPath = projectPath.replace(/[/\\:]/g, "-");
    await mkdir(dataDir, { recursive: true });
    await mkdir(join(projectsDir, "localhost", encodedPath), {
      recursive: true,
    });
    await writeFile(
      join(projectsDir, "localhost", encodedPath, `${sessionId}.jsonl`),
      `${JSON.stringify({
        type: "user",
        cwd: projectPath,
        sessionId,
        timestamp: lastActivity,
        message: { role: "user", content: "Hello" },
      })}\n`,
    );

    // The durable catalog a previous run left behind.
    const row: SessionCatalogRow = {
      catalogFamily: "claude",
      storeKey: "seed",
      sessionId,
      projectId,
      projectPath,
      projectIdentityKey: projectPath,
      updatedAt: lastActivity,
      fidelity: "head",
      sourceVersion: "v1",
      location: { kind: "provider", recordId: sessionId },
    };
    const seed = new SessionCatalogService({ dataDir });
    await seed.initialize();
    await seed.reconcile([
      {
        catalogFamily: "claude",
        storeKey: "seed",
        scan: async () => ({ sourceVersion: "v1", rows: [row] }),
      },
    ]);
    seed.stop();

    const authService = new AuthService({
      dataDir,
      cookieSecret: "session-access-app-secret",
    });
    await authService.initialize();
    await authService.enableAuth("superuser-password");
    limitedCookie = `${SESSION_COOKIE_NAME}=${await authService.createSession("bob", "bob")}`;

    const limitedUsersService = new LimitedUsersService({ dataDir });
    await limitedUsersService.initialize();
    await limitedUsersService.create({
      username: "bob",
      password: "correct-horse-battery",
      joinProjects: [projectId],
      joinStaleOffsetMinutes: 0,
    });
    const serverSettingsService = new ServerSettingsService({ dataDir });
    await serverSettingsService.initialize();
    await serverSettingsService.updateSettings({ limitedUsersEnabled: true });

    instance = createApp({
      sdk: new MockClaudeSDK(),
      dataDir,
      projectsDir,
      getCatalogFamilies: () => ["claude"],
      authService,
      authDisabled: false,
      limitedUsersService,
      serverSettingsService,
    });
  });

  afterEach(async () => {
    await instance.disposeSessionReaders();
    await rm(testDir, { recursive: true, force: true });
  });

  it("refuses a turn to an idle session whose last activity is cold", async () => {
    const response = await instance.app.request(
      `/api/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: { Cookie: limitedCookie, "X-Yep-Anywhere": "true" },
      },
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { reason?: string }).reason).toBe(
      "stale-session",
    );
  });

  it("lets a user with a grant on its project subscribe to an idle session", async () => {
    await expect(
      instance.authorizeSubscription({
        username: "bob",
        target: { kind: "scoped", projectIds: [], sessionIds: [sessionId] },
      }),
    ).resolves.toBe(true);
    await expect(
      instance.authorizeSubscription({
        username: "bob",
        target: {
          kind: "scoped",
          projectIds: [],
          sessionIds: ["no-such-session"],
        },
      }),
    ).resolves.toBe(false);
  });

  it("shows an idle session's activity once the catalog has been read", async () => {
    const event: SessionSeenEvent = {
      type: "session-seen",
      sessionId,
      timestamp: new Date().toISOString(),
    };
    // The first event starts the catalog read rather than waiting on it.
    instance.activityEventForIdentity("bob", event);
    await vi.waitFor(() => {
      expect(instance.activityEventForIdentity("bob", event)).toEqual(event);
    });
  });
});
