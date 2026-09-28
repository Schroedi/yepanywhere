import { expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import {
  captureArtifact,
  emitCapturePreview,
  writeCapturePreview,
} from "../../scripts/artifact-capture";

const view = process.argv[2] ?? "app";
if (!["app", "settings", "session"].includes(view))
  throw new Error("Expected app, settings or session");
const result = await captureArtifact({
  input: ".artifacts/mockups/project-service/index.html",
  yaUrl: process.env.AGENT_SERVER_URL,
  artifactOrigin: process.env.AGENT_ARTIFACT_VIEWER_ORIGIN,
  ownArtifact: false,
  commentary: true,
  interact: async ({ page, viewport }) => {
    const viewSelect = page.getByRole("combobox", { name: "Preview view" });
    await viewSelect.selectOption("settings");
    await expect(
      page.getByText("archer-scooter.apps.example.com", { exact: true }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Vhosts enabled" }).uncheck();
    await expect(page.getByRole("region", { name: "App address" })).toHaveCount(
      0,
    );
    await page.getByRole("checkbox", { name: "Vhosts enabled" }).check();
    await expect(
      page.getByText("archer-scooter.apps.example.com", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Remove…", exact: true }).click();
    await page.getByRole("button", { name: "Remove from my view" }).click();
    await expect(
      page.getByText("Project removed from your view"),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Limited user" }).uncheck();
    await expect(
      page.getByText("Removed from archer’s view", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Restore to archer’s projects" })
      .click();
    await page.getByRole("checkbox", { name: "Limited user" }).check();
    await viewSelect.selectOption("app");
    await page
      .getByRole("combobox", { name: "Content scenario" })
      .selectOption("artifact");
    await page.getByRole("checkbox", { name: "Vhosts enabled" }).uncheck();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Create artifact link" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("checkbox", { name: "Vhosts enabled" }).check();
    await page
      .getByRole("combobox", { name: "Content scenario" })
      .selectOption("service");
    await page
      .getByRole("button", { name: "Start a new session with microphone" })
      .click();
    await expect(
      page.getByRole("region", { name: "Session right-pane app" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop recording" }),
    ).toBeVisible();
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.pressSequentially("Make the scooter jump higher.");
    await expect(message).toHaveValue("Make the scooter jump higher.");
    if (viewport.name === "phone") {
      await page.getByRole("button", { name: "View app", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Stop voice recording", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Back to session", exact: true })
        .click();
      await expect(message).toBeVisible();
    }
    if (view !== "session") await viewSelect.selectOption(view);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (viewport.name === "desktop") {
      const out = await mkdtemp(
        resolve(".artifacts/captures/project-service-wide-"),
      );
      await page.setViewportSize({ width: 1200, height: 600 });
      await page.evaluate(() => document.fonts.ready);
      const path = resolve(out, `${view}.png`);
      await page.screenshot({ path, animations: "disabled" });
      emitCapturePreview(
        await writeCapturePreview({
          input: `Project service ${view}`,
          out: resolve(out, "preview"),
          screenshots: [{ name: "desktop", width: 1200, height: 600, path }],
          warnings: [],
        }),
      );
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
    }
  },
});
emitCapturePreview(result);
