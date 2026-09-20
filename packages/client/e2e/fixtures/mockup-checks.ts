import { expect, type Frame, type Page } from "@playwright/test";

export async function checkMockup(page: Page | Frame, state: string) {
  await expect(
    page.getByRole("heading", { name: "Project review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Sample projects" }).getByRole("listitem"),
  ).toHaveCount(16);
  await expect(page.getByRole("status")).toHaveText(
    state === "selected"
      ? "Settings selected: Yep Anywhere"
      : "Choose a project to review. Changes stay in this preview.",
  );
  expect(
    await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        font: [...document.fonts].some(
          (font) => font.family === "YA Inter" && font.status === "loaded",
        ),
        scrollable: document.documentElement.scrollHeight > innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
        icons: document.querySelectorAll("svg").length,
      };
    }),
    // Three per card: the settings gear, the overflow menu, and the caption
    // edit affordance added with project captions (topics/project-captions.md).
  ).toEqual({ font: true, scrollable: true, overflow: false, icons: 48 });
}
