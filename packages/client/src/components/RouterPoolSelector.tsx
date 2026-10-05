import {
  resolveRouterModel,
  routerModelSupportsThinking,
  type AgentAuthRouterOverview,
  type AgentAuthRouterPoolPolicy,
  type EffortLevel,
  type ModelInfo,
  type ThinkingOption,
} from "@yep-anywhere/shared";
import { useI18n } from "../i18n";
import { FilterDropdown } from "./FilterDropdown";
export interface RouterSelection {
  sourceKey: string;
  poolId: string;
  accountId: string;
}
import styles from "./RouterPoolSelector.module.css";

const DIRECT = "";

const POLICY_KEYS = {
  manual: "routerPoolManual",
  "round-robin": "routerPoolRoundRobin",
  "most-remaining": "routerPoolMostRemaining",
} as const satisfies Record<AgentAuthRouterPoolPolicy, string>;

const EFFORT_KEYS = {
  low: "effortLevelLowLabel",
  medium: "effortLevelMediumLabel",
  high: "effortLevelHighLabel",
  xhigh: "effortLevelExtraHighLabel",
  max: "effortLevelMaxLabel",
} as const satisfies Record<EffortLevel, string>;

type OverviewAccount = AgentAuthRouterOverview["accounts"][number];
type Translate = ReturnType<typeof useI18n>["t"];

export function routedModels(
  data: AgentAuthRouterOverview | null,
  provider: string | null,
  poolId?: string,
): ModelInfo[] {
  const pool = data?.pools.find((p) => p.id === poolId);
  const result = new Map<string, ModelInfo>();
  for (const a of data?.accounts ?? []) {
    if (
      !a.enabled ||
      a.provider !== provider ||
      (poolId && !pool?.accountIds.includes(a.id))
    )
      continue;
    for (const model of a.models) {
      const previous = result.get(model.id);
      result.set(model.id, {
        ...model,
        supportsEffort: model.supportsEffort ?? false,
        ...(previous
          ? {
              supportsEffort: !!(
                previous.supportsEffort || model.supportsEffort
              ),
              supportsAdaptiveThinking:
                previous.supportsAdaptiveThinking ||
                model.supportsAdaptiveThinking,
              supportedReasoningEfforts: [
                ...new Map(
                  [
                    ...(previous.supportedReasoningEfforts ?? []),
                    ...(model.supportedReasoningEfforts ?? []),
                  ].map((e) => [e.reasoningEffort, e]),
                ).values(),
              ],
            }
          : {}),
      });
    }
  }
  return [...result.values()];
}

/** Every overview account the pool names for this provider, enabled or not. */
export function routerPoolAccounts(
  data: AgentAuthRouterOverview | null,
  poolId: string,
  provider: string | null,
): OverviewAccount[] {
  const pool = data?.pools.find(
    (p) => p.id === poolId && p.provider === provider,
  );
  return (
    data?.accounts.filter(
      (a) => a.provider === provider && pool?.accountIds.includes(a.id),
    ) ?? []
  );
}

export function routerPoolMembers(
  data: AgentAuthRouterOverview | null,
  poolId: string,
  provider: string | null,
  model: string | null,
  thinking: ThinkingOption,
) {
  const concreteModel = resolveRouterModel(
    model,
    routedModels(data, provider, poolId),
  );
  return routerPoolAccounts(data, poolId, provider).filter(
    (a) =>
      a.enabled &&
      routerModelSupportsThinking(
        a.models.find((m) => m.id === concreteModel),
        thinking,
      ),
  );
}

export interface RouterAccountIssue {
  /** A blocking issue makes the account unselectable; advice does not. */
  blocking: boolean;
  text: string;
}

function effortLabel(t: Translate, thinking: ThinkingOption): string {
  const effort = thinking.replace(/^on:/, "") as EffortLevel;
  return EFFORT_KEYS[effort] ? t(EFFORT_KEYS[effort]) : effort;
}

