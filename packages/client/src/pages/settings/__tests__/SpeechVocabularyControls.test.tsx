import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechVocabularyControls } from "../SpeechVocabularyControls";
import { I18nProvider } from "../../../i18n";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({ transport }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("speech vocabulary controls", () => {
  it("enables learning with the chosen hours and exposes recognition separately", async () => {
    let status = {
      generation: 0,
      enabled: false,
      biasing: false,
      hours: 24,
      totals: { words: 0, user: 0, assistant: 0 },
      scan: { state: "idle", sessions: 0, messages: 0 },
      integration: "grok-via-ya",
    };
    transport.fetch.mockImplementation(async (_path, options) => {
      if (options?.body) status = { ...status, ...JSON.parse(options.body) };
      return status;
    });
    render(
      <I18nProvider>
        <SpeechVocabularyControls />
      </I18nProvider>,
    );
    const enable = await screen.findByLabelText(
      "Learn vocabulary on this server",
    );
    await waitFor(() => expect(enable.hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("History to learn (hours)"), {
      target: { value: "48" },
    });
    fireEvent.click(enable);
    await waitFor(() => expect(status.enabled).toBe(true));
    expect(status.hours).toBe(48);
    expect(status.biasing).toBe(false);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Scan + Learn" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scan + Learn" }));
    });
    expect(transport.fetch).toHaveBeenCalledWith("/speech/vocabulary/scan", {
      method: "POST",
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Stop + Clear",
        }),
      );
    });
    expect(transport.fetch).toHaveBeenCalledWith("/speech/vocabulary/reset", {
      method: "POST",
    });
  });
});
