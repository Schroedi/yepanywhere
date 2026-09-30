import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test("/v completes path parts as typed and opens the chosen file without a turn", async ({
  page,
  baseURL,
}) => {
  const project = join(e2ePaths.tempDir, "mockproject");
  await mkdir(join(project, "viewcmd", "notes"), { recursive: true });
  await writeFile(
    join(project, "viewcmd", "notes", "alpha-plan.md"),
    "# Alpha plan\n\nview command body\n",
  );
  await writeFile(join(project, "viewcmd", "alpha-other.txt"), "other");
  const id = Buffer.from(project).toString("base64url");
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/messages\b/.test(request.url()))
      sent.push(request.url());
  });
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${baseURL}/projects/${id}/sessions/mock-session-001`);
  const textarea = page.locator("textarea[data-composer-input]").first();
  await expect(textarea).toBeVisible();

  // Sequential keystrokes, as a person types them: every one must land.
  const typed = "/v viewcmd alp plan";
  await textarea.pressSequentially(typed, { delay: 15 });
  await expect(textarea).toHaveValue(typed);
  const menu = page.getByRole("listbox", {
    name: "Project files and directories",
  });
  const option = menu.getByRole("option", {
    name: "alpha-plan.md viewcmd/notes/",
  });
  await expect(option).toBeVisible();
  await expect(menu.getByText("alpha-other.txt")).toHaveCount(0);
  await recordUiCapture(page, "file-view-menu-desktop");

  await textarea.press("Enter");
  const viewer = page.locator(".file-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("view command body");
  await expect(textarea).toHaveValue("");
  expect(sent).toHaveLength(0);
  await recordUiCapture(page, "file-view-open-desktop");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // A miss keeps the typed command for correction and sends nothing.
  await textarea.fill("/v zzz-no-such-file");
  await textarea.press("Escape");
  await textarea.press("Enter");
  await expect(
    page.getByText("No file matches zzz-no-such-file."),
  ).toBeVisible();
  await expect(textarea).toHaveValue("/v zzz-no-such-file");
  expect(sent).toHaveLength(0);

  await page.setViewportSize({ width: 375, height: 812 });
  await textarea.fill("");
  await textarea.pressSequentially("/v alp plan", { delay: 15 });
  await expect(option).toBeVisible();
  await recordUiCapture(page, "file-view-menu-phone");
  await option.click();
  await expect(textarea).toHaveValue("/v viewcmd/notes/alpha-plan.md");
});
