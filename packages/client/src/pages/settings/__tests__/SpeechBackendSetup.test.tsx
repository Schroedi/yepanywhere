import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechBackendSetup } from "../SpeechBackendSetup";
import { I18nProvider } from "../../../i18n";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
const settingsState = vi.hoisted(() => ({
  speechVoiceBackends: [] as string[],
  updateSettings: vi.fn(async (updates: { speechVoiceBackends?: string[] }) => {
    settingsState.speechVoiceBackends = updates.speechVoiceBackends ?? [];
  }),
}));

vi.mock("../../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({ transport }),
}));
vi.mock("../../../hooks/useVersion", () => ({
  useVersion: () => ({
    version: { current: "0.8.2" },
    loading: false,
  }),
}));
vi.mock("../../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: { speechVoiceBackends: settingsState.speechVoiceBackends },
    updateSettings: settingsState.updateSettings,
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
  settingsState.speechVoiceBackends = [];
});

describe("SpeechBackendSetup", () => {
  it("enables a local backend in server settings and can request install", async () => {
    transport.fetch.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (path === "/speech/backends" && !options?.method) {
          return {
            envBackends: ["ya-whisper"],
            settingsBackends: settingsState.speechVoiceBackends,
            advertisedBackends: ["ya-whisper"],
            restartAvailable: true,
            needsRestart:
              settingsState.speechVoiceBackends.includes("ya-granite"),
            install: { running: false, lines: [] },
            catalog: [
              {
                id: "ya-whisper",
                enabled: true,
                enabledByEnv: true,
                enabledBySettings: true,
                advertised: true,
                pixiEnvironment: "stt",
                bootstrapTask: "stt-bootstrap",
                defaultModel: "distil-large-v3.5",
                hfGated: false,
              },
              {
                id: "ya-granite",
                enabled:
                  settingsState.speechVoiceBackends.includes("ya-granite"),
                enabledByEnv: false,
                enabledBySettings:
                  settingsState.speechVoiceBackends.includes("ya-granite"),
                advertised: false,
                pixiEnvironment: "stt",
                bootstrapTask: "stt-bootstrap-granite",
                defaultModel: "ibm-granite/granite-speech-4.1-2b",
                hfGated: false,
              },
            ],
          };
        }
        if (path === "/speech/backends/ya-granite/install") {
          return { running: true, backendId: "ya-granite", lines: ["start"] };
        }
        return {};
      },
    );

    render(
      <I18nProvider>
        <SpeechBackendSetup />
      </I18nProvider>,
    );

    const granite = await screen.findByRole("checkbox", {
      name: "Enable Granite Speech STT after the next YA restart",
    });
    expect(
      screen
        .getByRole("checkbox", {
          name: "Enable Whisper STT after the next YA restart",
        })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(granite);
    await waitFor(() =>
      expect(settingsState.updateSettings).toHaveBeenCalledWith({
        speechVoiceBackends: ["ya-granite"],
      }),
    );
    const installButtons = screen.getAllByRole("button", {
      name: "Get / install this model",
    });
    expect(installButtons.length).toBeGreaterThan(1);
    fireEvent.click(installButtons[1]!);
    await waitFor(() =>
      expect(transport.fetch).toHaveBeenCalledWith(
        "/speech/backends/ya-granite/install",
        { method: "POST" },
      ),
    );
  });
});
