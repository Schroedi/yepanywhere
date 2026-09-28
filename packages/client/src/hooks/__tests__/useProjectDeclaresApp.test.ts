import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();
vi.mock("../../api/projectApp", () => ({
  projectAppApi: { info: (id: string) => info(id) },
}));

import { useProjectDeclaresApp } from "../useProjectDeclaresApp";

afterEach(() => {
  cleanup();
  info.mockReset();
});

describe("useProjectDeclaresApp", () => {
  it("offers the app once the project reports a declaration", async () => {
    info.mockResolvedValue({ declaration: { version: 1 } });
    const { result } = renderHook(() => useProjectDeclaresApp("p1", true));
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(info).toHaveBeenCalledWith("p1");
  });

  it("offers nothing for a project without one, or when a lookup fails", async () => {
    info.mockResolvedValueOnce({ declaration: null, latestArtifact: null });
    const none = renderHook(() => useProjectDeclaresApp("p1", true));
    info.mockRejectedValueOnce(new Error("not found"));
    const failed = renderHook(() => useProjectDeclaresApp("p2", true));
    await waitFor(() => expect(info).toHaveBeenCalledTimes(2));
    expect(none.result.current).toBe(false);
    expect(failed.result.current).toBe(false);
  });

  it("does not ask when disabled, and drops an answer for another project", async () => {
    info.mockResolvedValue({ declaration: { version: 1 } });
    renderHook(() => useProjectDeclaresApp("p1", false));
    expect(info).not.toHaveBeenCalled();

    const { result, rerender } = renderHook(
      ({ id }) => useProjectDeclaresApp(id, true),
      { initialProps: { id: "p1" } },
    );
    await waitFor(() => expect(result.current).toBe(true));
    info.mockReturnValue(new Promise(() => {}));
    rerender({ id: "p2" });
    expect(result.current).toBe(false);
  });
});
