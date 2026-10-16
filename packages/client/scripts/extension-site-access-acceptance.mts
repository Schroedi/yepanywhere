/** Isolated real-Chromium permission-request boundary; no YA host required. */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import type { ChromeApi } from "../src/extension/chrome";
import { emitCapturePreview, writeCapturePreview } from "./artifact-capture";

const dist = resolve(
  process.env.YA_EXTENSION_DIST ?? "../browser-extension/dist",
);
const temp = mkdtempSync(join(tmpdir(), "ya-site-access-"));
const screenshots: {
  name: string;
  width: number;
  height: number;
  path: string;
}[] = [];
const errors: string[] = [];
const context = await chromium.launchPersistentContext(join(temp, "chrome"), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
try {
  context.on("weberror", (error) => errors.push(error.error().message));
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  // Real ungranted web tab, with no external network or site credentials.
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>GitHub</title>" }),
  );
  const site = await context.newPage();
  await site.goto("https://github.com/");
  const panel = await context.newPage();
  panel.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await panel.goto(`${origin}/sidepanel.html`);
  // An inactive extension page exercises the same current-tab query as the
  // side panel, without invoking the toolbar or granting activeTab.
  await site.bringToFront();
  await panel.reload();
  const title = panel.getByRole("heading", {
    name: "Find sessions related to this page",
  });
  await expect(title).toBeVisible();
  const tab = await panel.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
    return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  });
  expect(tab?.url).toBeUndefined();
  expect(tab?.id).toEqual(expect.any(Number));
  const allow = panel.getByRole("button", { name: "Allow this site…" });
  await expect(allow).toBeVisible();
  // Avoid Playwright activating the extension page before its click: invoke
  // the real DOM click while the web tab remains current. This API accepts a
  // tab id without an activeTab grant or a permission-request user gesture.
  await allow.evaluate((button: HTMLButtonElement) => button.click());
  await expect(panel.getByRole("status")).toContainText(
    "Finish allowing access",
  );
  const permissions = await panel.evaluate(() =>
    (
      globalThis as unknown as { chrome: ChromeApi }
    ).chrome.permissions.getAll(),
  );
  expect(permissions.permissions).not.toContain("tabs");
  expect(permissions.origins ?? []).toEqual([]);
  console.error(
    "Real Chrome accepted the host access request for a hidden URL",
  );

  // Capture the initial invitation, with no host or recognized issue needed.
  await panel.reload();
  await expect(allow).toBeVisible();
  for (const viewport of [
    { name: "desktop", width: 1000, height: 600 },
    { name: "phone", width: 375, height: 812 },
  ]) {
    await panel.setViewportSize(viewport);
    await panel.evaluate(() => document.fonts.ready);
    const path = join(temp, `${viewport.name}.png`);
    // writeCapturePreview archives/presents the owned browser's captures.
    await panel.screenshot({ path });
    screenshots.push({ ...viewport, path });
  }

  // Known addresses also invite access on a site's home page, without a
  // toolbar click being required by the CTA's render conditions.
  await panel.goto(`${origin}/sidepanel.html?url=https://github.com/`);
  await expect(
    panel.getByRole("button", { name: "Allow github.com…" }),
  ).toBeVisible();
  await panel.goto(
    `${origin}/sidepanel.html?url=https://tomfit.atlassian.net/`,
  );
  await expect(
    panel.getByRole("button", { name: "Allow tomfit.atlassian.net…" }),
  ).toBeVisible();

  // Old Chrome gets actionable instructions rather than a broken button.
  await site.bringToFront();
  await panel.goto(`${origin}/sidepanel.html`);
  await panel.addInitScript(() => {
    (
      globalThis as unknown as { chrome: ChromeApi }
    ).chrome.permissions.addHostAccessRequest = undefined;
  });
  await site.bringToFront();
  await panel.reload();
  await expect(
    panel.getByText("This Chrome version cannot request access", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(allow).toHaveCount(0);
  await panel.goto(`${origin}/sidepanel.html?url=chrome://settings/`);
  await expect(title).toHaveCount(0);
  expect(errors).toEqual([]);

  // Preserve PNGs outside the temporary profile before cleanup.
  const out = resolve(
    `../../.artifacts/extension-acceptance/site-access/${Date.now()}`,
  );
  mkdirSync(out, { recursive: true });
  for (const screenshot of screenshots) {
    const path = join(out, `${screenshot.name}.png`);
    copyFileSync(screenshot.path, path);
    screenshot.path = path;
  }
  emitCapturePreview(
    await writeCapturePreview({
      input: "Extension site access invitation",
      out: join(out, "preview"),
      screenshots,
      warnings: [],
    }),
  );
} finally {
  await context.close();
  rmSync(temp, { recursive: true, force: true });
}
