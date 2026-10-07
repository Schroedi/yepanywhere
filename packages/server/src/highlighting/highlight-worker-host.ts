/**
 * Main-thread owner of the recyclable Shiki highlighting worker.
 *
 * Shiki's Oniguruma WebAssembly memory grows with loaded grammars and input
 * size and never shrinks, and every highlighter dropped without `dispose()`
 * strands its scanners in that memory (6–30 MB each). Running the only
 * highlighter in a worker bounds both: the worker reports its isolate's
 * external memory after each job, and the host retires it past a memory
 * budget, a job count, or an idle period. Terminating the worker releases its
 * whole isolate, WebAssembly memory included.
 *
 * A retiring worker finishes its in-flight jobs while new jobs go to a fresh
 * worker. A worker that crashes or stops making progress is terminated and its
 * pending jobs reject; every caller falls back to unhighlighted output.
 * Tokenizing off the main thread also stops large files from blocking the
 * event loop.
 */

import { Worker } from "node:worker_threads";
import { registerIdleSweep } from "../lib/processIdleSweep.js";
import { getLogger } from "../logging/logger.js";

const DEFAULT_MAX_EXTERNAL_MB = 192;
const DEFAULT_MAX_JOBS = 10_000;
const DEFAULT_IDLE_MS = 5 * 60 * 1000;
/** Longest a busy worker may go without answering any job. */
const DEFAULT_STALL_MS = 30 * 1000;

const WORKER_URL = new URL("./highlight-worker.mjs", import.meta.url);

export interface HighlightWorkerHostOptions {
  /** Retire the worker once its isolate's external memory exceeds this. */
  maxExternalBytes?: number;
  /** Retire the worker after this many completed jobs. */
  maxJobs?: number;
  /** Retire a worker idle this long, checked by the process idle sweep. */
  idleMs?: number;
  /** Terminate a busy worker that answers nothing for this long. */
  stallMs?: number;
  workerUrl?: URL;
}

export interface HighlightWorkerStats {
  live: boolean;
  pendingJobs: number;
  jobsOnCurrentWorker: number;
  lastExternalBytes: number;
  maxExternalBytes: number;
  workersStarted: number;
  workersRetired: number;
  workersFailed: number;
}

interface PendingJob {
  resolve: (html: string) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  pending: Map<number, PendingJob>;
  completedJobs: number;
  externalBytes: number;
  retiring: boolean;
  stallTimer: NodeJS.Timeout | null;
}

interface WorkerReply {
  id: number;
  html?: string;
  error?: string;
  externalBytes?: number;
}

export class HighlightWorkerHost {
  private readonly maxExternalBytes: number;
  private readonly maxJobs: number;
  private readonly idleMs: number;
  private readonly stallMs: number;
  private readonly workerUrl: URL;
  private current: WorkerSlot | null = null;
  private readonly retiring = new Set<WorkerSlot>();
  private unregisterIdleSweep: (() => void) | null = null;
  private lastActivityAt = 0;
  private nextJobId = 1;
  private workersStarted = 0;
  private workersRetired = 0;
  private workersFailed = 0;

  constructor(options: HighlightWorkerHostOptions = {}) {
    this.maxExternalBytes =
      options.maxExternalBytes ??
      resolveMaxExternalBytesFromEnv() ??
      DEFAULT_MAX_EXTERNAL_MB * 1024 * 1024;
    this.maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.stallMs = options.stallMs ?? DEFAULT_STALL_MS;
    this.workerUrl = options.workerUrl ?? WORKER_URL;
  }

  /**
   * Highlight `code` as `lang` (a Shiki bundled language id). `codeClass`, when
   * given, is added to the `<code>` element. Rejects when the language cannot
   * load or the worker fails; callers render plain output instead.
   */
  highlight(code: string, lang: string, codeClass?: string): Promise<string> {
    this.lastActivityAt = Date.now();
    const slot = this.current ?? this.spawn();
    const id = this.nextJobId++;
    return new Promise<string>((resolve, reject) => {
      slot.pending.set(id, { resolve, reject });
      if (slot.pending.size === 1) this.armStallTimer(slot);
      slot.worker.postMessage({ id, code, lang, codeClass });
    });
  }

  getStats(): HighlightWorkerStats {
    let pendingJobs = this.current?.pending.size ?? 0;
    for (const slot of this.retiring) pendingJobs += slot.pending.size;
    return {
      live: this.current !== null,
      pendingJobs,
      jobsOnCurrentWorker: this.current?.completedJobs ?? 0,
      lastExternalBytes: this.current?.externalBytes ?? 0,
      maxExternalBytes: this.maxExternalBytes,
      workersStarted: this.workersStarted,
      workersRetired: this.workersRetired,
      workersFailed: this.workersFailed,
    };
  }

  /** Terminate every worker, rejecting their pending jobs. */
  async close(): Promise<void> {
    const slots = [...this.retiring];
    if (this.current) slots.push(this.current);
    this.setCurrent(null);
    this.retiring.clear();
    await Promise.all(slots.map((slot) => this.terminate(slot)));
  }

