import { afterEach, describe, expect, it } from "vitest";
import {
  isLinuxProviderHostDegraded,
  resetLinuxProviderHostDegradedForTests,
  setLinuxProviderHostDegraded,
} from "../../../src/sdk/providers/provider-host-status.js";

describe("Linux provider-host degraded notice", () => {
  afterEach(() => {
    resetLinuxProviderHostDegradedForTests();
  });

  it("stays off until Linux boot records a failed ensure", () => {
    expect(isLinuxProviderHostDegraded()).toBe(false);
    setLinuxProviderHostDegraded(true);
    expect(isLinuxProviderHostDegraded()).toBe(process.platform === "linux");
    setLinuxProviderHostDegraded(false);
    expect(isLinuxProviderHostDegraded()).toBe(false);
  });
});
