import { useEffect, useState } from "react";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import { api } from "../api/client";
import { useI18n } from "../i18n";
import styles from "./AgentAuthRouterControls.module.css";

type Account = Awaited<
  ReturnType<typeof api.routerAccounts>
>["accounts"][number];
export function AgentAuthRouterSettings() {
  const source = useClientSummarySourceKey();
  return <RouterSettingsForSource key={source} />;
}
function RouterSettingsForSource() {
  const { t } = useI18n();
  const [state, setState] = useState("disconnected");
  const [path, setPath] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<
    Record<string, Awaited<ReturnType<typeof api.routerQuotas>>>
  >({});
  useEffect(() => {
    let current = true;
    void api
      .routerStatus()
      .then(async (status) => {
        if (!current) return;
        setState(status.state);
        if (status.state === "connected") {
          const result = await api.routerAccounts();
          if (current) setAccounts(result.accounts);
        }
      })
      .catch(() => {
        if (current) setError(t("routerUnavailable"));
      });
    return () => {
      current = false;
    };
  }, [t]);
  const change = async (connect: boolean) => {
    setBusy(true);
    setError("");
    try {
      const status = connect
        ? await api.routerConnect(path || undefined)
        : await api.routerDisconnect();
      setState(status.state);
      setAccounts(connect ? (await api.routerAccounts()).accounts : []);
    } catch {
      setError(t("routerUnavailable"));
      const status = await api.routerStatus().catch(() => null);
      if (status) setState(status.state);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel} aria-label={t("routerTitle")}>
      <strong>{t("routerTitle")}</strong>
      <p>{t("routerDescription")}</p>
      <span>{t("routerState", { state })}</span>
      <label>
        {t("routerSocket")}
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder={t("routerDefaultSocket")}
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy || state === "revocation-pending"}
          onClick={() => void change(true)}
        >
          {t("routerConnect")}
        </button>
        {state !== "disconnected" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void change(false)}
          >
            {t("routerDisconnect")}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {accounts.map((account) => (
        <div className={styles.account} key={account.id}>
          <span>
            {account.provider} · {account.id}
          </span>
          <span>{t("routerRenewal", { state: account.renewal })}</span>
          <button
            type="button"
            onClick={() => {
              void api
                .routerQuotas(account.id)
                .then((snapshot) =>
                  setUsage((old) => ({ ...old, [account.id]: snapshot })),
                )
                .catch(() => setError(t("routerUnavailable")));
            }}
          >
            {t("routerRefreshUsage")}
          </button>
          {usage[account.id] && (
            <div>
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
                : t("routerUnavailable")}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export interface RouterSelection {
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const sourceKey = useClientSummarySourceKey();
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void api
      .routerStatus()
      .then(async (status) => {
        if (status.state !== "connected") return;
        const result = await api.routerAccounts();
        if (current)
          setAccounts(
            result.accounts.filter((a) => a.provider === provider && a.enabled),
          );
      })
      .catch(() => {
        if (current) setError(t("routerUnavailable"));
      });
    return () => {
      current = false;
    };
  }, [provider, t]);
  useEffect(() => {
    let current = true;
    setModels([]);
    setError("");
    if (value?.accountId)
      void api
        .routerCatalog(value.accountId)
        .then((result) => {
          if (current) setModels(result.models);
        })
        .catch(() => {
          if (current) setError(t("routerUnavailable"));
        });
    return () => {
      current = false;
    };
  }, [value?.accountId, t]);
  if (!accounts.length && !value) return null;
  return (
    <div className={styles.panel}>
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
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.id}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <label>
          {t("routerModel")}
          <select
            aria-label={t("routerModel")}
            disabled={disabled}
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
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
