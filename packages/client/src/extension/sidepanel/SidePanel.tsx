import {
  issueLookupUrl,
  type IssueItem,
  type IssueUrlReference,
} from "@yep-anywhere/shared";
import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { ProviderBadge } from "../../components/ProviderBadge";
import { NotificationBadge } from "../../components/StatusBadge";
import { ThinkingIndicator } from "../../components/ThinkingIndicator";
import { useI18n } from "../../i18n";
import { formatBriefAge } from "../../lib/sessionAge";
import { loadSavedHosts, type SavedHost } from "../../lib/hostStorage";
import { IssueTypeBadge } from "../../pages/IssueTypeBadge";
import type { Project } from "../../types";
import { openInApp } from "../appTab";
import { getChrome } from "../chrome";
import { withHost } from "../hostLinks";
import {
  type AttentionView,
  type HostAnswer,
  hostPath,
  type IssueLookup,
  loadAttention,
  lookupIssue,
  type PanelSession,
  sessionPath,
} from "../lookup";
import { activeHosts, defaultHost } from "../savedHosts";
import {
  allowlistPermits,
  DEFAULT_EXTENSION_SETTINGS,
  type ExtensionSettings,
  loadExtensionSettings,
  subscribeExtensionSettings,
} from "../settings";
import styles from "./SidePanel.module.css";
import { useCurrentTab } from "./useCurrentTab";

const REFRESH_MS = 30_000;

type Content =
  | { kind: "idle" }
  | { kind: "lookup"; lookup: IssueLookup }
  | { kind: "attention"; view: AttentionView };

function useExtensionSettings(): ExtensionSettings {
  const [settings, setSettings] = useState(DEFAULT_EXTENSION_SETTINGS);
  useEffect(() => {
    void loadExtensionSettings().then(setSettings);
    return subscribeExtensionSettings(setSettings);
  }, []);
  return settings;
}

/** Saved hosts in this extension origin's localStorage, kept current. */
function useSavedHosts(): SavedHost[] {
  const [hosts, setHosts] = useState(() => loadSavedHosts().hosts);
  useEffect(() => {
    const reload = () => setHosts(loadSavedHosts().hosts);
    window.addEventListener("storage", reload);
    return () => window.removeEventListener("storage", reload);
  }, []);
  return hosts;
}

function useSiteAccess(url: string | undefined): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    const chrome = getChrome();
    if (!chrome || !url) {
      setGranted(null);
      return;
    }
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      setGranted(null);
      return;
    }
    const check = () =>
      void chrome.permissions
        .contains({ origins: [`${origin}/*`] })
        .then(setGranted, () => setGranted(null));
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [url]);
  return granted;
}

function StateBadge({ session }: { session: PanelSession }) {
  const { t } = useI18n();
  if (session.state === "approval")
    return (
      <NotificationBadge
        variant="needs-input"
        label={t("extensionPanelApproval")}
      />
    );
  if (session.state === "question")
    return (
      <NotificationBadge
        variant="needs-input"
        label={t("extensionPanelQuestion")}
      />
    );
  if (session.state === "running") return <ThinkingIndicator variant="pill" />;
  return null;
}

