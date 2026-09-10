import {
  SERVER_CAPABILITIES,
  serverHasCapability,
  type IssueCoverage,
  type IssueSettings as Settings,
} from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import { SettingsItem } from "./SettingsItem";
import { SettingsSection } from "./SettingsSection";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import styles from "./IssueSettings.module.css";

export function IssueSettings() {
  const { t } = useI18n();
  const { version: versionInfo } = useVersion();
  const runtime = useCurrentSourceRuntime();
  useSettingsPaneTitle(t("issuesTitle"));
  const supported = serverHasCapability(
    versionInfo,
    SERVER_CAPABILITIES.issueSessionAssociations.name,
  );
  return (
    <SettingsSection
      title={t("issuesTitle")}
      description={t("issuesDescription")}
    >
      {supported ? (
        <IssueSettingsControls key={runtime.sourceKey} />
      ) : (
        <p>{t("issuesUnavailable")}</p>
      )}
    </SettingsSection>
  );
}
function IssueSettingsControls() {
  const { t } = useI18n();
  const { transport } = useCurrentSourceRuntime();
  const { refetch } = useServerSettings();
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const source = useRef(transport);
  source.current = transport;
  useEffect(() => {
    let disposed = false;
    setSettings(undefined);
    setError("");
    setBusy(false);
    transport
      .fetch<IssueCoverage>("/issues/settings")
      .then((result) => {
        if (!disposed) setSettings(result.settings);
      })
      .catch(() => {
        if (!disposed) setError(t("issuesLoadError"));
      });
    return () => {
      disposed = true;
    };
  }, [transport, t]);
  const save = async (next: Settings) => {
    const previous = settings;
    setSettings(next);
    setBusy(true);
    setError("");
    try {
      const result = await transport.fetch<IssueCoverage>("/issues/settings", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      if (source.current === transport) {
        setSettings(result.settings);
        await refetch();
      }
    } catch {
      if (source.current === transport) {
        setSettings(previous);
        setError(t("issuesSaveError"));
      }
    } finally {
      if (source.current === transport) setBusy(false);
    }
  };
  return (
    <div className={styles.settings}>
      <SettingsItem
        as="label"
        id="issue-discovery-enabled"
        label={t("issuesEnable")}
        description={t("issuesRetention")}
      >
        <span className={`toggle-switch ${styles.toggle}`}>
          <input
            type="checkbox"
            aria-label={t("issuesEnable")}
            checked={settings?.enabled ?? false}
            disabled={!settings || busy}
            onChange={(e) =>
              settings && void save({ ...settings, enabled: e.target.checked })
            }
          />
          <span className="toggle-slider" />
        </span>
      </SettingsItem>
      <SettingsItem
        id="issue-discovery-scope"
        label={t("issuesScope")}
        className={styles.scopeRow}
        description={
          settings?.scope === "recent"
            ? t("issuesRecentHelp")
            : t("issuesViewedHelp")
        }
      >
        <select
          className={styles.control}
          aria-label={t("issuesScope")}
          value={settings?.scope ?? "viewed"}
          disabled={!settings || busy}
          onChange={(e) =>
            settings &&
            void save({
              ...settings,
              scope: e.target.value as Settings["scope"],
            })
          }
        >
          <option value="viewed">{t("issuesViewed")}</option>
          <option value="recent">{t("issuesRecent")}</option>
        </select>
      </SettingsItem>
      {settings?.scope === "recent" && (
        <SettingsItem id="issue-discovery-days" label={t("issuesDays")}>
          <input
            className={styles.days}
            type="number"
            aria-label={t("issuesDays")}
            min={1}
            max={90}
            defaultValue={settings.recentDays}
            disabled={busy}
            onBlur={(e) => {
              const days = Number(e.target.value);
              if (Number.isInteger(days) && days >= 1 && days <= 90)
                void save({ ...settings, recentDays: days });
              else e.target.value = String(settings.recentDays);
            }}
          />
        </SettingsItem>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
