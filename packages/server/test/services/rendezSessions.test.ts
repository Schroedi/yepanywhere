import { describe, expect, it, vi } from "vitest";
import { createRendezSessions } from "../../src/services/rendezSessions.js";
import {
  MessageQueue,
  Process,
  type SDKMessage,
  type UrlProjectId,
} from "../process.test-support.js";

describe("createRendezSessions", () => {
  it("steers an upload into the owned session's running turn", async () => {
    let resolveIterator!: (result: IteratorResult<SDKMessage>) => void;
    const iterator: AsyncIterator<SDKMessage> = {
      next: () =>
        new Promise((resolve) => {
          resolveIterator = resolve;
        }),
    };
    const queue = new MessageQueue();
    const steerFn = vi.fn(async () => true);
    let alive = true;
    const process = new Process(iterator, {
      projectPath: "/work/project",
      projectId: "proj-1" as UrlProjectId,
      sessionId: "receiver",
      provider: "codex",
      idleTimeoutMs: 1_000_000,
      queue,
      steerFn,
      isProcessAlive: () => alive,
    });
    try {
      // Held to turn end, uploads arrived after the commentary about them,
      // merged into one turn of every upload made during a long turn.
      process.queueMessage({ text: "start the turn" });
      expect(process.state.type).toBe("in-turn");
      const route = await createRendezSessions(() => [process]).route(
        "/work/project",
        {
          harness: "codex",
          providerSessionId: "receiver",
          yaSessionId: "receiver",
        },
      );
      const result = await route.send(
        "upload-1",
        "Please inspect the uploaded file.",
      );

      expect(result.accepted).toBe(true);
      expect(steerFn).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: "upload-1" }),
      );
      expect(process.queueDepth).toBe(0);
    } finally {
      alive = false;
      resolveIterator({ done: true, value: undefined });
      await process.abort();
    }
  });
});
