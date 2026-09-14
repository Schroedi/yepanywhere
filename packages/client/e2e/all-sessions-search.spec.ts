import { mkdirSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs";
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

test("All Sessions keeps every typed character with a large title catalog", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60000);
  saveSession("typing-fixture", "typing");
  await page.route(/\/api\/sessions\?/, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const seed = data.sessions?.find(
      (s: { id: string }) => s.id === "typing-fixture",
    );
    if (!seed) return route.fulfill({ response });
    await route.fulfill({
      response,
      json: {
        ...data,
        hasMore: false,
        sessions: Array.from({ length: 1000 }, (_, i) => ({
          ...seed,
          id: `typing-${i}`,
          title: `Search fixture typing ${i}`,
          fullTitle: `Search fixture typing ${i}`,
          initialPrompt: `Search fixture typing ${i}`,
        })),
      },
    });
  });
  await page.goto(`${baseURL}/sessions`);
  const search = page.getByRole("searchbox", { name: "Search sessions..." });
  await expect(search).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Keep just 100\d matching/ }),
  ).toBeVisible();
  await search.evaluate((node) => {
    const samples: Array<{
      latency: number;
      expected: string;
      actual: string;
    }> = [];
    let expected = "";
    Object.assign(window, { typingSamples: samples });
    node.addEventListener("keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key.length !== 1) return;
      expected += key;
      const prefix = expected;
      const start = event.timeStamp;
      requestAnimationFrame(() =>
        samples.push({
          latency: performance.now() - start,
          expected: prefix,
          actual: (node as HTMLInputElement).value,
        }),
      );
    });
  });
  const text = "Search fixture typing 987";
  await search.pressSequentially(text, { delay: 10 });
  expect(await search.inputValue()).toBe(text);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const samples = await page.evaluate(
    () =>
      (
        window as unknown as {
          typingSamples: Array<{
            latency: number;
            expected: string;
            actual: string;
          }>;
        }
      ).typingSamples,
  );
  expect(samples).toHaveLength(text.length);
  expect(
    samples.every((sample) => sample.actual.startsWith(sample.expected)),
  ).toBe(true);
  expect(
    Math.max(...samples.map((sample) => sample.latency)),
  ).toBeLessThanOrEqual(100);
  console.log(
    "[search-typing]",
    JSON.stringify({
      characters: text.length,
      maxKeyToFrameMs: Math.max(...samples.map((sample) => sample.latency)),
    }),
  );
  await expect(page.locator(".session-list-item--card")).toHaveCount(1);
});

test("All Sessions follows appended turns and newly discovered sessions without restarting the catalog", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60000);
  saveSession("live-search-alpha", "live alpha");
  const file = createdFiles.at(-1)!;
  const requests: Array<{ sessionId: string; cursor?: string }> = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/sessions/content-search"))
      requests.push(JSON.parse(request.postData()!));
  });
  await page.goto(`${baseURL}/sessions`);
  const search = page.getByRole("searchbox", { name: "Search sessions..." });
  await search.fill("quasarneedle");
  await search.press("Control+r");
  await expect(
    page
      .getByText("quasarneedle live alpha original request", { exact: false })
      .first(),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/sessions scanned/)).toHaveCount(0, {
    timeout: 30000,
  });
  const before = requests.length;
  appendFileSync(
    file,
    `${JSON.stringify({ type: "user", uuid: "live-appended", parentUuid: "live-search-alpha-261", sessionId: "live-search-alpha", cwd: join(e2ePaths.tempDir, "mockproject"), timestamp: new Date().toISOString(), message: { role: "user", content: "quasarneedle live appended user" } })}\n`,
  );
  await expect(
    page.getByText("quasarneedle live appended user", { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  expect(
    requests
      .slice(before)
      .filter((request) => request.sessionId === "live-search-alpha")
      .every((request) => !!request.cursor),
  ).toBe(true);
  const afterAppend = requests.length;
  saveSession("live-search-beta", "live beta");
  await expect(
    page
      .getByText("quasarneedle live beta original request", { exact: false })
      .first(),
  ).toBeVisible({ timeout: 30000 });
  expect(
    requests
      .slice(afterAppend)
      .filter(
        (request) =>
          request.sessionId === "live-search-alpha" && !request.cursor,
      ),
  ).toHaveLength(0);
});

for (const viewport of [
  { name: "desktop", width: 1000, height: 600 },
  { name: "phone", width: 375, height: 812 },
]) {
  test(`All Sessions reserves arriving matches and fits long titles on ${viewport.name}`, async ({
    page,
    baseURL,
  }) => {
    saveSession(
      `reservation-${viewport.name}`,
      `${"Context before ".repeat(30)}quasarneedle ${"context after ".repeat(30)}`,
    );
    await page.setViewportSize(viewport);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/sessions/content-search", async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });
    try {
      await page.goto(`${baseURL}/sessions`);
      const search = page.getByRole("searchbox", {
        name: "Search sessions...",
      });
      await search.fill("quasarneedle");
      const row = page.locator(".session-list-item--card");
      await expect(row).toHaveCount(1);
      const title = row.locator("strong mark").locator("..");
      await expect(title).toHaveText(/^….*quasarneedle.*…$/);
      const narrowText = await title.textContent();
      const narrowWidth = await title.evaluate((node) => node.clientWidth);
      await page.setViewportSize({ ...viewport, width: viewport.width + 100 });
      await expect
        .poll(() => title.evaluate((node) => node.clientWidth))
        .not.toBe(narrowWidth);
      const resizedWidth = await title.evaluate((node) => node.clientWidth);
      // A wider viewport may open the sidebar and reduce the title's space.
      await expect
        .poll(
          async () =>
            ((await title.textContent())!.length - narrowText!.length) *
            (resizedWidth - narrowWidth),
        )
        .toBeGreaterThan(0);
      await page.setViewportSize(viewport);
      // Let title-only layout settle before enabling turn acquisition.
      await page.waitForTimeout(600);
      const request = page.waitForRequest("**/api/sessions/content-search");
      await page.getByRole("checkbox", { name: /^Ass\./ }).check();
      await request;
      const reservedHeight = await row.evaluate(
        (node) => node.getBoundingClientRect().height,
      );
      release();
      await expect(
        row.getByRole("button", { name: "Match menu" }),
      ).toBeVisible();
      expect(
        await row.evaluate((node) => node.getBoundingClientRect().height),
      ).toBe(reservedHeight);
      await expect
        .poll(() => row.evaluate((node) => node.getBoundingClientRect().height))
        .toBeLessThan(reservedHeight);
      await recordUiCapture(
        page,
        `all-sessions-fitted-title-${viewport.name}`,
        viewport,
      );
    } finally {
      release();
    }
  });

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
    await search.fill("Search fixture");
    await expect(rows.first().locator("strong mark")).toBeVisible();
    await expect(rows.getByText("Title", { exact: true })).toHaveCount(0);
    await recordUiCapture(
      page,
      `all-sessions-title-${viewport.name}`,
      viewport,
    );
    await search.fill("quasarneedle");
    await expect(
      rows.first().getByRole("button", { name: "Match menu" }).first(),
    ).toBeVisible();
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
