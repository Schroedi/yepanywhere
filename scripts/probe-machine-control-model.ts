/** Explicit real-provider smoke; offline CLI discovery and fixture image only. */
import { strict as assert } from "node:assert";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CodexProvider } from "../packages/server/src/sdk/providers/codex.js";
import type {
  ContentBlock,
  SDKMessage,
} from "../packages/server/src/sdk/types.js";

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    publisher: { type: "string" },
    capture: { type: "string" },
    model: { type: "string" },
  },
});
assert(
  values.app && values.capture,
  "--app and --capture fixture PNG are required",
);
assert(
  (await stat(values.capture)).size <= 8 * 1024 * 1024,
  "Bounded fixture capture required",
);
const captureSize = (await stat(values.capture)).size;
const cwd = await mkdtemp(join(tmpdir(), "ya-mc-provider-smoke-"));
const provider = new CodexProvider();
const messages: SDKMessage[] = [];
let session: Awaited<ReturnType<typeof provider.startSession>> | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
try {
  // Use the real provider entry point, which composes installed MC itself.
  process.env.YEP_MC_APP = values.app;
  if (values.publisher) {
    process.env.YEP_MC_TEAM_ID = values.publisher;
    process.env.YEP_MC_PUBLISHER = values.publisher;
  }
  session = await provider.startSession({
    cwd,
    permissionMode: "bypassPermissions",
    machineControl: true,
    model: values.model,
    effort: "low",
    initialMessage: {
      text: "This is a bounded installation/capture acceptance test. Use only the advertised installed Machine Control command to run `agent instructions` and `agent identity` (offline queries). Make no target operations or access requests, run no other commands, edit no files and spawn no agents. Inspect the attached browser fixture PNG using your image viewer; that read-only tool is allowed. Reply with MC_PROTOCOL=<observed client protocol>, CLI_WORKFLOW=read and CAPTURE_BUTTON=<the visible page button text>.",
      attachments: [
        {
          id: "mc-cli-fixture",
          originalName: "browser.png",
          name: "browser.png",
          path: values.capture,
          size: captureSize,
          mimeType: "image/png",
        },
      ],
    },
  });
  timeout = setTimeout(() => {
    void session?.abort();
  }, 90_000);
  for await (const message of session.iterator) {
    messages.push(message);
    if (message.type === "result" || message.type === "error") break;
  }
  assert(
    !messages.some((message) => message.type === "error"),
    "Provider reported an error",
  );
  const content = messages.flatMap<ContentBlock>((message) =>
    typeof message.message?.content === "string"
      ? [{ type: "text", text: message.message.content }]
      : (message.message?.content ?? []),
  );
  const tools = content.filter((block) => block.type === "tool_use");
  const commands = JSON.stringify(tools);
  assert(
    commands.includes("agent instructions") &&
      commands.includes("agent identity"),
    "Provider must actually query the installed client",
  );
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
  assert(
    tools.some(
      (block) =>
        block.name === "ViewImage" &&
        JSON.stringify(block.input).includes(values.capture ?? ""),
    ),
    "Provider must invoke its native image viewer",
  );
  assert(
    text.includes("MC_PROTOCOL=1") &&
      text.includes("CLI_WORKFLOW=read") &&
      text.includes("CAPTURE_BUTTON=Change site icon"),
    "Provider must read the CLI identity and observe the fixture image",
  );
  console.log(
    "PASS real YA Codex provider read installed instructions/identity and consumed the browser fixture capture",
  );
} finally {
  if (timeout) clearTimeout(timeout);
  await session?.abort();
  await rm(cwd, { recursive: true, force: true });
}
