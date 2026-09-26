import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRewindRecord } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionMetadataService } from "../../src/metadata/SessionMetadataService.js";
import { encodeProjectId } from "../../src/projects/paths.js";
import {
  createSessionsRoutes,
  type SessionsDeps,
} from "../../src/routes/sessions.js";
import type { AgentProvider } from "../../src/sdk/providers/types.js";
import type {
  ClearloopRunner,
  ClearloopService,
} from "../../src/services/ClearloopService.js";
import type { ProjectQueueScheduler } from "../../src/services/ProjectQueueScheduler.js";
import { ClaudeSessionReader } from "../../src/sessions/reader.js";
import type { Process } from "../../src/supervisor/Process.js";
import { Supervisor } from "../../src/supervisor/Supervisor.js";
import type { Project } from "../../src/supervisor/types.js";

type YaCommandRunner = Parameters<
  NonNullable<ProjectQueueScheduler["setYaCommandRunner"]>
>[0];

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** A two-turn Claude session behind the real routes, reader and metadata. */
async function createRewindFixture() {
  const dir = await mkdtemp(join(tmpdir(), "rewind-orchestration-"));
  directories.push(dir);
  const sessionsDir = join(dir, "sessions");
  const projectPath = join(dir, "project");
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(projectPath);
  const sessionId = randomUUID();
  const project: Project = {
    id: encodeProjectId(projectPath),
    path: projectPath,
    name: "project",
    provider: "claude",
    sessionDir: sessionsDir,
    sessionCount: 1,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
  };
  const entry = (
    type: "user" | "assistant",
    uuid: string,
    parentUuid: string | null,
    text: string,
  ) => ({
    type,
    uuid,
    parentUuid,
    sessionId,
    cwd: projectPath,
    timestamp: "2026-09-26T08:00:00.000Z",
    message:
      type === "user"
        ? { role: "user", content: text }
        : {
            id: `msg-${uuid}`,
            role: "assistant",
            model: "claude-opus-5-5",
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
          },
  });
  await writeFile(
    join(sessionsDir, `${sessionId}.jsonl`),
    `${[
      entry("user", "u1", null, "first"),
      entry("assistant", "a1", "u1", "one"),
      entry("user", "u2", "a1", "second"),
      entry("assistant", "a2", "u2", "two"),
    ]
      .map((line) => JSON.stringify(line))
      .join("\n")}\n`,
  );

  const metadata = new SessionMetadataService({ dataDir: dir });
  await metadata.initialize();
  await metadata.setProvider(sessionId, "claude");

  const supervisor = new Supervisor({
    provider: { name: "claude" } as unknown as AgentProvider,
  });
  const resume = vi.spyOn(supervisor, "resumeSession").mockResolvedValue({
    id: "process-1",
    permissionMode: "default",
    modeVersion: 0,
  } as unknown as Process);
  const getSession = vi.spyOn(ClaudeSessionReader.prototype, "getSession");

  let clearloopRunner: ClearloopRunner | undefined;
  const clearloopStart = vi.fn(async () => ({ id: "loop-1" }));
  const clearloopService = {
    setRunner: (runner: ClearloopRunner) => {
      clearloopRunner = runner;
    },
    isRunning: () => false,
    getBadge: () => undefined,
    start: clearloopStart,
  } as unknown as ClearloopService;
  let yaCommandRunner: YaCommandRunner | undefined;
  const projectQueueScheduler = {
    setYaCommandRunner: (runner: YaCommandRunner) => {
      yaCommandRunner = runner;
    },
  } as unknown as ProjectQueueScheduler;

  const routes = createSessionsRoutes({
    supervisor,
    scanner: {
      getOrCreateProject: async () => project,
    } as unknown as SessionsDeps["scanner"],
    readerFactory: () => new ClaudeSessionReader({ sessionDir: sessionsDir }),
    sessionMetadataService: metadata,
    clearloopService,
    projectQueueScheduler,
  });
  if (!clearloopRunner || !yaCommandRunner) {
    throw new Error("routes did not install their runners");
  }
  return {
    routes,
    project,
    sessionId,
    metadata,
    resume,
    getSession,
    clearloopStart,
    clearloopRunner,
    yaCommandRunner,
  };
}

