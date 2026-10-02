/** Explicit real-provider smoke; offline CLI discovery and fixture image only. */
import { strict as assert } from "node:assert";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CodexProvider } from "../packages/server/src/sdk/providers/codex.js";
import { ToolResultMediaStore } from "../packages/server/src/media/ToolResultMediaStore.js";
import { getDefaultCodexHomeDir } from "../packages/server/src/projects/codex-scanner.js";
import { CodexSessionReader } from "../packages/server/src/sessions/codex-reader.js";
import { normalizeSession } from "../packages/server/src/sessions/normalization.js";
import { Supervisor } from "../packages/server/src/supervisor/Supervisor.js";
import type { Process } from "../packages/server/src/supervisor/Process.js";
import { encodeProjectId } from "../packages/server/src/supervisor/types.js";
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
const temporary = await mkdtemp(join(tmpdir(), "ya-mc-provider-smoke-"));
const cwd = join(temporary, "project");
await mkdir(cwd);
const capturePath = join(cwd, "browser.png");
await copyFile(values.capture, capturePath);
const captureBytes = await readFile(capturePath);
const codexHome = join(temporary, "codex");
const provider = new CodexProvider({ codexHome });
const mediaStore = new ToolResultMediaStore({
  dataDir: join(temporary, "data"),
});
const supervisor = new Supervisor({
  provider,
  toolResultMediaStore: mediaStore,
});
const messages: SDKMessage[] = [];
let session: Process | undefined;
let reader: CodexSessionReader | undefined;
let unsubscribe: (() => void) | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
try {
  // Retain the operator's authentication/endpoint choices, while keeping this
  // bounded probe's provider history and state out of their normal profile.
  await mkdir(codexHome, { mode: 0o700 });
  for (const name of ["auth.json", "config.toml"]) {
    const destination = join(codexHome, name);
    try {
      await copyFile(join(getDefaultCodexHomeDir(), name), destination);
      await chmod(destination, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // Use the real provider entry point, which composes installed MC itself.
  process.env.YEP_MC_APP = values.app;
  if (values.publisher) {
    process.env.YEP_MC_TEAM_ID = values.publisher;
    process.env.YEP_MC_PUBLISHER = values.publisher;
  }
  const launched = await supervisor.createSession(cwd, "bypassPermissions", {
    machineControl: true,
    providerName: "codex",
    model: values.model,
    effort: "low",
  });
  assert("queueMessage" in launched, "Probe launch must be immediate");
  session = launched;
  const completed = new Promise<void>((resolve, reject) => {
    unsubscribe = session?.subscribe((event) => {
      if (event.type !== "message") return;
      messages.push(event.message);
      if (event.message.type === "result") resolve();
      if (event.message.type === "error")
        reject(
          new Error(
            `Provider reported an error: ${JSON.stringify(event.message.error)}`,
          ),
        );
    });
    timeout = setTimeout(() => {
      reject(new Error("Bounded provider smoke timed out"));
      void session?.abort();
    }, 90_000);
  });
  session.queueMessage({
    text: "This is a bounded installation/capture acceptance test. Use only the advertised installed Machine Control command to run `agent instructions` and `agent identity` (offline queries). Make no target operations or access requests, run no other commands, edit no files and spawn no agents. Inspect the attached browser fixture PNG using your image viewer; that read-only tool is allowed. Reply with MC_PROTOCOL=<observed client protocol>, CLI_WORKFLOW=read and CAPTURE_BUTTON=<the visible page button text>.",
    attachments: [
      {
        id: "mc-cli-fixture",
        originalName: "browser.png",
        name: "browser.png",
        path: capturePath,
        size: captureSize,
        mimeType: "image/png",
      },
    ],
  });
  await completed;
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
        JSON.stringify(block.input).includes(capturePath),
    ),
    "Provider must invoke its native image viewer",
  );
  assert(
    text.includes("MC_PROTOCOL=1") &&
      text.includes("CLI_WORKFLOW=read") &&
      text.includes("CAPTURE_BUTTON=Change site icon"),
    "Provider must read the CLI identity and observe the fixture image",
  );
  const liveMedia = messages.flatMap(
    (message) => message.toolResultMedia ?? [],
  );
  const liveCapture = liveMedia.find((media) => media.state === "stored");
  assert(
    liveCapture?.state === "stored",
    "Live Process output must expose a capture handle",
  );
  const projectId = encodeProjectId(cwd);
  const liveFile = await mediaStore.getMediaFile(
    cwd,
    projectId,
    session.sessionId,
    liveCapture.id,
  );
  assert(
    liveFile?.bytes,
    "Default-off preservation must serve live media without a disk copy",
  );
  assert.deepEqual(
    liveFile.bytes,
    captureBytes,
    "Live media handle must serve exact capture bytes",
  );
  reader = new CodexSessionReader({
    sessionsDir: join(codexHome, "sessions"),
    projectPath: cwd,
  });
  const loaded = await reader.getSession(session.sessionId, projectId);
  assert(loaded, "The real provider transcript must be readable for reload");
  const reloaded = normalizeSession(loaded);
  const reloadedMessages = await mediaStore
    .createMaterializer({
      provider: "codex",
      projectId,
      projectPath: cwd,
      getSessionId: () => session?.sessionId ?? "",
    })
    .materializeMessages(reloaded.messages);
  const reloadedMedia = reloadedMessages.flatMap(
    (message) => message.toolResultMedia ?? [],
  );
  const reloadedCapture = reloadedMedia.find(
    (media) => media.state === "stored",
  );
  assert(
    reloadedCapture?.state === "stored",
    "Provider transcript reload must reconstruct a capture handle",
  );
  const reloadedFile = await mediaStore.getMediaFile(
    cwd,
    projectId,
    session.sessionId,
    reloadedCapture.id,
  );
  assert(reloadedFile?.bytes, "Reloaded transient capture must be fetchable");
  assert.deepEqual(
    reloadedFile.bytes,
    captureBytes,
    "Reloaded handle must serve exact capture bytes",
  );
  console.log(
    "PASS real YA supervisor/provider read installed CLI, consumed capture, and served exact live/reloaded media bytes",
  );
} finally {
  if (timeout) clearTimeout(timeout);
  await session?.abort();
  unsubscribe?.();
  await reader?.close();
  await rm(temporary, { recursive: true, force: true });
}
