import { describe, expect, it } from "vitest";
import { quoteRemotePath } from "../../src/sdk/remote-shell.js";

// Word-level quoting cases live with the canonical owner in
// test/utils/posixShell.test.ts.
describe("remote shell quoting", () => {
  it("expands only a leading $HOME token", () => {
    expect(quoteRemotePath("$HOME/project's/$(touch nope)\n-next")).toBe(
      "\"$HOME\"'/project'\\''s/$(touch nope)\n-next'",
    );
    expect(quoteRemotePath("/srv/$HOME/project")).toBe("'/srv/$HOME/project'");
  });
});
