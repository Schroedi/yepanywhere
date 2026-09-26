import { describe, expect, it } from "vitest";
import { classifyQueuedYaCommand } from "../queued-ya-commands.js";

const rewind = { rewindSupported: true };
const noRewind = { rewindSupported: false };

describe("classifyQueuedYaCommand", () => {
  it("carries a rewind command verbatim", () => {
    expect(
      classifyQueuedYaCommand("/clearloop 3 2: keep going", rewind),
    ).toEqual({
      kind: "queueable",
      command: { name: "clearloop", argument: "3 2: keep going" },
      commandText: "/clearloop 3 2: keep going",
    });
    expect(classifyQueuedYaCommand("/clear 7", rewind)).toEqual({
      kind: "queueable",
      command: { name: "clear", argument: "7" },
      commandText: "/clear 7",
    });
  });

  it("refuses commands that act on the composer, aliases included", () => {
    expect(classifyQueuedYaCommand("/title New name", rewind)).toEqual({
      kind: "composer-only",
      name: "title",
    });
    expect(classifyQueuedYaCommand("/m", rewind)).toEqual({
      kind: "composer-only",
      name: "model",
    });
    expect(classifyQueuedYaCommand("/b an aside", rewind)).toEqual({
      kind: "composer-only",
      name: "btw",
    });
  });

  it("names /fork as not yet queueable rather than running it", () => {
    expect(classifyQueuedYaCommand("/fork 4", rewind)).toEqual({
      kind: "unsupported",
      name: "fork",
    });
  });

  it("queues rewind command names as provider text without rewind support", () => {
    for (const text of ["/clear", "/clear 7", "/fork 4", "/clearloop 2: go"]) {
      expect(classifyQueuedYaCommand(text, noRewind)).toEqual({
        kind: "prompt",
      });
    }
    expect(classifyQueuedYaCommand("/title New name", noRewind)).toEqual({
      kind: "composer-only",
      name: "title",
    });
  });

  it("leaves prose, skill lines, and effort modifiers as prompts", () => {
    for (const text of [
      "just a message",
      "/harsh-review packages/server",
      "/fast do the thing",
      "/run ls -l",
      "line one\n/clear 3",
    ]) {
      expect(classifyQueuedYaCommand(text, rewind)).toEqual({ kind: "prompt" });
    }
  });
});
