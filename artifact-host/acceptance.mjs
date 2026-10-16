// Actual YA UI + real encrypted relay + deployed HTTPS content host.
// Run: pnpm exec tsx --conditions source artifact-host/acceptance.mjs --public-relay
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { createRequire } from "node:module";
import { hostname, tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { InstallService } from "../packages/server/src/services/InstallService.ts";
import { files } from "../research/content-worker-localhost-spike/fixture.mjs";
import {
  writeCapturePreview,
  emitCapturePreview,
} from "../packages/client/scripts/artifact-capture.ts";
const require = createRequire(
  new URL("../packages/client/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const native = process.argv.includes("--native-fallback");
const android = process.argv.includes("--android") || native;
const serial = process.env.ANDROID_SERIAL;
if (android && !serial?.startsWith("emulator-"))
  throw new Error(
    "--android requires an explicitly selected ANDROID_SERIAL emulator",
  );
const forwards = [];
let androidBrowser;
let androidPreferences;
const chromePreferences =
  "/data/data/com.android.chrome/app_chrome/Default/Preferences";
const adb = (...args) =>
  execFileSync("adb", ["-s", serial, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
const root = resolve(import.meta.dirname, "..");
const output = join(root, ".artifacts/managed-artifact", String(Date.now()));
const temp = mkdtempSync(join(tmpdir(), "ya-managed-artifact-"));
const dist = join(root, ".artifacts/managed-artifact-client");
mkdirSync(output, { recursive: true });
const children = [];
let context;
let page;
const screenshots = [];
const evidence = {
  browser: "",
  publicContentTLS: !native,
  parent: "https://latest.yepanywhere.com",
  temporaryParentBuild: true,
  thirdPartyCookiesBlocked: native ? null : !android,
  serverBuild: process.env.YA_ARTIFACT_TEST_SERVER_ROOT
    ? "baseline checkout"
    : "feature checkout",
  platform: native
    ? "android-emulator-bundled-app"
    : android
      ? "android-emulator-chrome"
      : "desktop-chromium",
  checks: [],
  errors: [],
  temp,
};
const log = (text) => console.error(`[managed artifact] ${text}`);
async function until(label, fn, limit = 45000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
function start(label, pkg, env) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      require.resolve("tsx/esm"),
      "--conditions",
      "source",
      "src/index.ts",
    ],
    {
      cwd: join(
        process.env.YA_ARTIFACT_TEST_SERVER_ROOT ?? root,
        "packages",
        pkg,
      ),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  children.push(child);
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) =>
      appendFileSync(join(output, `${label}.log`), data),
    );
  return child;
}
try {
  if (!process.argv.includes("--skip-build")) {
    log("Building the actual hosted client");
    execFileSync(
      process.execPath,
      [
        join(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
        "build",
        "--config",
        "vite.config.remote.ts",
        "--base",
        "/",
        "--outDir",
        dist,
      ],
      {
        cwd: join(root, "packages/client"),
        env: {
          ...process.env,
          VITE_DISABLE_ONBOARDING: "true",
          VITE_DISABLE_CLI_UPDATE_NOTIFICATIONS: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
      },
    );
  }
  const home = join(temp, "home");
  const data = join(temp, "ya");
  const claude = join(temp, "claude/projects");
  const project = join(temp, "bundle");
  for (const directory of [home, data, claude, project])
    mkdirSync(directory, { recursive: true });
  for (const [name, [, value]] of Object.entries(files)) {
    const nameInBundle = name.replace(/^report\//, "");
    const target = join(project, nameInBundle);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      typeof value === "string"
        ? value.replaceAll("../assets/", "assets/")
        : value,
    );
  }
  writeFileSync(
    join(project, "fragment.html"),
    '<h1>Interactive fragment</h1><button id="widget" onclick="const n=(openai.widgetState?.count??0)+1;openai.setWidgetState({count:n});this.textContent=String(n)">Remember count</button><button id="followup" onclick="openai.sendFollowUpMessage({prompt:\'Explain this chart\'})">Ask about this chart</button><script>window.fragmentTheme=openai.theme</script>',
  );
  const install = new InstallService({ dataDir: data });
  await install.initialize();
  await install.recordSuccessfulProviders(["claude"]);
  writeFileSync(
    join(data, "server-settings.json"),
    JSON.stringify({ version: 1, settings: { codexUpdatePolicy: "off" } }),
  );
  const sessionDir = join(claude, hostname(), project.replaceAll("/", "-"));
  mkdirSync(sessionDir, { recursive: true });
  const transcript = join(sessionDir, "artifact-demo.jsonl");
  const row = (i, role, text) => ({
    type: role,
    uuid: `demo-${i}`,
    sessionId: "artifact-demo",
    cwd: project,
    timestamp: new Date(Date.now() - 60000 + i * 10).toISOString(),
    message: {
      role,
      content: role === "assistant" ? [{ type: "text", text }] : text,
    },
  });
  const rows = [row(0, "user", "Inspect a generated local artifact")];
  for (let i = 1; i <= 120; i++)
    rows.push(
      row(
        i,
        i % 2 ? "assistant" : "user",
        `Report review context ${i}: HTML and assets stay on the YA server.`,
      ),
    );
  rows.push(
    row(
      121,
      "assistant",
      `[Open local artifact](${join(project, "index.html")})\n\n[Open fragment](${join(project, "fragment.html")})`,
    ),
  );
  writeFileSync(
    transcript,
    rows.map((value) => JSON.stringify(value)).join("\n") + "\n",
  );
  if (!process.argv.includes("--public-relay"))
    throw new Error(
      "Pass --public-relay to authorize a disposable identity on the public TLS relay",
    );
  const relayUrl = "wss://relay.yepanywhere.com/ws";
  evidence.publicRelay = true;
  const username = `artifact-${randomUUID().slice(0, 8)}`;
  const password = randomUUID() + randomUUID();
  const env = {
    HOME: home,
    USERPROFILE: home,
    YEP_DATA_DIR: data,
    CLAUDE_SESSIONS_DIR: claude,
    CODEX_SESSIONS_DIR: join(temp, "codex"),
    GEMINI_SESSIONS_DIR: join(temp, "gemini"),
    YEP_PROVIDER_HOST_RUNTIME_DIR: join(temp, "runtime"),
    YEP_PROVIDER_HOST_ENABLED: "false",
    YEP_ARTIFACT_PORT: "0",
    YEP_ARTIFACT_LOCAL_ORIGIN: "",
    YEP_ARTIFACT_PUBLIC_ORIGIN: "",
    VITE_DISABLE_ONBOARDING: "true",
    VITE_DISABLE_CLI_UPDATE_NOTIFICATIONS: "true",
  };
  execFileSync(
    process.execPath,
    [
      "--import",
      require.resolve("tsx/esm"),
      "--conditions",
      "source",
      "src/cli.ts",
      "--setup-remote-access",
      "--username",
      username,
      "--password",
      password,
      "--relay",
      relayUrl,
    ],
    {
      cwd: join(root, "packages/server"),
      env: { ...process.env, ...env },
      stdio: "pipe",
      timeout: 45000,
    },
  );
  const serverFile = join(temp, "server.port");
  start("server", "server", {
    ...env,
    PORT: "0",
    PORT_FILE: serverFile,
    MAINTENANCE_PORT: "-1",
    AUTH_DISABLED: "true",
    HTTPS_SELF_SIGNED: "",
    NODE_ENV: "production",
    SERVE_FRONTEND: "false",
    LOG_LEVEL: "warn",
  });
  const serverPort = await until(
    "server port",
    () => existsSync(serverFile) && readFileSync(serverFile, "utf8").trim(),
  );
  const api = (path) =>
    fetch(`http://127.0.0.1:${serverPort}/api${path}`, {
      headers: { "X-Yep-Anywhere": "true" },
    });
  await until("relay registration", async () =>
    ["waiting", "connected"].includes(
      (await (await api("/remote-access/relay/status")).json()).status,
    ),
  );
  const projectId = Buffer.from(project).toString("base64url");
  await until(
    "session discovery",
    async () => (await api(`/projects/${projectId}/sessions/artifact-demo`)).ok,
  );
  const version = await (await api("/version")).json();
  evidence.server = {
    artifactListener: version.artifactViewer?.available,
    capabilities: version.capabilityExtensions ?? version.capabilities,
  };
  const profile = join(temp, "chromium");
  mkdirSync(join(profile, "Default"), { recursive: true });
  writeFileSync(
    join(profile, "Default/Preferences"),
    JSON.stringify({
      profile: { cookie_controls_mode: 1, block_third_party_cookies: true },
      tracking_protection: { block_all_3pc_toggle_enabled: true },
    }),
  );
  if (android) {
    evidence.androidRelease = adb(
      "shell",
      "getprop",
      "ro.build.version.release",
    ).trim();
    evidence.androidApi = adb(
      "shell",
      "getprop",
      "ro.build.version.sdk",
    ).trim();
    evidence.webView = adb("shell", "dumpsys", "webviewupdate").match(
      /Current WebView package \(name, version\): (.*)/,
    )?.[1];
    if (native) {
      const apk = join(
        root,
        "packages/android/app/build/outputs/apk/bundled/debug/app-bundled-debug.apk",
      );
      evidence.apkSHA256 = createHash("sha256")
        .update(readFileSync(apk))
        .digest("hex");
      adb("install", "-r", apk);
      const link = `https://yepanywhere.com/open?${new URLSearchParams({ u: username, p: password, r: relayUrl })}`;
      execFileSync("adb", ["-s", serial, "shell"], {
        input: `am start -W -n com.yepanywhere.mobile/.MainActivity -a android.intent.action.VIEW -d '${link}'\n`,
        stdio: ["pipe", "ignore", "pipe"],
        timeout: 30000,
      });
      const button = await until("native Connect button", () => {
        adb("shell", "uiautomator", "dump", "/sdcard/ya-managed.xml");
        return adb("shell", "cat", "/sdcard/ya-managed.xml").match(
          /text="Connect"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
        );
      });
      adb(
        "shell",
        "input",
        "tap",
        String(Math.floor((Number(button[1]) + Number(button[3])) / 2)),
        String(Math.floor((Number(button[2]) + Number(button[4])) / 2)),
      );
      await until("native registration persisted on real server", async () => {
        const result = await (await api("/security/clients")).json();
        return result.clients?.some(
          (client) => client.reportedLabel === username,
        );
      });
      evidence.nativeRegistrationPersisted = true;
      if (process.argv.includes("--resume-after-pair")) {
        evidence.setupWorkaround =
          "force-stop and cold launcher resume after successful registration; fresh pairing UI remained busy in separate unmodified runs";
        adb("shell", "am", "force-stop", "com.yepanywhere.mobile");
        adb(
          "shell",
          "am",
          "start",
          "-W",
          "-n",
          "com.yepanywhere.mobile/.MainActivity",
          "-a",
          "android.intent.action.MAIN",
          "-c",
          "android.intent.category.LAUNCHER",
        );
      } else {
        const openButton = await until(
          "native pairing complete and open action enabled",
          () => {
            adb("shell", "uiautomator", "dump", "/sdcard/ya-managed.xml");
            const xml = adb("shell", "cat", "/sdcard/ya-managed.xml");
            const stack = [];
            for (const [tag] of xml.matchAll(/<\/?node\b[^>]*>/g)) {
              if (tag.startsWith("</")) {
                stack.pop();
                continue;
              }
              const enabled =
                !tag.includes('enabled="false"') && stack.every(Boolean);
              if (enabled && /text="(?:Not now|Open full app)"/.test(tag))
                return tag.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
              if (!tag.endsWith("/>")) stack.push(enabled);
            }
          },
        );
        adb(
          "shell",
          "input",
          "tap",
          String(
            Math.floor((Number(openButton[1]) + Number(openButton[3])) / 2),
          ),
          String(
            Math.floor((Number(openButton[2]) + Number(openButton[4])) / 2),
          ),
        );
      }
      const pid = await until("native process", () =>
        adb("shell", "pidof", "com.yepanywhere.mobile").trim(),
      );
      const port = adb(
        "forward",
        "tcp:0",
        `localabstract:webview_devtools_remote_${pid}`,
      ).trim();
      forwards.push(port);
      await until(
        "native WebView DevTools",
        async () =>
          (
            await fetch(`http://127.0.0.1:${port}/json/version`, {
              signal: AbortSignal.timeout(2000),
            })
          ).ok,
      );
      androidBrowser = await chromium.connectOverCDP(
        `http://127.0.0.1:${port}`,
        { noDefaults: true },
      );
      context = androidBrowser.contexts()[0];
      evidence.browser = androidBrowser.version();
      evidence.parentBuildDelivery = "bundled debug APK";
      evidence.parent = "https://appassets.androidplatform.net";
    } else {
      adb("shell", "am", "force-stop", "com.android.chrome");
      androidPreferences = adb("shell", "su", "0", "cat", chromePreferences);
      const preferences = JSON.parse(androidPreferences);
      preferences.profile = {
        ...preferences.profile,
        cookie_controls_mode: 1,
        block_third_party_cookies: true,
      };
      execFileSync(
        "adb",
        ["-s", serial, "shell", "su", "0", "tee", chromePreferences],
        {
          input: JSON.stringify(preferences),
          stdio: ["pipe", "ignore", "pipe"],
          timeout: 30000,
        },
      );
      adb(
        "shell",
        "echo '_ --disable-fre --no-default-browser-check --remote-debugging-socket-name=ya_artifact_devtools_remote' > /data/local/tmp/chrome-command-line",
      );
      adb(
        "shell",
        "am",
        "start",
        "-W",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        "about:blank",
        "com.android.chrome",
      );
      const port = adb(
        "forward",
        "tcp:0",
        "localabstract:ya_artifact_devtools_remote",
      ).trim();
      forwards.push(port);
      await until(
        "Android Chrome DevTools",
        async () =>
          (
            await fetch(`http://127.0.0.1:${port}/json/version`, {
              signal: AbortSignal.timeout(2000),
            })
          ).ok,
      );
      androidBrowser = await chromium.connectOverCDP(
        `http://127.0.0.1:${port}`,
      );
      context = androidBrowser.contexts()[0];
      evidence.browser = androidBrowser.version();
      adb("shell", "rm", "-f", "/data/local/tmp/chrome-command-line");
    }
  } else {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: !process.argv.includes("--headed"),
      viewport: { width: 1000, height: 600 },
    });
  }
  evidence.browser ||= context.browser()?.version() ?? "persistent Chromium";
  await context.route("https://latest.yepanywhere.com/**", async (route) => {
    const url = new URL(route.request().url());
    let file = join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !existsSync(file) || url.pathname === "/")
      file = join(dist, "remote.html");
    const mime = file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : file.endsWith(".json")
              ? "application/json"
              : "application/octet-stream";
    await route.fulfill({
      status: 200,
      contentType: mime,
      body: readFileSync(file),
      headers: { "Origin-Agent-Cluster": "?1", "Cache-Control": "no-store" },
    });
  });
  page = native ? context.pages()[0] : await context.newPage();
  if (android && !native) {
    await context.route(
      "https://third-party-cookie-probe.invalid/**",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          headers: {
            "Set-Cookie": "ya_probe=network; Secure; SameSite=None; Path=/",
          },
          body: '<script>document.cookie="ya_js_probe=script; Secure; SameSite=None; Path=/";if(parent!==window)parent.postMessage({probe:"third-party-cookies",cookie:document.cookie},"https://latest.yepanywhere.com")</script>',
        }),
    );
    await page.goto("https://third-party-cookie-probe.invalid/check");
    expect(await page.evaluate(() => document.cookie)).toContain(
      "ya_probe=network",
    );
    expect(await page.evaluate(() => document.cookie)).toContain(
      "ya_js_probe=script",
    );
    evidence.firstPartyCookieProbe =
      "same network and script cookies accepted at top level";
    await page.goto("https://latest.yepanywhere.com");
    const cookie = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Cookie probe timed out")),
            15000,
          );
          addEventListener("message", (event) => {
            if (
              event.origin === "https://third-party-cookie-probe.invalid" &&
              event.data?.probe === "third-party-cookies"
            ) {
              clearTimeout(timer);
              resolve(event.data.cookie);
            }
          });
          const frame = document.createElement("iframe");
          frame.src = "https://third-party-cookie-probe.invalid/check";
          document.body.append(frame);
        }),
    );
    expect(cookie).toBe("");
    evidence.thirdPartyCookiesBlocked = true;
    evidence.thirdPartyCookieProbe =
      "network and script cookies refused in cross-site iframe";
  }
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      evidence.errors.push(message.text());
      log(message.text().slice(0, 500));
    }
  });
  const origin = evidence.parent;
  const base = native ? origin : `${origin}/-/relay/${username}`;
  log("Opening actual YA over the disposable encrypted relay");
  if (!native) {
    await page.goto(
      `${origin}/login/relay#u=${username}&p=${password}&r=${encodeURIComponent(relayUrl)}`,
    );
    await page.waitForURL("**/-/relay/**", { timeout: 60000 });
  } else
    await expect(page.getByText("bundle", { exact: true }).first()).toBeVisible(
      { timeout: 45000 },
    );
  await page.goto(`${base}/projects/${projectId}/sessions/artifact-demo`);
  await page
    .getByRole("link", { name: "Open local artifact", exact: true })
    .click({ timeout: 45000 });
  if (native) {
    const frameElement = page.locator("iframe[srcdoc]");
    await expect(frameElement).toHaveAttribute("sandbox", "allow-same-origin");
    const fallback = page.frames().find((f) => f.url() === "about:srcdoc");
    await expect(
      fallback.getByRole("heading", { name: "HTML and its assets, unchanged" }),
    ).toBeVisible();
    await fallback.locator("#counter").click();
    await expect(fallback.locator("#count")).toHaveText("0");
    expect(
      await fallback.evaluate(() => window.classicLoaded ?? null),
    ).toBeNull();
    expect(
      page
        .frames()
        .some((f) => /artifact-[a-f0-9]{32}\.yepanywhere/.test(f.url())),
    ).toBe(false);
    evidence.checks.push({
      name: "native-scriptless-fallback",
      parentOrigin: new URL(page.url()).origin,
      sandbox: await frameElement.getAttribute("sandbox"),
      scriptsExecuted: false,
      managedFrame: false,
      imageWidth: await fallback
        .locator("#chart")
        .evaluate((img) => img.naturalWidth),
    });
    const path = join(output, "native-fallback.png");
    await page.screenshot({ path });
    screenshots.push({
      name: "native-app-fallback",
      ...(await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }))),
      path,
    });
    await page.locator('.file-viewer-action[aria-label="Back"]').click();
    await expect(page.locator("iframe[srcdoc]")).toHaveCount(0);
    evidence.checks.push({ name: "native-fallback-teardown", passed: true });
    const expectedRefusal = (message) =>
      /Refused to load (?:the stylesheet|the image).*violates the following Content Security Policy/s.test(
        message,
      ) ||
      /Blocked script execution in 'about:srcdoc'.*sandboxed/s.test(message);
    evidence.expectedPolicyRefusals =
      evidence.errors.filter(expectedRefusal).length;
    expect(
      evidence.errors.filter((message) => !expectedRefusal(message)),
    ).toEqual([]);
  } else {
    const artifact = () =>
      page
        .frames()
        .find((frame) => /\/v\/[a-f0-9]{32}\/index.html/.test(frame.url()));
    await until("managed artifact document", artifact);
    const child = artifact();
    await expect(child.locator("#modules")).toContainText("JSON: 3 notes", {
      timeout: 30000,
    });
    const resourceResults = await child.evaluate(async () => ({
      image: document.querySelector("#chart").naturalWidth,
      classic: window.classicLoaded,
      modules: window.result,
      font: await document.fonts
        .load("12px ArtifactFont")
        .then((v) => v.length),
      css: getComputedStyle(document.querySelector(".tag")).letterSpacing,
      background: getComputedStyle(document.querySelector(".card"))
        .backgroundImage,
      worker: (await fetch("data.json")).headers.get("x-yep-artifact-worker"),
      parent: (() => {
        try {
          return parent.parent.document.title;
        } catch {
          return "denied";
        }
      })(),
    }));
    expect(resourceResults.image).toBe(640);
    expect(resourceResults.classic).toBe(true);
    expect(resourceResults.worker).toBe("1");
    expect(resourceResults.parent).toBe("denied");
    expect(resourceResults.font).toBe(1);
    evidence.checks.push({ name: "native-resources", ...resourceResults });
    await child.locator("#counter").click();
    await expect(child.locator("#count")).toHaveText("1");
    for (const viewport of android
      ? [
          await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
          })),
        ]
      : [
          { width: 1000, height: 600 },
          { width: 375, height: 812 },
        ]) {
      if (!android) await page.setViewportSize(viewport);
      await child.evaluate(() => scrollTo(0, 0));
      const path = join(output, `viewer-${viewport.width}.png`);
      await page.screenshot({ path });
      screenshots.push({
        name: `managed-viewer-${viewport.width}`,
        ...viewport,
        path,
      });
    }
    if (!android) await page.setViewportSize({ width: 1000, height: 600 });
    await child.locator("#next").click();
    const linked = await until("linked document", () =>
      page.frames().find((f) => /\/v\/.+\/page2.html/.test(f.url())),
    );
    await expect(
      linked.getByRole("heading", { name: "Linked page", exact: true }),
    ).toBeVisible();
    await linked.getByRole("link", { name: "Back to report" }).click();
    await until("return to document", artifact);
    await expect(artifact().locator("#modules")).toContainText("JSON: 3 notes");
    const reloading = artifact().waitForNavigation({ waitUntil: "load" });
    await artifact().evaluate(() => location.reload());
    await reloading;
    await expect(artifact().locator("#modules")).toContainText(
      "JSON: 3 notes",
      {
        timeout: 30000,
      },
    );
    await until(
      "reload",
      async () =>
        await artifact()
          ?.evaluate(() => window.result?.data?.notes === 3)
          .catch(() => false),
    );
    evidence.checks.push({ name: "navigation-and-reload", passed: true });
    const cdp = await context.newCDPSession(page);
    let versions = [];
    cdp.on("ServiceWorker.workerVersionUpdated", (event) => {
      versions = event.versions;
    });
    await cdp.send("ServiceWorker.enable");
    const versionToStop = await until("worker target", () =>
      versions.find(
        (v) =>
          v.scriptURL.startsWith(new URL(artifact().url()).origin) &&
          v.runningStatus === "running",
      ),
    );
    await cdp.send("ServiceWorker.stopWorker", {
      versionId: versionToStop.versionId,
    });
    const restarted = await artifact().evaluate(async () => {
      const r = await fetch("data.json?restart=1");
      return {
        status: r.status,
        worker: r.headers.get("x-yep-artifact-worker"),
        data: await r.json(),
      };
    });
    expect(restarted.worker).toBe("1");
    evidence.checks.push({ name: "worker-restart", ...restarted });
    await cdp.detach();
    const note = artifact().locator("#note");
    const phrase = "A local image with live updates.";
    let typed = "";
    const latencies = [];
    await note.click();
    for (const character of phrase) {
      const start = Date.now();
      await page.keyboard.type(character);
      typed += character;
      await expect(note).toHaveValue(typed, { timeout: 100 });
      latencies.push(Date.now() - start);
    }
    expect(Math.max(...latencies)).toBeLessThanOrEqual(100);
    evidence.checks.push({
      name: "artifact-sequential-typing",
      characters: phrase.length,
      maxMs: Math.max(...latencies),
    });
    const cancelled = await artifact().evaluate(async () => {
      const response = await fetch("slow.bin");
      const reader = response.body.getReader();
      const first = await reader.read();
      await reader.cancel();
      return {
        status: response.status,
        firstBytes: first.value.byteLength,
        nextStatus: (await fetch("data.json?afterCancel=1")).status,
      };
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.firstBytes).toBeLessThan(4 * 1024 * 1024);
    expect(cancelled.nextStatus).toBe(200);
    evidence.checks.push({ name: "stream-cancel", ...cancelled });

    await artifact().locator("#modules").click();
    await page.keyboard.press("Control+f");
    const findBox = page.getByRole("searchbox", { name: "Find in this view" });
    await expect(findBox).toBeFocused();
    await page.keyboard.type("notes");
    await expect(
      page.getByRole("search").getByText("1/1", { exact: true }),
    ).toBeVisible();
    expect(
      await artifact().evaluate(() => CSS.highlights.get("yep-find")?.size),
    ).toBe(1);
    await page.keyboard.press("Escape");
    evidence.checks.push({ name: "managed-frame-find", passed: true });

    const composer = page
      .locator("textarea.message-input, textarea[placeholder]")
      .first();
    await page.locator('.file-viewer-action[aria-label="Back"]').click();
    await page
      .getByRole("link", { name: "Open fragment", exact: true })
      .click();
    const fragment = () =>
      page
        .frames()
        .find((f) => /\/v\/[a-f0-9]{32}\/fragment.html/.test(f.url()));
    await until("fragment", fragment);
    await fragment().locator("#widget").click();
    await expect(fragment().locator("#widget")).toHaveText("1");
    const fragmentReloading = fragment().waitForNavigation({
      waitUntil: "load",
    });
    await fragment().evaluate(() => location.reload());
    await fragmentReloading;
    await until(
      "widget state after inner reload",
      async () =>
        (await fragment()
          ?.evaluate(() => window.openai?.widgetState?.count)
          .catch(() => null)) === 1,
    );
    await fragment().locator("#widget").click();
    await expect(fragment().locator("#widget")).toHaveText("2");
    await fragment().locator("#followup").click();
    await expect(composer).toHaveValue(/Explain this chart/);
    expect(
      readFileSync(transcript, "utf8").includes("Explain this chart"),
    ).toBe(false);
    evidence.checks.push({
      name: "fragment-state-theme-followup",
      count: await fragment().evaluate(() => openai.widgetState.count),
      theme: await fragment().evaluate(() => window.fragmentTheme),
      submitted: false,
    });
    await page.locator('.file-viewer-action[aria-label="Back"]').click();
    await page
      .getByRole("link", { name: "Open local artifact", exact: true })
      .click();
    await until("reopened report", artifact);
    await expect(artifact().locator("#modules")).toContainText("JSON: 3 notes");
    await composer.fill("");
    await composer.click();
    await page.evaluate(() => {
      window.__artifactMutations = 0;
      window.__artifactObserver = new MutationObserver(
        (records) => (window.__artifactMutations += records.length),
      );
      window.__artifactObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    let updates = 0;
    const ticker = setInterval(
      () =>
        appendFileSync(
          transcript,
          JSON.stringify(
            row(
              300 + updates++,
              "assistant",
              `Concurrent review update ${updates}`,
            ),
          ) + "\n",
        ),
      70,
    );
    const composerText = "Review this local report with me.";
    let expected = "";
    const composerLatencies = [];
    try {
      for (const character of composerText) {
        const start = Date.now();
        await page.keyboard.type(character);
        expected += character;
        await expect(composer).toHaveValue(expected, { timeout: 100 });
        composerLatencies.push(Date.now() - start);
        // Deliberate key cadence keeps real transcript updates overlapping typing.
        await page.waitForTimeout(20);
      }
    } finally {
      clearInterval(ticker);
    }
    const mutations = await page.evaluate(() => {
      window.__artifactObserver.disconnect();
      return window.__artifactMutations;
    });
    expect(Math.max(...composerLatencies)).toBeLessThanOrEqual(100);
    expect(updates).toBeGreaterThan(0);
    expect(mutations).toBeGreaterThan(0);
    evidence.checks.push({
      name: "composer-sequential-typing",
      characters: composerText.length,
      maxMs: Math.max(...composerLatencies),
      updates,
      mutations,
    });

    await artifact().evaluate(() =>
      localStorage.setItem("viewer-only", "first"),
    );
    const second = await context.newPage();
    await second.goto(
      `${origin}/login/relay#u=${username}&p=${password}&r=${encodeURIComponent(relayUrl)}`,
    );
    await second.waitForURL("**/-/relay/**");
    await second.goto(
      `${base}/projects/${projectId}/file?${new URLSearchParams({ path: join(project, "index.html") })}`,
    );
    const secondFrame = await until("second viewer", () =>
      second
        .frames()
        .find((f) => /\/v\/[a-f0-9]{32}\/index.html/.test(f.url())),
    );
    await expect(secondFrame.locator("#modules")).toContainText(
      "JSON: 3 notes",
    );
    expect(new URL(secondFrame.url()).origin).not.toBe(
      new URL(artifact().url()).origin,
    );
    expect(
      await secondFrame.evaluate(() => localStorage.getItem("viewer-only")),
    ).toBeNull();
    await second.close();
    evidence.checks.push({ name: "concurrent-viewer-origins", passed: true });

    evidence.documentUrl = artifact().url();
    evidence.networkFallback = (await fetch(evidence.documentUrl)).status;
    expect(evidence.networkFallback).toBe(404);
    const documentUrl = artifact().url();
    const artifactOrigin = new URL(documentUrl).origin;
    const orphan = await context.newPage();
    const otherViewer = randomUUID().replaceAll("-", "");
    await orphan.goto(
      `${artifactOrigin}/__ya/1/bootstrap.html?${new URLSearchParams({ viewer: otherViewer, parent: origin })}`,
    );
    await orphan.evaluate((url) => {
      const frame = document.createElement("iframe");
      frame.src = url;
      document.body.append(frame);
    }, documentUrl);
    const orphanDocument = await until("controlled survivor", () =>
      orphan.frames().find((f) => f.url() === documentUrl),
    );
    await expect(orphanDocument.locator("#modules")).toContainText(
      "JSON: 3 notes",
    );
    await page.locator('.file-viewer-action[aria-label="Back"]').click();
    await until(
      "worker unregister",
      async () =>
        (await orphan.evaluate(() =>
          navigator.serviceWorker.getRegistrations().then((r) => r.length),
        )) === 0,
    );
    const afterClose = await orphanDocument.evaluate(
      async () => (await fetch("data.json?afterClose=1")).status,
    );
    expect(afterClose).toBe(503);
    await orphan.close();
    evidence.checks.push({
      name: "teardown-and-survivor-refusal",
      registrations: 0,
      afterClose,
    });

    expect(evidence.errors).toEqual([]);
  }
  if (process.argv.includes("--smoke")) log("Smoke assertions complete");
  emitCapturePreview(
    await writeCapturePreview({
      input: native
        ? "Bundled Android YA: scriptless fallback over the encrypted public relay"
        : "Managed artifact viewer: actual YA, encrypted relay and deployed HTTPS content host",
      out: join(output, "capture"),
      screenshots,
      warnings: [],
    }),
  );
  evidence.passed = true;
  log(
    `PASS: ${native ? "bundled app scriptless fallback" : "actual pane and local assets"} over encrypted relay. Evidence: ${output}`,
  );
} catch (error) {
  evidence.failure = String(error);
  process.exitCode = 1;
  log(error.stack ?? String(error));
  if (page) {
    evidence.url = page.url();
    evidence.body = await page.locator("body").innerText().catch(String);
    evidence.frames = await Promise.all(
      page.frames().map(async (frame) => ({
        url: frame.url(),
        body: (await frame.locator("body").innerText().catch(String)).slice(
          0,
          2500,
        ),
      })),
    );
  }
} finally {
  if (android) {
    await androidBrowser?.close().catch(() => {});
    for (const port of forwards) {
      try {
        adb("forward", "--remove", `tcp:${port}`);
      } catch {}
    }
    try {
      adb("shell", "rm", "-f", "/data/local/tmp/chrome-command-line");
      adb(
        "shell",
        "am",
        "force-stop",
        native ? "com.yepanywhere.mobile" : "com.android.chrome",
      );
      if (native) {
        adb("shell", "pm", "clear", "com.yepanywhere.mobile");
        adb("shell", "rm", "-f", "/sdcard/ya-managed.xml");
      }
      if (androidPreferences)
        execFileSync(
          "adb",
          ["-s", serial, "shell", "su", "0", "tee", chromePreferences],
          {
            input: androidPreferences,
            stdio: ["pipe", "ignore", "pipe"],
            timeout: 30000,
          },
        );
    } catch {}
  } else await context?.close();
  for (const child of children.reverse()) {
    try {
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
    await Promise.race([
      new Promise((r) => child.once("exit", r)),
      new Promise((r) => setTimeout(r, 1000)),
    ]);
    if (child.exitCode === null)
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {}
  }
  writeFileSync(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  log(`Owned browser/server/relay stopped. Results: ${output}`);
}
