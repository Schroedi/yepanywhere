import { describe, expect, it } from "vitest";
import {
  nativeDisplayCases,
  preparedNativeRecord,
  runNativeDisplayCase,
} from "./utils/native-tool-display-corpus.ts";
import { normalizeRenderItemsForComparison } from "./utils/render-parity-harness.ts";
for (const fixture of nativeDisplayCases)
  describe(fixture.id, () => {
    it("converges through native adapters, durable normalization, compilation and display preparation", async () => {
      const { live, durable } = await runNativeDisplayCase(fixture);
      const liveCalls = live.renderItems.filter(
        (item) => item.type === "tool_call",
      );
      const durableCalls = durable.renderItems.filter(
        (item) => item.type === "tool_call",
      );
      expect(liveCalls).toHaveLength(1);
      expect(durableCalls).toHaveLength(1);
      const liveCall = liveCalls[0];
      const durableCall = durableCalls[0];
      if (!liveCall || !durableCall)
        throw new Error("Missing paired tool call");
      expect(liveCall.toolName).toBe(fixture.tool);
      expect(durableCall.toolName).toBe(fixture.tool);
      expect(liveCall.id).toBe(durableCall.id);
      expect(liveCall.status).toBe(fixture.isError ? "error" : "complete");
      expect(liveCall.toolResult?.isError).toBe(!!fixture.isError);
      expect(liveCall.isSubagent).toBe(durableCall.isSubagent);
      expect(preparedNativeRecord(liveCall)).toEqual(
        preparedNativeRecord(durableCall),
      );
      expect(preparedNativeRecord(liveCall).kind).toBe(
        fixture.isError
          ? "raw"
          : (fixture.id.endsWith("plain-text") &&
                fixture.tool !== "Write" &&
                fixture.tool !== "Bash") ||
              fixture.id === "codex/Edit/patch" ||
              fixture.id === "pi/Grep/native"
            ? "partial"
            : "rich",
      );
      // Deliberate non-display metadata exceptions; never erase result facts
      // or a display classification to obtain parity.
      const comparableLive = liveCalls.map((call) => ({
        ...call,
        toolResult: call.toolResult ? { ...call.toolResult } : undefined,
      }));
      const comparableDurable = durableCalls.map((call) => ({
        ...call,
        toolInput: { ...Object(call.toolInput) },
      }));
      if (fixture.provider === "grok") {
        expect(comparableDurable[0]?.toolInput.status).toBe("completed");
        delete comparableDurable[0]?.toolInput.status;
      }
      if (fixture.id === "codex/Write/command-item") {
        expect(liveCall.toolResult?.content).toBe("(no output)");
        expect(durableCall.toolResult?.content).toBe("");
        const result = comparableLive[0]?.toolResult;
        if (result) result.content = "";
      }
      expect(normalizeRenderItemsForComparison(comparableLive)).toEqual(
        normalizeRenderItemsForComparison(comparableDurable),
      );
    });
  });

import { displayFixtures } from "../../client/src/components/renderers/tools/__fixtures__/displayFixtures.js";
it("accounts for every display variant with a native pair or a synthetic-only reason", () => {
  const synthetic: Record<string, string> = {
    "Edit/augmented":
      "YA structured-patch-only augmentation; native replacement and raw patch pairs exercise its producer.",
    "Edit/changes":
      "Compatibility metadata-only file-change shape; complete Codex patch pairs own native diffs.",
    "Edit/target":
      "Incomplete target-only call; no complete provider replacement is claimed.",
    "TaskCreate/snapshot":
      "YA projection over task events, checked by native event pairs and registry snapshot fixtures.",
    "TaskUpdate/snapshot":
      "YA projection over task events, checked by native event pairs and registry snapshot fixtures.",
  };
  for (const [tool, variants] of Object.entries(displayFixtures))
    for (const variant of Object.keys(variants)) {
      expect(
        nativeDisplayCases.some(
          (f) => f.tool === tool && f.id.endsWith(`/${variant}`),
        ) || (synthetic[`${tool}/${variant}`]?.length ?? 0) > 20,
        `${tool}/${variant}`,
      ).toBe(true);
    }
});
