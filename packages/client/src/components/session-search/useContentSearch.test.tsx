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
    await vi.advanceTimersByTimeAsync(120);
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
  });
  expect(result.current.matches.get("session")).toEqual([match]);
  expect(result.current.running).toBe(false);
  const options = runtime.transport.fetch.mock.calls.at(-1)![1];
  unmount();
  expect(options.signal.aborted).toBe(true);
});
