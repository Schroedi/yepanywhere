import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import {
  commonVocabularyWords,
  hasInteriorCapital,
  observeVocabularyCase,
  projectVocabularyCase,
  speechVocabularyOccurrences,
  type VocabularyCaseForms,
  vocabularyFrequency,
  VOCABULARY_FLUSH_COUNTS,
} from "@yep-anywhere/shared";
import { createCoalescingSaver } from "../../lib/coalescingSaver.js";
import {
  parseByteSize,
  reserveScratchSpace,
  type ScratchSpace,
} from "../../lib/scratchSpace.js";
import { getLogger } from "../../logging/logger.js";
import { BlockedBloom, BloomFile } from "./blocked-bloom.js";
import { DistinctiveTop, distinctiveScore } from "./distinctive-top.js";
import { VocabularyDatabase } from "./vocabulary-database.js";

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

/**
 * Ceiling on the share of selected terms that are capitalized spellings of
 * common words. Case is not meaning-carrying, and a spoken acronym is usually
 * transcribed correctly anyway, so these must not crowd out real jargon.
 */
const ESCAPE_SHARE = 0.2;

/** Settings only; the learned table lives on local disk. */
const STATE_FILE = "speech-vocabulary-state.json";
const DATABASE_FILE = "speech-vocabulary.sqlite";
const SEEN_FILE = "speech-seen.bloom";
const SCRATCH_PURPOSE = "speech-vocabulary";

/** Files the earlier whole-table-rewrite layout left in the data directory. */
const LEGACY_WORDS_FILE = "speech-words.json";
const LEGACY_CASE_FILE = "speech-word-case.json";
const LEGACY_SEEN_FILE = "speech-seen.hash";

/**
 * Room reserved for the fingerprint filter. At eight bits per key this holds
 * well over a hundred million distinct messages, which is years of heavy use;
 * `YEP_SPEECH_VOCABULARY_BYTES` moves it for a machine that wants less.
 */
const DEFAULT_SEEN_BYTES = 256 * 1024 * 1024;
const MINIMUM_SEEN_BYTES = 1024 * 1024;

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
}

