import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

const createdFiles: string[] = [];
test.afterEach(() => {
  for (const file of createdFiles.splice(0)) unlinkSync(file);
});

function saveSession(id: string, name: string) {
  const cwd = join(e2ePaths.tempDir, "mockproject");
  const dir = join(
    e2ePaths.claudeSessionsDir,
    hostname(),
    cwd.replace(/[/\\]/g, "-"),
  );
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  const entries = Array.from({ length: 262 }, (_, i) => ({
    type: i % 2 ? "assistant" : "user",
    uuid: `${id}-${i}`,
    parentUuid: i ? `${id}-${i - 1}` : null,
    cwd,
    sessionId: id,
    timestamp: new Date(Date.now() - (262 - i) * 60000).toISOString(),
    message: {
      role: i % 2 ? "assistant" : "user",
      content:
        i === 0
          ? `Search fixture ${name}`
          : i === 258
            ? `quasarneedle ${name} original request`
            : i === 259
              ? `quasarneedle ${name} matching answer`
              : `Ordinary turn ${i}`,
    },
  }));
  writeFileSync(
    file,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  createdFiles.push(file);
}

for (const viewport of [
  { name: "desktop", width: 1000, height: 600 },
  { name: "phone", width: 375, height: 812 },
]) {
  test(`All Sessions streams matches and preserves explicit selection on ${viewport.name}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60000);
    saveSession(`search-${viewport.name}-alpha`, "alpha");
    saveSession(`search-${viewport.name}-beta`, "beta");
    await page.setViewportSize(viewport);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/sessions/content-search"))
        requests.push(request.postData() ?? "");
    });
    await page.goto(`${baseURL}/sessions`);
    const search = page.getByRole("searchbox", { name: "Search sessions..." });
    await expect(search).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Title", exact: true }),
    ).toBeChecked();
    const assistant = page.getByRole("checkbox", { name: /^Ass\./ });
    await expect(assistant).not.toBeChecked();
    if (viewport.name === "desktop") await expect(search).toBeFocused();
    else await expect(search).not.toBeFocused();
    await search.fill("quasarneedle");
    await expect(
      page.getByText("No sessions found", { exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(0);
    const rows = page.locator(".session-list-item--card");
    await search.press("Control+r");
    await expect(page.getByRole("checkbox", { name: /^User/ })).toBeChecked();
    await expect(assistant).not.toBeChecked();
    await expect(rows).toHaveCount(2, { timeout: 30000 });
    await rows.first().getByRole("button", { name: "Match menu" }).click();
    await page
      .getByRole("button", { name: "Zoom preview", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("original request");
    await expect(page.getByRole("dialog")).toContainText("matching answer");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await search.press("Control+s");
    await expect(assistant).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Title", exact: true }),
    ).not.toBeChecked();
    await page.getByRole("checkbox", { name: "Title", exact: true }).check();
    await expect(
      page.getByRole("checkbox", { name: /^User/ }),
    ).not.toBeChecked();
    await expect(rows).toHaveCount(2, { timeout: 30000 });
    await expect(page.getByText(/sessions scanned/)).toHaveCount(0, {
      timeout: 30000,
    });
    expect(requests.length).toBeGreaterThan(2);
    await page
      .getByRole("button", {
        name: "Keep just 2 matching sessions selected",
        exact: true,
      })
      .click();
    await search.fill("quasarneedle alpha");
    await expect(rows).toHaveCount(1, { timeout: 30000 });
    await expect(
      page.getByRole("button", { name: "Clear 2 selected", exact: true }),
    ).toBeVisible();
    await search.fill("quasarneedle");
    await expect(rows).toHaveCount(2, { timeout: 30000 });
    await page
      .getByRole("button", { name: "Filter: Unarchived", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Make Unarchived 2", exact: true }),
    ).toBeVisible();
    const from = page.getByRole("textbox", { name: /^Minimum age/ });
    const initialWidth = await from.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    await from.fill("12345h");
    expect(
      await from.evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThan(initialWidth);
    await from.fill("");
    expect(
      await from.evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThan(initialWidth);
    await expect(rows).toHaveCount(2, { timeout: 30000 });
    await recordUiCapture(
      page,
      `all-sessions-search-${viewport.name}`,
      viewport,
    );
    await rows.first().getByRole("button", { name: "Match menu" }).click();
    await page
      .getByRole("button", { name: "Zoom preview", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("matching answer");
    await expect(page.getByRole("dialog")).toContainText("original request");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const target = rows.first().locator('a[href*="searchMatch="]').last();
    await target.click();
    await expect(page).toHaveURL(/searchMatch=/);
    await expect(
      page
        .locator("[data-render-id]")
        .filter({ hasText: "matching answer" })
        .first(),
    ).toBeVisible();
  });
}
