import type {
  ClaudeSessionEntry,
  SessionRewindRecord,
} from "@yep-anywhere/shared";
import {
  REWOUND_GROUP_SUBTYPE,
  getLogicalParentUuid,
  isCompactBoundary,
} from "@yep-anywhere/shared";
import {
  buildDag,
  collectAllToolResultIds,
  findOrphanedToolUses,
  findSiblingToolBranches,
  findSiblingToolResults,
} from "./dag.js";

export interface VisibleClaudeEntriesResult {
  entries: ClaudeSessionEntry[];
  orphanedToolUses: Set<string>;
}

interface NormalizeClaudeEntriesOptions {
  includeOrphans?: boolean;
  /**
   * Same-session rewinds recorded by YA. Rows a rewind dropped are removed
   * from active-branch selection and re-emitted after the cut as a group
   * headed by a synthetic `rewound_group` system row. See
   * topics/session-rewind.md.
   */
  rewindRecords?: readonly SessionRewindRecord[];
}

interface RewoundGroupHeader {
  raw: ClaudeSessionEntry;
  lineIndex: number;
}

/**
 * Rows a rewind record dropped: descendants of the cut written before the
 * rewind. The walk stops at rows written after the record, which are the live
 * continuation, so their descendants stay live too.
 */
function collectRewoundRows(
  rawMessages: ClaudeSessionEntry[],
  records: readonly SessionRewindRecord[],
): {
  rewoundGroupByUuid: Map<string, string>;
  headers: Map<string, RewoundGroupHeader>;
} {
  const rewoundGroupByUuid = new Map<string, string>();
  const headers = new Map<string, RewoundGroupHeader>();
  if (records.length === 0) return { rewoundGroupByUuid, headers };

  const childrenByParent = new Map<
    string,
    Array<{ uuid: string; lineIndex: number; timestamp: string | undefined }>
  >();
  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    if (!raw || raw.type === "progress") continue;
    const uuid = getEntryUuid(raw);
    const parentUuid = getEntryParentUuid(raw);
    if (!uuid || !parentUuid) continue;
    const timestamp =
      "timestamp" in raw && typeof raw.timestamp === "string"
        ? raw.timestamp
        : undefined;
    const siblings = childrenByParent.get(parentUuid);
    const child = { uuid, lineIndex, timestamp };
    if (siblings) siblings.push(child);
    else childrenByParent.set(parentUuid, [child]);
  }

  const sorted = [...records].sort((left, right) =>
    left.at.localeCompare(right.at),
  );
  for (const record of sorted) {
    const queue = [record.cutMessageId];
    let firstLineIndex = Number.POSITIVE_INFINITY;
    let count = 0;
    while (queue.length > 0) {
      const parent = queue.shift() as string;
      for (const child of childrenByParent.get(parent) ?? []) {
        if (rewoundGroupByUuid.has(child.uuid)) continue;
        if (child.timestamp !== undefined && child.timestamp > record.at) {
          continue;
        }
        rewoundGroupByUuid.set(child.uuid, record.id);
        firstLineIndex = Math.min(firstLineIndex, child.lineIndex);
        count += 1;
        queue.push(child.uuid);
      }
    }
    if (count === 0) continue;
    const header = {
      type: "system",
      subtype: REWOUND_GROUP_SUBTYPE,
      uuid: `rewound-group-${record.id}`,
      parentUuid: record.cutMessageId,
      timestamp: record.at,
      content: "",
      isSynthetic: true,
      rewoundGroupId: record.id,
      rewoundGroup: {
        reason: record.reason,
        cutTurnIndex: record.cutTurnIndex,
        droppedTurnCount: record.droppedTurnCount,
        rowCount: count,
        at: record.at,
        ...(record.clearloopIteration !== undefined
          ? { clearloopIteration: record.clearloopIteration }
          : {}),
        ...(record.clearloopTotal !== undefined
          ? { clearloopTotal: record.clearloopTotal }
          : {}),
        ...(record.clearloopPrompt
          ? { clearloopPrompt: record.clearloopPrompt }
          : {}),
      },
    } as unknown as ClaudeSessionEntry;
    headers.set(record.id, { raw: header, lineIndex: firstLineIndex - 0.5 });
  }
  return { rewoundGroupByUuid, headers };
}

function hasQueueOperationContent(raw: ClaudeSessionEntry): boolean {
  if (raw.type !== "queue-operation" || raw.operation !== "enqueue") {
    return false;
  }

  if (typeof raw.content === "string") {
    return raw.content.trim().length > 0;
  }

  return Array.isArray(raw.content) && raw.content.length > 0;
}

/**
 * A queue-operation entry with the YA-computed delivery stamp that
 * normalization spreads onto the served Message (Message.queueDeliveredAt).
 */
