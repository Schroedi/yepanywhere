import { isAbsolute } from "node:path";
import { getLogger } from "../logging/logger.js";
import {
  RendezvousConflictError,
  RendezvousObserver,
  type RendezvousSessions,
  type RendezvousWatchBudget,
} from "./RendezvousObserver.js";
import { flushRendezvousUserTurn } from "./rendezvous-activity.mjs";
import type { ServerSettingsService } from "./ServerSettingsService.js";

const MAX_OBSERVED_PROJECTS = 32;
// Each project needs one watch for its routes plus one per subscribed route.
const MAX_DIRECTORY_WATCHES = 1024;

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

/**
 * Own bounded in-process project observers. A failed observer requires a
 * settings change to retry; a project another observer already serves is
 * retried on the next check, so a restart overlap resolves itself.
 */
export class RendezvousWatchService {
  private readonly observers = new Map<
    string,
    { observer: RendezvousObserver; limits: string }
  >();
  private readonly failed = new Set<string>();
  private readonly conflicted = new Set<string>();
  private readonly budget: RendezvousWatchBudget = {
    used: 0,
    limit: MAX_DIRECTORY_WATCHES,
  };
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
    private readonly sessions: RendezvousSessions,
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
    if (enabled && process.platform === "win32") {
      getLogger().warn(
        "Rendezvous monitoring needs POSIX symlinks and is unavailable on Windows",
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

  private async retire(project: string): Promise<void> {
    const entry = this.observers.get(project);
    if (!entry) return;
    this.observers.delete(project);
    await entry.observer.close();
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
        if (wanted.size === MAX_OBSERVED_PROJECTS) break;
      }
    }
    for (const [project, entry] of this.observers) {
      if (wanted.has(project) && entry.limits === limits) {
        // Pick up subscriptions whose route events were missed.
        await entry.observer.rescanRoutes();
        continue;
      }
      await this.retire(project);
    }
    for (const project of wanted) {
      if (this.closed) return;
      if (this.observers.has(project) || this.failed.has(project)) continue;
      const observer = new RendezvousObserver(project, {
        windowMs,
        maxPerWindow,
        sessions: this.sessions,
        budget: this.budget,
        onFailure: (error) => {
          this.failed.add(project);
          getLogger().warn(
            { projectPath: project, error: String(error) },
            "Rendezvous watcher stopped; change its setting to retry",
          );
          void this.retire(project);
        },
      });
      this.observers.set(project, { observer, limits });
      try {
        await observer.start();
        this.conflicted.delete(project);
        flushRendezvousUserTurn(project);
      } catch (error) {
        await this.retire(project);
        if (error instanceof RendezvousConflictError) {
          if (!this.conflicted.has(project)) {
            this.conflicted.add(project);
            getLogger().warn(
              { projectPath: project, error: error.message },
              "Rendezvous watching deferred: another observer serves this project",
            );
          }
          continue;
        }
        this.failed.add(project);
        getLogger().warn(
          { projectPath: project, error: String(error) },
          "Rendezvous watcher stopped; change its setting to retry",
        );
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    if (this.timer) clearInterval(this.timer);
    await this.work;
    await Promise.all(
      [...this.observers.keys()].map((project) => this.retire(project)),
    );
  }
}