describe("rewind orchestration", () => {
  it("a queued /clear N rewinds through one transcript read", async () => {
    const fixture = await createRewindFixture();
    fixture.getSession.mockClear();

    await fixture.yaCommandRunner.run({
      sessionId: fixture.sessionId,
      projectId: fixture.project.id,
      projectPath: fixture.project.path,
      command: { name: "clear", argument: "1" },
      commandText: "/clear 1",
    } as Parameters<YaCommandRunner["run"]>[0]);

    const [record] = fixture.metadata.getRewindRecords(fixture.sessionId);
    expect(record).toMatchObject({
      cutMessageId: "a1",
      droppedTurnCount: 1,
      reason: "clear",
    });
    expect(fixture.getSession).toHaveBeenCalledTimes(1);
  });

  it("an interactive rewind records what the queued command records", async () => {
    const queued = await createRewindFixture();
    await queued.yaCommandRunner.run({
      sessionId: queued.sessionId,
      projectId: queued.project.id,
      projectPath: queued.project.path,
      command: { name: "clear", argument: "1" },
      commandText: "/clear 1",
    } as Parameters<YaCommandRunner["run"]>[0]);

    const interactive = await createRewindFixture();
    interactive.getSession.mockClear();
    const response = await interactive.routes.request(
      `/projects/${interactive.project.id}/sessions/${interactive.sessionId}/rewind`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cut: { kind: "after-user-turn", sourceMessageId: "u1" },
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(interactive.getSession).toHaveBeenCalledTimes(1);

    const pick = ({
      cutMessageId,
      cutTurnIndex,
      droppedTurnCount,
      droppedFromMessageId,
    }: SessionRewindRecord) => ({
      cutMessageId,
      cutTurnIndex,
      droppedTurnCount,
      droppedFromMessageId,
    });
    expect(
      pick(interactive.metadata.getRewindRecords(interactive.sessionId)[0]!),
    ).toEqual(pick(queued.metadata.getRewindRecords(queued.sessionId)[0]!));
  });

  it("a queued /clearloop starts a patient loop at the resolved cut", async () => {
    const fixture = await createRewindFixture();

    await fixture.yaCommandRunner.run({
      sessionId: fixture.sessionId,
      projectId: fixture.project.id,
      projectPath: fixture.project.path,
      command: { name: "clearloop", argument: "1 3: try again" },
      commandText: "/clearloop 1 3: try again",
    } as Parameters<YaCommandRunner["run"]>[0]);

    expect(fixture.clearloopStart).toHaveBeenCalledWith(
      fixture.sessionId,
      fixture.project.id,
      expect.objectContaining({
        cutMessageId: "a1",
        prompt: "try again",
        total: 3,
        commandText: "/clearloop 1 3: try again",
        patient: true,
      }),
    );
  });
});

describe("resume launch settings", () => {
  const saveLaunch = async (
    metadata: SessionMetadataService,
    sessionId: string,
  ) => {
    await metadata.recordEffectiveLaunchSettings(sessionId, {
      permissionMode: "acceptEdits",
      requestedModel: "opus",
      serviceTier: null,
      thinking: { type: "adaptive" },
      effort: "high",
    });
    await metadata.updateMetadata(sessionId, {
      recapMode: "side-session",
      recapAfterSeconds: 90,
      promptSuggestionMode: "off",
    });
  };

  it("a clearloop iteration resumes with the session's saved settings", async () => {
    const fixture = await createRewindFixture();
    await saveLaunch(fixture.metadata, fixture.sessionId);

    await fixture.clearloopRunner.send({
      sessionId: fixture.sessionId,
      projectId: fixture.project.id,
      job: { prompt: "again" },
    } as Parameters<ClearloopRunner["send"]>[0]);

    expect(fixture.resume).toHaveBeenCalledTimes(1);
    const [, projectPath, message, permissionMode, settings] =
      fixture.resume.mock.calls[0]!;
    expect(projectPath).toBe(fixture.project.path);
    expect(message.text).toBe("again");
    expect(permissionMode).toBe("acceptEdits");
    expect(settings).toMatchObject({
      model: "opus",
      requestedModel: "opus",
      thinking: { type: "adaptive" },
      effort: "high",
      providerName: "claude",
      sandboxLevel: "none",
      sandboxNetworkFirewall: false,
      recapMode: "side-session",
      recapAfterSeconds: 90,
      promptSuggestionMode: "off",
      resumeMode: "full",
    });
  });

  it("a resume that names no recap mode keeps the session's saved one", async () => {
    const fixture = await createRewindFixture();
    await saveLaunch(fixture.metadata, fixture.sessionId);

    const response = await fixture.routes.request(
      `/projects/${fixture.project.id}/sessions/${fixture.sessionId}/resume`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "continue" }),
      },
    );

    expect(response.status).toBe(200);
    const settings = fixture.resume.mock.calls[0]?.[4];
    expect(settings).toMatchObject({
      model: "opus",
      requestedModel: "opus",
      recapMode: "side-session",
      recapAfterSeconds: 90,
      promptSuggestionMode: "off",
    });
  });
});
