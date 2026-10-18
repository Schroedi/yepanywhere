import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { RendezvousWatchService } from "../../src/services/RendezvousWatchService.js";

it.skipIf(process.platform !== "linux")(
  "owns watchers only for live projects and delivers without a provider host",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rendez-service-"));
    const marker = join(root, "ack.json");
    const executable = join(root, "rendez");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
console.log(JSON.stringify({type:'delivery-request',record:{id:'upload-1',target:{yaSessionId:'session-1'}},text:'uploaded'}));
createInterface({input:process.stdin}).on('line',line=>writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,args:process.argv.slice(2),reply:JSON.parse(line)})));
`,
      { mode: 0o700 },
    );
    // The child is an external helper boundary; the settings and lifecycle are real.
    vi.stubEnv("PATH", `${root}:${process.env.PATH}`);
    let service: RendezvousWatchService | undefined;
    try {
      const settings = new ServerSettingsService({ dataDir: root });
      await settings.initialize();
      let live: Array<{ path: string }> = [];
      const delivered: string[] = [];
      service = new RendezvousWatchService(
        settings,
        async () => live,
        (project, session, _id, text) => {
          delivered.push(`${project}:${session}:${text}`);
          return true;
        },
      );
      await settings.updateSettings({
        rendezvous: { enabled: true, projects: {} },
      });
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
      live = [{ path: root }];
      await settings.updateSettings({
        rendezvous: { enabled: true, projects: {} },
      });
      let pid = 0;
      await vi.waitFor(async () => {
        const result = JSON.parse(await readFile(marker, "utf8"));
        expect(result.reply).toEqual({ id: "upload-1", accepted: true });
        expect(result.args).toContain("--max-per-window");
        pid = result.pid;
      });
      expect(delivered).toEqual([`${root}:session-1:uploaded`]);
      const previousPid = pid;
      await settings.updateSettings({
        rendezvous: {
          enabled: true,
          projects: {},
          windowMs: 250,
          maxPerWindow: 2,
        },
      });
      await vi.waitFor(async () => {
        const result = JSON.parse(await readFile(marker, "utf8"));
        expect(result.pid).not.toBe(previousPid);
        expect(result.args.slice(-4)).toEqual([
          "--window-ms",
          "250",
          "--max-per-window",
          "2",
        ]);
        pid = result.pid;
      });
      expect(() => process.kill(previousPid, 0)).toThrow();
      live = [];
      await settings.updateSettings({
        rendezvous: { enabled: true, projects: {} },
      });
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    } finally {
      await service?.close();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true });
    }
  },
);
