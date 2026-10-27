import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Process } from "../../src/supervisor/Process.js";
import { tryRestartCompact } from "../../src/supervisor/restart-compaction.js";
import type { ProcessEvent } from "../../src/supervisor/types.js";

const boundary: ProcessEvent = {
  type: "message",
  message: { type: "system", subtype: "compact_boundary" },
};

function controlledProcess() {
  const listeners = new Set<Parameters<Process["subscribe"]>[0]>();
  const emit = (event: ProcessEvent) => {
    for (const listener of listeners) listener(event);
  };
  const target = {
    state: { type: "idle", since: new Date(0) },
    supportsDynamicCommands: true,
    supportedCommands: vi.fn(async () => [
      { name: "compress", description: "Compress" },
      { name: "compact", description: "Compact" },
    ]),
    queueMessage: vi.fn<Process["queueMessage"]>(() => ({ success: true })),
    subscribe: (listener: Parameters<Process["subscribe"]>[0]) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies Pick<
    Process,
    | "state"
    | "supportsDynamicCommands"
    | "supportedCommands"
    | "queueMessage"
    | "subscribe"
  >;
  return { target, process: target as unknown as Process, listeners, emit };
}

describe("restart compaction", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("observes a boundary emitted during dispatch and prefers compact", async () => {
    const { target, process, emit, listeners } = controlledProcess();
    target.queueMessage.mockImplementation(() => {
      emit(boundary);
      return { success: true };
    });

    await expect(tryRestartCompact(process)).resolves.toEqual({
      status: "completed",
      command: "compact",
    });
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["boundary", "error", "terminated", "deadline"] as const)(
    "waits for a boundary rather than an ordinary completion: %s",
    async (ending) => {
      const { process, emit, listeners } = controlledProcess();
      const attempt = tryRestartCompact(process);
      let settled = false;
      void attempt.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      emit({ type: "complete" });
      emit({
        type: "message",
        message: {
          type: "system",
          subtype: "status",
          compact_result: "success",
        },
      });
      await vi.advanceTimersByTimeAsync(11_999);
      expect(settled).toBe(false);

      if (ending === "deadline") await vi.advanceTimersByTimeAsync(1);
      else if (ending === "boundary") emit(boundary);
      else if (ending === "error")
        emit({ type: "error", error: new Error("lost") });
      else emit({ type: "terminated", reason: "stopped" });

      await expect(attempt).resolves.toEqual({
        status: ending === "boundary" ? "completed" : "timed-out",
        command: "compact",
      });
      expect(listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
