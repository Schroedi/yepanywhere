import type { SessionClearloopJob, UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import type { SessionMetadataService } from "../../src/metadata/index.js";
import { ClearloopService } from "../../src/services/ClearloopService.js";
import type { Supervisor } from "../../src/supervisor/Supervisor.js";
import { EventBus } from "../../src/watcher/EventBus.js";

const sessionId = "loop-session";
const projectId = Buffer.from("/home/user/test-project").toString(
  "base64url",
) as UrlProjectId;

/** Enough of the metadata service for the clearloop record and its notice. */
function fakeMetadataService(): SessionMetadataService & {
  notices: string[];
} {
  let clearloop: SessionClearloopJob | undefined;
  const notices: string[] = [];
  return {
    notices,
    getClearloop: () => clearloop,
    setClearloop: async (_id: string, job: SessionClearloopJob | undefined) => {
      clearloop = job;
    },
    addLocalCommandMessage: async (
      _id: string,
      notice: { content: string },
    ) => {
      notices.push(notice.content);
    },
  } as unknown as SessionMetadataService & { notices: string[] };
}

/**
 * A loop stopped at a chosen point of its own iteration: `rewind` and `send`
 * only resolve when the test says so, so the service sits in the state under
 * test rather than racing its inactivity timer.
 */
function startLoop(options?: { holdRewind?: boolean }) {
  const eventBus = new EventBus();
  const sessionMetadataService = fakeMetadataService();
  const service = new ClearloopService({
    eventBus,
    sessionMetadataService,
    getSupervisor: () =>
      ({ getProcessForSession: () => undefined }) as unknown as Supervisor,
    getInactivitySeconds: () => 30,
  });
  let releaseRewind = (): void => {};
  let releaseSend = (): void => {};
  service.setRunner({
    rewind: async () => {
      if (options?.holdRewind) {
        await new Promise<void>((resolve) => {
          releaseRewind = resolve;
        });
      }
      return "noop";
    },
    send: async () => {
      await new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
    },
  });
  const started = service.start(sessionId, projectId, {
    cutMessageId: "cut-1",
    cutTurnIndex: 3,
    prompt: "keep going",
    total: 2,
    commandText: "/clearloop 30 2: keep going",
  });
  return {
    service,
    eventBus,
    sessionMetadataService,
    started,
    release: () => {
      releaseRewind();
      releaseSend();
    },
  };
}

function stopRequested() {
  return {
    type: "session-stop-requested" as const,
    sessionId,
    projectId,
    timestamp: new Date().toISOString(),
  };
}

function aborted() {
  return {
    type: "session-aborted" as const,
    sessionId,
    projectId,
    timestamp: new Date().toISOString(),
  };
}

describe("ClearloopService stop handling", () => {
  it("ends the loop when a turn stop is requested", async () => {
    const { service, eventBus, sessionMetadataService, started, release } =
      startLoop();
    await started;
    await vi.waitFor(() => expect(service.isRunning(sessionId)).toBe(true));

    eventBus.emit(stopRequested());
    await vi.waitFor(() =>
      expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
        "interrupted",
      ),
    );
    expect(sessionMetadataService.getClearloop(sessionId)?.error).toBe(
      "Session was stopped",
    );
    await vi.waitFor(() =>
      expect(sessionMetadataService.notices.at(-1)).toContain("interrupted"),
    );

    release();
  });

  it("keeps running through the abort its own rewind causes", async () => {
    const { service, eventBus, sessionMetadataService, started, release } =
      startLoop({ holdRewind: true });
    await started;

    eventBus.emit(aborted());
    await Promise.resolve();
    expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
      "running",
    );

    // A stop request during the same window is never the loop's own: the
    // rewind aborts rather than interrupting.
    eventBus.emit(stopRequested());
    await vi.waitFor(() => expect(service.isRunning(sessionId)).toBe(false));
    expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
      "interrupted",
    );

    release();
  });
});
