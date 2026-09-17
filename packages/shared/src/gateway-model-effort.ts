/**
 * Which thinking-effort levels a gateway-served model offers.
 *
 * An OpenAI-compatible `/v1/models` row usually says nothing about reasoning.
 * copilot-api states `capabilities.supports.reasoning_effort` per model; a vLLM
 * server advertises an id, an owner and a window and nothing else, so a model
 * that accepts effort looks exactly like one that does not. The levels
 * therefore come from the service's own configuration first — the rule the
 * declared windows already follow — then from whatever the catalog advertises,
 * then from what YA knows about the model family.
 */

import { EFFORT_LEVEL_ORDER } from "./turn-effort.js";
import type { EffortLevel } from "./types.js";

export interface GatewayModelEffort {
  /** Selectable levels, in ascending order. */
  levels: EffortLevel[];
  /** The level the endpoint applies to a request that states none. */
  defaultLevel?: EffortLevel;
  /**
   * The endpoint accepts `reasoning_effort: "none"`, so thinking can be turned
   * off rather than only turned down. Stated by the model family, never by
   * configuration: a level list says which levels exist, not whether the
   * absence of thinking is one of them.
   */
  noThinking?: boolean;
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return (
    typeof value === "string" &&
    EFFORT_LEVEL_ORDER.includes(value as EffortLevel)
  );
}

interface BuiltInEffortModel {
  pattern: RegExp;
  effort: GatewayModelEffort;
}

/**
 * Model families whose effort vocabulary YA knows, for an endpoint that
 * advertises none and a user who configured none.
 *
 * DeepSeek V4 collapses seven request values onto four behaviors inside its own
 * chat encoder: `none` turns thinking off, `minimal`/`low`/`medium` all mean
 * low, `high`/`xhigh` both mean high, and `max` means max. Only the levels that
 * reach a distinct behavior are listed, so no two menu entries do the same
 * thing. A request that states no effort at all thinks at high.
 */
const BUILT_IN_EFFORT_MODELS: readonly BuiltInEffortModel[] = [
  {
    pattern: /deepseek[-_. ]?v4/iu,
    effort: {
      levels: ["low", "high", "max"],
      defaultLevel: "high",
      noThinking: true,
    },
  },
];

/** What YA knows about a model id on its own, with nothing configured. */
export function builtInGatewayModelEffort(
  modelId: string,
): GatewayModelEffort | undefined {
  const match = BUILT_IN_EFFORT_MODELS.find((entry) =>
    entry.pattern.test(modelId),
  );
  return match
    ? { ...match.effort, levels: [...match.effort.levels] }
    : undefined;
}

function orderedLevels(levels: readonly EffortLevel[]): EffortLevel[] {
  return EFFORT_LEVEL_ORDER.filter((level) => levels.includes(level));
}

/**
 * The listed level to send for a requested one the model does not list.
 *
 * Snaps down rather than up: a session carrying an effort from another model
 * should not silently buy more thinking than was asked for. Returns undefined
 * only when nothing is listed.
 */
export function nearestGatewayEffortLevel(
  effort: GatewayModelEffort,
  requested: EffortLevel,
): EffortLevel | undefined {
  if (effort.levels.includes(requested)) return requested;
  const wanted = EFFORT_LEVEL_ORDER.indexOf(requested);
  let below: EffortLevel | undefined;
  for (const level of effort.levels) {
    if (EFFORT_LEVEL_ORDER.indexOf(level) <= wanted) below = level;
  }
  return below ?? effort.levels[0];
}

export interface GatewayModelEffortSources {
  modelId: string;
  /** Levels stated by the service entry. Explicit configuration wins. */
  configuredLevels?: readonly EffortLevel[];
  /** Default stated by the service entry, meaningful only with levels. */
  configuredDefaultLevel?: EffortLevel;
  /** Levels the catalog row advertises, for an endpoint that states them. */
  advertisedLevels?: readonly EffortLevel[];
}

/**
 * The effort a model offers, or undefined when no source states any level —
 * which is the signal to show no effort control at all rather than to guess.
 */
export function gatewayModelEffort(
  sources: GatewayModelEffortSources,
): GatewayModelEffort | undefined {
  const builtIn = builtInGatewayModelEffort(sources.modelId);
  const configured = orderedLevels(sources.configuredLevels ?? []);
  const advertised = orderedLevels(sources.advertisedLevels ?? []);
  const levels = configured.length
    ? configured
    : advertised.length
      ? advertised
      : (builtIn?.levels ?? []);
  if (!levels.length) return undefined;

  const configuredDefault =
    configured.length &&
    sources.configuredDefaultLevel &&
    levels.includes(sources.configuredDefaultLevel)
      ? sources.configuredDefaultLevel
      : undefined;
  const defaultLevel =
    configuredDefault ??
    (builtIn?.defaultLevel && levels.includes(builtIn.defaultLevel)
      ? builtIn.defaultLevel
      : undefined);

  return {
    levels,
    ...(defaultLevel ? { defaultLevel } : {}),
    ...(builtIn?.noThinking ? { noThinking: true } : {}),
  };
}
