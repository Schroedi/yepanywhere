import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  readHostCapacity,
  readHostSample,
} from "../../../scripts/perf-suite/host-profile.mjs";
import { dirname, join, resolve } from "node:path";

const ios = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(ios, "../..");
const phase = process.argv[2] ?? "test";
const testSelection = process.argv.slice(3);
if (
  testSelection.some(
    (x) =>
      !/^-(only|skip)-testing:YepAnywhere(UI)?Tests(?:\/[A-Za-z0-9_]+){0,2}$/.test(
        x,
      ),
  )
)
  throw new Error("Only XCTest selection arguments are supported");
if (!["prepare", "build", "test"].includes(phase))
  throw new Error("Expected prepare, build or test");
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error(
    "iOS building/testing requires Apple Silicon macOS and Xcode",
  );
const env = { ...process.env };
await import("../../mobile-core/scripts/run.mjs");
const children = new Set();
async function run(command, args, cwd = ios, capture = false) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    children.add(child);
    child.once("close", () => children.delete(child));
    let output = "";
    child.stdout?.on("data", (data) => {
      output += data;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolveRun(output.trim())
        : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
async function generateProject() {
  let spec = await readFile(join(ios, "project.yml"), "utf8");
  try {
    await stat(join(ios, "Config/GoogleService-Info.plist"));
    spec = spec.replace(
      "        PRODUCT_BUNDLE_IDENTIFIER: com.yepanywhere.ios\n",
      "        PRODUCT_BUNDLE_IDENTIFIER: com.yepanywhere.ios\n        CODE_SIGN_ENTITLEMENTS: App/Push.entitlements\n",
    );
    spec = spec.replace(
      "      - path: App",
      "      - path: App\n      - path: Config/GoogleService-Info.plist\n        buildPhase: resources",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await stat(join(ios, "Config/Signing.xcconfig"));
    spec = spec.replace(
      "    type: application",
      "    configFiles:\n      Debug: Config/Signing.xcconfig\n      Release: Config/Signing.xcconfig\n    type: application",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(join(ios, "project.generated.yml"), spec);
  await run("xcodegen", ["generate", "--spec", "project.generated.yml"]);
}
await mkdir(join(ios, "build"), { recursive: true });
await run(
  "pnpm",
  [
    "--filter",
    "@yep-anywhere/client",
    "exec",
    "vite",
    "build",
    "--config",
    "vite.config.remote.ts",
    "--outDir",
    join(ios, "build/web"),
  ],
  repo,
);
await writeFile(join(ios, "build/fixture.json"), "{}", { flag: "wx" }).catch(
  (error) => {
    if (error.code !== "EEXIST") throw error;
  },
);
await generateProject();
const packageState = join(
  ios,
  "YepAnywhere.xcodeproj/project.xcworkspace/xcshareddata/swiftpm",
);
await mkdir(packageState, { recursive: true });
await copyFile(
  join(ios, "Package.resolved"),
  join(packageState, "Package.resolved"),
);
if (phase === "prepare") process.exit(0);
const derived = join(ios, "build/DerivedData");
if (phase === "build") {
  await run("xcodebuild", [
    "-project",
    "YepAnywhere.xcodeproj",
    "-scheme",
    "YepAnywhere",
    "-configuration",
    "Release",
    "-sdk",
    "iphoneos",
    "-derivedDataPath",
    derived,
    "-onlyUsePackageVersionsFromResolvedFile",
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ]);
} else {
  const { startFixture } = await import(
    "../../mobile-core/scripts/fixture.mjs"
  );
  const fixture = await startFixture();
  const { startTLSFixture } = await import("./tls-fixture.mjs");
  let simulator, tls, simulatorApp;
  const capacity = await readHostCapacity();
  const host = { capacity, start: null, end: null };
  const hostPath = join(ios, `build/host-${Date.now()}.json`);
  const sample = async () => ({
    system: await readHostSample(capacity),
    cpuAndVM: await run("top", ["-l", "2", "-s", "1", "-n", "0"], ios, true),
    swap: await run("sysctl", ["vm.swapusage"], ios, true),
  });
  const interrupt = () => {
    for (const child of children) child.kill("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    tls = await startTLSFixture(fixture.endpoint, join(ios, "build/tls"));
    await writeFile(
      join(ios, "build/fixture.json"),
      JSON.stringify({
        endpoint: fixture.endpoint,
        port: fixture.port,
        tls: tls.addresses,
      }),
    );
    await generateProject();
    const inventory = JSON.parse(
      await run("xcrun", ["simctl", "list", "runtimes", "--json"], ios, true),
    );
    const runtime = inventory.runtimes
      .filter((x) => x.isAvailable && x.identifier.includes("iOS"))
      .sort((a, b) =>
        b.version.localeCompare(a.version, undefined, { numeric: true }),
      )[0];
    if (!runtime) throw new Error("No installed iOS simulator runtime");
    const types = JSON.parse(
      await run(
        "xcrun",
        ["simctl", "list", "devicetypes", "--json"],
        ios,
        true,
      ),
    ).devicetypes;
    const deviceType =
      types.find((x) => x.name === "iPhone 17") ??
      types.find((x) => x.name === "iPhone 16");
    if (!deviceType)
      throw new Error("No supported iPhone simulator device type");
    simulator = await run(
      "xcrun",
      [
        "simctl",
        "create",
        "YA iOS acceptance",
        deviceType.identifier,
        runtime.identifier,
      ],
      ios,
      true,
    );
    await run("xcrun", ["simctl", "boot", simulator]);
    await run("xcrun", ["simctl", "bootstatus", simulator, "-b"]);
    // Simulator's window supplies the display compositor/frame clock. A
    // headless device can throttle rAF independently of keyboard acknowledgement.
    const developer = await run("xcode-select", ["-p"], ios, true);
    simulatorApp = spawn(
      join(developer, "Applications/Simulator.app/Contents/MacOS/Simulator"),
      ["-CurrentDeviceUDID", simulator],
      { env, stdio: "ignore" },
    );
    await new Promise((done, fail) => {
      simulatorApp.once("spawn", done);
      simulatorApp.once("error", fail);
    });
    await run("xcrun", [
      "simctl",
      "keychain",
      simulator,
      "add-root-cert",
      tls.root,
    ]);
    host.start = await sample();
    await run("xcodebuild", [
      "-project",
      "YepAnywhere.xcodeproj",
      "-scheme",
      "YepAnywhere",
      "-configuration",
      "Debug",
      "-parallel-testing-enabled",
      "NO",
      "-destination",
      `platform=iOS Simulator,id=${simulator}`,
      "-derivedDataPath",
      derived,
      "-resultBundlePath",
      join(ios, `build/acceptance-${Date.now()}.xcresult`),
      "-onlyUsePackageVersionsFromResolvedFile",
      "CODE_SIGNING_ALLOWED=YES",
      "CODE_SIGN_IDENTITY=-",
      "test",
      ...testSelection,
    ]);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    try {
      if (simulator) {
        await run("xcrun", ["simctl", "shutdown", simulator]).catch(() => {});
        await run("xcrun", ["simctl", "delete", simulator]);
      }
    } finally {
      if (simulatorApp?.exitCode === null) {
        const ended = new Promise((done) => simulatorApp.once("close", done));
        simulatorApp.kill("SIGTERM");
        await Promise.race([
          ended,
          new Promise((done) => setTimeout(done, 5000)),
        ]);
        if (simulatorApp.exitCode === null) {
          simulatorApp.kill("SIGKILL");
          await ended;
        }
      }
      try {
        await tls?.stop();
      } finally {
        await fixture.stop();
      }
      host.end = await sample();
      await writeFile(hostPath, JSON.stringify(host, null, 2));
    }
  }
}
