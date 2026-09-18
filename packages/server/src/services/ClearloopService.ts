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
  SessionClearloopBadge,
  SessionClearloopJob,
  SessionClearloopState,
  SessionQueuedClearloopProgress,
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
  /** True while the loop's own rewind may stop the live process. */
  rewinding: boolean;
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Remaining iterations for session summaries, from the durable job record
 * alone. A record left `running` by a previous server process is not shown:
 * the loop cannot advance, and `getRunningJob` reports it as not running.
 */
export function clearloopBadgeFromJob(
  job: SessionClearloopJob | undefined,
  isLive: boolean,
  windowSeconds?: number,
): SessionClearloopBadge | undefined {
  if (job?.state !== "running" || !isLive) return undefined;
  return {
    remaining: Math.max(0, job.total - job.completed),
    total: job.total,
    completed: job.completed,
    cutTurnIndex: job.cutTurnIndex,
    prompt: job.prompt,
    ...(windowSeconds !== undefined ? { windowSeconds } : {}),
  };
}

export class ClearloopService {
  private runner: ClearloopRunner | null = null;
  private readonly contexts = new Map<string, LoopContext>();

  constructor(private readonly options: ClearloopServiceOptions) {
    options.eventBus?.subscribe((event) => {
      if (event.type !== "session-aborted") return;
      // The loop's own rewind stops the live process to arm the truncating
      // resume; only a stop it did not request ends the loop.
      if (this.contexts.get(event.sessionId)?.rewinding) return;
      void this.interrupt(event.sessionId, "Session was stopped");
    });
  }

  setRunner(runner: ClearloopRunner): void {
    this.runner = runner;
  }

  /**
   * Loop state does not survive a server restart: a record left `running`
   * belongs to a previous server process and can never advance. Mark each
   * one interrupted with the usual durable notice so badges and history
   * agree. Called once after session metadata has loaded.
   */
  async reconcileAfterRestart(): Promise<void> {
    const sessionIds =
      this.options.sessionMetadataService.listSessionIdsWithRunningClearloop?.() ??
      [];
    for (const sessionId of sessionIds) {
      if (this.contexts.has(sessionId)) continue;
      const job = this.options.sessionMetadataService.getClearloop(sessionId);
      if (job?.state !== "running") continue;
      await this.finish(
        sessionId,
        job,
        "interrupted",
        "Server restarted while the loop was running",
      );
    }
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

  /** Badge data for the sidebar/title chip, or undefined when no loop runs. */
  getBadge(sessionId: string): SessionClearloopBadge | undefined {
    return clearloopBadgeFromJob(
      this.options.sessionMetadataService.getClearloop(sessionId),
      this.contexts.has(sessionId),
      this.options.getInactivitySeconds(),
    );
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
    this.contexts.set(sessionId, {
      projectId,
      timer: null,
      working: false,
      rewinding: false,
    });
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
      context.rewinding = true;
      try {
        await this.runner.rewind({
          sessionId,
          projectId: context.projectId,
          job,
          iteration,
        });
      } finally {
        context.rewinding = false;
      }
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
  /**
   * When the session last did anything (user send, provider progress), or
   * `busy` while a turn is running and the due time is unknown.
   */
  private readQuietAnchor(
    sessionId: string,
    job: SessionClearloopJob,
    now: number,
  ): { busy: true } | { busy: false; anchorMs: number } {
    const process = this.options
      .getSupervisor()
      .getProcessForSession(sessionId);
    const candidates: number[] = [];
    const sentAt = parseIsoMs(job.iterationSentAt);
    if (sentAt !== null) candidates.push(sentAt);
    if (process) {
      if (process.state.type === "in-turn" || process.queueDepth > 0) {
        return { busy: true };
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
    return {
      busy: false,
      anchorMs: candidates.length > 0 ? Math.max(...candidates) : now,
    };
  }

  /** Queue-entry progress for the running loop, with the countdown anchor. */
  getProgress(sessionId: string): SessionQueuedClearloopProgress | undefined {
    const job = this.getRunningJob(sessionId);
    if (!job) return undefined;
    const quiet = this.readQuietAnchor(sessionId, job, Date.now());
    return {
      completed: job.completed,
      total: job.total,
      state: job.state,
      ...(quiet.busy
        ? {}
        : {
            quietSince: new Date(quiet.anchorMs).toISOString(),
            windowSeconds: this.options.getInactivitySeconds(),
          }),
    };
  }

  private async check(sessionId: string): Promise<void> {
    const context = this.contexts.get(sessionId);
    const job = this.getRunningJob(sessionId);
    if (!context || !job || context.working) return;
    const now = Date.now();
    const windowMs = this.options.getInactivitySeconds() * 1000;
    const quiet = this.readQuietAnchor(sessionId, job, now);
    // Every check republishes the entry so clients see the busy/quiet
    // transition and can count down from the current anchor.
    this.publishQueueEntry(sessionId);
    if (quiet.busy) {
      this.scheduleCheck(sessionId, BUSY_RECHECK_MS);
      return;
    }
    const dueInMs = quiet.anchorMs + windowMs - now;
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
      clearloop:
        job.state === "running" && context
          ? clearloopBadgeFromJob(
              job,
              true,
              this.options.getInactivitySeconds(),
            )
          : null,
      timestamp: new Date().toISOString(),
    });
    this.publishQueueEntry(sessionId);
  }

  /**
   * A live process republishes the queue projection so the m/M badge and
   * countdown update without a reload; a dead session refreshes on its next
   * read.
   */
  private publishQueueEntry(sessionId: string): void {
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
