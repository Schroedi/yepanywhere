/**
 * Editor for the configured model-serving endpoints ("gateway services").
 *
 * One entry per endpoint: where it listens, optionally how to start and stop
 * it, what its models can hold, and which harness narrowings apply to launches
 * routed through it. The entry marked default is the one Claude Gateway falls
 * back to, and the one older clients see through the single-gateway settings.
 */

import {
  DEFAULT_GATEWAY_AUTO_STOP_SECONDS,
  MAX_GATEWAY_SERVICES,
  MAX_GATEWAY_SERVICE_COMMAND_LENGTH,
  MAX_GATEWAY_SERVICE_LABEL_LENGTH,
  MAX_GATEWAY_SERVICE_SHORT_NAME_LENGTH,
  isLoopbackGatewayUrl,
  type GatewayService,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { useServerSettings } from "../../hooks/useServerSettings";
import styles from "./GatewayServicesSettings.module.css";

const EXAMPLE_URL = "http://127.0.0.1:8001";

/** A slug derived from a URL's host and port, unique within the draft list. */
function suggestServiceId(url: string, taken: ReadonlySet<string>): string {
  let base = "service";
  try {
    const parsed = new URL(url);
    base = `${parsed.hostname}-${parsed.port || parsed.protocol.replace(":", "")}`;
  } catch {
    // Keep the generic base; the user can rename the entry.
  }
  base =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "service";
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function newService(taken: ReadonlySet<string>): GatewayService {
  return {
    id: suggestServiceId(EXAMPLE_URL, taken),
    label: "",
    shortName: "",
    url: EXAMPLE_URL,
    enabled: true,
    autoStop: false,
    autoStopAfterSeconds: DEFAULT_GATEWAY_AUTO_STOP_SECONDS,
    codexEnabled: false,
    codexWireApi: "chat",
  };
}

function sameServices(
  left: readonly GatewayService[],
  right: readonly GatewayService[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** An optional positive integer field, kept as text while being typed. */
function numberFieldValue(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function parseNumberField(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

type OverrideValue = "inherit" | "on" | "off";

function overrideValue(value: boolean | undefined): OverrideValue {
  return value === undefined ? "inherit" : value ? "on" : "off";
}

export function GatewayServicesSettings({
  reloadProviders,
}: {
  reloadProviders: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { settings, updateSettings } = useServerSettings();
  const savedServices = useMemo(
    () => settings?.gatewayServices ?? [],
    [settings?.gatewayServices],
  );
  const savedDefaultId = settings?.defaultGatewayServiceId;
  const [services, setServices] = useState<GatewayService[]>(savedServices);
  const [defaultId, setDefaultId] = useState<string | undefined>(
    savedDefaultId,
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setServices(savedServices);
  }, [savedServices]);

  useEffect(() => {
    setDefaultId(savedDefaultId);
  }, [savedDefaultId]);

  const hasChanges =
    !sameServices(services, savedServices) || defaultId !== savedDefaultId;

  const updateService = useCallback(
    (index: number, changes: Partial<GatewayService>) => {
      setServices((current) =>
        current.map((service, position) =>
          position === index ? { ...service, ...changes } : service,
        ),
      );
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await updateSettings({
        gatewayServices: services,
        defaultGatewayServiceId: services.some(
          (service) => service.id === defaultId,
        )
          ? defaultId
          : services[0]?.id,
      });
      await reloadProviders();
    } catch {
      // Error handled by useServerSettings.
    } finally {
      setIsSaving(false);
    }
  }, [defaultId, reloadProviders, services, updateSettings]);

  return (
    <div id="provider-gateway-services" className="settings-subsection">
      <h3>{t("providersGatewayServicesTitle")}</h3>
      <p className="settings-hint">
        {t("providersGatewayServicesDescription")}
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (hasChanges && !isSaving) void handleSave();
        }}
      >
        {services.map((service, index) => {
          const loopback = isLoopbackGatewayUrl(service.url);
          return (
            <fieldset className={styles.card} key={service.id}>
              <legend className={styles.legend}>
                <input
                  type="text"
                  className={`settings-input ${styles.id}`}
                  value={service.id}
                  maxLength={32}
                  onChange={(event) =>
                    updateService(index, {
                      id: event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/gu, "-"),
                    })
                  }
                  aria-label={t("providersGatewayServiceIdAria")}
                />
              </legend>

              <label className={styles.field}>
                <span>{t("providersGatewayServiceUrlLabel")}</span>
                <input
                  type="url"
                  className="settings-input"
                  value={service.url}
                  placeholder={EXAMPLE_URL}
                  onChange={(event) =>
                    updateService(index, { url: event.target.value })
                  }
                  aria-label={t("providersGatewayServiceUrlAria")}
                />
              </label>

              <div className={`${styles.row} ${styles.wide}`}>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name="gateway-default-service"
                    checked={defaultId === service.id}
                    onChange={() => setDefaultId(service.id)}
                  />{" "}
                  {t("providersGatewayServiceDefault")}
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={service.enabled}
                    onChange={(event) =>
                      updateService(index, { enabled: event.target.checked })
                    }
                  />{" "}
                  {t("providersGatewayServiceEnabled")}
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={service.codexEnabled}
                    onChange={(event) =>
                      updateService(index, {
                        codexEnabled: event.target.checked,
                      })
                    }
                  />{" "}
                  {t("providersGatewayServiceCodex")}
                </label>
              </div>

              <label className={styles.field}>
                <span>{t("providersGatewayServiceShortNameLabel")}</span>
                <input
                  type="text"
                  className="settings-input"
                  value={service.shortName}
                  maxLength={MAX_GATEWAY_SERVICE_SHORT_NAME_LENGTH}
                  placeholder={service.id}
                  onChange={(event) =>
                    updateService(index, {
                      shortName: event.target.value.trim(),
                    })
                  }
                  aria-label={t("providersGatewayServiceShortNameAria")}
                />
              </label>
              <p className={`settings-hint ${styles.wide}`}>
                {t("providersGatewayServiceShortNameHint")}
              </p>

              <label className={styles.field}>
                <span>{t("providersGatewayServiceContextLabel")}</span>
                <input
                  type="number"
                  min={1}
                  className="settings-input"
                  value={numberFieldValue(service.contextWindowTokens)}
                  onChange={(event) =>
                    updateService(index, {
                      contextWindowTokens: parseNumberField(event.target.value),
                    })
                  }
                  aria-label={t("providersGatewayServiceContextAria")}
                />
              </label>
              <label className={styles.field}>
                <span>{t("providersGatewayServiceOutputLabel")}</span>
                <input
                  type="number"
                  min={1}
                  className="settings-input"
                  value={numberFieldValue(service.maxOutputTokens)}
                  onChange={(event) =>
                    updateService(index, {
                      maxOutputTokens: parseNumberField(event.target.value),
                    })
                  }
                  aria-label={t("providersGatewayServiceOutputAria")}
                />
              </label>
              <p className={`settings-hint ${styles.wide}`}>
                {t("providersGatewayServiceSizesHint")}
              </p>

              <details className={`${styles.advanced} ${styles.wide}`}>
                <summary>{t("providersGatewayServiceAdvanced")}</summary>

                <label className={styles.field}>
                  <span>{t("providersGatewayServiceLabelLabel")}</span>
                  <input
                    type="text"
                    className="settings-input"
                    value={service.label}
                    maxLength={MAX_GATEWAY_SERVICE_LABEL_LENGTH}
                    onChange={(event) =>
                      updateService(index, { label: event.target.value.trim() })
                    }
                    aria-label={t("providersGatewayServiceLabelAria")}
                  />
                </label>

                <label className={styles.field}>
                  <span>{t("providersGatewayServiceCommandLabel")}</span>
                  <input
                    type="text"
                    className="settings-input"
                    value={service.serviceCommand ?? ""}
                    maxLength={MAX_GATEWAY_SERVICE_COMMAND_LENGTH}
                    disabled={!loopback}
                    placeholder={t("providersGatewayServiceCommandPlaceholder")}
                    onChange={(event) =>
                      updateService(index, {
                        serviceCommand: event.target.value.trim() || undefined,
                      })
                    }
                    aria-label={t("providersGatewayServiceCommandAria")}
                  />
                </label>
                <p className="settings-hint">
                  {loopback
                    ? t("providersGatewayServiceCommandHint")
                    : t("providersGatewayServiceCommandRemoteHint")}
                </p>

                <div className={`${styles.row} ${styles.wide}`}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={service.autoStop}
                      disabled={!loopback || !service.serviceCommand}
                      onChange={(event) =>
                        updateService(index, { autoStop: event.target.checked })
                      }
                    />{" "}
                    {t("providersGatewayServiceAutoStop")}
                  </label>
                  <label className={`${styles.field} ${styles.inline}`}>
                    <span>{t("providersGatewayServiceAutoStopAfter")}</span>
                    <input
                      type="number"
                      min={0}
                      className="settings-input"
                      value={service.autoStopAfterSeconds}
                      disabled={!service.autoStop}
                      onChange={(event) =>
                        updateService(index, {
                          autoStopAfterSeconds:
                            parseNumberField(event.target.value) ?? 0,
                        })
                      }
                      aria-label={t("providersGatewayServiceAutoStopAfterAria")}
                    />
                  </label>
                </div>
                <p className="settings-hint">
                  {t("providersGatewayServiceAutoStopHint")}
                </p>

                <label className={styles.field}>
                  <span>{t("providersGatewayServiceMaxModelsLabel")}</span>
                  <input
                    type="number"
                    min={1}
                    className="settings-input"
                    value={numberFieldValue(service.maxModels)}
                    onChange={(event) =>
                      updateService(index, {
                        maxModels: parseNumberField(event.target.value),
                      })
                    }
                    aria-label={t("providersGatewayServiceMaxModelsAria")}
                  />
                </label>

                <label className={styles.field}>
                  <span>{t("providersGatewayServiceWireApiLabel")}</span>
                  <select
                    className="settings-input"
                    value={service.codexWireApi}
                    onChange={(event) =>
                      updateService(index, {
                        codexWireApi:
                          event.target.value === "responses"
                            ? "responses"
                            : "chat",
                      })
                    }
                    aria-label={t("providersGatewayServiceWireApiLabel")}
                  >
                    <option value="chat">chat/completions</option>
                    <option value="responses">responses</option>
                  </select>
                </label>

                <label className={styles.field}>
                  <span>{t("providersGatewayServiceDisableAgentLabel")}</span>
                  <select
                    className="settings-input"
                    value={overrideValue(service.disableAgent)}
                    onChange={(event) =>
                      updateService(index, {
                        disableAgent:
                          event.target.value === "inherit"
                            ? undefined
                            : event.target.value === "on",
                      })
                    }
                    aria-label={t("providersGatewayServiceDisableAgentLabel")}
                  >
                    <option value="inherit">
                      {t("providersGatewayServiceOverrideInherit")}
                    </option>
                    <option value="on">
                      {t("providersGatewayServiceOverrideOn")}
                    </option>
                    <option value="off">
                      {t("providersGatewayServiceOverrideOff")}
                    </option>
                  </select>
                </label>

                <label className={styles.field}>
                  <span>
                    {t("providersGatewayServiceDisablePlanModeLabel")}
                  </span>
                  <select
                    className="settings-input"
                    value={overrideValue(service.disablePlanMode)}
                    onChange={(event) =>
                      updateService(index, {
                        disablePlanMode:
                          event.target.value === "inherit"
                            ? undefined
                            : event.target.value === "on",
                      })
                    }
                    aria-label={t(
                      "providersGatewayServiceDisablePlanModeLabel",
                    )}
                  >
                    <option value="inherit">
                      {t("providersGatewayServiceOverrideInherit")}
                    </option>
                    <option value="on">
                      {t("providersGatewayServiceOverrideOn")}
                    </option>
                    <option value="off">
                      {t("providersGatewayServiceOverrideOff")}
                    </option>
                  </select>
                </label>

                <button
                  type="button"
                  className="settings-button"
                  onClick={() =>
                    setServices((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >
                  {t("providersGatewayServiceRemove")}
                </button>
              </details>
            </fieldset>
          );
        })}

        <div className={styles.actions}>
          <button
            type="button"
            className="settings-button"
            disabled={services.length >= MAX_GATEWAY_SERVICES}
            onClick={() =>
              setServices((current) => [
                ...current,
                newService(new Set(current.map((service) => service.id))),
              ])
            }
          >
            {t("providersGatewayServiceAdd")}
          </button>
          <button
            type="submit"
            className="settings-button"
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? t("providersSaving") : t("providersSave")}
          </button>
        </div>
        <p className="settings-hint">
          {t("providersClaudeGatewayIsolationHint")}
        </p>
      </form>
    </div>
  );
}
