import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";

/**
 * One end-to-end pass over a `!!` local command: the composer says where the
 * draft is going before it is sent, and the output comes back into the
 * transcript without involving the provider.
 * Contract: topics/bang-commands.md.
 */
test("a !! draft is routed locally and its output lands in the transcript", async ({
  page,
  baseURL,
}) => {
  const project = join(e2ePaths.tempDir, "mockproject");
  const id = Buffer.from(project).toString("base64url");
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${baseURL}/projects/${id}/sessions/mock-session-001`);

  const composer = page.locator("textarea[data-composer-input]").first();
  await expect(composer).toBeVisible();
  await composer.fill("!!echo ya-bang-ok");

  // Routing is shown before submission, never inferred.
  await expect(
    page.getByText("!! local command", { exact: false }),
  ).toBeVisible();

  await composer.press("Enter");
  await expect(
    page.getByText("ya-bang-ok", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(composer).toHaveValue("");
});
