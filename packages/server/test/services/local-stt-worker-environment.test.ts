import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => ({
  ...(await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  )),
  spawn: spawnMock,
}));

import { LocalGraniteBackend } from "../../src/services/voice/localGraniteBackend.js";
import { LocalNemoBackend } from "../../src/services/voice/localNemoBackend.js";
import { LocalParakeetBackend } from "../../src/services/voice/localParakeetBackend.js";
import { LocalWhisperBackend } from "../../src/services/voice/localWhisperBackend.js";

afterEach(() => {
  spawnMock.mockReset();
  vi.unstubAllEnvs();
});

describe("local speech worker environment", () => {
  it.each([
    ["Whisper", LocalWhisperBackend],
    ["Parakeet", LocalParakeetBackend],
    ["NeMo", LocalNemoBackend],
    ["Granite Speech", LocalGraniteBackend],
  ] as const)(
    "isolates %s runtime libraries while retaining operator settings",
    async (_name, Backend) => {
      vi.stubEnv("LD_LIBRARY_PATH", "/host/cuda/lib");
      vi.stubEnv("LD_PRELOAD", "/host/liboverride.so");
      vi.stubEnv("CUDA_VISIBLE_DEVICES", "1");
      vi.stubEnv("HF_HUB_CACHE", "/configured/model-cache");
      const worker = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      spawnMock.mockImplementation(() => {
        queueMicrotask(() => worker.stdout.write('{"status":"ready"}\n'));
        return worker;
      });

      try {
        await new Backend().prewarm();
        expect(spawnMock).toHaveBeenCalledOnce();
        if (Backend === LocalParakeetBackend) {
          expect(spawnMock.mock.lastCall?.[1]).toContain(
            "ai-and-i-project/parakeet-tdt-0.6b-v2-hf",
          );
        }
        if (Backend === LocalNemoBackend) {
          expect(spawnMock.mock.lastCall?.[1]).toContain(
            "nvidia/parakeet-unified-en-0.6b",
          );
        }
        const env = spawnMock.mock.lastCall?.[2].env;
        expect(env).toBeDefined();
        expect(env).not.toHaveProperty("LD_LIBRARY_PATH");
        expect(env).not.toHaveProperty("LD_PRELOAD");
        expect(env.CUDA_VISIBLE_DEVICES).toBe("1");
        expect(env.HF_HUB_CACHE).toBe("/configured/model-cache");
        expect(process.env.LD_LIBRARY_PATH).toBe("/host/cuda/lib");
        expect(process.env.LD_PRELOAD).toBe("/host/liboverride.so");
      } finally {
        worker.stdin.destroy();
        worker.stdout.destroy();
        worker.stderr.destroy();
      }
    },
  );

  it("forwards Granite keyterms on the worker request line", async () => {
    const chunks: string[] = [];
    const worker = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    worker.stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      worker.stdout.write('{"text":"ok"}\n');
    });
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => worker.stdout.write('{"status":"ready"}\n'));
      return worker;
    });
    try {
      const backend = new LocalGraniteBackend();
      await backend.prewarm();
      await backend.transcribe(Buffer.from("audio"), {
        keyterms: ["agentctl", "SQLite"],
      });
      const request = chunks
        .join("")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("{"));
      expect(request).toBeDefined();
      expect(JSON.parse(request ?? "{}")).toMatchObject({
        keyterms: ["agentctl", "SQLite"],
      });
    } finally {
      worker.stdin.destroy();
      worker.stdout.destroy();
      worker.stderr.destroy();
    }
  });
});
