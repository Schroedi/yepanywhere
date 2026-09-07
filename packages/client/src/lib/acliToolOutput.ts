import {
  AcliRecordFramer,
  decodeAcliRecord,
  declaresAcliCommentary,
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
  commentary: PresentedCommentary[];
  failed: boolean;
  complete: boolean;
}

interface PendingRecord {
  id: number;
  record: AcliRecord;
  previous: AcliRecord | null;
}

/** One invocation owns framing, context, render ordering, and publication. */
export class AcliToolOutput {
  private framer = new AcliRecordFramer();
  private source = "";
  private finished = false;
  private previous: AcliRecord | null = null;
  private records: PendingRecord[] = [];
  private nextId = 0;
  private active = false;
  private stopped = false;
  private data: string[] = [];
  private projection: AcliOutputProjection = {
    stdout: "",
    commentary: [],
    failed: false,
    complete: false,
  };

  constructor(
    private render: (texts: string[]) => Promise<string[]>,
    private publish: (projection: AcliOutputProjection) => void,
    cached?: { source: string; projection: AcliOutputProjection },
  ) {
    if (cached) {
      this.source = cached.source;
      this.finished = true;
      this.projection = cached.projection;
    }
  }

  appendSnapshot(source: string, complete: boolean): boolean {
    if (this.stopped) return false;
    if (
      !source.startsWith(this.source) ||
      (this.finished && source !== this.source)
    )
      return false;
    const frames = this.framer.append(source.slice(this.source.length));
    this.source = source;
    if (complete && !this.finished) {
      frames.push(...this.framer.finish());
      this.finished = true;
    }
    for (const frame of frames) {
      if (declaresAcliCommentary(frame)) continue;
      const record = decodeAcliRecord(frame);
      this.records.push({ id: this.nextId++, record, previous: this.previous });
      if (!record.metadataOnly && frame.trim()) this.previous = record;
    }
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
        for (const { id, record, previous } of batch) {
          if (!html) {
            this.data.push(record.source);
            continue;
          }
          if (!record.metadataOnly) this.data.push(record.data);
          for (const item of record.commentary) {
            commentary.push({
              id: `${id}:${item.id}`,
              text: item.text,
              html: html[index++]!,
              getContext: item.context
                ? () => getAcliContext(record, item)!
                : record.metadataOnly && previous
                  ? () => previous.data
                  : null,
            });
          }
        }
        this.projection = {
          stdout: this.data.join(""),
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
