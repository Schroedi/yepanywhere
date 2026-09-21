import { describe, expect, it } from "vitest";
import {
  SessionTokenUsageRecorder,
  type SessionTokenUsageRecord,
} from "../../src/auth/SessionTokenUsageRecorder.js";
import type { Process } from "../../src/supervisor/Process.js";
import type { SDKMessage } from "../../src/sdk/types.js";

/** Contract: topics/limited-users.md § Delivery v1 — Usage. */

/**
 * The recorder reads five fields off a process. A real `Process` needs a live
 * provider to exist, so the test supplies exactly those fields.
 */
function fakeProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: "p1",
    sessionId: "s1",
    provider: "claude",
    projectPath: "/home/archer/code/yepanywhere",
    requestedModel: "opus",
    resolvedModel: "claude-opus-4-5-20251101",
    ...overrides,
  } as unknown as Process;
}

/** A Claude assistant frame as the SDK yields it: usage on the API message. */
function claudeFrame(options: {
  responseId: string;
  input: number;
  cacheRead?: number;
  output: number;
}): SDKMessage {
  return {
    type: "assistant",
    message: {
      id: options.responseId,
      usage: {
        input_tokens: options.input,
        cache_read_input_tokens: options.cacheRead ?? 0,
        output_tokens: options.output,
      },
    },
  } as unknown as SDKMessage;
}

/** Codex reports out of band, per request, with no response id to dedupe on. */
function codexFrame(options: { input: number; output: number }): SDKMessage {
  return {
    type: "system",
    subtype: "token_usage",
    usage: {
      input_tokens: options.input,
      cached_input_tokens: 0,
      output_tokens: options.output,
    },
  } as unknown as SDKMessage;
}

function recorderWithLog() {
  const records: SessionTokenUsageRecord[] = [];
  const recorder = new SessionTokenUsageRecorder({
    record: (record) => records.push(record),
    resolveUsername: (sessionId) => (sessionId === "s1" ? "archer" : undefined),
  });
  return { recorder, records };
}

describe("SessionTokenUsageRecorder", () => {
  it("appends one charge per settled turn, named by user, model and project", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 100, cacheRead: 900, output: 50 }),
    );
    recorder.flush(process);

    expect(records).toEqual([
      {
        username: "archer",
        model: "opus",
        modelId: "claude-opus-4-5-20251101",
        project: "yepanywhere",
        provider: "claude",
        longContext: false,
        // The classes stay apart: 900 of the 1000-token prompt was a cache
        // read, which costs a tenth of the 100 tokens actually processed.
        freshInputTokens: 100,
        cachedInputTokens: 900,
        cacheWriteTokens: 0,
        outputTokens: 50,
      },
    ]);
  });

  it("counts one response once however many frames repeat its usage", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();
    const frame = claudeFrame({ responseId: "r1", input: 1000, output: 50 });

    recorder.observeMessage(process, frame);
    recorder.observeMessage(process, frame);
    recorder.observeMessage(process, frame);
    recorder.flush(process);

    expect(records[0]).toMatchObject({
      freshInputTokens: 1000,
      outputTokens: 50,
    });
  });

  it("sums the separate requests one turn makes", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r2", input: 1200, output: 30 }),
    );
    recorder.flush(process);

    expect(records[0]).toMatchObject({
      freshInputTokens: 2200,
      outputTokens: 80,
    });
  });

  it("takes each out-of-band frame as its own request", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ provider: "codex" } as Partial<Process>);

    // Two real requests can legitimately report equal counts, so equality is
    // not evidence of a repeat when the provider names no response.
    recorder.observeMessage(process, codexFrame({ input: 500, output: 20 }));
    recorder.observeMessage(process, codexFrame({ input: 500, output: 20 }));
    recorder.flush(process);

    expect(records[0]).toMatchObject({
      freshInputTokens: 1000,
      outputTokens: 40,
    });
  });

  it("appends nothing when a turn produced no usage", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.flush(process);
    recorder.observeMessage(process, { type: "user" } as SDKMessage);
    recorder.flush(process);

    expect(records).toEqual([]);
  });

  it("starts over after a flush, so one charge is never appended twice", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.flush(process);
    recorder.flush(process);

    expect(records).toHaveLength(1);
  });

  it("still owes the last turn's charge when the process goes away", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.forgetProcess(process);

    expect(records).toHaveLength(1);
  });

  it("bins a long-context request apart from a short one", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess();

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r2", input: 300_000, output: 60 }),
    );
    recorder.flush(process);

    // One turn, two price lists: the tier is each request's own prompt length,
    // so the short request is not dragged into the premium by the long one.
    expect(records.map((record) => record.longContext)).toEqual([false, true]);
    expect(records[0]).toMatchObject({ freshInputTokens: 1000 });
    expect(records[1]).toMatchObject({ freshInputTokens: 300_000 });
  });

  it("leaves the username absent for the superuser", () => {
    const { recorder, records } = recorderWithLog();
    const process = fakeProcess({ sessionId: "unowned" });

    recorder.observeMessage(
      process,
      claudeFrame({ responseId: "r1", input: 1000, output: 50 }),
    );
    recorder.flush(process);

    expect(records[0]?.username).toBe(undefined);
  });
});
