import { afterEach, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import { NativeSourceTransport } from "../NativeSourceTransport";
import { NativeTransportFixture } from "./nativeTransportFixture";

const transports: NativeSourceTransport[] = [];
async function setup(binary = true) {
  const host = new NativeTransportFixture(binary);
  const transport = new NativeSourceTransport(host.channel);
  transports.push(transport);
  await transport.ready;
  await vi.waitFor(() =>
    expect(transport.status.getSnapshot().state).toBe("ready"),
  );
  return { host, transport };
}
afterEach(() => {
  for (const transport of transports.splice(0)) transport.dispose();
});

describe("native source transport", () => {
  it("waits for cold native demand instead of treating initial idle as terminal", async () => {
    const { host, transport } = await setup();
    await host.emit({ type: "state", phase: "IDLE" });
    const request = transport.fetch("/version");
    await Promise.resolve();
    expect(host.commands).toHaveLength(0);
    await host.emit({ type: "state", phase: "CONNECTED" });
    expect(await request).toEqual({ ok: true });
  });
  it("streams a 1 MiB attachment with credit and native upload handles", async () => {
    const { host, transport } = await setup();
    host.handler = (command) => {
      if (command.method === "uploadEnd") {
        void host.emit({
          type: "upload_complete",
          uploadId: (command.params as { uploadId: string }).uploadId,
          stagedRef: { id: "attachment-one" },
        });
      }
      return {};
    };
    const file = new NodeFile(
      [new Uint8Array(1024 * 1024)],
      "large.bin",
    ) as unknown as File;
    expect(await transport.uploadStagedAttachment(file)).toEqual({
      id: "attachment-one",
    });
    expect(
      host.chunks.reduce((total, chunk) => total + chunk.length - 24, 0),
    ).toBe(file.size);
    expect(host.chunks.every((chunk) => chunk.length <= 65_560)).toBe(true);
  });

  it("aborts an upload while native startup is pending", async () => {
    const { host, transport } = await setup();
    host.handler = (command) =>
      command.method === "uploadStart" ? new Promise(() => {}) : {};
    const controller = new AbortController();
    const file = new NodeFile(["attachment"], "test.txt") as unknown as File;
    const upload = transport.uploadStagedAttachment(file, {
      signal: controller.signal,
    });
    const rejected = expect(upload).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() =>
      expect(host.commands.at(-1)?.method).toBe("uploadStart"),
    );
    controller.abort();
    await rejected;
    await vi.waitFor(() =>
      expect(
        host.commands.some((command) => command.method === "uploadCancel"),
      ).toBe(true),
    );
    expect(host.chunks).toHaveLength(0);
  });

  it.each([true, false])(
    "enters a native source and carries large JSON with binary=%s",
    async (binary) => {
      const { host, transport } = await setup(binary);
      const body = { text: "x".repeat(1024 * 1024) };
      host.handler = () => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body,
      });
      expect(await transport.fetch("/sessions")).toEqual(body);
      expect(host.commands[0]).toMatchObject({
        handle: "document-one",
        method: "request",
        params: { path: "/api/sessions" },
      });
      expect(transport.capabilities).toEqual({ sameOriginUrls: false });
      expect(
        localStorage.getItem("yep-anywhere-remote-credentials"),
      ).toBeNull();
    },
  );

  it("preserves redirects, binary media and API error status", async () => {
    const { host, transport } = await setup();
    host.handler = (command) => {
      const path = (command.params as { path: string }).path;
      if (path === "/api/redirect")
        return { status: 302, headers: { Location: "/api/media" }, body: null };
      if (path === "/api/media")
        return {
          status: 200,
          headers: { "content-type": "image/png" },
          body: { _binary: true, data: btoa("png") },
        };
      return { status: 403, headers: {}, body: { error: "denied" } };
    };
    const response = await transport.fetchResponse("/redirect");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("png");
    await expect(transport.fetch("/forbidden")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("cancels an abandoned native request and ignores its late reply", async () => {
    const { host, transport } = await setup();
    host.handler = () => new Promise(() => {});
    const controller = new AbortController();
    const request = transport.fetch("/slow", { signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(host.commands.length).toBe(1));
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(host.commands.at(-1)?.method).toBe("cancel"));
    expect(host.commands.at(-1)?.params).toEqual({ id: host.commands[0]?.id });
  });

  it("delivers native subscriptions and opens the native host picker", async () => {
    const { host, transport } = await setup();
    const onEvent = vi.fn();
    const subscription = transport.subscribeSession(
      "session-one",
      { onEvent },
      "event-4",
      { wantsLiveDeltas: true },
    );
    await vi.waitFor(() => expect(host.commands.length).toBe(1));
    const params = host.commands[0]?.params as { subscriptionId: string };
    await host.emit({
      type: "event",
      subscriptionId: params.subscriptionId,
      eventType: "text_delta",
      eventId: "event-5",
      data: { text: "Hello" },
    });
    expect(onEvent).toHaveBeenCalledWith("text_delta", "event-5", {
      text: "Hello",
    });
    subscription.close();
    await transport.switchHost();
    expect(
      host.commands.some((command) => command.method === "unsubscribe"),
    ).toBe(true);
    expect(host.commands.at(-1)?.method).toBe("switchHost");
  });
});
