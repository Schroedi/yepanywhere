import { describe, expect, it, vi } from "vitest";
import { AcliToolOutput, type AcliOutputProjection } from "../acliToolOutput";

const note = (text: string) =>
  JSON.stringify({ _acli: { commentary: [{ text }] } });
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("acli tool output publication", () => {
  it("publishes a record atomically after Markdown resolves and deduplicates replay", async () => {
    let finish!: (html: string[]) => void;
    const render = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    );
    const publications: AcliOutputProjection[] = [];
    const stream = new AcliToolOutput(render, (value) =>
      publications.push(value),
    );
    const source = `${JSON.stringify({ value: 1, _acli: { commentary: [{ text: "**Ready**" }] } })}\n`;
    stream.appendSnapshot(source.slice(0, 20), false);
    expect(publications).toEqual([]);
    stream.appendSnapshot(source, false);
    expect(publications).toEqual([]);
    expect(render).toHaveBeenCalledTimes(1);
    finish(["<p><strong>Ready</strong></p>"]);
    await tick();
    expect(publications.at(-1)?.stdout).toBe('{"value":1}\n');
    expect(publications.at(-1)?.commentary[0]?.text).toBe("**Ready**");
    stream.appendSnapshot(source, true);
    expect(publications.at(-1)?.complete).toBe(true);
    stream.appendSnapshot(source, true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(publications.at(-1)?.commentary).toHaveLength(1);
  });

  it("keeps JSONL context within one invocation and skips standalone predecessors", async () => {
    const snapshots: AcliOutputProjection[] = [];
    const render = async (texts: string[]) =>
      texts.map((text) => `<p>${text}</p>`);
    const stream = new AcliToolOutput(render, (value) => snapshots.push(value));
    stream.appendSnapshot(
      `${note("First")}\n{"value":1}\n${note("Second")}\n${note("Third")}\n`,
      true,
    );
    await tick();
    const output = snapshots.at(-1)!;
    expect(output.stdout).toBe('{"value":1}\n');
    expect(
      output.commentary.map((item) => item.getContext?.() ?? null),
    ).toEqual([null, '{"value":1}\n', '{"value":1}\n']);
    const separate: AcliOutputProjection[] = [];
    new AcliToolOutput(render, (value) => separate.push(value)).appendSnapshot(
      note("Other call"),
      true,
    );
    await tick();
    expect(separate.at(-1)?.commentary[0]?.getContext).toBeNull();
  });

  it("does not cache a partial final snapshot while more records wait for rendering", async () => {
    const pending: ((html: string[]) => void)[] = [];
    const snapshots: AcliOutputProjection[] = [];
    const stream = new AcliToolOutput(
      () => new Promise((resolve) => pending.push(resolve)),
      (value) => snapshots.push(value),
    );
    stream.appendSnapshot(`${note("One")}\n`, false);
    stream.appendSnapshot(`${note("One")}\n${note("Two")}\n`, true);
    pending.shift()!(["<p>One</p>"]);
    await tick();
    expect(snapshots.at(-1)?.complete).toBe(false);
    pending.shift()!(["<p>Two</p>"]);
    await tick();
    expect(snapshots.at(-1)?.complete).toBe(true);
    expect(snapshots.at(-1)?.commentary).toHaveLength(2);
  });

  it("retains raw output on rendering failure and stops publication after unmount", async () => {
    const snapshots: AcliOutputProjection[] = [];
    const source = `${note("Keep me")}\n`;
    const stream = new AcliToolOutput(
      async () => {
        throw new Error("Offline");
      },
      (value) => snapshots.push(value),
    );
    stream.appendSnapshot(source, true);
    await tick();
    expect(snapshots.at(-1)).toMatchObject({
      stdout: source,
      commentary: [],
      failed: true,
    });
    const stopped = new AcliToolOutput(
      async () => ["<p>Late</p>"],
      (value) => snapshots.push(value),
    );
    stopped.appendSnapshot(source, true);
    stopped.stop();
    await tick();
    expect(snapshots).toHaveLength(1);
  });
});
