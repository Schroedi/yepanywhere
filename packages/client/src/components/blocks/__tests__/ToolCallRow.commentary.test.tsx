import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionMetadataProvider } from "../../../contexts/SessionMetadataContext";
import { SchemaValidationProvider } from "../../../contexts/SchemaValidationContext";
import { ToastProvider } from "../../../contexts/ToastContext";
import { I18nProvider } from "../../../i18n";
import { getSourceRuntimeRegistry } from "../../../lib/sourceRuntime";
import { LOCAL_CLIENT_SUMMARY_SOURCE_KEY } from "../../../lib/clientSummaryStore";
import { UI_KEYS } from "../../../lib/storageKeys";
import { SessionViewerProvider } from "../../SessionManagedViewer";
import { ToolCallRow } from "../ToolCallRow";

const version = vi.hoisted(() => ({ value: { current: "0.8.2" } }));
vi.mock("../../../hooks/useVersion", () => ({
  useRetainedVersionInfo: () => version.value,
}));

const banner = "# acli: 1 complete +commentary\n";
const note = (text: string) =>
  JSON.stringify({ _acli: { commentary: [{ text }] } });

function row(stdout: string, pending = false) {
  return (
    <I18nProvider>
      <MemoryRouter>
        <SessionMetadataProvider
          projectId="project"
          projectPath="/workspace"
          sessionId="session"
        >
          <ToastProvider>
            <SchemaValidationProvider>
              <SessionViewerProvider sessionId="session">
                <ToolCallRow
                  id="command"
                  toolName="Bash"
                  toolInput={{ command: "report --jsonl" }}
                  status={pending ? "pending" : "complete"}
                  toolResult={{
                    content: stdout,
                    isError: false,
                    structured: {
                      stdout,
                      stderr: banner,
                      interrupted: false,
                      isImage: false,
                    },
                  }}
                />
              </SessionViewerProvider>
            </SchemaValidationProvider>
          </ToastProvider>
        </SessionMetadataProvider>
      </MemoryRouter>
    </I18nProvider>
  );
}

describe("ToolCallRow commentary integration", () => {
  beforeEach(() => {
    version.value = { current: "0.8.2" };
    localStorage.removeItem(UI_KEYS.acliCommentary);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(UI_KEYS.acliCommentary);
  });

  it("keeps old servers and the disabled setting on raw output without requests", () => {
    const fetch = vi.spyOn(
      getSourceRuntimeRegistry().getOrCreateSourceRuntime(
        LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
      ).transport,
      "fetch",
    );
    version.value = { current: "0.8.1" };
    const view = render(row(note("Unrendered")));
    expect(
      screen.queryByRole("button", { name: "Open tool output" }),
    ).toBeNull();
    expect(view.container.textContent).toContain(
      "acli: 1 complete +commentary",
    );
    expect(fetch).not.toHaveBeenCalled();
    version.value = { current: "0.8.2" };
    localStorage.setItem(UI_KEYS.acliCommentary, "false");
    view.rerender(row(note("Disabled")));
    expect(view.container.textContent).toContain(
      "acli: 1 complete +commentary",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders complete records once, pins context, and opens the minimizable output viewer", async () => {
    const fetch = vi
      .spyOn(
        getSourceRuntimeRegistry().getOrCreateSourceRuntime(
          LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        ).transport,
        "fetch",
      )
      .mockImplementation(async (_url, options) => ({
        html: (JSON.parse(options!.body as string).texts as string[]).map(
          (text) => `<p>${text}</p>`,
        ),
      }));
    const source = `${note("Root note")}\n{"value":7}\n${note("Result note")}\n`;
    const view = render(row(source.slice(0, 15), true));
    expect(view.container.textContent).not.toContain("_acli");
    expect(fetch).not.toHaveBeenCalled();
    view.rerender(row(source));
    await screen.findByText("Root note");
    expect(view.container.textContent).not.toContain("_acli");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(
      "/projects/project/tool-commentary/render",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show commentary context" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Show commentary context" })
        .textContent,
    ).toContain('{"value":7}');
    fireEvent.click(
      screen.getByRole("button", { name: "Close commentary context" }),
    );
    const root = screen.getByRole("button", { name: "Open tool output" });
    expect(root.title).toBe("report --jsonl");
    fireEvent.click(root);
    await screen.findByRole("button", { name: /minimize/i });
    expect(screen.getByText("Original output")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /minimize/i }));
    await act(async () => {
      view.rerender(row(source));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Root note")).toHaveLength(1);
  });

  it("replaces source generations without showing raw metadata or duplicating prose", async () => {
    const fetch = vi
      .spyOn(
        getSourceRuntimeRegistry().getOrCreateSourceRuntime(
          LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        ).transport,
        "fetch",
      )
      .mockImplementation(async (_url, options) => ({
        html: (JSON.parse(options!.body as string).texts as string[]).map(
          (text) => `<p>${text}</p>`,
        ),
      }));
    const view = render(row(`${note("Before")}\n`, true));
    await screen.findByText("Before");
    view.rerender(row(`${note("After")}\n`));
    expect(view.container.textContent).not.toContain("_acli");
    await screen.findByText("After");
    await waitFor(() => expect(screen.queryByText("Before")).toBeNull());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps declared data-only output in the ordinary box without rendering requests", () => {
    const fetch = vi.spyOn(
      getSourceRuntimeRegistry().getOrCreateSourceRuntime(
        LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
      ).transport,
      "fetch",
    );
    const view = render(row('{"value":7}\n'));
    expect(view.container.textContent).toContain('{"value":7}');
    expect(
      screen.queryByRole("button", { name: "Open tool output" }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
