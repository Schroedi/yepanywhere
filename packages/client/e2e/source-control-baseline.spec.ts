import { join } from "node:path";
import { encodeVersionedServerCapabilities } from "@yep-anywhere/shared";
import {
  e2ePaths,
  expect,
  setLiveWorktreeMonitoring,
  test,
} from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

const projectPath = join(e2ePaths.tempDir, "source-control-project");
const projectId = Buffer.from(projectPath).toString("base64url");
test.use({ serviceWorkers: "block" });
test.afterEach(async ({ baseURL }) => {
  await setLiveWorktreeMonitoring(baseURL, false);
});

for (const missing of ["git-source-review", "git-working-tree-files"]) {
  test(`requires an update without Source Control requests when ${missing} is absent`, async ({
    page,
    baseURL,
  }) => {
    await setLiveWorktreeMonitoring(baseURL, true);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/projects\/[^/]+\/(git|review)\//.test(request.url()))
        requests.push(request.url());
    });
    await page.route("**/api/version*", async (route) => {
      const response = await route.fetch();
      const version = await response.json();
      await route.fulfill({
        response,
        json: {
          ...version,
          deniedCapabilityBits: encodeVersionedServerCapabilities(
            [],
            version.current,
            [missing],
          ).deniedCapabilityBits,
        },
      });
    });
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.goto(`${baseURL}/git-status?projectId=${projectId}&tab=files`);
    await expect(
      page.getByRole("heading", { name: "Update required for Source Control" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Update your yepanywhere server to v0.8.0 or newer, or use the client bundled with your server.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pull", exact: true }),
    ).toHaveCount(0);
    expect(requests).toEqual([]);
    if (missing === "git-source-review") {
      await recordUiCapture(page, "update-desktop");
      await page.setViewportSize({ width: 375, height: 812 });
      await recordUiCapture(page, "update-phone");
    }
  });
}

for (const width of [1000, 375]) {
  test(`static working-tree inventory keeps sequential filtering responsive at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    await setLiveWorktreeMonitoring(baseURL, false);
    const files = Array.from({ length: 650 }, (_, index) => ({
      path: `retirement-fixture/item-${index.toString().padStart(3, "0")}.ts`,
      tracked: false,
      kind: "untracked",
    }));
    await page.route("**/git/working-tree-files*", async (route) => {
      const response = await route.fetch();
      const inventory = await response.json();
      await route.fulfill({
        response,
        json: { ...inventory, files: [...inventory.files, ...files] },
      });
    });
    let releaseContent: () => void = () => {};
    const contentReady = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });
    await page.route("**/api/projects/*/file?*", async (route) => {
      const path =
        new URL(route.request().url()).searchParams.get("path") ?? "";
      if (!path.startsWith("retirement-fixture/")) return route.continue();
      await contentReady;
      await route.fulfill({
        json: {
          metadata: { path, size: 20, mimeType: "text/plain", isText: true },
          content: "current file contents",
          rawUrl: "/raw/fixture",
        },
      });
    });
    try {
      const inventory = page.waitForResponse((response) =>
        response.url().includes("/git/working-tree-files"),
      );
      await page.setViewportSize({ width, height: width === 375 ? 812 : 600 });
      await page.goto(`${baseURL}/git-status?projectId=${projectId}&tab=files`);
      expect((await inventory).ok()).toBe(true);
      const filter = page.getByRole("searchbox").last();
      await expect(filter).toBeVisible();
      await filter.evaluate((element) => {
        const input = element as HTMLInputElement;
        (window as unknown as { sourceTyping: number[] }).sourceTyping = [];
        input.addEventListener("keydown", () => {
          const start = performance.now();
          input.addEventListener(
            "input",
            () =>
              requestAnimationFrame(() => {
                (
                  window as unknown as { sourceTyping: number[] }
                ).sourceTyping.push(performance.now() - start);
              }),
            { once: true },
          );
        });
      });
      let typed = "";
      for (const character of "item-649") {
        typed += character;
        // Release the selected-file read during typing so detail rendering overlaps it.
        if (typed.length === 4) releaseContent();
        await filter.pressSequentially(character);
        await expect(filter).toHaveValue(typed, { timeout: 100 });
      }
      await expect(
        page.locator('[data-source-path="retirement-fixture/item-649.ts"]'),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { sourceTyping: number[] }).sourceTyping
                .length,
          ),
        )
        .toBe(8);
      const maximum = await page.evaluate(() =>
        Math.max(
          ...(window as unknown as { sourceTyping: number[] }).sourceTyping,
        ),
      );
      expect(maximum).toBeLessThanOrEqual(100);
      await recordUiCapture(
        page,
        width === 375 ? "files-phone" : "files-desktop",
      );
    } finally {
      releaseContent();
    }
  });
}
