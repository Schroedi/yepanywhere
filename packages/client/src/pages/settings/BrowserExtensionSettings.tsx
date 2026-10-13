import { useEffect, useState } from "react";
import { getChrome } from "../../extension/chrome";
import { activeHosts, defaultHost } from "../../extension/savedHosts";
import {
  DEFAULT_EXTENSION_SETTINGS,
  type ExtensionSettings,
  loadExtensionSettings,
  subscribeExtensionSettings,
  updateExtensionSettings,
} from "../../extension/settings";
import { useI18n } from "../../i18n";
import { loadSavedHosts } from "../../lib/hostStorage";
import styles from "./BrowserExtensionSettings.module.css";
import { SettingsItem } from "./SettingsItem";
import { SettingsSection } from "./SettingsSection";

/** Granted optional host origins, as host names (`https://github.com/*` → `github.com`). */
function useGrantedSites(): string[] {
  const [sites, setSites] = useState<string[]>([]);
  useEffect(() => {
    const chrome = getChrome();
    if (!chrome) return;
    const load = () =>
      void chrome.permissions
        .getAll()
        .then((granted) =>
          setSites(
            (granted.origins ?? [])
              .map((origin) => origin.match(/^https?:\/\/([^/]+)\/\*$/)?.[1])
              .filter((site): site is string => !!site && !site.includes("*")),
          ),
        );
    load();
    chrome.permissions.onAdded.addListener(load);
    chrome.permissions.onRemoved.addListener(load);
    return () => {
      chrome.permissions.onAdded.removeListener(load);
      chrome.permissions.onRemoved.removeListener(load);
    };
  }, []);
  return sites;
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span className="toggle-switch">
      <input
        id={id}
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-slider" />
    </span>
  );
}

/**
 * Settings of the Chrome extension this page runs in (docs/tactical/151
 * step 10). Shown only on the extension's own origin; values live in
 * `chrome.storage.local`, so no host request is made here.
 */
