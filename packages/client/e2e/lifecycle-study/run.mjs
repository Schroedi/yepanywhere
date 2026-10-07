/** Opt-in diagnostic study, not a passing CI test. See README.md. */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { arch, cpus, freemem, loadavg, platform, totalmem } from "node:os";
import { setTimeout as pause } from "node:timers/promises";
import { chromium, _android } from "@playwright/test";
import { preview } from "vite";
import { createRelayServer } from "../../../relay/src/server.ts";
import { startFixture } from "../../../mobile-core/scripts/fixture.mjs";
import {
  writeCapturePreview,
  emitCapturePreview,
} from "../../scripts/artifact-capture.ts";
import { createNetworkGate } from "./network-gate.mjs";
import { installObserver } from "./observe.mjs";

const exec = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [name, ...value] = arg.replace(/^--/, "").split("=");
    return [name, value.join("=")];
  }),
);
const client = options.client ?? "browser";
const route = options.route ?? "direct";
const surface = options.surface ?? "session";
const fault = options.fault ?? "disconnect";
const observationMs = Number(options["observe-ms"] ?? 90_000);
const outageMs = Number(options["outage-ms"] ?? 16_000);
const activity = options.activity ?? "none";
if (
  !["browser", "android"].includes(client) ||
  !["direct", "mux"].includes(route) ||
  !["session", "inbox"].includes(surface) ||
  ![
    "control",
    "disconnect",
    "in-flight",
    "outage",
    "wake-outage",
    "silent",
  ].includes(fault) ||
  !(observationMs >= 1000 && observationMs <= 180_000) ||
  !(outageMs >= 1000 && outageMs <= 120_000) ||
  !["none", "typing"].includes(activity) ||
  (activity === "typing" && surface !== "session")
)
  throw new Error("Invalid study options; see README.md");
const serial = process.env.ANDROID_SERIAL;
if (client === "android" && !/^emulator-\d+$/.test(serial ?? ""))
  throw new Error(
    "This study only operates an explicitly selected emulator: set ANDROID_SERIAL",
  );
const adb = process.env.ANDROID_HOME
  ? join(process.env.ANDROID_HOME, "platform-tools/adb")
  : "adb";
