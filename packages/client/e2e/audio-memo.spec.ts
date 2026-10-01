import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures";
import { recordUiCapture } from "./support/ui-capture";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});

test("audio memo captures WAV, preserves draft on cancel, and uploads before sending", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    localStorage.setItem("yep-anywhere-speech-method", "ya-dummy");
    localStorage.setItem("yep-anywhere-attachment-action", "menu");
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const streams: MediaStream[] = [];
    Object.defineProperty(window, "__memoStreams", { value: streams });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      streams.push(stream);
      return stream;
    };
  });
  await page.route("**/api/version", async (route) => {
    const response = await route.fetch();
    const version = await response.json();
    await route.fulfill({
      json: {
        ...version,
        capabilities: [...(version.capabilities ?? []), "voice-input"],
        voiceBackends: ["ya-dummy"],
        voiceBackendCapabilities: { "ya-dummy": { streaming: true } },
      },
    });
  });
  let speechFrames = 0;
  let speechClosed = 0;
  await page.routeWebSocket("**/api/speech/ws", (socket) => {
    socket.onClose(() => {
      speechClosed++;
    });
    socket.onMessage((data) => {
      if (typeof data !== "string") {
        speechFrames++;
        socket.send(
          JSON.stringify({ type: "interim", text: "Draft from live audio" }),
        );
      } else if (JSON.parse(data).type === "start") {
        socket.send(JSON.stringify({ type: "ready" }));
      }
    });
  });
  let failUpload = true;
  await page.routeWebSocket("**/upload/ws", (socket) => {
    if (failUpload) {
      failUpload = false;
      socket.close({ code: 1011, reason: "Test upload interruption" });
    } else socket.connectToServer();
  });
  let transcriptions = 0;
  await page.route("**/api/speech/transcribe", async (route) => {
    transcriptions++;
    const body = route.request().postDataJSON();
    expect(body.mimeType).toBe("audio/wav");
    expect(Buffer.from(body.audioBase64, "base64").readUInt32LE(24)).toBe(
      24000,
    );
    await route.fulfill({ json: { text: "Please keep the word send." } });
  });
  let submitted:
    | { message: string; attachments: { path: string; mimeType: string }[] }
    | undefined;
  await page.route("**/sessions/mock-session-001/resume", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      json: {
        processId: "audio-memo-test",
        permissionMode: "default",
        modeVersion: 1,
        serverTimestamp: Date.now(),
      },
    });
  });
  const projectId = Buffer.from(join(e2ePaths.tempDir, "mockproject")).toString(
    "base64url",
  );
  await page.goto(`${baseURL}/projects/${projectId}/sessions/mock-session-001`);
  const input = page.locator("[data-composer-input]");
  await expect(input).toBeVisible();
  await input.focus();
  for (const character of "Listen to this.") {
    const before = await input.inputValue();
    await page.keyboard.type(character);
    expect(await input.inputValue()).toBe(before + character);
  }
  const attach = page.getByRole("button", {
    name: "Attach files",
    exact: true,
  });
  await attach.click();
  await expect(
    page.getByRole("menu", { name: "Share to session" }),
  ).toBeVisible();
  await recordUiCapture(page, "audio-memo-phone-menu");
  await page.getByRole("menuitem", { name: "Record audio memo" }).click();
  const stop = page.getByRole("button", {
    name: /Tap anywhere here to stop & send/,
  });
  await expect(stop).toBeEnabled();
  await expect(
    page.getByText("Draft from live audio", { exact: true }),
  ).toBeVisible();
  expect(speechFrames).toBeGreaterThan(0);
  await recordUiCapture(page, "audio-memo-phone-streaming");
  await expect(
    page.getByRole("checkbox", { name: "Include transcript" }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "Include transcript" }).uncheck();
  await expect(
    page.getByText("Draft from live audio", { exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => speechClosed).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { __memoStreams: MediaStream[] }
        ).__memoStreams[0]!.getAudioTracks()[0]!.readyState,
    ),
  ).toBe("live");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(stop).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(input).toHaveValue("Listen to this.");
  expect(submitted).toBeUndefined();
  expect(transcriptions).toBe(0);

  await attach.click({ modifiers: ["Shift"] });
  await expect(stop).toBeEnabled();
  await page.getByRole("checkbox", { name: "Include transcript" }).check();
  await recordUiCapture(page, "audio-memo-phone-recording");
  await page.setViewportSize({ width: 1000, height: 600 });
  await recordUiCapture(page, "audio-memo-desktop-recording");
  await page.keyboard.press("Control+Shift+Space");
  await expect(
    page.getByRole("alert").filter({ hasText: "Audio upload failed" }),
  ).toBeVisible();
  expect(submitted).toBeUndefined();
  await page.getByRole("button", { name: /Retry sending this take/ }).click();
  await expect.poll(() => submitted).toBeDefined();
  expect(submitted!.message).toBe(
    "Listen to this.\n\n🎤 Audio transcript\nPlease keep the word send.",
  );
  expect(submitted!.attachments).toHaveLength(1);
  const attachment = submitted!.attachments[0]!;
  expect(attachment.mimeType).toBe("audio/wav");
  const wav = await readFile(attachment.path);
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.readUInt16LE(22)).toBe(1);
  expect(wav.readUInt32LE(24)).toBe(24000);
  expect(wav.readUInt16LE(34)).toBe(16);
  expect(wav.length).toBeGreaterThan(44);
  expect(transcriptions).toBe(1);
});
