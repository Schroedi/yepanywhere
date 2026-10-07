import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeSourceTransport } from "../../src/lib/transport/NativeSourceTransport";
import { NativeTransportFixture } from "../../src/lib/transport/__tests__/nativeTransportFixture";

let transport: NativeSourceTransport | undefined;
afterEach(() => {
  transport?.dispose();
  vi.useRealTimers();
});
async function setup() {
  const host = new NativeTransportFixture();
  transport = new NativeSourceTransport(host.channel);
  await transport.ready;
  await vi.waitFor(() =>
    expect(transport?.status.getSnapshot().state).toBe("ready"),
  );
  return { host, source: transport };
}

describe("native lifecycle: observed behavior and explicit red acceptance cases", () => {
  it("does retry a failed source on its 60-second visible backstop", async () => {
    const { host, source } = await setup();
    vi.useFakeTimers();
    await host.emit({ type: "state", phase: "FAILED" });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(host.commands).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.commands.map((command) => command.method)).toEqual([
      "reconnect",
    ]);
    expect(source.status.getSnapshot().state).toBe("ready");
  });

  it("keeps exhausted network recovery visibly reconnecting", async () => {
    const { host, source } = await setup();
    await host.emit({ type: "state", phase: "FAILED" });
    // Source transport contract: retry exhaustion is not terminal disconnect.
    expect(source.status.getSnapshot().state).toBe("reconnecting");
  });

  it("demonstrates that a fabricated 503 bypasses read recovery before retry state arrives", async () => {
    const { host, source } = await setup();
    let reads = 0;
    host.handler = () => {
      reads++;
      // Captured Kotlin connector behavior, not an actual YA HTTP response.
      // Native's phase notification can arrive after this operation reply.
      if (reads === 1)
        return {
          status: 503,
          headers: {},
          body: { error: "Native connection unavailable" },
        };
      return { status: 200, headers: {}, body: { recovered: true } };
    };
    // Characterization, not desired acceptance: the bridge must stop creating
    // this HTTP-shaped reply. Teaching the client to retry real 503s is wrong.
    await expect(source.fetch("/projects")).rejects.toThrow("API error: 503");
    expect(reads).toBe(1);
  });
});
