import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  nativeDisplayCases,
  runNativeDisplayCase,
} from "../../../../../../server/test/utils/native-tool-display-corpus";
import { toolRegistry } from "..";
import { displayProviders } from "../__fixtures__/displayProviders";
import { toolDisplayDiagnostics } from "../displayDiagnostics";
const context = {
  isStreaming: false,
  theme: "dark" as const,
  projectPath: "/tmp",
};
beforeEach(() => {
  toolDisplayDiagnostics.synchronousCatches = 0;
  toolDisplayDiagnostics.renderCatches = 0;
  vi.spyOn(console, "error");
  vi.spyOn(console, "warn");
});
afterEach(() => {
  cleanup();
  expect(toolDisplayDiagnostics).toEqual({
    synchronousCatches: 0,
    renderCatches: 0,
  });
  expect(console.error).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
for (const fixture of nativeDisplayCases)
  it(`mounts native live and durable ${fixture.id}`, async () => {
    const pair = await runNativeDisplayCase(fixture);
    for (const output of [pair.live, pair.durable]) {
      const call = output.renderItems.find((item) => item.type === "tool_call");
      if (call?.type !== "tool_call")
        throw new Error("Missing native tool call");
      const prepared = toolRegistry.prepare(call.toolName, {
        input: call.toolInput,
        result: call.toolResult?.structured ?? call.toolResult?.content,
        status: call.status,
        isError: call.toolResult?.isError,
      });
      let visible = [
        prepared.getDisplayName(),
        prepared.getUseSummary(context),
        prepared.getResultSummary(context),
      ].join(" ");
      for (const node of [
        prepared.renderToolUse(context),
        prepared.renderToolResult(context),
        prepared.renderCollapsedPreview(context),
        prepared.renderInline(context),
        prepared.renderInteractiveSummary(context),
      ]) {
        const mounted = render(displayProviders(node));
        expect(
          !!mounted.container.querySelector('[data-tool-display="raw"]'),
        ).toBe(!!fixture.isError);
        visible += mounted.container.textContent;
        mounted.unmount();
      }
      expect(visible).toContain(fixture.text);
    }
  });
