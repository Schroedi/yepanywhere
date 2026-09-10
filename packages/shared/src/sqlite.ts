import { createRequire } from "node:module";
import { SERVER_BUN_RANGE, SERVER_NODE_RANGE } from "./server-runtime.js";

/** Positional parameters only; integer values must fit JavaScript's safe range. */
export type SqliteValue = string | number | null | Uint8Array;
export type SqliteRow = Record<string, SqliteValue>;

/** Row count affected by the last execution, as both runtimes report it. */
export interface SqliteRunResult {
  changes: number;
}

export interface SqliteStatement {
  /**
   * The row type is the caller's assertion about its own SELECT, exactly as an
   * `as` cast would be; SQLite reports no compile-time column types.
   */
  get<Row = SqliteRow>(...parameters: SqliteValue[]): Row | undefined;
  all<Row = SqliteRow>(...parameters: SqliteValue[]): Row[];
  run(...parameters: SqliteValue[]): SqliteRunResult;
  /** Release the prepared statement when its caller is finished. */
  finalize(): void;
}

interface NativeStatement {
  get(...parameters: SqliteValue[]): SqliteRow | null | undefined;
  all(...parameters: SqliteValue[]): SqliteRow[];
  run(...parameters: SqliteValue[]): { changes?: number } | undefined;
  finalize?(): void;
}

interface NativeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NativeStatement;
  close(): void;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  /** Synchronous callbacks only. Nested transactions are not supported. */
  transaction<T>(operation: () => T): T;
  close(): void;
}

export interface SqliteDriver {
  open(path: string): SqliteDatabase;
}

function wrapDatabase(native: NativeDatabase): SqliteDatabase {
  let closed = false;
  let inTransaction = false;
  // Bun 1.3.14 close(false) leaves prepare() statements alive and close(true)
  // throws while they exist. Finalize them explicitly before releasing the file.
  const statements = new Set<NativeStatement>();
  return {
    exec: (sql) => native.exec(sql),
    prepare(sql) {
      let statement: NativeStatement | undefined = native.prepare(sql);
      if (statement.finalize) statements.add(statement);
      const active = () => {
        if (closed || !statement) throw new Error("SQLite statement is closed");
        return statement;
      };
      return {
        // One assertion here keeps every caller's SELECT free of a cast.
        get: <Row = SqliteRow>(...parameters: SqliteValue[]) =>
          (active().get(...parameters) ?? undefined) as Row | undefined,
        all: <Row = SqliteRow>(...parameters: SqliteValue[]) =>
          active().all(...parameters) as unknown as Row[],
        run: (...parameters) => {
          // node:sqlite and bun:sqlite both report a numeric changes count.
          const result = active().run(...parameters);
          return { changes: result?.changes ?? 0 };
        },
        finalize() {
          if (!statement) return;
          if (!closed) statement.finalize?.();
          statements.delete(statement);
          statement = undefined;
        },
      };
    },
    transaction(operation) {
      if (inTransaction) throw new Error("Nested SQLite transaction");
      native.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      try {
        const result = operation();
        if (
          result !== null &&
          (typeof result === "object" || typeof result === "function") &&
          "then" in result
        ) {
          throw new Error("SQLite transactions require synchronous callbacks");
        }
        native.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          native.exec("ROLLBACK");
        } catch {
          // SQLite can already have rolled back (e.g. ON CONFLICT ROLLBACK).
          // Preserve the operation/commit error rather than masking its cause.
        }
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    close() {
      if (closed) return;
      for (const statement of statements) statement.finalize?.();
      statements.clear();
      native.close();
      closed = true;
    },
  };
}

/**
 * No SQLite import at module evaluation, and no third-party native dependency.
 * createRequire also avoids older Vite builtin-resolution tables. Bun must be
 * selected first: desktop's pinned runtime does not implement node:sqlite.
 * Node's experimental-module notice, where applicable, is intentionally intact.
 */
export function loadSqliteDriver(): SqliteDriver | undefined {
  const requireBuiltin = createRequire(import.meta.url);
  try {
    if (process.versions.bun) {
      const { Database } = requireBuiltin("bun:sqlite") as {
        Database: new (
          path: string,
          options: { create: boolean; strict: boolean },
        ) => NativeDatabase;
      };
      if (typeof Database !== "function") return undefined;
      return {
        open: (path) =>
          wrapDatabase(new Database(path, { create: true, strict: true })),
      };
    }
    const { DatabaseSync } = requireBuiltin("node:sqlite") as {
      DatabaseSync: new (path: string) => NativeDatabase;
    };
    if (typeof DatabaseSync !== "function") return undefined;
    return { open: (path) => wrapDatabase(new DatabaseSync(path)) };
  } catch {
    return undefined;
  }
}

/**
 * Open storage for a caller that cannot degrade, unlike the server's optional
 * discovery store: relay and push broker exist to persist their registries.
 */
export function openSqliteOrThrow(path: string): SqliteDatabase {
  const driver = loadSqliteDriver();
  if (!driver) {
    throw new Error(
      `This runtime has no built-in SQLite (node:sqlite or bun:sqlite). Node ${SERVER_NODE_RANGE} or Bun ${SERVER_BUN_RANGE} provides it.`,
    );
  }
  return driver.open(path);
}
