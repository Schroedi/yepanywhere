import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { SiteAccess } from "../SiteAccess";

function permissions() {
  const listeners = new Set<() => void>();
  const event = {
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
  };
  const api = {
    contains: vi.fn().mockResolvedValue(false),
    request: vi.fn().mockResolvedValue(false),
    addHostAccessRequest: vi.fn().mockResolvedValue(undefined),
    onAdded: event,
    onRemoved: event,
  };
  vi.stubGlobal("chrome", { runtime: { id: "extension" }, permissions: api });
  return {
    api,
    changed: () => {
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("site access invitation", () => {
  it("does not let a stale check hide the CTA after access is revoked", async () => {
    const { api, changed } = permissions();
    let initialCheck!: (granted: boolean) => void;
    api.contains.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (initialCheck = resolve)),
    );
    render(
      <I18nProvider>
        <SiteAccess
          tab={{ tabId: 12, url: "https://github.com/", clicked: false }}
        />
      </I18nProvider>,
    );
    await act(async () => changed());
    const allow = await screen.findByRole("button", {
      name: "Allow github.com…",
    });
    await act(async () => initialCheck(true));
    expect(screen.getByRole("button", { name: "Allow github.com…" })).toBe(
      allow,
    );
    api.contains.mockResolvedValue(true);
    await act(async () => changed());
    expect(screen.queryByRole("button")).toBeNull();
    api.contains.mockResolvedValue(false);
    await act(async () => changed());
    expect(
      await screen.findByRole("button", { name: "Allow github.com…" }),
    ).toBeTruthy();
  });

  it("keeps failed requests retryable and distinguishes denial from a grant", async () => {
    const { api } = permissions();
    api.addHostAccessRequest.mockRejectedValueOnce(
      new Error("restricted page"),
    );
    const panel = (url?: string) => (
      <I18nProvider>
        <SiteAccess tab={{ tabId: 12, url, clicked: false }} />
      </I18nProvider>
    );
    const view = render(panel());
    fireEvent.click(screen.getByRole("button", { name: "Allow this site…" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "could not request access",
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow this site…" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Finish allowing access",
    );

    // Learning the URL switches to the direct permission prompt, without
    // carrying the previous tab's feedback into the new request.
    view.rerender(panel("https://tomfit.atlassian.net/"));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Allow tomfit.atlassian.net…",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "was not granted",
    );
    api.request.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Allow tomfit.atlassian.net…" }),
      );
    });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
