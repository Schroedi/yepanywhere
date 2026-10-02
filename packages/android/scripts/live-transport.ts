/** Owned unchanged servers + real production Android Rust/WebView acceptance. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRelayServer } from "../../relay/src/server.js";
// @ts-expect-error The shared diagnostic fixture is an untyped ESM module.
import { startFixture } from "../../mobile-core/scripts/fixture.mjs";
const android = fileURLToPath(new URL("..", import.meta.url));
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adb = sdk ? resolve(sdk, "platform-tools/adb") : "adb";
let serial: string | undefined;
const children = new Set<ReturnType<typeof spawn>>();
async function run(command: string, args: string[], capture = false) {
  return await new Promise<string>((done, fail) => {
    const child = spawn(command, args, {
      cwd: android,
      env: process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    children.add(child);
    let text = "";
    child.stdout?.on("data", (data) => {
      text += data;
    });
    child.stderr?.on("data", (data) => {
      text += data;
    });
    child.once("error", fail);
    child.once("close", (code) => {
      children.delete(child);
      code === 0
        ? done(text)
        : fail(new Error(`${command} exited ${code}: ${text}`));
    });
  });
}
async function device(args: string[], capture = false) {
  return run(adb, ["-s", checkSerial(), ...args], capture);
}
function checkSerial() {
  if (!serial) throw new Error("No selected Android device");
  return serial;
}
const devices = (await run(adb, ["devices"], true))
  .split("\n")
  .filter((line) => /\tdevice$/.test(line))
  .map((line) => line.split("\t")[0]);
serial = process.env.ANDROID_SERIAL;
if (serial ? !devices.includes(serial) : devices.length !== 1)
  throw new Error("Select one authorized Android device using ANDROID_SERIAL");
serial ??= devices[0];
await run("./gradlew", [
  "assembleBundledDebug",
  "assembleBundledDebugAndroidTest",
  "-PyaNativeProbeCleartext=true",
  "-PyaNativeProbeMinify=true",
  "--warning-mode",
  "all",
  "--no-daemon",
]);
await device([
  "install",
  "-r",
  "app/build/outputs/apk/bundled/debug/app-bundled-debug.apk",
]);
await device([
  "install",
  "-r",
  "app/build/outputs/apk/androidTest/bundled/debug/app-bundled-debug-androidTest.apk",
]);
const interrupt = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  for (const mux of [false, true]) {
    const relay = mux
      ? await createRelayServer({
          port: 0,
          inMemoryDb: true,
          logLevel: "warn",
          disablePrettyPrint: true,
        })
      : undefined;
    let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
    let beta: Awaited<ReturnType<typeof startFixture>> | undefined;
    const reversed: number[] = [];
    try {
      const relayURL = relay ? `ws://127.0.0.1:${relay.port}/ws` : undefined;
      fixture = await startFixture({ relayURL });
      if (relay) {
        beta = await startFixture({ relayURL, username: "rust-beta" });
        const deadline = Date.now() + 30000;
        while (relay.connectionManager.getActiveServers().length < 2) {
          if (Date.now() >= deadline)
            throw new Error("Owned relay registration timed out");
          await new Promise((done) => setTimeout(done, 50));
        }
      }
      for (const port of [fixture.port, ...(relay ? [relay.port] : [])]) {
        await device(["reverse", `tcp:${port}`, `tcp:${port}`]);
        reversed.push(port);
      }
      const classes = [
        "com.yepanywhere.mobile.web.YaNativeWebAppInstrumentedTest",
        mux
          ? "com.yepanywhere.mobile.connection.YaRustRuntimeInstrumentedTest"
          : "com.yepanywhere.mobile.security.YaSecurityClientE2eInstrumentedTest",
      ];
      const options = {
        class: classes.join(","),
        yaProbeWsUrl: fixture.endpoint,
        yaProbeUsername: "ios-fixture",
        yaProbePassword: "native-fixture-password",
        yaProbeUploadBytes: String(mux ? 100 * 1024 * 1024 : 1024 * 1024),
        ...(relay
          ? {
              yaProbeRelayWsUrl: relayURL!,
              yaProbeSecondUsername: "rust-beta",
              yaProbeRelayStatusUrl: `http://127.0.0.1:${relay.port}/status`,
            }
          : {}),
      };
      const args = Object.entries(options).flatMap(([key, value]) => [
        "-e",
        key,
        value,
      ]);
      console.log(
        `Android production transport: ${mux ? "mux + 100 MiB" : "direct + security"}`,
      );
      const output = await device(
        [
          "shell",
          "am",
          "instrument",
          "-w",
          "-r",
          ...args,
          "com.yepanywhere.mobile.test/androidx.test.runner.AndroidJUnitRunner",
        ],
        true,
      );
      console.log(output);
      if (
        !/OK \(2 tests\)/.test(output) ||
        /FAILURES!!!|INSTRUMENTATION_FAILED/.test(output)
      )
        throw new Error("Owned Android acceptance did not pass both tests");
    } finally {
      for (const port of reversed)
        await device(["reverse", "--remove", `tcp:${port}`]);
      await beta?.stop();
      await fixture?.stop();
      await relay?.close();
    }
  }
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
