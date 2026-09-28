import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

test.use({ serviceWorkers: "block" });

const templates = [
  {
    id: "app-canvas",
    title: "App canvas",
    description: "An interactive canvas to make your own.",
  },
  {
    id: "web-page",
    title: "Web page",
    description: "A page for an idea, a person, or a place.",
  },
  {
    id: "storybook",
    title: "Storybook",
    description: "Stories and pictures, one page at a time.",
  },
].map((item) => ({
  ...item,
  sourceId: "ya-default",
}));

// The browser boundary here is palette placement and real sequential input while
// choices refresh. Filesystem and retry semantics have server integration tests.
test("template palette preserves sequential input and inline state at desktop and phone widths", async ({
  page,
  baseURL,
}) => {
  // Optional capture input is the actual source library, never invented artwork.
  const artworkDirectory = process.env.YEP_E2E_TEMPLATE_ARTWORK_DIR;
  const choices = await Promise.all(
    templates.map(async (item) => ({
      ...item,
      icon: artworkDirectory
        ? `data:image/svg+xml;base64,${(await readFile(join(artworkDirectory, item.id, "icon.svg"))).toString("base64")}`
        : undefined,
    })),
  );
  await page.route("**/api/project-templates/choices", (route) =>
    route.fulfill({ json: { enabled: true, templates: choices } }),
  );
  for (const viewport of [
    { width: 1200, height: 600 },
    { width: 1000, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${baseURL}/projects`);
    await page
      .getByRole("button", { name: "Add Project", exact: true })
      .click();
    const form = page.getByRole("region", { name: "New project", exact: true });
    await expect(form.getByRole("radio")).toHaveCount(3);
    const name = form.getByRole("textbox", { name: "Name", exact: true });
    let typed = "";
    for (const character of "Sketch garden") {
      typed += character;
      await name.pressSequentially(character);
      await expect(name).toHaveValue(typed, { timeout: 100 });
    }
    await form
      .getByRole("textbox", { name: "What would you like to make?" })
      .fill("A place to sketch ideas together");
    await form.getByRole("radio", { name: /Storybook/ }).check();
    await expect(name).toHaveValue("Sketch garden");
    await form.scrollIntoViewIfNeeded();
    await recordUiCapture(page, `template-project-${viewport.width}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    await page.goto(`${baseURL}/new-session`);
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    const inline = page.getByRole("region", {
      name: "New project",
      exact: true,
    });
    await expect(inline.getByRole("radio")).toHaveCount(3);
    await inline
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("My story");
    await inline.getByRole("radio", { name: /Web page/ }).check();
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    await expect(inline).toBeHidden();
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    await expect(
      inline.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("My story");
    await expect(inline.getByRole("radio", { name: /Web page/ })).toBeChecked();
    await page
      .locator(".new-session-project-chooser")
      .evaluate((node) => node.scrollIntoView({ block: "start" }));
    await recordUiCapture(page, `template-session-${viewport.width}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("creates a fresh template project through the real UI and retains the operation after reload", async ({
  page,
  request,
  baseURL,
}) => {
  test.skip(
    process.env.USE_MOCK_SDK !== "true",
    "This launch test requires the isolated mock provider, never the developer's provider credentials.",
  );
  const source = join(e2ePaths.tempDir, "template-source");
  const template = join(source, "templates", "starter");
  await mkdir(template, { recursive: true });
  await writeFile(
    join(source, "library.json"),
    JSON.stringify({ formatVersion: 1, bases: [], templates: ["starter"] }),
  );
  await writeFile(
    join(template, "template.json"),
    JSON.stringify({
      formatVersion: 1,
      kind: "template",
      status: "ready",
      id: "starter",
      title: "Starter",
      description: "A working static starter",
      extends: [],
      files: [
        { from: "setup.mjs", to: "setup.mjs" },
        { from: "app.json", to: ".project-template/app.json" },
        { from: "prepare.md", to: ".project-template/PREPARE.md" },
      ],
      overrides: [],
    }),
  );
  await writeFile(
    join(template, "setup.mjs"),
    'import {mkdirSync,writeFileSync} from "node:fs"; mkdirSync("dist"); writeFileSync("dist/index.html", "<h1>Starter ready</h1>");',
  );
  await writeFile(
    join(template, "app.json"),
    JSON.stringify({
      kind: "static",
      dir: "dist",
      setup: [process.execPath, "setup.mjs"],
      build: [process.execPath, "setup.mjs"],
      test: [process.execPath, "--version"],
      preview: [process.execPath, "--version"],
      prepare: ".project-template/PREPARE.md",
    }),
  );
  await writeFile(
    join(template, "prepare.md"),
    "Read the user intent and prepare the project.",
  );
  const headers = {
    "Content-Type": "application/json",
    "X-Yep-Anywhere": "true",
  };
  const previous = await (
    await request.get(`${baseURL}/api/project-template-source`, { headers })
  ).json();
  try {
    const configured = await request.put(
      `${baseURL}/api/project-template-source`,
      {
        headers,
        data: {
          enabled: true,
          sources: [
            {
              id: "browser",
              repository: source,
              contentPath: "",
              revision: "HEAD",
            },
          ],
        },
      },
    );
    expect(configured.status()).toBe(202);
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`${baseURL}/api/project-template-source`, {
                headers,
              })
            ).json()
          ).phase,
      )
      .toBe("ready");
    await page.goto(`${baseURL}/projects`);
    await page
      .getByRole("button", { name: "Add Project", exact: true })
      .click();
    const form = page.getByRole("region", { name: "New project", exact: true });
    await expect(form.getByRole("radio")).toHaveCount(1);
    await form
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Browser garden");
    await form
      .getByRole("textbox", { name: "What would you like to make?" })
      .fill("A garden sketchbook");
    await form
      .getByRole("textbox", { name: "Create in", exact: true })
      .fill(e2ePaths.tempDir);
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/project-templates/operations") &&
        response.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Create & prepare" }).click();
    const operation = await (await response).json();
    await page.reload();
    await page
      .getByRole("button", { name: "Add Project", exact: true })
      .click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/sessions\/[^/]+$/);
    const outcome = await (
      await request.get(
        `${baseURL}/api/project-templates/operations/${operation.request.operationId}`,
        { headers },
      )
    ).json();
    expect(outcome.phase).toBe("started");
    expect(
      await readFile(
        join(e2ePaths.tempDir, "browser-garden", "dist/index.html"),
        "utf8",
      ),
    ).toContain("Starter ready");
  } finally {
    const restored = await request.put(
      `${baseURL}/api/project-template-source`,
      { headers, data: previous.config },
    );
    expect(restored.ok()).toBe(true);
  }
});
