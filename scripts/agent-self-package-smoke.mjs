import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "ya-agent installed package "));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const options = {
  cwd: directory,
  encoding: "utf8",
  shell: process.platform === "win32",
};
try {
  const packed = JSON.parse(
    execFileSync(
      npm,
      ["pack", resolve(root, "dist/npm-package"), "--json", "--ignore-scripts"],
      options,
    ),
  );
  execFileSync(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      join(directory, packed[0].filename),
    ],
    { ...options, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      join(root, "scripts/agent-self-smoke.mjs"),
      join(directory, "node_modules", packed[0].name),
    ],
    { stdio: "inherit", timeout: 30000 },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
