import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSpeechVocabularyRoutes } from "../../src/routes/speech-vocabulary.js";
import { DiscoverySqliteService } from "../../src/storage/discovery-sqlite.js";
import { VocabularyStore } from "../../src/services/voice/VocabularyStore.js";
import { VocabularyLearning } from "../../src/services/voice/VocabularyLearning.js";
import type { Message } from "../../src/supervisor/types.js";
import { SessionReader } from "../../src/sessions/reader.js";
import { normalizeSession } from "../../src/sessions/normalization.js";
import { encodeProjectId } from "../../src/projects/paths.js";
import { loadSqliteDriver } from "../../src/storage/sqlite.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-speech-vocabulary-"));
  let storage: DiscoverySqliteService;
  let learning: VocabularyLearning;
  let version = "v1";
  let messages: Message[] = [
    {
      uuid: "a",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "Parakeet parakeet SQLite",
    },
    {
      uuid: "b",
      type: "assistant",
      timestamp: new Date().toISOString(),
      content: [
        { type: "text", text: "SQLite parakeet" },
        { type: "tool_use", input: "ignored" },
      ],
    },
  ];
  const open = () => {
    storage = new DiscoverySqliteService({ dataDir, mode: "auto" });
    const database = storage.getDatabase();
    if (!database)
      throw new Error("This integration test requires built-in SQLite");
    learning = new VocabularyLearning(
      new VocabularyStore(database),
      async function* () {
        yield {
          key: "durable-session",
          version,
          updatedAt: Date.now(),
          messages: async function* () {
            yield messages;
          },
        };
      },
    );
  };
  open();
  cleanup.push(async () => {
    await learning.close();
    storage.close();
    rmSync(dataDir, { recursive: true });
  });
  return {
    get learning() {
      return learning;
    },
    get storage() {
      return storage;
    },
    get routes() {
      return createSpeechVocabularyRoutes(learning);
    },
    change(next: Message[]) {
      messages = next;
      version += "x";
    },
    async reopen() {
      await learning.close();
      storage.close();
      open();
    },
    async enable() {
      const response = await this.routes.request("/vocabulary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, biasing: true, hours: 24 }),
      });
      expect(response.status).toBe(200);
      await learning.settled();
      expect(learning.status().scan.error).toBeUndefined();
    },
  };
}

