import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type InlineConfig } from "vite";

/** Concurrent fixture servers must not invalidate each other's optimized modules. */
export async function createTestViteServer(config: InlineConfig) {
  const directory = await mkdtemp(join(tmpdir(), "ya-e2e-vite-"));
  // Keep optimized dependencies under node_modules so React/Babel does not
  // process them again as application source.
  const cacheDir = join(directory, "node_modules", ".vite");
  try {
    const server = await createServer({
      ...config,
      cacheDir,
      define: {
        "import.meta.env.VITE_DISABLE_ONBOARDING": JSON.stringify("true"),
        "import.meta.env.VITE_DISABLE_CLI_UPDATE_NOTIFICATIONS":
          JSON.stringify("true"),
        ...config.define,
      },
    });
    const close = server.close.bind(server);
    server.close = async () => {
      try {
        await close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };
    return server;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
