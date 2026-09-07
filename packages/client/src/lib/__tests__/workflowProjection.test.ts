import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import { compileTranscriptProjection } from "../transcriptProjection/compiler";
import {
  assistant,
  call,
  result,
  publishSchema,
  simulatedInline,
  simulatedNestedTool,
  simulatedPublish,
} from "../../../test-fixtures/workflow";
import { buildSessionDetailRenderItems } from "../sessionDetail/renderItems";

describe("workflow tag projection", () => {
  it.each(["inherited", "self-announced", "matching-lines"] as const)(
    "nests %s script tags without replacing the outer workflow",
    (mode) => {
      const messages = simulatedNestedTool(mode);
      const compile = (input: Message[]) =>
        buildSessionDetailRenderItems({
          messages: input,
          workflowTagsEnabled: true,
        });
      const items = compile(messages);
      const script = items.find((item) => item.id === "nested-script");
      const stages = script?.workflow?.markers.filter(
        (marker) => marker.kind === "stage",
      );
      expect(stages?.map((marker) => marker.path)).toEqual([
        "[publish][client][build][types]",
        "[publish][client][copy]",
      ]);
      expect(stages?.[0]?.title).toBe(
        mode === "inherited"
          ? "Publish YA › Publish the hosted client › Build the remote client › Check client types"
          : "Publish YA › Publish the hosted client › build › types",
      );
      expect(
        items.find((item) => item.id === "after-script")?.workflow?.parent
          ?.path,
      ).toBe("[publish][source]");
      expect(items.at(-1)?.workflow?.markers[0]?.kind).toBe("end");
      expect(compile(JSON.parse(JSON.stringify(messages)))).toEqual(items);
      if (script?.type !== "tool_call") throw new Error("Missing script row");
      const text = script.toolResult?.content ?? "";
      const visible = script.workflow?.visibleRanges
        ?.map(({ start, end }) => text.slice(start, end))
        .join("");
      expect(visible).toContain("Diagnostic after activation.");
      if (mode === "matching-lines") {
        expect(visible).not.toContain("Before the script declaration.");
        expect(visible).not.toContain("Before activation.");
        expect(text).toContain("Before activation.");
      } else if (mode === "self-announced") {
        expect(visible).toContain("Before activation.");
      }
    },
  );

  it("activates a schema from a native Read's unnumbered structured content", () => {
    const body = `@@visualization-schema/1 ~/schema.md#ya-publish/1\n\`\`\`json\n${JSON.stringify(publishSchema)}\n\`\`\``;
    const readResult = {
      ...result(
        "read",
        body
          .split("\n")
          .map((line, index) => `${index + 1}→${line}`)
          .join("\n"),
      ),
      toolUseResult: {
        type: "text",
        file: { filePath: "/schema.md", content: body, numLines: 4 },
      },
    };
    const items = compileTranscriptProjection(
      [
        call("read", "Read"),
        readResult,
        assistant(
          "start",
          "[workflow][start] id=read schema=ya-publish/1\n[publish][client] Ready.",
        ),
      ],
      { workflowTags: true },
    );
    expect(
      items.at(-1)?.workflow?.markers.map((marker) => marker.kind),
    ).toEqual(["start", "stage"]);
  });

  it("treats inline lifecycle-shaped tags as display data and waits for complete streamed lines", () => {
    const activation = assistant(
      "activation",
      '@@visualization-schema/1 [["workflow","end"],"build"]',
    );
    const partial = {
      ...assistant("stream", "[workflow][end] Ordinary stage.\n[build]"),
      _isStreaming: true,
    };
    const items = compileTranscriptProjection([activation, partial], {
      workflowTags: true,
    });
    expect(items[1]?.workflow?.markers.map((marker) => marker.kind)).toEqual([
      "stage",
    ]);
    const complete = compileTranscriptProjection(
      [activation, { ...partial, _isStreaming: false }],
      { workflowTags: true },
    );
    expect(complete[1]?.workflow?.markers.map((marker) => marker.kind)).toEqual(
      ["stage", "stage"],
    );
  });

  it("allows inline activation in a tool result without reclassifying earlier output", () => {
    const messages = [
      call("tool"),
      result(
        "tool",
        '[build] Before.\n@@visualization-schema/1 ["build"]\n[build] Inside.',
      ),
      assistant("after", "[build] Subsequent commentary."),
    ];
    const items = compileTranscriptProjection(messages, { workflowTags: true });
    expect(items[0]?.workflow?.markers.map((marker) => marker.kind)).toEqual([
      "activation",
      "stage",
    ]);
    expect(items[1]?.workflow?.markers[0]?.kind).toBe("stage");
  });
  it("opts into inline boundaries without changing transcript rows or text", () => {
    const messages: Message[] = [
      { id: "user", role: "user", content: "Run the harmless checks" },
      {
        id: "answer",
        role: "assistant",
        content:
          '@@visualization-schema/1 ["build",["check","types"]]\n[build] Prepare.\n[build][other] Ordinary text.\n[check][types] Check.\n[build] Retry.',
      },
    ];
    const ordinary = compileTranscriptProjection(messages);
    const tagged = compileTranscriptProjection(messages, {
      workflowTags: true,
    });
    expect(tagged.map(({ id, type }) => ({ id, type }))).toEqual(
      ordinary.map(({ id, type }) => ({ id, type })),
    );
    expect(ordinary.every((item) => !item.workflow)).toBe(true);
    expect(tagged[1]?.workflow?.markers.map((marker) => marker.prefix)).toEqual(
      [
        '@@visualization-schema/1 ["build",["check","types"]]',
        "[build]",
        "[check][types]",
        "[build]",
      ],
    );
    expect(tagged[1]).toMatchObject({ text: messages[1]?.content });
  });

  it("displays the publish schema and keeps opaque tool output under its parent", () => {
    const items = buildSessionDetailRenderItems({
      messages: simulatedPublish(),
      workflowTagsEnabled: true,
    });
    const client = items.find((item) => item.id === "publish-client-0");
    expect(client?.workflow?.markers).toEqual([
      expect.objectContaining({
        prefix: "[publish][client]",
        title: "Publish YA › Publish the hosted client",
        kind: "stage",
      }),
    ]);
    const pages = items.find((item) => item.id === "pages");
    expect(pages?.workflow).toEqual({
      parent: {
        path: "[publish][client]",
        title: "Publish YA › Publish the hosted client",
      },
      markers: [],
    });
    expect(
      items
        .flatMap((item) => item.workflow?.markers ?? [])
        .filter((marker) => marker.kind === "end"),
    ).toHaveLength(1);
    expect(pages).toMatchObject({
      toolResult: { content: expect.stringContaining("nothing deployed") },
    });
  });

  it("keeps concurrent inline tool output beneath its launch stage, including after reload", () => {
    const messages = simulatedInline();
    const compile = (input: Message[]) =>
      buildSessionDetailRenderItems({
        messages: input,
        workflowTagsEnabled: true,
      });
    const items = compile(messages);
    const tool = items.find((item) => item.id === "inline-tool");
    expect(tool?.workflow?.markers.map((marker) => marker.path)).toEqual([
      "[build][check][types]",
      "[build][report]",
    ]);
    expect(compile(JSON.parse(JSON.stringify(messages)))).toEqual(items);
    const partial = compile(messages.slice(0, 5));
    expect(
      partial.find((item) => item.id === "inline-tool")?.workflow?.parent,
    ).toEqual(tool?.workflow?.parent);
    expect(compile(messages)).toEqual(items);
  });

  it("ignores quoted examples, undeclared gates, malformed updates and later turns", () => {
    const messages = [
      assistant(
        "examples",
        '```text\n@@visualization-schema/1 ["A"]\n```\n> @@visualization-schema/1 ["A"]\n[A] Before activation.',
      ),
      assistant(
        "activate",
        '@@visualization-schema/1 ["A"]\n[A] Recognized.\n[no-attrib] Ordinary gate.\n```\n[A] Example.\n```\n> [A] Quote.\n@@visualization-schema/1 [invalid]\n[A] Still recognized.',
      ),
      { id: "next-turn", role: "user", content: "Next request" } as Message,
      assistant("after", "[A] Outside the span."),
    ];
    const items = compileTranscriptProjection(messages, { workflowTags: true });
    expect(items[0]?.workflow).toBeUndefined();
    expect(items[1]?.workflow?.markers.map((marker) => marker.kind)).toEqual([
      "activation",
      "stage",
      "unresolved",
      "stage",
    ]);
    expect(items[3]?.workflow).toBeUndefined();
  });

  it("does not infer completion or activate arbitrary JSON and unresolved paths", () => {
    const items = compileTranscriptProjection(
      [
        assistant("json", JSON.stringify(publishSchema)),
        assistant(
          "path",
          "@@visualization-schema/1 ~/missing.json\n[workflow][start] id=x schema=ya-publish/1\n[publish][client] Not activated.",
        ),
      ],
      { workflowTags: true },
    );
    expect(items[0]?.workflow).toBeUndefined();
    expect(items[1]?.workflow?.markers.map((marker) => marker.kind)).toEqual([
      "unresolved",
    ]);
  });

  it.each([
    {
      containsTags: true,
      expected: ["[build]", "[build][extra]", "[INFO]", "[workflow][end]"],
    },
    { containsTags: true, whitelist: ["[build]"], expected: ["[build]"] },
    { containsTags: true, whitelist: [], expected: [] },
    { containsTags: false, expected: [] },
  ])(
    "honors tool policy $containsTags / $whitelist",
    ({ expected, ...toolOutput }) => {
      const schema = { ...publishSchema, toolOutput };
      const messages = [
        call("schema"),
        result(
          "schema",
          `@@visualization-schema/1 /schema.md#ya-publish/1\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\``,
        ),
        assistant(
          "start",
          "[workflow][start] id=x schema=ya-publish/1\n[publish][verify] Check.",
        ),
        call("check"),
        result(
          "check",
          "[build] One.\n[build][extra] Two.\n```\n[INFO] Three.\n[workflow][end] id=x status=failed\n```",
        ),
        assistant("end", "[workflow][end] id=x status=completed Finished."),
      ];
      const items = compileTranscriptProjection(messages, {
        workflowTags: true,
      });
      expect(
        items
          .find((item) => item.id === "check")
          ?.workflow?.markers.map((marker) => marker.prefix) ?? [],
      ).toEqual(expected);
      expect(items.at(-1)?.workflow?.markers[0]?.kind).toBe("end");
      if (expected.length) {
        expect(
          items.find((item) => item.id === "check")?.workflow?.markers[0]
            ?.title,
        ).toBe("Publish YA › Verify the source change › build");
      }
    },
  );

  it("stabilizes unchanged rows but invalidates an inherited workflow label", () => {
    const messages = simulatedInline();
    const first = buildSessionDetailRenderItems({
      messages,
      workflowTagsEnabled: true,
    });
    const again = buildSessionDetailRenderItems({
      messages: [...messages],
      workflowTagsEnabled: true,
      previousRenderItems: first,
    });
    expect(again.every((item, i) => item === first[i])).toBe(true);
    const off = buildSessionDetailRenderItems({
      messages,
      previousRenderItems: first,
    });
    expect(off.every((item) => !item.workflow)).toBe(true);
  });
});
