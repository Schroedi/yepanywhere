// Complete the client build in dist/ as a loadable Manifest V3 extension.
// `pnpm build:extension` runs the client's extension and worker Vite builds
// first.

import { execFileSync } from "node:child_process";
import { copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const dist = resolve(packageRoot, "dist");

// The store identity: its public key gives unpacked builds the store's id.
const identity = JSON.parse(
  await readFile(
    resolve(repoRoot, "docs/distribution/chrome-extension/identity.json"),
    "utf8",
  ),
);

// Chrome versions are one to four integers; v0.9.2-814-g1234 becomes 0.9.2.814.
const described = execFileSync(
  "git",
  ["describe", "--tags", "--always", "--match", "v[0-9]*.[0-9]*.[0-9]*"],
  { cwd: repoRoot, encoding: "utf8" },
).trim();
const match = /^v(\d+)\.(\d+)\.(\d+)(?:-(\d+)-g[0-9a-f]+)?/.exec(described);
const version = match
  ? [match[1], match[2], match[3], match[4] ?? "0"].map(Number).join(".")
  : "0.0.0.0";

await rename(resolve(dist, "remote.html"), resolve(dist, "index.html"));
// Web-host files the extension does not use. The web app manifest would also
// collide with the extension's manifest.json.
for (const name of ["sw.js", "_headers", "debug-streaming.html"]) {
  await rm(resolve(dist, name), { force: true });
}
for (const name of ["options.html", "options.js"]) {
  await copyFile(resolve(packageRoot, "src", name), resolve(dist, name));
}

const manifest = {
  manifest_version: 3,
  name: "Yep Anywhere",
  description: "Supervise your coding agents from the browser.",
  version,
  version_name: described.replace(/^v/, ""),
  key: identity.key,
  icons: { 128: "icon-192.png" },
  action: {
    default_title: "Yep Anywhere",
    default_icon: { 128: "icon-192.png" },
  },
  background: { service_worker: "background.js", type: "module" },
  side_panel: { default_path: "sidepanel.html" },
  options_page: "options.html",
  // None of these shows an install warning (docs/tactical/151 design rule).
  // activeTab lets a toolbar click read that one page's address.
  permissions: ["sidePanel", "storage", "activeTab"],
  // Requested per site from the side panel or options, never at install:
  // reading a granted site's addresses drives automatic lookup.
  optional_host_permissions: ["https://*/*", "http://*/*"],
};
await writeFile(
  resolve(dist, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Extension ${version} (${described}) assembled in ${dist}`);
