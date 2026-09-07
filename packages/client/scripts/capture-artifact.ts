import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { CaptureOptions } from "./artifact-capture";

const help = `Usage: pnpm -s artifact:capture <index.html|http(s)://...> [options]

Capture an already-built artifact at 1000×600 and 375×812. Requires the
checkout's Node/pnpm dependencies and Playwright Chromium. Install the browser
with: pnpm --filter @yep-anywhere/client exec playwright install chromium

  --out <directory>       New output directory; defaults to .artifacts/captures/<unique-id> in this checkout
  --ya-url <origin>       Optional YA server origin; without it, make no YA requests
  --audience <value>      local (default) or public; used only with --ya-url
  --ya-headers <file>     JSON request headers for YA authentication only; never sent to artifacts
  --ready-selector <css>  Wait for a visible element before capturing
  --timeout-ms <number>   Per-operation deadline, default 30000
  --allow-network        Allow requests outside the document origin; default blocks and reports them
  --format <value>       jsonl (default), json (pretty), or markdown
  --json, --compact      Explicit compact JSON; takes precedence over --text
  --pretty               Pretty JSON
  --text                 Markdown handoff text
  --full                 Results are already complete; accepted for agent callers
  --acli-quiet           Omit the stderr capability banner
  -h, --help             Show this help

Local files use a fresh browser-only HTTP origin rooted at the entry directory;
no listening port or YA server is required. Existing output is never overwritten.
--ya-url checks capability/configuration before probing or creating a grant.
Disabled/unconfigured delivery skips those requests and captures locally.
Explicit hosting failures are errors; retry without --ya-url for local captures.
URL input uses that existing URL without creating or renewing a grant.
YA must see the same absolute file path when requesting a grant.

Duration: seconds, blocking. Stdout: one complete JSON result or Markdown.
Files: desktop.png, phone.png, capture.json, links.md. Inspect both PNGs before
presenting links.md; a successful capture does not judge the design or test clicks.
Exit: 0 complete; 2 invalid arguments; 3 capture, delivery, or filesystem failure.
Errors are JSON on stderr. No prompts, shared-server restarts, or browser reuse.
acli: 1
`;

export function parseCaptureArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      out: { type: "string" },
      "ya-url": { type: "string" },
      audience: { type: "string" },
      "ya-headers": { type: "string" },
      "ready-selector": { type: "string" },
      "timeout-ms": { type: "string" },
      "allow-network": { type: "boolean" },
      format: { type: "string" },
      json: { type: "boolean" },
      compact: { type: "boolean" },
      pretty: { type: "boolean" },
      text: { type: "boolean" },
      full: { type: "boolean" },
      "acli-quiet": { type: "boolean" },
    },
  });
  if (values.help) return { help: true as const };
  if (positionals.length !== 1)
    throw new Error("Supply exactly one HTML file or HTTP(S) URL");
  if (values.audience && !["local", "public"].includes(values.audience))
    throw new Error("--audience must be local or public");
  if ((values.audience || values["ya-headers"]) && !values["ya-url"])
    throw new Error("--audience and --ya-headers require --ya-url");
  if (values["ya-url"] && /^https?:\/\//i.test(positionals[0]!))
    throw new Error("--ya-url applies only to local HTML input");
  const timeoutMs = Number(values["timeout-ms"] ?? 30000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000)
    throw new Error("--timeout-ms must be an integer from 1 to 300000");
  if (values.format && !["jsonl", "json", "markdown"].includes(values.format))
    throw new Error("--format must be jsonl, json, or markdown");
  const format =
    values.json || values.compact
      ? "jsonl"
      : values.pretty
        ? "json"
        : (values.format ?? (values.text ? "markdown" : "jsonl"));
  const options: CaptureOptions = {
    input: positionals[0]!,
    out: values.out,
    yaUrl: values["ya-url"],
    audience: values.audience as "local" | "public" | undefined,
    readySelector: values["ready-selector"],
    timeoutMs,
    allowNetwork: values["allow-network"],
  };
  return {
    help: false as const,
    options,
    format,
    headersFile: values["ya-headers"],
    quiet: values["acli-quiet"],
  };
}

async function main() {
  let failureCode = 2;
  try {
    const args = parseCaptureArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(help);
      return;
    }
    if (!args.quiet && !process.env.ACLI_QUIET)
      process.stderr.write("# acli: 1\n");
    if (args.headersFile) {
      const content = await readFile(args.headersFile, "utf8");
      let headers: unknown;
      try {
        headers = JSON.parse(content);
      } catch {
        throw new Error("--ya-headers must contain valid JSON");
      }
      if (
        !headers ||
        typeof headers !== "object" ||
        Array.isArray(headers) ||
        Object.values(headers).some((value) => typeof value !== "string")
      )
        throw new Error(
          "--ya-headers must contain a JSON object with string values",
        );
      args.options.yaHeaders = headers as Record<string, string>;
    }
    failureCode = 3;
    const { captureArtifact } = await import("./artifact-capture");
    const result = await captureArtifact(args.options);
    process.stdout.write(
      `${args.format === "markdown" ? result.markdown : JSON.stringify(result, null, args.format === "json" ? 2 : undefined)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        exit_code: failureCode,
        error: {
          code: failureCode === 2 ? "usage" : "data",
          message: error instanceof Error ? error.message : String(error),
        },
      })}\n`,
    );
    process.exitCode = failureCode;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main();