type StampedClaudeSessionEntry = ClaudeSessionEntry & {
  queueDeliveredAt?: string;
};

function collectHistoricalQueueEntries(
  rawMessages: ClaudeSessionEntry[],
): Array<{ lineIndex: number; raw: StampedClaudeSessionEntry }> {
  const pendingEnqueues: Array<{ lineIndex: number; raw: ClaudeSessionEntry }> =
    [];
  const historicalEntries: Array<{
    lineIndex: number;
    raw: StampedClaudeSessionEntry;
  }> = [];

  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    if (raw?.type !== "queue-operation") continue;

    if (raw.operation === "enqueue") {
      if (hasQueueOperationContent(raw)) {
        pendingEnqueues.push({ lineIndex, raw });
      }
      continue;
    }

    if (
      (raw.operation === "dequeue" || raw.operation === "remove") &&
      pendingEnqueues.length > 0
    ) {
      const nextEntry = pendingEnqueues.shift();
      if (raw.operation === "remove" && nextEntry) {
        // Stamp when the queued message was delivered into the turn (the
        // remove op's timestamp). The entry only becomes visible at delivery
        // while keeping its enqueue-position lineIndex, so incremental
        // afterMessageId slicing needs this to know the entry is newer than
        // a mid-turn anchor (see pagination.ts).
        const deliveredAt =
          typeof raw.timestamp === "string" ? raw.timestamp : undefined;
        historicalEntries.push(
          deliveredAt
            ? {
                lineIndex: nextEntry.lineIndex,
                raw: { ...nextEntry.raw, queueDeliveredAt: deliveredAt },
              }
            : nextEntry,
        );
      }
    }
  }

  return historicalEntries;
}

function insertEntryByLineIndex(
  entries: Array<{ lineIndex: number; raw: ClaudeSessionEntry }>,
  entry: { lineIndex: number; raw: ClaudeSessionEntry },
): void {
  const insertAt = entries.findIndex(
    (existing) => existing.lineIndex > entry.lineIndex,
  );
  if (insertAt === -1) {
    entries.push(entry);
    return;
  }
  entries.splice(insertAt, 0, entry);
}

function getEntryUuid(raw: ClaudeSessionEntry): string | undefined {
  const uuid = "uuid" in raw ? raw.uuid : undefined;
  return typeof uuid === "string" ? uuid : undefined;
}

function getEntryParentUuid(raw: ClaudeSessionEntry): string | undefined {
  const parentUuid = "parentUuid" in raw ? raw.parentUuid : undefined;
  return typeof parentUuid === "string" ? parentUuid : undefined;
}

function isCompactSummaryEntry(raw: ClaudeSessionEntry): boolean {
  return (
    raw.type === "user" &&
    (raw as { isCompactSummary?: unknown }).isCompactSummary === true
  );
}

