import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestViteServer } from "./support/vite-server";
import { presentUiCaptures, recordUiCapture } from "./support/ui-capture";
import { startDraftBrowserServer } from "../../server/test/drafts/browserServer";
let api: Awaited<ReturnType<typeof startDraftBrowserServer>>;
let server: Awaited<ReturnType<typeof createTestViteServer>>;
let base: string;
// The handoff test exercises multiple real debounce windows.
test.setTimeout(60_000);
test.beforeAll(async () => {
  api = await startDraftBrowserServer();
  server = await createTestViteServer({
    root: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    server: { host: "127.0.0.1", proxy: { "/api": { target: api.url } } },
  });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
});
test.afterAll(async () => {
  await server?.close();
  await api?.close();
  await presentUiCaptures();
});
test("two-device handoff, sequential typing, offline reload and conditional send clear", async ({
  browser,
}) => {
  const desktop = await browser.newContext({
    viewport: { width: 1000, height: 600 },
  });
  const phone = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  const a = await desktop.newPage(),
    b = await phone.newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  try {
    await a.goto(`${base}e2e/fixtures/draft-sync.html`);
    await b.goto(`${base}e2e/fixtures/draft-sync.html`);
    const inputA = a.getByRole("textbox", { name: "Prompt" }),
      inputB = b.getByRole("textbox", { name: "Prompt" });
    await inputA.pressSequentially("Draft from desktop", { delay: 20 });
    await expect(inputB).toHaveValue("Draft from desktop", { timeout: 10000 });
    await inputB.focus();
    await inputB.press("End");
    await inputB.pressSequentially(" on phone", { delay: 20 });
    await expect(a.getByRole("button", { name: "Combine drafts" })).toBeVisible(
      { timeout: 10000 },
    );
    // A remote revision arrives while actual key events continue under 1,000-row activity.
    await inputA.evaluate((node) => {
      node.addEventListener("keydown", (event) => {
        if (!(event instanceof KeyboardEvent) || event.key.length !== 1) return;
        const start = performance.now();
        node.addEventListener(
          "input",
          () =>
            requestAnimationFrame(() => {
              const w = window as typeof window & { latencies?: number[] };
              w.latencies ??= [];
              w.latencies.push(performance.now() - start);
            }),
          { once: true },
        );
      });
    });
    await inputA.press("End");
    await inputA.pressSequentially(" and more typing", { delay: 20 });
    await expect(inputA).toHaveValue("Draft from desktop and more typing");
    const latencies = await a.evaluate(
      () =>
        (window as typeof window & { latencies?: number[] }).latencies ?? [],
    );
    expect(latencies.length).toBe(16);
    expect(Math.max(...latencies)).toBeLessThan(100);
    await a.evaluate(() => window.scrollTo(0, 0));
    await recordUiCapture(a, "draft-sync-desktop-pending");
    await a.getByRole("button", { name: "Combine drafts" }).click();
    await expect(inputA).toHaveValue(
      "Draft from desktop on phone\n\nDraft from desktop and more typing",
    );
    await expect(b.getByRole("button", { name: "Combine drafts" })).toBeVisible(
      { timeout: 10000 },
    );
    await b.evaluate(() => window.scrollTo(0, 0));
    await recordUiCapture(b, "draft-sync-phone-pending");
    await b.getByRole("button", { name: "Combine drafts" }).click();
    await expect(inputB).toHaveValue(await inputA.inputValue());
    // Keep the already installed app reachable while its server is unavailable.
    await b.route("**/api/**", (route) =>
      new URL(route.request().url()).pathname.startsWith("/api/")
        ? route.abort()
        : route.continue(),
    );
    await inputB.press("End");
    await inputB.pressSequentially(" offline", { delay: 20 });
    const offline = await inputB.inputValue();
    await b.reload();
    await expect(inputB).toHaveValue(offline);
    await b.unroute("**/api/**");
    await b.reload();
    await expect(inputB).toHaveValue(offline);
    await expect
      .poll(
        () =>
          api.store.read("", { kind: "new-session" }).snapshot.payload.fields
            .text,
      )
      .toBe(offline);
    await b.getByRole("button", { name: "Send", exact: true }).click();
    await inputB.pressSequentially("Next draft", { delay: 10 });
    await expect(inputB).toHaveValue("Next draft");
    await expect
      .poll(
        () =>
          api.store.read("", { kind: "new-session" }).snapshot.payload.fields
            .text,
        { timeout: 10000 },
      )
      .toBe("Next draft");
    expect(errors).toEqual([]);
  } finally {
    await desktop.close();
    await phone.close();
  }
});
test("older servers keep local drafts and receive no draft-sync requests", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/drafts/")) requests++;
  });
  await page.route("**/api/version**", (route) =>
    route.fulfill({ json: { version: "0.9.2", capabilities: [] } }),
  );
  await page.goto(`${base}e2e/fixtures/draft-sync.html`);
  await page
    .getByRole("textbox")
    .pressSequentially("Local only", { delay: 15 });
  await page.reload();
  await expect(page.getByRole("textbox")).toHaveValue("Local only");
  expect(requests).toBe(0);
});

test("reload exposes unresolved submission recovery without losing the next draft", async ({
  page,
}) => {
  api.store.deleteOwner("");
  await page.addInitScript(() => {
    const key = "draft-new-session:local";
    const raw = JSON.stringify({ version: 1, text: "The next draft" });
    localStorage.setItem(key, raw);
    localStorage.setItem(
      `draft-sync-v1:local::${encodeURIComponent(key)}`,
      JSON.stringify({
        raw,
        base: null,
        submitted: {
          revision: null,
          payload: {
            fields: { text: "Unresolved submission" },
            attachments: [],
          },
        },
      }),
    );
  });
  await page.goto(`${base}e2e/fixtures/draft-sync.html`);
  await expect(page.getByRole("status")).toContainText(
    "A saved draft needs recovery",
  );
  await expect(page.getByRole("textbox")).toHaveValue("The next draft");
  await page.getByRole("button", { name: "Combine drafts" }).click();
  await expect(page.getByRole("textbox")).toHaveValue(
    "Unresolved submission\n\nThe next draft",
  );
});
