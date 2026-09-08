// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer, resolveConfig } from "vite";
import { describe, expect, it, vi } from "vitest";

describe("Vite dependency cache isolation", () => {
  it("keeps local and remote dependency graphs in separate directories", async () => {
    const root = process.cwd();
    const local = await resolveConfig(
      { root, configFile: resolve(root, "vite.config.ts") },
      "serve",
    );
    const remote = await resolveConfig(
      { root, configFile: resolve(root, "vite.config.remote.ts") },
      "serve",
    );

    expect(local.cacheDir).not.toBe(remote.cacheDir);
    expect(local.server.strictPort).toBe(true);
  });

  it("notifies about source changes in manual reload mode", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "ya-vite-notify-"));
    vi.stubEnv("NO_FRONTEND_RELOAD", "true");
    vi.stubEnv("PORT", "4999");
    vi.stubEnv("VITE_API_PORT", undefined);
    const notify = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response());
    const root = process.cwd();
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      server = await createServer({
        root,
        configFile: resolve(root, "vite.config.ts"),
        cacheDir: resolve(directory, "node_modules/.vite"),
        server: { middlewareMode: true, watch: null },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      const send = vi.spyOn(server.hot, "send");
      server.watcher.emit(
        "change",
        resolve(root, "src/lib/clientSummaryStore.ts"),
      );
      await expect.poll(() => notify.mock.calls.length).toBe(1);
      expect(notify).toHaveBeenCalledWith(
        "http://localhost:4999/api/dev/frontend-changed",
        expect.objectContaining({ method: "POST" }),
      );
      expect(send).not.toHaveBeenCalled();
    } finally {
      await server?.close();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true });
    }
  });
});