export function collectVisibleClaudeEntries(
  allRawMessages: ClaudeSessionEntry[],
  options: NormalizeClaudeEntriesOptions = {},
): VisibleClaudeEntriesResult {
  const { includeOrphans = true } = options;
  const { rewoundGroupByUuid, headers: rewoundHeaders } = collectRewoundRows(
    allRawMessages,
    options.rewindRecords ?? [],
  );
  // Rewound rows are withheld from tip selection so the cut is the live tail
  // until the session writes past it; they rejoin below as grouped extras.
  const rawMessages =
    rewoundGroupByUuid.size === 0
      ? allRawMessages
      : allRawMessages.filter((raw) => {
          const uuid = getEntryUuid(raw);
          return !uuid || !rewoundGroupByUuid.has(uuid);
        });
  const { activeBranch } = buildDag(rawMessages);
  const activeBranchUuids = new Set(activeBranch.map((node) => node.uuid));
  const allToolResultIds = collectAllToolResultIds(rawMessages);
  const orphanedToolUses = includeOrphans
    ? findOrphanedToolUses(activeBranch, allToolResultIds)
    : new Set<string>();

  const lineIndexByUuid = new Map<string, number>();
  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    const uuid = raw ? getEntryUuid(raw) : undefined;
    if (uuid) {
      lineIndexByUuid.set(uuid, lineIndex);
    }
  }

  const extrasByParent = new Map<
    string,
    Array<{ lineIndex: number; raw: ClaudeSessionEntry }>
  >();

  const pushExtra = (
    parentUuid: string,
    raw: ClaudeSessionEntry,
    lineIndex: number,
  ) => {
    const existing = extrasByParent.get(parentUuid);
    const entry = { lineIndex, raw };
    if (existing) {
      existing.push(entry);
    } else {
      extrasByParent.set(parentUuid, [entry]);
    }
  };

  const compactSummariesByParent = new Map<
    string,
    Array<{ lineIndex: number; raw: ClaudeSessionEntry }>
  >();
  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    if (!raw || !isCompactSummaryEntry(raw)) continue;

    const parentUuid = getEntryParentUuid(raw);
    if (!parentUuid) continue;

    const existing = compactSummariesByParent.get(parentUuid);
    const entry = { lineIndex, raw };
    if (existing) {
      existing.push(entry);
    } else {
      compactSummariesByParent.set(parentUuid, [entry]);
    }
  }

  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    if (!raw || !isCompactBoundary(raw)) continue;

    const uuid = getEntryUuid(raw);
    if (!uuid) continue;

    const summaries = compactSummariesByParent.get(uuid) ?? [];
    if (activeBranchUuids.has(uuid)) {
      for (const summary of summaries) {
        const summaryUuid = getEntryUuid(summary.raw);
        if (!summaryUuid || !activeBranchUuids.has(summaryUuid)) {
          pushExtra(uuid, summary.raw, summary.lineIndex);
        }
      }
      continue;
    }

    const logicalParentUuid = getLogicalParentUuid(raw);
    if (!logicalParentUuid || !activeBranchUuids.has(logicalParentUuid)) {
      continue;
    }

    pushExtra(logicalParentUuid, raw, lineIndex);
    for (const summary of summaries) {
      const summaryUuid = getEntryUuid(summary.raw);
      if (!summaryUuid || !activeBranchUuids.has(summaryUuid)) {
        pushExtra(logicalParentUuid, summary.raw, summary.lineIndex);
      }
    }
  }

  for (const sibling of findSiblingToolResults(activeBranch, rawMessages)) {
    const uuid = getEntryUuid(sibling.raw);
    pushExtra(
      sibling.parentUuid,
      sibling.raw,
      uuid ? (lineIndexByUuid.get(uuid) ?? Number.MAX_SAFE_INTEGER) : 0,
    );
  }

  for (const branch of findSiblingToolBranches(activeBranch, rawMessages)) {
    for (const node of branch.nodes) {
      pushExtra(branch.branchPoint, node.raw, node.lineIndex);
    }
  }

  // Rewound rows rejoin as extras under their cut, headed by the group row,
  // so they render after the kept turn and before the live continuation.
  if (rewoundGroupByUuid.size > 0) {
    const cutByRecord = new Map<string, string>();
    for (const record of options.rewindRecords ?? []) {
      cutByRecord.set(record.id, record.cutMessageId);
    }
    for (const [recordId, header] of rewoundHeaders) {
      const cut = cutByRecord.get(recordId);
      if (cut && activeBranchUuids.has(cut)) {
        pushExtra(cut, header.raw, header.lineIndex);
      }
    }
    for (let lineIndex = 0; lineIndex < allRawMessages.length; lineIndex++) {
      const raw = allRawMessages[lineIndex];
      const uuid = raw ? getEntryUuid(raw) : undefined;
      const recordId = uuid ? rewoundGroupByUuid.get(uuid) : undefined;
      if (!raw || !recordId) continue;
      const cut = cutByRecord.get(recordId);
      if (!cut || !activeBranchUuids.has(cut)) continue;
      pushExtra(
        cut,
        { ...raw, rewoundGroupId: recordId } as unknown as ClaudeSessionEntry,
        lineIndex,
      );
    }
  }

  for (const extras of extrasByParent.values()) {
    extras.sort((left, right) => left.lineIndex - right.lineIndex);
  }

  const entries: Array<{ lineIndex: number; raw: ClaudeSessionEntry }> = [];
  const includedUuids = new Set<string>();
  const includedNonUuidLineIndices = new Set<number>();
  const pushUnique = (raw: ClaudeSessionEntry, lineIndex: number) => {
    const uuid = getEntryUuid(raw);
    if (uuid) {
      if (includedUuids.has(uuid)) return;
      includedUuids.add(uuid);
    } else {
      if (includedNonUuidLineIndices.has(lineIndex)) return;
      includedNonUuidLineIndices.add(lineIndex);
    }
    entries.push({ lineIndex, raw });
  };

  for (const node of activeBranch) {
    pushUnique(node.raw, node.lineIndex);

    const extras = extrasByParent.get(node.uuid);
    if (!extras) continue;

    for (const extra of extras) {
      pushUnique(extra.raw, extra.lineIndex);
    }
  }

  for (const queuedEntry of collectHistoricalQueueEntries(rawMessages)) {
    const beforeLength = entries.length;
    pushUnique(queuedEntry.raw, queuedEntry.lineIndex);
    if (entries.length === beforeLength) continue;

    const appended = entries.pop();
    if (!appended) continue;
    insertEntryByLineIndex(entries, appended);
  }

  return {
    entries: entries.map((entry) => entry.raw),
    orphanedToolUses,
  };
}
