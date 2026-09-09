import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  parseVocabularyBaseline,
  VOCABULARY_BASELINE_URL,
} from "@yep-anywhere/shared";
import { getLogger } from "../../logging/logger.js";
import type { VocabularyStore } from "./VocabularyStore.js";

const MAX_BYTES = 2_000_000;
const IDLE_MS = 30 * 60_000;
const RETRY_MS = 60_000;
const CACHE_NAME =
  "speech-english-525f9b560de45753a5ea01069454e72e9aa541c6.txt";

export class VocabularyKeyterms {
  private baseline?: ReadonlyMap<string, number>;
  private loading?: Promise<ReadonlyMap<string, number>>;
  private eviction?: ReturnType<typeof setTimeout>;
  private readonly abort = new AbortController();
  private retryAfter = 0;
  private readonly selected = new Map<
    string,
    { revision: number; terms: string[] }
  >();

  constructor(
    private readonly store: VocabularyStore,
    private readonly dataDir: string,
  ) {}

  async get(sessionTerms: readonly string[] = []): Promise<string[]> {
    if (this.abort.signal.aborted || !this.store.settings().biasing) return [];
    const generation = this.store.settings().generation;
    const active = new Set(sessionTerms);
    const cacheKey = createHash("sha256")
      .update(JSON.stringify([...active].sort()))
      .digest("hex");
    const selected = this.selected.get(cacheKey);
    if (selected?.revision === this.store.revision) {
      this.renewEviction();
      this.selected.delete(cacheKey);
      this.selected.set(cacheKey, selected);
      return selected.terms;
    }
    if (Date.now() < this.retryAfter) return [];
    try {
      if (!this.baseline) {
        this.loading ??= this.load().finally(() => {
          this.loading = undefined;
        });
        const baseline = await this.loading;
        if (this.abort.signal.aborted) return [];
        this.baseline = baseline;
      }
    } catch (error) {
      // Reference failure must not prevent ordinary dictation. Retry on demand.
      if (!this.abort.signal.aborted && Date.now() >= this.retryAfter) {
        this.retryAfter = Date.now() + RETRY_MS;
        getLogger().warn(
          { component: "speech", err: error },
          "English vocabulary reference unavailable; omitting learned keyterms for one minute",
        );
      }
      return [];
    }
    this.renewEviction();
    const settings = this.store.settings();
    if (settings.generation !== generation || !settings.biasing) return [];
    const terms = this.store.keyterms(this.baseline, 100, 50, active);
    this.selected.delete(cacheKey);
    this.selected.set(cacheKey, { revision: this.store.revision, terms });
    if (this.selected.size > 16)
      this.selected.delete(this.selected.keys().next().value!);
    return terms;
  }

  private renewEviction(): void {
    clearTimeout(this.eviction);
    if (!this.baseline) return;
    this.eviction = setTimeout(() => {
      this.baseline = undefined;
    }, IDLE_MS);
    this.eviction.unref();
  }

  private async load(): Promise<ReadonlyMap<string, number>> {
    const path = join(this.dataDir, CACHE_NAME);
    try {
      if ((await stat(path)).size > MAX_BYTES)
        throw new Error("Vocabulary baseline exceeds its size limit");
      return parseVocabularyBaseline(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const response = await fetch(VOCABULARY_BASELINE_URL, {
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Vocabulary baseline: HTTP ${response.status}`);
    }
    if (!response.body)
      throw new Error("Vocabulary baseline response has no body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES)
          throw new Error("Vocabulary baseline exceeds its size limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const baseline = parseVocabularyBaseline(text);
    this.abort.signal.throwIfAborted();
    await mkdir(this.dataDir, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text, { flag: "wx" });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return baseline;
  }

  async close(): Promise<void> {
    this.abort.abort();
    clearTimeout(this.eviction);
    this.baseline = undefined;
    this.selected.clear();
    await this.loading?.catch(() => {});
  }
}
