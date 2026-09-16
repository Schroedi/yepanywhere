import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayService } from "@yep-anywhere/shared";
import { CodexOSSProvider } from "../../../src/sdk/providers/codex-oss.js";
import type { StartSessionOptions } from "../../../src/sdk/providers/types.js";

class ExposedCodexOSSProvider extends CodexOSSProvider {
  firstTurnArgs(model?: string): string[] {
    return (
      this as unknown as {
        buildFirstTurnArgs(options: StartSessionOptions): string[];
      }
    ).buildFirstTurnArgs({ model } as StartSessionOptions);
  }

  resumeTurnArgs(model: string | undefined, sessionId: string): string[] {
    return (
      this as unknown as {
        buildResumeTurnArgs(
          options: StartSessionOptions,
          sessionId: string,
          prompt: string,
        ): string[];
      }
    ).buildResumeTurnArgs({ model } as StartSessionOptions, sessionId, "go");
  }
}

function service(overrides: Partial<GatewayService> = {}): GatewayService {
  return {
    id: "vllm",
    label: "DeepSeek V4 Flash",
    shortName: "vllm",
    url: "http://127.0.0.1:8001",
    enabled: true,
    autoStop: false,
    autoStopAfterSeconds: 0,
    codexEnabled: true,
    codexWireApi: "chat",
    ...overrides,
  };
}

/** The rows a live vLLM server returns, minus the fields Codex ignores. */
function vllmCatalog(ids: string[], maxModelLen = 252_000) {
  return new Response(
    JSON.stringify({
      data: ids.map((id) => ({
        id,
        object: "model",
        owned_by: "vllm",
        max_model_len: maxModelLen,
      })),
    }),
    { status: 200 },
  );
}

describe("CodexOSS gateway services", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists models from a configured endpoint instead of ollama", async () => {
    const fetchMock = vi.fn(async () =>
      vllmCatalog(["deepseek-v4-flash", "deepseek-v4-flash-0731"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);

    await expect(provider.getAvailableModels()).resolves.toEqual([
      {
        id: "deepseek-v4-flash",
        name: "deepseek-v4-flash",
        contextWindow: 252_000,
      },
      {
        id: "deepseek-v4-flash-0731",
        name: "deepseek-v4-flash-0731",
        contextWindow: 252_000,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8001/v1/models",
      expect.anything(),
    );
  });

  it("reports itself usable with a configured endpoint and no ollama", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service()]);

    await expect(provider.isAuthenticated()).resolves.toBe(true);
  });

  it("launches through a model provider override, not --oss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => vllmCatalog(["deepseek-v4-flash"])),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([
      service({ codexWireApi: "responses", contextWindowTokens: 252_000 }),
    ]);
    await provider.getAvailableModels();

    const args = provider.firstTurnArgs("deepseek-v4-flash");
    expect(args).toEqual([
      "exec",
      "-c",
      'model_providers.ya_vllm.name="DeepSeek V4 Flash"',
      "-c",
      'model_providers.ya_vllm.base_url="http://127.0.0.1:8001/v1"',
      "-c",
      'model_providers.ya_vllm.wire_api="responses"',
      "-c",
      'model_provider="ya_vllm"',
      "--json",
      "--model",
      "deepseek-v4-flash",
      "-s",
      "workspace-write",
    ]);
    expect(args).not.toContain("--oss");

    expect(provider.resumeTurnArgs("deepseek-v4-flash", "thread-1")).toEqual([
      "exec",
      "resume",
      "thread-1",
      "go",
      "-c",
      'model_providers.ya_vllm.name="DeepSeek V4 Flash"',
      "-c",
      'model_providers.ya_vllm.base_url="http://127.0.0.1:8001/v1"',
      "-c",
      'model_providers.ya_vllm.wire_api="responses"',
      "-c",
      'model_provider="ya_vllm"',
      "-c",
      'model="deepseek-v4-flash"',
    ]);
  });

  it("keeps the ollama path when no endpoint is configured", () => {
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([]);

    expect(provider.firstTurnArgs("qwen2.5-coder:32b-32k")).toEqual([
      "exec",
      "--oss",
      "--local-provider",
      "ollama",
      "--json",
      "--model",
      "qwen2.5-coder:32b-32k",
      "-s",
      "workspace-write",
    ]);
  });

  it("ignores an endpoint that did not opt into CodexOSS", async () => {
    const fetchMock = vi.fn(async () => vllmCatalog(["deepseek-v4-flash"]));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([service({ codexEnabled: false })]);

    // No endpoint is available to it, so it falls back to asking Ollama.
    await provider.getAvailableModels();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("launches a collision-qualified model under its plain name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("http://127.0.0.1:8001")
          ? vllmCatalog(["shared-model"])
          : vllmCatalog(["shared-model"], 32_768),
      ),
    );
    const provider = new ExposedCodexOSSProvider();
    provider.setGatewayServices([
      service(),
      service({ id: "second", label: "", url: "http://127.0.0.1:8002" }),
    ]);

    const models = await provider.getAvailableModels();
    expect(models.map((model) => model.id)).toEqual([
      "vllm::shared-model",
      "second::shared-model",
    ]);

    const args = provider.firstTurnArgs("second::shared-model");
    expect(args).toContain(
      'model_providers.ya_second.base_url="http://127.0.0.1:8002/v1"',
    );
    expect(args[args.indexOf("--model") + 1]).toBe("shared-model");
  });
});
