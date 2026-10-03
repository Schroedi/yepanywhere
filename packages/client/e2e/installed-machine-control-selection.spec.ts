import type { Route } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

// Browser-only offer/typing boundary: no native MC operation or model turn.
test.use({ draftSessionIds: [], serviceWorkers: "block" });

test("installed MC readiness preserves typing and its selected affordance at desktop and phone widths", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.addInitScript(() => {
    const samples: number[] = [];
    let keyAt = 0;
    document.addEventListener(
      "keydown",
      () => {
        keyAt = performance.now();
      },
      true,
    );
    document.addEventListener(
      "input",
      () => {
        samples.push(performance.now() - keyAt);
      },
      true,
    );
    Object.assign(window, { mcTypingSamples: samples });
  });
  await page.route("**/api/providers", (route) =>
    route.fulfill({
      json: {
        providers: [
          {
            name: "claude",
            displayName: "Claude",
            installed: true,
            authenticated: true,
            enabled: true,
            models: [
              { id: "opus", name: "Opus" },
              ...Array.from({ length: 200 }, (_, index) => ({
                id: `model-${index}`,
                name: `Model ${index}`,
              })),
            ],
          },
        ],
      },
    }),
  );
  let resolveReadiness!: (route: Route) => void;
  const readiness = new Promise<Route>((resolve) => {
    resolveReadiness = resolve;
  });
  await page.route("**/api/machine-control", resolveReadiness);
  await page.goto(`${baseURL}/new-session`);
  const composer = page.locator("textarea.new-session-form-textarea");
  await expect(composer).toBeVisible();
  const request = await readiness;
  await composer.focus();
  const message = "inspect the fixture with Machine Control";
  for (const [index, character] of [...message].entries()) {
    if (index === 12)
      await request.fulfill({ json: { available: true, version: "0.5.3" } });
    await page.keyboard.type(character);
    await expect(composer).toHaveValue(message.slice(0, index + 1));
  }
  const samples = await page.evaluate(
    () => (window as unknown as { mcTypingSamples: number[] }).mcTypingSamples,
  );
  expect(samples).toHaveLength(message.length);
  expect(Math.max(...samples)).toBeLessThan(100);
  await page
    .getByRole("button", { name: "Advanced options", exact: false })
    .click();
  await page.getByRole("button", { name: "Show option explanations" }).click();
  const control = page
    .getByRole("heading", { name: "Machine Control", exact: true })
    .locator("..");
  await expect(control).toContainText("Off");
  await control
    .getByRole("button", { name: "Filter by Machine Control" })
    .click();
  await page.getByRole("button", { name: "On", exact: true }).click();
  await expect(control).toContainText("On");
  await expect(control).toContainText(
    "closing this session does not revoke it.",
  );
  await expect(page.getByText("Server changed", { exact: false })).toHaveCount(
    0,
  );
  await control.scrollIntoViewIfNeeded();
  await recordUiCapture(page, "installed-mc-desktop", {
    width: 1000,
    height: 600,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await recordUiCapture(page, "installed-mc-phone", {
    width: 375,
    height: 812,
  });
});
