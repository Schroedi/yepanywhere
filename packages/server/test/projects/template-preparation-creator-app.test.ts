import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppResult } from "../../src/app.js";
import { AuthService } from "../../src/auth/AuthService.js";
import { LimitedUsersService } from "../../src/auth/LimitedUsersService.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/routes.js";
import { ProjectMetadataService } from "../../src/metadata/ProjectMetadataService.js";
import { SessionMetadataService } from "../../src/metadata/SessionMetadataService.js";
import { encodeProjectId } from "../../src/projects/paths.js";
import { TemplateSourceService } from "../../src/projects/TemplateSourceService.js";
import { MockClaudeSDK } from "../../src/sdk/mock.js";
import { probeSessionSandboxAvailability } from "../../src/session-sandbox.js";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import type { Process } from "../../src/supervisor/Process.js";
import type {
  ModelSettings,
  SessionLaunchOptions,
} from "../../src/supervisor/Supervisor.js";
import { createApp } from "../setup/create-app.js";

/**
 * The preparation session a template creation launches is a session its
 * creator started: through the real creation route, registration and
 * session-create route, a limited user's is recorded as theirs and launched
 * inside their policy, and the superuser's records no creator
 * (topics/limited-users.md § Delivery v1 and § Usage).
 */

let root: string;
let dataDir: string;
let instance: AppResult;
let sessionMetadataService: SessionMetadataService;
let authService: AuthService;
let launches: ModelSettings[];

beforeEach(async () => {
  root = await realpath(tmpdir()).then((base) =>
    join(base, `ya-template-creator-${randomUUID()}`),
  );
  dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  await configureSource();

  authService = new AuthService({ dataDir, cookieSecret: "template-secret" });
  await authService.initialize();
  await authService.enableAuth("superuser-password");
  const limitedUsersService = new LimitedUsersService({ dataDir });
  await limitedUsersService.initialize();
  await limitedUsersService.create({
    username: "archer",
    password: "correct-horse-battery",
    projectRoot: join(root, "archer"),
    templateCreation: { mode: "any" },
  });
  const serverSettingsService = new ServerSettingsService({ dataDir });
  await serverSettingsService.initialize();
  await serverSettingsService.updateSettings({ limitedUsersEnabled: true });
  const projectMetadataService = new ProjectMetadataService({ dataDir });
  await projectMetadataService.initialize();
  sessionMetadataService = new SessionMetadataService({ dataDir });
  await sessionMetadataService.initialize();

  instance = createApp({
    sdk: new MockClaudeSDK(),
    dataDir,
    projectsDir: join(root, "claude"),
    getCatalogFamilies: () => ["claude"],
    authService,
    authDisabled: false,
    limitedUsersService,
    serverSettingsService,
    projectMetadataService,
    sessionMetadataService,
  });
  // The mock SDK cannot run a provider in the sandbox, so the launch stops at
  // the Supervisor: it starts at once and runs onStarted, as the real one
  // does, with the process a sandboxed launch reports.
  launches = [];
  vi.spyOn(instance.supervisor, "startSession").mockImplementation(
    async (
      projectPath: string,
      _message: unknown,
      _mode: unknown,
      settings?: ModelSettings,
      options?: SessionLaunchOptions,
    ) => {
      launches.push(settings ?? {});
      const process = {
        id: "prep-process",
        sessionId: randomUUID(),
        projectId: encodeProjectId(projectPath),
        projectPath,
        permissionMode: "default",
        modeVersion: 0,
        ...(settings?.sandboxLevel === "project-write"
          ? { sandboxStateKey: "project-prep", sandboxProjectPath: projectPath }
          : {}),
      } as unknown as Process;
      await options?.onStarted?.(process.sessionId, process);
      return process;
    },
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await instance.disposeSessionReaders();
  await rm(root, { recursive: true, force: true });
});

async function configureSource() {
  const repository = join(root, "source");
  const directory = join(repository, "templates/app");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(repository, "library.json"),
    JSON.stringify({ formatVersion: 1, bases: [], templates: ["app"] }),
  );
  const files = {
    "setup.mjs":
      'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("dist"); writeFileSync("dist/index.html", "Ready");',
    ".project-template/app.json": JSON.stringify({
      kind: "static",
      dir: "dist",
      setup: [process.execPath, "setup.mjs"],
      build: ["node", "setup.mjs"],
      test: ["node", "setup.mjs"],
      preview: ["node", "setup.mjs"],
      prepare: "PREPARE.md",
    }),
    "PREPARE.md": "Prepare the project.",
  };
  const entries = [];
  for (const [to, bytes] of Object.entries(files)) {
    const from = `file-${entries.length}`;
    await writeFile(join(directory, from), bytes);
    entries.push({ from, to });
  }
  await writeFile(
    join(directory, "template.json"),
    JSON.stringify({
      formatVersion: 1,
      kind: "template",
      status: "ready",
      id: "app",
      title: "App",
      description: "Starter",
      extends: [],
      files: entries,
      overrides: [],
    }),
  );
  const service = new TemplateSourceService(dataDir);
  await service.configure({
    enabled: true,
    sources: [{ id: "local", repository, contentPath: "", revision: "HEAD" }],
  });
  await service.waitForRetrieval();
}

/** Create a project from the template as the cookie's login. */
async function createFromTemplate(cookie: string, path: string) {
  const headers = { Cookie: cookie, "X-Yep-Anywhere": "true" };
  const operationId = randomUUID();
  const response = await instance.app.request(
    "/api/project-templates/operations",
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId,
        sourceId: "local",
        templateId: "app",
        path,
        name: "Canvas",
        intent: "Draw things",
        session: {},
      }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(202);
  let result: Record<string, unknown> = {};
  await expect
    .poll(
      async () => {
        result = await (
          await instance.app.request(
            `/api/project-templates/operations/${operationId}`,
            { headers },
          )
        ).json();
        return result.phase;
      },
      { timeout: 20_000 },
    )
    .toMatch(/started|failed/);
  expect(result, String(result.error)).toMatchObject({ phase: "started" });
  return sessionMetadataService.getMetadata(result.sessionId as string);
}

it("records a limited creator on the preparation session and sandboxes it", async () => {
  // A limited user's template setup itself runs in the sandbox.
  if ((await probeSessionSandboxAvailability()).state !== "available") return;
  const cookie = `${SESSION_COOKIE_NAME}=${await authService.createSession("archer", "archer")}`;

  const metadata = await createFromTemplate(
    cookie,
    join(root, "archer", "canvas"),
  );

  expect(launches).toEqual([
    expect.objectContaining({
      sandboxLevel: "project-write",
      sandboxNetworkFirewall: true,
    }),
  ]);
  expect(metadata).toMatchObject({
    createdByUser: "archer",
    sandboxLevel: "project-write",
    sandboxNetworkFirewall: true,
    sandboxStateKey: "project-prep",
  });
}, 40_000);

it("records no creator on the superuser's preparation session", async () => {
  const cookie = `${SESSION_COOKIE_NAME}=${await authService.createSession("superuser")}`;

  const metadata = await createFromTemplate(cookie, join(root, "owned"));

  expect(launches).toHaveLength(1);
  expect(metadata).toBeDefined();
  expect(metadata?.createdByUser).toBeUndefined();
}, 40_000);
