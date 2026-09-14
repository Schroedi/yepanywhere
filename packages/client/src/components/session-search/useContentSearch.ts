import { useEffect, useMemo, useState } from "react";
import type {
  SessionContentMatch,
  SessionContentSearchBatch,
  SessionContentSearchRequest,
} from "@yep-anywhere/shared";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import type { GlobalSessionItem } from "../../api/client";
import type { SearchField } from "./model";

interface ScanState {
  key: string;
  revision: string;
  query: string;
  matches: Map<string, SessionContentMatch[]>;
  scanned: number;
  partial: Map<string, string>;
  running: boolean;
  error?: string;
}

interface ScanInput {
  source: string;
  sessions: string[];
  roles: Array<"assistant" | "user">;
  after?: number;
  before?: number;
  enabled: boolean;
}

export function useContentSearch(
  sessions: GlobalSessionItem[],
  query: string,
  fields: SearchField[],
  enabled: boolean,
  after?: number,
  before?: number,
) {
  const runtime = useCurrentSourceRuntime();
  const roles = fields
    .filter((f): f is "assistant" | "user" => f !== "title")
    .sort();
  const key = JSON.stringify({
    source: runtime.sourceKey,
    sessions: sessions.map((s) => s.id).sort(),
    roles,
    after,
    before,
    enabled,
  } satisfies ScanInput);
  // Detail reads can refine metadata without changing which sessions we search.
  // Revalidate that revision while keeping matching rows and their zoom mounted.
  const revision = JSON.stringify(
    sessions
      .map((s) => [s.id, s.updatedAt])
      .sort(([a], [b]) => a!.localeCompare(b!)),
  );
  const [state, setState] = useState<ScanState>({
    key: "",
    revision: "",
    query: "",
    matches: new Map(),
    scanned: 0,
    partial: new Map(),
    running: false,
  });
  useEffect(() => {
    const { enabled, roles, sessions, after, before } = JSON.parse(
      key,
    ) as ScanInput;
    if (!enabled || !query.trim() || !roles.length) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const matches = new Map<string, SessionContentMatch[]>();
      const partial = new Map<string, string>();
      const completed = new Set<string>();
      let scanned = 0;
      const publish = (running: boolean, error?: string) => {
        if (!controller.signal.aborted)
          setState((previous) => {
            const visible = new Map(matches);
            if (previous.key === key && query.startsWith(previous.query)) {
              const needle = query.replace(/\s+/g, " ").trim().toLowerCase();
              for (const [id, hits] of previous.matches) {
                if (completed.has(id)) continue;
                const retained = new Map(
                  hits
                    .filter((hit) => hit.preview.toLowerCase().includes(needle))
                    .map((hit) => [hit.id, hit]),
                );
                for (const hit of matches.get(id) ?? [])
                  retained.set(hit.id, hit);
                if (retained.size) visible.set(id, [...retained.values()]);
              }
            }
            return {
              key,
              revision,
              query,
              matches: visible,
              scanned,
              partial: new Map(partial),
              running,
              error,
            };
          });
      };
      void (async () => {
        for (const sessionId of sessions) {
          let cursor: string | undefined;
          const found = new Map<string, SessionContentMatch>();
          do {
            controller.signal.throwIfAborted();
            const request: SessionContentSearchRequest = {
              sessionId,
              query,
              roles,
              after,
              before,
              cursor,
            };
            const batch =
              await runtime.transport.fetch<SessionContentSearchBatch>(
                "/sessions/content-search",
                {
                  method: "POST",
                  body: JSON.stringify(request),
                  signal: controller.signal,
                },
              );
            controller.signal.throwIfAborted();
            for (const match of batch.matches) found.set(match.id, match);
            if (found.size) matches.set(sessionId, [...found.values()]);
            if (batch.partial)
              partial.set(
                sessionId,
                batch.unavailable ??
                  "Some transcript records could not be searched",
              );
            cursor = batch.done ? undefined : batch.cursor;
            if (!batch.done && !cursor)
              throw new Error("Incomplete search batch has no continuation");
            publish(true);
          } while (cursor);
          completed.add(sessionId);
          scanned++;
          publish(true);
        }
        publish(false);
      })().catch((error: unknown) => {
        if (!controller.signal.aborted)
          publish(
            false,
            error instanceof Error ? error.message : String(error),
          );
      });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, revision, query, runtime]);
  const active = enabled && !!query.trim() && roles.length > 0;
  const exact =
    state.key === key && state.revision === revision && state.query === query;
  const matches = useMemo(() => {
    if (!active || state.key !== key)
      return new Map<string, SessionContentMatch[]>();
    if (state.query === query) return state.matches;
    if (!query.startsWith(state.query))
      return new Map<string, SessionContentMatch[]>();
    const needle = query.replace(/\s+/g, " ").trim().toLowerCase();
    return new Map(
      [...state.matches].map(([id, hits]) => [
        id,
        hits.filter((hit) => hit.preview.toLowerCase().includes(needle)),
      ]),
    );
  }, [active, key, query, state]);
  return {
    matches,
    running: active && (!exact || state.running),
    scanned: exact ? state.scanned : 0,
    partial: exact ? state.partial : new Map<string, string>(),
    error: exact ? state.error : undefined,
  };
}
