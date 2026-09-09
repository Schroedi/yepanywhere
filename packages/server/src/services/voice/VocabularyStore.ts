import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import {
  commonVocabularyWords,
  speechVocabularyTokens,
  VOCABULARY_FLUSH_COUNTS,
} from "@yep-anywhere/shared";
import { DistinctiveTop, distinctiveScore } from "./distinctive-top.js";
import { FingerprintSet } from "./fingerprint-set.js";

export { VOCABULARY_FLUSH_COUNTS };

export interface VocabularySettings {
  generation: number;
  enabled: boolean;
  biasing: boolean;
  hours: number;
}

export interface VocabularyMessage {
  source: "user" | "assistant";
  timestamp: number;
  text: string;
}

type Counts = { user: number; assistant: number };

const WORDS_FILE = "speech-words.json";
const SEEN_FILE = "speech-seen.hash";
const STATE_FILE = "speech-vocabulary-state.json";

export function vocabularyFingerprint(
  sessionKey: string,
  message: VocabularyMessage,
): Uint8Array {
  return createHash("sha256")
    .update(
      JSON.stringify([
        sessionKey,
        message.source,
        message.timestamp,
        message.text,
      ]),
    )
    .digest();
}

function countWords(
  text: string,
  ignored: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of speechVocabularyTokens(text)) {
    if (ignored.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

function addDelta(
  target: Map<string, Counts>,
  word: string,
  source: "user" | "assistant",
  n: number,
): void {
  const current = target.get(word) ?? { user: 0, assistant: 0 };
  current[source] += n;
  if (current.user === 0 && current.assistant === 0) target.delete(word);
  else target.set(word, current);
}

interface PersistedState {
  generation: number;
  enabled: boolean;
  biasing: boolean;
  hours: number;
  resetAfter: number;
  sessions: Record<string, { version: string; cutoff: number }>;
}

export class VocabularyStore {
  private wordsRevision = 0;
  private ignored: ReadonlySet<string> = new Set();
  private baseline: ReadonlyMap<string, number> | undefined;
  private readonly wordCounts = new Map<string, Counts>();
  private readonly top = new DistinctiveTop(500);
  private readonly sessionTops = new Map<string, DistinctiveTop>();
  private readonly pendingWords = new Map<string, Counts>();
  private readonly seen = new FingerprintSet();
  private readonly sessions = new Map<
    string,
    { version: string; cutoff: number }
  >();
  private pendingCheckpoints: {
    key: string;
    version: string;
    cutoff: number;
  }[] = [];
  private pendingTokens = 0;
  private state: PersistedState = {
    generation: 0,
    enabled: false,
    biasing: false,
    hours: 24,
    resetAfter: 0,
    sessions: {},
  };
  private loaded = false;

  get revision(): number {
    return this.wordsRevision;
  }

  get pendingCount(): number {
    return this.pendingTokens;
  }

  constructor(private readonly dataDir: string) {
    this.loadJson();
  }

  private loadJson(): void {
    try {
      const raw = JSON.parse(
        readFileSync(this.statePath, "utf8"),
      ) as Partial<PersistedState>;
      this.state = {
        generation: Number(raw.generation ?? 0),
        enabled: raw.enabled === true,
        biasing: raw.biasing === true,
        hours: Number(raw.hours ?? 24),
        resetAfter: Number(raw.resetAfter ?? 0),
        sessions: raw.sessions ?? {},
      };
      for (const [key, session] of Object.entries(this.state.sessions))
        this.sessions.set(key, session);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      const raw = JSON.parse(readFileSync(this.wordsPath, "utf8")) as Record<
        string,
        [number, number]
      >;
      for (const [word, pair] of Object.entries(raw)) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const user = Number(pair[0]);
        const assistant = Number(pair[1]);
        this.wordCounts.set(word, { user, assistant });
        this.userTotal += user;
        this.assistantTotal += assistant;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private get wordsPath(): string {
    return join(this.dataDir, WORDS_FILE);
  }

  private get seenPath(): string {
    return join(this.dataDir, SEEN_FILE);
  }

  private get statePath(): string {
    return join(this.dataDir, STATE_FILE);
  }

  setIgnoredWords(words: ReadonlySet<string>): void {
    this.ignored = words;
  }

  setReference(baseline: ReadonlyMap<string, number>): void {
    this.baseline = baseline;
    this.ignored = commonVocabularyWords(baseline);
    this.rebuildTop();
  }

  addWordCounts(word: string, user: number, assistant: number): void {
    if (user) addDelta(this.wordCounts, word, "user", user);
    if (assistant) addDelta(this.wordCounts, word, "assistant", assistant);
    this.userTotal += user;
    this.assistantTotal += assistant;
    this.considerWord(word);
  }

  private userTotal = 0;
  private assistantTotal = 0;

  private tokenTotal(): number {
    return this.userTotal + this.assistantTotal;
  }

  private rebuildTop(): void {
    this.top.rebuild(
      this.mergedWords(),
      this.tokenTotal(),
      (word) => this.baseline?.get(word),
      this.ignored,
    );
  }

  private mergedWords(): Map<string, Counts> {
    const merged = new Map(this.wordCounts);
    for (const [word, delta] of this.pendingWords) {
      addDelta(merged, word, "user", delta.user);
      addDelta(merged, word, "assistant", delta.assistant);
    }
    return merged;
  }

  private countsOf(word: string): Counts {
    const base = this.wordCounts.get(word);
    const pending = this.pendingWords.get(word);
    return {
      user: (base?.user ?? 0) + (pending?.user ?? 0),
      assistant: (base?.assistant ?? 0) + (pending?.assistant ?? 0),
    };
  }

  private considerWord(word: string): number {
    const counts = this.countsOf(word);
    const score = distinctiveScore(
      counts.user + counts.assistant,
      this.tokenTotal(),
      this.baseline?.get(word),
    );
    this.top.consider(word, score);
    return score;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    await this.seen.load(this.seenPath);
    this.loaded = true;
    this.rebuildTop();
    await yieldToLoop();
  }

  settings(): VocabularySettings {
    return {
      generation: this.state.generation,
      enabled: this.state.enabled,
      biasing: this.state.biasing,
      hours: this.state.hours,
    };
  }

  configure(settings: Omit<VocabularySettings, "generation">): void {
    this.state.enabled = settings.enabled;
    this.state.biasing = settings.biasing;
    this.state.hours = settings.hours;
    this.state.sessions = Object.fromEntries(this.sessions);
    writeFileSync(this.statePath, JSON.stringify(this.state));
  }

  totals() {
    const merged = new Map(this.wordCounts);
    for (const [word, delta] of this.pendingWords) {
      addDelta(merged, word, "user", delta.user);
      addDelta(merged, word, "assistant", delta.assistant);
    }
    let user = 0;
    let assistant = 0;
    for (const counts of merged.values()) {
      user += counts.user;
      assistant += counts.assistant;
    }
    return { words: merged.size, user, assistant };
  }

  words(minimum = 1) {
    return this.wordsAbove(minimum);
  }

  wordsAbove(minimum = 1) {
    const merged = new Map(this.wordCounts);
    for (const [word, delta] of this.pendingWords) {
      addDelta(merged, word, "user", delta.user);
      addDelta(merged, word, "assistant", delta.assistant);
    }
    return [...merged]
      .map(([word, counts]) => ({ word, ...counts }))
      .filter((row) => row.user + row.assistant >= minimum)
      .sort(
        (a, b) =>
          b.user + b.assistant - (a.user + a.assistant) ||
          a.word.localeCompare(b.word),
      )
      .slice(0, 2000);
  }

  hasScanned(
    sessionKey: string,
    sourceVersion: string,
    cutoff: number,
  ): boolean {
    const row = this.sessions.get(sessionKey);
    return row?.version === sourceVersion && row.cutoff <= cutoff;
  }

  accepts(generation: number): boolean {
    return this.state.enabled && this.state.generation === generation;
  }

  automaticCutoff(cutoff: number): number {
    return Math.max(cutoff, this.state.resetAfter + 1);
  }

  observe(
    sessionKey: string,
    message: VocabularyMessage,
    generation: number,
  ): number {
    if (!this.accepts(generation)) return 0;
    const fingerprint = vocabularyFingerprint(sessionKey, message);
    if (!this.seen.add(fingerprint)) return 0;
    const counts = countWords(message.text, this.ignored);
    let added = 0;
    for (const [word, n] of counts) {
      added += n;
      addDelta(this.pendingWords, word, message.source, n);
      if (message.source === "user") this.userTotal += n;
      else this.assistantTotal += n;
      const score = this.considerWord(word);
      this.sessionTop(sessionKey).consider(word, score * 5);
    }
    this.pendingTokens += added;
    return added;
  }

  checkpoint(sessionKey: string, version: string, cutoff: number): void {
    this.pendingCheckpoints.push({ key: sessionKey, version, cutoff });
  }

  discardPending(): void {
    for (const delta of this.pendingWords.values()) {
      this.userTotal -= delta.user;
      this.assistantTotal -= delta.assistant;
    }
    this.pendingWords.clear();
    this.pendingCheckpoints = [];
    this.pendingTokens = 0;
  }

  async flush(): Promise<void> {
    for (const [word, delta] of this.pendingWords) {
      addDelta(this.wordCounts, word, "user", delta.user);
      addDelta(this.wordCounts, word, "assistant", delta.assistant);
    }
    this.pendingWords.clear();
    this.pendingTokens = 0;
    for (const checkpoint of this.pendingCheckpoints)
      this.sessions.set(checkpoint.key, {
        version: checkpoint.version,
        cutoff: checkpoint.cutoff,
      });
    this.pendingCheckpoints = [];
    this.state.sessions = Object.fromEntries(this.sessions);
    const payload: Record<string, [number, number]> = {};
    for (const [word, counts] of this.wordCounts)
      payload[word] = [counts.user, counts.assistant];
    await writeFile(this.statePath, JSON.stringify(this.state));
    await yieldToLoop();
    await writeFile(this.wordsPath, JSON.stringify(payload));
    await yieldToLoop();
    await this.seen.persist(this.seenPath);
    this.rebuildTop();
    this.wordsRevision++;
    await yieldToLoop();
  }

  async reset(): Promise<void> {
    this.discardPending();
    this.wordCounts.clear();
    this.top.clear();
    this.sessionTops.clear();
    this.userTotal = 0;
    this.assistantTotal = 0;
    this.sessions.clear();
    this.state.generation++;
    this.state.resetAfter = Date.now();
    this.state.sessions = {};
    await this.seen.clear(this.seenPath);
    await unlink(this.wordsPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await writeFile(this.statePath, JSON.stringify(this.state));
    this.wordsRevision++;
  }

  private sessionTop(sessionKey: string): DistinctiveTop {
    let top = this.sessionTops.get(sessionKey);
    if (!top) {
      top = new DistinctiveTop(100);
      this.sessionTops.set(sessionKey, top);
    }
    return top;
  }

  keyterms(
    baseline: ReadonlyMap<string, number>,
    limit = 100,
    maxLength = 50,
    sessionTerms: ReadonlySet<string> = new Set(),
    sessionKey?: string,
  ): string[] {
    if (!this.state.biasing) return [];
    const total = this.tokenTotal();
    const ranked = new Map(this.top.entries());
    const session = sessionKey ? this.sessionTops.get(sessionKey) : undefined;
    if (session)
      for (const [word, score] of session.entries()) ranked.set(word, score);
    for (const term of sessionTerms) {
      if (this.ignored.has(term) || term.length > maxLength) continue;
      const counts = this.countsOf(term);
      const count = counts.user + counts.assistant;
      if (count <= 0) continue;
      ranked.set(term, distinctiveScore(count, total, baseline.get(term)) * 5);
    }
    return [...ranked]
      .filter(([word]) => word.length <= maxLength && !this.ignored.has(word))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([word]) => word);
  }

  close(): void {}
}
