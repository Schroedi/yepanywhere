import { createHash } from "node:crypto";
import { rankVocabulary, speechVocabularyTokens } from "@yep-anywhere/shared";
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

function countWords(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of speechVocabularyTokens(text)) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

export class VocabularyStore {
  private readonly statements = new Map<string, SqliteStatement>();
  private wordsRevision = 0;

  get revision(): number {
    return this.wordsRevision;
  }

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
    this.wordsRevision++;
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
    this.wordsRevision++;
  }

  keyterms(
    baseline: ReadonlyMap<string, number>,
    limit = 100,
    maxLength = 50,
    sessionTerms: ReadonlySet<string> = new Set(),
  ): string[] {
    if (!this.settings().biasing) return [];
    const totals = this.totals();
    const common = new Set(
      [...baseline]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 1000)
        .map(([word]) => word),
    );
    let after = "";
    let best: ReturnType<typeof rankVocabulary> = [];
    // Walk the entire lexicon by its primary key, retaining only a page and the winners.
    for (;;) {
      const rows = this.sql(
        "SELECT word, user_count, assistant_count FROM speech_words WHERE word > ? AND length(word) <= ? ORDER BY word LIMIT 512",
      ).all(after, maxLength);
      if (rows.length === 0) break;
      const words = rows
        .map((row) => ({
          word: String(row.word),
          user: Number(row.user_count),
          assistant: Number(row.assistant_count),
        }))
        .filter(({ word }) => !common.has(word) && word.length <= maxLength);
      best = rankVocabulary(
        [...best, ...words],
        totals.user + totals.assistant,
        baseline,
        1,
        true,
        true,
      )
        .map((word) => ({
          ...word,
          score: word.score * (sessionTerms.has(word.word) ? 5 : 1),
        }))
        .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
        .slice(0, limit);
      after = String(rows[rows.length - 1]!.word);
    }
    return best.map(({ word }) => word);
  }

  close(): void {
    for (const statement of this.statements.values()) statement.finalize();
    this.statements.clear();
  }
}
