import { setImmediate as yieldToLoop } from "node:timers/promises";
import {
  VOCABULARY_FLUSH_COUNTS,
  type SpeechVocabularyStatus,
} from "@yep-anywhere/shared";
import { getLogger } from "../../logging/logger.js";
import type { Message } from "../../supervisor/types.js";
import type {
  VocabularyStore,
  VocabularySettings,
  VocabularyMessage,
} from "./VocabularyStore.js";

export interface VocabularySession {
  key: string;
  version: string;
  updatedAt: number;
  messages: () => AsyncIterable<readonly Message[]>;
}

const MESSAGE_BURST = 16;

/** Shortest interval between two relearns of a full fingerprint filter. */
const RELEARN_COOLDOWN_MS = 24 * 3600_000;

export class VocabularyLearning {
  private work?: Promise<void>;
  private epoch = 0;
  private closed = false;
  private requested = false;
  private retrospective = false;
  private relearnAfter = 0;
  private readonly flushAfter: number;
  private readonly reference?: () => Promise<ReadonlyMap<string, number>>;
  private progress = {
    state: "idle" as "idle" | "scanning" | "error",
    sessions: 0,
    messages: 0,
    error: undefined as string | undefined,
  };

  constructor(
    readonly store: VocabularyStore,
    private readonly sessions: (
      cutoff: number,
    ) => AsyncIterable<VocabularySession>,
    options: {
      reference?: () => Promise<ReadonlyMap<string, number>>;
      flushAfter?: number;
    } = {},
  ) {
    this.reference = options.reference;
    this.flushAfter = options.flushAfter ?? VOCABULARY_FLUSH_COUNTS;
  }

  status(includeWords = false): SpeechVocabularyStatus {
    return {
      ...this.store.settings(),
      totals: this.store.totals(),
      ...(includeWords ? { words: this.store.words() } : {}),
      scan: { ...this.progress },
      integration: "grok-via-ya" as const,
    };
  }

  configure(settings: Omit<VocabularySettings, "generation">): void {
    const wasEnabled = this.store.settings().enabled;
    this.store.configure(settings);
    if (!settings.enabled) {
      this.epoch++;
      this.requested = false;
      this.store.discardPending();
    } else if (!wasEnabled) this.scan();
  }

  scan(retrospective = true): void {
    if (this.closed || !this.store.settings().enabled) return;
    this.requested = true;
    this.retrospective ||= retrospective;
    if (this.work) return;
    this.work = this.run().finally(() => {
      this.work = undefined;
      if (this.requested) this.scan(false);
    });
  }

  private async run(): Promise<void> {
    this.requested = false;
    const epoch = this.epoch;
    const { generation, hours } = this.store.settings();
    const requestedCutoff = Date.now() - hours * 3600_000;
    const cutoff = this.retrospective
      ? requestedCutoff
      : this.store.automaticCutoff(requestedCutoff);
    this.retrospective = false;
    const active = () =>
      !this.closed && epoch === this.epoch && this.store.accepts(generation);
    this.progress = {
      state: "scanning",
      sessions: 0,
      messages: 0,
      error: undefined,
    };
    try {
      await this.store.load();
      if (this.reference) this.store.setReference(await this.reference());
      if (!active()) return;
      let burst = 0;
      for await (const session of this.sessions(cutoff)) {
        if (!active()) break;
        if (
          session.updatedAt < cutoff ||
          this.store.hasScanned(session.key, session.version, cutoff)
        )
          continue;
        for await (const page of session.messages()) {
          if (!active()) break;
          for (const message of page) {
            if (!active()) break;
            const timestamp = Date.parse(message.timestamp ?? "");
            if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;
            if (message.type !== "user" && message.type !== "assistant")
              continue;
            if (message.isMeta || message.isCompactSummary) continue;
            const content = message.message?.content ?? message.content;
            const text =
              typeof content === "string"
                ? content
                : Array.isArray(content)
                  ? content
                      .filter(
                        (block) =>
                          block?.type === "text" &&
                          typeof block.text === "string",
                      )
                      .map((block) => block.text)
                      .join("\n")
                  : "";
            this.store.observe(
              session.key,
              {
                source: message.type,
                timestamp,
                text,
              } satisfies VocabularyMessage,
              generation,
            );
            this.progress.messages++;
            burst++;
            if (this.store.pendingCount >= this.flushAfter)
              await this.store.flush();
            if (burst >= MESSAGE_BURST) {
              burst = 0;
              await yieldToLoop();
            }
          }
        }
        if (!active()) break;
        this.store.checkpoint(session.key, session.version, cutoff);
        this.progress.sessions++;
        await yieldToLoop();
      }
      // A scan runs whenever the catalog republishes, which live sessions do
      // every few seconds. One that observed nothing new must cost nothing:
      // no rewritten rows, no rebuilt ranking, no new revision.
      if (this.store.settings().enabled && active()) {
        if (!this.store.idle) await this.store.flush();
      } else this.store.discardPending();
      if (active()) this.progress.state = "idle";
      if (
        this.store.seenSaturated &&
        active() &&
        Date.now() >= this.relearnAfter
      )
        await this.makeRoom();
    } catch (error) {
      this.store.discardPending();
      if (!active()) return;
      this.requested = false;
      this.progress.state = "error";
      this.progress.error =
        error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * The fingerprint filter is full, so it can no longer tell new text from old
   * reliably. Empty it and everything counted through it, then relearn the
   * retained window from provider history — the counts outside that window are
   * not recoverable by rescanning anyway.
   *
   * The cooldown matters: a retained window whose messages cannot fit the
   * reservation fills the filter again as soon as it is relearned. Backing off
   * leaves recognition working against a filter that dedupes approximately,
   * which is the mild failure; rescanning in a loop is not.
   */
  private async makeRoom(): Promise<void> {
    this.relearnAfter = Date.now() + RELEARN_COOLDOWN_MS;
    getLogger().warn(
      { component: "speech" },
      "Speech vocabulary fingerprint filter is full; relearning the retained window",
    );
    await this.store.relearn();
    this.scan(true);
  }

  async reset(): Promise<void> {
    this.epoch++;
    this.requested = false;
    this.retrospective = false;
    await this.store.reset();
    this.progress = {
      state: "idle",
      sessions: 0,
      messages: 0,
      error: undefined,
    };
  }

  async settled(): Promise<void> {
    while (this.work) await this.work;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.epoch++;
    this.requested = false;
    await this.settled();
    if (this.store.settings().enabled && !this.store.idle)
      await this.store.flush();
    else this.store.discardPending();
    await this.store.close();
  }
}
