import { publishDraftPresenceChange } from "./draftPresenceEvents";
import {
  getSyncedDraftSessionIds,
  setSyncedDraftSessionIds,
} from "./syncedDraftPresence";
import type { ClientSummarySourceKey } from "./clientSummaryStore";
import {
  EMPTY_DRAFT,
  draftHasContent,
  draftPayloadEqual,
  mergeDrafts,
  type DraftPayload,
  type DraftRead,
  type DraftSlot,
  type DraftSnapshot,
  type DraftWrite,
  type DraftWriteResult,
} from "@yep-anywhere/shared";
import { readDraftEnvelopeValue } from "./draftEnvelope";
import type { SourceTransport } from "./transport/types";

export const DRAFT_STORAGE_EVENT = "yep-draft-storage";
export const DRAFT_SYNC_STATUS_EVENT = "yep-draft-sync-status";
interface Address {
  source: string;
  slot: DraftSlot;
  format: "envelope" | "string" | "questions" | "async" | "comments";
}
interface Saved {
  raw: string | null;
  base: DraftSnapshot | null;
  pending?: DraftWrite;
  recovery?: string | null;
  alternative?: DraftPayload;
  submitted?: {
    payload: DraftPayload;
    revision: string | null;
    operationId?: string;
  };
}
interface Entry {
  key: string;
  address: Address;
  saved: Saved;
  timer?: ReturnType<typeof setTimeout>;
  firstDirty: number;
  running: boolean;
  remote?: DraftRead;
  needsRecovery?: boolean;
  error?: string;
  submissionTask?: Promise<void>;
  waitForSync?: Promise<void>;
}
const owners = new Map<string, string>();
const clients = new Map<string, DraftSyncClient>();
let currentSource = "local";
const listeners = new Map<string, Set<() => void>>();

