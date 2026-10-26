import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startDraftBrowserServer } from "../../server/test/drafts/browserServer";
import { RendezDraftDelivery } from "../../server/src/services/RendezDraftDelivery";
import { createTestViteServer } from "./support/vite-server";
import { presentUiCaptures, recordUiCapture } from "./support/ui-capture";

let api: Awaited<ReturnType<typeof startDraftBrowserServer>>;
let server: Awaited<ReturnType<typeof createTestViteServer>>;
let delivery: RendezDraftDelivery;
let base: string;
let sends = 0;
const slot = { kind: "session", sessionId: "draft-history-1" } as const;
test.beforeAll(async () => {
  api = await startDraftBrowserServer();
  delivery = new RendezDraftDelivery(api.store, api.staging);
  server = await createTestViteServer({
    root: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    server: { host: "127.0.0.1", proxy: { "/api": { target: api.url } } },
  });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
});
test.afterAll(async () => {
  await server?.close();
  await delivery?.close();
  await api?.close();
  await presentUiCaptures();
});
async function upload() {
  const id = randomUUID();
  const path = join(api.dir, `${id}.txt`);
  await writeFile(path, "screenshot bytes");
  const result = await delivery.stage(
    slot.sessionId,
    id,
    "upload",
    {
      version: 1,
      id,
      route: slot.sessionId,
      target: {
        harness: "codex",
        providerSessionId: slot.sessionId,
        yaSessionId: slot.sessionId,
      },
      state: "pending",
      createdAt: Date.now(),
      originalName: "screenshot.txt",
      path,
      size: 16,
      mimeType: "text/plain",
    },
    async () => {
      sends++;
      return { accepted: true };
    },
  );
  expect(result.accepted).toBe(true);
}
test("uploads join begun drafts and typing holds the countdown without losing keys", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${base}e2e/fixtures/rendez-composer.html`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();
  await input.pressSequentially("Explain this screenshot", { delay: 20 });
  await expect
    .poll(() => api.store.read("", slot).snapshot.payload.fields.text, {
      timeout: 10000,
    })
    .toBe("Explain this screenshot");
  await upload();
  await expect(
    page.getByText("Ready with your message", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(input).toHaveValue("Explain this screenshot");
  await recordUiCapture(page, "rendez-existing-draft-desktop");
  await input.fill("");
  await expect
    .poll(() => api.store.read("", slot).snapshot.payload.fields.text ?? "", {
      timeout: 10000,
    })
    .toBe("");
  await upload();
  // Focus revalidation uses the same real draft HTTP path as an arriving upload.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText(/Sends in \d+s/)).toBeVisible({ timeout: 10000 });
  await page.setViewportSize({ width: 1000, height: 600 });
  await recordUiCapture(page, "rendez-countdown-desktop");
  await page.setViewportSize({ width: 375, height: 812 });
  await recordUiCapture(page, "rendez-countdown-phone");
  let text = "";
  for (const key of "Please compare") {
    const start = Date.now();
    await input.pressSequentially(key);
    text += key;
    expect(await input.inputValue()).toBe(text);
    expect(Date.now() - start).toBeLessThan(100);
  }
  await expect
    .poll(() =>
      api.store
        .read("", slot)
        .snapshot.payload.attachments.every(
          (ref) => ref.rendezAutoSendAt === null,
        ),
    )
    .toBe(true);
  await input.fill("");
  await page.waitForTimeout(10500);
  expect(sends).toBe(0);
  expect(api.store.read("", slot).snapshot.payload.attachments).toHaveLength(2);
  expect(errors).toEqual([]);
});
