import { createHash } from "node:crypto";
import type { SqliteDatabase, SqliteStatement } from "../../storage/sqlite.js";

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

// Selection excludes common English function words; the learned map keeps them.
const COMMON_WORDS = new Set(
  "the and that this with from have has had for not are was were you your our they their them will would should could can but into about just then than there here what when where which who how all any some been being its it's also only more very don't does did doing use used using need now please make like want one two get got let let's yes no as at be by do he if in is it me my of on or so to up us we".split(
    " ",
  ),
);

function countWords(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text
    .normalize("NFKC")
    .matchAll(/[\p{L}\p{N}]+(?:['_’.-][\p{L}\p{N}]+)*/gu)) {
    const word = match[0].toLowerCase().replaceAll("’", "'");
    if (!/\p{L}/u.test(word) || word.length > 100) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

export class VocabularyStore {
  private readonly statements = new Map<string, SqliteStatement>();

  constructor(private readonly database: SqliteDatabase) {}

  private sql(query: string): SqliteStatement {
    let statement = this.statements.get(query);
    if (!statement) {
      statement = this.database.prepare(query);
      this.statements.set(query, statement);
    }
    return statement;
  }

  settings(): VocabularySettings {
    const row = this.sql(
      "SELECT * FROM speech_vocabulary_state WHERE id = 1",
    ).get();
    if (!row) throw new Error("Speech vocabulary state is missing");
    return {
      generation: Number(row.generation),
      enabled: row.enabled === 1,
      biasing: row.biasing === 1,
      hours: Number(row.hours),
    };
  }

  configure(settings: Omit<VocabularySettings, "generation">): void {
    this.sql(
      "UPDATE speech_vocabulary_state SET enabled = ?, biasing = ?, hours = ? WHERE id = 1",
    ).run(Number(settings.enabled), Number(settings.biasing), settings.hours);
  }

  totals() {
    const row = this.sql(
      "SELECT COUNT(*) AS words, COALESCE(SUM(user_count), 0) AS user, COALESCE(SUM(assistant_count), 0) AS assistant FROM speech_words",
    ).get();
    return {
      words: Number(row?.words),
      user: Number(row?.user),
      assistant: Number(row?.assistant),
    };
  }

  words() {
    return this.sql(
      "SELECT word, user_count, assistant_count FROM speech_words ORDER BY user_count + assistant_count DESC, word LIMIT 2000",
    )
      .all()
      .map((row) => ({
        word: String(row.word),
        user: Number(row.user_count),
        assistant: Number(row.assistant_count),
      }));
  }

  hasScanned(
    sessionKey: string,
    sourceVersion: string,
    cutoff: number,
  ): boolean {
    const row = this.sql(
      "SELECT source_version, cutoff FROM speech_sessions WHERE session_key = ?",
    ).get(sessionKey);
    return (
      row?.source_version === sourceVersion && Number(row.cutoff) <= cutoff
    );
  }

  accepts(generation: number): boolean {
    const state = this.settings();
    return state.enabled && state.generation === generation;
  }

  automaticCutoff(cutoff: number): number {
    return Math.max(
      cutoff,
      Number(
        this.sql(
          "SELECT reset_after FROM speech_vocabulary_state WHERE id = 1",
        ).get()?.reset_after,
      ) + 1,
    );
  }

  beginSession(): void {
    this.sql("DELETE FROM speech_staged_messages").run();
  }

  stage(
    sessionKey: string,
    messages: readonly VocabularyMessage[],
    generation: number,
  ): void {
    this.database.transaction(() => {
      if (!this.accepts(generation)) return;
      for (const message of messages) {
        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify([message.source, message.timestamp, message.text]),
          )
          .digest("hex");
        const previous = this.sql(
          "SELECT counts FROM speech_messages WHERE session_key = ? AND fingerprint = ?",
        ).get(sessionKey, fingerprint);
        const counts =
          previous?.counts ??
          JSON.stringify(Object.fromEntries(countWords(message.text)));
        this.sql(
          "INSERT INTO speech_staged_messages VALUES (?, ?, ?, ?) ON CONFLICT(fingerprint) DO NOTHING",
        ).run(fingerprint, message.source, message.timestamp, counts);
      }
    });
  }

  commitSession(
    sessionKey: string,
    sourceVersion: string,
    cutoff: number,
    generation: number,
  ): void {
    this.database.transaction(() => {
      if (!this.accepts(generation)) return;
      this.sql("DELETE FROM speech_word_deltas").run();
      this.sql(`INSERT INTO speech_word_deltas
        SELECT token.key,
          SUM(CASE WHEN contribution.source = 'user' THEN token.value * contribution.sign ELSE 0 END),
          SUM(CASE WHEN contribution.source = 'assistant' THEN token.value * contribution.sign ELSE 0 END)
        FROM (
          SELECT source, counts, -1 AS sign FROM speech_messages WHERE session_key = ? AND timestamp >= ?
          UNION ALL SELECT source, counts, 1 AS sign FROM speech_staged_messages
        ) AS contribution, json_each(contribution.counts) AS token
        GROUP BY token.key`).run(sessionKey, cutoff);
      this.sql(`UPDATE speech_words SET
        user_count = user_count + (SELECT user_count FROM speech_word_deltas WHERE word = speech_words.word),
        assistant_count = assistant_count + (SELECT assistant_count FROM speech_word_deltas WHERE word = speech_words.word)
        WHERE word IN (SELECT word FROM speech_word_deltas)`).run();
      this.sql(
        "INSERT INTO speech_words SELECT * FROM speech_word_deltas WHERE word NOT IN (SELECT word FROM speech_words)",
      ).run();
      this.sql(
        "DELETE FROM speech_words WHERE user_count = 0 AND assistant_count = 0",
      ).run();
      this.sql(
        "DELETE FROM speech_messages WHERE session_key = ? AND timestamp >= ?",
      ).run(sessionKey, cutoff);
      this.sql(
        "INSERT INTO speech_messages SELECT ?, fingerprint, source, timestamp, counts FROM speech_staged_messages",
      ).run(sessionKey);
      this.sql(
        "INSERT INTO speech_sessions VALUES (?, ?, ?) ON CONFLICT(session_key) DO UPDATE SET cutoff = CASE WHEN source_version = excluded.source_version THEN MIN(cutoff, excluded.cutoff) ELSE excluded.cutoff END, source_version = excluded.source_version",
      ).run(sessionKey, sourceVersion, cutoff);
      this.sql("DELETE FROM speech_staged_messages").run();
      this.sql("DELETE FROM speech_word_deltas").run();
    });
  }

  reset(): void {
    this.database.transaction(() => {
      this.sql(
        "UPDATE speech_vocabulary_state SET generation = generation + 1, reset_after = ? WHERE id = 1",
      ).run(Date.now());
      this.database.exec(
        "DELETE FROM speech_words; DELETE FROM speech_messages; DELETE FROM speech_sessions; DELETE FROM speech_staged_messages; DELETE FROM speech_word_deltas;",
      );
    });
  }

  keyterms(limit = 100, maxLength = 50): string[] {
    if (!this.settings().biasing) return [];
    return this.sql(
      "SELECT word FROM speech_words WHERE length(word) BETWEEN 3 AND ? AND user_count > 0 ORDER BY (user_count * 4 + assistant_count) DESC, word LIMIT ?",
    )
      .all(maxLength, limit + COMMON_WORDS.size)
      .map((row) => String(row.word))
      .filter((word) => !COMMON_WORDS.has(word))
      .slice(0, limit);
  }

  close(): void {
    for (const statement of this.statements.values()) statement.finalize();
    this.statements.clear();
  }
}
