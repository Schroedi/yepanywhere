import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test("ticket refresh gestures stay compact and typing stays immediate during refresh", async ({
  page,
  baseURL,
}) => {
  const requests: boolean[] = [];
  let active = false;
  let checks = 0;
  await page.route("**/api/settings", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      json: {
        ...body,
        settings: {
          ...body.settings,
          issueAssociations: { enabled: true, scope: "viewed", recentDays: 7 },
        },
      },
    });
  });
  await page.route("**/api/issues?*", (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 50 }, (_, n) => ({
          id: `jira:example.atlassian.net:ASR-${n + 1}`,
          key: `ASR-${n + 1}`,
          title: n
            ? `Speech recognition improvement ${n}`
            : "Search for a decent ASR model for Lao",
          url: `https://example.atlassian.net/browse/ASR-${n + 1}`,
          provider: "jira",
          kind: "issue",
          sessionCount: 3,
          unresolved: false,
        })),
        contentRefresh: {
          active,
          checked: checks++,
          skipped: 7,
          failed: 0,
          error: null,
        },
        coverage: {
          settings: { enabled: true, scope: "viewed", recentDays: 7 },
          active: false,
          error: null,
          counts: [],
        },
        nextOffset: 50,
      },
    }),
  );
  await page.route("**/api/issues/refresh", async (route) => {
    requests.push(route.request().postDataJSON().force);
    await route.fulfill({ json: {} });
  });
  await page.route("**/api/issues/sessions?*", (route) =>
    route.fulfill({ json: { sessions: [], nextOffset: null } }),
  );
  await page.route("**/api/issues/content?*", (route) =>
    route.fulfill({
      json: {
        content: {
          body: "Search for a decent ASR model for Lao.\nEg:\nhttps://huggingface.co/SiangLao/hubert-lao-asr",
        },
      },
    }),
  );
  await page.goto(`${baseURL}/issues`);
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await expect(
    page.getByText("Search for a decent ASR model for Lao", { exact: true }),
  ).toBeVisible();
  await refresh.click();
  await expect.poll(() => requests).toEqual([false]);
  await refresh.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Recheck all tickets, ignoring cache age" })
    .click();
  await expect.poll(() => requests).toEqual([false, true]);
  await refresh.focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", {
      name: "Recheck all tickets, ignoring cache age",
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  for (const viewport of [
    { width: 1000, height: 600 },
    { width: 1200, height: 600 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    const search = page.getByRole("searchbox");
    const input = await search.boundingBox();
    const button = await refresh.boundingBox();
    const settings = await page
      .getByRole("link", { name: "Indexing settings" })
      .boundingBox();
    expect(button?.width).toBe(44);
    expect(button?.height).toBe(44);
    expect(Math.abs((input?.y ?? 0) - (button?.y ?? 0))).toBeLessThan(5);
    expect((settings?.x ?? 0) + (settings?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width,
    );
    await recordUiCapture(page, `issues-refresh-${viewport.width}`);
  }
  // The common menu owner must suppress the click synthesized after a hold.
  await refresh.dispatchEvent("pointerdown", {
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 285,
    clientY: 90,
  });
  await expect(
    page.getByRole("menuitem", {
      name: "Recheck all tickets, ignoring cache age",
    }),
  ).toBeVisible();
  await refresh.dispatchEvent("pointerup", { pointerType: "touch" });
  await recordUiCapture(page, "issues-refresh-phone-menu");
  await page
    .getByRole("menuitem", { name: "Recheck all tickets, ignoring cache age" })
    .click();
  await expect.poll(() => requests).toEqual([false, true, true]);
  active = true;
  await refresh.click();
  const search = page.getByRole("searchbox");
  await search.focus();
  let typed = "";
  for (const char of "description search during refresh") {
    await page.keyboard.type(char);
    typed += char;
    await expect(search).toHaveValue(typed, { timeout: 100 });
  }
  active = false;
  await page
    .getByRole("button", { name: /ASR-1 .*Search for a decent/ })
    .click();
  await expect(
    page.getByText("https://huggingface.co/SiangLao/hubert-lao-asr", {
      exact: false,
    }),
  ).toBeVisible();
  await recordUiCapture(page, "issues-description-phone");
});