function SessionRow({
  session,
  showHost,
  onOpen,
}: {
  session: PanelSession;
  showHost: boolean;
  onOpen: (session: PanelSession, event: MouseEvent) => void;
}) {
  const { t } = useI18n();
  return (
    <li>
      <button
        type="button"
        className={styles.row}
        aria-label={t("extensionPanelOpenSession", { title: session.title })}
        onClick={(event) => onOpen(session, event)}
      >
        <span className={styles.rowTop}>
          <span className={styles.rowTitle}>{session.title}</span>
          {session.updatedAt && (
            <span className={styles.age}>
              {formatBriefAge(session.updatedAt)}
            </span>
          )}
        </span>
        <span className={styles.rowMeta}>
          <StateBadge session={session} />
          {session.provider && (
            <ProviderBadge provider={session.provider} model={session.model} />
          )}
          <span>
            {[
              session.projectName,
              showHost ? session.host.displayName : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        {session.lastAgentText && (
          <span className={styles.activity}>{session.lastAgentText}</span>
        )}
        {session.mentions !== undefined && session.mentions > 0 && (
          <span className={styles.mentions}>
            {t("extensionPanelMentions", { count: session.mentions })}
          </span>
        )}
      </button>
    </li>
  );
}

function HostProblems({ answers }: { answers: HostAnswer[] }) {
  const { t } = useI18n();
  const problems = answers.filter((answer) => answer.status !== "ok");
  if (problems.length === 0) return null;
  return (
    <ul className={styles.problems}>
      {problems.map((answer) => (
        <li key={answer.host.id}>
          {answer.status === "sign-in"
            ? t("extensionPanelHostSignIn", { host: answer.host.displayName })
            : answer.status === "issues-off"
              ? t("extensionPanelHostIssuesOff", {
                  host: answer.host.displayName,
                })
              : t("extensionPanelHostError", {
                  host: answer.host.displayName,
                  error: answer.error ?? "",
                })}
        </li>
      ))}
    </ul>
  );
}

function issueBadgeItem(reference: IssueUrlReference): IssueItem {
  return {
    id: reference.identity,
    key: reference.key,
    title: null,
    url: reference.url,
    provider: reference.provider,
    kind: reference.kind,
    sessionCount: 0,
    unresolved: false,
  };
}

/** The project most likely meant for a new session about `reference`. */
async function guessProject(
  host: SavedHost,
  reference: IssueUrlReference,
): Promise<string | undefined> {
  const repository =
    reference.provider === "github"
      ? reference.key.split("#")[0]!.split("/")[1]!.toLowerCase()
      : null;
  if (!repository) return undefined;
  const { projects } = await withHost(host, (connection) =>
    connection.fetch<{ projects: Project[] }>("/projects"),
  );
  return projects.find(
    (project) =>
      project.name.toLowerCase() === repository ||
      project.path.split(/[\\/]/).pop()?.toLowerCase() === repository,
  )?.id;
}

export function SidePanel() {
  const { t } = useI18n();
  const settings = useExtensionSettings();
  const savedHosts = useSavedHosts();
  const hosts = activeHosts(savedHosts, settings);
  const hostKey = hosts
    .map((host) => `${host.id}:${host.session?.sessionId ?? ""}`)
    .join(",");
  const tab = useCurrentTab();
  const access = useSiteAccess(tab.url);
  const [manualUrl, setManualUrl] = useState<string>();
  const [content, setContent] = useState<Content>({ kind: "idle" });
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  const reference = tab.url ? issueLookupUrl(tab.url) : null;
  const lookupWanted =
    !!reference &&
    !!tab.url &&
    (tab.clicked ||
      manualUrl === tab.url ||
      (settings.automaticLookup &&
        allowlistPermits(settings.lookupAllowlist, reference.key)));

  // Reload on any input change, on demand, and while visible. hostKey stands
  // for `hosts`, which is rebuilt on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshCount is the on-demand trigger and hostKey identifies hosts.
  useEffect(() => {
    if (hosts.length === 0) return;
    const url = tab.url;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        if (lookupWanted && url) {
          const lookup = await lookupIssue(url, hosts, {
            includeDismissed: settings.includeDismissed,
          });
          if (!cancelled && lookup) setContent({ kind: "lookup", lookup });
        } else if (settings.panelFallback !== "none") {
          const view = await loadAttention(hosts);
          if (!cancelled) setContent({ kind: "attention", view });
        } else if (!cancelled) setContent({ kind: "idle" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    hostKey,
    tab.url,
    lookupWanted,
    settings.includeDismissed,
    settings.panelFallback,
    refreshCount,
  ]);

  // A different page drops the previous page's answer and note.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the URL is the trigger, not an input.
  useEffect(() => {
    setContent({ kind: "idle" });
    setNote("");
  }, [tab.url]);

  const open = useCallback(
    (session: PanelSession, event: MouseEvent) => {
      void openInApp(sessionPath(session), {
        newTab:
          settings.openSessionsIn === "new-tab" ||
          event.metaKey ||
          event.ctrlKey,
      });
    },
    [settings.openSessionsIn],
  );

  const target = defaultHost(savedHosts, settings);
  const openOptions = () =>
    void openInApp(
      target ? hostPath(target, "settings/browser-extension") : "/login",
    );

  const startSession = (lookupReference: IssueUrlReference) => {
    if (!target) return;
    void navigator.clipboard
      .writeText(lookupReference.url)
      .then(() => setNote(t("extensionPanelNewSessionCopied")))
      .catch(() => {});
    void guessProject(target, lookupReference)
      .catch(() => undefined)
      .then((projectId) =>
        openInApp(
          hostPath(
            target,
            projectId
              ? `new-session?projectId=${encodeURIComponent(projectId)}`
              : "new-session",
          ),
        ),
      );
  };

  const requestSite = () => {
    const chrome = getChrome();
    if (!chrome || !tab.url) return;
    const origin = new URL(tab.url).origin;
    void chrome.permissions.request({ origins: [`${origin}/*`] });
  };

  const showHost = hosts.length > 1;
  const site = tab.url ? new URL(tab.url).host : "";
  const lookup = content.kind === "lookup" ? content.lookup : null;
  const attention = content.kind === "attention" ? content.view : null;
  const answers = lookup?.hosts ?? attention?.hosts ?? [];

  return (
    <div className={styles.panel}>
      {/* Chrome's own panel header already shows the extension's icon and
          name, so this row holds only hosts and controls. */}
      <header className={styles.header}>
        <span className={styles.hosts}>
          {hosts.map((host) => {
            const answer = answers.find((item) => item.host.id === host.id);
            return (
              <span key={host.id} className={styles.hostChip}>
                <span
                  className={
                    answer?.status === "ok" ? styles.online : styles.offline
                  }
                  aria-hidden="true"
                />
                {host.displayName}
              </span>
            );
          })}
        </span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("extensionPanelRefresh")}
          title={t("extensionPanelRefresh")}
          disabled={loading || hosts.length === 0}
          onClick={() => setRefreshCount((count) => count + 1)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("extensionPanelOptions")}
          title={t("extensionPanelOptions")}
          onClick={openOptions}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </header>

      <main className={styles.body}>
        {hosts.length === 0 ? (
          <section className={styles.context}>
            <p>
              {savedHosts.length === 0
                ? t("extensionPanelNoHosts")
                : t("extensionPanelNoActiveHosts")}
            </p>
            <button
              type="button"
              className={styles.primary}
              onClick={
                savedHosts.length === 0
                  ? () => void openInApp("/login")
                  : openOptions
              }
            >
              {savedHosts.length === 0
                ? t("extensionPanelOpenApp")
                : t("extensionPanelOptions")}
            </button>
          </section>
        ) : (
          <>
            {reference && (
              <section className={styles.context} aria-label={reference.key}>
                <div className={styles.contextKey}>
                  <IssueTypeBadge item={issueBadgeItem(reference)} />
                  <span>{reference.key}</span>
                </div>
                {lookup?.item &&
                  (lookup.item.title ?? lookup.item.confirmation?.title) && (
                    <h2>
                      {lookup.item.title ?? lookup.item.confirmation?.title}
                    </h2>
                  )}
                <p>
                  {!lookupWanted
                    ? t("extensionPanelLookupOff")
                    : loading && !lookup
                      ? t("extensionPanelLookingUp")
                      : lookup
                        ? lookup.sessions.length === 1
                          ? t("extensionPanelSessionCountOne")
                          : t("extensionPanelSessionCount", {
                              count: lookup.sessions.length,
                            })
                        : ""}
                </p>
              </section>
            )}

            {reference && !lookupWanted && (
              <button
                type="button"
                className={styles.primary}
                onClick={() => setManualUrl(tab.url)}
              >
                {t("extensionPanelLookUp")}
              </button>
            )}

            <HostProblems answers={answers} />

            {lookup && (
              <>
                {lookup.sessions.length === 0 ? (
                  <p className={styles.hint}>{t("extensionPanelNoSessions")}</p>
                ) : (
                  <ul className={styles.list}>
                    {lookup.sessions.map((session) => (
                      <SessionRow
                        key={`${session.host.id}:${session.sessionId}`}
                        session={session}
                        showHost={showHost}
                        onOpen={open}
                      />
                    ))}
                  </ul>
                )}
                {target && (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => startSession(lookup.reference)}
                  >
                    {t("extensionPanelNewSession")}
                  </button>
                )}
                {note && (
                  <p className={styles.note} role="status">
                    {note}
                  </p>
                )}
                <p className={styles.hint}>{t("extensionPanelCoverage")}</p>
              </>
            )}

            {reference && tab.clicked && access === false && (
              <div className={styles.siteAccess}>
                <button type="button" onClick={requestSite}>
                  {t("extensionPanelAllowSite", { site })}
                </button>
                <p className={styles.hint}>
                  {t("extensionPanelAllowSiteHint", { site })}
                </p>
              </div>
            )}

            {!reference && (
              <p className={styles.hint}>
                {tab.url
                  ? t("extensionPanelNoIssue")
                  : t("extensionPanelPageUnknown")}
              </p>
            )}

            {attention && (
              <AttentionGroups
                view={attention}
                fallback={settings.panelFallback}
                showHost={showHost}
                onOpen={open}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function AttentionGroups({
  view,
  fallback,
  showHost,
  onOpen,
}: {
  view: AttentionView;
  fallback: ExtensionSettings["panelFallback"];
  showHost: boolean;
  onOpen: (session: PanelSession, event: MouseEvent) => void;
}) {
  const { t } = useI18n();
  const groups =
    fallback === "recent"
      ? [{ heading: t("extensionPanelRecent"), sessions: view.recent }]
      : [
          { heading: t("extensionPanelNeedsYou"), sessions: view.needsYou },
          { heading: t("extensionPanelRunning"), sessions: view.running },
          {
            heading: t("extensionPanelRecent"),
            sessions: view.recent.slice(0, 5),
          },
        ];
  const visible = groups.filter((group) => group.sessions.length > 0);
  if (visible.length === 0)
    return <p className={styles.hint}>{t("extensionPanelNothingActive")}</p>;
  return (
    <>
      {visible.map((group) => (
        <section key={group.heading} aria-label={group.heading}>
          <h3 className={styles.groupHeading}>
            {group.heading}
            <span>{group.sessions.length}</span>
          </h3>
          <ul className={styles.list}>
            {group.sessions.map((session) => (
              <SessionRow
                key={`${session.host.id}:${session.sessionId}`}
                session={session}
                showHost={showHost}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
