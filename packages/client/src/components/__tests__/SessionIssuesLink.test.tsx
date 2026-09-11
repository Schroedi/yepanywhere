import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SessionIssuesLink } from "../SessionIssuesLink";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  enabled: true,
}));
const runtime = { sourceKey: "localhost", transport: { fetch: state.fetch } };
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
vi.mock("../../hooks/useIssuesEnabled", () => ({
  useIssuesEnabled: () => state.enabled,
}));
vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

function result(count: number, more = false, active = false) {
  return {
    items: Array.from({ length: count }, (_, index) => ({ id: `i${index}` })),
    coverage: { settings: {}, active, error: null, counts: [] },
    nextOffset: more ? count : null,
  };
}

function tree(messageCount: number) {
  return (
    <I18nProvider>
      <MemoryRouter>
        <SessionIssuesLink
          sessionId="s1"
          projectId="p1"
          messageCount={messageCount}
        />
      </MemoryRouter>
    </I18nProvider>
  );
}

function renderLink(messageCount = 3) {
  return render(tree(messageCount));
}

describe("SessionIssuesLink", () => {
  beforeEach(() => {
    state.enabled = true;
    state.fetch.mockReset();
  });
  afterEach(cleanup);

  it("links to the session's issues with a count badge", async () => {
    state.fetch.mockResolvedValue(result(2));
    renderLink();
    const link = await screen.findByRole("link", {
      name: "2 issues and pull requests associated with this session",
    });
    expect(link.getAttribute("href")).toBe("/issues?sessionId=s1&projectId=p1");
    // Kyle's header treatment labels the link; the count follows it.
    expect(link.textContent).toBe("Issues & PRs2");
    expect(link.querySelector("svg")).toBeTruthy();
    expect(state.fetch).toHaveBeenCalledWith(
      "/issues?sessionId=s1&projectId=p1&limit=100",
    );
  });

  it("names a single association in the singular", async () => {
    state.fetch.mockResolvedValue(result(1));
    renderLink();
    await screen.findByRole("link", {
      name: "1 issue or pull request associated with this session",
    });
  });

  it("marks a count that exceeds one page", async () => {
    state.fetch.mockResolvedValue(result(100, true));
    renderLink();
    const link = await screen.findByRole("link", {
      name: "100+ issues and pull requests associated with this session",
    });
    expect(link.textContent).toBe("Issues & PRs100+");
  });

  it("shows the icon with no badge when nothing is associated", async () => {
    state.fetch.mockResolvedValue(result(0));
    renderLink();
    const link = await screen.findByRole("link", {
      name: "Issues & PRs for this session",
    });
    expect(link.textContent).toBe("Issues & PRs");
  });

  it("shows no count rather than a stale one when the count cannot be read", async () => {
    state.fetch.mockRejectedValue(new Error("offline"));
    renderLink();
    const link = await screen.findByRole("link", {
      name: "Issues & PRs for this session",
    });
    await waitFor(() => expect(state.fetch).toHaveBeenCalled());
    expect(link.textContent).toBe("Issues & PRs");
  });

  it("follows a settling count, stops, and restarts as the transcript grows", async () => {
    vi.useFakeTimers();
    try {
      // Opening the session queues its own text, so the first answer predates
      // the references in it and the count is asked for again.
      state.fetch.mockResolvedValue(result(0, false, true));
      const { rerender } = renderLink(3);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByRole("link").textContent).toBe("Issues & PRs");

      state.fetch.mockResolvedValue(result(2, false, false));
      await act(() => vi.advanceTimersByTimeAsync(4000));
      expect(screen.getByRole("link").textContent).toBe("Issues & PRs2");
      expect(state.fetch).toHaveBeenCalledTimes(2);

      // Rechecks are bounded: a quiet session stops asking instead of polling.
      await act(() => vi.advanceTimersByTimeAsync(60000));
      expect(state.fetch).toHaveBeenCalledTimes(4);

      // New messages restart them, and the known count stays on screen while
      // the next answer is pending.
      state.fetch.mockResolvedValue(result(3, false, false));
      rerender(tree(4));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(screen.getByRole("link").textContent).toBe("Issues & PRs2");
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(screen.getByRole("link").textContent).toBe("Issues & PRs3");
      expect(state.fetch).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders nothing while the feature is off", () => {
    state.enabled = false;
    const { container } = renderLink();
    expect(container.textContent).toBe("");
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
