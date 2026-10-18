import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import type { RendezvousSessions } from "../../src/services/RendezvousObserver.js";
import { RendezvousWatchService } from "../../src/services/RendezvousWatchService.js";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { subscribe } from "../../src/services/rendezvous-protocol.mjs";

const profile = { maxLongEdge: 2000, maxBytes: 4 * 1024 * 1024, quality: 85 };
const target = {
  harness: "claude",
  providerSessionId: "session-a",
  yaSessionId: "session-a",
  liveOnly: true,
};
// Uploads settle after one quiet second, so allow several.
const wait = { timeout: 8000, interval: 50 };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function readMarker(root: string) {
  return JSON.parse(await readFile(join(root, ".observer.json"), "utf8"));
}

async function harness(maxPerWindow = 10) {
  const project = await realpath(await mkdtemp(join(tmpdir(), "rendez-")));
  const root = join(project, ".rendez");
  const sent: Array<{ id: string; text: string }> = [];
  const sessions: RendezvousSessions = {
    async route() {
      return {
        transport: "ya",
        profile,
        async send(id, text) {
          sent.push({ id, text });
          return { accepted: true };
        },
      };
    },
    async turnStatus() {
      return null;
    },
  };
  const settings = new ServerSettingsService({ dataDir: project });
  await settings.initialize();
  let service: RendezvousWatchService | undefined;
  /** Apply settings afresh, which makes the service reconcile now. */
  const refresh = () =>
    settings.updateSettings({
      rendezvous: {
        enabled: true,
        projects: {},
        windowMs: 60_000,
        maxPerWindow,
      },
    });
  const start = async ({ owned = true } = {}) => {
    service = new RendezvousWatchService(
      settings,
      async () => [{ path: project }],
      sessions,
    );
    await refresh();
    if (owned) {
      await vi.waitFor(
        async () => expect((await readMarker(root)).pid).toBe(process.pid),
        wait,
      );
    }
  };
  const stop = async () => {
    await service?.close();
    service = undefined;
  };
  cleanups.push(async () => {
    await stop();
    await rm(project, { recursive: true, force: true });
  });
  return { root, sent, start, stop, refresh };
}

async function upload(inbox: string, name: string, bytes: Buffer) {
  // Senders publish completed files by renaming a hidden temporary.
  await writeFile(join(inbox, `.${name}.part`), bytes);
  await rename(join(inbox, `.${name}.part`), join(inbox, name));
}

async function records(root: string) {
  const directory = join(root, "delivered", "session-a");
  return Promise.all(
    (await readdir(directory))
      .filter((name) => !name.startsWith("."))
      .map(async (name) =>
        JSON.parse(
          await readFile(join(directory, name, "record.json"), "utf8"),
        ),
      ),
  );
}

it.skipIf(process.platform === "win32")(
  "delivers a prepared upload once, including across a restart",
  async () => {
    const { root, sent, start, stop } = await harness();
    await start();
    // A user turn through YA points latest-session at the session.
    await subscribe(root, target, { latest: true, receivedAt: 100 });
    const inbox = join(root, "latest-session");
    const original = await sharp({
      create: { width: 3000, height: 1200, channels: 3, background: "#58a" },
    })
      .png()
      .toBuffer();
    await upload(inbox, "screenshot.png", original);
    await vi.waitFor(() => expect(sent).toHaveLength(1), wait);
    const record = await vi.waitFor(async () => {
      const [record] = await records(root);
      expect(record).toMatchObject({
        state: "accepted",
        transport: "ya",
        width: 2000,
        height: 800,
        originalName: "screenshot.png",
      });
      return record;
    }, wait);
    expect(sent[0]?.text).toContain(
      `User uploaded files:\n- [screenshot.png](<${record.path}>)`,
    );
    expect(await readFile(join(inbox, "screenshot.png"))).toEqual(original);

    await stop();
    await start();
    // The restarted observer neither resends nor misses a changed upload.
    await writeFile(
      join(inbox, "screenshot.png"),
      await sharp({
        create: { width: 300, height: 200, channels: 3, background: "#a85" },
      })
        .png()
        .toBuffer(),
    );
    await vi.waitFor(() => expect(sent).toHaveLength(2), wait);
    expect((await records(root)).map((r) => r.width).sort()).toEqual([
      2000, 300,
    ]);
  },
  20_000,
);

it.skipIf(process.platform === "win32")(
  "holds a burst beyond the window budget and sends one notice",
  async () => {
    const { root, sent, start } = await harness(2);
    await start();
    const { path: inbox } = await subscribe(root, target);
    for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
      await upload(inbox, name, Buffer.from(name));
    }
    await vi.waitFor(() => expect(sent).toHaveLength(3), wait);
    await vi.waitFor(async () => {
      const states = (await records(root)).map((record) =>
        record.kind === "overload" ? "notice" : record.state,
      );
      expect(states.sort()).toEqual([
        "accepted",
        "accepted",
        "held",
        "held",
        "notice",
      ]);
    }, wait);
    expect(sent.map(({ text }) => text).join("\n")).toContain(
      "potentially unintentionally",
    );
  },
  20_000,
);

it.skipIf(process.platform !== "linux")(
  "defers to another live observer and never resends a claimed upload",
  async () => {
    const { root, sent, start, stop, refresh } = await harness();
    await start();
    await stop();
    const { path: inbox } = await subscribe(root, target);
    // A live observer elsewhere on this host serves the project.
    const other = {
      owner: "rendez watch --turns",
      host: hostname(),
      pid: process.ppid,
    };
    await writeFile(join(root, ".observer.json"), JSON.stringify(other));
    await upload(inbox, "notes.txt", Buffer.from("for the other observer"));
    await start({ owned: false });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(sent).toHaveLength(0);
    expect(await readMarker(root)).toEqual(other);
    // Once it is gone, the next check takes over and delivers.
    await rm(join(root, ".observer.json"));
    await refresh();
    await vi.waitFor(() => expect(sent).toHaveLength(1), wait);

    // A claimed upload whose sender stopped before recording an outcome
    // may already have been sent, so it becomes uncertain instead.
    const [record] = await records(root);
    await writeFile(
      join(root, "delivered", "session-a", record.id, "record.json"),
      JSON.stringify({ ...record, state: "pending" }),
    );
    await stop();
    await start();
    await vi.waitFor(
      async () => expect((await records(root))[0]?.state).toBe("uncertain"),
      wait,
    );
    expect(sent).toHaveLength(1);
  },
  20_000,
);
