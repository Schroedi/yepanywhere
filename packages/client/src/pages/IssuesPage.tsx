import { IssueIcon } from "../components/IssueIcon";
import type {
  IssueItem,
  IssueSearchResult,
  IssueEvidenceResult,
} from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useIssuesEnabled } from "../hooks/useIssuesEnabled";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { MainContent, useNavigationLayout } from "../layouts";
import styles from "./IssuesPage.module.css";

export function IssuesPage() {
  const { t } = useI18n();
  const { openSidebar, isWideScreen } = useNavigationLayout();
  const enabled = useIssuesEnabled();
  const runtime = useCurrentSourceRuntime();
  const [scopeParams] = useSearchParams();
  return (
    <MainContent isWideScreen={isWideScreen}>
      <PageHeader title={t("issuesTitle")} onOpenSidebar={openSidebar} />
      {enabled ? (
        <IssueBrowser key={`${runtime.sourceKey}:${scopeParams.toString()}`} />
      ) : (
        <p className={styles.empty}>{t("issuesDisabled")}</p>
      )}
    </MainContent>
  );
}
function IssueBrowser() {
  const { t } = useI18n();
  const { transport } = useCurrentSourceRuntime();
  const base = useRemoteBasePath();
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [result, setResult] = useState<IssueSearchResult>();
  const [selected, setSelected] = useState<IssueItem>();
  const [detail, setDetail] = useState<IssueEvidenceResult>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [deleting, setDeleting] = useState(false);
  const selection = useRef(selected?.id);
  selection.current = selected?.id;
  const source = useRef(transport);
  source.current = transport;
  const sessionId = params.get("sessionId") ?? "";
  const projectId = params.get("projectId") ?? "";
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResult(undefined);
    const load = async () => {
      try {
        const next = await transport.fetch<IssueSearchResult>(
          `/issues?${new URLSearchParams({ q: query, offset: String(offset), dismissed: dismissed ? "1" : "0", sessionId, projectId, revision: String(revision) })}`,
        );
        if (!disposed) {
          setResult(next);
          setError("");
          if (next.coverage.active) timer = setTimeout(load, 750);
        }
      } catch {
        if (!disposed) setError(t("issuesLoadError"));
      }
    };
    timer = setTimeout(() => void load(), 150);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [transport, query, offset, dismissed, sessionId, projectId, revision, t]);
  useEffect(() => {
    let disposed = false;
    setDetail(undefined);
    setTitle(selected?.title ?? "");
    setUrl("");
    setDeleting(false);
    if (selected)
      void transport
        .fetch<IssueEvidenceResult>(
          `/issues/evidence?${new URLSearchParams({ id: selected.id, revision: String(revision) })}`,
        )
        .then((next) => {
          if (!disposed) setDetail(next);
        })
        .catch(() => {
          if (!disposed) setError(t("issuesLoadError"));
        });
    return () => {
      disposed = true;
    };
  }, [transport, selected, revision, t]);
  const action = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      await transport.fetch(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (source.current === transport) {
        setRevision((x) => x + 1);
        return true;
      }
    } catch {
      if (source.current === transport) setError(t("issuesSaveError"));
    } finally {
      if (source.current === transport) setBusy(false);
    }
    return false;
  };
  const moreEvidence = async () => {
    if (!selected || detail?.nextOffset == null) return;
    setBusy(true);
    try {
      const next = await transport.fetch<IssueEvidenceResult>(
        `/issues/evidence?${new URLSearchParams({ id: selected.id, offset: String(detail.nextOffset) })}`,
      );
      if (source.current === transport && selection.current === selected.id)
        setDetail({
          ...next,
          evidence: [...detail.evidence, ...next.evidence],
        });
    } catch {
      if (source.current === transport) setError(t("issuesLoadError"));
    } finally {
      if (source.current === transport) setBusy(false);
    }
  };
  return (
    <main className={styles.page}>
      <div className={styles.controls}>
        <input
          type="search"
          aria-label={t("issuesSearch")}
          placeholder={t("issuesSearch")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <button type="button" onClick={() => setRevision((x) => x + 1)}>
          {t("issuesRefresh")}
        </button>
        <Link className={styles.settingsLink} to={`${base}/settings/issues`}>
          {t("issuesSettings")}
        </Link>
      </div>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={dismissed}
          onChange={(e) => {
            setDismissed(e.target.checked);
            setOffset(0);
          }}
        />
        {t("issuesShowDismissed")}
      </label>
      {sessionId && (
        <p>
          {t("issuesSessionFilter")}{" "}
          <Link to={`${base}/issues`}>{t("issuesAll")}</Link>
        </p>
      )}
      {result && (
        <div className={styles.coverage} role="status">
          <span>
            {result.coverage.active
              ? t("issuesIndexing")
              : result.coverage.settings.scope === "viewed"
                ? t("issuesViewedCoverage")
                : t("issuesRecentCoverage", {
                    days: result.coverage.settings.recentDays,
                  })}
          </span>
          {result.coverage.counts.map((row) => (
            <span key={row.state}>
              {t(`issuesState_${row.state}` as never)}: {row.count}
            </span>
          ))}
          {result.coverage.error && <span>{t("issuesLoadError")}</span>}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className={`${styles.columns} ${selected ? styles.withDetail : ""}`}>
        <section className={styles.list} aria-label={t("issuesResults")}>
          {result?.items.length === 0 && (
            <p className={styles.empty}>{t("issuesEmpty")}</p>
          )}
          {result?.items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`${styles.item} ${selected?.id === item.id ? styles.selected : ""}`}
              aria-pressed={selected?.id === item.id}
              onClick={() => setSelected(item)}
            >
              <span className={styles.itemTitle}>
                <IssueIcon />
                <strong>{item.title ?? item.key}</strong>
              </span>
              <span>
                {item.title ? `${item.key} · ` : ""}
                {item.provider} ·{" "}
                {t(
                  item.sessionCount === 1
                    ? "issuesSingleSession"
                    : "issuesSessionCount",
                  { count: item.sessionCount },
                )}
              </span>
              {item.unresolved && <small>{t("issuesUnresolved")}</small>}
            </button>
          ))}
          <div className={styles.actions}>
            {offset > 0 && (
              <button
                type="button"
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                {t("issuesPrevious")}
              </button>
            )}
            {result?.nextOffset != null && (
              <button
                type="button"
                onClick={() => setOffset(result.nextOffset!)}
              >
                {t("issuesNext")}
              </button>
            )}
          </div>
        </section>
        {selected && (
          <section className={styles.detail} aria-label={t("issuesEvidence")}>
            <div className={styles.actions}>
              <h2>{selected.title ?? selected.key}</h2>
              <button
                type="button"
                aria-label={t("issuesClose")}
                onClick={() => setSelected(undefined)}
              >
                ×
              </button>
            </div>
            {selected.url && (
              <a href={selected.url} target="_blank" rel="noreferrer">
                {t("issuesOpenExternal")}
              </a>
            )}
            {!selected.unresolved && (
              <form
                className={styles.controls}
                onSubmit={(e) => {
                  e.preventDefault();
                  void action("/issues/item", "PATCH", {
                    id: selected.id,
                    title: title.trim() || null,
                  }).then((ok) => {
                    if (ok)
                      setSelected((previous) =>
                        previous?.id === selected.id
                          ? { ...previous, title: title.trim() || null }
                          : previous,
                      );
                  });
                }}
              >
                <input
                  aria-label={t("issuesTitleOverride")}
                  value={title}
                  maxLength={512}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <button disabled={busy} type="submit">
                  {t("issuesSaveTitle")}
                </button>
              </form>
            )}
            {selected.unresolved && (
              <form
                className={styles.settings}
                onSubmit={(e) => {
                  e.preventDefault();
                  const first = detail?.evidence[0];
                  if (first)
                    void action("/issues/resolve", "POST", {
                      url,
                      key: selected.key,
                      projectId: first.projectId,
                      sessionId: first.sessionId,
                    }).then((ok) => {
                      if (ok) setSelected(undefined);
                    });
                }}
              >
                <p>{t("issuesResolveHelp")}</p>
                <input
                  type="url"
                  required
                  aria-label={t("issuesResolveUrl")}
                  placeholder={t("issuesResolveUrl")}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={busy || !detail?.evidence.length}
                >
                  {t("issuesResolve")}
                </button>
              </form>
            )}
            <h3>{t("issuesEvidence")}</h3>
            {detail?.evidence.map((evidence) => (
              <article className={styles.evidence} key={evidence.id}>
                {evidence.sourceAvailable === false ? (
                  <span>
                    {t("issuesSourceUnavailable")}{" "}
                    {evidence.sessionTitle ?? evidence.sessionId}
                  </span>
                ) : (
                  <Link
                    to={`${base}/projects/${evidence.projectId}/sessions/${evidence.sessionId}`}
                  >
                    {t("issuesOpenSession")}{" "}
                    {evidence.sessionTitle ?? evidence.sessionId}
                  </Link>
                )}
                <p>{evidence.excerpt || evidence.value}</p>
                <small>
                  {t(`issuesEvidence_${evidence.kind}` as never)} ·{" "}
                  {new Date(evidence.observedAt).toLocaleString()}
                </small>
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action("/issues/decision", "POST", {
                        id: selected.id,
                        sessionId: evidence.sessionId,
                        state:
                          evidence.state === "dismissed"
                            ? "discovered"
                            : "dismissed",
                      })
                    }
                  >
                    {evidence.state === "dismissed"
                      ? t("issuesRestore")
                      : t("issuesDismiss")}
                  </button>
                  {evidence.state !== "confirmed" &&
                    evidence.state !== "dismissed" &&
                    !selected.unresolved && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void action("/issues/decision", "POST", {
                            id: selected.id,
                            sessionId: evidence.sessionId,
                            state: "confirmed",
                          })
                        }
                      >
                        {t("issuesConfirm")}
                      </button>
                    )}
                </div>
              </article>
            ))}
            {detail?.nextOffset != null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void moreEvidence()}
              >
                {t("issuesMoreEvidence")}
              </button>
            )}
            {!deleting ? (
              <button
                className={styles.danger}
                type="button"
                onClick={() => setDeleting(true)}
              >
                {t("issuesDelete")}
              </button>
            ) : (
              <div className={styles.settings}>
                <p>{t("issuesDeleteHelp")}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      `/issues/item?${new URLSearchParams({ id: selected.id, revision: String(revision) })}`,
                      "DELETE",
                    ).then((ok) => {
                      if (ok) setSelected(undefined);
                    })
                  }
                >
                  {t("issuesDeleteConfirm")}
                </button>
                <button type="button" onClick={() => setDeleting(false)}>
                  {t("issuesCancel")}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
