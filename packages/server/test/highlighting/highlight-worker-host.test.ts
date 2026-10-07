import { afterEach, describe, expect, it } from "vitest";
import { HighlightWorkerHost } from "../../src/highlighting/highlight-worker-host.js";
import { runIdleSweeps } from "../../src/lib/processIdleSweep.js";

function inlineWorker(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

const SILENT_WORKER = inlineWorker(
  'import { parentPort } from "node:worker_threads"; parentPort.on("message", () => {});',
);
const CRASHING_WORKER = inlineWorker(
  'import { parentPort } from "node:worker_threads"; parentPort.on("message", () => { throw new Error("boom"); });',
);

describe("HighlightWorkerHost", () => {
  const hosts: HighlightWorkerHost[] = [];
  function createHost(
    options: ConstructorParameters<typeof HighlightWorkerHost>[0],
  ): HighlightWorkerHost {
    const host = new HighlightWorkerHost(options);
    hosts.push(host);
    return host;
  }

  afterEach(async () => {
    await Promise.all(hosts.map((host) => host.close()));
    hosts.length = 0;
  });

  it("highlights with the code class and reports worker memory", async () => {
    const host = createHost({});
    const html = await host.highlight(
      "const x = 1;",
      "typescript",
      "language-typescript",
    );
    expect(html).toContain('<pre class="shiki css-variables"');
    expect(html).toContain('class="language-typescript"');
    expect(html).toContain("var(--shiki-");
    const stats = host.getStats();
    expect(stats).toMatchObject({ live: true, workersStarted: 1 });
    expect(stats.lastExternalBytes).toBeGreaterThan(0);
  });

  it("does not keep the process alive after a job", async () => {
    const countPorts = () =>
      process
        .getActiveResourcesInfo()
        .filter((resource) => resource === "MessagePort").length;
    const before = countPorts();
    const host = createHost({});
    await host.highlight("const x = 1;", "typescript");
    expect(countPorts()).toBe(before);
  });

  it("rejects an unknown language without losing the worker", async () => {
    const host = createHost({});
    await expect(host.highlight("x", "not-a-language")).rejects.toThrow();
    await expect(host.highlight("x = 1", "python")).resolves.toContain("<span");
    expect(host.getStats()).toMatchObject({
      workersStarted: 1,
      workersFailed: 0,
    });
  });

  it("finishes in-flight jobs on a retired worker and routes new jobs to a fresh one", async () => {
    const host = createHost({ maxJobs: 1 });
    const results = await Promise.all([
      host.highlight("a = 1", "python"),
      host.highlight("b = 2", "python"),
      host.highlight("c = 3", "python"),
    ]);
    for (const html of results) expect(html).toContain("<span");
    expect(host.getStats()).toMatchObject({
      live: false,
      workersStarted: 1,
      workersRetired: 1,
    });

    await host.highlight("d = 4", "python");
    expect(host.getStats()).toMatchObject({ live: false, workersStarted: 2 });
  });

  it("retires the worker past its external memory budget", async () => {
    const host = createHost({ maxExternalBytes: 1 });
    await host.highlight("a = 1", "python");
    await host.highlight("b = 2", "python");
    expect(host.getStats()).toMatchObject({
      workersStarted: 2,
      workersRetired: 2,
    });
  });

  it("retires an idle worker", async () => {
    const host = createHost({ idleMs: 60_000 });
    await host.highlight("a = 1", "python");
    runIdleSweeps(Date.now());
    expect(host.getStats().live).toBe(true);
    runIdleSweeps(Date.now() + 60_000);
    expect(host.getStats()).toMatchObject({ live: false, workersRetired: 1 });
  });

  it("terminates a stalled worker and rejects its jobs", async () => {
    const host = createHost({ stallMs: 50, workerUrl: SILENT_WORKER });
    const results = await Promise.allSettled([
      host.highlight("a", "python"),
      host.highlight("b", "python"),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(host.getStats()).toMatchObject({
      live: false,
      pendingJobs: 0,
      workersFailed: 1,
    });
  });

  it("rejects pending jobs when the worker crashes", async () => {
    const host = createHost({ workerUrl: CRASHING_WORKER });
    await expect(host.highlight("a", "python")).rejects.toThrow("boom");
    expect(host.getStats()).toMatchObject({ live: false, workersFailed: 1 });
  });
});
