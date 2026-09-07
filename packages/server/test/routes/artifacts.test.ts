import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ArtifactServer } from "../../src/artifacts/ArtifactServer.js";
import { createLocalResourcePathPolicy } from "../../src/routes/local-resource-policy.js";
import { createApp } from "../setup/create-app.js";
import { MockClaudeSDK } from "../../src/sdk/mock.js";
import { initFileAccess } from "../../src/middleware/file-access.js";
import {
  updateAllowedHosts,
  isAllowedOrigin,
} from "../../src/middleware/allowed-hosts.js";
import {
  readArtifactConfig,
  validateArtifactConfig,
} from "../../src/artifacts/config.js";
import { createServer, request } from "node:http";
import { getRequestListener } from "@hono/node-server";

let directory: string;
afterEach(async () => {
  vi.restoreAllMocks();
  if (directory) await rm(directory, { recursive: true });
  directory = "";
});

it("serves an authorized HTML directory with executable bytes and revocable access", async () => {
  directory = await mkdtemp(join(tmpdir(), "ya-artifact-"));
  const root = join(directory, "mockup");
  await mkdir(root);
  await writeFile(join(root, "index.html"), '<script src="app.js"></script>');
  await writeFile(join(root, "app.js"), 'document.title = "working";');
  const server = new ArtifactServer(
    { port: 4402, localOrigin: "http://artifacts.localhost:4402" },
    createLocalResourcePathPolicy({ allowedPaths: [directory] }),
  );
  const grant = await server.createGrant(join(root, "index.html"), "local");
  const html = await server.app.request(grant.url);
  expect(html.status).toBe(200);
  expect(html.headers.get("content-type")).toContain("text/html");
  expect(html.headers.get("content-security-policy")).toContain(
    "sandbox allow-scripts allow-same-origin",
  );
  expect(await html.text()).toContain('<script src="app.js">');
  const script = await server.app.request(new URL("app.js", grant.url));
  expect(script.status).toBe(200);
  expect(script.headers.get("content-type")).toContain("javascript");
  expect(await script.text()).toContain('"working"');
  const range = await server.app.request(new URL("app.js", grant.url), {
    headers: { Range: "bytes=0-7" },
  });
  expect(range.status).toBe(206);
  expect(await range.text()).toBe("document");
  const head = await server.app.request(grant.url, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  for (const path of [
    "../secret.txt",
    "%2e%2e%2fsecret.txt",
    ".env",
    "app.js%00",
  ]) {
    expect(
      (await server.app.request(new URL(path, grant.url))).status,
    ).not.toBe(200);
  }
  expect(
    (await server.app.request(new URL("/api/version", grant.url))).status,
  ).toBe(404);
  expect((await server.app.request(grant.url, { method: "POST" })).status).toBe(
    405,
  );
  expect(
    (
      await server.app.request(grant.url, {
        headers: { Host: "localhost:4402" },
      })
    ).status,
  ).toBe(421);
  server.revoke(grant.id);
  expect((await server.app.request(grant.url)).status).toBe(404);
});

it("routes the artifact Host on YA's actual HTTP port before YA APIs", async () => {
  directory = await mkdtemp(join(tmpdir(), "ya-artifact-host-"));
  await writeFile(join(directory, "index.html"), "<h1>Isolated</h1>");
  initFileAccess({
    uploadsDir: directory,
    homeDir: directory,
    tempPaths: [directory],
    envPaths: [directory],
  });
  const instance = createApp({
    sdk: new MockClaudeSDK(),
    dataDir: join(directory, "data"),
    projectsDir: join(directory, "sessions"),
    artifacts: {
      port: 4402,
      localOrigin: "http://artifacts.localhost:3400",
    },
  });
  const listener = createServer(getRequestListener(instance.app.fetch));
  await new Promise<void>((ready) => listener.listen(0, "127.0.0.1", ready));
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener port");
  const port = address.port;
  const get = (path: string, host: string, origin?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          headers: { Host: host, ...(origin ? { Origin: origin } : {}) },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  try {
    const grant = await instance.artifactServer.createGrant(
      join(directory, "index.html"),
      "local",
    );
    expect(
      await get(new URL(grant.url).pathname, "artifacts.localhost:3400"),
    ).toMatchObject({ status: 200, body: "<h1>Isolated</h1>" });
    expect((await get("/health", "artifacts.localhost:3400")).body).toBe(
      '{"artifactViewer":1}',
    );
    for (const path of [
      "/api/version",
      "/public-api/shares/test",
      "/desktop-bootstrap",
      "/api/ws",
    ]) {
      expect((await get(path, "artifacts.localhost:3400")).status).toBe(404);
    }
    updateAllowedHosts("*");
    expect(
      (
        await get(
          "/api/version",
          "localhost:3400",
          "http://artifacts.localhost:3400",
        )
      ).status,
    ).toBe(403);
    expect((await get("/api/version", "localhost:3400", "null")).status).toBe(
      403,
    );
    expect(isAllowedOrigin("http://artifacts.localhost:9999")).toBe(false);
  } finally {
    updateAllowedHosts(undefined);
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    await instance.disposeSessionReaders();
  }
});

it("expires each link at its original lifetime after an expiry-only settings change", async () => {
  directory = await mkdtemp(join(tmpdir(), "ya-artifact-expiry-"));
  const entry = join(directory, "index.html");
  await writeFile(entry, "<h1>Expires</h1>");
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const server = new ArtifactServer(
    { port: 4402, localOrigin: "http://artifacts.localhost:3400" },
    createLocalResourcePathPolicy({ allowedPaths: [directory] }),
  );
  const original = await server.createGrant(entry, "local");
  expect(original.expiresAt).toBe(now + 24 * 3600_000);
  await server.configure({ ...server.config, expiryHours: 2 });
  const shorter = await server.createGrant(entry, "local");
  expect(shorter.expiresAt).toBe(now + 2 * 3600_000);
  clock.mockReturnValue(shorter.expiresAt - 1);
  expect(
    (await server.app.request(shorter.url, { method: "HEAD" })).status,
  ).toBe(200);
  clock.mockReturnValue(shorter.expiresAt);
  expect((await server.app.request(shorter.url)).status).toBe(404);
  expect(
    (await server.app.request(original.url, { method: "HEAD" })).status,
  ).toBe(200);
  await server.configure({ ...server.config, port: 4403 });
  expect((await server.app.request(original.url)).status).toBe(404);
  await server.close();
});

it("validates whole expiry hours and preserves the current setting for legacy writes", () => {
  expect(validateArtifactConfig({ port: 4402 }).expiryHours).toBe(24);
  expect(validateArtifactConfig({ port: 4402 }, 48).expiryHours).toBe(48);
  for (const expiryHours of [1, 168]) {
    expect(
      validateArtifactConfig({ port: 4402, expiryHours }).expiryHours,
    ).toBe(expiryHours);
  }
  for (const expiryHours of [0, 169, 1.5, "24", null, NaN]) {
    expect(() => validateArtifactConfig({ port: 4402, expiryHours })).toThrow(
      "whole hours",
    );
  }
});

it("keeps launch overrides explicit and rejects shared-loopback origins", () => {
  expect(readArtifactConfig({})).toBeUndefined();
  expect(
    readArtifactConfig({
      YEP_ARTIFACT_PORT: "0",
      YEP_ARTIFACT_PUBLIC_ORIGIN: "https://artifacts.example.org",
    }),
  ).toEqual({ port: 4402 });
  expect(() => validateArtifactConfig({ port: 0 })).toThrow();
  expect(() =>
    validateArtifactConfig({
      port: 4402,
      localOrigin: "http://localhost:4402",
    }),
  ).toThrow();
  expect(() =>
    validateArtifactConfig({
      port: 4402,
      publicOrigin: "http://artifacts.example.org",
    }),
  ).toThrow();
});
