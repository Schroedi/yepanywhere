import {
  AgentAuthRouterPools,
  RouterPoolSelection,
} from "./AgentAuthRouterPools";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SERVER_CAPABILITIES,
  serverHasCapability,
  type AgentAuthRouterRecovery,
  type AgentAuthRouterStatus,
} from "@yep-anywhere/shared";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import { api } from "../api/client";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import styles from "./AgentAuthRouterControls.module.css";

type Account = Awaited<
  ReturnType<typeof api.routerAccounts>
>["accounts"][number];
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export function AgentAuthRouterSettings() {
  const source = useClientSummarySourceKey();
  return <RouterSettingsForSource key={source} />;
}
function RouterSettingsForSource() {
  const { t } = useI18n();
  const { version } = useVersion();
  const supportsPools = serverHasCapability(
    version,
    SERVER_CAPABILITIES.agentAuthRouterPools.name,
  );
  const supportsRecovery = serverHasCapability(
    version,
    SERVER_CAPABILITIES.agentAuthRouterRecovery.name,
  );
  const [status, setStatus] = useState<AgentAuthRouterStatus>({
    state: "disconnected",
    routerId: null,
  });
  const [recovery, setRecovery] = useState<AgentAuthRouterRecovery | null>(
    null,
  );
  const [path, setPath] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [usage, setUsage] = useState<
    Record<string, Awaited<ReturnType<typeof api.routerQuotas>>>
  >({});
  // Invalidate requests on unmount/source changes and before each new action.
  // A response from the previous source must not start a request on the next one.
  const request = useRef(0);
  const read = useCallback(
    async (id: number) => {
      if (supportsRecovery) {
        const result = await api.routerRecovery();
        if (request.current !== id) return;
        setStatus(result);
        setRecovery(result);
        setAccounts(result.accounts);
      } else {
        const result = await api.routerStatus();
        if (request.current !== id) return;
        setStatus(result);
        setRecovery(null);
        setAccounts([]);
        if (result.state === "connected") {
          const list = await api.routerAccounts();
          if (request.current !== id) return;
          setAccounts(list.accounts);
        }
      }
      setLoaded(true);
    },
    [supportsRecovery],
  );
  const run = useCallback(
    async (action?: (id: number) => Promise<unknown>) => {
      const id = ++request.current;
      setBusy(true);
      setError("");
      try {
        if (action) await action(id);
        if (request.current === id) await read(id);
      } catch (failure) {
        if (request.current !== id) return;
        setError(errorMessage(failure, t("routerUnavailable")));
        setAccounts([]);
        setRecovery(null);
        // A failed disconnect can still have durably changed local state.
        if (action) await read(id).catch(() => {});
      } finally {
        if (request.current === id) setBusy(false);
      }
    },
    [read, t],
  );
  useEffect(() => {
    void run();
    return () => {
      request.current++;
    };
  }, [run]);
  const state = status.state;
  const stateLabel =
    state === "connected"
      ? t("routerConnected")
      : state === "pairing"
        ? t("routerPairing")
        : state === "revocation-pending"
          ? t("routerRevocationPending")
          : t("routerDisconnected");
  const pending = recovery?.pendingCancellations ?? 0;
  const canReadAccounts = state === "connected" && !recovery?.issue && !error;
  return (
    <section
      className={styles.panel}
      aria-label={t("routerTitle")}
      aria-busy={busy}
    >
      <strong>{t("routerTitle")}</strong>
      <p>{t("routerDescription")}</p>
      <div className={styles.status} role="status">
        <strong>
          {!loaded
            ? t(busy ? "routerChecking" : "routerStatusUnknown")
            : stateLabel}
        </strong>
        {recovery?.issue && (
          <p>
            {state === "revocation-pending" &&
            recovery.issue.code === "unavailable"
              ? t("routerNotReachable")
              : recovery.issue.message}
          </p>
        )}
        {recovery?.reachable === true &&
          !recovery.issue &&
          state === "connected" && <p>{t("routerReady")}</p>}
        {!supportsRecovery && state === "connected" && (
          <p>{t("routerLegacyStatus")}</p>
        )}
        {state === "revocation-pending" && <p>{t("routerRevocationHelp")}</p>}
        {state === "pairing" && <p>{t("routerPairingHelp")}</p>}
        {loaded && state === "disconnected" && (
          <p>{t("routerDisconnectedHelp")}</p>
        )}
      </div>
      {state !== "revocation-pending" && (
        <label>
          {t("routerSocket")}
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={
              state === "disconnected"
                ? t("routerDefaultSocket")
                : t("routerSavedSocket")
            }
          />
        </label>
      )}
      <div className={styles.actions}>
        {state !== "revocation-pending" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.routerConnect(path || undefined))}
          >
            {state === "disconnected"
              ? t("routerConnect")
              : t("routerRetryConnection")}
          </button>
        )}
        {state !== "disconnected" && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.routerDisconnect();
                setUsage({});
              })
            }
          >
            {state === "revocation-pending"
              ? t("routerFinishDisconnect")
              : t("routerDisconnectAction")}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void run()}>
          {t("routerCheckStatus")}
        </button>
      </div>
      {error && error !== recovery?.issue?.message && (
        <p role="alert">{error}</p>
      )}
      {pending > 0 && (
        <div className={styles.status}>
          <strong>{t("routerPendingCleanup", { count: pending })}</strong>
          <p>{t("routerPendingCleanupHelp")}</p>
          {state === "connected" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => api.routerRetryCancellations())}
            >
              {t("routerRetryCleanup")}
            </button>
          )}
        </div>
      )}
      {canReadAccounts && accounts.length === 0 && loaded && (
        <p>{t("routerNoAccounts")}</p>
      )}
      {supportsPools && canReadAccounts && <AgentAuthRouterPools />}
      {!supportsPools &&
        accounts.map((account) => (
          <div className={styles.account} key={account.id}>
            <strong>
              {account.provider} · {account.id}
            </strong>
            {!account.enabled && <p>{t("routerAccountDisabled")}</p>}
            <span>{t("routerRenewal", { state: account.renewal })}</span>
            <button
              type="button"
              disabled={busy || !account.enabled || !canReadAccounts}
              onClick={() =>
                void run(async (id) => {
                  const snapshot = await api.routerQuotas(account.id);
                  if (request.current === id)
                    setUsage((old) => ({ ...old, [account.id]: snapshot }));
                })
              }
            >
              {t("routerRefreshUsage")}
            </button>
            {usage[account.id] && (
              <div>
                <p>
                  {t("routerUsageObserved", {
                    time: new Date(
                      usage[account.id]!.observedAt,
                    ).toLocaleString(),
                  })}
                </p>
                {usage[account.id]?.status === "ok"
                  ? usage[account.id]?.windows.map((window) => (
                      <div key={window.bucket}>
                        {window.bucket}:{" "}
                        {window.remainingPercent === null
                          ? "?"
                          : `${window.remainingPercent}%`}{" "}
                        {t("routerRemaining")}{" "}
                        {window.resetsAt
                          ? new Date(window.resetsAt).toLocaleString()
                          : ""}
                      </div>
                    ))
                  : t("routerUsageUnavailable")}
              </div>
            )}
          </div>
        ))}
    </section>
  );
}