  private spawn(): WorkerSlot {
    const worker = new Worker(this.workerUrl);
    // Highlighting never keeps the server alive on its own.
    worker.unref();
    const slot: WorkerSlot = {
      worker,
      pending: new Map(),
      completedJobs: 0,
      externalBytes: 0,
      retiring: false,
      stallTimer: null,
    };
    worker.on("message", (reply: WorkerReply) => this.onReply(slot, reply));
    worker.on("error", (error) => this.onFailure(slot, error));
    worker.on("exit", (code) =>
      this.onFailure(slot, new Error(`Highlight worker exited (${code})`)),
    );
    this.setCurrent(slot);
    this.workersStarted += 1;
    return slot;
  }

  private onReply(slot: WorkerSlot, reply: WorkerReply): void {
    // Delivering a message refs the worker's port again (observed on Node
    // 24), which would keep short-lived processes alive after highlighting.
    slot.worker.unref();
    const job = slot.pending.get(reply.id);
    if (!job) return;
    slot.pending.delete(reply.id);
    slot.completedJobs += 1;
    this.lastActivityAt = Date.now();
    if (typeof reply.externalBytes === "number") {
      slot.externalBytes = reply.externalBytes;
    }
    if (reply.html !== undefined) {
      job.resolve(reply.html);
    } else {
      job.reject(new Error(reply.error ?? "Highlight failed"));
    }

    if (
      !slot.retiring &&
      (slot.externalBytes > this.maxExternalBytes ||
        slot.completedJobs >= this.maxJobs)
    ) {
      this.retire(slot, "budget");
    }

    if (slot.pending.size > 0) {
      this.armStallTimer(slot);
      return;
    }
    this.clearStallTimer(slot);
    if (slot.retiring) void this.terminate(slot);
  }

  /** Stop routing new jobs to `slot`; it exits once its queue drains. */
  private retire(slot: WorkerSlot, reason: "budget" | "idle"): void {
    slot.retiring = true;
    if (this.current === slot) this.setCurrent(null);
    this.retiring.add(slot);
    this.workersRetired += 1;
    getLogger().debug(
      {
        event: "highlight_worker_retire",
        reason,
        completedJobs: slot.completedJobs,
        externalBytes: slot.externalBytes,
      },
      "HIGHLIGHT: retiring worker",
    );
  }

  private onFailure(slot: WorkerSlot, error: Error): void {
    this.forget(slot);
    // A terminated worker's exit arrives after its jobs were already settled.
    if (slot.pending.size === 0) return;
    this.workersFailed += 1;
    getLogger().warn(
      {
        event: "highlight_worker_failed",
        pendingJobs: slot.pending.size,
        error: error.message,
      },
      "HIGHLIGHT: worker failed",
    );
    const jobs = [...slot.pending.values()];
    slot.pending.clear();
    for (const job of jobs) job.reject(error);
    void slot.worker.terminate();
  }

  private async terminate(slot: WorkerSlot): Promise<void> {
    this.forget(slot);
    const jobs = [...slot.pending.values()];
    slot.pending.clear();
    for (const job of jobs) job.reject(new Error("Highlight worker closed"));
    await slot.worker.terminate();
  }

  private forget(slot: WorkerSlot): void {
    this.clearStallTimer(slot);
    this.retiring.delete(slot);
    if (this.current === slot) this.setCurrent(null);
  }

  private armStallTimer(slot: WorkerSlot): void {
    this.clearStallTimer(slot);
    slot.stallTimer = setTimeout(() => {
      slot.stallTimer = null;
      this.onFailure(slot, new Error("Highlight worker stalled"));
    }, this.stallMs);
    slot.stallTimer.unref();
  }

  private clearStallTimer(slot: WorkerSlot): void {
    if (slot.stallTimer) clearTimeout(slot.stallTimer);
    slot.stallTimer = null;
  }

  /** Track the routable worker; the idle sweep is registered only while one exists. */
  private setCurrent(slot: WorkerSlot | null): void {
    this.current = slot;
    if (slot) {
      this.unregisterIdleSweep ??= registerIdleSweep((now) =>
        this.sweepIdle(now),
      );
    } else {
      this.unregisterIdleSweep?.();
      this.unregisterIdleSweep = null;
    }
  }

  private sweepIdle(now: number): void {
    const slot = this.current;
    if (!slot || slot.pending.size > 0) return;
    if (now - this.lastActivityAt < this.idleMs) return;
    this.retire(slot, "idle");
    void this.terminate(slot);
  }
}

function resolveMaxExternalBytesFromEnv(): number | null {
  const raw = process.env.YEP_HIGHLIGHT_WORKER_MAX_MB;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1024 * 1024 : null;
}

/** Process-wide singleton shared by every highlighting path. */
export const highlightWorker = new HighlightWorkerHost();