describe.skipIf(!loadSqliteDriver())(
  "persistent speech learning through its routes",
  () => {
    it("reenters the real durable Claude reader without changing contributions", async () => {
      const f = fixture();
      const sessionDir = mkdtempSync(join(tmpdir(), "ya-vocabulary-source-"));
      cleanup.push(async () => rmSync(sessionDir, { recursive: true }));
      const sessionId = "stable-durable-source";
      const timestamp = new Date().toISOString();
      writeFileSync(
        join(sessionDir, `${sessionId}.jsonl`),
        [
          {
            type: "user",
            uuid: "user-1",
            parentUuid: null,
            timestamp,
            message: { role: "user", content: "SQLite parakeet" },
          },
          {
            type: "assistant",
            uuid: "assistant-1",
            parentUuid: "user-1",
            timestamp,
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Parakeet" }],
            },
          },
        ]
          .map((row) => JSON.stringify(row))
          .join("\n") + "\n",
      );
      for (let pass = 0; pass < 2; pass++) {
        const reader = new SessionReader({ sessionDir });
        const loaded = await reader.getSession(
          sessionId,
          encodeProjectId(sessionDir),
        );
        expect(loaded).not.toBeNull();
        f.change(normalizeSession(loaded!).messages);
        await f.enable();
        f.learning.scan();
        await f.learning.settled();
        expect(f.learning.status().totals).toEqual({
          words: 2,
          user: 2,
          assistant: 1,
        });
        await reader.close();
        await f.reopen();
        f.storage.getDatabase()?.exec("DELETE FROM speech_sessions");
      }
    });
    it("survives reboot, missing scan progress, changed UI IDs, and reordered replay", async () => {
      const f = fixture();
      expect(f.learning.status().enabled).toBe(false);
      expect(
        (await f.routes.request("/vocabulary/scan", { method: "POST" })).status,
      ).toBe(409);
      await f.enable();
      expect(f.learning.status().totals).toEqual({
        words: 2,
        user: 3,
        assistant: 2,
      });
      const rows = f.storage
        .getDatabase()
        ?.prepare("SELECT fingerprint, counts FROM speech_messages");
      expect(rows?.all()).toHaveLength(2);
      rows?.finalize();
      await f.reopen();
      f.storage.getDatabase()?.exec("DELETE FROM speech_sessions");
      await f.routes.request("/vocabulary/scan", { method: "POST" });
      await f.learning.settled();
      expect(f.learning.status().totals).toEqual({
        words: 2,
        user: 3,
        assistant: 2,
      });
      // Replay keeps durable timestamps but deliberately changes presentation IDs/order.
      const timestamps = f.storage
        .getDatabase()
        ?.prepare("SELECT source, timestamp FROM speech_messages");
      const times = Object.fromEntries(
        timestamps
          ?.all()
          .map((row) => [String(row.source), Number(row.timestamp)]) ?? [],
      );
      timestamps?.finalize();
      f.change([
        {
          uuid: "different-b",
          type: "assistant",
          timestamp: new Date(times.assistant!).toISOString(),
          content: "SQLite parakeet",
        },
        {
          uuid: "different-a",
          type: "user",
          timestamp: new Date(times.user!).toISOString(),
          content: "Parakeet parakeet SQLite",
        },
      ]);
      f.learning.scan();
      await f.learning.settled();
      expect(f.learning.status().totals).toEqual({
        words: 2,
        user: 3,
        assistant: 2,
      });
      expect(f.learning.store.keyterms()).toEqual(["parakeet", "sqlite"]);
      expect(
        (await (await f.routes.request("/vocabulary")).json()).words,
      ).toBeUndefined();
      expect(
        (await (await f.routes.request("/vocabulary?includeWords=1")).json())
          .words,
      ).toEqual([
        { word: "parakeet", user: 2, assistant: 1 },
        { word: "sqlite", user: 1, assistant: 1 },
      ]);
    });

    it("keeps reset history cleared across automatic catalog work and reboot", async () => {
      const f = fixture();
      await f.enable();
      f.learning.reset();
      f.learning.scan(false);
      await f.learning.settled();
      expect(f.learning.status().totals.words).toBe(0);
      await f.reopen();
      f.learning.scan(false);
      await f.learning.settled();
      expect(f.learning.status().totals.words).toBe(0);
      f.learning.scan();
      await f.learning.settled();
      expect(f.learning.status().totals.words).toBe(2);
    });

    it("replaces revised content atomically, preserves disabled state, and relearns after reset", async () => {
      const f = fixture();
      await f.enable();
      f.change([
        { type: "user", timestamp: new Date().toISOString(), content: "NeMo" },
      ]);
      f.learning.scan();
      await f.learning.settled();
      expect(f.learning.status().totals).toEqual({
        words: 1,
        user: 1,
        assistant: 0,
      });
      await f.routes.request("/vocabulary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, biasing: true, hours: 24 }),
      });
      await f.reopen();
      expect(f.learning.status().enabled).toBe(false);
      expect(f.learning.status().totals.user).toBe(1);
      const generation = f.learning.status().generation;
      await f.routes.request("/vocabulary/reset", { method: "POST" });
      expect(f.learning.status().generation).toBe(generation + 1);
      expect(f.learning.status().totals.words).toBe(0);
      await f.enable();
      expect(f.learning.status().totals.user).toBe(1);
    });

    it("rejects stale generation commits and leaves published counts intact before commit", async () => {
      const f = fixture();
      await f.enable();
      const generation = f.learning.status().generation;
      f.learning.store.beginSession();
      f.learning.store.stage(
        "durable-session",
        [{ source: "user", timestamp: Date.now(), text: "newword" }],
        generation,
      );
      expect(f.learning.status().totals.user).toBe(3);
      f.learning.reset();
      f.learning.store.commitSession("durable-session", "late", 0, generation);
      expect(f.learning.status().totals.words).toBe(0);
    });
  },
);
