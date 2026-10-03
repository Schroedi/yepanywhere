# Stream large relay transfers instead of buffering one message

A relayed file is one response message: the server reads the whole body,
base64-encodes it into JSON, encrypts it, and splits it into transport
chunks; the client reassembles the message, decodes base64 into a
`Uint8Array`, and builds a `Blob`. Peak memory is several times the file
size on both ends (about 6× on the server for a 40 MB file, measured
2026-10-03), the transfer must finish inside the single 120 s request
deadline, and anything that cannot fit the 64 MiB reassembly limit is
refused with `413`
([relay transfer size](../../topics/media-rendering-and-routing.md#relay-transfer-size)).
Relay viewers likewise hold a whole video or PDF in a `Blob` for as long as
they are open.

Sketch:

- A capability-gated streamed response: the server sends a header message
  (status, type, length) and then raw byte chunks from the file stream,
  without base64 or whole-body buffering, ending with a trailer. Older
  servers keep today's single-message response, so the client falls back.
- The request deadline becomes an inactivity timeout between chunks, so a
  slow relay is not cut off while it is still delivering.
- Downloads write chunks to disk as they arrive: a service-worker-backed
  download URL (a `ReadableStream` response the browser saves), or the File
  System Access API where available. Neither should collect the file in a
  page `Blob` first.
- Viewer media could use the same stream: a service-worker URL can answer
  Range requests for `<video>` seeking, which a `Blob` cannot avoid buffering.

Constraints carried over:

- Encrypted relay framing authenticates each message; streamed chunks need
  the same per-chunk encryption and sequence checks, not a plaintext side
  channel.
- Uploads already use 64 KiB application chunks over the relay; reuse their
  flow-control lessons rather than inventing a second shape.
- Client/server compatibility review applies
  ([server capabilities](../../topics/server-capabilities.md)).

Found 2026-10-03 while closing `gaps/chrome-client-blob-buffering.md`.
