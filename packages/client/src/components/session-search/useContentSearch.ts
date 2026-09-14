import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { SessionContentMatch } from "@yep-anywhere/shared";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import type { GlobalSessionItem } from "../../api/client";
import type { SearchField } from "./model";
import { ContentSearchScan } from "./ContentSearchScan";

const EMPTY_MATCHES = new Map<string, SessionContentMatch[]>();
const EMPTY_PARTIAL = new Map<string, string>();

export function useContentSearch(
  sessions: GlobalSessionItem[],
  query: string,
  fields: SearchField[],
  enabled: boolean,
  after?: number,
  before?: number,
  viewportRows = Infinity,
) {
  const runtime = useCurrentSourceRuntime();
  const assistant = fields.includes("assistant");
  const user = fields.includes("user");
  const roles = useMemo(
    () => [
      ...(assistant ? ["assistant" as const] : []),
      ...(user ? ["user" as const] : []),
    ],
    [assistant, user],
  );
  const active = enabled && !!query.trim() && roles.length > 0;
  const key = JSON.stringify({
    roles,
    after,
    before,
    source: runtime.sourceKey,
    active,
  });
  const wanted = useMemo(
    () =>
      new Map(
        active
          ? sessions.map((s) => [s.id, `${s.updatedAt}\0${s.messageCount}`])
          : [],
      ),
    [sessions, active],
  );
  const owner = useRef<{
    key: string;
    scans: ContentSearchScan[];
    wanted: Map<string, string>;
    query: string;
  }>({ key: "", scans: [], wanted, query });
  const interested = useRef(document.visibilityState !== "hidden");
  useEffect(() => {
    const update = (visible: boolean) => {
      interested.current = visible;
      for (const scan of owner.current.scans) scan.setInterested(visible);
    };
    const visibility = () => update(document.visibilityState !== "hidden");
    const hide = () => update(false);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", visibility);
    };
  }, []);
  const [, refresh] = useState(0);
  const publish = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const capacity = useRef(viewportRows);
  useEffect(() => {
    capacity.current = viewportRows;
  }, [viewportRows]);
  const changed = useRef(() => {
    if (publish.current) return;
    publish.current = setTimeout(() => {
      publish.current = undefined;
      const current = owner.current;
      const replacement = current.scans[1];
      if (
        replacement?.query === current.query &&
        ([...current.wanted].every(([id, version]) => {
          const entry = replacement.entries.get(id);
          return entry?.done && entry.revision === version;
        }) ||
          [...replacement.entries].filter(
            ([id, entry]) => current.wanted.has(id) && entry.matches.length,
          ).length >= capacity.current)
      )
        current.scans.shift()!.stop();
      startTransition(() => refresh((value) => value + 1));
    }, 32);
  }).current;

  useEffect(() => {
    const current = owner.current;
    current.wanted = wanted;
    for (const scan of current.scans) scan.update(wanted);
  }, [wanted]);

  useEffect(() => {
    const current = owner.current;
    if (current.key !== key || !query.startsWith(current.query)) {
      for (const scan of current.scans) scan.stop();
      current.scans = [];
    }
    current.key = key;
    current.query = query;
    if (!active) return;
    // One pending latest needle, never a FIFO of intermediate keystrokes.
    const timer = setTimeout(() => {
      if (current.scans.length === 2) {
        const second = current.scans[1]!;
        const ready =
          [...second.entries].filter(
            ([id, entry]) => current.wanted.has(id) && entry.matches.length,
          ).length >= capacity.current ||
          [...current.wanted].every(([id, version]) => {
            const entry = second.entries.get(id);
            return entry?.done && entry.revision === version;
          });
        current.scans.splice(ready ? 0 : 1, 1)[0]!.stop();
      }
      const scan = new ContentSearchScan(
        query,
        { roles, after, before },
        runtime.transport,
        changed,
      );
      current.scans.push(scan);
      scan.setInterested(interested.current);
      scan.update(current.wanted);
      changed();
    }, 120);
    return () => clearTimeout(timer);
  }, [key, query, runtime, changed, active, roles, after, before]);

  useEffect(
    () => () => {
      for (const scan of owner.current.scans) scan.stop();
      clearTimeout(publish.current);
    },
    [],
  );

  if (!active || owner.current.key !== key)
    return {
      matches: EMPTY_MATCHES,
      partial: EMPTY_PARTIAL,
      scanned: 0,
      running: active,
      error: undefined,
    };
  const scans = owner.current.scans;
  const exact = [...scans].reverse().find((scan) => scan.query === query);
  const matches = new Map<string, SessionContentMatch[]>();
  const partial = new Map<string, string>();
  const needle = query.replace(/\s+/g, " ").trim().toLowerCase();
  let scanned = 0;
  for (const [id, version] of wanted) {
    const complete = exact?.entries.get(id);
    if (complete?.done && complete.revision === version) scanned++;
    const found = new Map<string, SessionContentMatch>();
    for (const scan of scans) {
      if (!query.startsWith(scan.query)) continue;
      const entry = scan.entries.get(id);
      if (!entry) continue;
      if (scan === exact && entry.done) found.clear();
      for (const hit of entry.matches)
        if (scan === exact || hit.preview.toLowerCase().includes(needle))
          found.set(hit.id, hit);
      if (entry.partial) partial.set(id, entry.partial);
      else if (scan === exact && entry.done) partial.delete(id);
    }
    if (found.size) matches.set(id, [...found.values()]);
  }
  return {
    matches,
    partial,
    scanned,
    running: !exact || scanned < wanted.size,
    error: undefined,
  };
}
