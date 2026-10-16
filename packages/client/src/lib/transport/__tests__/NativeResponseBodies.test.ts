import { afterEach, expect, it, vi } from "vitest";
import { NativeSourceTransport } from "../NativeSourceTransport";
import { NativeTransportFixture } from "./nativeTransportFixture";

const sources: NativeSourceTransport[] = [];
async function setup(binary = true) {
  const host = new NativeTransportFixture(binary, "CONNECTED", true);
  const source = new NativeSourceTransport(host.channel);
  sources.push(source);
  await source.ready;
  return { host, source };
}
afterEach(() => {
  for (const source of sources.splice(0)) source.dispose();
  vi.useRealTimers();
});

it.each([true, false])(
  "pulls exact byte chunks across the credited bridge (binary=%s)",
  async (binary) => {
    const { host, source } = await setup(binary);
    let reads = 0;
    host.handler = (command) =>
      command.method === "responseStart"
        ? {
            streaming: true,
            responseId: command.id,
            status: 206,
            length: 131072,
            headers: {
              "content-type": "video/mp4",
              "content-range": "bytes 9-131080/999999",
            },
          }
        : ++reads === 1
          ? new Uint8Array(131072).fill(179)
          : { done: true };
    const response = await source.fetchStream("/movie", {
      headers: { Range: "bytes=9-131080" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 9-131080/999999");
    expect(host.commands).toHaveLength(1);
    expect(host.commands[0]?.params).toMatchObject({
      headers: { range: "bytes=9-131080" },
    });
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(
      new Uint8Array(131072).fill(179),
    );
    expect(host.commands).toHaveLength(2);
    expect((await reader.read()).done).toBe(true);
    expect(reads).toBe(2);
  },
);

it.each(["reader", "signal", "suspend", "dispose"])(
  "cancels a blocked producer on %s and ignores its late bytes",
  async (mode) => {
    const { host, source } = await setup();
    let complete!: (value: Uint8Array) => void;
    host.handler = (command) => {
      if (command.method === "responseStart")
        return { streaming: true, responseId: command.id, status: 200 };
      if (command.method === "responseRead")
        return new Promise<Uint8Array>((resolve) => {
          complete = resolve;
        });
      return { status: 200, body: { healthy: true } };
    };
    const abort = new AbortController();
    const response = await source.fetchStream("/movie", {
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    const read = reader.read();
    const observed = read.catch(() => undefined);
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    if (mode === "reader") await reader.cancel();
    else if (mode === "signal") abort.abort();
    else if (mode === "suspend")
      await host.emit({ type: "state", phase: "SUSPENDED" });
    else source.dispose();
    await observed;
    complete(new Uint8Array(16).fill(99));
    if (mode !== "dispose") {
      if (mode !== "suspend")
        await vi.waitFor(() =>
          expect(host.commands.some((c) => c.method === "cancel")).toBe(true),
        );
      if (mode === "suspend")
        await host.emit({ type: "state", phase: "CONNECTED" });
      await expect(source.fetch("/health")).resolves.toEqual({ healthy: true });
      expect(source.status.getSnapshot().state).toBe("ready");
    }
  },
);

it("fails a truncated body instead of returning a successful short movie", async () => {
  const { host, source } = await setup();
  host.handler = (c) =>
    c.method === "responseStart"
      ? { streaming: true, responseId: c.id, status: 200, length: 10 }
      : { done: true };
  const response = await source.fetchStream("/movie");
  await expect(response.arrayBuffer()).rejects.toThrow("Incomplete");
});

it("retains buffered JSON compatibility and decodes only explicit binary downloads", async () => {
  const { host, source } = await setup();
  const text = '{ "value": 9007199254740993 }\n';
  const envelope = { _binary: true, data: btoa(text) };
  host.handler = () => ({
    streaming: false,
    status: 200,
    headers: { "content-type": "application/json" },
    body: envelope,
  });
  expect(await (await source.fetchStream("/file?download=true")).text()).toBe(
    text,
  );
  expect(await (await source.fetchStream("/ordinary-json")).json()).toEqual(
    envelope,
  );
});

it("bounds abandoned bodies and expires idle readers without closing the bridge", async () => {
  const { host, source } = await setup();
  host.handler = (c) => ({ streaming: true, responseId: c.id, status: 200 });
  vi.useFakeTimers();
  const responses = [];
  for (let i = 0; i < 8; i++)
    responses.push(await source.fetchStream("/movie"));
  await expect(source.fetchStream("/movie")).rejects.toThrow("limit");
  await vi.advanceTimersByTimeAsync(120_000);
  await expect(responses[0]!.arrayBuffer()).rejects.toThrow("idle timeout");
  expect(source.status.getSnapshot().state).toBe("ready");
});
