import type { RelayResponse } from "@yep-anywhere/shared";
import { toFetchResponse } from "../connection/RelayProtocol";
import type { NativeTransportBridge } from "../nativeTransportBridge";

interface Head extends RelayResponse {
  streaming: boolean;
  responseId?: string;
  length?: number;
}

/** Native reads advance only when the Response consumer pulls another chunk. */
export class NativeResponseBodies {
  private readonly active = new Set<AbortController>();
  constructor(private readonly bridge: NativeTransportBridge) {}

  cancelAll(error: Error): void {
    for (const controller of [...this.active]) controller.abort(error);
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    if (this.active.size >= 8)
      throw new Error("Native response limit exceeded");
    const abort = new AbortController();
    const abandon = () => abort.abort(init?.signal?.reason);
    if (init?.signal?.aborted) abandon();
    init?.signal?.addEventListener("abort", abandon, { once: true });
    this.active.add(abort);
    let id: string | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finished = false;
    const release = (cancel: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(idle);
      this.active.delete(abort);
      init?.signal?.removeEventListener("abort", abandon);
      abort.signal.removeEventListener("abort", fail);
      if (cancel && id) this.bridge.cancelRequest(id);
    };
    const fail = () => {
      if (finished) return;
      body?.error(
        abort.signal.reason ?? new DOMException("Aborted", "AbortError"),
      );
      release(true);
    };
    const progress = () => {
      clearTimeout(idle);
      idle = setTimeout(
        () => abort.abort(new Error("Native response idle timeout")),
        120_000,
      );
    };
    abort.signal.addEventListener("abort", fail, { once: true });
    try {
      const head = await this.bridge.request<Head>(
        "responseStart",
        {
          path,
          headers: Object.fromEntries(new Headers(init?.headers)),
        },
        abort.signal,
      );
      id = head.responseId;
      if (abort.signal.aborted) throw abort.signal.reason;
      if (head.status >= 400) {
        throw Object.assign(new Error(`API error: ${head.status}`), {
          status: head.status,
          headers: new Headers(head.headers),
        });
      }
      if (!head.streaming) {
        release(false);
        const download =
          new URL(path, "https://native.invalid").searchParams.get(
            "download",
          ) === "true";
        return toFetchResponse(head, download);
      }
      if (
        typeof id !== "string" ||
        !id ||
        (head.length !== undefined &&
          (!Number.isSafeInteger(head.length) || head.length < 0))
      )
        throw new Error("Invalid native response metadata");
      const headers = new Headers(head.headers);
      if (head.length !== undefined)
        headers.set("content-length", String(head.length));
      let received = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            body = controller;
            progress();
          },
          pull: async (controller) => {
            try {
              const chunk = await this.bridge.request<
                Uint8Array | { done: true }
              >("responseRead", { responseId: id }, abort.signal);
              if (finished) return;
              if (chunk instanceof Uint8Array) {
                if (!chunk.byteLength || chunk.byteLength > 128 * 1024)
                  throw new Error("Invalid native response chunk");
                received += chunk.byteLength;
                if (head.length !== undefined && received > head.length)
                  throw new Error("Native response exceeds its length");
                controller.enqueue(chunk);
                progress();
              } else {
                if (
                  chunk?.done !== true ||
                  (head.length !== undefined && received !== head.length)
                )
                  throw new Error("Incomplete native response");
                release(false);
                controller.close();
              }
            } catch (error) {
              if (!finished) {
                controller.error(error);
                release(true);
              }
            }
          },
          cancel: (reason) => {
            release(true);
            abort.abort(reason);
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(stream, { status: head.status, headers });
    } catch (error) {
      release(true);
      throw error;
    }
  }
}
