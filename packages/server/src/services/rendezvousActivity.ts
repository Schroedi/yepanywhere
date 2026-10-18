import {
  publishRendezvousUserTurn as publish,
  type RendezvousUserTurn,
} from "./rendezvous-activity.mjs";
import { getLogger } from "../logging/logger.js";

/** Publish actual user activity independently of the optional filesystem watcher. */
export function publishRendezvousUserTurn(turn: RendezvousUserTurn): void {
  publish(turn, (error) => {
    getLogger().warn(
      { projectPath: turn.projectPath, error: error.message },
      "Rendezvous latest-session publication failed",
    );
  });
}
