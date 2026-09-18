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
  /** Render id of every live user turn, in order; index N is `ids[N - 1]`. */
  ids: string[];
  indexById: Map<string, number>;
}

/**
 * The stable turn index N for every live user turn (topics/session-rewind.md
 * § Vocabulary): plain user turns in display order, skipping subagent rows
 * and rows a rewind dropped.
 */
export function getSessionTurnIndex(
  messages: readonly Message[],
): SessionTurnIndex {
  const ids: string[] = [];
  const indexById = new Map<string, number>();
  for (const message of messages) {
    const extras = message as {
      isSubagent?: unknown;
      rewoundGroupId?: unknown;
      isSynthetic?: unknown;
    };
    if (
      !isPlainUserTurn(message) ||
      extras.isSubagent === true ||
      typeof extras.rewoundGroupId === "string" ||
      extras.isSynthetic === true
    ) {
      continue;
    }
    const id = getMessageId(message);
    if (!id || indexById.has(id)) continue;
    ids.push(id);
    indexById.set(id, ids.length);
  }
  return { ids, indexById };
}
