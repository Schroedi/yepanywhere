/** Owned-emulator acceptance matrix. Each child owns its server, relay and cleanup. */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

if (!/^emulator-\d+$/.test(process.env.ANDROID_SERIAL ?? ""))
  throw new Error(
    "Select the owned emulator with ANDROID_SERIAL; physical devices are refused",
  );
const cases = [
  ["direct-session-read", "direct", "session", "in-flight"],
  ["mux-session-read", "mux", "session", "in-flight"],
  ["direct-inbox-disconnect", "direct", "inbox", "disconnect"],
  ["mux-inbox-outage", "mux", "inbox", "outage"],
  ["direct-session-wake", "direct", "session", "wake-outage"],
];
const selected = process.env.YA_LIFECYCLE_CASES?.split(",");
if (selected?.some((name) => !cases.some(([id]) => id === name)))
  throw new Error("Unknown YA_LIFECYCLE_CASES name");
const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const out = join(
  root,
  "tasks/source-lifecycle-study",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-android-acceptance`,
);
await mkdir(out, { recursive: true });
const results = [];
for (const [name, route, surface, fault] of cases) {
  if (selected && !selected.includes(name)) continue;
  console.log(`Checking ${name}…`);
  const log = createWriteStream(join(out, `${name}.log`));
  const directory = join(out, name);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--conditions",
      "source",
      fileURLToPath(new URL("run.mjs", import.meta.url)),
      "--client=android",
      `--route=${route}`,
      `--surface=${surface}`,
      `--fault=${fault}`,
      "--verify=true",
      `--out=${directory}`,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const code = await new Promise((done, fail) => {
    child.once("error", fail);
    child.once("close", done);
  });
  log.end();
  await finished(log);
  const evidence = await readFile(join(directory, "result.json"), "utf8")
    .then(JSON.parse)
    .catch(() => null);
  const result = {
    name,
    passed: code === 0 && evidence?.acceptance?.passed === true,
    failures: evidence?.acceptance?.failures ?? ["No completed result"],
    directory,
    recoveryMs: evidence?.firstHealthyAt
      ? evidence.firstHealthyAt - evidence.restoredAt
      : null,
  };
  results.push(result);
  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${name}: ${result.failures.join("; ") || `${result.recoveryMs} ms to observed recovery`}`,
  );
  await writeFile(join(out, "matrix.json"), JSON.stringify(results, null, 2));
}
console.log(`Evidence: ${out}`);
if (results.some((result) => !result.passed)) process.exitCode = 1;
