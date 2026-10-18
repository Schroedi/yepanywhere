import {
  publishRendezvousUserTurn as publish,
  type RendezvousUserTurn,
} from "./rendezvous-activity.mjs";
import { getLogger } from "../logging/logger.js";

type RendezvousUserTurnListener = (projectPath: string) => void;

const listeners = new Set<RendezvousUserTurnListener>();

/** Observe actual user turns, which are what may attach a project's watcher. */
export function onRendezvousUserTurn(
  listener: RendezvousUserTurnListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publish actual user activity independently of the optional filesystem watcher. */
export function publishRendezvousUserTurn(turn: RendezvousUserTurn): void {
  publish(turn, (error) => {
    getLogger().warn(
      { projectPath: turn.projectPath, error: error.message },
      "Rendezvous latest-session publication failed",
    );
  });
  // After publication, so a watcher this turn attaches replays the turn.
  for (const listener of listeners) listener(turn.projectPath);
}
