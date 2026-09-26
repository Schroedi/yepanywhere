import type {
  SessionClearloopJob,
  SessionProviderRetentionSnapshot,
  UrlProjectId,
} from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import type { SessionMetadataService } from "../../src/metadata/index.js";
import {
  CLEARLOOP_MAX_CONSECUTIVE_FAILURES,
  ClearloopService,
} from "../../src/services/ClearloopService.js";
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

/**
 * A loop whose iterations complete immediately and whose inactivity window is
 * zero, so every boundary is reached at once and only the patience gate
 * decides whether the loop advances.
 */
function startPatientLoop(options?: {
  blockers?: () => string[];
  patient?: boolean;
  total?: number;
}) {
  const sessionMetadataService = fakeMetadataService();
  const idleReads: number[] = [];
  const service = new ClearloopService({
    eventBus: new EventBus(),
    sessionMetadataService,
    getSupervisor: () =>
      ({ getProcessForSession: () => undefined }) as unknown as Supervisor,
    getInactivitySeconds: () => 0,
    patientRecheckMs: 20,
    ...(options?.blockers
      ? {
          getProjectIdleStatus: async () => {
            idleReads.push(Date.now());
            const blockers = options.blockers?.() ?? [];
            return { idle: blockers.length === 0, blockers };
          },
        }
      : {}),
  });
  const sent: string[] = [];
  service.setRunner({
    rewind: async () => "noop",
    send: async ({ job }) => {
      sent.push(job.prompt);
    },
  });
  const started = service.start(sessionId, projectId, {
    cutMessageId: "cut-1",
    cutTurnIndex: 3,
    prompt: "keep going",
    total: options?.total ?? 2,
    commandText: "/clearloop 3 2: keep going",
    ...(options?.patient ? { patient: true } : {}),
  });
  return { service, sessionMetadataService, started, sent, idleReads };
}

/**
 * A loop whose first `failures` sends throw, with a zero-or-chosen window,
 * so failure handling is what decides whether and when it tries again.
 */
function startFailingLoop(options: {
  failures: number;
  windowSeconds: number;
}) {
  const eventBus = new EventBus();
  const sessionMetadataService = fakeMetadataService();
  const service = new ClearloopService({
    eventBus,
    sessionMetadataService,
    getSupervisor: () =>
      ({ getProcessForSession: () => undefined }) as unknown as Supervisor,
    getInactivitySeconds: () => options.windowSeconds,
  });
  let sends = 0;
  service.setRunner({
    rewind: async () => "noop",
    send: async () => {
      sends += 1;
      if (sends <= options.failures) throw new Error("launch failed");
    },
  });
  const started = service.start(sessionId, projectId, {
    cutMessageId: "cut-1",
    cutTurnIndex: 3,
    prompt: "keep going",
    total: 1,
    commandText: "/clearloop 3 1: keep going",
  });
  return {
    service,
    eventBus,
    sessionMetadataService,
    started,
    attempts: () => sends,
  };
}

/**
 * A loop over a live, idle Claude process whose retention snapshot the test
 * controls, with a zero window so only background work can hold a boundary.
 */
function startBackgroundTaskLoop(options: {
  retention: () => SessionProviderRetentionSnapshot;
  backgroundHoldMaxMs?: number;
}) {
  const sessionMetadataService = fakeMetadataService();
  const process = {
    state: { type: "idle", since: new Date(0) },
    queueDepth: 0,
    getLivenessSnapshot: () => ({
      lastProviderMessageAt: null,
      lastRawProviderEventAt: null,
      providerRetention: options.retention(),
    }),
    notifyQueueProjectionChanged: () => {},
  };
  const service = new ClearloopService({
    eventBus: new EventBus(),
    sessionMetadataService,
    getSupervisor: () =>
      ({ getProcessForSession: () => process }) as unknown as Supervisor,
    getInactivitySeconds: () => 0,
    busyRecheckMs: 20,
    ...(options.backgroundHoldMaxMs !== undefined
      ? { backgroundHoldMaxMs: options.backgroundHoldMaxMs }
      : {}),
  });
  const sent: string[] = [];
  service.setRunner({
    rewind: async () => "noop",
    send: async ({ job }) => {
      sent.push(job.prompt);
    },
  });
  const started = service.start(sessionId, projectId, {
    cutMessageId: "cut-1",
    cutTurnIndex: 3,
    prompt: "keep going",
    total: 2,
    commandText: "/clearloop 3 2: keep going",
  });
  return { service, sent, started };
}

function retention(
  counts: Partial<SessionProviderRetentionSnapshot>,
): SessionProviderRetentionSnapshot {
  return { retained: true, reasons: [], ...counts };
}

