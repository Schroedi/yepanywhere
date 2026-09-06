import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProjectFileCompletionEntry,
  ProjectFileCompletionResult,
} from "@yep-anywhere/shared";
import { runGit } from "../git/gitExec.js";

const MAX_PATHS = 200_000;
const MAX_PROJECTS = 4;
const MAX_ACTIVE_SCANS = 2;
const REFRESH_MS = 60_000;
const MAX_BUFFER = 32 * 1024 * 1024;
const MAX_RETAINED_BYTES = 32 * 1024 * 1024;
const MAX_ACTIVE_QUERIES = 8;

interface Inventory {
  entries: ProjectFileCompletionEntry[];
  ready: Promise<void>;
  pending: boolean;
  error?: unknown;
  refreshedAt: number;
  truncated: boolean;
  args: string[];
}

const splitPaths = (value: string) => value.split("\0").filter(Boolean);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Created inert. Only a completion request acquires a bounded inventory. */
export class ProjectFileCompletion {
  private readonly inventories = new Map<string, Inventory>();
  private emptyGitDirectory?: Promise<string>;
  private activeScans = 0;
  private readonly queries = new Map<
    string,
    Promise<ProjectFileCompletionResult>
  >();

  constructor(private readonly dataDir: string) {}

  query(
    project: string,
    query: string,
    recent: readonly string[],
  ): Promise<ProjectFileCompletionResult> {
    const key = JSON.stringify([project, query, recent]);
    const existing = this.queries.get(key);
    if (existing) return existing;
    if (this.queries.size >= MAX_ACTIVE_QUERIES)
      return Promise.reject(
        new Error("File completion is busy; try again shortly"),
      );
    const pending = this.queryInventory(project, query, recent).finally(() =>
      this.queries.delete(key),
    );
    this.queries.set(key, pending);
    return pending;
  }

