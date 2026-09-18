/**
 * `/clearloop N M: <prompt>` — a server-owned job that rewinds a session to
 * a cut and re-sends one prompt M times, ending each iteration after a
 * server-wide inactivity window. Contract: topics/session-rewind.md.
 *
 * The service owns the state machine and the inactivity timer. Rewinding and
 * sending are route-owned operations injected through `ClearloopRunner`
 * because they reuse the session routes' boundary resolution and resume
 * settings.
 */

import { randomUUID } from "node:crypto";
import type {
  DurableLocalCommandMessage,
  SessionClearloopJob,
  SessionClearloopState,
  UrlProjectId,
} from "@yep-anywhere/shared";
import type { SessionMetadataService } from "../metadata/SessionMetadataService.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import { getLogger } from "../logging/logger.js";
import type { EventBus } from "../watcher/EventBus.js";

export interface ClearloopRunner {
  /** Rewind the session to the job's cut. `noop` when the cut is the tail. */
  rewind(input: {
    sessionId: string;
    projectId: UrlProjectId;
    job: SessionClearloopJob;
    iteration: number;
  }): Promise<"rewound" | "noop">;
  /** Resume the session with the job's prompt as an ordinary direct turn. */
  send(input: {
    sessionId: string;
    projectId: UrlProjectId;
    job: SessionClearloopJob;
  }): Promise<void>;
}

export interface ClearloopServiceOptions {
  getSupervisor: () => Supervisor;
  sessionMetadataService: SessionMetadataService;
  eventBus?: EventBus;
  /** Current server-wide inactivity window, read at every boundary. */
  getInactivitySeconds: () => number;
}

export interface StartClearloopParams {
  cutMessageId: string;
  cutTurnIndex: number;
  prompt: string;
  total: number;
  commandText: string;
}

/** While the provider is busy the due time is unknown; look again soon. */
const BUSY_RECHECK_MS = 5_000;

