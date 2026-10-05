import {
  resolveRouterModel,
  routerModelSupportsThinking,
  type AgentAuthRouterOverview,
  type AgentAuthRouterPoolPolicy,
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

export function routerPoolMembers(
  data: AgentAuthRouterOverview | null,
  poolId: string,
  provider: string | null,
  model: string | null,
  thinking: ThinkingOption,
) {
  const pool = data?.pools.find(
    (p) => p.id === poolId && p.provider === provider,
  );
  const concreteModel = resolveRouterModel(
    model,
    routedModels(data, provider, poolId),
  );
  return (
    data?.accounts.filter(
      (a) =>
        a.enabled &&
        pool?.accountIds.includes(a.id) &&
        routerModelSupportsThinking(
          a.models.find((m) => m.id === concreteModel),
          thinking,
        ),
    ) ?? []
  );
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
  const chooseAccount =
    pool?.policy === "manual" && members.length > 1 ? (
      <div className={`new-session-helper-section ${styles.section}`}>
        <h3>{accountLabel}</h3>
        <FilterDropdown<string>
          label={accountLabel}
          options={members.map((a, index) => ({
            value: a.id,
            label:
              a.displayName || t("routerAccountNumber", { number: index + 1 }),
            icon: <span className={`${styles.dot} ${styles.account}`} />,
            disabled,
          }))}
          selected={value?.accountId ? [value.accountId] : []}
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
                  t("routerPoolCompatibleAccounts", {
                    count: compatible,
                    total: p.accountIds.length,
                  }),
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
