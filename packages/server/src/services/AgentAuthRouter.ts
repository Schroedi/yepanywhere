import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SessionMetadataService } from "../metadata/SessionMetadataService.js";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";

export interface RouterLaunch {
  bindingId: string;
  accountId: string;
  baseUrl: string;
  token: string;
}
interface Connection {
  id: string;
  token: string;
  socketPath: string;
  routerId: string;
  state: "pairing" | "connected" | "revocation-pending" | "disconnected";
}
interface Allocation {
  cancelled?: boolean;
  cancellationAcknowledged?: boolean;
  id: string;
  connectionId: string;
  accountId: string;
  provider: "claude" | "codex";
  model: string;
  token: string;
}
interface PrivateState {
  version: 1;
  connection?: Connection;
  allocations: Record<string, Allocation>;
}
interface Info {
  protocol: number;
  routerId: string;
  inferenceOrigin: string;
  capabilities: string[];
}
export interface RouterAccount {
  id: string;
  provider: "claude" | "codex";
  enabled: boolean;
  renewal: string;
}
export interface RouterModel {
  id: string;
  name: string;
  contextWindow?: number;
}
export class RouterUnavailable extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const token = (prefix: string) =>
  prefix + randomBytes(32).toString("base64url");
export function validateRouterSocket(socketPath: string): void {
  if (process.platform === "win32")
    throw new RouterUnavailable(409, "Local router requires macOS or Linux");
  for (const [path, socket] of [
    [dirname(socketPath), false],
    [socketPath, true],
  ] as const) {
    const st = lstatSync(path);
    if (
      st.isSymbolicLink() ||
      (socket ? !st.isSocket() : !st.isDirectory()) ||
      st.uid !== process.getuid?.() ||
      st.mode & 0o077
    )
      throw new RouterUnavailable(
        409,
        "Router socket must be private and owned by the server user",
      );
  }
}
/** No fetch fallback: control traffic can only use the verified Unix socket. */
export async function routerRequest<T>(
  socketPath: string,
  path: string,
  credential?: string,
  body?: object,
): Promise<T> {
  validateRouterSocket(socketPath);
  return new Promise<T>((resolveResult, reject) => {
    const request = http.request(
      {
        socketPath,
        path,
        method: body ? "POST" : "GET",
        headers: {
          host: "localhost",
          "content-type": "application/json",
          ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        },
      },
      (response) => {
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024)
            response.destroy(new Error("oversized response"));
          else chunks.push(chunk);
        });
        response.on("error", () =>
          reject(new RouterUnavailable(503, "Router response unavailable")),
        );
        response.on("end", () => {
          if (response.statusCode !== 200)
            return reject(
              new RouterUnavailable(
                response.statusCode ?? 503,
                response.statusCode === 401
                  ? "Router connection revoked"
                  : "Router rejected the operation",
              ),
            );
          try {
            resolveResult(JSON.parse(Buffer.concat(chunks).toString()) as T);
          } catch {
            reject(new RouterUnavailable(502, "Invalid router response"));
          }
        });
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("deadline")),
      20_000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", () =>
      reject(
        new RouterUnavailable(
          503,
          "Router unavailable; check its local service",
        ),
      ),
    );
    request.end(body ? JSON.stringify(body) : undefined);
  });
}
export class AgentAuthRouter {
  private state: PrivateState;
  private readonly directory: string;
  private readonly file: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    dataDir: string,
    private readonly metadata?: SessionMetadataService,
  ) {
    this.directory = join(dataDir, "agent-auth-router");
    this.file = join(this.directory, "private.json");
    if (existsSync(this.directory)) {
      const directory = lstatSync(this.directory);
      if (
        !directory.isDirectory() ||
        (process.platform !== "win32" &&
          (directory.mode & 0o077 || directory.uid !== process.getuid?.()))
      )
        throw new Error("Insecure router credential directory");
    }
    if (existsSync(this.file)) {
      const st = lstatSync(this.file);
      if (
        !st.isFile() ||
        (process.platform !== "win32" &&
          (st.mode & 0o077 || st.uid !== process.getuid?.()))
      )
        throw new Error("Insecure router credential store");
      this.state = JSON.parse(readFileSync(this.file, "utf8")) as PrivateState;
      if (
        this.state.version !== 1 ||
        !this.state.allocations ||
        typeof this.state.allocations !== "object"
      )
        throw new Error("Invalid router credential store");
    } else this.state = { version: 1, allocations: {} };
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
  private async save(next: PrivateState): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const st = lstatSync(this.directory);
    if (
      st.isSymbolicLink() ||
      (process.platform !== "win32" &&
        (st.mode & 0o077 || st.uid !== process.getuid?.()))
    )
      throw new Error("Insecure router credential directory");
    await writeFileAtomically(this.file, JSON.stringify(next), {
      mode: 0o600,
      durable: true,
    });
    this.state = next;
  }
  summary() {
    const c = this.state.connection;
    return { state: c?.state ?? "disconnected", routerId: c?.routerId ?? null };
  }
  private connection(): Connection {
    const c = this.state.connection;
    if (c?.state !== "connected")
      throw new RouterUnavailable(
        409,
        "Connect the local router before launching this session",
      );
    return c;
  }
  private async info(
    c: Pick<Connection, "socketPath" | "routerId">,
  ): Promise<Info> {
    const info = await routerRequest<Info>(c.socketPath, "/v1/info");
    if (
      info.protocol !== 1 ||
      !info.capabilities?.includes("manual-bindings") ||
      (c.routerId && info.routerId !== c.routerId)
    )
      throw new RouterUnavailable(409, "Router identity or protocol mismatch");
    const origin = new URL(info.inferenceOrigin);
    if (
      origin.protocol !== "http:" ||
      !["127.0.0.1", "[::1]"].includes(origin.hostname) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw new RouterUnavailable(
        409,
        "Router inference endpoint must be loopback",
      );
    return info;
  }
  connect(socketPath?: string) {
    return this.serialize(async () => {
      const path = resolve(
        socketPath ?? join(homedir(), ".agent-auth-router", "control.sock"),
      );
      const previous = this.state.connection;
      if (previous?.state === "revocation-pending")
        throw new RouterUnavailable(409, "Finish pending disconnect first");
      const keep = previous && previous.state !== "disconnected";
      const info = await this.info({
        socketPath: path,
        routerId: keep ? previous.routerId : "",
      });
      const connection: Connection = keep
        ? { ...previous, socketPath: path }
        : {
            id: randomUUID(),
            token: token("aar_ctl_"),
            socketPath: path,
            routerId: info.routerId,
            state: "pairing",
          };
      await this.save({ ...this.state, connection });
      await routerRequest(path, "/v1/pair", undefined, {
        id: connection.id,
        name: "Yep Anywhere",
        tokenHash: hash(connection.token),
      });
      await this.save({
        ...this.state,
        connection: { ...connection, state: "connected" },
      });
      return this.summary();
    });
  }
  disconnect() {
    return this.serialize(async () => {
      const c = this.state.connection;
      if (!c || c.state === "disconnected") return this.summary();
      await this.save({
        ...this.state,
        connection: { ...c, state: "revocation-pending" },
      });
      await this.info(c);
      try {
        await routerRequest(c.socketPath, "/v1/disconnect", c.token, {});
      } catch (error) {
        if (!(error instanceof RouterUnavailable && error.status === 401))
          throw error;
      }
      await this.save({
        ...this.state,
        connection: { ...c, state: "disconnected" },
      });
      return this.summary();
    });
  }
  async accounts(): Promise<{ accounts: RouterAccount[] }> {
    const c = this.connection();
    await this.info(c);
    return routerRequest(c.socketPath, "/v1/accounts", c.token);
  }
  async catalog(accountId: string): Promise<{ models: RouterModel[] }> {
    const c = this.connection();
    await this.info(c);
    return routerRequest(c.socketPath, "/v1/catalog", c.token, { accountId });
  }
  async quotas(accountId: string): Promise<unknown> {
    const c = this.connection();
    await this.info(c);
    return routerRequest(c.socketPath, "/v1/quotas", c.token, { accountId });
  }
  private async flushCancellations(c: Connection): Promise<void> {
    for (const allocation of Object.values(this.state.allocations)) {
      if (
        allocation.connectionId !== c.id ||
        !allocation.cancelled ||
        allocation.cancellationAcknowledged
      )
        continue;
      await routerRequest(c.socketPath, "/v1/bindings/cancel", c.token, {
        id: allocation.id,
      });
      await this.save({
        ...this.state,
        allocations: {
          ...this.state.allocations,
          [allocation.id]: { ...allocation, cancellationAcknowledged: true },
        },
      });
    }
  }
  /** Failed fresh launches never leave a usable credential intentionally retained. */
  cancel(sessionId: string): Promise<void> {
    return this.serialize(async () => {
      const ref = this.metadata?.getMetadata(sessionId)?.routerBinding;
      const allocation = ref && this.state.allocations[ref.id];
      if (!allocation) return;
      await this.save({
        ...this.state,
        allocations: {
          ...this.state.allocations,
          [allocation.id]: { ...allocation, cancelled: true },
        },
      });
      const c = this.connection();
      await this.info(c);
      await this.flushCancellations(c);
    });
  }
  async launch(
    sessionId: string,
    provider: string,
    model: string | undefined,
    accountId?: string,
  ): Promise<RouterLaunch | undefined> {
    return this.serialize(async () => {
      const existing = this.metadata?.getMetadata(sessionId)?.routerBinding;
      if (!existing && !accountId) return undefined;
      if (!this.metadata || (provider !== "claude" && provider !== "codex"))
        throw new RouterUnavailable(
          409,
          "Router requires a retained native Claude or Codex session",
        );
      const c = this.connection(),
        info = await this.info(c);
      await this.flushCancellations(c);
      let allocation = existing
        ? this.state.allocations[existing.id]
        : undefined;
      if (
        existing &&
        (!allocation ||
          allocation.connectionId !== c.id ||
          existing.routerId !== c.routerId)
      )
        throw new RouterUnavailable(
          409,
          "This session lost its router binding; it cannot use a different account",
        );
      if (allocation?.cancelled)
        throw new RouterUnavailable(
          409,
          "This failed launch was cancelled; create a new session",
        );
      if (
        allocation &&
        (allocation.provider !== provider ||
          (accountId && allocation.accountId !== accountId))
      )
        throw new RouterUnavailable(409, "Session account pin cannot change");
      if (!allocation) {
        if (!model || !accountId)
          throw new RouterUnavailable(
            400,
            "Choose a router account and catalog model",
          );
        allocation = {
          id: randomUUID(),
          connectionId: c.id,
          accountId,
          provider,
          model,
          token: token("aar_"),
        };
        await this.save({
          ...this.state,
          allocations: {
            ...this.state.allocations,
            [allocation.id]: allocation,
          },
        });
        await this.metadata.updateMetadata(sessionId, {
          routerBinding: {
            id: allocation.id,
            routerId: c.routerId,
            accountId,
            provider,
          },
        });
      }
      if (model && model !== allocation.model) {
        const catalog = await this.catalog(allocation.accountId);
        if (!catalog.models.some((m) => m.id === model))
          throw new RouterUnavailable(
            409,
            "Model is unavailable for the pinned account",
          );
      }
      await routerRequest(c.socketPath, "/v1/bindings/prepare", c.token, {
        id: allocation.id,
        provider,
        accountId: allocation.accountId,
        model: allocation.model,
        tokenHash: hash(allocation.token),
      });
      await routerRequest(c.socketPath, "/v1/bindings/commit", c.token, {
        id: allocation.id,
      });
      return {
        bindingId: allocation.id,
        accountId: allocation.accountId,
        baseUrl: `${info.inferenceOrigin}/${provider}`,
        token: allocation.token,
      };
    });
  }
}
