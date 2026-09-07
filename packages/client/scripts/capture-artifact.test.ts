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
        "<h1>Standalone CLI</h1>",
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
        ],
        { cwd: directory },
      );
      const data = JSON.parse(result.stdout);
      expect(data.kind).toBe("artifact-capture");
      expect(data.screenshots).toHaveLength(2);
      expect(result.stderr).toBe("# acli: 1\n");
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
      expect(usage.stdout).toContain("acli: 1");
      expect(usage.stderr).toBe("");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

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
