import { afterEach, expect, it, vi } from "vitest";
import { ContentSearchScan } from "./ContentSearchScan";

afterEach(() => vi.useRealTimers());
const hit = {
  id: "old",
  role: "user" as const,
  ordinal: 1,
  preview: "needle old",
};
const done = {
  matches: [hit],
  done: true,
  partial: false,
  bytesRead: 1,
  resumeCursor: "tail",
};

it("aborts hidden work without losing its cursor or accepting a late response", async () => {
  vi.useFakeTimers();
  let finish!: (value: typeof done) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(done)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(done);
  const scan = new ContentSearchScan(
    "needle",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  scan.update(new Map([["a", "1"]]));
  await vi.advanceTimersByTimeAsync(32);
  scan.update(new Map([["a", "2"]]));
  await vi.advanceTimersByTimeAsync(32);
  scan.setInterested(false);
  expect(fetch.mock.calls[1]![1].signal.aborted).toBe(true);
  scan.update(new Map([["a", "3"]]));
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(2);
  scan.setInterested(true);
  finish({ ...done, matches: [{ ...hit, id: "stale" }] });
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(scan.entries.get("a")?.matches).toEqual([hit]);
  expect(
    fetch.mock.calls
      .slice(2)
      .every(([, options]) => JSON.parse(options.body).cursor === "tail"),
  ).toBe(true);
  expect(scan.entries.get("a")?.done).toBe(true);
  scan.stop();
});

it("resumes only changed sessions, adds new sessions, and excludes filtered IDs before traversal", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(done);
  const scan = new ContentSearchScan(
    "needle",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  scan.update(
    new Map([
      ["a", "1"],
      ["b", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(32);
  expect(fetch).toHaveBeenCalledTimes(2);
  scan.update(
    new Map([
      ["b", "1"],
      ["a", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValue({ ...done, matches: [{ ...hit, id: "new" }] });
  scan.update(
    new Map([
      ["a", "2"],
      ["c", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(32);
  const requests = fetch.mock.calls
    .slice(2)
    .map(([, options]) => JSON.parse(options.body));
  expect(requests).toEqual([
    { sessionId: "a", query: "needle", roles: ["user"], cursor: "tail" },
    { sessionId: "c", query: "needle", roles: ["user"] },
  ]);
  expect(scan.entries.get("a")?.matches.map((m) => m.id)).toEqual([
    "old",
    "new",
  ]);
  fetch.mockResolvedValue({ ...done, matches: [], replacedIds: ["old"] });
  scan.update(new Map([["a", "3"]]));
  await vi.advanceTimersByTimeAsync(32);
  expect(scan.entries.get("a")?.matches.map((m) => m.id)).toEqual(["new"]);
  scan.stop();
});

it("interleaves batches and continues after an unavailable session", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ...done,
      done: false,
      cursor: "next",
      resumeCursor: undefined,
    })
    .mockRejectedValueOnce(
      Object.assign(new Error("Project unavailable"), { status: 404 }),
    )
    .mockResolvedValueOnce(done)
    .mockResolvedValueOnce(done);
  const scan = new ContentSearchScan(
    "needle",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  scan.update(
    new Map([
      ["large", "1"],
      ["missing", "1"],
      ["target", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(32);
  expect(
    fetch.mock.calls.map(([, options]) => JSON.parse(options.body).sessionId),
  ).toEqual(["large", "missing", "target", "large"]);
  expect(scan.entries.get("missing")?.partial).toBe("Project unavailable");
  expect(scan.entries.get("target")?.matches).toEqual([hit]);
  scan.stop();
});

it("does not restart in-flight traversal when another session changes or the set narrows", async () => {
  vi.useFakeTimers();
  let finish!: (value: typeof done) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(done);
  const scan = new ContentSearchScan(
    "needle",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  scan.update(
    new Map([
      ["a", "1"],
      ["b", "1"],
      ["excluded", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(32);
  scan.update(
    new Map([
      ["a", "1"],
      ["b", "2"],
    ]),
  );
  finish(done);
  await vi.advanceTimersByTimeAsync(32);
  expect(
    fetch.mock.calls.map(([, options]) => JSON.parse(options.body).sessionId),
  ).toEqual(["a", "b"]);
  scan.stop();
});
