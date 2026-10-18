import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { flushRendezvousUserTurn } from "./rendezvous-activity.mjs";
import { getLogger } from "../logging/logger.js";
import type { ServerSettingsService } from "./ServerSettingsService.js";

export interface RendezvousSettings {
  enabled: boolean;
  projects: Record<string, boolean>;
  windowMs?: number;
  maxPerWindow?: number;
}

export function parseRendezvousSettings(value: unknown): RendezvousSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("rendezvous must be an object");
  }
  const fields = value as Record<string, unknown>;
  if (
    typeof fields.enabled !== "boolean" ||
    !fields.projects ||
    typeof fields.projects !== "object" ||
    Array.isArray(fields.projects)
  ) {
    throw new Error("rendezvous requires enabled and a projects map");
  }
  const projects = Object.entries(fields.projects);
  for (const [name, maximum] of [
    ["windowMs", 60000],
    ["maxPerWindow", 1000],
  ] as const) {
    const value = fields[name];
    if (
      value !== undefined &&
      (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > maximum)
    ) {
      throw new Error(
        `rendezvous.${name} must be an integer from 1 to ${maximum}`,
      );
    }
  }
  if (
    projects.length > 128 ||
    projects.some(
      ([path, enabled]) => !isAbsolute(path) || typeof enabled !== "boolean",
    )
  ) {
    throw new Error(
      "rendezvous.projects requires at most 128 absolute paths with boolean overrides",
    );
  }
  return {
    enabled: fields.enabled,
    projects: Object.fromEntries(projects) as Record<string, boolean>,
    windowMs: (fields.windowMs as number | undefined) ?? 1000,
    maxPerWindow: (fields.maxPerWindow as number | undefined) ?? 10,
  };
}

/** Own bounded project watchers; failed observers require a settings change to retry. */
export class RendezvousWatchService {
  private readonly children = new Map<
    string,
    { process: ChildProcess; closed: Promise<void>; limits: string }
  >();
  private readonly failed = new Set<string>();
  private readonly unsubscribe: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private work: Promise<void> = Promise.resolve();
  private scheduled = false;
  private busy = false;
  private closed = false;
  private settings: RendezvousSettings;

  constructor(
    settingsService: ServerSettingsService,
    private readonly listProjects: () => Promise<
      ReadonlyArray<{ path: string }>
    >,
    private readonly deliverToLiveSession: (
      project: string,
      sessionId: string,
      id: string,
      text: string,
    ) => boolean | undefined,
  ) {
    this.settings = settingsService.getSetting("rendezvous") ?? {
      enabled: false,
      projects: {},
    };
    this.unsubscribe = settingsService.onSettingsChanged(
      (settings, previous) => {
        if (settings.rendezvous === previous.rendezvous) return;
        this.settings = settings.rendezvous ?? { enabled: false, projects: {} };
        this.failed.clear();
        this.configure();
      },
    );
    this.configure();
  }

  private configure(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const enabled =
      this.settings.enabled ||
      Object.values(this.settings.projects).some(Boolean);
    if (enabled && process.platform !== "linux") {
      getLogger().warn(
        "Rendezvous monitoring requires Linux; use the explicit scan helper for completed transfers",
      );
      return;
    }
    if (enabled) {
      this.timer = setInterval(() => this.schedule(), 30_000);
      this.timer.unref();
    }
    this.schedule();
  }

  private schedule(): void {
    this.scheduled = true;
    if (this.busy || this.closed) return;
    this.busy = true;
    this.work = (async () => {
      while (this.scheduled && !this.closed) {
        this.scheduled = false;
        await this.reconcile();
      }
    })()
      .catch((error) => {
        getLogger().warn(
          { error: String(error) },
          "Rendezvous watcher reconciliation failed",
        );
      })
      .finally(() => {
        this.busy = false;
      });
  }

  private stop(child: ChildProcess): void {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  private async reconcile(): Promise<void> {
    if (this.closed) return;
    const configured = this.settings;
    const enabled =
      configured.enabled || Object.values(configured.projects).some(Boolean);
    const projects = enabled ? await this.listProjects() : [];
    if (this.closed || configured !== this.settings) return;
    const wanted = new Set<string>();
    const windowMs = configured.windowMs ?? 1000;
    const maxPerWindow = configured.maxPerWindow ?? 10;
    const limits = `${windowMs}:${maxPerWindow}`;
    for (const project of projects) {
      if (configured.projects[project.path] ?? configured.enabled) {
        wanted.add(project.path);
        if (wanted.size === 32) break;
      }
    }
    for (const [project, child] of this.children) {
      if (wanted.has(project) && child.limits === limits) continue;
      this.stop(child.process);
      await child.closed;
    }
    for (const project of wanted) {
      if (this.closed) return;
      if (this.children.has(project) || this.failed.has(project)) continue;
      const process = spawn(
        "rendez",
        [
          "--json",
          "--project",
          project,
          "watch",
          "--ya-stdio",
          "--window-ms",
          String(windowMs),
          "--max-per-window",
          String(maxPerWindow),
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
          detached: true,
        },
      );
      let diagnostics = "";
      const lines = createInterface({ input: process.stdout });
      lines.on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if (message.state === "watching") flushRendezvousUserTurn(project);
          if (message.type !== "delivery-request") {
            if (message.state === "failed" || message.state === "uncertain") {
              getLogger().warn(
                { projectPath: project, delivery: message },
                "Rendezvous upload was not confirmed",
              );
            }
            return;
          }
          const { id, target } = message.record;
          if (
            typeof id !== "string" ||
            typeof target.yaSessionId !== "string" ||
            typeof message.text !== "string"
          ) {
            throw new Error("Invalid rendezvous delivery request");
          }
          const accepted = this.deliverToLiveSession(
            project,
            target.yaSessionId,
            id,
            message.text,
          );
          process.stdin.write(
            `${JSON.stringify({ id, ...(accepted === undefined ? { provider: true } : { accepted }) })}\n`,
          );
        } catch (error) {
          getLogger().warn(
            { projectPath: project, error: String(error) },
            "Rendezvous delivery protocol failed",
          );
          this.stop(process);
        }
      });
      process.stdin.on("error", (error) => {
        diagnostics = error.message;
      });
      process.stderr?.on("data", (chunk: Buffer) => {
        diagnostics = (diagnostics + chunk.toString()).slice(-4096);
      });
      process.on("error", (error) => {
        diagnostics = error.message;
      });
      const closed = new Promise<void>((resolve) => {
        process.once("close", (code, signal) => {
          lines.close();
          this.children.delete(project);
          if (!this.closed && signal !== "SIGTERM") {
            this.failed.add(project);
            getLogger().warn(
              { projectPath: project, code, diagnostics },
              "Rendezvous watcher stopped; change its setting to retry",
            );
          }
          resolve();
        });
      });
      this.children.set(project, { process, closed, limits });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    if (this.timer) clearInterval(this.timer);
    await this.work;
    const children = [...this.children.values()];
    for (const child of children) this.stop(child.process);
    await Promise.all(children.map((child) => child.closed));
  }
}
