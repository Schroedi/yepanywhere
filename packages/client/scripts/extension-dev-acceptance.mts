/** Real unpacked-extension build detection and reload, with an owned output/profile. */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { writeCapturePreview, emitCapturePreview } from "./artifact-capture";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const temp = await mkdtemp(join(tmpdir(), "ya-extension-dev-accept-"));
const output = join(temp, "extension");
const headed = process.argv.includes("--headed");
const child = spawn(
  process.execPath,
  [join(root, "scripts/dev-extension.mjs")],
  {
    cwd: root,
    env: { ...process.env, YEP_EXTENSION_DEV_DIR: output },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
for (const stream of [child.stdout, child.stderr])
  stream?.on("data", (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-16_000);
  });
const log = (text: string) => console.error(`[extension-dev] ${text}`);
let context:
  | Awaited<ReturnType<typeof chromium.launchPersistentContext>>
  | undefined;
try {
  const metadata = async () =>
    JSON.parse(await readFile(join(output, "dev-build.json"), "utf8")) as {
      generation: string;
      workerHash: string;
      manifest: string;
    };
  await expect
    .poll(async () => (await metadata().catch(() => null))?.generation, {
      timeout: 60_000,
    })
    .toBeTruthy();
  const original = await metadata();
  context = await chromium.launchPersistentContext(join(temp, "chrome"), {
    channel: "chromium",
    headless: !headed,
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: { width: 1000, height: 600 },
    args: [
      `--disable-extensions-except=${output}`,
      `--load-extension=${output}`,
    ],
  });
  // Match Load unpacked through Chrome's own control; writing Preferences
  // alone can be reset by Chrome's protected preference checks.
  const extensions = await context.newPage();
  await extensions.goto("chrome://extensions");
  const developerMode = extensions.locator("#devMode");
  if ((await developerMode.getAttribute("aria-pressed")) !== "true")
    await developerMode.click();
  await expect(developerMode).toHaveAttribute("aria-pressed", "true");
  await extensions.close();
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const origin = worker.url().slice(0, worker.url().lastIndexOf("/"));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/sidepanel.html?url=https://example.test`);
  const footer = page.locator("footer[data-extension-build]");
  await expect(footer).toHaveAttribute(
    "data-extension-build",
    original.generation,
  );
  await expect(
    page.getByRole("button", { name: "Reload panel", exact: true }),
  ).toBeVisible();
  const initialTime = await page.evaluate(() => performance.timeOrigin);
  await utimes(
    join(root, "packages/client/src/extension/sidepanel/DevBuildFooter.tsx"),
    new Date(),
    new Date(),
  );
  await expect
    .poll(async () => (await metadata()).generation, { timeout: 60_000 })
    .not.toBe(original.generation);
  const updated = await metadata();
  expect(updated.workerHash).toBe(original.workerHash);
  await expect(
    page.getByRole("button", { name: "Update panel", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  const screenshots: Array<{
    name: string;
    width: number;
    height: number;
    path: string;
  }> = [];
  for (const viewport of [
    { width: 1000, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    const path = join(
      root,
      `.artifacts/extension-dev-update-${viewport.width}.png`,
    );
    await page.screenshot({ path });
    screenshots.push({
      name: `development-update-${viewport.width}`,
      ...viewport,
      path,
    });
  }
  await page.getByRole("button", { name: "Update panel", exact: true }).click();
  await expect(footer).toHaveAttribute(
    "data-extension-build",
    updated.generation,
  );
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(
    initialTime,
  );
  expect(context.serviceWorkers()).toContain(worker);
  log(
    "real source watch detected a new build; UI update kept the page and worker alive",
  );
  if (headed) {
    await rm(join(root, ".artifacts/extension-dev-native-done"), {
      force: true,
    });
    await writeFile(
      join(root, ".artifacts/extension-dev-native-ready.json"),
      JSON.stringify({ origin, output, profile: join(temp, "chrome") }),
    );
    log(
      "native browser ready; create .artifacts/extension-dev-native-done to finish",
    );
    await expect
      .poll(
        async () =>
          readFile(
            join(root, ".artifacts/extension-dev-native-done"),
            "utf8",
          ).catch(() => ""),
        { timeout: 300_000 },
      )
      .toBe("done");
  }
  // Controlled metadata mismatch exercises the full-reload action without
  // changing the developer's source or store manifest for a test.
  await writeFile(
    join(output, "dev-build.json"),
    JSON.stringify({
      ...updated,
      generation: "worker-update-fixture",
      workerHash: "changed-worker",
    }),
  );
  await expect(
    page.getByRole("button", { name: "Reload extension", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  const closed = worker.waitForEvent("close", { timeout: 15_000 });
  await page
    .getByRole("button", { name: "Reload extension", exact: true })
    .click();
  await closed;
  // Chrome can leave a reloaded worker asleep until another extension page opens.
  const reopened = await context.newPage();
  await expect
    .poll(
      async () => {
        try {
          await reopened.goto(
            `${origin}/sidepanel.html?url=https://example.test`,
            { timeout: 2000 },
          );
          return true;
        } catch (error) {
          log(String(error));
          return false;
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect
    .poll(
      () => context!.serviceWorkers().find((candidate) => candidate !== worker),
      { timeout: 15_000 },
    )
    .toBeTruthy();
  const replacement = context
    .serviceWorkers()
    .find((candidate) => candidate !== worker)!;
  expect(replacement).not.toBe(worker);
  await expect
    .poll(async () =>
      replacement.evaluate(async () => {
        const chrome = (
          globalThis as unknown as {
            chrome: {
              storage: {
                local: { get(key: string): Promise<Record<string, unknown>> };
              };
            };
          }
        ).chrome;
        return (
          (await chrome.storage.local.get("ya.dev.reopenPanel"))[
            "ya.dev.reopenPanel"
          ] ?? null
        );
      }),
    )
    .toBeNull();
  log(
    "full runtime reload restarted the worker and consumed the one-shot panel restoration request",
  );
  expect(errors).toEqual([]);
  emitCapturePreview(
    await writeCapturePreview({
      input: "Development extension update controls",
      out: join(root, `.artifacts/extension-dev-preview-${Date.now()}`),
      screenshots,
    }),
  );
  log("PASS");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await context?.close();
  child.kill("SIGTERM");
  await new Promise<void>((done) => {
    if (child.exitCode !== null) done();
    else child.once("exit", () => done());
  });
  await rm(temp, { recursive: true, force: true });
}