function quotaExhausted(
  account: OverviewAccount,
  concreteModel: string | undefined,
): boolean {
  return account.windows.some(
    (w) =>
      w.remainingPercent === 0 &&
      (w.scope === "all" ||
        (w.scope !== "unknown" && !!concreteModel?.includes(w.scope))),
  );
}

/**
 * Why an account cannot, or may not, serve the selection, derived only from
 * the overview YA already holds. Cached quota and auth states are advice:
 * AAR decides at launch, so they never make an account unselectable here.
 */
export function routerAccountIssue(
  t: Translate,
  account: OverviewAccount,
  model: string | null,
  modelLabel: string,
  concreteModel: string | undefined,
  thinking: ThinkingOption,
): RouterAccountIssue | null {
  if (!account.enabled)
    return { blocking: true, text: t("routerReasonDisabled") };
  if (!model) return { blocking: true, text: t("routerReasonChooseModel") };
  const catalogModel = account.models.find((m) => m.id === concreteModel);
  if (!catalogModel)
    return {
      blocking: true,
      text: t("routerReasonModelUnavailable", { model: modelLabel }),
    };
  if (!routerModelSupportsThinking(catalogModel, thinking))
    return {
      blocking: true,
      text: t("routerReasonEffortUnsupported", {
        effort: effortLabel(t, thinking),
      }),
    };
  if (account.blocked === "auth-unavailable")
    return { blocking: false, text: t("routerReasonAuthBlocked") };
  if (account.blocked === "cooldown")
    return {
      blocking: false,
      text: account.cooldownUntil
        ? t("routerReasonCooldownUntil", {
            time: new Date(account.cooldownUntil).toLocaleTimeString(),
          })
        : t("routerReasonCooldown"),
    };
  if (quotaExhausted(account, concreteModel))
    return { blocking: false, text: t("routerReasonExhausted") };
  return null;
}

/** Why no account in the pool can serve the selection. */
function poolReason(
  t: Translate,
  accounts: OverviewAccount[],
  model: string | null,
  modelLabel: string,
  concreteModel: string | undefined,
  thinking: ThinkingOption,
): string {
  const enabled = accounts.filter((a) => a.enabled);
  if (!enabled.length) return t("routerReasonNoEnabledAccounts");
  if (!model) return t("routerReasonChooseModel");
  const offering = enabled.filter((a) =>
    a.models.some((m) => m.id === concreteModel),
  );
  if (!offering.length)
    return t("routerReasonNoAccountOffers", { model: modelLabel });
  return t("routerReasonNoAccountSupportsEffort", {
    effort: effortLabel(t, thinking),
  });
}

