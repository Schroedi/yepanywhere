import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { createServer as createViteServer } from "vite";
import { createToolCommentaryRoutes } from "../../server/src/routes/tool-commentary";
import type { ProjectScanner } from "../../server/src/projects/scanner";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRequire = createRequire(join(root, "../server/package.json"));
const { getRequestListener } = serverRequire("@hono/node-server");
let vite: Awaited<ReturnType<typeof createViteServer>>;
let listener: ReturnType<typeof createServer>;
let directory: string;
let base: string;
let requests = 0;
const note = (text: string) => ({ _acli: { commentary: [{ text }] } });

test.beforeAll(async () => {
  const scratch = resolve(
    root,
    "../../.artifacts/ui-testing/2026-09-07-acli-commentary",
  );
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "project-"));
  await writeFile(join(directory, "report.md"), "# Result");
  const projectId = toUrlProjectId(directory);
  // ACLI_FIXTURE_JSON can supply actual producer output for a local smoke.
  const output = process.env.ACLI_FIXTURE_JSON
    ? (JSON.parse(await readFile(process.env.ACLI_FIXTURE_JSON, "utf8")) as {
        stdout: string;
        stderr: string;
      })
    : {
        stdout: [
          note("The report is ready. **Three checks passed.**"),
          {
            checks: [
              {
                name: "Links",
                status: "passed",
                ...note("[Report](./report.md) links resolve in this project."),
              },
              {
                name: "Math",
                status: "passed",
                ...note("The score is \\(x^2 + y^2 = 25\\)."),
              },
            ],
          },
          note("All checks completed."),
        ]
          .map((value) => JSON.stringify(value))
          .join("\n"),
        stderr: "# acli: 1 +commentary\n",
      };
  const routes = createToolCommentaryRoutes({
    scanner: {
      getProject: async (id: string) =>
        id === projectId ? { path: directory } : null,
    } as ProjectScanner,
  });
  const handle = getRequestListener(routes.fetch);
  process.env.VITE_DISABLE_ONBOARDING = "true";
  process.env.VITE_DISABLE_CLI_UPDATE_NOTIFICATIONS = "true";
  vite = await createViteServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: "mpa",
  });
  listener = createServer((req, res) => {
    if (req.url?.startsWith("/api/projects/")) {
      requests++;
      req.url = req.url.slice("/api/projects".length);
      void handle(req, res);
    } else if (
      req.url?.startsWith("/api/version") ||
      req.url === "/api/fixture"
    ) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url === "/api/fixture"
            ? { projectId, ...output }
            : { current: "0.8.2" },
        ),
      );
    } else vite.middlewares(req, res);
  });
  await new Promise<void>((ready) => listener.listen(0, "127.0.0.1", ready));
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("Missing browser fixture port");
  base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (listener) {
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (vite) await vite.close();
  if (directory) await rm(directory, { recursive: true });
});

test("renders through the endpoint and keeps context outside transcript geometry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      errors.push(message.text());
  });
  const archive = resolve(
    root,
    "../../.artifacts/ui-testing/2026-09-07-acli-commentary",
  );
  for (const [name, width, height] of [
    ["desktop", 1000, 600],
    ["phone", 375, 812],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/e2e/fixtures/acli-commentary.html`);
    await expect(
      page.getByRole("button", { name: "Open tool output" }),
    ).toHaveCount(1);
    await expect(page.locator(".katex")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Report" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(archive, `${name}.png`) });
    const before = await page.locator("main").boundingBox();
    await page
      .getByRole("button", { name: "Show commentary context" })
      .first()
      .click();
    await expect(
      page.getByRole("dialog", { name: "Show commentary context" }),
    ).toContainText("Links");
    expect(await page.locator("main").boundingBox()).toEqual(before);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({ path: join(archive, `${name}-context.png`) });
    await page
      .getByRole("button", { name: "Close commentary context" })
      .click();
    await page.getByRole("button", { name: "Open tool output" }).click();
    await expect(page.getByRole("button", { name: /minimize/i })).toBeVisible();
    await page.getByRole("button", { name: /minimize/i }).click();
    await expect(
      page.getByRole("button", { name: "Open tool output" }),
    ).toBeVisible();
  }
  expect(requests).toBe(2);
  expect(errors).toEqual([]);
  const before = requests;
  await page.evaluate(() =>
    localStorage.setItem("yep-anywhere-acli-commentary-enabled", "false"),
  );
  await page.reload();
  await expect(page.getByText("report --jsonl", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open tool output" }),
  ).toHaveCount(0);
  expect(requests).toBe(before);
});
