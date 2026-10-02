/** Verify an installed product and the provider-launch context composition. */
import { strict as assert } from "node:assert";
import { parseArgs } from "node:util";
import { tmpdir } from "node:os";
import {
  execute,
  verifyInstalledMachineControl,
} from "../packages/server/src/machine-control/installation.js";
import { startMachineControlSession } from "../packages/server/src/sdk/providers/machine-control.js";
import type {
  AgentSession,
  StartSessionOptions,
} from "../packages/server/src/sdk/providers/types.js";

const { values } = parseArgs({
  options: { app: { type: "string" }, publisher: { type: "string" } },
});
assert(
  values.app,
  "--app is required; --publisher is required on macOS/Windows",
);
const installed = await verifyInstalledMachineControl(
  values.app,
  values.publisher,
);
let launch: StartSessionOptions | undefined;
await startMachineControlSession(
  "codex",
  { cwd: tmpdir(), permissionMode: "bypassPermissions", machineControl: true },
  async (options) => {
    launch = options;
    return {} as AgentSession;
  },
  {
    environment: {
      YEP_MC_APP: values.app,
      YEP_MC_TEAM_ID: values.publisher,
      YEP_MC_PUBLISHER: values.publisher,
      PATH: process.env.PATH,
    },
  },
);
assert(launch?.globalInstructions?.includes(installed.command));
assert(launch?.agentEnvironment?.PATH?.startsWith(installed.directory));
const instructions = await execute(installed.python, [
  "-I",
  "-B",
  `${installed.root}/launch.py`,
  "agent",
  "instructions",
]);
assert(
  instructions.includes("claim release") &&
    instructions.includes("browser snapshot"),
);
console.log(
  "PASS authenticated installed CLI, compatible identity, owned instructions and launch-context composition",
);
