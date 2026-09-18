import { describe, expect, it } from "vitest";
import { collectVisibleClaudeEntries } from "../../src/sessions/claude-messages.js";

// Fixture rows are intentionally partial. The collector reads uuid,
// parentUuid, type/subtype, line order, and a small number of compaction flags.
// biome-ignore lint/suspicious/noExplicitAny: loose fixture rows by design
type RawSessionMessage = any;

describe("collectVisibleClaudeEntries", () => {
  it("keeps metadata-only compact boundaries on the active transcript", () => {
    const messages: RawSessionMessage[] = [
      { type: "user", uuid: "root", parentUuid: null },
      { type: "assistant", uuid: "tail", parentUuid: "root" },
      {
        type: "system",
        subtype: "compact_boundary",
        uuid: "compact",
        parentUuid: null,
        content: "Conversation compacted",
        compactMetadata: {
          trigger: "manual",
          preTokens: 345417,
          preservedSegment: { tailUuid: "tail" },
        },
      },
      {
        type: "user",
        uuid: "summary",
        parentUuid: "compact",
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
        message: { content: "Summary of previous context" },
      },
      {
        type: "user",
        uuid: "caveat",
        parentUuid: "tail",
        isMeta: true,
        message: {
          content: "<local-command-caveat>Caveat</local-command-caveat>",
        },
      },
      {
        type: "user",
        uuid: "command",
        parentUuid: "caveat",
        message: {
          content:
            "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>",
        },
      },
      { type: "assistant", uuid: "reply", parentUuid: "command" },
    ];

    const { entries } = collectVisibleClaudeEntries(messages);

    expect(entries.map((entry) => entry.uuid)).toEqual([
      "root",
      "tail",
      "compact",
      "summary",
      "caveat",
      "command",
      "reply",
    ]);
  });
});

describe("collectVisibleClaudeEntries with rewind records", () => {
  const messages: RawSessionMessage[] = [
    {
      type: "user",
      uuid: "u1",
      parentUuid: null,
      timestamp: "2026-09-18T10:00:00.000Z",
    },
    {
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      timestamp: "2026-09-18T10:00:05.000Z",
    },
    {
      type: "user",
      uuid: "u2",
      parentUuid: "a1",
      timestamp: "2026-09-18T10:01:00.000Z",
    },
    {
      type: "assistant",
      uuid: "a2",
      parentUuid: "u2",
      timestamp: "2026-09-18T10:01:05.000Z",
    },
  ];
  const record = {
    id: "rw-1",
    at: "2026-09-18T10:02:00.000Z",
    cutMessageId: "a1",
    cutTurnIndex: 1,
    droppedFromMessageId: "u2",
    droppedTurnCount: 1,
    reason: "clear" as const,
  };

  it("keeps the cut as the tail and groups the dropped rows after it", () => {
    const { entries } = collectVisibleClaudeEntries(messages, {
      rewindRecords: [record],
    });
    const uuids = entries.map((entry) => (entry as { uuid?: string }).uuid);
    expect(uuids).toEqual(["u1", "a1", "rewound-group-rw-1", "u2", "a2"]);
    const grouped = entries.filter(
      (entry) =>
        (entry as { rewoundGroupId?: string }).rewoundGroupId === "rw-1",
    );
    expect(grouped.map((entry) => (entry as { uuid?: string }).uuid)).toEqual([
      "rewound-group-rw-1",
      "u2",
      "a2",
    ]);
    const header = entries[2] as {
      subtype?: string;
      rewoundGroup?: { droppedTurnCount: number; cutTurnIndex: number };
    };
    expect(header.subtype).toBe("rewound_group");
    expect(header.rewoundGroup).toMatchObject({
      droppedTurnCount: 1,
      cutTurnIndex: 1,
    });
  });

  it("treats rows written after the rewind as the live continuation", () => {
    const continued: RawSessionMessage[] = [
      ...messages,
      {
        type: "user",
        uuid: "u3",
        parentUuid: "a1",
        timestamp: "2026-09-18T10:03:00.000Z",
      },
      {
        type: "assistant",
        uuid: "a3",
        parentUuid: "u3",
        timestamp: "2026-09-18T10:03:05.000Z",
      },
    ];
    const { entries } = collectVisibleClaudeEntries(continued, {
      rewindRecords: [record],
    });
    const uuids = entries.map((entry) => (entry as { uuid?: string }).uuid);
    expect(uuids).toEqual([
      "u1",
      "a1",
      "rewound-group-rw-1",
      "u2",
      "a2",
      "u3",
      "a3",
    ]);
    const live = entries.filter(
      (entry) => !(entry as { rewoundGroupId?: string }).rewoundGroupId,
    );
    expect(live.map((entry) => (entry as { uuid?: string }).uuid)).toEqual([
      "u1",
      "a1",
      "u3",
      "a3",
    ]);
  });

  it("changes nothing without records", () => {
    const { entries } = collectVisibleClaudeEntries(messages);
    expect(entries.map((entry) => (entry as { uuid?: string }).uuid)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
    ]);
  });
});
