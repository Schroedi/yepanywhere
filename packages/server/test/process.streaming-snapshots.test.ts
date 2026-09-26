import { expect, it } from "vitest";
import { createSessionSubscription } from "../src/subscriptions.js";
import {
  Process,
  createControllableIterator,
  waitFor,
  type SDKMessage,
  type UrlProjectId,
} from "./process.test-support.js";

it("keeps one current snapshot for late subscribers and clears it on completion", async () => {
  const controller = createControllableIterator();
  const process = new Process(controller.iterator, {
    projectPath: "/test",
    projectId: "proj-1" as UrlProjectId,
    sessionId: "sess-1",
    provider: "codex",
    idleTimeoutMs: 100,
  });
  const subscriptions = [
    createSessionSubscription(process, () => {}),
    createSessionSubscription(process, () => {}),
  ];
  try {
    for (const content of ["I’ll", "I’ll open", "I’ll open a Clair sketch."]) {
      controller.push({
        type: "assistant",
        uuid: "commentary",
        _isStreaming: true,
        message: { role: "assistant", content },
      } as SDKMessage);
      await waitFor(() =>
        expect(process.getStreamingContent()).toEqual({
          messageId: "commentary",
          text: content,
        }),
      );
    }
    controller.push({
      type: "assistant",
      uuid: "commentary",
      message: { role: "assistant", content: "I’ll open a Clair sketch." },
    } as SDKMessage);
    await waitFor(() => expect(process.getStreamingContent()).toBeNull());
  } finally {
    for (const subscription of subscriptions) subscription.cleanup();
    controller.finish();
    await process.abort();
  }
});
