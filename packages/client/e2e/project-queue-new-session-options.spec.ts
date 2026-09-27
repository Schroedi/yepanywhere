import { join } from "node:path";
import type { Page } from "@playwright/test";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

const mockProjectPath = join(e2ePaths.tempDir, "mockproject");
const projectId = Buffer.from(mockProjectPath).toString("base64url");
const sessionId = "mock-session-001";
const otherProjectPath = join(e2ePaths.tempDir, "otherproject");
const otherProjectId = Buffer.from(otherProjectPath).toString("base64url");

test.use({ serviceWorkers: "block" });

async function dismissOnboardingIfVisible(page: Page) {
  const dialog = page.getByText("Welcome to yepanywhere");
  const appeared = await dialog
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await page.getByRole("button", { name: "Skip all" }).click({ force: true });
  await expect(dialog).not.toBeVisible();
}

test("right-click queues the draft as a new session in another project", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "yep-anywhere-session-toolbar-presence",
      JSON.stringify({ projectQueueNewSessionShortcut: "pin" }),
    );
  });
  // The fixture server has one project; the chooser needs a second.
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as {
      projects: Record<string, unknown>[];
    };
    const template = body.projects[0] ?? {};
    body.projects.push({
      ...template,
      id: otherProjectId,
      name: "otherproject",
      path: otherProjectPath,
      lastActivity: null,
    });
    await route.fulfill({ response, json: body });
  });
  // The fixture reports no launchable provider (and answers slowly); offer
  // Claude with two models.
  await page.route(
    (url) => url.pathname.endsWith("/api/providers"),
    (route) =>
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
                { id: "sonnet", name: "Sonnet" },
              ],
            },
          ],
        },
      }),
  );
  let queued: Record<string, unknown> | undefined;
  await page.route(`**/api/projects/${otherProjectId}/queue`, (route) => {
    queued = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      json: { item: {}, queue: { projectId: otherProjectId, items: [] } },
    });
  });

  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
  await dismissOnboardingIfVisible(page);
  const composer = page.locator("[data-composer-input]");
  await composer.fill("Start this over in the other project");

  await page
    .getByRole("button", { name: "Queue as new session for Project Queue" })
    .click({ button: "right" });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("combobox", { name: "Project" })
    .selectOption(otherProjectId);
  await dialog.getByRole("combobox", { name: "Model" }).selectOption("sonnet");
  await recordUiCapture(page, "desktop", { width: 1000, height: 600 });
  await page.setViewportSize({ width: 375, height: 812 });
  await recordUiCapture(page, "phone", { width: 375, height: 812 });
  await page.setViewportSize({ width: 1000, height: 600 });
  await dialog.getByRole("button", { name: "Queue new session" }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Queued new session in otherproject for Project Queue."),
  ).toBeVisible();
  expect(queued).toMatchObject({
    target: {
      type: "new-session",
      provider: "claude",
      model: "sonnet",
      title: "Start this over in the other project",
    },
    message: { text: "Start this over in the other project" },
  });
  await expect(composer).toHaveValue("");
});
