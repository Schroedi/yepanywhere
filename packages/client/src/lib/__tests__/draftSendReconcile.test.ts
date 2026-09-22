import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import { draftTextIsAccountedFor } from "../draftSendReconcile";

function durableUserTurn(text: string): Message {
  return {
    uuid: `durable-${text}`,
    type: "user",
    _source: "jsonl",
    message: { role: "user", content: text },
  };
}

function optimisticSelfEcho(text: string): Message {
  return {
    uuid: `echo-${text}`,
    type: "user",
    _source: "sdk",
    tempId: `temp-${text}`,
    message: { role: "user", content: text },
  };
}

describe("draftTextIsAccountedFor", () => {
  it("matches a durable user turn in the transcript tail", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "run the tests",
        messages: [
          durableUserTurn("earlier"),
          durableUserTurn("run the tests"),
        ],
      }),
    ).toBe(true);
  });

  it("ignores leading and trailing whitespace differences", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "  run the tests\n",
        messages: [durableUserTurn("run the tests")],
      }),
    ).toBe(true);
  });

  it("matches a durable turn carrying server-injected turn markers", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "run the tests",
        messages: [durableUserTurn("(12s ago) run the tests")],
      }),
    ).toBe(true);
  });

  it("matches a message the server holds queued", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "run the tests",
        messages: [],
        deferredMessages: [{ content: "run the tests" }],
      }),
    ).toBe(true);
  });

  it("does not accept an optimistic self-send echo as proof", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "run the tests",
        messages: [optimisticSelfEcho("run the tests")],
      }),
    ).toBe(false);
  });

  it("does not match a turn the user only partly reused", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "run the tests again",
        messages: [durableUserTurn("run the tests")],
      }),
    ).toBe(false);
  });

  it("does not match assistant text", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "run the tests",
        messages: [
          {
            uuid: "assistant-1",
            type: "assistant",
            _source: "jsonl",
            message: { role: "assistant", content: "run the tests" },
          },
        ],
      }),
    ).toBe(false);
  });

  it("treats an empty draft as unaccounted for", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "   ",
        messages: [durableUserTurn("   ")],
      }),
    ).toBe(false);
  });

  it("finds the sent prompt behind a long tool-heavy reply", () => {
    const messages: Message[] = [
      durableUserTurn("run the tests"),
      ...Array.from(
        { length: 80 },
        (_, index): Message => ({
          uuid: `result-${index}`,
          type: "user",
          _source: "jsonl",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: `tool-${index}`,
                content: "ok",
              },
            ],
          },
        }),
      ),
    ];
    expect(
      draftTextIsAccountedFor({ draftText: "run the tests", messages }),
    ).toBe(true);
  });

  it("only scans a bounded number of user prompts", () => {
    const messages = [
      durableUserTurn("run the tests"),
      ...Array.from({ length: 80 }, (_, index) =>
        durableUserTurn(`filler ${index}`),
      ),
    ];
    expect(
      draftTextIsAccountedFor({ draftText: "run the tests", messages }),
    ).toBe(false);
  });
});
