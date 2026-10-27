import type { SDKMessage } from "../sdk/types.js";
import type { Process } from "./Process.js";
import type { Message } from "./types.js";

const RESTART_COMPACT_WAIT_MS = 12_000;

export type RestartCompactAttempt =
  | { status: "unavailable"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "completed"; command: string }
  | { status: "timed-out"; command: string }
  | { status: "failed"; command?: string; reason: string };

function isCompactBoundaryMessage(message: SDKMessage | Message): boolean {
  return message.type === "system" && message.subtype === "compact_boundary";
}

async function waitForRestartCompactBoundary(
  process: Process,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (completed: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(completed);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);

    unsubscribe = process.subscribe((event) => {
      if (event.type === "message" && isCompactBoundaryMessage(event.message)) {
        finish(true);
        return;
      }
      if (event.type === "terminated" || event.type === "error") {
        finish(false);
      }
    });
  });
}

export async function tryRestartCompact(
  process: Process | undefined,
): Promise<RestartCompactAttempt> {
  if (!process) {
    return { status: "unavailable", reason: "no active source process" };
  }
  if (process.state.type !== "idle") {
    return {
      status: "skipped",
      reason: `source process was ${process.state.type}`,
    };
  }
  if (!process.supportsDynamicCommands) {
    return {
      status: "unavailable",
      reason: "source process does not advertise slash commands",
    };
  }

  let command: string | undefined;
  try {
    const commands = await process.supportedCommands();
    command =
      commands?.find((candidate) => candidate.name === "compact")?.name ??
      commands?.find((candidate) => candidate.name === "compress")?.name;
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (!command) {
    return {
      status: "unavailable",
      reason: "no compact/compress slash command advertised",
    };
  }

  const waitForCompact = waitForRestartCompactBoundary(
    process,
    RESTART_COMPACT_WAIT_MS,
  );
  const queued = process.queueMessage({ text: `/${command}` });
  if (!queued.success) {
    return {
      status: "failed",
      command,
      reason: queued.error ?? "compact command was not accepted",
    };
  }

  return (await waitForCompact)
    ? { status: "completed", command }
    : { status: "timed-out", command };
}
