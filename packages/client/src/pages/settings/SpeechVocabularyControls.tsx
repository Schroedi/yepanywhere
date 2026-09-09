import type { SpeechVocabularyStatus } from "@yep-anywhere/shared";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useI18n } from "../../i18n";
import styles from "./SpeechVocabularyControls.module.css";

const SpeechVocabularyChart = lazy(() => import("./SpeechVocabularyChart"));

export function SpeechVocabularyControls() {
  const { t } = useI18n();
  const { transport } = useCurrentSourceRuntime();
  const [status, setStatus] = useState<SpeechVocabularyStatus>();
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showLexicon, setShowLexicon] = useState(false);
  const includeWords = useRef(false);
  includeWords.current = showLexicon;
  const id = useId();
  const revision = useRef(0);
  const scope = useRef(transport);
  scope.current = transport;

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus(undefined);
    setError(undefined);
    setBusy(false);
    let first = true;
    const refresh = async () => {
      const observedRevision = revision.current;
      try {
        const next = await transport.fetch<SpeechVocabularyStatus>(
          `/speech/vocabulary${includeWords.current ? "?includeWords=1" : ""}`,
        );
        if (disposed) return;
        if (!includeWords.current) delete next.words;
        if (observedRevision === revision.current) {
          setStatus(next);
          if (first) setHours(String(next.hours));
          first = false;
        }
      } catch (error) {
        if (!disposed)
          setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!disposed) timer = setTimeout(refresh, 2000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [transport]);

  const validHours =
    Number.isFinite(Number(hours)) &&
    Number(hours) >= 1 &&
    Number(hours) <= 8760;
  const action = async (
    kind: "settings" | "scan" | "reset",
    changes: Partial<Pick<SpeechVocabularyStatus, "enabled" | "biasing">> = {},
  ) => {
    if (!status || busy || (kind !== "reset" && !validHours)) return;
    revision.current++;
    setBusy(true);
    setError(undefined);
    try {
      let next: SpeechVocabularyStatus;
      if (kind === "reset") {
        next = await transport.fetch<SpeechVocabularyStatus>(
          "/speech/vocabulary/reset",
          { method: "POST" },
        );
      } else {
        next = await transport.fetch<SpeechVocabularyStatus>(
          "/speech/vocabulary",
          {
            method: "PUT",
            body: JSON.stringify({
              enabled: status.enabled,
              biasing: status.biasing,
              hours: Number(hours),
              ...changes,
            }),
          },
        );
        if (kind === "scan")
          next = await transport.fetch<SpeechVocabularyStatus>(
            "/speech/vocabulary/scan",
            { method: "POST" },
          );
      }
      if (scope.current === transport) setStatus(next);
    } catch (error) {
      if (scope.current === transport)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      revision.current++;
      if (scope.current === transport) setBusy(false);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t("speechVocabularyTitle")}</h3>
      <p>{t("speechVocabularyDescription")}</p>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={status?.enabled ?? false}
          disabled={!status || busy || !validHours}
          onChange={(event) =>
            void action("settings", { enabled: event.target.checked })
          }
        />
        {t("speechVocabularyLearn")}
      </label>
      <div className={styles.hours}>
        <label htmlFor={`${id}-hours`}>{t("speechVocabularyHours")}</label>
        <input
          id={`${id}-hours`}
          type="number"
          min="1"
          max="8760"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          disabled={busy}
        />
        <input
          type="range"
          min="1"
          max="8760"
          value={validHours ? Number(hours) : 24}
          aria-label={t("speechVocabularyHoursSlider")}
          onChange={(event) => setHours(event.target.value)}
          disabled={busy}
        />
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.scan}
          disabled={
            !status?.enabled ||
            busy ||
            !validHours ||
            status.scan.state === "scanning"
          }
          onClick={() => void action("scan")}
        >
          {t("speechVocabularyScan")}
        </button>
        <button
          type="button"
          disabled={!status || busy}
          onClick={() => void action("reset")}
          className={styles.reset}
          title={t("speechVocabularyResetDescription")}
        >
          {t("speechVocabularyReset")}
        </button>
      </div>
      <p role="status">
        {status
          ? t(
              status.scan.state === "scanning"
                ? "speechVocabularyScanning"
                : "speechVocabularyCounts",
              {
                words: status.totals.words,
                user: status.totals.user,
                assistant: status.totals.assistant,
                sessions: status.scan.sessions,
                messages: status.scan.messages,
              },
            )
          : t("speechVocabularyLoading")}
      </p>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={status?.biasing ?? false}
          disabled={!status || busy || !validHours}
          onChange={(event) =>
            void action("settings", { biasing: event.target.checked })
          }
        />
        {t("speechVocabularyBiasing")}
      </label>
      <p>{t("speechVocabularyIntegration")}</p>
      <div className={styles.actions}>
        <button
          type="button"
          aria-expanded={showLexicon}
          onClick={() => {
            if (showLexicon) {
              includeWords.current = false;
              setStatus((current) => current && { ...current, words: [] });
            }
            setShowLexicon(!showLexicon);
          }}
        >
          {t(
            showLexicon
              ? "speechVocabularyCloseView"
              : "speechVocabularyExplore",
          )}
        </button>
      </div>
      {showLexicon && status && (
        <Suspense fallback={<p>{t("speechVocabularyLoading")}</p>}>
          <SpeechVocabularyChart status={status} />
        </Suspense>
      )}
      {(error || status?.scan.error) && (
        <p role="alert">{error || status?.scan.error}</p>
      )}
    </section>
  );
}
