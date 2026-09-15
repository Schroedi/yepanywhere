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
  const { version } = useVersion();
  const { transport } = useCurrentSourceRuntime();
  const { settings, updateSettings } = useServerSettings();
  const [status, setStatus] = useState<SpeechBackendSetupStatus>();
  const [error, setError] = useState<string>();
  const [restarting, setRestarting] = useState(false);
  const running = status?.install.running === true;
  const scope = useRef(transport);
  scope.current = transport;

  const refresh = useCallback(async () => {
    try {
      const next =
        await scope.current.fetch<SpeechBackendSetupStatus>("/speech/backends");
      setStatus(next);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void refresh();
    }, INSTALL_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, running]);

  if (!serverHasCapability(version, SPEECH_BACKEND_SETUP_CAPABILITY)) {
    return null;
  }

  const toggle = async (row: SpeechBackendSetupRow, enabled: boolean) => {
    if (row.enabledByEnv) return;
    const current =
      settings?.speechVoiceBackends ?? status?.settingsBackends ?? [];
    const next = enabled
      ? [...new Set([...current, row.id])]
      : current.filter((id) => id !== row.id);
    try {
      await updateSettings({ speechVoiceBackends: next });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const install = async (id: string) => {
    try {
      setError(undefined);
      await transport.fetch(`/speech/backends/${id}/install`, {
        method: "POST",
      });
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
    } finally {
      setRestarting(false);
    }
  };

  return (
    <SettingsItem
      id="speech-backend-setup"
      label={t("speechBackendSetupTitle")}
      description={t("speechBackendSetupDescription")}
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
      descriptionLayout="full-width-on-narrow"
    >
      <div className={styles.wrap}>
        {error && (
          <p className="settings-hint" role="alert">
            {error}
          </p>
        )}
        <div className={styles.tableWrap}>
          <table
            className={styles.table}
            aria-label={t("speechBackendSetupTitle")}
          >
            <thead>
              <tr>
                <th>{t("speechBackendSetupColBackend")}</th>
                <th>{t("speechBackendSetupColEnable")}</th>
                <th>{t("speechBackendSetupColInstall")}</th>
                <th>{t("speechBackendSetupColEnablement")}</th>
              </tr>
            </thead>
            <tbody>
              {(status?.catalog ?? []).map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{t(BACKEND_LABEL_KEYS[row.id])}</div>
                    <code>{row.id}</code>
                    <div className={styles.meta}>
                      {t("speechBackendSetupEnvHint", {
                        env: "YEP_VOICE_BACKENDS",
                        id: row.id,
                      })}
                    </div>
                    {row.hfGated && (
                      <div className={styles.meta}>
                        {t("speechBackendSetupHfHint", {
                          env: row.pixiEnvironment,
                        })}
                      </div>
                    )}
                  </td>
                  <td>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        disabled={row.enabledByEnv}
                        onChange={(event) =>
                          void toggle(row, event.currentTarget.checked)
                        }
                        aria-label={t("speechBackendSetupEnableLabel", {
                          backend: t(BACKEND_LABEL_KEYS[row.id]),
                        })}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.install}
                      disabled={running}
                      onClick={() => void install(row.id)}
                    >
                      {t("speechBackendSetupInstall")}
                    </button>
                  </td>
                  <td>
                    {row.enabledByEnv
                      ? t("speechBackendSetupFromEnv")
                      : row.enabledBySettings
                        ? t("speechBackendSetupFromSettings")
                        : t("speechBackendSetupDisabled")}
                    {row.advertised
                      ? ` · ${t("speechBackendSetupLive")}`
                      : row.enabled
                        ? ` · ${t("speechBackendSetupNeedsRestart")}`
                        : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label
          className={styles.consoleLabel}
          htmlFor="speech-backend-install-log"
        >
          {t("speechBackendSetupConsole")}
        </label>
        <pre
          id="speech-backend-install-log"
          className={styles.console}
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
              restarting ||
              status?.restartAvailable === false ||
              status?.needsRestart !== true
            }
            onClick={() => void restart()}
          >
            {t("speechBackendSetupRestart")}
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
