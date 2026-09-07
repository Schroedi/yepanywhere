import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { Message } from "../src/types";
import {
  simulatedInline,
  simulatedNestedTool,
  simulatedPublish,
} from "../test-fixtures/workflow";
import { e2ePaths, expect, test } from "./fixtures.js";

function saveTranscript(sessionId: string, messages: Message[]) {
  const projectPath = join(e2ePaths.tempDir, "mockproject");
  const directory = join(
    e2ePaths.claudeSessionsDir,
    hostname(),
    projectPath.replace(/[/\\]/g, "-"),
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${sessionId}.jsonl`),
    messages
      .map((message, index) =>
        JSON.stringify({
          type: message.role,
          uuid: message.id,
          parentUuid: index ? messages[index - 1]?.id : null,
          cwd: projectPath,
          sessionId,
          timestamp: new Date(Date.UTC(2026, 8, 7, 0, 0, index)).toISOString(),
          message: { role: message.role, content: message.content },
        }),
      )
      .join("\n") + "\n",
  );
  return Buffer.from(projectPath).toString("base64url");
}

for (const viewport of [
  { name: "desktop", width: 1000, height: 600 },
  { name: "phone", width: 375, height: 812 },
] as const) {
  test(`simulated publish and inline schemas at ${viewport.name} width`, async ({
    page,
    baseURL,
  }, testInfo) => {
    test.setTimeout(60000);
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error")
        failures.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.setItem("yep-anywhere-conversation-view-enabled", "false");
    });
    const sessionId = `workflow-publish-${viewport.name}`;
    const projectId = saveTranscript(sessionId, simulatedPublish());
    const url = `${baseURL}/projects/${projectId}/sessions/${sessionId}`;
    await page.goto(url);
    await expect(
      page.locator('[data-render-id="publish-client-0"]'),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-workflow-boundary]")).toHaveCount(0);

    await page.goto(`${baseURL}/settings/appearance`);
    const setting = page.getByRole("checkbox", {
      name: "Workflow tag highlighting",
    });
    await expect(setting).not.toBeChecked();
    await setting.locator("..").click();
    await expect(setting).toBeChecked();
    await page.goto(url);
    const client = page.locator('[data-workflow-path="[publish][client]"]');
    await expect(client).toBeVisible({ timeout: 10000 });
    await expect(client).toContainText("Publish the hosted client");
    await expect(
      page.locator('[data-workflow-schema="activation"]'),
    ).toHaveText("Workflow schema · Publish YA");
    const pages = page.locator('[data-render-id="pages"]');
    await expect(pages.locator("[data-workflow-parent]")).toHaveAttribute(
      "data-workflow-parent",
      "[publish][client]",
    );
    await expect(pages.locator("[data-workflow-boundary]")).toHaveCount(0);
    await expect(page.locator('[data-workflow-boundary="end"]')).toContainText(
      "completed",
    );
    await expect(
      page
        .getByText("Nothing merged, pushed, or deployed.", { exact: false })
        .first(),
    ).toBeVisible();
    await client.scrollIntoViewIfNeeded();
    const captureDir =
      process.env.YEP_E2E_UI_CAPTURE_DIR ?? testInfo.outputPath("captures");
    mkdirSync(captureDir, { recursive: true });
    await expect(
      page.getByText("Server changed", { exact: false }),
    ).toHaveCount(0);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: join(captureDir, `publish-${viewport.name}.png`),
      animations: "disabled",
    });

    const inlineSessionId = `workflow-inline-${viewport.name}`;
    saveTranscript(inlineSessionId, simulatedInline());
    const inlineUrl = `${baseURL}/projects/${projectId}/sessions/${inlineSessionId}`;
    await page.goto(inlineUrl);
    const tool = page.locator('[data-render-id="inline-tool"]');
    await expect(
      tool.locator('[data-workflow-path="[build][check][types]"]'),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      tool.locator('[data-workflow-path="[build][report]"]'),
    ).toBeVisible();
    await expect(tool).toContainText(
      "Ordinary diagnostic remains in this span.",
    );
    await expect(
      tool.locator('[data-workflow-path="[build][build][extra]"]'),
    ).toHaveCount(0);
    await tool.scrollIntoViewIfNeeded();
    await expect(
      page.getByText("Server changed", { exact: false }),
    ).toHaveCount(0);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: join(captureDir, `inline-${viewport.name}.png`),
      animations: "disabled",
    });
    const before = await page
      .locator("[data-workflow-boundary]")
      .allTextContents();
    await page.reload();
    await expect(page.locator("[data-workflow-boundary]")).toHaveCount(
      before.length,
    );
    expect(
      await page.locator("[data-workflow-boundary]").allTextContents(),
    ).toEqual(before);
    await tool.getByText("Original output", { exact: true }).click();
    await expect(tool.locator("details[open]")).toContainText(
      "[build][extra] Not whitelisted.",
    );
    for (const mode of [
      "inherited",
      "self-announced",
      "matching-lines",
    ] as const) {
      const nestedId = `workflow-nested-${mode}-${viewport.name}`;
      saveTranscript(nestedId, simulatedNestedTool(mode));
      await page.goto(`${baseURL}/projects/${projectId}/sessions/${nestedId}`);
      const script = page.locator('[data-render-id="nested-script"]');
      await expect(
        script.locator(
          '[data-workflow-path="[publish][client][build][types]"]',
        ),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        script.locator('[data-workflow-boundary="stage"]'),
      ).toHaveCount(2);
      await expect(
        page.locator('[data-render-id="after-script"] [data-workflow-parent]'),
      ).toHaveAttribute("data-workflow-parent", "[publish][source]");
      await expect(
        page.locator('[data-workflow-boundary="end"]'),
      ).toContainText("completed");
      const preview = script.locator("[data-workflow-output] > pre");
      await expect(preview).toContainText("Diagnostic after activation.");
      if (mode === "self-announced") {
        await expect(
          script.locator('[data-workflow-schema="activation"]'),
        ).toHaveCount(0);
        await expect(
          script.locator('[data-workflow-boundary="activation"]'),
        ).toHaveCount(1);
        await expect(preview).toContainText("Before activation.");
        await script.scrollIntoViewIfNeeded();
        await expect(
          page.getByText("Server changed", { exact: false }),
        ).toHaveCount(0);
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: join(captureDir, `nested-${viewport.name}.png`),
          animations: "disabled",
        });
      } else if (mode === "matching-lines") {
        await expect(preview).not.toContainText("Before activation.");
        await script.getByText("Original output", { exact: true }).click();
        await expect(script.locator("details[open]")).toContainText(
          "Before activation.",
        );
      }
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    expect(failures).toEqual([]);
  });
}
