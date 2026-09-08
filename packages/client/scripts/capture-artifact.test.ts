// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseCaptureArgs } from "./capture-artifact";

const exec = promisify(execFile);
const loader = createRequire(import.meta.url).resolve("tsx/esm");
const script = fileURLToPath(new URL("./capture-artifact.ts", import.meta.url));

describe("artifact capture command", () => {
  it("accepts standardized output flags and explicit hosting options", () => {
    expect(
      parseCaptureArgs([
        "index.html",
        "--json",
        "--full",
        "--text",
        "--ya-url",
        "http://localhost:3400",
        "--audience",
        "public",
      ]),
    ).toMatchObject({
      format: "jsonl",
      options: { input: "index.html", audience: "public" },
    });
    expect(parseCaptureArgs(["index.html", "--text"])).toMatchObject({
      format: "markdown",
      options: { commentary: false },
    });
    expect(parseCaptureArgs(["index.html", "--json"])).toMatchObject({
      options: { commentary: true },
    });
    expect(parseCaptureArgs(["index.html", "--no-commentary"])).toMatchObject({
      options: { commentary: false },
    });
  });

  it.each(
    [
      [],
      ["index.html", "--typo"],
      ["a.html", "b.html"],
      ["index.html", "--timeout-ms", "0"],
      ["index.html", "--format", "xml"],
      ["index.html", "--audience", "private"],
      ["index.html", "--audience", "public"],
      ["https://example.org/index.html", "--ya-url", "http://localhost:3400"],
    ].map((argv) => ({ argv })),
  )("rejects invalid arguments: $argv", ({ argv }) => {
    expect(() => parseCaptureArgs(argv)).toThrow();
  });

  it("runs from another working directory and emits parseable JSON plus Markdown files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ya-artifact-cli-"));
    try {
      await writeFile(
        join(directory, "page with spaces.html"),
        "<h1>Standalone CLI</h1><input aria-label=\"Reply\"><button onclick=\"document.querySelector('h1').textContent=document.querySelector('input').value;document.querySelector('h1').dataset.ready='yes'\">Submit</button>",
      );
      await writeFile(
        join(directory, "workflow with spaces.mjs"),
        `
        export default async ({ page, viewport }) => {
          await page.getByRole('textbox', { name: 'Reply' }).fill(viewport.name);
          await page.getByRole('button', { name: 'Submit' }).click();
          if (await page.locator('h1').textContent() !== viewport.name)
            throw new Error('Interaction did not reach the intended state');
        };
      `,
      );
      const result = await exec(
        process.execPath,
        [
          "--import",
          loader,
          script,
          "page with spaces.html",
          "--out",
          "captures",
          "--json",
          "--interact",
          "workflow with spaces.mjs",
          "--ready-selector",
          "[data-ready]",
        ],
        { cwd: directory },
      );
      const data = JSON.parse(result.stdout);
      expect(data.kind).toBe("artifact-capture");
      expect(data.screenshots).toHaveLength(2);
      expect(result.stderr).toBe("# acli: 1 +commentary\n");
      expect(data._acli.commentary).toHaveLength(2);
      expect(data._acli.commentary[0].text).toBe(data.markdown);
      expect(data._acli.commentary[1].text).toContain(
        "| desktop 1000×600 | phone 375×812 |",
      );
      for (const capture of data.screenshots) {
        expect(data._acli.commentary[1].text).toContain(
          `![${capture.name}](<${capture.path}>)`,
        );
      }
      const suppressed = await exec(
        process.execPath,
        [
          "--import",
          loader,
          script,
          "page with spaces.html",
          "--out",
          "data-only",
          "--no-commentary",
        ],
        { cwd: directory },
      );
      expect(JSON.parse(suppressed.stdout)._acli).toBeUndefined();
      expect(JSON.parse(suppressed.stdout).screenshots).toHaveLength(2);
      expect(
        await readFile(join(directory, "captures", "links.md"), "utf8"),
      ).toBe(`${data.markdown}\n`);
      for (const image of data.screenshots)
        expect((await readFile(image.path)).length).toBeGreaterThan(100);
      const usage = await exec(
        process.execPath,
        ["--import", loader, script, "--help"],
        { cwd: directory },
      );
      expect(usage.stdout.trim().split("\n").at(-1)).toBe(
        "acli: 1 +commentary",
      );
      expect(usage.stdout).toContain("this call\nitself presents");
      expect(usage.stderr).toBe("");
    } finally {
      await rm(directory, { recursive: true });
    }
    // Two real browser captures plus three CLI startups exceed the unit-test
    // default on CI runners; the capture command retains its own deadlines.
  }, 30_000);

  it("reports invalid invocation as a structured error without stdout", async () => {
    await expect(
      exec(process.execPath, ["--import", loader, script, "--bad-option"]),
    ).rejects.toMatchObject({
      code: 2,
      stdout: "",
      stderr: expect.stringContaining('"code":"usage"'),
    });
  });
});
