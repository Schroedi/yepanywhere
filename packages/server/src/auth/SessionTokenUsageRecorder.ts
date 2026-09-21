/**
 * Attributes provider token charges to the principal whose work caused them,
 * so Settings → Users can say what each user's sessions actually cost.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Usage.
 *
 * Providers report usage per request, on an assistant frame or an out-of-band
 * `token_usage` frame, and a streaming Claude response repeats one request's
 * usage on every completed content block. So this accumulates per live process
 * and appends when the provider turn settles, rather than one line per frame:
 * a long turn costs a record or two, and the ledger keeps its per-turn
 * granularity.
 *
 * The four token classes stay apart, and requests are binned by context tier,
 * because a cache read is a tenth of a fresh prompt token and, on a provider
 * that has such a tier, a long request reprices the whole request. Only this
 * recorder sees a single request's prompt length, so the tier has to be decided
 * here — a sum cannot be un-summed later. The threshold is per provider, and
 * for a provider with no tier every request is standard.
 */

import {
  longContextThresholdTokens,
  type UsageTokenClasses,
} from "@yep-anywhere/shared";
import { getProjectName } from "../projects/paths.js";
import type { SDKMessage } from "../sdk/types.js";
import {
  extractCacheMissBillingObservation,
  usageObservationResponseId,
} from "../services/CacheMissBillingMonitor.js";
import type { Process } from "../supervisor/Process.js";

/** What the recorder appends. Kept narrow so tests need no usage service. */
export interface SessionTokenUsageRecord extends UsageTokenClasses {
  username?: string;
  /** Launch alias, which the report groups by. */
  model?: string;
  /** Resolved provider model id, which the price table is keyed by. */
  modelId?: string;
  project?: string;
  /** Which price list these counts are read under. */
  provider: string;
  /** Whether these requests were in the provider's long-context tier. */
  longContext: boolean;
}

export interface SessionTokenUsageRecorderOptions {
  /** Append a settled charge. Absent on a server built without the ledger. */
  record: (record: SessionTokenUsageRecord) => void;
  /** The principal who started a session; undefined means the superuser. */
  resolveUsername?: (sessionId: string) => string | undefined;
}

interface PendingTurn {
  /** One accumulator per context tier: `false` is the standard tier. */
  tiers: Map<boolean, UsageTokenClasses>;
  /** Last response already counted, so repeated frames add nothing. */
  lastResponseId?: string;
}

const emptyClasses = (): UsageTokenClasses => ({
  freshInputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
});

export class SessionTokenUsageRecorder {
  private readonly pending = new Map<string, PendingTurn>();

  constructor(private readonly options: SessionTokenUsageRecorderOptions) {}

  observeMessage(process: Process, message: SDKMessage): void {
    const observation = extractCacheMissBillingObservation(
      message,
      process.provider,
    );
    if (!observation) return;

    const pending: PendingTurn = this.pending.get(process.id) ?? {
      tiers: new Map(),
    };
    const responseId = usageObservationResponseId(message);
    if (responseId !== undefined && responseId === pending.lastResponseId) {
      // A second frame of one response repeats its usage; counting it would
      // bill the same request twice.
      return;
    }
    if (responseId !== undefined) pending.lastResponseId = responseId;

    const usage = observation.usage;
    const cachedInputTokens = usage.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage.cacheCreationTokens ?? 0;
    // Both providers' totals are normalized to the whole prompt, so what the
    // provider actually processed is the part neither read from nor wrote to
    // its cache. Claude reports the three classes disjointly and Codex reports
    // cached reads as a subset of input; this subtraction is right for both.
    const freshInputTokens = Math.max(
      0,
      usage.totalContextTokens - cachedInputTokens - cacheWriteTokens,
    );
    // The tier is the prompt this one request sent, not the turn's running sum,
    // and the threshold is the provider's own — 272k on OpenAI, none at all on
    // Anthropic, which prices its 1M window flat.
    const threshold = longContextThresholdTokens(process.provider);
    const longContext =
      threshold !== null && usage.totalContextTokens > threshold;
    const tier = pending.tiers.get(longContext) ?? emptyClasses();
    tier.freshInputTokens += freshInputTokens;
    tier.cachedInputTokens += cachedInputTokens;
    tier.cacheWriteTokens += cacheWriteTokens;
    tier.outputTokens += usage.outputTokens ?? 0;
    pending.tiers.set(longContext, tier);
    this.pending.set(process.id, pending);
  }

  /** Append whatever this process has accumulated and start over. */
  flush(process: Process): void {
    const pending = this.pending.get(process.id);
    if (!pending) return;
    this.pending.delete(process.id);
    const username = this.options.resolveUsername?.(process.sessionId);
    const identity = {
      ...(username ? { username } : {}),
      ...(process.requestedModel ? { model: process.requestedModel } : {}),
      ...(process.resolvedModel ? { modelId: process.resolvedModel } : {}),
      ...(process.projectPath
        ? { project: getProjectName(process.projectPath) }
        : {}),
      provider: process.provider,
    };
    // Standard tier first, so a mixed turn reads in the order it was priced.
    for (const longContext of [false, true]) {
      const tier = pending.tiers.get(longContext);
      if (!tier) continue;
      this.options.record({ ...identity, longContext, ...tier });
    }
  }

  /** A process going away still owes its last turn's charge. */
  forgetProcess(process: Process): void {
    this.flush(process);
  }
}
