import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ProjectAppViewer } from "../ProjectAppViewer";

const mock = vi.hoisted(() => ({ version: "0.9.4", fetch: vi.fn() }));
vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => ({ version: { current: mock.version } }),
}));
vi.mock("../../api/sourceApiFetch", () => ({ fetchJSON: mock.fetch }));
beforeEach(() => {
  mock.version = "0.9.4";
  mock.fetch.mockReset().mockImplementation(async (path: string) =>
    path.endsWith("/open")
      ? {
          id: "static:test",
          kind: "static",
          label: "Canvas",
          url: "https://artifacts.example/a/token/index.html",
          transferable: true,
        }
      : path.endsWith("/address")
        ? { enabled: false, reservations: [] }
        : {
            projectId: "test",
            declaration: { where: { kind: "static" } },
            state: "ready",
            latestArtifact: null,
            canExecute: true,
            canShare: true,
            removedFrom: [],
          },
  );
});
afterEach(cleanup);
it("sends no App requests to an older server", () => {
  mock.version = "0.9.2";
  render(
    <I18nProvider>
      <ProjectAppViewer projectId="test" onBack={() => {}} />
    </I18nProvider>,
  );
  expect(screen.getByText("Project App requires a newer server.")).toBeTruthy();
  expect(mock.fetch).not.toHaveBeenCalled();
});
it("offers a view-only user Start for a stopped app and never Stop", async () => {
  const process = {
    version: 1,
    where: { kind: "process", cwd: ".", entry: "/" },
    start: { argv: ["npm", "start"], portEnv: "PORT" },
  };
  let running = false;
  mock.fetch.mockImplementation(async (path: string) =>
    path.endsWith("/address")
      ? { enabled: false, reservations: [] }
      : path.endsWith("/app")
        ? {
            projectId: "test",
            declaration: process,
            ...(running ? { activeDeclaration: process } : {}),
            state: running ? "running" : "stopped",
            latestArtifact: null,
            canExecute: false,
            canStart: true,
            canShare: false,
            removedFrom: [],
          }
        : new Promise(() => {}),
  );
  render(
    <I18nProvider>
      <ProjectAppViewer projectId="test" onBack={() => {}} />
    </I18nProvider>,
  );
  expect(await screen.findByRole("button", { name: "Start app" })).toBeTruthy();
  running = true;
  cleanup();
  render(
    <I18nProvider>
      <ProjectAppViewer projectId="test" onBack={() => {}} />
    </I18nProvider>,
  );
  await screen.findByText(/running/);
  expect(screen.queryByRole("button", { name: "Stop app" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start app" })).toBeNull();
});
it("keeps the live iframe across settings and sharing and delegates mic synchronously to its composer", async () => {
  const toggle = vi.fn();
  const onVoice = vi.fn();
  const { container } = render(
    <I18nProvider>
      <ProjectAppViewer
        projectId="test"
        onBack={() => {}}
        onVoice={onVoice}
        voice={{
          toggle,
          isListening: false,
          isAvailable: true,
          stopAndFinalize: () => "",
          cancelProcessing: vi.fn(),
          prewarm: vi.fn(),
          beginInsertionBoundary: vi.fn(),
          continueAfterSpeechSend: vi.fn(),
        }}
      />
    </I18nProvider>,
  );
  await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
  const frame = container.querySelector("iframe");
  fireEvent.click(screen.getByRole("button", { name: "Start microphone" }));
  expect(onVoice).toHaveBeenCalledTimes(1);
  expect(toggle).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "App settings" }));
  await waitFor(() =>
    expect(mock.fetch).toHaveBeenCalledWith("/projects/test/app/address"),
  );
  expect(container.querySelector("iframe")).toBe(frame);
  expect(screen.queryByRole("group", { name: "App address" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Share app" }));
  fireEvent.click(screen.getByRole("button", { name: "Create share link" }));
  await screen.findByText("Valid while this app launch is running.");
  expect(container.querySelector("iframe")).toBe(frame);
});
