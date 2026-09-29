import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_DRAFT,
  type DraftRead,
  type DraftWrite,
  type DraftWriteResult,
} from "@yep-anywhere/shared";
import {
  DraftSyncClient,
  draftAddress,
  draftPayloadFromStorage,
  draftPayloadToStorage,
  draftStorage,
  setDraftAccount,
} from "../draftSyncStorage";
import type { SourceTransport } from "../transport/types";
const key = "draft-new-session:local";
const raw = (text: string) => JSON.stringify({ version: 1, text });
function server(owner = "") {
  let current: DraftRead = {
    snapshot: {
      slot: { kind: "new-session" },
      revision: null,
      sequence: 0,
      payload: EMPTY_DRAFT,
      updatedAt: 0,
    },
    ticket: "ticket",
  };
  let next = 0;
  const receipts = new Map<string, DraftWriteResult>();
  let hold:
    | ((value: DraftWriteResult) => Promise<DraftWriteResult>)
    | undefined;
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/drafts/index"))
      return { owner, entries: [], next: null, sequence: next };
    if (path.startsWith("/drafts/changes")) return { sequence: next };
    if (path.endsWith("/read")) return structuredClone(current);
    if (path.endsWith("/write") || path.endsWith("/clear")) {
      const op = JSON.parse(String(init?.body)) as DraftWrite;
      const prior = receipts.get(op.operationId);
      if (prior) return structuredClone(prior);
      if (op.baseRevision !== current.snapshot.revision)
        return {
          ...structuredClone(current),
          outcome: "conflict",
          operationId: op.operationId,
        };
      current = {
        snapshot: {
          ...current.snapshot,
          revision: `rev-${++next}`,
          sequence: next,
          payload: path.endsWith("/clear") ? EMPTY_DRAFT : op.payload,
        },
        ticket: "ticket",
      };
      const result: DraftWriteResult = {
        ...structuredClone(current),
        outcome: "accepted",
        operationId: op.operationId,
      };
      receipts.set(op.operationId, result);
      return hold ? await hold(result) : result;
    }
    throw new Error(`Unexpected request ${path}`);
  });
  const transport = {
    fetch,
    status: {
      getSnapshot: () => ({ state: "ready" }),
      subscribe: () => () => {},
    },
  } as unknown as SourceTransport;
  return {
    transport,
    fetch,
    get: () => current.snapshot,
    remote: (text: string) => {
      current = {
        snapshot: {
          ...current.snapshot,
          revision: `rev-${++next}`,
          sequence: next,
          payload: { fields: { text }, attachments: [] },
        },
        ticket: "ticket",
      };
    },
    hold: (fn: typeof hold) => {
      hold = fn;
    },
  };
}
const clients: DraftSyncClient[] = [];
beforeEach(() => {
  localStorage.clear();
  setDraftAccount("local", "");
  vi.useFakeTimers();
});
afterEach(() => {
  for (const client of clients) client.stop();
  clients.length = 0;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function client(s: ReturnType<typeof server>) {
  const c = new DraftSyncClient("local", "", s.transport);
  clients.push(c);
  return c;
}
describe("local-first snapshot synchronization", () => {
  it("keeps edits made while a save waits for its acknowledgement", async () => {
    const s = server(),
      c = client(s);
    let release!: (v: DraftWriteResult) => void;
    let accepted!: DraftWriteResult;
    s.hold((v) => {
      accepted = v;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    c.edit(key, raw("Hello"));
    const e = c.register(key)!;
    const saving = c.sync(e);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    c.edit(key, raw("Hello there"));
    release(accepted);
    await saving;
    expect(e.saved.raw).toBe(raw("Hello there"));
    expect(e.saved.base?.payload.fields.text).toBe("Hello");
    s.hold(undefined);
    await c.sync(e);
    expect(s.get().payload.fields.text).toBe("Hello there");
  });
  it("retries the same operation after a lost response without duplicating a merge", async () => {
    const s = server(),
      c = client(s);
    s.remote("phone");
    c.edit(key, raw("desktop"));
    const e = c.register(key)!;
    s.hold(async () => {
      throw new Error("lost response");
    });
    await c.sync(e);
    const operation = e.saved.pending?.operationId;
    expect(operation).toBeTruthy();
    s.hold(undefined);
    await c.sync(e);
    expect(s.get().payload.fields.text).toBe("phone\n\ndesktop");
    expect(e.saved.pending).toBeUndefined();
    const writes = s.fetch.mock.calls.filter(([path]) =>
      path.endsWith("/write"),
    );
    expect(JSON.parse(String(writes[0]?.[1]?.body)).operationId).toBe(
      JSON.parse(String(writes[1]?.[1]?.body)).operationId,
    );
  });
  it("holds remote text while typing, then combines only on explicit acceptance", async () => {
    const s = server(),
      c = client(s);
    c.edit(key, raw("desktop"));
    const e = c.register(key)!;
    const input = document.createElement("textarea");
    document.body.append(input);
    input.value = "desktop";
    input.focus();
    input.setSelectionRange(3, 3);
    s.remote("phone");
    await c.sync(e);
    expect(e.saved.raw).toBe(raw("desktop"));
    expect(input.selectionStart).toBe(3);
    expect(e.remote).toBeDefined();
    input.blur();
    c.accept(e);
    await c.sync(e);
    expect(s.get().payload.fields.text).toBe("phone\n\ndesktop");
  });
  it("conditionally clears a submitted revision but keeps the next local draft", async () => {
    const s = server(),
      c = client(s);
    c.edit(key, raw("first"));
    const e = c.register(key)!;
    await c.sync(e);
    c.edit(
      key,
      JSON.stringify({ version: 1, text: "first", pendingSendAt: Date.now() }),
    );
    c.edit(key, raw("second"));
    await c.confirm(key);
    await c.sync(e);
    expect(s.get().payload.fields.text).toBe("second");
    expect(e.saved.raw).toBe(raw("second"));
  });
  it("preserves an offline edit when another device clears its base", async () => {
    const s = server(),
      c = client(s);
    c.edit(key, raw("base"));
    const e = c.register(key)!;
    await c.sync(e);
    c.edit(key, raw("new offline text"));
    s.remote("");
    await c.sync(e);
    expect(s.get().payload.fields.text).toBe("new offline text");
  });
  it("separates account caches without importing the operator's legacy text", () => {
    localStorage.setItem(key, raw("operator"));
    setDraftAccount("local", "alice");
    expect(draftStorage.getItem(key)).toBeNull();
    draftStorage.setItem(key, raw("alice"));
    setDraftAccount("local", "");
    expect(draftStorage.getItem(key)).toBe(raw("operator"));
  });
  it("waits for autosave before flushing a submitted snapshot", async () => {
    const s = server(),
      c = client(s);
    let release!: (v: DraftWriteResult) => void;
    let accepted!: DraftWriteResult;
    s.hold((v) => {
      accepted = v;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    c.edit(key, raw("first"));
    const e = c.register(key)!;
    const saving = c.sync(e);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    c.edit(
      key,
      JSON.stringify({ version: 1, text: "first", pendingSendAt: Date.now() }),
    );
    const clearing = c.confirm(key);
    expect(
      s.fetch.mock.calls.filter(([path]) => path.endsWith("/write")),
    ).toHaveLength(1);
    s.hold(undefined);
    release(accepted);
    await saving;
    await clearing;
    expect(s.get().payload).toEqual(EMPTY_DRAFT);
  });
  it("does not clear a newer revision from another device", async () => {
    const s = server(),
      c = client(s);
    c.edit(key, raw("first"));
    const e = c.register(key)!;
    await c.sync(e);
    c.edit(
      key,
      JSON.stringify({ version: 1, text: "first", pendingSendAt: Date.now() }),
    );
    s.remote("other device's next draft");
    await c.confirm(key);
    expect(s.get().payload.fields.text).toBe("other device's next draft");
  });
  it("keeps a sibling tab's update pending while typing", async () => {
    const s = server(),
      c = client(s);
    localStorage.setItem(key, raw("own typing"));
    c.start();
    await c.refresh();
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();
    localStorage.setItem(key, raw("sibling typing"));
    window.dispatchEvent(
      new StorageEvent("storage", { key, newValue: raw("sibling typing") }),
    );
    const e = c.register(key)!;
    expect(draftStorage.getItem(key)).toBe(raw("own typing"));
    expect(e.saved.alternative?.fields.text).toContain("sibling typing");
    c.accept(e);
    await c.sync(e);
    expect(s.get().payload.fields.text).toContain("own typing");
    expect(s.get().payload.fields.text).toContain("sibling typing");
  });
  it("refuses to sync when the server's acting account differs from the client", async () => {
    const s = server("alice"),
      c = client(s);
    localStorage.setItem(key, raw("operator"));
    c.start();
    await c.refresh();
    await vi.advanceTimersByTimeAsync(4000);
    expect(
      s.fetch.mock.calls.some(
        ([path]) => path.endsWith("/read") || path.endsWith("/write"),
      ),
    ).toBe(false);
  });
  it("retains in-memory text and reports unavailable browser storage", async () => {
    const s = server(),
      c = client(s);
    const e = c.register(key)!;
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    expect(() => c.edit(key, raw("still here"))).not.toThrow();
    await c.sync(e);
    expect(e.saved.raw).toBe(raw("still here"));
    expect(e.error).toBe("local");
    expect(s.get().payload.fields.text).toBe("still here");
  });
  it("round-trips question fields, comment anchors and multi-batch attachments", () => {
    const address = draftAddress("session-file-comments:local:s:p:file.ts")!;
    const original = JSON.stringify([
      {
        id: "a",
        text: "comment",
        location: "line",
        quote: "code",
        afterLine: 3,
      },
    ]);
    expect(
      JSON.parse(
        draftPayloadToStorage(
          address,
          draftPayloadFromStorage(address, original),
          original,
        )!,
      ),
    ).toEqual(JSON.parse(original));
    setDraftAccount("host:abc", "");
    expect(
      draftAddress("yep-async-questions:host:abc:session:message:question")
        ?.slot,
    ).toEqual({
      kind: "async-question",
      sessionId: "session",
      field: "message:question",
    });
  });
});