interface LoopContext {
  projectId: UrlProjectId;
  timer: NodeJS.Timeout | null;
  /** Guards against overlapping iterate/check work. */
  working: boolean;
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export class ClearloopService {
  private runner: ClearloopRunner | null = null;
  private readonly contexts = new Map<string, LoopContext>();

  constructor(private readonly options: ClearloopServiceOptions) {
    options.eventBus?.subscribe((event) => {
      if (event.type === "session-aborted") {
        void this.interrupt(event.sessionId, "Session was stopped");
      }
    });
  }

  setRunner(runner: ClearloopRunner): void {
    this.runner = runner;
  }

  /** The job the queue projection should show, or undefined. */
  getRunningJob(sessionId: string): SessionClearloopJob | undefined {
    const job = this.options.sessionMetadataService.getClearloop(sessionId);
    if (job?.state !== "running") return undefined;
    // A running record without a live context is a leftover from a previous
    // server process; it can never advance, so it is not shown as running.
    return this.contexts.has(sessionId) ? job : undefined;
  }

  isRunning(sessionId: string): boolean {
    return this.getRunningJob(sessionId) !== undefined;
  }

  async start(
    sessionId: string,
    projectId: UrlProjectId,
    params: StartClearloopParams,
  ): Promise<SessionClearloopJob> {
    if (!this.runner) {
      throw new Error("clearloop runner is not configured");
    }
    if (this.isRunning(sessionId)) {
      throw new ClearloopConflictError(
        "A /clearloop is already running in this session",
      );
    }
    const job: SessionClearloopJob = {
      id: randomUUID(),
      cutMessageId: params.cutMessageId,
      cutTurnIndex: params.cutTurnIndex,
      prompt: params.prompt,
      total: params.total,
      completed: 0,
      state: "running",
      startedAt: new Date().toISOString(),
      commandText: params.commandText,
    };
    this.contexts.set(sessionId, { projectId, timer: null, working: false });
    await this.persist(sessionId, job);
    void this.iterate(sessionId);
    return job;
  }

  /**
   * Stop without touching in-flight provider work: the current iteration
   * finishes on its own and no further rewind happens.
   */
  async cancel(sessionId: string): Promise<SessionClearloopJob | undefined> {
    const job = this.getRunningJob(sessionId);
    if (!job) return undefined;
    return this.finish(sessionId, job, "cancelled");
  }

  async interrupt(
    sessionId: string,
    error: string,
  ): Promise<SessionClearloopJob | undefined> {
    const job = this.getRunningJob(sessionId);
    if (!job) return undefined;
    return this.finish(sessionId, job, "interrupted", error);
  }

  private async iterate(sessionId: string): Promise<void> {
    const context = this.contexts.get(sessionId);
    const job = this.getRunningJob(sessionId);
    if (!context || !job || !this.runner) return;
    if (job.completed >= job.total) {
      await this.finish(sessionId, job, "completed");
      return;
    }
    context.working = true;
    const iteration = job.completed + 1;
    try {
      await this.runner.rewind({
        sessionId,
        projectId: context.projectId,
        job,
        iteration,
      });
      // Cancel may have landed while rewinding.
      if (!this.getRunningJob(sessionId)) return;
      const sending: SessionClearloopJob = {
        ...job,
        currentIteration: iteration,
        iterationSentAt: new Date().toISOString(),
      };
      await this.persist(sessionId, sending);
      await this.runner.send({
        sessionId,
        projectId: context.projectId,
        job: sending,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger().warn(
        { event: "clearloop_iteration_failed", sessionId, iteration, message },
        "clearloop iteration failed",
      );
      const current = this.getRunningJob(sessionId);
      if (current)
        await this.finish(sessionId, current, "interrupted", message);
      return;
    } finally {
      context.working = false;
    }
    this.scheduleCheck(sessionId, this.options.getInactivitySeconds() * 1000);
  }

  private scheduleCheck(sessionId: string, delayMs: number): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    if (context.timer) clearTimeout(context.timer);
    const timer = setTimeout(
      () => {
        context.timer = null;
        void this.check(sessionId);
      },
      Math.max(250, delayMs),
    );
    timer.unref?.();
    context.timer = timer;
  }

  /** End the iteration once the session has been quiet for the window. */
  private async check(sessionId: string): Promise<void> {
    const context = this.contexts.get(sessionId);
    const job = this.getRunningJob(sessionId);
    if (!context || !job || context.working) return;
    const now = Date.now();
    const windowMs = this.options.getInactivitySeconds() * 1000;
    const process = this.options
      .getSupervisor()
      .getProcessForSession(sessionId);
    const candidates: number[] = [];
    const sentAt = parseIsoMs(job.iterationSentAt);
    if (sentAt !== null) candidates.push(sentAt);
    if (process) {
      if (process.state.type === "in-turn" || process.queueDepth > 0) {
        this.scheduleCheck(sessionId, BUSY_RECHECK_MS);
        return;
      }
      const liveness = process.getLivenessSnapshot(new Date(now));
      const state = process.state;
      for (const value of [
        state.type === "idle" ? state.since.getTime() : null,
        parseIsoMs(liveness.lastProviderMessageAt ?? undefined),
        parseIsoMs(liveness.lastRawProviderEventAt ?? undefined),
      ]) {
        if (value !== null) candidates.push(value);
      }
    }
    const anchor = candidates.length > 0 ? Math.max(...candidates) : now;
    const dueInMs = anchor + windowMs - now;
    if (dueInMs > 0) {
      this.scheduleCheck(sessionId, dueInMs);
      return;
    }
    const advanced: SessionClearloopJob = {
      ...job,
      completed: job.completed + 1,
      currentIteration: undefined,
    };
    await this.persist(sessionId, advanced);
    await this.iterate(sessionId);
  }

  private async finish(
    sessionId: string,
    job: SessionClearloopJob,
    state: Exclude<SessionClearloopState, "running">,
    error?: string,
  ): Promise<SessionClearloopJob> {
    const context = this.contexts.get(sessionId);
    if (context?.timer) clearTimeout(context.timer);
    this.contexts.delete(sessionId);
    const finished: SessionClearloopJob = {
      ...job,
      state,
      endedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
    await this.persist(sessionId, finished);
    await this.writeNotice(sessionId, finished);
    return finished;
  }

  private async persist(
    sessionId: string,
    job: SessionClearloopJob,
  ): Promise<void> {
    await this.options.sessionMetadataService.setClearloop(sessionId, job);
    const context = this.contexts.get(sessionId);
    this.options.eventBus?.emit({
      type: "session-metadata-changed",
      sessionId,
      ...(context ? { projectId: context.projectId } : {}),
      timestamp: new Date().toISOString(),
    });
    // A live process republishes the queue projection so the m/M badge
    // updates without a reload; a dead session refreshes on its next read.
    this.options
      .getSupervisor()
      .getProcessForSession(sessionId)
      ?.notifyQueueProjectionChanged("clearloop");
  }

  /** Durable session-history notice for every terminal state. */
  private async writeNotice(
    sessionId: string,
    job: SessionClearloopJob,
  ): Promise<void> {
    const remaining = job.total - job.completed;
    const summary =
      job.state === "completed"
        ? `${job.commandText} — completed ${job.completed} of ${job.total}`
        : `${job.commandText} — ${job.state} after ${job.completed} of ${job.total}, ${remaining} remaining`;
    const id = randomUUID();
    const notice: DurableLocalCommandMessage = {
      type: "system",
      subtype: "local_command",
      content: summary,
      ...(job.error ? { details: [job.error] } : {}),
      timestamp: new Date().toISOString(),
      uuid: id,
      id,
      session_id: sessionId,
      isSynthetic: true,
    };
    await this.options.sessionMetadataService.addLocalCommandMessage(
      sessionId,
      notice,
    );
  }
}

export class ClearloopConflictError extends Error {}
