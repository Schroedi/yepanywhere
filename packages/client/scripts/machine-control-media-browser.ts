/** Browser driver for the explicit installed MC real-provider acceptance probe. */
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createTestViteServer } from "../e2e/support/vite-server.js";
import {
  captureViewports,
  emitCapturePreview,
  writeCapturePreview,
} from "./artifact-capture.js";

export type MachineControlMediaBrowser = Awaited<
  ReturnType<typeof createMachineControlMediaBrowser>
>;

export async function createMachineControlMediaBrowser(
  backendUrl: string,
  captureBytes: Buffer,
) {
  const clientRoot = fileURLToPath(new URL("../", import.meta.url));
  const vite = await createTestViteServer({
    root: clientRoot,
    server: {
      host: "127.0.0.1",
      hmr: false,
      proxy: { "/api": { target: backendUrl, ws: true } },
    },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: captureViewports[0] });
    const pendingMedia: Promise<Buffer>[] = [];
    const socketClosures: Promise<void>[] = [];
    const browserErrors: string[] = [];
    let sessionUrl: string | undefined;
    page.on("websocket", (socket) => {
      socketClosures.push(
        new Promise<void>((resolve) => socket.on("close", () => resolve())),
      );
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/media/") && response.status() === 200) {
        const bytes = response.body();
        // Fail the assertion below if a response fails, without an unhandled
        // rejection racing the owning browser workflow.
        void bytes.catch(() => {});
        pendingMedia.push(bytes);
      }
    });
    const outputRoot = join(clientRoot, "../../.artifacts/ui-testing");
    await mkdir(outputRoot, { recursive: true });
    const output = await mkdtemp(join(outputRoot, "mc-real-media-"));
    const screenshots: {
      name: string;
      width: number;
      height: number;
      path: string;
    }[] = [];
    return {
      async open(projectId: string, sessionId: string) {
        sessionUrl = `${url}/projects/${projectId}/sessions/${sessionId}`;
        await page.goto(sessionUrl);
        await expect(page.locator(".message-input")).toBeVisible({
          timeout: 15_000,
        });
      },
      async disconnect() {
        // End the live viewer gracefully before restarting its owned backend.
        await page.goto("about:blank");
        await Promise.all(socketClosures);
      },
      async reload() {
        assert(sessionUrl);
        pendingMedia.length = 0;
        await page.goto(sessionUrl);
      },
      async prove(stage: "live" | "reloaded") {
        const summary = page.locator(".conversation-activity-summary");
        if (await summary.count()) await summary.first().click();
        const filename = page
          .locator(".tool-row")
          .getByRole("button", { name: "browser.png", exact: true })
          .last();
        await expect(filename).toBeVisible({ timeout: 15_000 });
        await filename.scrollIntoViewIfNeeded();
        await filename.click();
        const modal = page.locator(".modal--image-viewer");
        await expect(modal).toBeVisible({ timeout: 10_000 });
        const image = modal.locator("img").first();
        await expect
          .poll(
            () =>
              image.evaluate((element) =>
                element instanceof HTMLImageElement ? element.naturalWidth : 0,
              ),
            { timeout: 10_000 },
          )
          .toBeGreaterThan(0);
        for (const viewport of captureViewports) {
          await page.setViewportSize(viewport);
          const name = `${stage}-${viewport.name}`;
          const path = join(output, `${name}.png`);
          await page.screenshot({ path });
          screenshots.push({ ...viewport, name, path });
        }
        await page.keyboard.press("Escape");
        assert(pendingMedia.length > 0, "Browser must fetch the media route");
        for (const bytes of await Promise.all(pendingMedia)) {
          assert.deepEqual(bytes, captureBytes, "Exact native capture bytes");
        }
        assert.deepEqual(browserErrors, [], "No browser exceptions");
        console.log(`PASS real full-app ${stage} desktop/phone image views`);
      },
      async present() {
        emitCapturePreview(
          await writeCapturePreview({ input: url, out: output, screenshots }),
        );
      },
      async close() {
        try {
          await browser?.close();
        } finally {
          await vite.close();
        }
      },
    };
  } catch (error) {
    try {
      await browser?.close();
    } finally {
      await vite.close();
    }
    throw error;
  }
}
