import { afterEach, describe, expect, it, vi } from "vitest";

const startHostedProviderSession = vi.fn(async () => ({}));

vi.mock("../../../src/sdk/providers/provider-runtime-host.js", () => ({
  isProviderRuntimeHostAvailable: () => true,
  retainProviderRuntimeProcessGroup: vi.fn(),
  startHostedProviderSession,
}));

const { claudeProvider, getProvider } = await import(
  "../../../src/sdk/providers/index.js"
);

describe("hosted provider launch model", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    startHostedProviderSession.mockClear();
  });

  it("hands the host the concrete model an alias resolves to", async () => {
    vi.spyOn(claudeProvider, "resolveLaunchModel").mockImplementation(
      (model) => (model === "opus" ? "claude-opus-5-5" : undefined),
    );

    await getProvider("claude")?.startSession({ cwd: "/tmp", model: "opus" });

    expect(startHostedProviderSession).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({
        model: "opus",
        launchModel: "claude-opus-5-5",
      }),
      expect.anything(),
    );
  });
});
