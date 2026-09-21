import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

/**
 * One end-to-end pass over a `!!` local command: the composer says where the
 * draft is going before it is sent, and the command runs in the project
 * without the provider seeing it.
 * Contract: topics/bang-commands.md.
 */
test("a !! draft is routed locally and its run is recorded", async ({
  page,
  baseURL,
}) => {
  const project = join(e2ePaths.tempDir, "mockproject");
  const id = Buffer.from(project).toString("base64url");
  const sessionPath = `/api/projects/${id}/sessions/mock-session-001`;
  await page.route(`**${sessionPath}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.messages.push({ id: "msg-transient-result", type: "result" });
    await route.fulfill({ response, json: body });
  });
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`${sessionPath}/messages`)
    )
      providerRequests.push(request.url());
  });
  // Force completion-before-receipt instead of depending on machine timing.
  await page.route(`**${sessionPath}/bang-commands`, async (route) => {
    expect(route.request().postDataJSON().placementAfterMessageId).not.toBe(
      "msg-transient-result",
    );
    const response = await route.fetch();
    await expect(page.getByText("exit 0", { exact: true })).toBeVisible();
    await route.fulfill({ response });
  });
  await page.goto(`${baseURL}/projects/${id}/sessions/mock-session-001`);

  const composer = page.locator("textarea[data-composer-input]").first();
  await expect(composer).toBeVisible();
  await composer.pressSequentially("!!echo ya-bang-ok", { delay: 15 });

  // Routing is shown before submission, never inferred.
  await expect(
    page.getByText("!! local command", { exact: false }),
  ).toBeVisible();

  await composer.press("Enter");
  const block = page.getByRole("group", { name: "Local command run" }).first();
  await expect(block.getByText("echo ya-bang-ok")).toBeVisible();
  await expect(composer).toHaveValue("");

  const finished = page
    .getByRole("group", { name: "Local command run" })
    .first();
  await expect(finished.getByText("exit 0")).toBeVisible({ timeout: 15000 });
  await expect(
    finished.getByRole("button", { name: "Hide output" }),
  ).toBeVisible();
  await page.unroute(`**${sessionPath}/bang-commands`);
  await page.reload();
  await expect(finished.getByText("exit 0")).toBeVisible();
  await expect(composer).toHaveValue("");

  // Runs persist and the suite shares one server, so leave the history as
  // this test found it — the !! Commands view asserts elsewhere that it is
  // empty. Deleting through the block's own action covers that path too.
  await finished.getByRole("button", { name: "Delete" }).click();
  await expect(finished).toHaveCount(0);

  await composer.pressSequentially(
    "!!printf 'bang stderr explanation\\n' >&2; exit 1",
    { delay: 15 },
  );
  await composer.press("Enter");
  await expect(finished.getByText("exit 1", { exact: true })).toBeVisible();
  await expect(
    finished.locator("pre").filter({ hasText: "bang stderr explanation" }),
  ).toBeVisible();
  await expect(
    finished.getByRole("button", { name: "Hide output" }),
  ).toBeVisible();
  for (const viewport of [
    { width: 1200, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await finished.scrollIntoViewIfNeeded();
    await recordUiCapture(page, `bang-error-${viewport.width}`, viewport);
  }
  expect(providerRequests).toEqual([]);
  await finished.getByRole("button", { name: "Delete" }).click();
  await expect(finished).toHaveCount(0);
});
