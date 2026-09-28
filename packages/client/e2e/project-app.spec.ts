import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { createTestViteServer } from "./support/vite-server";
import { createApp } from "../../server/test/setup/create-app";
import { createFrontendProxy } from "../../server/src/frontend/proxy";
import { MockServerClaudeProvider } from "../../server/src/sdk/mock";
import { ProjectMetadataService } from "../../server/src/metadata/ProjectMetadataService";
import { SessionMetadataService } from "../../server/src/metadata/SessionMetadataService";
import { initFileAccess } from "../../server/src/middleware/file-access";
import { recordUiCapture, presentUiCaptures } from "./support/ui-capture";

const clientRoot = resolve(import.meta.dirname, "..");
const requireServer = createRequire(join(clientRoot, "../server/package.json"));
const { getRequestListener } = requireServer("@hono/node-server");
let vite: Awaited<ReturnType<typeof createTestViteServer>>;
let instance: ReturnType<typeof createApp>;
let listener: ReturnType<typeof createServer>;
let directory: string;
let base: string;
let projectId: string;

test.beforeAll(async () => {
  const scratch = resolve(clientRoot, "../../.artifacts/project-app-browser");
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "run-"));
  const project = join(directory, "canvas");
  await mkdir(join(project, ".project-template"), { recursive: true });
  await mkdir(join(project, "dist"));
  await writeFile(
    join(project, ".project-template/app.json"),
    JSON.stringify({ kind: "static", dir: "dist" }),
  );
  await writeFile(
    join(project, "dist/index.html"),
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0}body{font:16px system-ui;background:#eff5fa;color:#21394f;display:grid;place-items:center}main{text-align:center;padding:24px}h1{font-size:clamp(28px,5vw,48px);font-weight:550}button{font:inherit;border:1px solid #587da0;background:white;border-radius:8px;padding:12px 18px;color:inherit}#size{position:fixed;bottom:16px;left:16px;font-size:12px;color:#587087}</style></head><body><main><h1>Sketch garden</h1><p>A canvas for your next idea.</p><button id="counter">0 ideas</button></main><output id="size"></output><script>let n=0;document.querySelector('#counter').onclick=()=>document.querySelector('#counter').textContent=(++n)+' ideas';new ResizeObserver(()=>document.querySelector('#size').textContent=innerWidth+' × '+innerHeight).observe(document.body);</script></body></html>`,
  );
  projectId = toUrlProjectId(project);
  const dataDir = join(directory, "data");
  const metadata = new ProjectMetadataService({ dataDir });
  await metadata.initialize();
  await metadata.addProject(projectId, project, "archer");
  const sessionMetadata = new SessionMetadataService({ dataDir });
  await sessionMetadata.initialize();
  initFileAccess({
    uploadsDir: directory,
    homeDir: directory,
    tempPaths: [directory],
    envPaths: [directory],
  });
  vite = await createTestViteServer({
    root: clientRoot,
    server: { port: 0, host: "127.0.0.1" },
  });
  await vite.listen();
  const viteAddress = vite.httpServer!.address();
  if (!viteAddress || typeof viteAddress === "string")
    throw new Error("Missing Vite port");
  instance = createApp({
    provider: new MockServerClaudeProvider(),
    sessionMetadataService: sessionMetadata,
    dataDir,
    projectsDir: join(directory, "sessions"),
    projectMetadataService: metadata,
    frontendProxy: createFrontendProxy({
      vitePort: viteAddress.port,
      viteHost: "127.0.0.1",
    }),
  });
  listener = createServer(getRequestListener(instance.app.fetch));
  await new Promise<void>((ready) => listener.listen(0, "127.0.0.1", ready));
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("Missing YA port");
  base = `http://127.0.0.1:${address.port}`;
  await instance.artifactServer.configure({
    port: address.port,
    localOrigin: `http://artifacts.localhost:${address.port}`,
  });
});
test.afterAll(async () => {
  await presentUiCaptures();
  if (listener) {
    listener.closeAllConnections();
    await new Promise<void>((ready, reject) =>
      listener.close((error) => (error ? reject(error) : ready())),
    );
  }
  if (instance) {
    for (const process of instance.supervisor.getAllProcesses())
      await instance.supervisor.abortProcess(process.id);
    instance.stopNotifications();
    await instance.disposeSessionReaders();
  }
  if (vite) await vite.close();
  if (directory) await rm(directory, { recursive: true });
});

