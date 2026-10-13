import type {
  IssueItem,
  IssueSettings,
  IssueTrackerStatus,
} from "@yep-anywhere/shared";
import type { IssueCredentials } from "./credentials.js";

/**
 * Keeps the open/draft/merged/closed state of GitHub items someone is looking
 * at.
 *
 * Confirmation asks about a reference once, which suits a title but not a
 * state that changes. This asks again only when a list read returns the item
 * and what the server holds is older than `FRESH_MS`; merged is final. Nothing
 * runs on a timer, so with no readers there are no requests. Every caller
 * joins one pass, which asks GitHub about up to `BATCH` items per request.
 * State lives in memory: a restart forgets it and the next look asks again.
 */

const FRESH_MS = 5 * 60_000;
const BATCH = 50;
/** References waiting for or inside a pass; a reader past this gets none. */
const QUEUE_LIMIT = 200;
const MEMORY_LIMIT = 2_000;
const TIMEOUT_MS = 10_000;

export interface IssueStatusDeps {
  settings: () => IssueSettings;
  credentials: IssueCredentials;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Known {
  status?: IssueTrackerStatus;
  /** Last attempt, successful or not; a failure is not retried before FRESH_MS. */
  askedAt: number;
}

interface Target {
  owner: string;
  name: string;
  number: number;
}

/** Only github.com: Enterprise hosts need their own API base and credential. */
function target(id: string): Target | null {
  const match = id.match(
    /^github:github\.com:([\w.-]+)\/([\w.-]+):([1-9]\d*)$/,
  );
  return match
    ? { owner: match[1]!, name: match[2]!, number: Number(match[3]) }
    : null;
}

type Answer = {
  __typename?: string;
  state?: string;
  isDraft?: boolean;
} | null;

function stateOf(answer: Answer): IssueTrackerStatus["state"] | null {
  if (!answer) return null;
  if (answer.state === "MERGED") return "merged";
  if (answer.state === "CLOSED") return "closed";
  if (answer.state !== "OPEN") return null;
  return answer.__typename === "PullRequest" && answer.isDraft
    ? "draft"
    : "open";
}

export class IssueStatusRefresher {
  private readonly known = new Map<string, Known>();
  private readonly waiting = new Set<string>();
  private readonly asking = new Set<string>();
  private running?: Promise<void>;
  private closed = false;
  constructor(private readonly deps: IssueStatusDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private enabled(): boolean {
    const settings = this.deps.settings();
    return Boolean(settings.enabled && settings.confirmation?.enabled);
  }

  private stale(known: Known | undefined): boolean {
    if (!known) return true;
    if (known.status?.state === "merged") return false;
    return this.now() - known.askedAt >= FRESH_MS;
  }

  /**
   * Attach the state held for each item and queue the stale ones. `refreshing`
   * says a pass covering some of these items is in flight.
   */
  annotate(items: IssueItem[]): { items: IssueItem[]; refreshing: boolean } {
    if (this.closed || !this.enabled()) return { items, refreshing: false };
    let refreshing = false;
    const annotated = items.map((item) => {
      if (!target(item.id)) return item;
      const known = this.known.get(item.id);
      if (this.waiting.has(item.id) || this.asking.has(item.id))
        refreshing = true;
      else if (
        this.stale(known) &&
        this.waiting.size + this.asking.size < QUEUE_LIMIT
      ) {
        this.waiting.add(item.id);
        refreshing = true;
      }
      return known?.status ? { ...item, trackerStatus: known.status } : item;
    });
    if (this.waiting.size) this.schedule();
    return { items: annotated, refreshing };
  }

  private schedule(): void {
    if (this.running) return;
    this.running = this.pass()
      .catch(() => {})
      .finally(() => {
        this.running = undefined;
        // A reader that queued work after the last check must not strand it.
        if (this.waiting.size && !this.closed && this.enabled())
          this.schedule();
      });
  }

  /** Awaitable for tests: resolves once no pass is running. */
  async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  private async pass(): Promise<void> {
    while (this.waiting.size) {
      if (this.closed || !this.enabled()) {
        this.waiting.clear();
        return;
      }
      const batch = [...this.waiting].slice(0, BATCH);
      for (const id of batch) {
        this.waiting.delete(id);
        this.asking.add(id);
      }
      try {
        const states = await this.ask(batch);
        const askedAt = this.now();
        const checkedAt = new Date(askedAt).toISOString();
        for (const id of batch) {
          const state = states.get(id);
          // A failed lookup keeps the last known state with its own check time.
          this.remember(id, {
            status: state ? { state, checkedAt } : this.known.get(id)?.status,
            askedAt,
          });
        }
      } finally {
        for (const id of batch) this.asking.delete(id);
      }
    }
  }

  private remember(id: string, known: Known): void {
    this.known.delete(id);
    this.known.set(id, known);
    if (this.known.size > MEMORY_LIMIT)
      this.known.delete(this.known.keys().next().value!);
  }

  /** One GraphQL request for the batch. Never throws; failures map to none. */
  private async ask(
    ids: string[],
  ): Promise<Map<string, IssueTrackerStatus["state"]>> {
    const states = new Map<string, IssueTrackerStatus["state"]>();
    const credential = await this.deps.credentials
      .resolve("github")
      .catch(() => null);
    if (!credential) return states;
    // Owner, name and number are restricted to word characters, dots and
    // dashes by `target`, so they are safe inside the query text.
    const repositories = new Map<
      string,
      Array<{ id: string; number: number }>
    >();
    for (const id of ids) {
      const parsed = target(id)!;
      const key = `${parsed.owner}/${parsed.name}`;
      repositories.set(key, [
        ...(repositories.get(key) ?? []),
        { id, number: parsed.number },
      ]);
    }
    const aliases = new Map<string, string>();
    const fields = [...repositories].map(([key, items], r) => {
      const [owner, name] = key.split("/");
      const inner = items.map((item, i) => {
        aliases.set(`r${r}.i${i}`, item.id);
        return `i${i}: issueOrPullRequest(number: ${item.number}) { ...S }`;
      });
      return `r${r}: repository(owner: "${owner}", name: "${name}") { ${inner.join(" ")} }`;
    });
    const query = `query { ${fields.join(" ")} }
fragment S on IssueOrPullRequest {
  __typename
  ... on PullRequest { state isDraft }
  ... on Issue { state }
}`;
    try {
      const response = await (this.deps.fetch ?? fetch)(
        "https://api.github.com/graphql",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credential.token}`,
            "Content-Type": "application/json",
            "User-Agent": "yep-anywhere",
          },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok) return states;
      // A missing repository nulls its own field and leaves the others intact.
      const body = (await response.json()) as {
        data?: Record<string, Record<string, Answer> | null> | null;
      };
      for (const [alias, id] of aliases) {
        const [r, i] = alias.split(".") as [string, string];
        const state = stateOf(body.data?.[r]?.[i] ?? null);
        if (state) states.set(id, state);
      }
    } catch {
      /* Unreachable: every item in the batch keeps what it had. */
    }
    return states;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.waiting.clear();
    await this.settled();
  }
}
