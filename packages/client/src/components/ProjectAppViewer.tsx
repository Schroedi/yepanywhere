import {
  ARTIFACT_SANDBOX,
  SERVER_CAPABILITIES,
  serverHasCapability,
  type ProjectAppInfo,
  type ProjectAppView,
  type ProjectAppAddresses,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { projectAppApi, type ProjectAppTarget } from "../api/projectApp";
import { useVersion } from "../hooks/useVersion";
import { artifactAudience } from "../lib/artifactPreview";
import type { VoiceInputButtonRef } from "./VoiceInputButton";
import { ViewerWindowActions } from "./ViewerWindowActions";
import { ComposerMicAction } from "./ComposerMicAction";
import { AppViewerToolbar } from "./AppViewerToolbar";
import { LastViewIcon } from "./LastViewIcon";
import actions from "./ViewerWindowActions.module.css";
import styles from "./ProjectAppViewer.module.css";
import { useI18n } from "../i18n";

function Glyph({ path }: { path: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/** The same full-height app surface in a project's main pane or a session pane. */
export function ProjectAppViewer({
  projectId,
  initialTarget,
  onTarget,
  onBack,
  onSession,
  voice,
  onVoice,
  initialSettings = false,
  onFullView,
  presentation = "viewer",
  offerLatestArtifact = true,
  onInfoChanged,
  onAddressesChanged,
}: {
  projectId: string;
  initialTarget?: ProjectAppTarget;
  onTarget?: (target: ProjectAppTarget) => void;
  onBack?: () => void;
  onSession?: () => void;
  voice?: VoiceInputButtonRef | null;
  onVoice?: () => void;
  initialSettings?: boolean;
  /** Offered in a session pane: fill the whole window with the app. */
  onFullView?: () => void;
  /** Inline project settings use the same controls without opening an app. */
  presentation?: "viewer" | "settings";
  /** False where the host already offers an artifact, such as a session's App. */
  offerLatestArtifact?: boolean;
  onInfoChanged?: (info: ProjectAppInfo) => void;
  onAddressesChanged?: (addresses: ProjectAppAddresses) => void;
}) {
  const { version } = useVersion();
  const { t } = useI18n();
  const viewerRef = useRef<HTMLElement>(null);
  const supported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.projectService.name,
  );
  const addressesSupported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.projectAppReservations.name,
  );
  const [info, setInfo] = useState<ProjectAppInfo | null>(null);
  const livePreviewSupported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.projectLivePreview.name,
  );
  const [target, setTarget] = useState<ProjectAppTarget | undefined>(
    initialTarget,
  );
  const [view, setView] = useState<ProjectAppView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettings] = useState(initialSettings);
  const settings = presentation === "settings" || settingsOpen;
  const [sharing, setSharing] = useState(false);
  const [share, setShare] = useState<ProjectAppView | null>(null);
  const [addresses, setAddresses] = useState<ProjectAppAddresses | null>(null);
  const [name, setName] = useState("");
  const [publicAccess, setPublicAccess] = useState<boolean>();
  const [autoStartChoice, setAutoStartChoice] = useState<boolean>();
  const [reload, setReload] = useState(0);
  const audience = artifactAudience(window.location.hostname);
  const refresh = useCallback(async () => {
    const next = await projectAppApi.info(projectId);
    setInfo(next);
    return next;
  }, [projectId]);
  useEffect(() => {
    if (!supported) return;
    let active = true;
    void projectAppApi
      .info(projectId)
      .then((next) => {
        if (!active) return;
        setInfo(next);
        setTarget(
          (previous) =>
            previous ??
            (next.declaration || next.activeDeclaration
              ? { target: "app" }
              : next.latestArtifact
                ? { target: "artifact", artifactId: next.latestArtifact.id }
                : undefined),
        );
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [projectId, supported]);
  const targetKind = target?.target;
  const artifactId = target?.artifactId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload deliberately renews the view grant even when its target is unchanged.
  useEffect(() => {
    if (!supported || !targetKind || presentation === "settings") return;
    let active = true;
    setView(null);
    setError("");
    void projectAppApi
      .open(projectId, { target: targetKind, artifactId }, audience)
      .then((next) => {
        if (active) setView(next);
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [
    projectId,
    targetKind,
    artifactId,
    audience,
    supported,
    reload,
    presentation,
  ]);
  useEffect(() => {
    if (target) onTarget?.(target);
  }, [target, onTarget]);
  useEffect(() => {
    if (!(settings || sharing) || !addressesSupported) return;
    let active = true;
    void projectAppApi
      .addresses(projectId)
      .then((next) => {
        if (active) setAddresses(next);
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [projectId, settings, sharing, addressesSupported]);
  async function perform(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
      const next = await refresh();
      onInfoChanged?.(next);
      if (addressesSupported && (settings || sharing)) {
        const nextAddresses = await projectAppApi.addresses(projectId);
        setAddresses(nextAddresses);
        onAddressesChanged?.(nextAddresses);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  const details = settings || sharing;
  const declaration = info?.activeDeclaration ?? info?.declaration;
  const command =
    declaration && "start" in declaration
      ? declaration.start.argv.join(" ")
      : undefined;
  // A served address reaches a process app only while it runs; a static app
  // is served from its files with no process.
  const processAppStopped =
    !!info &&
    !info.activeDeclaration &&
    info.declaration?.where.kind === "process";
  const canStartApp = processAppStopped && (info.canStart ?? info.canExecute);
  return (
    <section
      ref={viewerRef}
      className={
        presentation === "settings" ? styles.inlineSettings : styles.viewer
      }
      aria-label={t("projectAppTitle")}
    >
      {presentation === "viewer" && (
        <AppViewerToolbar viewerRef={viewerRef}>
          <div className={actions.actions}>
            <button
              type="button"
              aria-label={t("projectAppBack")}
              title={t("projectAppBack")}
              onClick={() => {
                if (details) {
                  setSettings(false);
                  setSharing(false);
                } else if (targetKind === "artifact" && declaration) {
                  // An artifact opened from the controls sits over the
                  // project's own app, so Back returns to it.
                  setTarget({ target: "app" });
                } else {
                  onBack?.();
                }
              }}
            >
              <Glyph path="M15 5l-7 7 7 7" />
            </button>
          </div>
          <span className={styles.title}>
            {view?.label ?? t("projectAppLabel")}
          </span>
          <div className={actions.actions}>
            {onFullView && (
              <button
                type="button"
                title={t("projectAppFullView")}
                aria-label={t("projectAppFullView")}
                onClick={onFullView}
              >
                <Glyph path="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </button>
            )}
            {info?.canExecute && onSession && (
              <button
                type="button"
                title={t("projectAppNewSession")}
                aria-label={t("projectAppNewSession")}
                onClick={onSession}
              >
                <Glyph path="M12 4v16M4 12h16" />
              </button>
            )}
            {info?.canExecute && (
              <ComposerMicAction voice={voice} onActivate={onVoice} />
            )}
            {info?.latestArtifact &&
              (offerLatestArtifact || targetKind === "artifact") && (
                // Always reachable: the controls offering it hide once a view loads.
                <button
                  type="button"
                  title={t("projectAppLatest", {
                    label: info.latestArtifact.label,
                  })}
                  aria-label={t("projectAppLatest", {
                    label: info.latestArtifact.label,
                  })}
                  aria-pressed={targetKind === "artifact"}
                  disabled={targetKind === "artifact" && !declaration}
                  onClick={() => {
                    setTarget(
                      targetKind === "artifact"
                        ? { target: "app" }
                        : {
                            target: "artifact",
                            artifactId: info.latestArtifact!.id,
                          },
                    );
                    setSettings(false);
                    setSharing(false);
                  }}
                >
                  <LastViewIcon />
                </button>
              )}
            <button
              type="button"
              title={t("projectAppShare")}
              aria-label={t("projectAppShare")}
              hidden={info?.canCopyLink === false}
              disabled={!view}
              onClick={() => {
                setSharing(true);
                setSettings(false);
              }}
            >
              <Glyph path="M12 16V3M7 8l5-5 5 5M5 13v8h14v-8" />
            </button>
            <button
              type="button"
              title={t("projectAppSettings")}
              aria-label={t("projectAppSettings")}
              onClick={() => {
                setSettings(true);
                setSharing(false);
                void refresh().catch((reason: Error) =>
                  setError(reason.message),
                );
              }}
            >
              <Glyph path="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" />
            </button>
          </div>
          {livePreviewSupported &&
            info?.livePreview &&
            info.canExecute &&
            targetKind === "app" && (
              <div className={actions.actions}>
                <button
                  type="button"
                  className={`${actions.textAction} ${styles.livePreviewToggle}`}
                  aria-pressed={info.mode === "live-preview"}
                  disabled={
                    busy ||
                    (!!info.activeDeclaration && info.mode !== "live-preview")
                  }
                  onClick={() =>
                    void perform(async () => {
                      await projectAppApi.action(
                        projectId,
                        info.mode === "live-preview" ? "stop" : "start",
                        info.mode === "live-preview"
                          ? {}
                          : { mode: "live-preview" },
                      );
                      setReload((value) => value + 1);
                    })
                  }
                >
                  {t("projectAppLivePreview")}
                </button>
              </div>
            )}
          {view && (
            <ViewerWindowActions
              url={view.url}
              copyLink={info?.canCopyLink !== false}
              copyNotice={`${t("projectAppLinkWarning")} ${view.expiresAt ? t("projectAppExpires", { date: new Date(view.expiresAt).toLocaleString() }) : t("projectAppLaunchLifetime")}`}
              onReload={() => {
                void refresh().catch((reason: Error) =>
                  setError(reason.message),
                );
                setReload((value) => value + 1);
              }}
              onMoveOut={() => {}}
            />
          )}
        </AppViewerToolbar>
      )}
      <div className={styles.details} hidden={!details && !!view && !error}>
        {!supported ? (
          <p>{t("projectAppUpdateRequired")}</p>
        ) : (
          <>
            {error && <p role="alert">{error}</p>}
            {(!view || settings) && (
              <>
                <p>
                  {info
                    ? t("projectAppState", { state: info.state })
                    : t("projectAppLoading")}
                </p>
                {info?.error && <p>{info.error}</p>}
                {info?.restartRequired && <p>{t("projectAppChanged")}</p>}
                {livePreviewSupported &&
                  info?.livePreview &&
                  info.canExecute &&
                  !info.activeDeclaration && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await projectAppApi.action(projectId, "start", {
                            mode: "live-preview",
                          });
                          setReload((value) => value + 1);
                        })
                      }
                    >
                      {t("projectAppLivePreview")}
                    </button>
                  )}
                {info &&
                  (info.activeDeclaration
                    ? info.canExecute
                    : (info.canStart ?? info.canExecute) &&
                      info.declaration?.where.kind === "process") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await projectAppApi.action(
                            projectId,
                            info.activeDeclaration ? "stop" : "start",
                          );
                          setReload((value) => value + 1);
                        })
                      }
                    >
                      {t(
                        busy
                          ? "projectAppWorking"
                          : info.activeDeclaration
                            ? "projectAppStop"
                            : "projectAppStart",
                      )}
                    </button>
                  )}
                {info?.activeDeclaration && info.canExecute && (
                  <button
                    type="button"
                    disabled={busy}
                    title={t("projectAppRestartTitle")}
                    onClick={() =>
                      void perform(async () => {
                        // A running app reads its start-time configuration
                        // again only from a fresh process, in the same mode.
                        await projectAppApi.action(projectId, "stop");
                        await projectAppApi.action(
                          projectId,
                          "start",
                          info.mode === "live-preview"
                            ? { mode: "live-preview" }
                            : {},
                        );
                        setReload((value) => value + 1);
                      })
                    }
                  >
                    {t("projectAppRestart")}
                  </button>
                )}
                {info?.state === "none" && !info.latestArtifact && (
                  <p>{t("projectAppEmpty")}</p>
                )}
                {declaration && (
                  <dl>
                    <dt>{t("projectAppDirectory")}</dt>
                    <dd>
                      <code>
                        {declaration.where.kind === "static"
                          ? declaration.where.root
                          : declaration.where.cwd}
                      </code>
                    </dd>
                    <dt>{t("projectAppEntry")}</dt>
                    <dd>
                      <code>{declaration.where.entry}</code>
                    </dd>
                    {command && (
                      <>
                        <dt>{t("projectAppCommand")}</dt>
                        <dd>
                          <code>{command}</code>
                        </dd>
                      </>
                    )}
                  </dl>
                )}
                {presentation === "viewer" && info?.latestArtifact && (
                  <button
                    type="button"
                    className={styles.iconLabel}
                    onClick={() => {
                      setTarget({
                        target: "artifact",
                        artifactId: info.latestArtifact!.id,
                      });
                      setSettings(false);
                    }}
                  >
                    <LastViewIcon />
                    {t("projectAppLatest", {
                      label: info.latestArtifact.label,
                    })}
                  </button>
                )}
                {presentation === "viewer" &&
                  (info?.declaration || info?.activeDeclaration) && (
                    <button
                      type="button"
                      onClick={() => {
                        setTarget({ target: "app" });
                        setSettings(false);
                      }}
                    >
                      {t("projectAppLabel")}
                    </button>
                  )}
                {info?.removedFrom.map((row) => (
                  <p key={row.username}>
                    {t("projectAppRemoved", {
                      username: row.username,
                      date: new Date(row.at).toLocaleString(),
                    })}{" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          projectAppApi.action(projectId, "restore", {
                            username: row.username,
                          }),
                        )
                      }
                    >
                      {t("projectAppRestore")}
                    </button>
                  </p>
                ))}
              </>
            )}
            {sharing && (
              <>
                <p>{t("projectAppLinkWarning")}</p>
                {!info?.canShare && <p>{t("projectAppShareUnavailable")}</p>}
                <button
                  type="button"
                  disabled={busy || !target || !info?.canShare}
                  onClick={() =>
                    void perform(async () => {
                      setShare(
                        await projectAppApi.open(projectId, target!, "public"),
                      );
                    })
                  }
                >
                  {t("projectAppCreateLink")}
                </button>
                {share && (
                  <>
                    <p>
                      {share.expiresAt
                        ? t("projectAppExpires", {
                            date: new Date(share.expiresAt).toLocaleString(),
                          })
                        : t("projectAppLaunchLifetime")}
                    </p>
                    <ViewerWindowActions url={share.url} onMoveOut={() => {}} />
                  </>
                )}
              </>
            )}
            {details && addresses?.enabled && (
              <fieldset>
                <legend>{t("projectAppAddress")}</legend>
                {addresses.reservations.map((row) => (
                  <div key={`${row.namespace}/${row.name}`}>
                    <p>
                      <strong>
                        {row.name}.{row.namespace}
                      </strong>{" "}
                      · {row.owner} ·{" "}
                      {t(
                        row.namespace === addresses.namespace
                          ? row.serving
                            ? "projectAppServing"
                            : "projectAppReserved"
                          : "projectAppPreviousNamespace",
                      )}{" "}
                      ·{" "}
                      {t(row.public ? "projectAppPublic" : "projectAppPrivate")}
                    </p>
                    {row.url &&
                      serverHasCapability(
                        version,
                        SERVER_CAPABILITIES.projectAppAddressLinks.name,
                      ) && (
                        <div className={styles.addressLink}>
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {row.url}
                          </a>
                          <ViewerWindowActions
                            url={row.url}
                            moveOut={false}
                            copyLabel={t("fileLinkMenuCopyViewerLink")}
                          />
                        </div>
                      )}
                    {row.serving &&
                      row.namespace === addresses.namespace &&
                      processAppStopped &&
                      (addresses.autoStart?.enabled &&
                      !addresses.autoStart.paused ? (
                        <p role="status">
                          {t("projectAppServedStoppedAutoStart", {
                            address: `${row.name}.${row.namespace}`,
                          })}
                        </p>
                      ) : (
                        <p role="status" className={styles.servedStopped}>
                          {t("projectAppServedStopped", {
                            address: `${row.name}.${row.namespace}`,
                          })}
                        </p>
                      ))}
                    {!addresses.canPublish &&
                      !row.public &&
                      row.namespace === addresses.namespace && (
                        <p>{t("projectAppPublicNeedsAdministrator")}</p>
                      )}
                    {addresses.canPublish && (
                      <>
                        {row.namespace === addresses.namespace && (
                          <>
                            {row.privateOnly ? (
                              <p>{t("projectAppPrivateOnly")}</p>
                            ) : (
                              <label className={styles.checkLabel}>
                                <input
                                  type="checkbox"
                                  checked={publicAccess ?? row.public}
                                  disabled={busy}
                                  onChange={(event) =>
                                    setPublicAccess(event.target.checked)
                                  }
                                />
                                {t("projectAppPublic")}
                              </label>
                            )}
                            {!row.privateOnly &&
                              publicAccess !== undefined &&
                              publicAccess !== row.public && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void perform(async () => {
                                      await projectAppApi.addressAction(
                                        projectId,
                                        "serve",
                                        {
                                          serving: row.serving,
                                          public: publicAccess,
                                        },
                                      );
                                      setPublicAccess(undefined);
                                    })
                                  }
                                >
                                  {t("projectAppSaveAccess")}
                                </button>
                              )}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void perform(async () => {
                                  // Serving a stopped process app would only
                                  // publish "not serving", so start it first.
                                  const startFirst =
                                    !row.serving && canStartApp;
                                  if (startFirst)
                                    await projectAppApi.action(
                                      projectId,
                                      "start",
                                    );
                                  await projectAppApi.addressAction(
                                    projectId,
                                    "serve",
                                    {
                                      serving: !row.serving,
                                      public: row.public,
                                    },
                                  );
                                  if (startFirst)
                                    setReload((value) => value + 1);
                                })
                              }
                            >
                              {t(
                                row.serving
                                  ? "projectAppUnserve"
                                  : canStartApp
                                    ? "projectAppStartAndServe"
                                    : "projectAppServe",
                              )}
                            </button>
                            {addresses.autoStart &&
                              declaration?.where.kind === "process" &&
                              serverHasCapability(
                                version,
                                SERVER_CAPABILITIES.projectAppAutoStart.name,
                              ) && (
                                <>
                                  <label className={styles.checkLabel}>
                                    <input
                                      type="checkbox"
                                      checked={
                                        autoStartChoice ??
                                        addresses.autoStart.enabled
                                      }
                                      disabled={busy}
                                      onChange={(event) => {
                                        // Show the choice at once; the refreshed
                                        // addresses then confirm or revert it.
                                        const enabled = event.target.checked;
                                        setAutoStartChoice(enabled);
                                        void perform(() =>
                                          projectAppApi.addressAction(
                                            projectId,
                                            "auto-start",
                                            { enabled },
                                          ),
                                        ).finally(() =>
                                          setAutoStartChoice(undefined),
                                        );
                                      }}
                                    />
                                    {t("projectAppAutoStart")}
                                  </label>
                                  {addresses.autoStart.paused && (
                                    <p role="status">
                                      {t("projectAppAutoStartPaused", {
                                        error: addresses.autoStart.paused,
                                      })}
                                    </p>
                                  )}
                                </>
                              )}
                          </>
                        )}
                        {(addresses.canRelease ?? addresses.canPublish) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("projectAppReleaseConfirm", {
                                    address: `${row.name}.${row.namespace}`,
                                  }),
                                )
                              )
                                void perform(() =>
                                  projectAppApi.addressAction(
                                    projectId,
                                    "release",
                                    { namespace: row.namespace },
                                  ),
                                );
                            }}
                          >
                            {t("projectAppRelease")}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {!addresses.reservations.some(
                  (row) => row.namespace === addresses.namespace,
                ) &&
                  addresses.canReserve && (
                    <>
                      <label>
                        {t("projectAppName")}
                        <input
                          value={name}
                          placeholder={`${addresses.requiredPrefix}canvas`}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy || !name.trim()}
                        onClick={() =>
                          void perform(() =>
                            projectAppApi.addressAction(projectId, "reserve", {
                              name,
                            }),
                          )
                        }
                      >
                        {t("projectAppReserve")}
                      </button>
                      <p>{t("projectAppReserveHint")}</p>
                    </>
                  )}
              </fieldset>
            )}
          </>
        )}
      </div>
      {view && (
        <iframe
          key={`${view.id}:${reload}`}
          hidden={details}
          className={styles.frame}
          title={view.label}
          src={view.url}
          sandbox={
            view.kind === "service"
              ? "allow-scripts allow-same-origin allow-forms allow-downloads"
              : ARTIFACT_SANDBOX
          }
          referrerPolicy="no-referrer"
        />
      )}
    </section>
  );
}