export function draftAddress(key: string): Address | null {
  try {
    const parts = key.split(":").map(decodeURIComponent);
    if (key.startsWith("draft-message-"))
      return {
        source: "local",
        slot: { kind: "session", sessionId: key.slice(14) },
        format: "envelope",
      };
    const source = parts[1] ?? currentSource;
    if (parts[0] === "draft-message")
      return {
        source,
        slot: { kind: "session", sessionId: parts.slice(2).join(":") },
        format: "envelope",
      };
    if (parts[0] === "draft-new-session")
      return {
        source,
        slot: {
          kind: "new-session",
          ...(parts[2] ? { projectId: parts[2] } : {}),
        },
        format: "envelope",
      };
    if (parts[0] === "fab-draft")
      return { source, slot: { kind: "floating" }, format: "envelope" };
    if (parts[0] === "draft-handoff")
      return {
        source: currentSource,
        slot: { kind: "handoff", sessionId: parts[1] },
        format: "envelope",
      };
    if (parts[0] === "draft-tool-approval-feedback")
      return {
        source,
        slot: { kind: "approval", sessionId: parts[2] },
        format: "string",
      };
    if (parts[0] === "draft-question-other")
      return {
        source,
        slot: { kind: "question", sessionId: parts[2] },
        format: "questions",
      };
    if (parts[0] === "yep-async-questions") {
      const source = [...new Set([...owners.keys(), currentSource, "local"])]
        .sort((a, b) => b.length - a.length)
        .find((s) => key.startsWith(`yep-async-questions:${s}:`));
      if (source) {
        const rest = key.slice(`yep-async-questions:${source}:`.length);
        const split = rest.indexOf(":");
        if (split > 0)
          return {
            source,
            slot: {
              kind: "async-question",
              sessionId: rest.slice(0, split),
              field: rest.slice(split + 1),
            },
            format: "async",
          };
      }
    }
    if (parts[0] === "session-file-comments")
      return {
        source,
        slot: {
          kind: "file-comments",
          sessionId: parts[2],
          projectId: parts[3],
          field: parts.slice(4).join(":"),
        },
        format: "comments",
      };
  } catch {
    /* Unknown legacy keys remain local. */
  }
  return null;
}
export function draftLocalKey(source: string, slot: DraftSlot): string {
  const e = encodeURIComponent;
  switch (slot.kind) {
    case "session":
      return source === "local"
        ? `draft-message-${slot.sessionId}`
        : `draft-message:${e(source)}:${e(slot.sessionId ?? "")}`;
    case "new-session":
      return `draft-new-session:${e(source)}${slot.projectId ? `:${e(slot.projectId)}` : ""}`;
    case "floating":
      return `fab-draft:${e(source)}`;
    case "handoff":
      return `draft-handoff:${slot.sessionId}`;
    case "approval":
      return `draft-tool-approval-feedback:${e(source)}:${e(slot.sessionId ?? "")}`;
    case "question":
      return `draft-question-other:${e(source)}:${e(slot.sessionId ?? "")}`;
    case "async-question":
      return `yep-async-questions:${source}:${slot.sessionId}:${slot.field}`;
    case "file-comments":
      return [
        "session-file-comments",
        source,
        slot.sessionId ?? "",
        slot.projectId ?? "",
        slot.field ?? "",
      ]
        .map(e)
        .join(":");
  }
}
function payload(address: Address, raw: string | null): DraftPayload {
  try {
    if (address.format === "envelope") {
      const envelope = readDraftEnvelopeValue(raw).envelope;
      return {
        fields: envelope?.text ? { text: envelope.text } : {},
        attachments: envelope?.attachments?.refs ?? [],
      };
    }
    if (address.format === "string")
      return { fields: raw ? { text: raw } : {}, attachments: [] };
    const parsed = JSON.parse(raw ?? "null");
    if (address.format === "async")
      return {
        fields: parsed?.draft ? { text: parsed.draft } : {},
        attachments: [],
      };
    if (address.format === "questions")
      return { fields: parsed ?? {}, attachments: [] };
    const fields: Record<string, string> = {};
    for (const comment of parsed ?? []) {
      const { text, ...meta } = comment;
      fields[`${comment.id}/text`] = text;
      fields[`${comment.id}/meta`] = JSON.stringify(meta);
    }
    return { fields, attachments: [] };
  } catch {
    return EMPTY_DRAFT;
  }
}
function encode(
  address: Address,
  value: DraftPayload,
  old: string | null,
): string | null {
  if (address.format === "envelope")
    return draftHasContent(value)
      ? JSON.stringify({
          version: 1,
          text: value.fields.text ?? "",
          ...(value.attachments.length
            ? {
                attachments: {
                  batchId: value.attachments[0]!.batchId,
                  refs: value.attachments,
                  updatedAt: new Date().toISOString(),
                },
              }
            : {}),
        })
      : null;
  if (address.format === "string") return value.fields.text || null;
  if (address.format === "questions")
    return Object.keys(value.fields).length
      ? JSON.stringify(value.fields)
      : null;
  if (address.format === "async") {
    let record: Record<string, unknown> = {
      draft: "",
      dismissed: false,
      seen: false,
      answer: null,
      edits: 0,
    };
    try {
      record = { ...record, ...JSON.parse(old ?? "{}") };
    } catch {}
    return JSON.stringify({ ...record, draft: value.fields.text ?? "" });
  }
  const comments = [];
  for (const [key, text] of Object.entries(value.fields))
    if (key.endsWith("/text") && text) {
      try {
        comments.push({
          ...JSON.parse(value.fields[`${key.slice(0, -5)}/meta`] ?? "{}"),
          text,
        });
      } catch {}
    }
  return comments.length ? JSON.stringify(comments) : null;
}
function storageAddress(key: string): Address | null {
  const draft = draftAddress(key);
  if (draft) return draft;
  if (/^draft-(index|presence)-message:/.test(key)) {
    try {
      return {
        source: decodeURIComponent(key.split(":")[1] ?? "local"),
        slot: { kind: "floating" },
        format: "string",
      };
    } catch {}
  }
  return null;
}
function physical(key: string, address: Address): string {
  const owner =
    owners.get(address.source) ??
    localStorage.getItem(`draft-owner:${encodeURIComponent(address.source)}`);
  const sourceKey =
    address.slot.kind === "handoff" && address.source !== "local"
      ? `draft-source:${encodeURIComponent(address.source)}:${key}`
      : key;
  return owner == null || owner === ""
    ? sourceKey
    : `draft-account:${encodeURIComponent(owner)}:${sourceKey}`;
}
function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
  window.dispatchEvent(
    new CustomEvent(DRAFT_STORAGE_EVENT, { detail: { key } }),
  );
}
export function subscribeDraftStorage(
  key: string,
  listener: () => void,
): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  const address = draftAddress(key);
  if (address && !key.endsWith("*")) clients.get(address.source)?.observe(key);
  if (key.endsWith("*"))
    for (const client of clients.values()) void client.refresh();
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(key);
  };
}
export const draftStorage = {
  keys(): string[] {
    const keys = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const stored = localStorage.key(i);
      if (!stored) continue;
      let key = stored.startsWith("draft-account:")
        ? stored.slice(stored.indexOf(":", 14) + 1)
        : stored;
      if (key.startsWith("draft-source:"))
        key = key.slice(key.indexOf(":", 13) + 1);
      const a = storageAddress(key);
      if (a && physical(key, a) === stored) keys.add(key);
    }
    return [...keys];
  },
  getItem(key: string): string | null {
    const a = storageAddress(key);
    const held = a && clients.get(a.source)?.entries.get(key);
    if (held) return held.saved.raw;
    return localStorage.getItem(a ? physical(key, a) : key);
  },
  setItem(key: string, raw: string): void {
    const a = storageAddress(key);
    try {
      localStorage.setItem(a ? physical(key, a) : key, raw);
    } catch (error) {
      if (a && draftAddress(key)) {
        clients.get(a.source)?.edit(key, raw);
        clients.get(a.source)?.localFailure(key);
      }
      throw error;
    }
    if (a && draftAddress(key)) clients.get(a.source)?.edit(key, raw);
  },
  removeItem(key: string): void {
    const a = storageAddress(key);
    localStorage.removeItem(a ? physical(key, a) : key);
    if (a && draftAddress(key)) clients.get(a.source)?.edit(key, null);
  },
};
function editing(): boolean {
  const el = document.activeElement;
  return (
    !!el &&
    (el.tagName === "TEXTAREA" ||
      el.tagName === "INPUT" ||
      (el as HTMLElement).isContentEditable)
  );
}
export function draftSyncPending(source?: string): Array<{
  key: string;
  error?: string;
  recovery: boolean;
}> {
  return [...clients.values()]
    .filter((c) => !source || c.source === source)
    .flatMap((c) =>
      [...c.entries.values()]
        .filter(
          (e) => e.remote || e.saved.alternative || e.error || e.needsRecovery,
        )
        .map((e) => ({
          key: e.key,
          error: e.error,
          recovery: !!e.needsRecovery,
        })),
    );
}
export function acceptPendingDrafts(source?: string): void {
  for (const client of clients.values())
    if (!source || client.source === source)
      for (const entry of client.entries.values()) client.accept(entry);
}
function status(): void {
  window.dispatchEvent(new Event(DRAFT_SYNC_STATUS_EVENT));
}

