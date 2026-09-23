import { describe, expect, it, vi } from "vitest";
import {
  buildPlayableHtml,
  isInlinableReference,
  resolveShareReference,
} from "../publicSharePlay";

describe("public share play", () => {
  it("resolves references against the root's directory", () => {
    expect(resolveShareReference("_build/paper.html", "canvas.css")).toBe(
      "_build/canvas.css",
    );
    expect(resolveShareReference("_build/paper.html", "../img/a.png")).toBe(
      "img/a.png",
    );
    expect(resolveShareReference("_build/paper.html", "/site/x.js?v=1")).toBe(
      "site/x.js",
    );
    expect(isInlinableReference("https://cdn.example/x.js")).toBe(false);
    expect(isInlinableReference("//cdn.example/x.js")).toBe(false);
    expect(isInlinableReference("data:text/plain,x")).toBe(false);
    expect(isInlinableReference("#top")).toBe(false);
    expect(isInlinableReference("app.js")).toBe(true);
  });

  it("inlines served assets as data URLs and leaves the rest untouched", async () => {
    const fetchAsset = vi.fn(async (path: string) => {
      if (path === "_build/canvas.css")
        return new Blob(["body{color:red}"], { type: "text/css" });
      if (path === "_build/app.js")
        return new Blob(["console.log(1)"], { type: "text/javascript" });
      throw new Error("not served");
    });
    const html = await buildPlayableHtml(
      `<!doctype html><html><head><base href="/x/"><link rel="stylesheet" href="canvas.css"><script src="app.js"></script><script src="https://cdn.example/lib.js"></script></head><body><img src="missing.png"><p>Hi</p></body></html>`,
      "_build/paper.html",
      fetchAsset,
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toContain("<base");
    expect(html).toContain('href="data:text/css;base64,');
    expect(html).toContain('src="data:text/javascript;base64,');
    expect(html).toContain('src="https://cdn.example/lib.js"');
    expect(html).toContain('src="missing.png"');
    expect(fetchAsset).toHaveBeenCalledTimes(3);
  });
});