describe("ClearloopService background tasks", () => {
  it("holds the boundary while a Claude background task runs", async () => {
    let tasks = 1;
    const { service, sent, started } = startBackgroundTaskLoop({
      retention: () => retention({ liveTaskCount: tasks }),
    });
    await started;
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    // Several busy re-checks pass without a boundary.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sent).toHaveLength(1);
    expect(service.getProgress(sessionId)?.quietSince).toBeUndefined();

    tasks = 0;
    await vi.waitFor(() => expect(sent).toHaveLength(2));
  });

  it("stops waiting once the hold limit passes", async () => {
    const { sent, started } = startBackgroundTaskLoop({
      retention: () => retention({ backgroundTaskCount: 1 }),
      backgroundHoldMaxMs: 50,
    });
    await started;

    await vi.waitFor(() => expect(sent).toHaveLength(2));
  });

  it("does not wait on session crons", async () => {
    const { sent, started } = startBackgroundTaskLoop({
      retention: () => retention({ sessionCronCount: 1 }),
    });
    await started;

    await vi.waitFor(() => expect(sent).toHaveLength(2));
  });
});

describe("ClearloopService patience", () => {
  it("refuses to become patient with no project idle predicate", async () => {
    const { service, started } = startPatientLoop({ total: 1 });
    await started;

    await expect(service.setPatience(sessionId, true)).rejects.toThrow(
      /cannot report project idleness/,
    );
    expect(service.getRunningJob(sessionId)?.patient).toBeUndefined();
  });

  it("holds a patient loop while the project reports blockers", async () => {
    let blockers = ["other-session:in-turn"];
    const { service, sent, started } = startPatientLoop({
      patient: true,
      blockers: () => blockers,
    });
    await started;

    // The first iteration is sent before any boundary; the second one is what
    // the project wait gates.
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.waitFor(() =>
      expect(service.getProgress(sessionId)?.projectBlockers).toEqual([
        "other-session:in-turn",
      ]),
    );
    expect(sent).toHaveLength(1);

    blockers = [];
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(service.getProgress(sessionId)?.projectBlockers).toBeUndefined();
  });

  it("ignores blockers naming the loop's own session", async () => {
    const { sent, started } = startPatientLoop({
      patient: true,
      blockers: () => [`${sessionId}:liveness-unknown`],
    });
    await started;

    await vi.waitFor(() => expect(sent).toHaveLength(2));
  });

  it("starts the next iteration now, skipping the project wait", async () => {
    const { service, sent, started } = startPatientLoop({
      patient: true,
      blockers: () => ["other-session:in-turn"],
    });
    await started;
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    await service.startNow(sessionId);
    expect(sent).toHaveLength(2);
  });

  it("turns patience off and lets the loop advance again", async () => {
    const { service, sent, started } = startPatientLoop({
      patient: true,
      blockers: () => ["other-session:in-turn"],
    });
    await started;
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    await service.setPatience(sessionId, false);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(service.getProgress(sessionId)?.patient).toBeUndefined();
  });
});

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

  it("keeps running when an idle reap tears down the quiet process", async () => {
    const { service, eventBus, sessionMetadataService, started, release } =
      startLoop();
    await started;
    await vi.waitFor(() => expect(service.isRunning(sessionId)).toBe(true));

    eventBus.emit({ ...aborted(), reason: "idle-reap" });
    await Promise.resolve();
    expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
      "running",
    );

    release();
  });

  it("retries the iteration when the provider refuses its rewind", async () => {
    const { service, eventBus, sessionMetadataService, started, attempts } =
      startFailingLoop({ failures: 0, windowSeconds: 30 });
    await started;
    await vi.waitFor(() => expect(attempts()).toBe(1));
    // Let the send settle: a refusal during the loop's own launch is counted
    // by that failed send, not by this event.
    await new Promise((resolve) => setTimeout(resolve, 0));

    eventBus.emit({
      type: "session-metadata-changed",
      sessionId,
      projectId,
      rewindRecordRemoved: "rw-1",
      timestamp: new Date().toISOString(),
    });
    await vi.waitFor(() =>
      expect(sessionMetadataService.notices.at(-1)).toContain("retrying"),
    );
    expect(service.isRunning(sessionId)).toBe(true);
    expect(sessionMetadataService.getClearloop(sessionId)?.completed).toBe(0);
    await service.cancel(sessionId);
  });

  it("retries a failed iteration after a fresh window, without advancing", async () => {
    const { sessionMetadataService, started, attempts } = startFailingLoop({
      failures: 1,
      windowSeconds: 0,
    });
    await started;

    await vi.waitFor(() => expect(attempts()).toBe(2));
    expect(sessionMetadataService.notices[0]).toContain(
      "iteration 1 failed; retrying",
    );
    expect(sessionMetadataService.getClearloop(sessionId)?.completed).toBe(0);
    // The retried iteration then runs its normal course.
    await vi.waitFor(() =>
      expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
        "completed",
      ),
    );
  });

  it("gives up after repeated consecutive failures", async () => {
    const { sessionMetadataService, started, attempts } = startFailingLoop({
      failures: Number.POSITIVE_INFINITY,
      windowSeconds: 0,
    });
    await started;

    await vi.waitFor(() =>
      expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
        "interrupted",
      ),
    );
    expect(attempts()).toBe(CLEARLOOP_MAX_CONSECUTIVE_FAILURES);
    expect(sessionMetadataService.getClearloop(sessionId)?.error).toBe(
      "launch failed",
    );
    expect(sessionMetadataService.notices.at(-1)).toContain("interrupted");
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
