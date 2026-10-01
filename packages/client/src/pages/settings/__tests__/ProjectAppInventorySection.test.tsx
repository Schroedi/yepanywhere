import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { ProjectAppInventorySection } from "../ProjectAppInventorySection";

const mock = vi.hoisted(() => ({ version: "0.9.2", fetch: vi.fn() }));
vi.mock("../../../hooks/useVersion", () => ({
  useVersion: () => ({ version: { current: mock.version } }),
}));
vi.mock("../../../api/sourceApiFetch", () => ({ fetchJSON: mock.fetch }));
afterEach(() => {
  cleanup();
  mock.fetch.mockReset();
  vi.restoreAllMocks();
});

it("can release a known project's retained address while vhost hosting is disabled", async () => {
  mock.version = "0.9.4";
  const reservation = {
    projectId: "test",
    name: "canvas",
    namespace: "old.example",
    owner: "superuser",
  };
  let reservations = [reservation];
  mock.fetch.mockImplementation(async (path: string) => {
    if (path === "/projects/test/app")
      return { state: "ready", removedFrom: [] };
    if (path === "/projects/test/app/address")
      return { enabled: false, reservations: [] };
    if (path === "/project-apps/address/release") {
      reservations = [];
      return { released: true };
    }
    return {
      projects: [
        {
          projectId: "test",
          name: "Canvas",
          path: "/project",
          info: { state: "ready" },
        },
      ],
      reservations,
    };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <I18nProvider>
      <ProjectAppInventorySection />
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Canvas" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Release address" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("canvas.old.example")).toBeNull(),
  );
  expect(mock.fetch).toHaveBeenCalledWith("/project-apps/address/release", {
    method: "POST",
    body: JSON.stringify({ projectId: "test", namespace: "old.example" }),
  });
});

it("shows and sorts project folders and sorts retained addresses with live rows", async () => {
  mock.version = "0.9.4";
  mock.fetch.mockResolvedValue({
    projects: [
      {
        projectId: "one",
        name: "First",
        path: "/home/me/z/project",
        info: { state: "ready" },
      },
      {
        projectId: "two",
        name: "Second",
        path: "/home/me/a/project",
        info: { state: "ready" },
      },
    ],
    reservations: [
      {
        projectId: "one",
        name: "zebra",
        namespace: "apps.test",
        owner: "superuser",
      },
      {
        projectId: "two",
        name: "beta",
        namespace: "apps.test",
        owner: "superuser",
      },
      {
        projectId: "gone",
        name: "alpha",
        namespace: "apps.test",
        owner: "superuser",
      },
    ],
  });
  render(
    <I18nProvider>
      <ProjectAppInventorySection />
    </I18nProvider>,
  );
  const table = within(
    await screen.findByRole("table", { name: "Project apps" }),
  );
  const rows = () =>
    table
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);
  expect(table.getByTitle("/home/me/z/project")).toBeTruthy();
  fireEvent.click(table.getByRole("button", { name: "Project folder" }));
  expect(rows()[1]).toContain("Second");
  fireEvent.click(table.getByRole("button", { name: "Project folder" }));
  expect(rows()[0]).toContain("First");
  fireEvent.click(table.getByRole("button", { name: "Domain" }));
  expect(rows()[0]).toContain("alpha.apps.test");
  expect(rows()[2]).toContain("zebra.apps.test");
  expect(mock.fetch).toHaveBeenCalledTimes(1);
});

it.each(["0.9.0", "0.9.1", "0.9.2"])(
  "keeps %s servers free of inventory requests",
  (version) => {
    mock.version = version;
    render(
      <I18nProvider>
        <ProjectAppInventorySection />
      </I18nProvider>,
    );
    expect(
      screen.getByText(/Update the server to list project apps here/),
    ).toBeTruthy();
    expect(mock.fetch).not.toHaveBeenCalled();
  },
);