export function RouterPoolSelector({
  data,
  provider,
  model,
  thinking,
  value,
  onChange,
  sourceKey,
  busy,
  error,
  retry,
  disabled,
  showCaption = false,
}: {
  data: AgentAuthRouterOverview | null;
  provider: string;
  model: string | null;
  thinking: ThinkingOption;
  value: RouterSelection | null;
  onChange: (value: RouterSelection | null) => void;
  sourceKey: string;
  busy: boolean;
  error: boolean;
  retry: () => void;
  disabled: boolean;
  showCaption?: boolean;
}) {
  const { t } = useI18n();
  if (!data && !value && !error) return null;
  const pools = data?.pools.filter((p) => p.provider === provider) ?? [];
  const members = value?.poolId
    ? routerPoolMembers(data, value.poolId, provider, model, thinking)
    : [];
  const pool = pools.find((p) => p.id === value?.poolId);
  const unavailable = !!value && (!pool || !members.length);
  const poolLabel = t("routerPool");
  const accountLabel = t("routerAccount");
  const describePool = (poolId: string) => {
    const accounts = routerPoolAccounts(data, poolId, provider);
    const poolModels = routedModels(data, provider, poolId);
    const concreteModel = resolveRouterModel(model, poolModels);
    const modelLabel =
      poolModels.find((m) => m.id === concreteModel)?.name ?? model ?? "";
    return { accounts, concreteModel, modelLabel };
  };
  const poolAccounts = pool ? describePool(pool.id) : null;
  const chooseAccount =
    pool?.policy === "manual" &&
    poolAccounts &&
    poolAccounts.accounts.length > 1 ? (
      <div className={`new-session-helper-section ${styles.section}`}>
        <h3>{accountLabel}</h3>
        <FilterDropdown<string>
          label={accountLabel}
          options={poolAccounts.accounts.map((a, index) => {
            const issue = routerAccountIssue(
              t,
              a,
              model,
              poolAccounts.modelLabel,
              poolAccounts.concreteModel,
              thinking,
            );
            return {
              value: a.id,
              label:
                a.displayName ||
                t("routerAccountNumber", { number: index + 1 }),
              description: issue?.text,
              icon: <span className={`${styles.dot} ${styles.account}`} />,
              disabled: disabled || !!issue?.blocking,
            };
          })}
          selected={
            value?.accountId
              ? [value.accountId]
              : members.length === 1 && members[0]
                ? [members[0].id]
                : []
          }
          onChange={([accountId]) => {
            if (!disabled && value && accountId !== undefined)
              onChange({ ...value, accountId });
          }}
          multiSelect={false}
          placeholder={t("routerPoolChooseAccount")}
          fullWidth
          triggerClassName={styles.leftAlignedTrigger}
        />
        {showCaption && (
          <p className={styles.caption}>{t("routerAccountCaption")}</p>
        )}
      </div>
    ) : null;
  return (
    <>
      <div className={`new-session-helper-section ${styles.section}`}>
        <h3>{poolLabel}</h3>
        <FilterDropdown<string>
          label={poolLabel}
          options={[
            {
              value: DIRECT,
              label: t("routerDirect"),
              description: t("routerDirectDescription"),
              icon: <span className={`${styles.dot} ${styles.direct}`} />,
              disabled,
            },
            ...(value?.poolId && !pool
              ? [
                  {
                    value: value.poolId,
                    label: t("routerPoolUnavailable"),
                    icon: <span className={`${styles.dot} ${styles.pool}`} />,
                    disabled: true,
                  },
                ]
              : []),
            ...pools.map((p) => {
              const { accounts, concreteModel, modelLabel } = describePool(
                p.id,
              );
              const compatible = routerPoolMembers(
                data,
                p.id,
                provider,
                model,
                thinking,
              ).length;
              return {
                value: p.id,
                label: p.name,
                description: [
                  t(POLICY_KEYS[p.policy]),
                  compatible
                    ? t("routerPoolCompatibleAccounts", {
                        count: compatible,
                        total: p.accountIds.length,
                        model: modelLabel,
                      })
                    : poolReason(
                        t,
                        accounts,
                        model,
                        modelLabel,
                        concreteModel,
                        thinking,
                      ),
                ].join(" · "),
                icon: <span className={`${styles.dot} ${styles.pool}`} />,
                disabled: disabled || compatible === 0,
              };
            }),
          ]}
          selected={[value?.poolId ?? DIRECT]}
          onChange={([poolId]) => {
            if (disabled || poolId === undefined) return;
            const selected = pools.find((p) => p.id === poolId);
            onChange(
              selected
                ? { sourceKey, poolId: selected.id, accountId: "" }
                : null,
            );
          }}
          multiSelect={false}
          fullWidth
          triggerClassName={styles.leftAlignedTrigger}
        />
        {error ? (
          <div className={styles.status} role="alert">
            <span>{t("routerDiscoveryFailed")}</span>
            <button type="button" className={styles.retry} onClick={retry}>
              {t("routerRetry")}
            </button>
          </div>
        ) : unavailable ? (
          <div className={`${styles.status} ${styles.warning}`} role="status">
            <span>{t("routerSelectionUnavailable")}</span>
          </div>
        ) : busy ? (
          <div className={styles.status} role="status">
            <span>{t("routerChecking")}</span>
          </div>
        ) : null}
        {showCaption && (
          <p className={styles.caption}>{t("routerPoolCaption")}</p>
        )}
      </div>
      {chooseAccount}
    </>
  );
}
