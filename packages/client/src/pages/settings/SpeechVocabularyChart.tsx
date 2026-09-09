import type { SpeechVocabularyStatus } from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import styles from "./SpeechVocabularyChart.module.css";
import {
  parseVocabularyBaseline,
  VOCABULARY_BASELINE_URL,
} from "./vocabulary-baseline";

type Word = NonNullable<SpeechVocabularyStatus["words"]>[number];

export function rankVocabulary(
  words: Word[],
  total: number,
  baseline: ReadonlyMap<string, number>,
  minimum: number,
  distinctive: boolean,
) {
  return words
    .filter((word) => word.user + word.assistant >= minimum)
    .map((word) => {
      const count = word.user + word.assistant;
      const frequency = baseline.get(word.word);
      const expected = frequency === undefined ? undefined : total * frequency;
      return {
        ...word,
        count,
        ratio: expected ? count / expected : undefined,
        // Descriptive excess-frequency ranking, not a significance test.
        score:
          expected === undefined
            ? 0
            : (count - expected) / Math.sqrt(expected + 1),
      };
    })
    .filter(
      (word) => !distinctive || (word.ratio !== undefined && word.ratio > 1),
    )
    .sort(
      (a, b) =>
        (distinctive ? b.score - a.score : b.count - a.count) ||
        a.word.localeCompare(b.word),
    );
}

export default function SpeechVocabularyChart({
  status,
}: {
  status: SpeechVocabularyStatus;
}) {
  const { t } = useI18n();
  const [baseline, setBaseline] = useState<ReadonlyMap<string, number>>();
  const [error, setError] = useState<string>();
  const [distinctive, setDistinctive] = useState(true);
  const [minimum, setMinimum] = useState(6);
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    void fetch(VOCABULARY_BASELINE_URL, {
      signal: controller.signal,
      cache: "force-cache",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Vocabulary baseline: HTTP ${response.status}`);
        const frequencies = parseVocabularyBaseline(await response.text());
        if (!disposed) setBaseline(frequencies);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setError(error instanceof Error ? error.message : String(error));
          setDistinctive(false);
          setBaseline(new Map());
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (!baseline || !status.words) return <p>{t("speechVocabularyLoading")}</p>;
  const total = status.totals.user + status.totals.assistant;
  const ranked = rankVocabulary(
    status.words,
    total,
    baseline,
    minimum,
    distinctive,
  );
  const displayed = ranked.slice(0, 18);
  const unknown = distinctive
    ? rankVocabulary(status.words, total, baseline, minimum, false)
        .filter((word) => word.ratio === undefined)
        .slice(0, 8)
    : [];
  const active = [...displayed, ...unknown].find(
    (word) => word.word === selected,
  );
  const maximum = Math.max(1, ...displayed.map((word) => word.count));
  const description = (word: (typeof ranked)[number]) =>
    t("speechVocabularyWordDetail", {
      word: word.word,
      count: word.count,
      user: word.user,
      assistant: word.assistant,
    }) +
    " · " +
    (word.ratio === undefined
      ? t("speechVocabularyOutsideBaseline")
      : t("speechVocabularyRatio", { ratio: word.ratio.toFixed(1) }));

  return (
    <div className={styles.chart}>
      {error && (
        <p role="alert">
          {t("speechVocabularyBaselineError")} {error}
        </p>
      )}
      <div className={styles.controls}>
        <label>
          {t("speechVocabularyView")}
          <select
            value={distinctive ? "distinctive" : "frequent"}
            onChange={(event) =>
              setDistinctive(event.target.value === "distinctive")
            }
          >
            <option value="distinctive" disabled={!!error}>
              {t("speechVocabularyDistinctive")}
            </option>
            <option value="frequent">{t("speechVocabularyFrequent")}</option>
          </select>
        </label>
        <label>
          {t("speechVocabularyMinimum")}
          <input
            type="number"
            min="1"
            max="1000000"
            value={minimum}
            onChange={(event) =>
              setMinimum(
                Math.max(1, Math.min(1000000, Number(event.target.value) || 1)),
              )
            }
          />
        </label>
      </div>
      <p>{t("speechVocabularyChartGuide")}</p>
      <p className={styles.detail} aria-live="polite">
        {active ? description(active) : t("speechVocabularySelectWord")}
      </p>
      <div className={styles.bubbles} aria-label={t("speechVocabularyView")}>
        {displayed.map((word) => (
          <button
            type="button"
            key={word.word}
            className={styles.bubble}
            aria-label={description(word)}
            aria-pressed={selected === word.word}
            onClick={() => setSelected(word.word)}
            onFocus={() => setSelected(word.word)}
            title={description(word)}
            style={{
              width: 76 + 56 * Math.sqrt(word.count / maximum),
              height: 76 + 56 * Math.sqrt(word.count / maximum),
              borderColor: `hsl(${205 + (85 * word.assistant) / word.count} 65% 60%)`,
              backgroundColor: `hsl(${205 + (85 * word.assistant) / word.count} 65% 60% / 0.08)`,
            }}
          >
            <strong>{word.word}</strong>
            <span>{word.count.toLocaleString()}</span>
          </button>
        ))}
      </div>
      {displayed.length === 0 && <p>{t("speechVocabularyNoWords")}</p>}
      {unknown.length > 0 && (
        <div className={styles.unknown}>
          <p>{t("speechVocabularyOutsideBaseline")}</p>
          {unknown.map((word) => (
            <button
              type="button"
              key={word.word}
              aria-label={description(word)}
              aria-pressed={selected === word.word}
              onFocus={() => setSelected(word.word)}
              onClick={() => setSelected(word.word)}
            >
              {word.word} · {word.count.toLocaleString()}
            </button>
          ))}
        </div>
      )}
      <p>
        {t("speechVocabularyBaselineNote", { candidates: status.words.length })}{" "}
        <a
          href="https://github.com/hermitdave/FrequencyWords"
          target="_blank"
          rel="noreferrer"
        >
          FrequencyWords / OpenSubtitles 2018
        </a>
        {" · "}
        <a
          href="https://creativecommons.org/licenses/by-sa/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY-SA 4.0
        </a>
      </p>
    </div>
  );
}
