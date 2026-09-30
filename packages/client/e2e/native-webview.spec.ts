import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emitCapturePreview,
  writeCapturePreview,
} from "../scripts/artifact-capture.js";
import { e2ePaths, expect, test } from "./fixtures.js";

for (const viewport of [
  { name: "desktop", width: 1000, height: 600 },
  { name: "phone", width: 375, height: 812 },
]) {
  test(`native source opens the full app and acknowledges typing at ${viewport.name}`, async ({
    page,
    baseURL,
    remoteClientURL,
  }, testInfo) => {
    // Full-suite observations: 4.1 s desktop, 4.0 s phone. Inherit the
    // 15 s test budget (~3.7x observed maximum), including capture work.
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.exposeBinding(
      "nativeRequest",
      async (
        _,
        command: {
          params: {
            path: string;
            method: string;
            headers?: Record<string, string>;
            body?: unknown;
          };
        },
      ) => {
        const params = command.params;
        const response = await fetch(`${baseURL}${params.path}`, {
          method: params.method,
          headers: params.headers,
          body: params.body == null ? undefined : JSON.stringify(params.body),
          redirect: "manual",
        });
        const headers = Object.fromEntries(response.headers);
        const bytes = Buffer.from(await response.arrayBuffer());
        const body = headers["content-type"]?.includes("json")
          ? JSON.parse(bytes.toString())
          : { _binary: true, data: bytes.toString("base64") };
        return { status: response.status, headers, body };
      },
    );
    await page.addInitScript(
      ({ moduleUrl }) => {
        const queued: (string | ArrayBuffer)[] = [];
        const channel = {
          onmessage: null as
            | ((event: { data: string | ArrayBuffer }) => void)
            | null,
          postMessage: (message: string | ArrayBuffer) => {
            queued.push(message);
          },
        };
        Object.assign(window, { yaNativeTransport: channel });
        void import(moduleUrl).then(({ NativeTransportFixture }) => {
          const host = new NativeTransportFixture();
          host.channel.onmessage = (event: { data: string | ArrayBuffer }) =>
            channel.onmessage?.(event);
          channel.postMessage = (message) => host.channel.postMessage(message);
          host.handler = (command: Record<string, unknown>) => {
            if (command.method === "request")
              return (
                window as unknown as {
                  nativeRequest: (command: unknown) => Promise<unknown>;
                }
              ).nativeRequest(command);
            if (command.method === "subscribe") {
              void host.emit({
                type: "event",
                subscriptionId: (command.params as { subscriptionId: string })
                  .subscriptionId,
                eventType: "connected",
                data: {},
              });
            }
            return {};
          };
          Object.assign(window, { nativeFixture: host });
          for (const message of queued) host.channel.postMessage(message);
        });
      },
      {
        moduleUrl: `${remoteClientURL}/src/lib/transport/__tests__/nativeTransportFixture.ts`,
      },
    );

    const projectId = Buffer.from(
      join(e2ePaths.tempDir, "mockproject"),
    ).toString("base64url");
    await page.goto(
      `${remoteClientURL}/projects/${projectId}/sessions/transcript-specimen-001`,
    );
    const skip = page.locator(".onboarding-skip-all");
    if (await skip.isVisible().catch(() => false)) await skip.click();
    const composer = page.locator("textarea[data-composer-input]");
    await expect(composer).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator(".message-list")).toBeVisible();

    await page.evaluate(() => {
      const host = (
        window as unknown as {
          nativeFixture: { emit: (event: unknown) => Promise<void> };
        }
      ).nativeFixture;
      const pad = "x".repeat(1024 * 1024);
      Object.assign(window, {
        nativeLoadTimer: setInterval(() => {
          void host.emit({ type: "state", phase: "CONNECTED", pad });
        }, 50),
        nativeTypingLatencies: [],
      });
      const input = document.querySelector<HTMLTextAreaElement>(
        "textarea[data-composer-input]",
      );
      input?.addEventListener("keydown", () => {
        const started = performance.now();
        input.addEventListener(
          "input",
          () => {
            requestAnimationFrame(() =>
              (
                window as unknown as { nativeTypingLatencies: number[] }
              ).nativeTypingLatencies.push(performance.now() - started),
            );
          },
          { once: true },
        );
      });
    });
    await composer.click();
    const text =
      "Native transport keeps every key responsive during incoming updates.";
    await composer.pressSequentially(text, { delay: 35 });
    await expect(composer).toHaveValue(text);
    await page.evaluate(() =>
      clearInterval(
        (window as unknown as { nativeLoadTimer: number }).nativeLoadTimer,
      ),
    );
    const latencies = await page.evaluate(
      () =>
        (window as unknown as { nativeTypingLatencies: number[] })
          .nativeTypingLatencies,
    );
    expect(latencies).toHaveLength(text.length);
    expect(Math.max(...latencies)).toBeLessThanOrEqual(100);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          /remote-credentials|remote-session/.test(key),
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    const out = mkdtempSync(join(tmpdir(), "ya-native-webview-captures-"));
    const path = join(out, `${viewport.name}.png`);
    await page.screenshot({ path, animations: "disabled" });
    await testInfo.attach(viewport.name, { path, contentType: "image/png" });
    emitCapturePreview(
      await writeCapturePreview({
        input: page.url(),
        out: join(out, viewport.name),
        screenshots: [{ ...viewport, path }],
      }),
    );
    console.log(
      `Native typing ${viewport.name}: ${text.length} keys, maximum ${Math.max(...latencies).toFixed(1)} ms at 20 Hz / 1 MiB frames`,
    );
  });
}