// Real browser layout, iframe retention and key-by-key acknowledgement cannot
// be established by the route/component tests of the same API contracts.
test("project App fills the pane and retains canvas and composer across phone switches", async ({
  page,
}) => {
  // Three viewports, a session start, full view and app addresses outgrow
  // the default 15s; the first transcript fetch alone has taken 5s.
  test.setTimeout(60_000);
  for (const size of [
    { width: 1200, height: 600 },
    { width: 1000, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`${base}/projects/${projectId}/app`);
    const app = page.getByRole("region", { name: "Project App" });
    const frame = app.locator("iframe");
    await expect(frame).toBeVisible();
    const canvas = page.frameLocator('iframe[title="index.html"]');
    await canvas.getByRole("button", { name: "0 ideas" }).click();
    await expect(canvas.getByRole("button", { name: "1 ideas" })).toBeVisible();
    const bounds = await frame.boundingBox();
    expect(bounds!.height).toBeGreaterThan(size.height * 0.65);
    await recordUiCapture(page, `project-app-${size.width}`);
    await app.getByRole("button", { name: "App settings" }).click();
    await expect(app.getByRole("group", { name: "App address" })).toHaveCount(
      0,
    );
    await app.getByRole("button", { name: "Back" }).click();
    await expect(canvas.getByRole("button", { name: "1 ideas" })).toBeVisible();
    await app
      .getByRole("button", { name: "New session in this project" })
      .click();
    const composer = page.locator("textarea:visible").first();
    await expect(composer).toBeVisible();
    await composer.fill("");
    let typed = "";
    for (const character of "Make the garden green") {
      typed += character;
      await composer.pressSequentially(character);
      await expect(composer).toHaveValue(typed, { timeout: 100 });
    }
    await recordUiCapture(page, `project-app-compose-${size.width}`);
    if (size.width >= 1100) {
      const composedBounds = await frame.boundingBox();
      expect(composedBounds!.height).toBeGreaterThan(size.height * 0.65);
      expect(composedBounds!.x).toBeGreaterThan(
        (await composer.boundingBox())!.x,
      );
      await composer.focus();
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, "height", {
          configurable: true,
          value: innerHeight - 200,
        });
        window.visualViewport!.dispatchEvent(new Event("resize"));
      });
      await expect
        .poll(async () => (await frame.boundingBox())!.height)
        .toBeLessThan(composedBounds!.height - 150);
      await expect(
        canvas.getByRole("button", { name: "1 ideas" }),
      ).toBeVisible();
      await page.evaluate(() => {
        Reflect.deleteProperty(window.visualViewport!, "height");
        window.visualViewport!.dispatchEvent(new Event("resize"));
      });
    }
    if (size.width < 1100) {
      await page.getByRole("button", { name: "App", exact: true }).click();
      await expect(
        canvas.getByRole("button", { name: "1 ideas" }),
      ).toBeVisible();
      await app.getByRole("button", { name: "Back" }).click();
      await expect(composer).toHaveValue(typed);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1200, height: 600 });
  await page.evaluate(() =>
    localStorage.setItem("yep-anywhere-session-right-pane-enabled", "false"),
  );
  await page.goto(`${base}/projects/${projectId}/app?compose=1`);
  await expect(
    page.getByRole("region", { name: "Project App" }).locator("iframe"),
  ).toBeVisible();
  await page
    .locator("textarea:visible")
    .first()
    .fill("Help me refine this canvas");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sessions\/mock-session-/);
  const sessionApp = page.getByRole("region", { name: "Project App" });
  await expect(sessionApp.locator("iframe")).toBeVisible();
  await expect(
    // Not exact: the transcript renders the reply inside list markup.
    page.getByText("Mock response (no scenario)").first(),
    // The first transcript fetch took at least 5s on the isolated fixture.
  ).toBeVisible({ timeout: 15000 });
  await page.mouse.move(10, 10);
  expect(
    (await sessionApp.locator("iframe").boundingBox())!.height,
  ).toBeGreaterThan(390);
  await recordUiCapture(page, "project-app-session-1200");
  // Full view covers the session and sidebar with the same live frame, and
  // Back returns to the session with the app still beside it.
  await sessionApp.locator("iframe").evaluate((frame) => {
    frame.dataset.kept = "yes";
  });
  await sessionApp.getByRole("button", { name: "Full view" }).click();
  await expect
    .poll(async () => (await sessionApp.boundingBox())!.width)
    .toBeGreaterThan(1190);
  expect((await sessionApp.boundingBox())!.x).toBeLessThan(1);
  await expect(sessionApp.locator("iframe[data-kept=yes]")).toBeVisible();
  await recordUiCapture(page, "project-app-full-1200");
  await sessionApp.getByRole("button", { name: "Back" }).click();
  await expect
    .poll(async () => (await sessionApp.boundingBox())!.width)
    .toBeLessThan(900);
  await expect(sessionApp.locator("iframe[data-kept=yes]")).toBeVisible();
  // Holding the header's App button opens full view directly.
  await sessionApp.getByRole("button", { name: "Back" }).click();
  await expect(sessionApp.locator("iframe")).toBeHidden();
  const appButton = page.getByRole("button", { name: "App", exact: true });
  await appButton.hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect
    .poll(async () => (await sessionApp.boundingBox())!.width)
    .toBeGreaterThan(1190);
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await sessionApp.boundingBox())!.width)
    .toBeLessThan(900);
  // Only the app-address configuration changes; the server and app stay live.
  instance.artifactServer.config.vhostPublicRoot = "apps.example";
  await page.goto(`${base}/projects/${projectId}/app?settings=1`);
  await page
    .getByRole("textbox", { name: "App name", exact: true })
    .fill("archer-garden");
  await page
    .getByRole("button", { name: "Reserve address", exact: true })
    .click();
  await expect(
    page.getByText("archer-garden.apps.example", { exact: true }),
  ).toBeVisible();
  await recordUiCapture(page, "project-app-address-1200");
  await page.setViewportSize({ width: 375, height: 812 });
  await recordUiCapture(page, "project-app-address-375");
});