/** One source/account owner. Storage wrappers are also used in local-only mode. */
export class DraftSyncClient {
  readonly entries = new Map<string, Entry>();
  private stopped = false;
  private started = false;
  private identified = false;
  private refreshing?: Promise<void>;
  private sequence = -1;
  private abort = new AbortController();
  private retry?: ReturnType<typeof setTimeout>;
  private unstatus?: () => void;
  constructor(
    readonly source: string,
    readonly owner: string,
    private transport: SourceTransport,
  ) {}
  private metaKey(key: string): string {
    return `draft-sync-v1:${encodeURIComponent(this.source)}:${encodeURIComponent(this.owner)}:${encodeURIComponent(key)}`;
  }
  private persist(e: Entry): void {
    try {
      localStorage.setItem(this.metaKey(e.key), JSON.stringify(e.saved));
    } catch {
      e.error = "local";
      status();
    }
  }
  register(key: string): Entry | null {
    const present = this.entries.get(key);
    if (present) return present;
    const address = draftAddress(key);
    if (!address || address.source !== this.source) return null;
    let raw: string | null = null;
    let error: string | undefined;
    try {
      raw = draftStorage.getItem(key);
    } catch {
      error = "local";
    }
    let saved: Saved = { raw, base: null };
    try {
      const meta = JSON.parse(
        localStorage.getItem(this.metaKey(key)) ?? "null",
      );
      if (meta) saved = { ...meta, raw: saved.raw };
    } catch {}
    const e: Entry = {
      key,
      address,
      saved,
      firstDirty: 0,
      running: false,
      needsRecovery: !!saved.submitted,
      error,
    };
    this.entries.set(key, e);
    return e;
  }
  localFailure(key: string): void {
    const e = this.entries.get(key);
    if (e) {
      e.error = "local";
      status();
    }
  }
  observe(key: string): void {
    const e = this.register(key);
    if (e) this.schedule(e, 0);
  }
  edit(key: string, raw: string | null): void {
    const e = this.register(key);
    if (!e) return;
    e.saved.raw = raw;
    if (e.error === "local") e.error = undefined;
    if (
      e.saved.submitted &&
      raw &&
      readDraftEnvelopeValue(raw).envelope?.pendingSendAt === undefined
    ) {
      e.saved.recovery = encode(e.address, e.saved.submitted.payload, null);
    }
    try {
      this.persist(e);
    } catch {
      e.error = "local";
      status();
    }
    if (
      raw &&
      readDraftEnvelopeValue(raw).envelope?.pendingSendAt !== undefined
    ) {
      this.beginSubmit(e);
      return;
    }
    this.schedule(e, raw === null ? 0 : 3000);
  }
  private schedule(e: Entry, delay: number): void {
    if (this.stopped || e.needsRecovery) return;
    if (e.timer) clearTimeout(e.timer);
    if (!e.firstDirty) e.firstDirty = Date.now();
    e.timer = setTimeout(
      () => {
        e.timer = undefined;
        void this.sync(e);
      },
      Math.min(delay, Math.max(0, 10_000 - (Date.now() - e.firstDirty))),
    );
  }
  private post<T>(path: string, body: unknown): Promise<T> {
    return this.transport.fetch<T>(`/drafts/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: this.abort.signal,
    });
  }
  async sync(e: Entry): Promise<void> {
    if (
      this.stopped ||
      e.running ||
      (this.started && !this.identified) ||
      e.saved.alternative ||
      this.transport.status.getSnapshot().state !== "ready" ||
      e.remote ||
      e.needsRecovery ||
      e.saved.submitted ||
      e.submissionTask
    )
      return;
    e.running = true;
    let finishSync!: () => void;
    e.waitForSync = new Promise<void>((resolve) => {
      finishSync = resolve;
    });
    e.firstDirty = 0;
    try {
      let read = await this.post<DraftRead>("read", { slot: e.address.slot });
      if (this.stopped) return;
      if (e.saved.pending) {
        const result = await this.post<DraftWriteResult>(
          "write",
          e.saved.pending,
        );
        if (this.stopped) return;
        if (result.outcome === "accepted") {
          e.saved.base = result.snapshot;
          e.saved.pending = undefined;
          this.persist(e);
          read = await this.post<DraftRead>("read", { slot: e.address.slot });
        } else if (result.outcome === "expired") {
          e.needsRecovery = true;
          e.saved.recovery = e.saved.raw;
          this.persist(e);
          status();
          return;
        } else {
          e.saved.pending = undefined;
          this.persist(e);
          read = result;
        }
      }
      if (e.saved.submitted) return;
      const local = payload(e.address, e.saved.raw);
      if (e.saved.base?.revision && read.snapshot.revision === null) {
        e.needsRecovery = true;
        e.saved.recovery = e.saved.raw;
        this.persist(e);
        status();
        return;
      }
      const merged = mergeDrafts(
        e.saved.base?.payload ?? EMPTY_DRAFT,
        local,
        read.snapshot.payload,
      );
      if (!draftPayloadEqual(local, merged)) {
        if (editing()) {
          e.remote = read;
          status();
          return;
        }
        this.apply(e, merged);
      }
      e.saved.base = read.snapshot;
      this.persist(e);
      if (draftPayloadEqual(merged, read.snapshot.payload)) {
        if (e.error !== "local") e.error = undefined;
        status();
        return;
      }
      const operation: DraftWrite = {
        slot: e.address.slot,
        baseRevision: read.snapshot.revision,
        ticket: read.ticket,
        operationId: crypto.randomUUID(),
        payload: merged,
        recovery: !draftPayloadEqual(local, merged),
      };
      e.saved.pending = operation;
      this.persist(e);
      const result = await this.post<DraftWriteResult>("write", operation);
      if (this.stopped) return;
      if (result.outcome === "accepted") {
        e.saved.base = result.snapshot;
        this.ackSubmitted(e, result);
        e.saved.pending = undefined;
        this.persist(e);
        if (e.error !== "local") e.error = undefined;
      } else if (result.outcome === "expired") {
        e.needsRecovery = true;
        e.saved.recovery = e.saved.raw;
        status();
      } else {
        e.saved.pending = undefined;
        this.persist(e);
        this.schedule(e, 500);
      }
      // Acknowledgement only covers the immutable captured payload.
      if (!draftPayloadEqual(payload(e.address, e.saved.raw), merged))
        this.schedule(e, 3000);
      status();
    } catch {
      if (!this.stopped) {
        if (e.error !== "local") e.error = "sync";
        status();
        this.schedule(e, 10_000);
      }
    } finally {
      e.running = false;
      e.waitForSync = undefined;
      finishSync();
    }
  }
  private ackSubmitted(e: Entry, result: DraftWriteResult): void {
    const submitted = e.saved.submitted;
    if (
      submitted?.operationId === result.operationId &&
      draftPayloadEqual(result.snapshot.payload, submitted.payload)
    )
      submitted.revision = result.snapshot.revision;
  }
  private apply(e: Entry, p: DraftPayload): void {
    e.saved.raw = encode(e.address, p, e.saved.raw);
    const key = physical(e.key, e.address);
    try {
      if (e.saved.raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, e.saved.raw);
      this.persist(e);
    } catch {
      e.error = "local";
      status();
    }
    notify(e.key);
  }
  accept(e: Entry): void {
    if (e.saved.alternative) {
      const alternative = e.saved.alternative;
      e.saved.alternative = undefined;
      this.apply(
        e,
        mergeDrafts(
          e.saved.base?.payload ?? EMPTY_DRAFT,
          payload(e.address, e.saved.raw),
          alternative,
        ),
      );
    }
    if (e.needsRecovery) {
      if (e.saved.submitted)
        this.apply(
          e,
          mergeDrafts(
            EMPTY_DRAFT,
            payload(e.address, e.saved.raw),
            e.saved.submitted.payload,
          ),
        );
      e.saved.pending = undefined;
      e.saved.base = null;
      e.needsRecovery = false;
      e.saved.submitted = undefined;
      this.persist(e);
    }
    if (e.remote) {
      const remote = e.remote;
      e.remote = undefined;
      this.apply(
        e,
        mergeDrafts(
          e.saved.base?.payload ?? EMPTY_DRAFT,
          payload(e.address, e.saved.raw),
          remote.snapshot.payload,
        ),
      );
      e.saved.base = remote.snapshot;
      this.persist(e);
    }
    if (e.error !== "local") e.error = undefined;
    this.schedule(e, 0);
    status();
  }
  private beginSubmit(e: Entry): void {
    if (e.saved.submitted) return;
    const captured = payload(e.address, e.saved.raw);
    e.saved.submitted = {
      payload: captured,
      revision: draftPayloadEqual(
        e.saved.base?.payload ?? EMPTY_DRAFT,
        captured,
      )
        ? (e.saved.base?.revision ?? null)
        : null,
      operationId: e.saved.pending?.operationId,
    };
    this.persist(e);
    const ongoing = e.waitForSync;
    e.submissionTask = (async () => {
      await ongoing;
      if (!this.stopped) await this.flushSubmitted(e);
    })().finally(() => {
      e.submissionTask = undefined;
      if (!e.saved.submitted) this.schedule(e, 0);
    });
  }
  private async flushSubmitted(e: Entry): Promise<void> {
    const submitted = e.saved.submitted;
    if (!submitted || (this.started && !this.identified)) return;
    try {
      if (e.saved.pending) {
        const pending = e.saved.pending;
        const result = await this.post<DraftWriteResult>("write", pending);
        if (result.outcome !== "accepted") return;
        e.saved.base = result.snapshot;
        e.saved.pending = undefined;
        if (draftPayloadEqual(result.snapshot.payload, submitted.payload))
          submitted.revision = result.snapshot.revision;
      }
      const read = await this.post<DraftRead>("read", { slot: e.address.slot });
      if (
        this.stopped ||
        e.saved.submitted !== submitted ||
        read.snapshot.revision !== (e.saved.base?.revision ?? null)
      )
        return;
      if (draftPayloadEqual(read.snapshot.payload, submitted.payload)) {
        submitted.revision = read.snapshot.revision;
        this.persist(e);
        return;
      }
      const operation: DraftWrite = {
        slot: e.address.slot,
        baseRevision: read.snapshot.revision,
        ticket: read.ticket,
        operationId: crypto.randomUUID(),
        payload: submitted.payload,
      };
      e.saved.pending = operation;
      submitted.operationId = operation.operationId;
      this.persist(e);
      const result = await this.post<DraftWriteResult>("write", operation);
      if (result.outcome === "accepted") {
        submitted.revision = result.snapshot.revision;
        e.saved.base = result.snapshot;
        e.saved.pending = undefined;
        this.persist(e);
      }
    } catch {
      /* The existing send can still succeed. Preserve its recovery copy. */
    }
  }
  async confirm(key: string): Promise<void> {
    const e = this.register(key);
    if (!e) return;
    const submitted = e.saved.submitted;
    const captured = submitted?.payload ?? payload(e.address, e.saved.raw);
    if (!submitted) this.beginSubmit(e);
    // Resolve an in-flight save first; never clear a revision with different content.
    try {
      await e.submissionTask;
      if (e.saved.pending) {
        const result = await this.post<DraftWriteResult>(
          "write",
          e.saved.pending,
        );
        if (result.outcome === "accepted") {
          e.saved.base = result.snapshot;
          if (
            e.saved.submitted?.operationId === result.operationId &&
            draftPayloadEqual(result.snapshot.payload, captured)
          )
            e.saved.submitted.revision = result.snapshot.revision;
          e.saved.pending = undefined;
        }
      }
      const read = await this.post<DraftRead>("read", { slot: e.address.slot });
      if (
        !draftPayloadEqual(read.snapshot.payload, captured) ||
        read.snapshot.revision !== e.saved.submitted?.revision
      )
        return;
      const result = await this.post<DraftWriteResult>("clear", {
        slot: e.address.slot,
        baseRevision: read.snapshot.revision,
        ticket: read.ticket,
        operationId: crypto.randomUUID(),
      });
      if (result.outcome === "accepted") e.saved.base = result.snapshot;
    } catch {
      if (e.error !== "local") e.error = "sync";
      status();
    } finally {
      e.saved.submitted = undefined;
      this.persist(e);
      this.schedule(e, 0);
    }
  }
  resume(key: string): void {
    const e = this.entries.get(key);
    if (e) {
      if (e.saved.submitted) {
        const local = payload(e.address, e.saved.raw);
        this.apply(
          e,
          mergeDrafts(EMPTY_DRAFT, local, e.saved.submitted.payload),
        );
      }
      e.saved.submitted = undefined;
      e.needsRecovery = false;
      this.persist(e);
      this.schedule(e, 0);
    }
  }
  refresh(): Promise<void> {
    if (!this.refreshing)
      this.refreshing = this.refreshNow().finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  private async refreshNow(): Promise<void> {
    if (
      this.stopped ||
      document.visibilityState === "hidden" ||
      this.transport.status.getSnapshot().state !== "ready"
    )
      return;
    try {
      let after = "";
      const sessionIds = new Set<string>();
      const revisions = new Map<string, string>();
      do {
        const result = await this.transport.fetch<{
          entries: Array<{ slot: DraftSlot; revision: string; empty: boolean }>;
          next: string | null;
          owner: string;
          sequence: number;
        }>(`/drafts/index?after=${encodeURIComponent(after)}`, {
          signal: this.abort.signal,
        });
        if (this.stopped) return;
        if (result.owner !== this.owner) {
          this.stop();
          return;
        }
        this.identified = true;
        this.sequence = result.sequence;
        for (const item of result.entries) {
          if (
            item.slot.kind === "session" &&
            item.slot.sessionId &&
            !item.empty
          )
            sessionIds.add(item.slot.sessionId);
          const key = draftLocalKey(this.source, item.slot);
          revisions.set(key, item.revision);
          const e =
            this.entries.get(key) ??
            ([...listeners.keys()].some(
              (k) =>
                k === key ||
                (k.endsWith("*") && key.startsWith(k.slice(0, -1))),
            )
              ? this.register(key)
              : null);
          if (e && e.saved.base?.revision !== item.revision)
            this.schedule(e, 0);
        }
        after = result.next ?? "";
      } while (after && !this.stopped);
      const previous = getSyncedDraftSessionIds(this.source);
      setSyncedDraftSessionIds(this.source, sessionIds);
      for (const sessionId of new Set([...previous, ...sessionIds])) {
        const key = draftLocalKey(this.source, { kind: "session", sessionId });
        const local = this.entries.get(key);
        publishDraftPresenceChange({
          storageKey: key,
          hasContent:
            sessionIds.has(sessionId) ||
            !!(
              local && draftHasContent(payload(local.address, local.saved.raw))
            ),
          sessionDraft: {
            sourceKey: this.source as ClientSummarySourceKey,
            sessionId,
          },
        });
      }
      for (const e of this.entries.values()) {
        if (
          !e.timer &&
          (e.saved.pending ||
            e.saved.base?.revision !== (revisions.get(e.key) ?? null) ||
            !draftPayloadEqual(
              payload(e.address, e.saved.raw),
              e.saved.base?.payload ?? EMPTY_DRAFT,
            ))
        )
          this.schedule(e, 0);
      }
    } catch {
      /* One source retry owner below retries when connected. */
    }
  }
  private async watch(): Promise<void> {
    if (this.stopped) return;
    try {
      if (
        document.visibilityState !== "hidden" &&
        this.transport.status.getSnapshot().state === "ready"
      ) {
        const next = await this.transport.fetch<{ sequence: number }>(
          `/drafts/changes?after=${this.sequence}`,
          { signal: this.abort.signal },
        );
        if (next.sequence !== this.sequence) await this.refresh();
      }
    } catch {
      /* Offline is ordinary; no console loop. */
    }
    if (!this.stopped) this.retry = setTimeout(() => void this.watch(), 1000);
  }
  private wake = () => {
    void this.refresh();
  };
  private storage = (event: StorageEvent) => {
    if (event.key) {
      for (const e of this.entries.values())
        if (physical(e.key, e.address) === event.key) {
          const incoming = payload(e.address, event.newValue);
          const local = payload(e.address, e.saved.raw);
          if (draftPayloadEqual(incoming, local)) return;
          const merged = mergeDrafts(
            e.saved.base?.payload ?? EMPTY_DRAFT,
            local,
            incoming,
          );
          if (editing()) {
            e.saved.alternative = merged;
            this.persist(e);
            status();
          } else {
            this.apply(e, merged);
            this.schedule(e, 0);
          }
        }
    }
  };
  start(): void {
    this.started = true;
    clients.set(this.source, this);
    try {
      for (const key of draftStorage.keys())
        if (draftAddress(key)?.source === this.source) this.register(key);
      const metaPrefix = `draft-sync-v1:${encodeURIComponent(this.source)}:${encodeURIComponent(this.owner)}:`;
      for (let i = 0; i < localStorage.length; i++) {
        const stored = localStorage.key(i);
        if (stored?.startsWith(metaPrefix))
          this.register(decodeURIComponent(stored.slice(metaPrefix.length)));
      }
    } catch {
      /* Observed inputs remain usable in memory without browser storage. */
    }
    for (const key of listeners.keys())
      if (!key.endsWith("*") && draftAddress(key)?.source === this.source)
        this.register(key);
    this.unstatus = this.transport.status.subscribe(this.wake);
    window.addEventListener("focus", this.wake);
    document.addEventListener("visibilitychange", this.wake);
    window.addEventListener("storage", this.storage);
    status();
    void this.refresh();
    void this.watch();
  }
  stop(): void {
    this.stopped = true;
    this.abort.abort();
    if (this.retry) clearTimeout(this.retry);
    for (const e of this.entries.values()) if (e.timer) clearTimeout(e.timer);
    this.unstatus?.();
    window.removeEventListener("focus", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
    window.removeEventListener("storage", this.storage);
    if (clients.get(this.source) === this) clients.delete(this.source);
    status();
  }
}
export function setDraftAccount(source: string, owner: string): void {
  currentSource = source;
  const old = owners.get(source);
  owners.set(source, owner);
  try {
    localStorage.setItem(`draft-owner:${encodeURIComponent(source)}`, owner);
  } catch {}
  if (old !== owner) setSyncedDraftSessionIds(source, new Set());
  if (old !== owner)
    for (const key of listeners.keys())
      if (draftAddress(key)?.source === source) notify(key);
}
export function confirmSyncedDraft(key: string): void {
  const a = draftAddress(key);
  if (a) void clients.get(a.source)?.confirm(key);
}
export function resumeSyncedDraft(key: string): void {
  const a = draftAddress(key);
  if (a) clients.get(a.source)?.resume(key);
}

export const draftPayloadFromStorage = payload;
export const draftPayloadToStorage = encode;
