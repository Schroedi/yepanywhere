import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechBackendSetup } from "../SpeechBackendSetup";
import { I18nProvider } from "../../../i18n";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
const versionState = vi.hoisted(() => ({ current: "0.8.2", refetch: vi.fn() }));
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
    version: { current: versionState.current },
    loading: false,
    refetch: versionState.refetch,
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
  versionState.current = "0.8.2";
});

describe("SpeechBackendSetup", () => {
  it("does not request setup routes on older servers", async () => {
    versionState.current = "0.8.1";
    render(
      <I18nProvider>
        <SpeechBackendSetup />
      </I18nProvider>,
    );
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Install and enable local backends")).toBeNull();
  });
  it.each([false, true])(
    "enables and installs with cached model files: %s",
    async (modelFilesPresent) => {
      transport.fetch.mockImplementation(
        async (path: string, options?: { method?: string }) => {
          if (path === "/speech/backends" && !options?.method) {
            return {
              envBackends: ["ya-whisper"],
              settingsBackends: settingsState.speechVoiceBackends,
              advertisedBackends: ["ya-whisper"],
              restartAvailable: true,
              liveEnablement: true,
              workingDirectory: "/srv/YA's checkout",
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
                  modelFilesPresent,
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
        name: "Enable Granite Speech STT",
      });
      expect(
        screen
          .getByRole("checkbox", {
            name: "Enable Whisper STT",
          })
          .hasAttribute("disabled"),
      ).toBe(true);
      fireEvent.click(granite);
      expect(screen.getByText("Locked on by environment.")).toBeTruthy();
      expect(
        screen.getByText(
          /Removing YEP_VOICE_BACKENDS on your next start leaves this enabled/,
        ),
      ).toBeTruthy();
      await waitFor(() =>
        expect(settingsState.updateSettings).toHaveBeenCalledWith({
          speechVoiceBackends: ["ya-granite"],
        }),
      );
      const installButtons = screen.getAllByRole("button", {
        name: "Get / install this model",
      });
      expect(
        screen.queryByRole("button", { name: "Close model page" }) !== null,
      ).toBe(!modelFilesPresent);
      expect(
        screen.getByText("Only needed to disable a backend."),
      ).toBeTruthy();
      if (!modelFilesPresent) {
        expect(
          screen.getByText(
            "cd '/srv/YA'\\''s checkout' && pixi run --frozen -e stt hf auth login",
          ),
        ).toBeTruthy();
      }
      expect(installButtons.length).toBeGreaterThan(1);
      fireEvent.click(installButtons[1]!);
      await waitFor(() =>
        expect(transport.fetch).toHaveBeenCalledWith(
          "/speech/backends/ya-granite/install",
          { method: "POST" },
        ),
      );
    },
  );
});