export interface VocabularyStoreOptions {
  /** Overrides the local-disk reservation; tests point this at a temp dir. */
  scratchDir?: string;
  /** Overrides the fingerprint filter's size. */
  seenBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export class VocabularyStore {
  private wordsRevision = 0;
  private ignored: ReadonlySet<string> = new Set();
  private baseline: ReadonlyMap<string, number> | undefined;
  private baselineFloor: number | undefined;
  private readonly wordCounts = new Map<string, Counts>();
  /** Only words written with a capital somewhere; the rest project to the key. */
  private readonly caseForms = new Map<string, VocabularyCaseForms>();
  private readonly top = new DistinctiveTop(500);
  private readonly sessionTops = new Map<string, DistinctiveTop>();
  private readonly pendingWords = new Map<string, Counts>();
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
  /** Rows whose stored value no longer matches memory. */
  private dirtyWords = new Set<string>();
  private dirtyForms = new Set<string>();
  private dirtyCheckpoints = new Set<string>();
  private state: PersistedState = {
    generation: 0,
    enabled: false,
    biasing: false,
    hours: 24,
    resetAfter: 0,
  };
  private loaded = false;
  private readonly scratch: ScratchSpace;
  private readonly seenBytes: number;
  private seen: BlockedBloom | undefined;
  private seenFile: BloomFile | undefined;
  private database: VocabularyDatabase | undefined;
  private readonly saver = createCoalescingSaver(() => this.persist());

  get revision(): number {
    return this.wordsRevision;
  }

  get pendingCount(): number {
    return this.pendingTokens;
  }

  /** Nothing new to merge or record: a flush would rewrite the same answer. */
  get idle(): boolean {
    return this.pendingWords.size === 0 && this.pendingCheckpoints.length === 0;
  }

  /**
   * The filter is past its design load, so its false-positive rate is rising.
   * Recovering means emptying it and relearning the retained window.
   */
  get seenSaturated(): boolean {
    return this.seen?.saturated ?? false;
  }

  /**
   * The fingerprint filter, allocated on first use. A server whose owner never
   * turned learning on pays nothing for the reservation.
   */
  private get filter(): BlockedBloom {
    this.seen ??= new BlockedBloom(this.seenBytes);
    return this.seen;
  }

  constructor(
    private readonly dataDir: string,
    options: VocabularyStoreOptions = {},
  ) {
    const env = options.env ?? process.env;
    const requested =
      options.seenBytes ??
      parseByteSize(env.YEP_SPEECH_VOCABULARY_BYTES, DEFAULT_SEEN_BYTES);
    this.scratch = options.scratchDir
      ? {
          dir: options.scratchDir,
          bytes: requested,
          requested,
          degraded: false,
          reason: `${options.scratchDir} (caller supplied)`,
        }
      : reserveScratchSpace({
          purpose: SCRATCH_PURPOSE,
          bytes: requested,
          dataDir,
          minimumBytes: MINIMUM_SEEN_BYTES,
          env,
        });
    // An explicit size is taken as given; a size the disk cut down still gets
    // a floor, since a filter of a few kilobytes would dedupe nothing.
    this.seenBytes =
      options.seenBytes ?? Math.max(MINIMUM_SEEN_BYTES, this.scratch.bytes);
    this.loadState();
    this.openTable();
  }

  private get statePath(): string {
    return join(this.dataDir, STATE_FILE);
  }

  private get databasePath(): string {
    return join(this.scratch.dir, DATABASE_FILE);
  }

  private get seenPath(): string {
    return join(this.scratch.dir, SEEN_FILE);
  }

  /**
   * Settings are the only thing read before the feature is used, and the only
   * thing here that a rescan cannot rebuild, so they stay small, JSON, and in
   * the data directory. An unreadable file reverts to defaults rather than
   * failing construction: the alternative is a server that will not start
   * because an optional feature's preferences were half-written.
   */
  private loadState(): void {
    let raw: Partial<PersistedState> & {
      sessions?: Record<string, { version: string; cutoff: number }>;
    };
    try {
      raw = JSON.parse(readFileSync(this.statePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        getLogger().warn(
          { component: "speech", err: error },
          "Speech vocabulary settings unreadable; using defaults",
        );
      return;
    }
    this.state = {
      generation: Number(raw.generation ?? 0),
      enabled: raw.enabled === true,
      biasing: raw.biasing === true,
      hours: Number(raw.hours ?? 24),
      resetAfter: Number(raw.resetAfter ?? 0),
    };
    // Checkpoints used to share this file. Keep them until the table adopts
    // them, so an upgrade does not rescan every session.
    for (const [key, session] of Object.entries(raw.sessions ?? {})) {
      this.sessions.set(key, session);
      this.dirtyCheckpoints.add(key);
    }
  }

  private writeState(): void {
    const temporary = `${this.statePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state));
    renameSync(temporary, this.statePath);
  }

  setIgnoredWords(words: ReadonlySet<string>): void {
    this.ignored = words;
  }

  setReference(baseline: ReadonlyMap<string, number>): void {
    // Every scan run offers the same cached reference. Rebuilding the ranking
    // for an unchanged one is pure waste on a server that rescans often.
    if (this.baseline === baseline) return;
    this.baseline = baseline;
    this.ignored = commonVocabularyWords(baseline);
    let floor = Number.POSITIVE_INFINITY;
    for (const frequency of baseline.values())
      if (frequency < floor) floor = frequency;
    this.baselineFloor = Number.isFinite(floor) ? floor : undefined;
    this.rebuildTop();
  }

  addWordCounts(word: string, user: number, assistant: number): void {
    if (user) addDelta(this.wordCounts, word, "user", user);
    if (assistant) addDelta(this.wordCounts, word, "assistant", assistant);
    this.userTotal += user;
    this.assistantTotal += assistant;
    this.dirtyWords.add(word);
    this.considerWord(word);
  }

  private userTotal = 0;
  private assistantTotal = 0;

  private tokenTotal(): number {
    return this.userTotal + this.assistantTotal;
  }

  private frequency(word: string): number | undefined {
    if (!this.baseline) return undefined;
    // A capitalized spelling of a common word is its own term, but treating it
    // as never-seen English would let every shouted word outrank real jargon.
    // Charge it the rarest listed frequency instead of nothing.
    if (word !== word.toLowerCase()) return this.baselineFloor;
    return vocabularyFrequency(this.baseline, word);
  }

  private rebuildTop(): void {
    this.top.rebuild(
      this.mergedWords(),
      this.tokenTotal(),
      (word) => this.frequency(word),
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
      this.frequency(word),
    );
    this.top.consider(word, score);
    return score;
  }

  /**
   * Read the learned table into memory. Counts answer exploration and ranking
   * from memory from that point on, so nothing on those paths waits for disk.
   * Synchronous because a server that has the table must be able to report
   * totals before any scan runs.
   */
  private openTable(): void {
    try {
      mkdirSync(this.scratch.dir, { recursive: true });
      this.database = VocabularyDatabase.open(this.databasePath);
    } catch (error) {
      // Losing the table costs relearning, not correctness. Refusing to run
      // would take recognition biasing down with it.
      getLogger().warn(
        { component: "speech", err: error, path: this.databasePath },
        "Speech vocabulary table unavailable; learning stays in memory",
      );
      return;
    }
    if (!this.database) return;
    for (const row of this.database.words()) {
      this.wordCounts.set(row.word, {
        user: row.user,
        assistant: row.assistant,
      });
      this.userTotal += row.user;
      this.assistantTotal += row.assistant;
    }
    for (const [word, forms] of this.database.forms())
      this.caseForms.set(word, forms);
    for (const row of this.database.checkpoints())
      if (!this.sessions.has(row.key))
        this.sessions.set(row.key, {
          version: row.version,
          cutoff: row.cutoff,
        });
    if (this.wordCounts.size === 0) this.adoptLegacyFiles();
  }

  /**
   * Attach the fingerprint filter. Deferred until a scan needs it, because the
   * reservation is large and a server whose owner never turned learning on
   * should not pay for it.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    this.seenFile = new BloomFile(this.seenPath, this.filter);
    await this.seenFile.load();
    getLogger().info(
      {
        component: "speech",
        scratch: this.scratch.reason,
        seenBytes: this.seenBytes,
        seenCount: this.filter.count,
        words: this.wordCounts.size,
      },
      "Speech vocabulary table ready",
    );
    this.rebuildTop();
    await yieldToLoop();
  }

  /**
   * Adopt the previous layout's whole-file snapshots once, then delete them.
   * They were rewritten in full on every flush, which is what moving to a table
   * on local disk fixes; their contents are still the user's learned words.
   */
  private adoptLegacyFiles(): void {
    const counts = readJsonFile<Record<string, [number, number]>>(
      join(this.dataDir, LEGACY_WORDS_FILE),
    );
    for (const [word, pair] of Object.entries(counts ?? {})) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      this.addWordCounts(word, Number(pair[0]), Number(pair[1]));
    }
    const forms = readJsonFile<Record<string, VocabularyCaseForms>>(
      join(this.dataDir, LEGACY_CASE_FILE),
    );
    for (const [word, entry] of Object.entries(forms ?? {}))
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        this.caseForms.set(word, entry);
        this.dirtyForms.add(word);
      }
    for (const name of [
      LEGACY_WORDS_FILE,
      LEGACY_CASE_FILE,
      LEGACY_SEEN_FILE,
    ]) {
      try {
        unlinkSync(join(this.dataDir, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (this.dirtyWords.size > 0 || this.dirtyForms.size > 0) this.save();
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
    this.writeState();
  }

  totals() {
    const merged = this.mergedWords();
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
    return [...this.mergedWords()]
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
    if (!this.filter.add(fingerprint)) return 0;
    const counts = new Map<string, number>();
    for (const { word, surface, forced } of speechVocabularyOccurrences(
      message.text,
    )) {
      this.recordCase(word, surface, forced);
      // A common English word written with an interior capital is a different
      // term — YA, HEAD, OK — and earns its own key past the common-word block.
      let key: string | undefined = word;
      if (this.ignored.has(word))
        key = hasInteriorCapital(surface) ? surface : undefined;
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
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

  private recordCase(word: string, surface: string, forced: boolean): void {
    const forms = this.caseForms.get(word);
    if (forms) {
      observeVocabularyCase(forms, surface, forced);
      this.dirtyForms.add(word);
      return;
    }
    if (surface === word) return;
    // First capital for a word already counted in lowercase: credit the earlier
    // occurrences to the lowercase spelling rather than let one capital win.
    const seeded: VocabularyCaseForms = {};
    const counts = this.countsOf(word);
    const lowercase = counts.user + counts.assistant;
    if (lowercase > 0) seeded[word] = [lowercase, 0];
    observeVocabularyCase(seeded, surface, forced);
    this.caseForms.set(word, seeded);
    this.dirtyForms.add(word);
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

  /**
   * Commit what the scan observed to memory and hand the changed rows to the
   * writer. This does not wait for disk: the scan is producing text on the same
   * loop the server serves from, and the table it writes is regenerable.
   */
  async flush(): Promise<void> {
    if (this.idle && this.clean) return;
    for (const [word, delta] of this.pendingWords) {
      addDelta(this.wordCounts, word, "user", delta.user);
      addDelta(this.wordCounts, word, "assistant", delta.assistant);
      this.dirtyWords.add(word);
    }
    this.pendingWords.clear();
    this.pendingTokens = 0;
    for (const checkpoint of this.pendingCheckpoints) {
      this.sessions.set(checkpoint.key, {
        version: checkpoint.version,
        cutoff: checkpoint.cutoff,
      });
      this.dirtyCheckpoints.add(checkpoint.key);
    }
    this.pendingCheckpoints = [];
    this.save();
    this.rebuildTop();
    this.wordsRevision++;
    await yieldToLoop();
  }

  /** Nothing in memory differs from what the table and the filter hold. */
  private get clean(): boolean {
    return (
      this.dirtyWords.size === 0 &&
      this.dirtyForms.size === 0 &&
      this.dirtyCheckpoints.size === 0 &&
      (this.seen?.pendingWrites ?? 0) === 0
    );
  }

  private save(): void {
    if (this.clean) return;
    void this.saver.save().catch((error: unknown) => {
      getLogger().warn(
        { component: "speech", err: error },
        "Speech vocabulary table write failed; retrying on the next flush",
      );
    });
  }

  /** Writer body. Runs one at a time, coalescing whatever arrived meanwhile. */
  private async persist(): Promise<void> {
    const words = [...this.dirtyWords];
    const forms = new Map<string, VocabularyCaseForms>();
    for (const word of this.dirtyForms) {
      const entry = this.caseForms.get(word);
      if (entry) forms.set(word, entry);
    }
    const checkpoints = [...this.dirtyCheckpoints];
    this.dirtyWords = new Set();
    this.dirtyForms = new Set();
    this.dirtyCheckpoints = new Set();
    try {
      // Counts before fingerprints: a crash between them re-observes messages
      // the filter forgot, which the session checkpoint already covers. The
      // reverse order would drop counted text with no way to notice.
      await this.database?.commit({
        words: words.map((word) => ({
          word,
          user: this.wordCounts.get(word)?.user ?? 0,
          assistant: this.wordCounts.get(word)?.assistant ?? 0,
        })),
        forms,
        checkpoints: checkpoints.flatMap((key) => {
          const row = this.sessions.get(key);
          return row ? [{ key, version: row.version, cutoff: row.cutoff }] : [];
        }),
      });
      await this.seenFile?.persist();
    } catch (error) {
      for (const word of words) this.dirtyWords.add(word);
      for (const word of forms.keys()) this.dirtyForms.add(word);
      for (const key of checkpoints) this.dirtyCheckpoints.add(key);
      throw error;
    }
  }

  /** Wait for the writer to go quiet. Tests and shutdown, never the scan. */
  async settled(): Promise<void> {
    await this.saver.idle();
  }

  async reset(): Promise<void> {
    this.discardPending();
    this.wordCounts.clear();
    this.caseForms.clear();
    this.top.clear();
    this.sessionTops.clear();
    this.userTotal = 0;
    this.assistantTotal = 0;
    this.sessions.clear();
    this.dirtyWords = new Set();
    this.dirtyForms = new Set();
    this.dirtyCheckpoints = new Set();
    this.state.generation++;
    this.state.resetAfter = Date.now();
    this.writeState();
    await this.saver.idle();
    this.database?.clear();
    // Discard the filter itself rather than empty it. Reset can arrive before
    // any scan attached the file, and a surviving file would tell the relearn
    // that every message it re-reads has already been counted.
    this.loaded = false;
    await this.seenFile?.close();
    this.seenFile = undefined;
    this.seen = undefined;
    await rm(this.seenPath, { force: true });
    this.wordsRevision++;
  }

  /**
   * Empty the fingerprint filter and everything derived from it, keeping the
   * settings and the reset generation. The caller follows with a retrospective
   * scan, which relearns the retained window into a filter that is no longer
   * over its design load.
   */
  async relearn(): Promise<void> {
    const previous = this.state.resetAfter;
    await this.reset();
    // A reset blocks automatic scans from reaching older history; this one is
    // making room, not discarding history, so the window stays as it was.
    this.state.resetAfter = previous;
    this.writeState();
  }

  /**
   * A capitalized spelling of a common English word stands only while writing
   * still prefers it: "YA" survives, an occasional shouted "NOT" does not.
   */
  private spelled(word: string): boolean {
    const key = word.toLowerCase();
    return (
      key === word ||
      projectVocabularyCase(key, this.caseForms.get(key)) === word
    );
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
      ranked.set(
        term,
        distinctiveScore(count, total, vocabularyFrequency(baseline, term)) * 5,
      );
    }
    const candidates = [...ranked]
      .filter(
        ([word, score]) =>
          score > 0 &&
          word.length <= maxLength &&
          !this.ignored.has(word) &&
          this.spelled(word),
      )
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const selected: string[] = [];
    let escapes = Math.ceil(limit * ESCAPE_SHARE);
    for (const [word] of candidates) {
      if (selected.length >= limit) break;
      if (word !== word.toLowerCase() && escapes-- <= 0) continue;
      selected.push(projectVocabularyCase(word, this.caseForms.get(word)));
    }
    return selected;
  }

  async close(): Promise<void> {
    await this.saver.idle();
    await this.seenFile?.close();
    this.seenFile = undefined;
    this.database?.close();
    this.database = undefined;
  }
}

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // Absent or unreadable: there is nothing to adopt, and a rescan rebuilds
    // whatever the file held.
    return undefined;
  }
}
