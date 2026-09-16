import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { ArtifactVhost } from "./vhosts.js";

const exec = promisify(execFile);
export const vhostAppControlAvailable =
  process.platform === "linux" && existsSync("/usr/bin/lsof");
interface Listener {
  pid: number;
  start: string;
  port: number;
  token: string;
}

async function identity(pid: number) {
  const info = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = info.slice(info.lastIndexOf(")") + 2).split(" ");
  return {
    parent: Number(fields[1]),
    start: fields[19]!,
    uid: (await stat(`/proc/${pid}`)).uid,
  };
}

/** Only a previously observed, same-user listener may be signalled. */
export class VhostAppControl {
  private listeners = new Map<string, Listener>();
  constructor(private readonly getVhosts: () => readonly ArtifactVhost[]) {}

  private row(name: string) {
    if (!vhostAppControlAvailable)
      throw new Error("App process control is unavailable on this host");
    const row = this.getVhosts().find((entry) => entry.name === name);
    if (!row) throw new Error("App vhost is no longer configured");
    return row;
  }

  private async listener(port: number): Promise<number | null> {
    let output: string;
    try {
      output = (
        await exec(
          "/usr/bin/lsof",
          ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
          { timeout: 3000, maxBuffer: 65536 },
        )
      ).stdout;
    } catch (error) {
      const failure = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      if (failure.code === 1 && !failure.stdout && !failure.stderr) return null;
      throw error;
    }
    const values = [...new Set(output.trim().split(/\s+/).map(Number))];
    if (
      values.length !== 1 ||
      !Number.isSafeInteger(values[0]) ||
      values[0]! <= 1
    )
      throw new Error("Cannot identify a unique app listener");
    return values[0]!;
  }

  async identify(name: string): Promise<{ token: string | null }> {
    const { port } = this.row(name);
    const pid = await this.listener(port);
    if (pid === null) {
      this.listeners.delete(name);
      return { token: null };
    }
    const processInfo = await identity(pid);
    if (processInfo.uid !== process.getuid!())
      throw new Error("App listener belongs to another user");
    // Never allow a vhost mapping to terminate YA or its launching ancestors.
    let ancestor = process.pid;
    while (ancestor > 1) {
      if (pid === ancestor)
        throw new Error("Refusing to stop YA or its parent process");
      ancestor = (await identity(ancestor)).parent;
    }
    const previous = this.listeners.get(name);
    if (
      previous?.pid === pid &&
      previous.start === processInfo.start &&
      previous.port === port
    )
      return { token: previous.token };
    const listener = {
      pid,
      start: processInfo.start,
      port,
      token: randomUUID(),
    };
    this.listeners.set(name, listener);
    return { token: listener.token };
  }

  async stop(name: string, token: string | null): Promise<void> {
    const { port } = this.row(name);
    const observed = this.listeners.get(name);
    const current = await this.identify(name);
    if (current.token === null) return;
    if (
      !token ||
      !observed ||
      observed.token !== token ||
      current.token !== token ||
      observed.port !== port
    )
      throw new Error(
        "App listener changed; reopen the app before trying again",
      );
    process.kill(observed.pid, "SIGTERM");
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const stillThere = await identity(observed.pid).then(
        (info) => info.start === observed.start,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (!stillThere) break;
    }
    if ((await this.listener(port)) === null) {
      this.listeners.delete(name);
      return;
    }
    throw new Error("App did not stop after SIGTERM");
  }
}