  private async queryInventory(
    project: string,
    query: string,
    recent: readonly string[],
  ): Promise<ProjectFileCompletionResult> {
    let state = this.inventories.get(project);
    if (
      state &&
      !state.pending &&
      Date.now() - state.refreshedAt > REFRESH_MS
    ) {
      this.inventories.delete(project);
      state = undefined;
    }
    if (!state) {
      if (this.activeScans >= MAX_ACTIVE_SCANS)
        throw new Error("File completion is busy; try again shortly");
      if (this.inventories.size >= MAX_PROJECTS) {
        const oldest = [...this.inventories].find(
          ([, value]) => !value.pending,
        );
        if (oldest) this.inventories.delete(oldest[0]);
      }
      state = {
        entries: [],
        ready: Promise.resolve(),
        pending: true,
        refreshedAt: Date.now(),
        truncated: false,
        args: [],
      };
      this.inventories.set(project, state);
      this.activeScans++;
      // First resolve the cheap tracked-index phase. Untracked filesystem
      // enumeration continues separately, shared by subsequent requests.
      const created = state;
      state.ready = this.start(project, state).catch((error: unknown) => {
        created.error = error;
        created.pending = false;
        this.activeScans--;
      });
    } else {
      this.inventories.delete(project);
      this.inventories.set(project, state);
    }
    await state.ready;
    if (state.error) throw state.error;
    const needle = query.toLowerCase();
    const ranks = new Map(recent.map((path, index) => [path, index]));
    const inventoryEntries = state.entries;
    const candidates = inventoryEntries.filter((entry) =>
      entry.path.toLowerCase().includes(needle),
    );
    candidates.sort(
      (a, b) =>
        (ranks.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
          (ranks.get(b.path) ?? Number.MAX_SAFE_INTEGER) ||
        compare(a.path, b.path),
    );

    // Cached paths are only candidates: recheck current ignore rules before
    // offering them, including tracked files matching newly written rules.
    const selected = candidates.slice(0, 100);
    const ignored = new Set<string>();
    if (selected.length) {
      try {
        const { stdout } = await runGit(
          project,
          [...state.args, "check-ignore", "--no-index", "-z", "--stdin"],
          {
            input: `${selected.map((entry) => entry.path).join("\0")}\0`,
            maxBuffer: MAX_BUFFER,
          },
        );
        for (const path of splitPaths(stdout)) ignored.add(path);
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === 1
          )
        )
          throw error;
      }
    }
    const present = await Promise.all(
      selected.map(async (entry) => {
        if (ignored.has(entry.path)) return false;
        try {
          await lstat(join(project, entry.path));
          return true;
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")
          )
            return false;
          throw error;
        }
      }),
    );
    const eligible = selected.filter((_, index) => present[index]);
    return {
      entries: eligible.slice(0, 30),
      pending: state.pending || state.entries !== inventoryEntries,
      truncated:
        state.truncated ||
        candidates.length > selected.length ||
        eligible.length > 30,
    };
  }

  private async start(project: string, state: Inventory): Promise<void> {
    let tracked: string[] = [];
    try {
      const { stdout } = await runGit(project, ["ls-files", "-z", "--cached"], {
        maxBuffer: MAX_BUFFER,
        env: { LC_ALL: "C" },
      });
      tracked = splitPaths(stdout);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("not a git repository")
      )
        throw error;
      state.args = [
        `--git-dir=${await this.emptyGitDir()}`,
        `--work-tree=${project}`,
      ];
      const probe = await runGit(
        project,
        [
          ...state.args,
          "ls-files",
          "-z",
          "--others",
          "--exclude-standard",
          "--directory",
          "--no-empty-directory",
        ],
        { maxBuffer: MAX_BUFFER },
      );
      tracked = splitPaths(probe.stdout);
    }
    this.populate(state, tracked);
    void Promise.allSettled([
      runGit(
        project,
        [...state.args, "ls-files", "-z", "--others", "--exclude-standard"],
        { maxBuffer: MAX_BUFFER },
      ),
      runGit(
        project,
        [
          ...state.args,
          "ls-files",
          "-z",
          "--cached",
          "--ignored",
          "--exclude-standard",
        ],
        { maxBuffer: MAX_BUFFER },
      ),
    ])
      .then(([untracked, ignoredTracked]) => {
        if (untracked.status === "rejected") throw untracked.reason;
        if (ignoredTracked.status === "rejected") throw ignoredTracked.reason;
        const ignored = new Set(splitPaths(ignoredTracked.value.stdout));
        this.populate(state, [
          ...tracked.filter(
            (path) => !path.endsWith("/") && !ignored.has(path),
          ),
          ...splitPaths(untracked.value.stdout),
        ]);
      })
      .catch((error: unknown) => {
        state.error = error;
      })
      .finally(() => {
        state.pending = false;
        this.activeScans--;
      });
  }

  private populate(state: Inventory, paths: string[]): void {
    state.truncated = false;
    const entries = new Map<string, ProjectFileCompletionEntry>();
    let retainedBytes = 0;
    const add = (path: string, kind: ProjectFileCompletionEntry["kind"]) => {
      if (entries.has(path)) return true;
      const bytes = path.length * 2 + 128;
      if (
        entries.size >= MAX_PATHS ||
        retainedBytes + bytes > MAX_RETAINED_BYTES
      ) {
        state.truncated = true;
        return false;
      }
      entries.set(path, { path, kind });
      retainedBytes += bytes;
      return true;
    };
    for (const path of paths) {
      if (
        path.length > 4096 ||
        /\p{Cc}/u.test(path) ||
        path.split("/").includes(".git")
      )
        continue;
      if (!add(path, path.endsWith("/") ? "directory" : "file")) break;
      for (
        let slash = path.indexOf("/");
        slash >= 0;
        slash = path.indexOf("/", slash + 1)
      ) {
        const parent = path.slice(0, slash + 1);
        if (!add(parent, "directory")) break;
      }
      if (state.truncated) break;
    }
    state.entries = [...entries.values()].sort((a, b) =>
      compare(a.path, b.path),
    );
  }

  private emptyGitDir(): Promise<string> {
    this.emptyGitDirectory ??= (async () => {
      const path = join(this.dataDir, "indexes", "file-completion-empty.git");
      await mkdir(path, { recursive: true });
      await runGit(this.dataDir, ["init", "--bare", "--template=", path]);
      return path;
    })();
    return this.emptyGitDirectory;
  }
}
