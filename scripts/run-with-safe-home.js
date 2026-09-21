#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exitIfUnsafeHome } from "./safe-home.js";

const rawArgs = process.argv.slice(2);
let stdinNull = false;
let temporaryHomeRequested = false;
while (rawArgs[0]?.startsWith("--")) {
  const option = rawArgs.shift();
  if (option === "--stdin-null") {
    stdinNull = true;
    continue;
  }
  if (option === "--temporary-home") {
    temporaryHomeRequested = true;
    continue;
  }
  console.error(`Unknown run-with-safe-home option: ${option}`);
  process.exit(1);
}
const [command, ...args] = rawArgs;

if (!command) {
  console.error(
    "Usage: node scripts/run-with-safe-home.js [--stdin-null] [--temporary-home] <command> [args...]",
  );
  process.exit(1);
}

exitIfUnsafeHome({ entrypoint: command });

const temporaryRoot = temporaryHomeRequested
  ? mkdtempSync(join(tmpdir(), "yep-anywhere-test-"))
  : undefined;
const temporaryHome = temporaryRoot ? join(temporaryRoot, "home") : undefined;
const temporaryDirectory = temporaryRoot
  ? join(temporaryRoot, "tmp")
  : undefined;
if (temporaryHome && temporaryDirectory) {
  mkdirSync(temporaryHome);
  mkdirSync(temporaryDirectory);
}
let cleaned = false;
function cleanupTemporaryHome() {
  if (!temporaryRoot || cleaned) return;
  cleaned = true;
  rmSync(temporaryRoot, { recursive: true, maxRetries: 3, retryDelay: 100 });
}

// Node 24+ on Windows requires shell:true to spawn .cmd files (CVE-2024-27980).
// DEP0190 warns about unescaped args, but args come from package.json scripts, not user input.
const isWindows = process.platform === "win32";

const child = spawn(command, args, {
  stdio: [stdinNull ? "ignore" : "inherit", "inherit", "inherit"],
  env: temporaryHome
    ? {
        ...process.env,
        HOME: temporaryHome,
        USERPROFILE: temporaryHome,
        TMPDIR: temporaryDirectory,
        TEMP: temporaryDirectory,
        TMP: temporaryDirectory,
      }
    : process.env,
  ...(isWindows ? { shell: true } : {}),
});

child.on("exit", (code, signal) => {
  cleanupTemporaryHome();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  cleanupTemporaryHome();
  console.error(`Failed to start ${command}: ${error.message}`);
  process.exit(1);
});
