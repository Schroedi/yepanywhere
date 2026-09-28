import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  projectServiceSchema,
  type ProjectServiceDeclaration,
} from "@yep-anywhere/shared";
import { z } from "zod";
import { isPathInsideDirectory } from "../routes/local-resource-policy.js";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";
import { ProjectServiceProcess } from "./ProjectServiceProcess.js";

const recordSchema = z.strictObject({
  generation: z.string().uuid(),
  declaration: projectServiceSchema,
  desired: z.enum(["running", "stopped"]),
  observed: z.enum(["starting", "running", "stopping", "stopped", "failed"]),
  updatedAt: z.string(),
  error: z.string().optional(),
});
type ServiceRecord = z.infer<typeof recordSchema>;
type LiveService = { record: ServiceRecord; process: ProjectServiceProcess };

/** Source files are untrusted and bounded; neither discovery nor status executes them. */
export async function readProjectService(
  projectPath: string,
): Promise<ProjectServiceDeclaration | null> {
  const root = await realpath(projectPath);
  let file: string;
  try {
    file = await realpath(join(root, ".project-template/app.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!isPathInsideDirectory(file, root))
    throw new Error("Service declaration escapes project");
  const handle = await open(file, "r");
  try {
    if (!(await handle.stat()).isFile())
      throw new Error("Service declaration must be a regular file");
    const bytes = Buffer.alloc(64 * 1024 + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead === bytes.length)
      throw new Error("Service declaration exceeds 64 KiB");
    const value = z
      .object({ service: projectServiceSchema.optional() })
      .parse(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")));
    return value.service ?? null;
  } finally {
    await handle.close();
  }
}

/** One bounded, sandboxed launch per project, with restart-safe observed state. */
export class ProjectServiceManager {
  private readonly live = new Map<string, LiveService>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private closed = false;
  private readonly directory: string;

  constructor(private readonly dataDir: string) {
    this.directory = join(dataDir, "project-services");
  }

  private file(projectId: string): string {
    return join(
      this.directory,
      `${createHash("sha256").update(projectId).digest("hex")}.json`,
    );
  }

  private async save(projectId: string, service: LiveService): Promise<void> {
    const record = {
      ...service.record,
      observed: service.process.state,
      error: service.process.error,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFileAtomically(this.file(projectId), JSON.stringify(record));
    service.record = record;
  }

  async status(projectId: string): Promise<ServiceRecord | null> {
    const live = this.live.get(projectId);
    if (live)
      return {
        ...live.record,
        observed: live.process.state,
        error: live.process.error,
      };
    try {
      const saved = recordSchema.parse(
        JSON.parse(await readFile(this.file(projectId), "utf8")),
      );
      if (["starting", "running", "stopping"].includes(saved.observed)) {
        return {
          ...saved,
          observed: "stopped",
          error:
            "Service interrupted by YA restart; start explicitly to launch again",
        };
      }
      return saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  upstream(
    projectId: string,
  ): { port: number; brokerSocket: string; generation: string } | null {
    const live = this.live.get(projectId);
    const brokerSocket = live?.process.brokerSocket;
    return live && brokerSocket
      ? {
          port: live.process.port,
          brokerSocket,
          generation: live.record.generation,
        }
      : null;
  }

  private serial<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const prior = this.operations.get(projectId) ?? Promise.resolve();
    const current = prior.then(operation, operation);
    this.operations.set(projectId, current);
    void current
      .finally(() => {
        if (this.operations.get(projectId) === current)
          this.operations.delete(projectId);
      })
      .catch(() => {}); // The request owns the error; this observer only releases its queue slot.
    return current;
  }

  start(
    projectId: string,
    projectPath: string,
    authorize: () => Promise<void>,
  ): Promise<ServiceRecord> {
    return this.serial(projectId, async () => {
      if (this.closed) throw new Error("Project services are shutting down");
      await authorize();
      const previous = this.live.get(projectId);
      if (previous?.process.state === "running")
        return (await this.status(projectId))!;
      // A failed stop still owns its process: retry termination before any replacement.
      if (previous) await previous.process.stop();
      const declaration = await readProjectService(projectPath);
      if (!declaration || !("start" in declaration))
        throw new Error("Project has no process service declaration");
      await authorize();
      if (this.closed) throw new Error("Project services are shutting down");
      if (!previous && this.live.size >= 32)
        throw new Error("Project service limit reached (32)");
      const service: LiveService = {
        record: {
          generation: randomUUID(),
          declaration,
          desired: "running",
          observed: "starting",
          updatedAt: new Date().toISOString(),
        },
        process: new ProjectServiceProcess({
          projectPath,
          cwd: declaration.where.cwd,
          argv: declaration.start.argv,
          portEnv: declaration.start.portEnv,
          readyPath: declaration.status.path,
          readyStatus: declaration.status.readyStatus,
          startupTimeoutMs: declaration.status.startupTimeoutMs,
          stopGraceMs: declaration.stop.graceMs,
          sandboxStateRoot: join(this.dataDir, "session-sandboxes"),
        }),
      };
      this.live.set(projectId, service);
      try {
        await this.save(projectId, service);
      } catch (error) {
        this.live.delete(projectId);
        throw error;
      }
      try {
        await service.process.start();
      } finally {
        await this.save(projectId, service);
      }
      return (await this.status(projectId))!;
    });
  }

  stop(
    projectId: string,
    authorize: () => Promise<void>,
  ): Promise<ServiceRecord | null> {
    return this.serial(projectId, async () => {
      await authorize();
      const service = this.live.get(projectId);
      if (!service) {
        const saved = await this.status(projectId);
        if (!saved) return null;
        const stopped = {
          ...saved,
          desired: "stopped" as const,
          updatedAt: new Date().toISOString(),
        };
        await writeFileAtomically(
          this.file(projectId),
          JSON.stringify(stopped),
        );
        return stopped;
      }
      service.record.desired = "stopped";
      try {
        await service.process.stop();
      } finally {
        await this.save(projectId, service);
      }
      this.live.delete(projectId);
      return this.status(projectId);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.operations.values());
    const stopped = await Promise.allSettled(
      [...this.live.keys()].map((projectId) =>
        this.stop(projectId, async () => {}),
      ),
    );
    const errors = stopped
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length)
      throw new AggregateError(errors, "Project services failed to stop");
  }
}

export async function projectServiceStaticEntry(
  projectPath: string,
  declaration: ProjectServiceDeclaration,
): Promise<string> {
  if (declaration.where.kind !== "static")
    throw new Error("Expected a static app");
  const root = await realpath(projectPath);
  const servingRoot = await realpath(resolve(root, declaration.where.root));
  const entry = await realpath(resolve(servingRoot, declaration.where.entry));
  if (
    (servingRoot !== root && !isPathInsideDirectory(servingRoot, root)) ||
    !isPathInsideDirectory(entry, servingRoot)
  )
    throw new Error("Static app escapes project");
  return entry;
}