export interface RouterSelection {
  poolId?: string;
  policy?: "manual" | "round-robin";
  sourceKey: string;
  accountId: string;
  model: string;
}
export function RouterAccountSelection({
  provider,
  value,
  onChange,
  disabled,
}: {
  provider: string;
  value: RouterSelection | null;
  onChange: (value: RouterSelection | null) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { version } = useVersion();
  const supportsPools = serverHasCapability(
    version,
    SERVER_CAPABILITIES.agentAuthRouterPools.name,
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const sourceKey = useClientSummarySourceKey();
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [connected, setConnected] = useState(false);
  const hasSelection = Boolean(value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The API resolves the current source at call time; source switches and explicit refreshes must invalidate these reads.
  useEffect(() => {
    let current = true;
    setAccounts([]);
    setError("");
    setConnected(false);
    void api
      .routerStatus()
      .then(async (status) => {
        if (!current) return;
        if (status.state !== "connected") {
          if (status.state === "revocation-pending")
            setError(t("routerRevocationHelp"));
          else if (hasSelection) setError(t("routerDisconnectedHelp"));
          return;
        }
        setConnected(true);
        const result = await api.routerAccounts();
        if (current)
          setAccounts(
            result.accounts.filter(
              (a) => a.provider === provider && a.directAccountAccess !== false,
            ),
          );
      })
      .catch((failure) => {
        if (current) setError(errorMessage(failure, t("routerUnavailable")));
      });
    return () => {
      current = false;
    };
  }, [provider, sourceKey, refresh, t, hasSelection]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-read the selected catalog after an explicit refresh or source switch, including when the account ID is unchanged.
  useEffect(() => {
    let current = true;
    setModels([]);
    setCatalogError("");
    if (value?.accountId)
      void api
        .routerCatalog(value.accountId)
        .then((result) => {
          if (current) setModels(result.models);
        })
        .catch((failure) => {
          if (current)
            setCatalogError(errorMessage(failure, t("routerUnavailable")));
        });
    return () => {
      current = false;
    };
  }, [value?.accountId, sourceKey, refresh, t]);
  if (!accounts.length && !value && !connected && !error) return null;
  return (
    <div className={styles.panel}>
      {supportsPools && connected && (
        <RouterPoolSelection
          key={sourceKey}
          provider={provider}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )}
      {!value?.poolId && (
        <label>
          {t("routerAccount")}
          <select
            aria-label={t("routerAccount")}
            disabled={disabled}
            value={value?.accountId ?? ""}
            onChange={(event) =>
              onChange(
                event.target.value
                  ? { accountId: event.target.value, model: "", sourceKey }
                  : null,
              )
            }
          >
            <option value="">{t("routerDirect")}</option>
            {value && !accounts.some((a) => a.id === value.accountId) && (
              <option value={value.accountId} disabled>
                {value.accountId} — {t("routerAccountUnavailableLabel")}
              </option>
            )}
            {accounts.map((account) => (
              <option
                key={account.id}
                value={account.id}
                disabled={!account.enabled}
              >
                {account.id}
                {!account.enabled
                  ? ` — ${t("routerAccountDisabledLabel")}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {value && !value.poolId && (
        <label>
          {t("routerModel")}
          <select
            aria-label={t("routerModel")}
            disabled={
              disabled ||
              !accounts.some((a) => a.id === value.accountId && a.enabled)
            }
            value={value.model}
            onChange={(event) =>
              onChange({ ...value, model: event.target.value })
            }
          >
            <option value="">{t("routerChooseModel")}</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {value && <p>{t("routerReasoningDefault")}</p>}
      {connected && !accounts.some((a) => a.enabled) && (
        <p>{t("routerNoAvailableAccounts")}</p>
      )}
      {(error || catalogError) && <p role="alert">{error || catalogError}</p>}
      {(error || catalogError || connected) && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setRefresh((old) => old + 1)}
        >
          {t("routerRefreshAccounts")}
        </button>
      )}
    </div>
  );
}