export function BrowserExtensionSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<ExtensionSettings>(
    DEFAULT_EXTENSION_SETTINGS,
  );
  const [allowlist, setAllowlist] = useState("");
  const [newSite, setNewSite] = useState("");
  const [siteError, setSiteError] = useState("");
  const sites = useGrantedSites();
  const hosts = loadSavedHosts().hosts.filter(
    (host) => host.mode === "relay" && host.relayUsername,
  );
  const active = new Set(activeHosts(hosts, settings).map((host) => host.id));
  const fallbackDefault = defaultHost(hosts, settings)?.id;

  useEffect(() => {
    void loadExtensionSettings().then((loaded) => {
      setSettings(loaded);
      setAllowlist(loaded.lookupAllowlist.join("\n"));
    });
    return subscribeExtensionSettings(setSettings);
  }, []);

  const update = (change: Partial<ExtensionSettings>) => {
    setSettings((current) => ({ ...current, ...change }));
    void updateExtensionSettings(change);
  };

  const setActive = (hostId: string, on: boolean) => {
    const ids = hosts
      .map((host) => host.id)
      .filter((id) => (id === hostId ? on : active.has(id)));
    update({ activeHostIds: ids });
  };

  const grantSite = () => {
    const chrome = getChrome();
    const site = newSite
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
    if (!chrome || !/^[a-z0-9.-]+(:\d+)?$/.test(site) || !site.includes(".")) {
      setSiteError(t("extensionSettingsInvalidSite"));
      return;
    }
    setSiteError("");
    void chrome.permissions
      .request({ origins: [`https://${site}/*`] })
      .then((granted) => {
        if (granted) setNewSite("");
      });
  };

  return (
    <>
      <p className={styles.lede}>{t("extensionSettingsLede")}</p>
      <SettingsSection
        title={t("extensionSettingsHostsTitle")}
        description={t("extensionSettingsHostsDescription")}
      >
        {hosts.length === 0 ? (
          <p className={styles.hint}>{t("extensionSettingsNoHosts")}</p>
        ) : (
          <ul className={styles.hostList}>
            {hosts.map((host) => (
              <li key={host.id} className={styles.hostRow}>
                <span className={styles.hostName}>
                  <strong>{host.displayName}</strong>
                  <span>relay · {host.relayUsername}</span>
                </span>
                <label
                  className={styles.inlineControl}
                  htmlFor={`extension-host-${host.id}`}
                >
                  <Toggle
                    id={`extension-host-${host.id}`}
                    label={t("extensionSettingsHostUse", {
                      host: host.displayName,
                    })}
                    checked={active.has(host.id)}
                    onChange={(on) => setActive(host.id, on)}
                  />
                  {t("extensionSettingsHostActive")}
                </label>
                <label className={styles.inlineControl}>
                  <input
                    type="radio"
                    name="extension-default-host"
                    checked={fallbackDefault === host.id}
                    disabled={!active.has(host.id)}
                    onChange={() => update({ defaultHostId: host.id })}
                  />
                  {t("extensionSettingsHostDefault")}
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.hint}>{t("extensionSettingsDefaultHint")}</p>
      </SettingsSection>

      <SettingsSection
        title={t("extensionSettingsLookupTitle")}
        description={t("extensionSettingsLookupDescription")}
      >
        <SettingsItem
          label={t("extensionSettingsAutomatic")}
          description={t("extensionSettingsAutomaticDescription")}
        >
          <Toggle
            label={t("extensionSettingsAutomatic")}
            checked={settings.automaticLookup}
            onChange={(automaticLookup) => update({ automaticLookup })}
          />
        </SettingsItem>
        <ul className={styles.siteList}>
          {sites.length === 0 && (
            <li className={styles.hint}>{t("extensionSettingsNoSites")}</li>
          )}
          {sites.map((site) => (
            <li key={site}>
              <span>
                <strong>{site}</strong>
                <span>{t("extensionSettingsSiteGranted")}</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  void getChrome()?.permissions.remove({
                    origins: [`https://${site}/*`],
                  })
                }
              >
                {t("extensionSettingsRemoveAccess")}
              </button>
            </li>
          ))}
          <li className={styles.addSite}>
            <input
              aria-label={t("extensionSettingsAddSite")}
              placeholder="github.com"
              value={newSite}
              onChange={(event) => setNewSite(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") grantSite();
              }}
            />
            <button
              type="button"
              disabled={!newSite.trim()}
              onClick={grantSite}
            >
              {t("extensionSettingsGrantAccess")}
            </button>
          </li>
        </ul>
        {siteError && (
          <p className={styles.error} role="alert">
            {siteError}
          </p>
        )}
        <label className={styles.allowlist}>
          <span>
            <strong>{t("extensionSettingsAllowlist")}</strong>
            <span>{t("extensionSettingsAllowlistDescription")}</span>
          </span>
          <textarea
            rows={4}
            value={allowlist}
            onChange={(event) => setAllowlist(event.target.value)}
            onBlur={() =>
              update({
                lookupAllowlist: allowlist
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <SettingsItem
          label={t("extensionSettingsIncludeDismissed")}
          description={t("extensionSettingsIncludeDismissedDescription")}
        >
          <Toggle
            label={t("extensionSettingsIncludeDismissed")}
            checked={settings.includeDismissed}
            onChange={(includeDismissed) => update({ includeDismissed })}
          />
        </SettingsItem>
      </SettingsSection>

      <SettingsSection title={t("extensionSettingsToolbarTitle")}>
        <SettingsItem label={t("extensionSettingsToolbarButton")}>
          <select
            aria-label={t("extensionSettingsToolbarButton")}
            value={settings.toolbarAction}
            onChange={(event) =>
              update({
                toolbarAction: event.target
                  .value as ExtensionSettings["toolbarAction"],
              })
            }
          >
            <option value="side-panel">
              {t("extensionSettingsToolbarSidePanel")}
            </option>
            <option value="app-tab">
              {t("extensionSettingsToolbarAppTab")}
            </option>
          </select>
        </SettingsItem>
        <SettingsItem label={t("extensionSettingsBadge")}>
          <select
            aria-label={t("extensionSettingsBadge")}
            value={settings.badge}
            onChange={(event) =>
              update({
                badge: event.target.value as ExtensionSettings["badge"],
              })
            }
          >
            <option value="page">{t("extensionSettingsBadgePage")}</option>
            <option value="off">{t("extensionSettingsBadgeOff")}</option>
          </select>
        </SettingsItem>
        <SettingsItem label={t("extensionSettingsFallback")}>
          <select
            aria-label={t("extensionSettingsFallback")}
            value={settings.panelFallback}
            onChange={(event) =>
              update({
                panelFallback: event.target
                  .value as ExtensionSettings["panelFallback"],
              })
            }
          >
            <option value="attention">
              {t("extensionSettingsFallbackAttention")}
            </option>
            <option value="recent">
              {t("extensionSettingsFallbackRecent")}
            </option>
            <option value="none">{t("extensionSettingsFallbackNone")}</option>
          </select>
        </SettingsItem>
        <SettingsItem label={t("extensionSettingsOpenIn")}>
          <select
            aria-label={t("extensionSettingsOpenIn")}
            value={settings.openSessionsIn}
            onChange={(event) =>
              update({
                openSessionsIn: event.target
                  .value as ExtensionSettings["openSessionsIn"],
              })
            }
          >
            <option value="existing-tab">
              {t("extensionSettingsOpenInExisting")}
            </option>
            <option value="new-tab">{t("extensionSettingsOpenInNew")}</option>
          </select>
        </SettingsItem>
      </SettingsSection>
    </>
  );
}
