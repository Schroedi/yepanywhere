import { open, readFile, unlink, writeFile } from "node:fs/promises";
import { setImmediate as yieldToLoop } from "node:timers/promises";

const SLOT = 32;
const HEADER = 16;
const MAGIC = Buffer.from("YASEEN1\0");
type BunMmap = {
  mmap?: (path: string, opts?: { shared?: boolean }) => Uint8Array;
};

async function persistBytes(path: string, bytes: Buffer): Promise<void> {
  const bun = (globalThis as { Bun?: BunMmap }).Bun;
  if (bun?.mmap) {
    const file = await open(path, "w+");
    try {
      await file.truncate(bytes.length);
      await file.close();
    } catch (error) {
      await file.close().catch(() => {});
      throw error;
    }
    const mapped = Buffer.from(bun.mmap(path, { shared: true }));
    bytes.copy(mapped);
    return;
  }
  await writeFile(path, bytes);
}

async function loadBytes(path: string): Promise<Buffer | undefined> {
  const bun = (globalThis as { Bun?: BunMmap }).Bun;
  try {
    if (bun?.mmap) return Buffer.from(bun.mmap(path, { shared: true }));
  } catch {
    // Fall through to a normal read when mmap is missing or the file is empty.
  }
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function empty(slot: Uint8Array): boolean {
  for (const byte of slot) if (byte !== 0) return false;
  return true;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function probeIndex(fingerprint: Uint8Array, mask: number): number {
  return (
    (fingerprint[0]! |
      (fingerprint[1]! << 8) |
      (fingerprint[2]! << 16) |
      (fingerprint[3]! << 24)) &
    mask
  );
}

/** Open-addressed set of 32-byte fingerprints. Not a B-tree. */
export class FingerprintSet {
  private slots: Buffer;
  private capacity: number;
  private size = 0;

  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.slots = Buffer.alloc(capacity * SLOT);
  }

  get count(): number {
    return this.size;
  }

  has(fingerprint: Uint8Array): boolean {
    const mask = this.capacity - 1;
    let index = probeIndex(fingerprint, mask);
    for (let step = 0; step < this.capacity; step++) {
      const slot = this.slots.subarray(index * SLOT, index * SLOT + SLOT);
      if (empty(slot)) return false;
      if (equal(slot, fingerprint)) return true;
      index = (index + 1) & mask;
    }
    return false;
  }

  add(fingerprint: Uint8Array): boolean {
    if (this.has(fingerprint)) return false;
    if ((this.size + 1) * 2 > this.capacity) this.grow();
    this.place(this.slots, this.capacity, fingerprint);
    this.size++;
    return true;
  }

  private place(
    slots: Buffer,
    capacity: number,
    fingerprint: Uint8Array,
  ): void {
    const mask = capacity - 1;
    let index = probeIndex(fingerprint, mask);
    for (;;) {
      const start = index * SLOT;
      const slot = slots.subarray(start, start + SLOT);
      if (empty(slot)) {
        slots.set(fingerprint, start);
        return;
      }
      index = (index + 1) & mask;
    }
  }

  private grow(): void {
    const next = this.capacity * 2;
    const slots = Buffer.alloc(next * SLOT);
    for (let index = 0; index < this.capacity; index++) {
      const slot = this.slots.subarray(index * SLOT, index * SLOT + SLOT);
      if (!empty(slot)) this.place(slots, next, slot);
    }
    this.capacity = next;
    this.slots = slots;
  }

  async persist(path: string): Promise<void> {
    const header = Buffer.alloc(HEADER);
    MAGIC.copy(header);
    header.writeUInt32LE(this.capacity, 8);
    header.writeUInt32LE(this.size, 12);
    await persistBytes(path, Buffer.concat([header, this.slots]));
  }

  async load(path: string): Promise<void> {
    const bytes = await loadBytes(path);
    if (!bytes) return;
    if (bytes.length < HEADER || !bytes.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error("Speech fingerprint set is not a hash table file");
    const capacity = bytes.readUInt32LE(8);
    const size = bytes.readUInt32LE(12);
    if (capacity < 1 || (capacity & (capacity - 1)) !== 0)
      throw new Error("Speech fingerprint set capacity is invalid");
    const slots = bytes.subarray(HEADER);
    if (slots.length !== capacity * SLOT)
      throw new Error("Speech fingerprint set file is truncated");
    this.capacity = capacity;
    this.size = size;
    this.slots = Buffer.from(slots);
    await yieldToLoop();
  }

  async clear(path: string): Promise<void> {
    this.capacity = 4096;
    this.size = 0;
    this.slots = Buffer.alloc(this.capacity * SLOT);
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
