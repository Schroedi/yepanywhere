import type {
  SessionContentMatch,
  SessionContentSearchBatch,
} from "@yep-anywhere/shared";
import type { SourceTransport } from "../../lib/transport";

export interface SessionScan {
  revision: string;
  matches: SessionContentMatch[];
  partial?: string;
  done: boolean;
  cursor?: string;
  resumeCursor?: string;
  found: Map<string, SessionContentMatch>;
  workPartial?: string;
  retries: number;
  started: boolean;
}

/** One query generation. Fair, bounded reads; catalog updates repair only changed rows. */
export class ContentSearchScan {
  readonly entries = new Map<string, SessionScan>();
  private wanted = new Map<string, string>();
  private queue = new Set<string>();
  private controller = new AbortController();
  private working = false;
  private interested = true;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly query: string,
    private readonly request: {
      roles: Array<"assistant" | "user">;
      after?: number;
      before?: number;
    },
    private readonly transport: Pick<SourceTransport, "fetch">,
    private readonly changed: () => void,
  ) {}

  update(wanted: Map<string, string>) {
    this.wanted = wanted;
    for (const id of this.queue) if (!wanted.has(id)) this.queue.delete(id);
    for (const [id, revision] of wanted) {
      let entry = this.entries.get(id);
      if (!entry || (entry.done && entry.revision !== revision)) {
        const resume = entry?.resumeCursor;
        entry = {
          revision,
          matches: entry?.matches ?? [],
          partial: entry?.partial,
          done: false,
          cursor: resume,
          found: new Map(resume ? entry?.matches.map((m) => [m.id, m]) : []),
          workPartial: resume ? entry?.partial : undefined,
          retries: 0,
          started: false,
        };
        this.entries.set(id, entry);
        this.queue.add(id);
      } else if (!entry.done) this.queue.add(id);
    }
    this.schedule();
  }

  setInterested(interested: boolean) {
    if (this.stopped || this.interested === interested) return;
    this.interested = interested;
    if (interested) {
      this.controller = new AbortController();
      this.update(this.wanted);
    } else {
      this.controller.abort();
      for (const entry of this.entries.values())
        if (!entry.done) entry.started = false;
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  stop() {
    this.setInterested(false);
    this.stopped = true;
    this.queue.clear();
  }

  private schedule() {
    if (
      this.working ||
      this.timer ||
      this.stopped ||
      !this.interested ||
      this.controller.signal.aborted ||
      !this.queue.size
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, 32);
  }

  private async run() {
    const signal = this.controller.signal;
    this.working = true;
    try {
      while (this.queue.size && !signal.aborted) {
        const id = this.queue.values().next().value!;
        this.queue.delete(id);
        if (!this.wanted.has(id)) continue;
        const entry = this.entries.get(id)!;
        if (entry.done) continue;
        if (!entry.started) {
          entry.revision = this.wanted.get(id)!;
          entry.started = true;
        }
        try {
          const batch = await this.transport.fetch<SessionContentSearchBatch>(
            "/sessions/content-search",
            {
              method: "POST",
              signal,
              body: JSON.stringify({
                sessionId: id,
                query: this.query,
                ...this.request,
                cursor: entry.cursor,
              }),
            },
          );
          if (signal.aborted) return;
          if (!batch.done && !batch.cursor)
            throw new Error("Incomplete search batch has no continuation");
          for (const id of batch.replacedIds ?? []) entry.found.delete(id);
          for (const match of batch.matches) entry.found.set(match.id, match);
          if (batch.partial)
            entry.workPartial =
              batch.unavailable ??
              "Some transcript records could not be searched";
          entry.cursor = batch.done ? undefined : batch.cursor;
          entry.resumeCursor = batch.resumeCursor;
          entry.done = batch.done;
          const visible = new Map(
            entry.done ? [] : entry.matches.map((m) => [m.id, m]),
          );
          for (const match of entry.found.values())
            visible.set(match.id, match);
          entry.matches = [...visible.values()];
          if (entry.done) entry.partial = entry.workPartial;
          else if (entry.workPartial) entry.partial = entry.workPartial;
        } catch (error) {
          if (signal.aborted) return;
          const status =
            error && typeof error === "object" && "status" in error
              ? error.status
              : undefined;
          if (
            entry.cursor &&
            (status === 409 || status === 400) &&
            entry.retries++ === 0
          ) {
            entry.cursor = undefined;
            entry.resumeCursor = undefined;
            entry.found.clear();
            entry.workPartial = undefined;
          } else {
            entry.partial =
              error instanceof Error ? error.message : String(error);
            entry.done = true;
            entry.resumeCursor = undefined;
          }
        }
        if (this.wanted.has(id)) {
          if (!entry.done) this.queue.add(id);
          else if (entry.revision !== this.wanted.get(id))
            this.update(this.wanted);
        }
        this.changed();
      }
    } finally {
      this.working = false;
      this.schedule();
    }
  }
}