const device = (...args) =>
  exec(adb, ["-s", serial, ...args], {
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${client}-${route}-${surface}-${fault}`;
const out = resolve(
  options.out ?? join(repo, "tasks/source-lifecycle-study", runId),
);
await mkdir(dirname(out), { recursive: true });
await mkdir(out, { recursive: false });
const timeline = [];
const screenshots = [];
const started = Date.now();
const record = (event) => {
  timeline.push({ at: Date.now(), ...event });
  if (timeline.length > 20_000) timeline.shift();
};
const host = () => ({
  platform: platform(),
  arch: arch(),
  cpu: cpus()[0].model,
  cores: cpus().length,
  totalMemory: totalmem(),
  freeMemory: freemem(),
  availableMemory: process.availableMemory?.(),
  load: loadavg(),
});
const result = {
  runId,
  client,
  route,
  surface,
  fault,
  observationMs,
  outageMs,
  activity,
  started,
  hostStart: host(),
  grade: "diagnostic; timings are not benchmark acceptance",
  revision: (
    await exec("git", ["rev-parse", "HEAD"], { cwd: repo })
  ).stdout.trim(),
};
result.dirtyFiles = (
  await exec("git", ["status", "--short"], { cwd: repo })
).stdout.trim();
result.bundleHash = createHash("sha256")
  .update(await readFile(join(repo, "packages/client/dist-remote/remote.html")))
  .digest("hex");
const harnessHash = createHash("sha256");
for (const file of ["run.mjs", "observe.mjs", "network-gate.mjs"])
  harnessHash.update(await readFile(new URL(file, import.meta.url)));
result.harnessHash = harnessHash.digest("hex");
let relay, fixture, gate, staticServer, browser, page, cdp, instrument;
let instrumentDone;
let androidDevices = [];
const reverses = [];
let instrumentLog = "";
const deviceDir =
  "/sdcard/Android/data/com.yepanywhere.mobile/files/lifecycle-study";
async function until(check, ms = 30_000) {
  const deadline = Date.now() + ms;
  let last;
  do {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error(`Study setup/operation did not complete within ${ms}ms`, {
    cause: last,
  });
}
const probe = async (path, method = "POST") => {
  const response = await fetch(
    `http://127.0.0.1:${fixture.port}/__probe/${path}`,
    { method },
  );
  if (!response.ok) throw new Error(`Probe ${path}: ${response.status}`);
  return response.json();
};
async function capture(name) {
  if (!page || page.isClosed()) return;
  const path = join(out, `${name}.png`);
  await page.screenshot({ path, timeout: 10_000 });
  const size = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  screenshots.push({ name, path, ...size });
}
async function snapshot(label) {
  const state = await page.evaluate(
    (needle) => ({
      ...window.__lifecycleStudy?.sample(),
      body: document.body.innerText.slice(0, 5000),
      needle: needle ? document.body.innerText.includes(needle) : false,
      titleUpdated: document.body.innerText.includes("Updated study"),
    }),
    result.expectedMessage,
  );
  record({ type: "checkpoint", label, ...state });
  return state;
}
async function navigate(path) {
  await page.evaluate((path) => {
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}
async function updateWhileDisconnected() {
  if (result.expectedMessage) return;
  result.expectedMessage = (await probe("append")).message;
  const response = await fetch(
    `http://127.0.0.1:${fixture.port}/api/sessions/android-preview-session/metadata`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", "X-Yep-Anywhere": "true" },
      body: JSON.stringify({ title: "Updated study", starred: true }),
    },
  );
  if (!response.ok)
    throw new Error(`Study metadata update: ${response.status}`);
  record({ type: "server-updated", message: result.expectedMessage });
}
try {
  process.env.YEP_PROVIDER_HOST_ENABLED = "false";
  const username = `study-${randomUUID().slice(0, 8)}`;
  if (client === "browser") {
    staticServer = await preview({
      configFile: false,
      root: join(repo, "packages/client"),
      build: { outDir: "dist-remote" },
      preview: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "study-remote-entry",
          configurePreviewServer(server) {
            server.middlewares.use((req, _res, next) => {
              if (!req.url?.split("?")[0].includes("."))
                req.url = "/remote.html";
              next();
            });
          },
        },
      ],
    });
  }
  if (route === "mux")
    relay = await createRelayServer({
      port: 0,
      inMemoryDb: true,
      logLevel: "warn",
      disablePrettyPrint: true,
      allowedOrigins: staticServer
        ? new URL(staticServer.resolvedUrls.local[0]).origin
        : undefined,
      disableTelemetry: true,
    });
  fixture = await startFixture({
    username,
    relayURL: relay ? `ws://127.0.0.1:${relay.port}/ws` : undefined,
  });
  gate = await createNetworkGate(relay?.port ?? fixture.port, record);
  const endpoint = `ws://127.0.0.1:${gate.port}/${relay ? "ws" : "api/ws"}`;
  if (client === "browser") {
    browser = await chromium.launch();
    result.browserVersion = browser.version();
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      recordVideo: { dir: out },
    });
    page = await context.newPage();
    await page.goto(staticServer.resolvedUrls.local[0]);
    await page
      .getByTestId(relay ? "relay-mode-button" : "direct-mode-button")
      .click();
    await page
      .getByTestId(relay ? "relay-username-input" : "username-input")
      .fill(username);
    await page
      .getByTestId(relay ? "srp-password-input" : "password-input")
      .fill("native-fixture-password");
    if (relay)
      await page.getByText("Show Advanced Options", { exact: true }).click();
    await page
      .getByTestId(relay ? "custom-relay-url-input" : "ws-url-input")
      .fill(endpoint);
    await page.getByTestId("login-button").click();
    await page
      .getByText("preview-project", { exact: true })
      .first()
      .waitFor({ timeout: 30_000 });
  } else {
    result.apkHashes = {};
    for (const apk of [
      "bundled/debug/app-bundled-debug.apk",
      "androidTest/bundled/debug/app-bundled-debug-androidTest.apk",
    ]) {
      const path = join(repo, "packages/android/app/build/outputs/apk", apk);
      result.apkHashes[apk] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
      await device("install", "-r", path);
    }
    for (const port of [fixture.port, gate.port]) {
      await device("reverse", `tcp:${port}`, `tcp:${port}`);
      reverses.push(port);
    }
    await device("shell", "rm", "-rf", deviceDir);
    await device("shell", "logcat", "-c");
    const args = {
      class:
        "com.yepanywhere.mobile.web.YaNativeReconnectInstrumentedTest#hostDrivenLifecycleStudy",
      yaLifecycleStudy: "true",
      yaProbeWsUrl: relay ? fixture.endpoint : endpoint,
      yaProbeUsername: username,
      yaProbePassword: "native-fixture-password",
      ...(relay ? { yaProbeRelayWsUrl: endpoint } : {}),
    };
    instrument = spawn(
      adb,
      [
        "-s",
        serial,
        "shell",
        "am",
        "instrument",
        "-w",
        "-r",
        ...Object.entries(args).flatMap(([k, v]) => ["-e", k, v]),
        "com.yepanywhere.mobile.test/androidx.test.runner.AndroidJUnitRunner",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    instrument.stdout.on("data", (data) => {
      instrumentLog += data;
    });
    instrument.stderr.on("data", (data) => {
      instrumentLog += data;
    });
    instrumentDone = new Promise((done) => instrument.once("close", done));
    await until(async () => {
      if (instrument.exitCode !== null)
        throw new Error(`Instrumentation exited: ${instrumentLog}`);
      return (
        await device("shell", "cat", `${deviceDir}/ready.json`)
      ).stdout.includes("sessionPath");
    }, 60_000);
    // The Android adapter avoids desktop-only CDP commands that WebView rejects.
    // Discovery installs no driver; only the explicitly selected emulator is used.
    androidDevices = await _android.devices({ omitDriverInstall: true });
    const emulator = androidDevices.find(
      (device) => device.serial() === serial,
    );
    if (!emulator)
      throw new Error("Selected emulator absent from Playwright discovery");
    page = await (
      await emulator.webView({ pkg: "com.yepanywhere.mobile" })
    ).page();
    result.webView = (await device("shell", "dumpsys", "webviewupdate")).stdout;
  }
  page.setDefaultTimeout(30_000);
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      record({
        type: `console-${message.type()}`,
        text: message.text().slice(0, 1600),
      });
  });
  page.on("pageerror", (error) =>
    record({ type: "page-error", text: error.message }),
  );
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      record({
        type: "document-navigation",
        path: new URL(frame.url()).pathname,
      });
  });
  await page.evaluate(installObserver);
  cdp = await page.context().newCDPSession(page);
  const projects = await (
    await fetch(`http://127.0.0.1:${fixture.port}/api/projects`)
  ).json();
  const projectId = projects.projects[0].id;
  const current = new URL(page.url()).pathname;
  const prefix = current.includes("/projects")
    ? current.slice(0, current.indexOf("/projects"))
    : "";
  const sessionPath = `${prefix}/projects/${projectId}/sessions/android-preview-session`;
  const target = surface === "session" ? sessionPath : `${prefix}/inbox`;
  await navigate(target);
  await page
    .locator(
      surface === "session"
        ? "textarea[data-composer-input]"
        : ".inbox-toolbar",
    )
    .waitFor();
  if (surface === "session")
    await page
      .locator("textarea[data-composer-input]")
      .pressSequentially("Draft survives outage", { delay: 40 });
  await pause(1500);
  await snapshot("before");
  await capture("before");
  result.faultAt = Date.now();
  record({ type: "fault-start", fault });
  if (fault === "wake-outage") {
    if (client === "android")
      await device("shell", "input", "keyevent", "KEYCODE_SLEEP");
    else await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    gate.setMode("refuse");
    await updateWhileDisconnected();
    await pause(8000);
    if (client === "android") {
      await device("shell", "input", "keyevent", "KEYCODE_WAKEUP");
      await device("shell", "wm", "dismiss-keyguard");
    } else await cdp.send("Page.setWebLifecycleState", { state: "active" });
    record({ type: "wake" });
    await pause(8000);
  } else if (fault === "outage") {
    gate.setMode("refuse");
    await updateWhileDisconnected();
    await pause(outageMs);
  } else if (fault === "silent") {
    gate.setMode("silent");
    await updateWhileDisconnected();
    await pause(outageMs);
  } else if (fault === "in-flight") {
    await navigate(`${prefix}/projects`);
    await pause(1000);
    await probe("api-delay?ms=5000");
    await navigate(target);
    await until(async () => (await probe("status", "GET")).delayedRequests > 0);
    gate.disconnect();
    await probe("api-delay?ms=0");
    await pause(1000);
  } else if (fault === "disconnect") gate.disconnect();
  await updateWhileDisconnected();
  await snapshot("interrupted");
  await capture("interrupted");
  gate.setMode("pass");
  result.restoredAt = Date.now();
  record({ type: "network-restored" });
  if (activity === "typing") {
    record({
      type: "recovery-signal",
      signal: "sequential typing through browser input",
    });
    await page
      .locator("textarea[data-composer-input]")
      .pressSequentially(" while recovering", { delay: 40 });
  }
  // Deliberately no click, focus, navigation or synthetic online signal here.
  // This measures autonomous recovery separately from activity-driven recovery.
  const deadline = Date.now() + observationMs;
  let captured = false;
  while (Date.now() < deadline) {
    const state = await snapshot("observe");
    if (
      !state.connection &&
      !state.login &&
      !state.errors &&
      state.titleUpdated &&
      (surface !== "session" || state.needle) &&
      result.firstHealthyAt === undefined
    )
      result.firstHealthyAt = Date.now();
    if (!captured && Date.now() - result.restoredAt >= 30_000) {
      await capture("after-30s");
      captured = true;
    }
    await pause(1000);
  }
  result.final = await snapshot("final");
  await capture("final");
  // Separate explicit-demand experiment only after the passive window closes.
  if (
    result.final.connection ||
    (surface === "session" && !result.final.needle)
  ) {
    record({ type: "recovery-signal", signal: "real keyboard activity" });
    await page.keyboard.press("Shift");
    await pause(8000);
    result.afterActivity = await snapshot("after-activity");
    await capture("after-activity");
  }
  result.gate = gate.snapshot();
  result.observer = await page.evaluate(() => ({
    rows: window.__lifecycleStudy.rows,
    keys: window.__lifecycleStudy.keys,
  }));
  record({
    type: "sidebar-inspection",
    note: "Explicit interaction after passive recovery measurements",
  });
  const sidebarButton = page.getByRole("button", {
    name: "Open sidebar",
    exact: true,
  });
  if (await sidebarButton.count()) await sidebarButton.click();
  await pause(1000);
  result.sidebar = await snapshot("sidebar-open");
  await capture("sidebar");
  result.completed = true;
} catch (error) {
  result.completed = false;
  result.error = String(error.stack ?? error);
  await capture("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  if (client === "android" && instrument) {
    await device("shell", "input", "keyevent", "KEYCODE_WAKEUP").catch(
      () => {},
    );
    await device("shell", "wm", "dismiss-keyguard").catch(() => {});
    await device("shell", "touch", `${deviceDir}/stop`).catch(() => {});
    await Promise.race([instrumentDone, pause(15_000)]);
    if (instrument.exitCode === null) {
      instrument.kill();
      await device("shell", "am", "force-stop", "com.yepanywhere.mobile").catch(
        () => {},
      );
    }
    await writeFile(join(out, "instrumentation.log"), instrumentLog);
    result.instrumentationPassed = /OK \(1 test\)/.test(instrumentLog);
    if (!result.instrumentationPassed) {
      result.completed = false;
      result.error ??=
        "Android instrumentation did not finish successfully; see instrumentation.log";
      process.exitCode = 1;
    }
    await device(
      "pull",
      `${deviceDir}/phases.json`,
      join(out, "native-phases.json"),
    ).catch(() => {});
    await writeFile(
      join(out, "native-errors.log"),
      (
        await device("logcat", "-d", "-s", "YaSyntheticResponse:W").catch(
          () => ({ stdout: "unavailable" }),
        )
      ).stdout,
    );
  }
  await browser?.close().catch(() => {});
  for (const device of androidDevices) await device.close().catch(() => {});
  for (const port of reverses)
    await device("reverse", "--remove", `tcp:${port}`).catch(() => {});
  const cleanup = async (label, action) => {
    try {
      await action();
    } catch (error) {
      record({ type: "cleanup-error", label, error: String(error) });
      result.completed = false;
      result.error ??= `Cleanup failed: ${label}: ${error}`;
      process.exitCode = 1;
    }
  };
  await cleanup("network gate", async () => gate?.close());
  await cleanup("fixture", async () => fixture?.stop());
  await cleanup("relay", async () => relay?.close());
  if (staticServer) {
    staticServer.httpServer.closeAllConnections();
    await cleanup(
      "static server",
      () =>
        new Promise((done, fail) =>
          staticServer.httpServer.close((error) =>
            error ? fail(error) : done(),
          ),
        ),
    );
  }
  result.hostEnd = host();
  result.finished = Date.now();
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
  await writeFile(
    join(out, "timeline.json"),
    JSON.stringify(timeline, null, 2),
  );
  if (screenshots.length)
    emitCapturePreview(
      await writeCapturePreview({
        input: `Source lifecycle study: ${runId}`,
        out: join(out, "preview"),
        screenshots,
      }),
    );
  console.log(
    JSON.stringify(
      {
        out,
        completed: result.completed,
        error: result.error,
        recoveryMs: result.firstHealthyAt
          ? result.firstHealthyAt - result.restoredAt
          : null,
        final: result.final,
      },
      null,
      2,
    ),
  );
}
