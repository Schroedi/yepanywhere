import { chromium } from "@playwright/test";

const url = process.argv[2];
const widths = (process.argv[3] ?? "1000").split(",").map(Number);
const shot = process.argv[4];

const browser = await chromium.launch();
for (const width of widths) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const heading = document.querySelector(
      ".markdown-preview .markdown-rendered h1",
    );
    return {
      viewer: box(".file-viewer"),
      info: box(".file-viewer-info"),
      actions: box(".file-viewer-actions"),
      path: box(".file-viewer-path"),
      h1: heading
        ? {
            font: getComputedStyle(heading).fontSize,
            line: getComputedStyle(heading).lineHeight,
            h: Math.round(heading.getBoundingClientRect().height),
          }
        : null,
    };
  });
  console.log(width, JSON.stringify(info));
  if (shot) await page.screenshot({ path: `${shot}-${width}.png` });
  await page.close();
}
await browser.close();
