import {
  SPEECH_BACKEND_SETUP_CAPABILITY,
  serverHasCapability,
  type LocalSpeechBackendId,
  type SpeechBackendSetupRow,
  type SpeechBackendSetupStatus,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useI18n } from "../../i18n";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useVersion } from "../../hooks/useVersion";
import { SettingsItem } from "./SettingsItem";
import styles from "./SpeechBackendSetup.module.css";

const INSTALL_POLL_MS = 800;

const BACKEND_LABEL_KEYS = {
  "ya-whisper": "speechBackendSetupLabel_ya_whisper",
  "ya-parakeet": "speechBackendSetupLabel_ya_parakeet",
  "ya-nemo": "speechBackendSetupLabel_ya_nemo",
  "ya-granite": "speechBackendSetupLabel_ya_granite",
} as const satisfies Record<LocalSpeechBackendId, string>;

export function SpeechBackendSetup() {
  const { t } = useI18n();
  const { version, refetch: refreshVersion } = useVersion();
  const { transport } = useCurrentSourceRuntime();
  const { settings, updateSettings } = useServerSettings();
  const [status, setStatus] = useState<SpeechBackendSetupStatus>();
  const [error, setError] = useState<string>();
  const [restarting, setRestarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<{
    id: string;
    enabled: boolean;
  }>();
  const [modelPage, setModelPage] = useState<string>();
  const supported = serverHasCapability(
    version,
    SPEECH_BACKEND_SETUP_CAPABILITY,
  );
  const running = status?.install.running === true;
  const scope = useRef(transport);
  scope.current = transport;

  const refresh = useCallback(async () => {
    try {
      const next =
        await transport.fetch<SpeechBackendSetupStatus>("/speech/backends");
      if (scope.current !== transport) return;
      setStatus(next);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [transport]);

  useEffect(() => {
    setStatus(undefined);
    setError(undefined);
    if (supported) void refresh();
  }, [refresh, supported]);

  useEffect(() => {
    if (
      !supported ||
      (!status?.install.running &&
        !status?.catalog.some((row) => row.validationStatus === "pending"))
    )
      return;
    const timer = setTimeout(() => {
      void refresh();
    }, INSTALL_POLL_MS);
    return () => clearTimeout(timer);
  }, [refresh, supported, status]);

  const catalogKey = status?.catalog
    .map((row) => `${row.id}:${row.advertised}:${row.validationStatus}`)
    .join(",");
  useEffect(() => {
    if (catalogKey) void refreshVersion();
  }, [catalogKey, refreshVersion]);

  if (!supported) {
    return null;
  }

  const toggle = async (row: SpeechBackendSetupRow, enabled: boolean) => {
    if (row.enabledByEnv || saving) return;
    const current =
      settings?.speechVoiceBackends ?? status?.settingsBackends ?? [];
    const next = enabled
      ? [...new Set([...current, row.id])]
      : current.filter((id) => id !== row.id);
    try {
      setSaving(true);
      setPendingToggle({ id: row.id, enabled });
      if (enabled && row.id === "ya-granite" && !row.advertised)
        setModelPage(row.defaultModel);
      await updateSettings({ speechVoiceBackends: next });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setPendingToggle(undefined);
    }
  };

  const install = async (id: string) => {
    try {
      setError(undefined);
      const installStatus = await transport.fetch<
        SpeechBackendSetupStatus["install"]
      >(`/speech/backends/${id}/install`, {
        method: "POST",
      });
      setStatus((current) =>
        current ? { ...current, install: installStatus } : current,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const restart = async () => {
    try {
      setRestarting(true);
      setError(undefined);
      await transport.fetch("/speech/backends/restart", { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRestarting(false);
    }
  };

  return (
    <SettingsItem
      id="speech-backend-setup"
      label={t("speechBackendSetupTitle")}
      description={t(
        status?.liveEnablement
          ? "speechBackendSetupLiveDescription"
          : "speechBackendSetupDescription",
      )}
      keywords={[
        "YEP_VOICE_BACKENDS",
        "pixi",
        "huggingface",
        "ya-whisper",
        "ya-parakeet",
        "ya-nemo",
        "ya-granite",
        "install",
        "restart",
      ]}
      className="model-settings-item"
    >
      <div className={styles.wrap}>
        {error && (
          <p className="settings-hint" role="alert">
            {error}
          </p>
        )}
        <div className={styles.catalog}>
          {(status?.catalog ?? []).map((row) => (
            <section
              className={styles.backend}
              key={row.id}
              aria-label={t(BACKEND_LABEL_KEYS[row.id])}
            >
              <label className={styles.enable}>
                <input
                  type="checkbox"
                  checked={
                    pendingToggle?.id === row.id
                      ? pendingToggle.enabled
                      : row.enabled
                  }
                  disabled={row.enabledByEnv || saving}
                  onChange={(event) =>
                    void toggle(row, event.currentTarget.checked)
                  }
                  aria-label={t(
                    status?.liveEnablement
                      ? "speechBackendSetupEnableNowLabel"
                      : "speechBackendSetupEnableLabel",
                    {
                      backend: t(BACKEND_LABEL_KEYS[row.id]),
                    },
                  )}
                />
                <strong>{t(BACKEND_LABEL_KEYS[row.id])}</strong>
              </label>
              <code className={styles.model}>{row.defaultModel}</code>
              <div className={styles.backendActions}>
                <button
                  type="button"
                  className={styles.install}
                  disabled={running}
                  onClick={() => void install(row.id)}
                >
                  {t("speechBackendSetupInstall")}
                </button>
                <button
                  type="button"
                  className={styles.modelLink}
                  onClick={() =>
                    setModelPage(
                      row.id === "ya-whisper"
                        ? "distil-whisper/distil-large-v3.5-ct2"
                        : row.defaultModel,
                    )
                  }
                >
                  {t("speechBackendSetupModelAccess")}
                </button>
              </div>
              <p className={styles.meta}>
                {row.enabledByEnv
                  ? t("speechBackendSetupFromEnv")
                  : row.enabledBySettings
                    ? t("speechBackendSetupFromSettings")
                    : t("speechBackendSetupDisabled")}
                {row.advertised
                  ? ` · ${t("speechBackendSetupLive")}`
                  : row.enabled
                    ? ` · ${t(row.validationStatus === "pending" ? "speechBackendSetupValidating" : row.validationStatus === "disabled" ? "speechBackendSetupUnavailable" : "speechBackendSetupNeedsRestart")}`
                    : ""}
                {!row.enabled &&
                  row.advertised &&
                  ` · ${t("speechBackendSetupDisableRestart")}`}
              </p>
              {row.disabledReason && (
                <p className={styles.meta} role="alert">
                  {row.disabledReason}
                </p>
              )}
            </section>
          ))}
        </div>
        {modelPage && (
          <section
            className={styles.access}
            aria-label={t("speechBackendSetupModelAccess")}
          >
            <p>{t("speechBackendSetupAccessHelp")}</p>
            <a
              href={`https://huggingface.co/${modelPage}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {modelPage} — {t("speechBackendSetupOpenBrowser")}
            </a>
            <code>
              pixi run --frozen -e{" "}
              {status?.catalog.find((row) => row.defaultModel === modelPage)
                ?.pixiEnvironment ?? "stt"}{" "}
              hf auth login
            </code>
            <button
              type="button"
              className={styles.install}
              onClick={() => setModelPage(undefined)}
            >
              {t("speechBackendSetupCloseModel")}
            </button>
          </section>
        )}
        <label
          className={styles.consoleLabel}
          htmlFor="speech-backend-install-log"
        >
          {t("speechBackendSetupConsole")}
        </label>
        <pre
          id="speech-backend-install-log"
          className={styles.console}
          role="region"
          aria-label={t("speechBackendSetupConsole")}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need focus to scroll the install log.
          tabIndex={0}
        >
          {(status?.install.lines ?? []).join("\n") ||
            t("speechBackendSetupConsoleEmpty")}
        </pre>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.restart}
            disabled={
              restarting || running || status?.restartAvailable !== true
            }
            onClick={() => void restart()}
          >
            {t(
              restarting
                ? "speechBackendSetupRestartScheduled"
                : "speechBackendSetupRestart",
            )}
          </button>
          {status?.restartAvailable === false && (
            <p className="settings-hint">
              {t("speechBackendSetupRestartHint")}
            </p>
          )}
        </div>
      </div>
    </SettingsItem>
  );
}
