import {
  SESSION_REWIND_CAPABILITY,
  type ServerCapabilitySource,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { getMessageId } from "@yep-anywhere/shared/transcript/message";
import type { Message } from "../types";
import { isPlainUserTurn } from "./linearMessageDedup";

/** Providers whose sessions YA can rewind in place. See topics/session-rewind.md. */
const REWIND_PROVIDERS = new Set(["claude", "claude-gateway", "claude-ollama"]);

export function providerSupportsSessionRewind(
  provider: string | null | undefined,
): boolean {
  return Boolean(provider && REWIND_PROVIDERS.has(provider));
}

/**
 * Same-session rewind is optional: an older server has no rewind route, so
 * the client must show no Clear entries and send no request.
 */
export function supportsSessionRewind(
  version: ServerCapabilitySource | null | undefined,
  provider: string | null | undefined,
): boolean {
  return (
    providerSupportsSessionRewind(provider) &&
    serverHasCapability(version, SESSION_REWIND_CAPABILITY)
  );
}

export interface SessionTurnIndex {
  /** Render id by turn index N over the full sequence, cleared turns too. */
  idByIndex: Map<number, string>;
  indexById: Map<string, number>;
  /** Turns currently inside a cleared span (not valid `/clear` targets). */
  clearedIds: Set<string>;
  /** Highest index known to this client. */
  lastIndex: number;
}

/**
 * The stable turn index N for every user turn (topics/session-rewind.md
 * § Vocabulary). Server normalization stamps `turnIndex` over the full
 * sequence, cleared turns included; rows not yet stamped (live stream rows)
 * continue the count from the last stamped turn, so a partially loaded
 * window still numbers correctly as long as its first turn is stamped.
 */
export function getSessionTurnIndex(
  messages: readonly Message[],
): SessionTurnIndex {
  const idByIndex = new Map<number, string>();
  const indexById = new Map<string, number>();
  const clearedIds = new Set<string>();
  let lastIndex = 0;
  for (const message of messages) {
    const extras = message as {
      isSubagent?: unknown;
      rewoundGroupId?: unknown;
      isSynthetic?: unknown;
      turnIndex?: unknown;
    };
    if (
      !isPlainUserTurn(message) ||
      extras.isSubagent === true ||
      extras.isSynthetic === true
    ) {
      continue;
    }
    const id = getMessageId(message);
    if (!id || indexById.has(id)) continue;
    const index =
      typeof extras.turnIndex === "number" ? extras.turnIndex : lastIndex + 1;
    lastIndex = Math.max(lastIndex, index);
    idByIndex.set(index, id);
    indexById.set(id, index);
    if (typeof extras.rewoundGroupId === "string") clearedIds.add(id);
  }
  return { idByIndex, indexById, clearedIds, lastIndex };
}
