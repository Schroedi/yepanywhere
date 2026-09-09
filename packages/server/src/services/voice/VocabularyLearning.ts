import { setImmediate as yieldToLoop } from "node:timers/promises";
import type { SpeechVocabularyStatus } from "@yep-anywhere/shared";
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

export class VocabularyLearning {
  private work?: Promise<void>;
  private epoch = 0;
  private closed = false;
  private requested = false;
  private retrospective = false;
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
  ) {}

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
      for await (const session of this.sessions(cutoff)) {
        if (!active()) break;
        if (
          session.updatedAt < cutoff ||
          this.store.hasScanned(session.key, session.version, cutoff)
        )
          continue;
        this.store.beginSession();
        for await (const page of session.messages()) {
          if (!active()) break;
          const batch: VocabularyMessage[] = [];
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
            batch.push({ source: message.type, timestamp, text });
            this.progress.messages++;
            if (batch.length === 32) {
              this.store.stage(session.key, batch, generation);
              batch.length = 0;
              await yieldToLoop();
            }
          }
          if (active()) this.store.stage(session.key, batch, generation);
          await yieldToLoop();
        }
        if (!active()) break;
        this.store.commitSession(
          session.key,
          session.version,
          cutoff,
          generation,
        );
        this.progress.sessions++;
        await yieldToLoop();
      }
      this.progress.state = "idle";
    } catch (error) {
      if (!active()) return;
      this.requested = false;
      this.progress.state = "error";
      this.progress.error =
        error instanceof Error ? error.message : String(error);
    }
  }

  reset(): void {
    this.epoch++;
    this.requested = false;
    this.retrospective = false;
    this.store.reset();
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
    this.store.close();
  }
}
