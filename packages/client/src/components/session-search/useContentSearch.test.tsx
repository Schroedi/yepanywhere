// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionContentSearchBatch } from "@yep-anywhere/shared";
import type { GlobalSessionItem } from "../../api/client";
import { useContentSearch } from "./useContentSearch";

const runtime = vi.hoisted(() => ({
  sourceKey: "search-test",
  transport: { fetch: vi.fn() },
}));
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
beforeEach(() => {
  vi.useFakeTimers();
  runtime.transport.fetch.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("defers hidden-page catch-up and resumes retained cursors on visibility", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("visible");
  const match = { id: "turn", role: "user", ordinal: 1, preview: "needle" };
  runtime.transport.fetch.mockResolvedValue({
    matches: [match],
    done: true,
    partial: false,
    bytesRead: 20,
    resumeCursor: "tail",
  });
  const session = { id: "a", updatedAt: "1" } as GlobalSessionItem;
  const { result, rerender } = renderHook(
    ({ session }) => useContentSearch([session], "needle", ["user"], true),
    { initialProps: { session } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(runtime.transport.fetch).toHaveBeenCalledTimes(1);
  act(() => {
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  rerender({ session: { ...session, updatedAt: "2" } });
  rerender({ session: { ...session, updatedAt: "3" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(runtime.transport.fetch).toHaveBeenCalledTimes(1);
  expect(result.current.matches.get("a")).toEqual([match]);
  act(() => {
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(runtime.transport.fetch).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(runtime.transport.fetch.mock.calls[1]![1].body).cursor,
  ).toBe("tail");
});

it("coalesces queued needles and keeps only two query generations", async () => {
  const session = { id: "a", updatedAt: "1" } as GlobalSessionItem;
  runtime.transport.fetch.mockImplementation(() => new Promise(() => {}));
  const { rerender, unmount } = renderHook(
    ({ query }) => useContentSearch([session], query, ["user"], true),
    { initialProps: { query: "9" } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  rerender({ query: "98" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  rerender({ query: "987" });
  rerender({ query: "9876" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  const requests = runtime.transport.fetch.mock.calls.map(([, options]) => ({
    query: JSON.parse(options.body).query,
    aborted: options.signal.aborted,
  }));
  expect(requests).toEqual([
    { query: "9", aborted: false },
    { query: "98", aborted: true },
    { query: "9876", aborted: false },
  ]);
  unmount();
});

it("keeps discovered matches through empty revalidation batches after metadata changes", async () => {
  const match = {
    id: "turn",
    role: "user" as const,
    ordinal: 1,
    preview: "needle in turn",
  };
  const done: SessionContentSearchBatch = {
    matches: [match],
    done: true,
    partial: false,
    bytesRead: 20,
  };
  runtime.transport.fetch.mockResolvedValueOnce(done);
  const session = {
    id: "session",
    updatedAt: "2026-09-14T00:00:00Z",
  } as GlobalSessionItem;
  const { result, rerender, unmount } = renderHook(
    ({ sessions }) => useContentSearch(sessions, "needle", ["user"], true),
    { initialProps: { sessions: [session] } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(result.current.matches.get("session")).toEqual([match]);
  expect(result.current.running).toBe(false);

  let finish!: (batch: SessionContentSearchBatch) => void;
  runtime.transport.fetch.mockResolvedValueOnce({
    matches: [],
    done: false,
    cursor: "next",
    partial: false,
    bytesRead: 20,
  });
  runtime.transport.fetch.mockImplementationOnce(
    () =>
      new Promise<SessionContentSearchBatch>((resolve) => {
        finish = resolve;
      }),
  );
  rerender({ sessions: [{ ...session, updatedAt: "2026-09-14T01:00:00Z" }] });
  expect(result.current.matches.get("session")).toEqual([match]);
  expect(result.current.running).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120);
  });
  expect(result.current.matches.get("session")).toEqual([match]);
  expect(result.current.running).toBe(true);
  await act(async () => {
    finish(done);
    await vi.advanceTimersByTimeAsync(40);
  });
  expect(result.current.matches.get("session")).toEqual([match]);
  expect(result.current.running).toBe(false);
  const options = runtime.transport.fetch.mock.calls.at(-1)![1];
  unmount();
  expect(options.signal.aborted).toBe(true);
});
