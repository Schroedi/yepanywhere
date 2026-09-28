// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearchMatchHighlight } from "./useSearchMatchHighlight";

function mountRow() {
  const scrollport = document.createElement("div");
  const row = document.createElement("div");
  row.textContent = "The specimen is ready.";
  scrollport.append(row);
  document.body.append(scrollport);
  return { row, scrollport };
}

describe("useSearchMatchHighlight", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("does not let a reveal begun before a clear repaint after it", () => {
    const { result } = renderHook(() => useSearchMatchHighlight(false));
    const { row, scrollport } = mountRow();

    act(() => {
      result.current.beginSearchMatchReveal()(row, scrollport, "ready", false);
    });
    expect(row.dataset.searchMatch).toBe("true");

    const lateReveal = result.current.beginSearchMatchReveal();
    result.current.clearSearchMatchHighlight();
    expect(row.dataset.searchMatch).toBeUndefined();

    lateReveal(row, scrollport, "ready", false);
    expect(row.dataset.searchMatch).toBeUndefined();

    // A reveal begun after the clear still highlights normally.
    result.current.beginSearchMatchReveal()(row, scrollport, "ready", false);
    expect(row.dataset.searchMatch).toBe("true");
  });

  it("starts the idle fade on arrival and renews it on reader activity", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSearchMatchHighlight(false));
    const { row, scrollport } = mountRow();
    const arrive = result.current.beginSearchMatchReveal();
    vi.advanceTimersByTime(10000);
    arrive(row, scrollport, "ready", false);
    vi.advanceTimersByTime(1900);
    result.current.markSearchMatchLanded();
    vi.advanceTimersByTime(1999);
    expect(row.className).not.toMatch(/fading/);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    vi.advanceTimersByTime(1999);
    expect(row.className).not.toMatch(/fading/);
    vi.advanceTimersByTime(1);
    expect(row.className).toMatch(/fading/);
    expect(row.dataset.searchMatch).toBe("true");
    vi.advanceTimersByTime(3000);
    expect(row.dataset.searchMatch).toBeUndefined();
  });
});
