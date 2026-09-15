import { describe, expect, it } from "vitest";
import {
  POST_COMPACT_REPLAY_CONTINUE,
  POST_COMPACT_REPLAY_PREAMBLE,
  buildPostCompactReplayText,
  clampPostCompactReplayTurnCount,
  isPostCompactReplayEnabledForProvider,
  isPostCompactReplayText,
  parsePostCompactReplaySettings,
  selectPostCompactReplayTurns,
} from "../src/postCompactReplay.js";
import { projectTranscriptMessages } from "../src/transcript/messageProjection.js";

describe("post-compact replay", () => {
  it("treats N=0 as continue-only", () => {
    const text = buildPostCompactReplayText({
      provider: "claude",
      sessionId: "sess-1",
      turns: [],
    });
    expect(text).toBe(
      `${POST_COMPACT_REPLAY_PREAMBLE}\n\n${POST_COMPACT_REPLAY_CONTINUE}`,
    );
    expect(isPostCompactReplayText(text)).toBe(true);
  });

  it("marks N>0 as a replay in Handoff-from user/assistant format", () => {
    const text = buildPostCompactReplayText({
      provider: "claude",
      sessionId: "abc",
      turns: [
        { role: "user", text: "fix the parser" },
        { role: "assistant", text: "I patched parse.ts." },
      ],
    });
    expect(text.startsWith(POST_COMPACT_REPLAY_PREAMBLE)).toBe(true);
    expect(text).toContain(
      "this is a replay of the last 2 user/assistant prose turns, not a new request:",
    );
    expect(text).toContain("user: fix the parser");
    expect(text).toContain("I patched parse.ts.");
    expect(text.endsWith(POST_COMPACT_REPLAY_CONTINUE)).toBe(true);
    expect(text).toContain("see claude session abc if needed");
  });

  it("selects the last N prose turns and skips a prior replay", () => {
    const selected = selectPostCompactReplayTurns(
      [
        { role: "user", text: "old" },
        { role: "assistant", text: "old answer" },
        { role: "user", text: "new" },
        {
          role: "user",
          text: `${POST_COMPACT_REPLAY_PREAMBLE}\n\ncontinue.`,
        },
        { role: "assistant", text: "new answer" },
      ],
      3,
    );
    expect(selected).toEqual([
      { role: "assistant", text: "old answer" },
      { role: "user", text: "new" },
      { role: "assistant", text: "new answer" },
    ]);
  });

  it("parses per-provider checkboxes and rejects unknown providers", () => {
    expect(
      parsePostCompactReplaySettings({
        providers: { claude: true, codex: false },
        replayTurnCount: 4,
      }),
    ).toEqual({
      providers: { claude: true },
      replayTurnCount: 4,
    });
    expect(
      parsePostCompactReplaySettings({
        providers: { nope: true },
      }),
    ).toBeNull();
    expect(clampPostCompactReplayTurnCount(99)).toBe(20);
    expect(
      isPostCompactReplayEnabledForProvider(
        { providers: { claude: true } },
        "claude",
      ),
    ).toBe(true);
    expect(
      isPostCompactReplayEnabledForProvider(
        { providers: { claude: true } },
        "codex",
      ),
    ).toBe(false);
  });

  it("hides persisted replay user rows from transcript projection", () => {
    const items = projectTranscriptMessages([
      {
        type: "user",
        uuid: "replay",
        message: {
          role: "user",
          content: `${POST_COMPACT_REPLAY_PREAMBLE}\n\n${POST_COMPACT_REPLAY_CONTINUE}`,
        },
      },
      {
        type: "assistant",
        uuid: "answer",
        message: { role: "assistant", content: "Working." },
      },
    ]);
    expect(items.some((item) => item.type === "user_prompt")).toBe(false);
    expect(
      items.some(
        (item) => item.type === "text" && item.text.includes("Working."),
      ),
    ).toBe(true);
  });
});
