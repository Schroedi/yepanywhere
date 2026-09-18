import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import {
  getSessionTurnIndex,
  providerSupportsSessionRewind,
} from "../sessionRewind";

function userTurn(uuid: string, extra: Record<string, unknown> = {}): Message {
  return {
    type: "user",
    uuid,
    message: { role: "user", content: `prompt ${uuid}` },
    ...extra,
  } as unknown as Message;
}

function assistantTurn(uuid: string): Message {
  return {
    type: "assistant",
    uuid,
    message: { role: "assistant", content: "reply" },
  } as unknown as Message;
}

describe("getSessionTurnIndex", () => {
  it("numbers live user turns and skips rewound, subagent, and synthetic rows", () => {
    const index = getSessionTurnIndex([
      userTurn("u1"),
      assistantTurn("a1"),
      userTurn("u2"),
      assistantTurn("a2"),
      userTurn("dropped", { rewoundGroupId: "rw-1" }),
      userTurn("sub", { isSubagent: true }),
      userTurn("syn", { isSynthetic: true }),
      userTurn("u3"),
    ]);
    // Full-sequence numbering: the cleared turn keeps its ordinal and is
    // marked cleared; subagent and synthetic rows are not turns.
    expect([...index.idByIndex.entries()]).toEqual([
      [1, "u1"],
      [2, "u2"],
      [3, "dropped"],
      [4, "u3"],
    ]);
    expect(index.indexById.get("u3")).toBe(4);
    expect(index.clearedIds.has("dropped")).toBe(true);
    expect(index.lastIndex).toBe(4);
  });
});

describe("providerSupportsSessionRewind", () => {
  it("accepts only Claude-family providers", () => {
    expect(providerSupportsSessionRewind("claude")).toBe(true);
    expect(providerSupportsSessionRewind("claude-gateway")).toBe(true);
    expect(providerSupportsSessionRewind("codex")).toBe(false);
    expect(providerSupportsSessionRewind(undefined)).toBe(false);
  });
});
