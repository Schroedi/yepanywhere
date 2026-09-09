import { afterEach, expect, it, vi } from "vitest";
import {
  createSpeechRoutes,
  createSpeechWebSocketSession,
} from "../../src/routes/speech.js";
import { SpeechBackendRegistry } from "../../src/services/voice/registry.js";
import { XaiSttBackend } from "../../src/services/voice/xaiSttBackend.js";

const upstream = vi.hoisted(() => ({ urls: [] as URL[] }));
vi.mock("ws", () => ({
  default: class {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    private handlers = new Map<string, (data?: unknown) => void>();
    constructor(url: URL) {
      upstream.urls.push(url);
      queueMicrotask(() =>
        this.handlers.get("message")?.(
          JSON.stringify({ type: "transcript.created" }),
        ),
      );
    }
    on(name: string, handler: (data?: unknown) => void) {
      this.handlers.set(name, handler);
    }
    send(data: unknown) {
      if (typeof data === "string")
        this.handlers.get("message")?.(
          JSON.stringify({ type: "transcript.done", text: "parakeet" }),
        );
    }
    close() {
      this.readyState = 3;
      this.handlers.get("close")?.();
    }
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  upstream.urls.length = 0;
});

it("forwards the selected vocabulary through real HTTP and relayed stream entrypoints", async () => {
  const registry = new SpeechBackendRegistry();
  registry.register(new XaiSttBackend("test-key"));
  await registry.waitForValidation();
  registry.setVocabularySource(() => ["parakeet", "sqlite"]);
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ text: "parakeet" })));
  const routes = createSpeechRoutes({
    speechBackendRegistry: registry,
    upgradeWebSocket: () => () => new Response(),
  });
  const response = await routes.request("/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backendId: "ya-grok", audioBase64: "YQ==" }),
  });
  expect(response.status).toBe(200);
  const form = fetch.mock.calls[0]?.[1]?.body as FormData;
  expect(form.getAll("keyterm")).toEqual(["parakeet", "sqlite"]);
  const messages: unknown[] = [];
  const session = createSpeechWebSocketSession(
    { speechBackendRegistry: registry },
    (message) => messages.push(message),
  );
  try {
    session.handleMessage(
      JSON.stringify({
        type: "start",
        backendId: "ya-grok",
        streaming: true,
        sampleRate: 16000,
        encoding: "pcm",
      }),
    );
    await vi.waitFor(() => expect(upstream.urls).toHaveLength(1));
    expect(upstream.urls[0]?.searchParams.getAll("keyterm")).toEqual([
      "parakeet",
      "sqlite",
    ]);
    session.handleMessage(Buffer.from("pcm"));
    session.handleMessage(JSON.stringify({ type: "stop" }));
    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({ type: "final", text: "parakeet" }),
      ),
    );
  } finally {
    session.close();
  }
  registry.setVocabularySource(undefined);
  expect(registry.keyterms("ya-grok")).toEqual([]);
  expect(registry.keyterms("ya-whisper", ["existing"])).toEqual(["existing"]);
});
