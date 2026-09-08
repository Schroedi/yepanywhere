import {
  AcliRecordFramer,
  acliCommentaryFormat,
  decodeAcliCommentaryLine,
  decodeAcliRecord,
  getAcliContext,
  type AcliRecord,
} from "@yep-anywhere/shared";

export interface PresentedCommentary {
  id: string;
  text: string;
  html: string;
  getContext: (() => string) | null;
}

export interface AcliOutputProjection {
  stdout: string;
  stderr: string;
  commentary: PresentedCommentary[];
  failed: boolean;
  complete: boolean;
}

interface PendingRecord {
  id: number;
  record: AcliRecord;
  stream: OutputStream;
  getPreviousContext: (() => string) | null;
}

class OutputStream {
  source = "";
  framer: AcliRecordFramer | null = null;
  format: "json" | "lines" | "raw" = "raw";
  previous: AcliRecord | null = null;
  textBlock: string[] = [];
  afterCommentary = false;
  data: string[] = [];
}

/** One invocation owns framing, context, render ordering, and publication. */
export class AcliToolOutput {
  private stdout = new OutputStream();
  private stderr = new OutputStream();
  private finished = false;
  private records: PendingRecord[] = [];
  private nextId = 0;
  private active = false;
  private stopped = false;
  private projection: AcliOutputProjection = {
    stdout: "",
    stderr: "",
    commentary: [],
    failed: false,
    complete: false,
  };

  constructor(
    private render: (texts: string[]) => Promise<string[]>,
    private publish: (projection: AcliOutputProjection) => void,
    cached?: {
      source: string;
      stderr: string;
      projection: AcliOutputProjection;
    },
    private stdoutSequenced = true,
  ) {
    if (cached) {
      this.stdout.source = cached.source;
      this.stderr.source = cached.stderr;
      this.finished = true;
      this.projection = cached.projection;
    }
  }

  appendSnapshot(source: string, complete: boolean, stderr = ""): boolean {
    if (this.stopped) return false;
    for (const [stream, text] of [
      [this.stdout, source],
      [this.stderr, stderr],
    ] as const)
      if (
        !text.startsWith(stream.source) ||
        (this.finished && text !== stream.source)
      )
        return false;
    if (this.finished) return true;
    const jsonDeclared = [source, stderr].some(
      (text) => acliCommentaryFormat(text.split("\n", 1)[0]!) === "json",
    );
    this.appendStream(this.stdout, source, complete, jsonDeclared);
    this.appendStream(this.stderr, stderr, complete, false);
    this.finished = complete;
    if (
      this.finished &&
      !this.active &&
      this.records.length === 0 &&
      !this.projection.complete
    ) {
      this.projection = { ...this.projection, complete: true };
      this.publish(this.projection);
    }
    void this.drain();
    return true;
  }

  private appendStream(
    stream: OutputStream,
    source: string,
    complete: boolean,
    jsonDeclared: boolean,
  ) {
    let offset = stream.source.length;
    if (!stream.framer) {
      const newline = source.indexOf("\n");
      if (newline < 0 && !complete) return;
      const first = source.slice(0, newline < 0 ? source.length : newline);
      const format = first.length <= 4096 ? acliCommentaryFormat(first) : null;
      stream.format =
        format === "lines" ? "lines" : jsonDeclared ? "json" : "raw";
      stream.framer = new AcliRecordFramer(
        stream.format === "json" ? "json" : "lines",
      );
      if (format) offset = newline < 0 ? source.length : newline + 1;
    }
    const frames = stream.framer.append(source.slice(offset));
    stream.source = source;
    if (complete) frames.push(...stream.framer.finish());
    for (const frame of frames) {
      const record =
        stream.format === "json"
          ? decodeAcliRecord(frame)
          : stream.format === "lines"
            ? decodeAcliCommentaryLine(frame)
            : {
                source: frame,
                data: frame,
                commentary: [],
                removed: [],
                metadataOnly: false,
              };
      let getPreviousContext: (() => string) | null = null;
      if (
        stream === this.stdout &&
        (stream.format !== "lines" || this.stdoutSequenced)
      ) {
        const previous = stream.previous;
        const block = stream.textBlock;
        if (stream.format === "lines" && block.length)
          getPreviousContext = () => block.join("");
        else if (previous) getPreviousContext = () => previous.data;
      }
      this.records.push({
        id: this.nextId++,
        record,
        stream,
        getPreviousContext,
      });
      if (record.metadataOnly) stream.afterCommentary = true;
      else {
        if (stream.afterCommentary) stream.textBlock = [];
        stream.afterCommentary = false;
        stream.textBlock.push(record.data);
        if (frame.trim()) stream.previous = record;
      }
    }
  }

  stop() {
    this.stopped = true;
    this.records = [];
  }

  private async drain(): Promise<void> {
    if (this.active || this.stopped || this.records.length === 0) return;
    this.active = true;
    try {
      while (!this.stopped && this.records.length > 0) {
        const batch = this.records.splice(0);
        const texts = batch.flatMap(({ record }) =>
          record.commentary.map((item) => item.text),
        );
        let html: string[] | null;
        try {
          html = texts.length ? await this.render(texts) : [];
          if (html.length !== texts.length)
            throw new Error("Incomplete commentary rendering");
        } catch {
          html = null;
        }
        if (this.stopped) return;
        let index = 0;
        const commentary = [...this.projection.commentary];
        for (const { id, record, stream, getPreviousContext } of batch) {
          if (!html) {
            stream.data.push(record.source);
            continue;
          }
          if (!record.metadataOnly) stream.data.push(record.data);
          for (const item of record.commentary) {
            commentary.push({
              id: `${id}:${item.id}`,
              text: item.text,
              html: html[index++]!,
              getContext: item.context
                ? () => getAcliContext(record, item)!
                : record.metadataOnly
                  ? getPreviousContext
                  : null,
            });
          }
        }
        this.projection = {
          stdout: this.stdout.data.join(""),
          stderr: this.stderr.data.join(""),
          commentary,
          failed: this.projection.failed || html === null,
          complete: this.finished && this.records.length === 0,
        };
        this.publish(this.projection);
      }
    } finally {
      this.active = false;
    }
  }
}
