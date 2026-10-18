import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const pending = new Map();
const latest = new Map();
let running = false;

/** Coalesce user activity without holding up session input or spawning per turn. */
export function publishRendezvousUserTurn(turn, onError) {
  const prior = latest.get(turn.projectPath);
  if (prior && prior.turn.receivedAt > turn.receivedAt) return;
  latest.delete(turn.projectPath);
  latest.set(turn.projectPath, { turn, onError });
  if (latest.size > 128) latest.delete(latest.keys().next().value);
  flushRendezvousUserTurn(turn.projectPath);
}

/** Replay activity accepted before an opt-in watcher created its destination. */
export function flushRendezvousUserTurn(projectPath) {
  const entry = latest.get(projectPath);
  if (!entry) return;
  const { turn, onError } = entry;
  if (!existsSync(join(turn.projectPath, ".rendez"))) return;
  if (pending.size >= 128 && !pending.has(turn.projectPath)) {
    onError(new Error("Rendezvous activity queue reached its project limit"));
    return;
  }
  const previous = pending.get(turn.projectPath);
  if (previous && previous.turn.receivedAt > turn.receivedAt) return;
  pending.set(turn.projectPath, { turn, onError });
  drain();
}

function drain() {
  if (running || pending.size === 0) return;
  const [projectPath, { turn, onError }] = pending.entries().next().value;
  pending.delete(projectPath);
  running = true;
  execFile(
    "rendez",
    [
      "--project",
      projectPath,
      "subscribe",
      "--harness",
      turn.harness,
      "--session",
      turn.sessionId,
      "--provider-session",
      turn.providerSessionId,
      "--latest",
      "--received-at",
      String(turn.receivedAt),
    ],
    { timeout: 10_000, maxBuffer: 16 * 1024 },
    (error) => {
      running = false;
      if (error) onError(error);
      drain();
    },
  );
}
