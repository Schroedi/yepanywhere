import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ArtifactServer } from "../../src/artifacts/ArtifactServer.js";
import { ProjectAppDelivery } from "../../src/artifacts/ProjectAppDelivery.js";
import { ProjectAppStore } from "../../src/projects/ProjectAppStore.js";
import { ProjectServiceManager } from "../../src/projects/ProjectServiceManager.js";
import { createLocalResourcePathPolicy } from "../../src/routes/local-resource-policy.js";
import { probeSessionSandboxAvailability } from "../../src/session-sandbox.js";

const directory = resolve(import.meta.dirname, "../../../../.artifacts");
await mkdir(directory, { recursive: true });
const root = await realpath(
  await mkdtemp(join(directory, "project-app-delivery-")),
);
const available =
  (await probeSessionSandboxAvailability({ stateRoot: join(root, "probe") }))
    .state === "available";
afterAll(() => rm(root, { recursive: true }));

describe("sandbox project app delivery", { timeout: 25_000 }, () => {
  let services: ProjectServiceManager | undefined;
  let artifacts: ArtifactServer | undefined;
  let store: ProjectAppStore | undefined;
  afterEach(async () => {
    await services?.close();
    await artifacts?.close();
    await store?.close();
    services = undefined;
    artifacts = undefined;
    store = undefined;
  });
  async function fixture(basePath: boolean) {
    const project = await mkdtemp(join(root, "project-"));
    const data = await mkdtemp(join(root, "data-"));
    await mkdir(join(project, ".project-template"));
    await writeFile(
      join(project, ".project-template/app.json"),
      JSON.stringify({
        service: {
          version: 1,
          where: { kind: "process", cwd: ".", entry: "/" },
          start: { argv: [process.execPath, "server.mjs"], portEnv: "PORT" },
          status: {
            probe: "http",
            path: "/health",
            readyStatus: 200,
            startupTimeoutMs: 5000,
          },
          stop: { signal: "SIGTERM", graceMs: 3000 },
          serving: {
            target: "sandbox-loopback",
            protocol: "http",
            ...(basePath ? { basePathEnv: "APP_BASE_PATH" } : {}),
          },
        },
      }),
    );
    await writeFile(
      join(project, "server.mjs"),
      `import { createServer } from 'node:http';
const base = process.env.APP_BASE_PATH || '/';
createServer((req, res) => {
  if (req.url === base + 'health') return res.end('ready');
  if (!req.url.startsWith(base)) { res.writeHead(404); return res.end(); }
  if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
  res.setHeader('content-type', 'application/json');
  res.setHeader('set-cookie', 'app-cookie=hidden; Path=/');
  res.end(JSON.stringify({ url: req.url, headers: req.headers, base }));
}).listen(Number(process.env.PORT), '127.0.0.1');
`,
    );
    services = new ProjectServiceManager(data);
    store = new ProjectAppStore(data);
    artifacts = new ArtifactServer(
      {
        port: 4402,
        localOrigin: "http://artifacts.localhost:4402",
        publicOrigin: "https://artifacts.example",
      },
      createLocalResourcePathPolicy({ allowedPaths: [project] }),
    );
    const delivery = new ProjectAppDelivery(artifacts, services, store);
    artifacts.setProjectAppDelivery(delivery);
    await services.start("project", project, async () => {});
    return { delivery, services, artifacts, store };
  }
  const native = available ? it : it.skip;
  it("serves a private static reservation through a contained artifact grant", async () => {
    const project = await mkdtemp(join(root, "static-"));
    const entry = join(project, "index.html");
    await writeFile(entry, "<h1>Reserved canvas</h1>");
    const data = await mkdtemp(join(root, "static-data-"));
    services = new ProjectServiceManager(data);
    store = new ProjectAppStore(data);
    artifacts = new ArtifactServer(
      { port: 4402, localOrigin: "http://artifacts.localhost:4402" },
      createLocalResourcePathPolicy({ allowedPaths: [project] }),
    );
    await store.reserve(
      {
        namespace: "localhost",
        name: "archer-static",
        projectId: "static",
        owner: "archer",
      },
      async () => {},
    );
    await store.setServing("static", "localhost", true, false, async () => ({
      allowed: false,
      superuser: false,
    }));
    let address: "redirect" | "frame" | undefined;
    const delivery = new ProjectAppDelivery(
      artifacts,
      services,
      store,
      async () => ({ entry, root: project, address }),
    );
    artifacts.setProjectAppDelivery(delivery);
    await delivery.ready;
    const host = "http://archer-static.localhost:4402/";
    expect((await artifacts.dispatchHost(new Request(host)))?.status).toBe(401);
    const token = artifacts.vhostAccess.token({
      name: "archer-static",
      projectId: "static",
    });
    // Default: redirect to the grant.
    const redirected = await artifacts.dispatchHost(
      new Request(`${host}?ya_access=${token}`),
    );
    expect(redirected?.status).toBe(302);
    expect(redirected?.headers.get("referrer-policy")).toBe("no-referrer");
    expect(
      await (
        await artifacts.app.request(redirected!.headers.get("location")!)
      ).text(),
    ).toBe("<h1>Reserved canvas</h1>");
    // A page navigation carried only by the access cookie is sent back to the
    // same URL with the token, so the address bar always shows a working
    // private link; subresources and token-bearing URLs are left alone.
    const cookie = redirected!.headers.get("set-cookie")!.split(";")[0]!;
    const navigate = (path: string, dest: string) =>
      artifacts.dispatchHost(
        new Request(`http://archer-static.localhost:4402${path}`, {
          headers: {
            cookie,
            "sec-fetch-mode": dest === "document" ? "navigate" : "no-cors",
            "sec-fetch-dest": dest,
          },
        }),
      );
    const revealed = await navigate("/notes.html?x=1", "document");
    expect(revealed?.status).toBe(302);
    expect(revealed?.headers.get("location")).toBe(
      `/notes.html?x=1&ya_access=${token}`,
    );
    const image = await navigate("/logo.png", "image");
    expect(image?.headers.get("location")).not.toContain("ya_access");
    // Opt-in frame mode keeps the reserved address in the location bar.
    address = "frame";
    const response = await artifacts.dispatchHost(
      new Request(`${host}?ya_access=${token}`),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("location")).toBeNull();
    expect(response?.headers.get("referrer-policy")).toBe("no-referrer");
    const frameSource = (page: string) =>
      /<iframe src="([^"]+)"/.exec(page)?.[1]?.replaceAll("&amp;", "&");
    const entrySource = frameSource(await response!.text());
    expect(entrySource).toBeDefined();
    expect(response?.headers.get("content-security-policy")).toContain(
      `frame-src ${new URL(entrySource!).origin}`,
    );
    expect(await (await artifacts.app.request(entrySource!)).text()).toBe(
      "<h1>Reserved canvas</h1>",
    );
    // A deep link frames the same path under the grant's directory, and URL
    // normalization keeps dot segments from reaching any other grant.
    await writeFile(join(project, "notes.html"), "<h1>Notes</h1>");
    const grantDirectory = new URL(".", entrySource!).toString();
    for (const path of ["notes.html", "a/../../notes.html"]) {
      const deep = await artifacts.dispatchHost(
        new Request(
          `http://archer-static.localhost:4402/${path}?ya_access=${token}`,
        ),
      );
      const source = frameSource(await deep!.text())!;
      expect(source.startsWith(grantDirectory)).toBe(true);
      expect(await (await artifacts.app.request(source)).text()).toBe(
        "<h1>Notes</h1>",
      );
    }
    expect(await services.status("static")).toBeNull();
  });
  native(
    "serves HTTP on an isolated bearer path without a vhost, strips credentials and revokes on stop",
    async () => {
      const { delivery, services, artifacts } = await fixture(true);
      expect(artifacts.config.vhostPublicRoot).toBeUndefined();
      const view = await delivery.open("project", "public");
      expect(new URL(view.url).origin).toBe("https://artifacts.example");
      const response = await artifacts.app.request(new URL("api", view.url), {
        headers: {
          Cookie: "yep-anywhere-session=secret; other=secret",
          Authorization: "Bearer secret",
          "X-Desktop-Token": "secret",
          Referer: "https://ya.example/private",
        },
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.url).toBe(`${data.base}api`);
      expect(data.headers.cookie).toBeUndefined();
      expect(data.headers.authorization).toBeUndefined();
      expect(data.headers["x-desktop-token"]).toBeUndefined();
      expect(data.headers.referer).toBeUndefined();
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("content-security-policy")).toContain(
        "sandbox allow-scripts",
      );
      expect(response.headers.get("content-security-policy")).not.toContain(
        "allow-same-origin",
      );
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(
        (await artifacts.app.request(view.url, { method: "DELETE" })).status,
      ).toBe(204);
      expect(
        (await artifacts.app.request(view.url, { method: "HEAD" })).status,
      ).toBe(200);
      expect(
        await artifacts.dispatchHost(
          new Request(`http://localhost:4402${new URL(view.url).pathname}`),
        ),
      ).toBeNull();
      await services.stop("project", async () => {});
      expect((await artifacts.app.request(view.url)).status).toBe(404);
    },
  );
  native(
    "uses the same sandbox on a private host and retains a stopped reservation",
    async () => {
      const { delivery, services, artifacts, store } = await fixture(false);
      const view = await delivery.open("project", "local");
      const response = await artifacts.dispatchHost(new Request(view.url));
      expect(response?.status).toBe(200);
      expect((await response!.json()).headers.cookie).toBeUndefined();
      await store.reserve(
        {
          namespace: "localhost",
          name: "archer-canvas",
          projectId: "project",
          owner: "archer",
        },
        async () => {},
      );
      await delivery.refreshHosts();
      const token = artifacts.vhostAccess.token({
        name: "archer-canvas",
        projectId: "project",
      });
      const reservedUrl = `http://archer-canvas.localhost:4402/?ya_access=${token}`;
      expect(
        (await artifacts.dispatchHost(new Request(reservedUrl)))?.status,
      ).toBe(503);
      await store.setServing("project", "localhost", true, false, async () => ({
        allowed: false,
        superuser: false,
      }));
      expect(
        (await artifacts.dispatchHost(new Request(reservedUrl)))?.status,
      ).toBe(200);
      expect(
        (
          await artifacts.dispatchHost(
            new Request("http://archer-canvas.localhost:4402/"),
          )
        )?.status,
      ).toBe(401);
      await services.stop("project", async () => {});
      expect(
        (await artifacts.dispatchHost(new Request(reservedUrl)))?.status,
      ).toBe(503);
      expect(await store.reservations("project")).toMatchObject([
        { name: "archer-canvas", owner: "archer", serving: true },
      ]);
    },
  );
});
