// Hermit Dave's OpenSubtitles 2018 English counts, CC BY-SA 4.0.
// Pinned reference fetched on demand; no learned text is sent.
export const VOCABULARY_BASELINE_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/en/en_50k.txt";

export const MAX_SPEECH_SESSION_TERMS = 10000;

export function speechVocabularyTokens(text: string): string[] {
  return [
    ...text
      .normalize("NFKC")
      .matchAll(/[\p{L}\p{N}]+(?:['_’.-][\p{L}\p{N}]+)*/gu),
  ]
    .map(([word]) => word.toLowerCase().replaceAll("’", "'"))
    .filter((word) => /\p{L}/u.test(word) && word.length <= 100);
}

export function parseVocabularyBaseline(
  text: string,
): ReadonlyMap<string, number> {
  if (text.length > 2_000_000)
    throw new Error("Vocabulary baseline exceeds its size limit");
  const counts = new Map<string, number>();
  let total = 0;
  for (const line of text.trim().split("\n")) {
    const match = /^(\S+) ([1-9][0-9]*)\r?$/.exec(line);
    if (!match) throw new Error("Invalid vocabulary baseline row");
    const word = match[1]!;
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || counts.has(word))
      throw new Error("Invalid vocabulary baseline count or duplicate word");
    counts.set(word, count);
    if (counts.size > 50000)
      throw new Error("Vocabulary baseline exceeds its row limit");
    total += count;
  }
  if (!Number.isSafeInteger(total) || total === 0)
    throw new Error("Invalid vocabulary baseline total");
  return new Map([...counts].map(([word, count]) => [word, count / total]));
}

export function rankVocabulary(
  words: SpeechVocabularyWord[],
  total: number,
  baseline: ReadonlyMap<string, number>,
  minimum: number,
  distinctive: boolean,
  includeUnlisted = false,
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
        score: (count - (expected ?? 0)) / Math.sqrt((expected ?? 0) + 1),
      };
    })
    .filter(
      (word) =>
        !distinctive ||
        (word.score > 0 && (includeUnlisted || word.ratio !== undefined)),
    )
    .sort(
      (a, b) =>
        (distinctive ? b.score - a.score : b.count - a.count) ||
        a.word.localeCompare(b.word),
    );
}

export interface SpeechVocabularyWord {
  word: string;
  user: number;
  assistant: number;
}

export interface SpeechVocabularyStatus {
  generation: number;
  enabled: boolean;
  biasing: boolean;
  hours: number;
  totals: { words: number; user: number; assistant: number };
  /** Present only when the lexicon view requests includeWords=1; at most 2000. */
  words?: SpeechVocabularyWord[];
  scan: {
    state: "idle" | "scanning" | "error";
    sessions: number;
    messages: number;
    error?: string;
  };
  integration: "grok-via-ya";
}
