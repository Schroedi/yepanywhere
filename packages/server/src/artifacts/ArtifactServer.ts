import { randomBytes, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, dirname, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getMimeType } from "hono/utils/mime";
import {
  isPathInsideDirectory,
  type createLocalResourcePathPolicy,
} from "../routes/local-resource-policy.js";
import { openMutableFileSnapshot } from "../routes/mutable-file-cache.js";
import type { ArtifactConfig } from "./config.js";
import { registerArtifactOrigins } from "../middleware/allowed-hosts.js";

const GRANT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_GRANTS = 256;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const ARTIFACT_CSP = [
  "sandbox allow-scripts allow-same-origin",
  "default-src 'self' data: blob: http: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http: https:",
  "style-src 'self' 'unsafe-inline' data: blob: http: https:",
  "connect-src 'self' http: https: ws: wss:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

interface Grant {
  id: string;
  token: string;
  root: string;
  entry: string;
  expiresAt: number;
  files: Set<string>;
}

export class ArtifactServer {
  readonly app = new Hono();
  private readonly grants = new Map<string, Grant>();
  private listener: Server | undefined;
  private listening = false;

  constructor(
    public config: ArtifactConfig,
    private readonly policy: ReturnType<typeof createLocalResourcePathPolicy>,
  ) {
    registerArtifactOrigins([config.localOrigin, config.publicOrigin]);
    this.app.use("*", async (c, next) => {
      if (!this.matchesHost(c.req.header("Host") ?? new URL(c.req.url).host))
        return c.text("Unknown artifact host", 421);
      c.header("Content-Security-Policy", ARTIFACT_CSP);
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Referrer-Policy", "no-referrer");
      c.header("Cache-Control", "no-store");
      c.header(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), payment=(), usb=(), serial=(), bluetooth=(), display-capture=()",
      );
      if (c.req.method !== "GET" && c.req.method !== "HEAD")
        return c.text("Read only", 405);
      await next();
    });
    this.app.get("/health", (c) => {
      c.header("Access-Control-Allow-Origin", "*");
      return c.json({ artifactViewer: 1 });
    });
    this.app.get("/a/:token/*", async (c) => {
      const grant = this.grants.get(c.req.param("token"));
      if (!grant || grant.expiresAt <= Date.now()) {
        if (grant) this.grants.delete(grant.token);
        return c.notFound();
      }
      const prefix = `/a/${grant.token}/`;
      const encoded = new URL(c.req.url).pathname.slice(prefix.length);
      let relative: string;
      try {
        relative = decodeURIComponent(encoded);
      } catch {
        return c.text("Invalid artifact path", 400);
      }
      if (
        !relative ||
        relative.includes("\\") ||
        relative.includes("\0") ||
        relative
          .split("/")
          .some((part) => part === ".." || part.startsWith("."))
      ) {
        return c.text("Invalid artifact path", 400);
      }
      const candidate = resolve(grant.root, relative);
      if (!isPathInsideDirectory(candidate, grant.root)) return c.notFound();
      let canonical: string;
      try {
        canonical = await realpath(candidate);
      } catch (error) {
        if (
          ["ENOENT", "ENOTDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          return c.notFound();
        throw error;
      }
      if (!isPathInsideDirectory(canonical, grant.root)) return c.notFound();
      const allowed = await this.policy.resolveAllowedFilePath(canonical);
      if (!allowed.ok) return c.text(allowed.error, allowed.status);
      if (!grant.files.has(canonical) && grant.files.size >= 1024)
        return c.text("Artifact file limit reached", 413);
      const snapshot = await openMutableFileSnapshot(canonical);
      if (!snapshot) return c.notFound();
      const { handle, stats } = snapshot;
      if (stats.size > MAX_FILE_BYTES) {
        await handle.close();
        return c.text("Artifact file exceeds 64 MiB", 413);
      }
      grant.files.add(canonical);
      const mime = getMimeType(canonical) ?? "application/octet-stream";
      c.header("Content-Type", mime);
      c.header("Accept-Ranges", "bytes");
      let start = 0;
      let end = stats.size - 1;
      const range = c.req.header("Range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match && (match[1] || match[2])) {
          start = match[1]
            ? Number(match[1])
            : Math.max(0, stats.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        }
        if (
          !match ||
          (!match[1] && !match[2]) ||
          start > end ||
          start >= stats.size ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end)
        ) {
          await handle.close();
          c.header("Content-Range", `bytes */${stats.size}`);
          return c.body(null, 416);
        }
        c.header("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      }
      c.header("Content-Length", String(Math.max(0, end - start + 1)));
      if (c.req.method === "HEAD" || stats.size === 0) {
        await handle.close();
        return c.body(null, range ? 206 : 200);
      }
      const stream = handle.createReadStream({ start, end, autoClose: true });
      return c.body(
        Readable.toWeb(stream) as ReadableStream,
        range ? 206 : 200,
      );
    });
  }

  get available(): boolean {
    return Boolean(this.config.localOrigin) || this.listening;
  }

  matchesHost(host: string): boolean {
    return [this.config.localOrigin, this.config.publicOrigin].some(
      (origin) => origin && new URL(origin).host === host.toLowerCase(),
    );
  }

  async configure(config: ArtifactConfig): Promise<void> {
    const previous = this.config;
    const wasListening = this.listening;
    if (config.port !== previous.port || !config.publicOrigin)
      await this.close();
    this.config = config;
    registerArtifactOrigins([config.localOrigin, config.publicOrigin]);
    try {
      if (!this.listening && config.publicOrigin) await this.start();
      this.grants.clear();
    } catch (error) {
      this.listener = undefined;
      this.config = previous;
      if (wasListening && !this.listening) await this.start();
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.listener) throw new Error("Artifact server already started");
    await new Promise<void>((resolveReady, reject) => {
      const listener = createServer(getRequestListener(this.app.fetch));
      this.listener = listener;
      listener.once("error", reject);
      listener.listen(this.config.port, "127.0.0.1", () => {
        listener.removeListener("error", reject);
        this.listening = true;
        resolveReady();
      });
    });
  }

  async close(): Promise<void> {
    this.listening = false;
    this.grants.clear();
    const listener = this.listener;
    this.listener = undefined;
    if (listener) {
      listener.closeAllConnections();
      await new Promise<void>((resolveClosed, reject) =>
        listener.close((error) => (error ? reject(error) : resolveClosed())),
      );
    }
  }

  async createGrant(filePath: string, audience: "local" | "public") {
    const origin =
      audience === "local" ? this.config.localOrigin : this.config.publicOrigin;
    if (!origin)
      throw new HTTPException(409, {
        message: `No ${audience} artifact origin configured`,
      });
    const allowed = await this.policy.resolveAllowedFilePath(filePath);
    if (!allowed.ok)
      throw new HTTPException(allowed.status, { message: allowed.error });
    if (
      ![".html", ".htm"].includes(
        extname(allowed.file.resolvedPath).toLowerCase(),
      )
    ) {
      throw new HTTPException(400, {
        message: "Artifact entry must be an HTML file",
      });
    }
    const now = Date.now();
    for (const [token, grant] of this.grants)
      if (grant.expiresAt <= now) this.grants.delete(token);
    if (this.grants.size >= MAX_GRANTS)
      throw new HTTPException(429, {
        message: "Close an artifact viewer before opening another",
      });
    const token = randomBytes(32).toString("base64url");
    const grant: Grant = {
      id: randomUUID(),
      token,
      root: dirname(allowed.file.resolvedPath),
      entry: basename(allowed.file.resolvedPath),
      expiresAt: now + GRANT_LIFETIME_MS,
      files: new Set(),
    };
    this.grants.set(token, grant);
    return {
      id: grant.id,
      url: `${origin}/a/${token}/${encodeURIComponent(grant.entry)}`,
      expiresAt: grant.expiresAt,
    };
  }

  revoke(id: string): void {
    for (const [token, grant] of this.grants)
      if (grant.id === id) this.grants.delete(token);
  }
}
