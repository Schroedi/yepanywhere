import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Durable artifact grants and the deletions they owe.
 *
 * A link that says it expires in seven days has to survive a restart to be
 * true, so the grant table is a file rather than process memory. That file
 * holds live bearer tokens: anyone who can read it holds every unexpired
 * artifact URL, which is why its directory is created mode 700 and why no
 * artifact content is ever written here.
 */

export interface StoredGrant {
  id: string;
  token: string;
  root: string;
  entry: string;
  expiresAt: number;
  /** An owning grant deletes its directory when it expires or is revoked. */
  owned: boolean;
}

export interface PendingDeletion {
  root: string;
  dueAt: number;
}

interface StoredState {
  version: 1;
  grants: StoredGrant[];
  deletions: PendingDeletion[];
}

const EMPTY: StoredState = { version: 1, grants: [], deletions: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readGrant(value: unknown): StoredGrant | null {
  if (!isRecord(value)) return null;
  const { id, token, root, entry, expiresAt, owned } = value;
  if (
    typeof id !== "string" ||
    typeof token !== "string" ||
    typeof root !== "string" ||
    typeof entry !== "string" ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt)
  )
    return null;
  return { id, token, root, entry, expiresAt, owned: owned === true };
}

function readDeletion(value: unknown): PendingDeletion | null {
  if (!isRecord(value)) return null;
  const { root, dueAt } = value;
  if (typeof root !== "string" || typeof dueAt !== "number") return null;
  return { root, dueAt };
}

/**
 * Directories that are never a disposable artifact bundle, whatever a caller
 * claims: a working tree, a home directory, or a root that holds one.
 */
export async function deletableDirectory(
  root: string,
  forbidden: readonly (string | undefined)[],
): Promise<boolean> {
  const path = resolve(root);
  if (path === dirname(path)) return false;
  for (const other of forbidden) {
    if (!other) continue;
    const compare = resolve(other);
    if (path === compare || compare.startsWith(`${path}/`)) return false;
  }
  if (path === resolve(homedir())) return false;
  return !(await stat(join(path, ".git")).then(
    () => true,
    () => false,
  ));
}

export class GrantStore {
  private state: StoredState = { ...EMPTY, grants: [], deletions: [] };
  private writing: Promise<void> = Promise.resolve();
  constructor(private readonly directory?: string) {}

  private get file(): string | undefined {
    return this.directory ? join(this.directory, "grants.json") : undefined;
  }

  /**
   * Read saved state. Corrupt or unreadable state is discarded rather than
   * blocking startup: the cost is that outstanding links stop working, which
   * is what every restart used to do anyway.
   */
  async load(): Promise<StoredState> {
    const file = this.file;
    if (!file) return { ...EMPTY, grants: [], deletions: [] };
    const raw = await readFile(file, "utf8").catch(() => null);
    if (raw === null) return { ...EMPTY, grants: [], deletions: [] };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("not an object");
      const grants = Array.isArray(parsed.grants)
        ? parsed.grants.map(readGrant).filter((g): g is StoredGrant => !!g)
        : [];
      const deletions = Array.isArray(parsed.deletions)
        ? parsed.deletions
            .map(readDeletion)
            .filter((d): d is PendingDeletion => !!d)
        : [];
      this.state = { version: 1, grants, deletions };
    } catch {
      this.state = { ...EMPTY, grants: [], deletions: [] };
    }
    return this.state;
  }

  /** Replace the saved state; writes are serialized and atomic. */
  save(grants: readonly StoredGrant[], deletions: readonly PendingDeletion[]) {
    this.state = { version: 1, grants: [...grants], deletions: [...deletions] };
    const file = this.file;
    if (!file) return this.writing;
    const snapshot = JSON.stringify(this.state);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory!, { recursive: true, mode: 0o700 });
        const staging = `${file}.${process.pid}`;
        await writeFile(staging, `${snapshot}\n`, { mode: 0o600 });
        await rename(staging, file);
      });
    return this.writing;
  }

  /** Wait for the last write, so a caller can observe what is on disk. */
  settled(): Promise<void> {
    return this.writing.catch(() => {});
  }

  /** Remove an owned directory. A failure is reported, never retried forever. */
  static async deleteDirectory(root: string): Promise<boolean> {
    return rm(root, { recursive: true, force: true }).then(
      () => true,
      () => false,
    );
  }
}
