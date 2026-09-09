// Hermit Dave's OpenSubtitles 2018 English counts, CC BY-SA 4.0.
// Pinned reference fetched only when the lexicon is opened; no learned text is sent.
export const VOCABULARY_BASELINE_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/en/en_50k.txt";

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
