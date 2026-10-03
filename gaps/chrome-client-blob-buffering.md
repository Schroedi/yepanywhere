# Chrome clients buffer whole files as Blobs, and nothing measures retention

On 2026-10-03 a direct (`localhost:3400`) Chrome tab could not download a
17 MB `software.tgz`: every `fetch(...).blob()` of a body of about 17 MB or
more rejected with `TypeError: Failed to fetch` after about 1 s, while 4 MB
reads, metadata reads and a streamed `getReader()` read of the same 17 MB
succeeded. The same requests succeeded from Chromium on the server host, and
a full Chrome restart cleared the condition. That points at Chrome's
browser-wide Blob storage, either an exhausted memory budget or a failing
disk-backed `blob_storage/` path, not at YA's server or network path. Direct
project-file and local-file downloads now hand an attachment URL to the
browser's own download, so they no longer pass through a page Blob; the rest
is open:

- **Relay downloads still buffer the whole file.** `RelayProtocol.fetchBlob`
  (`packages/client/src/lib/connection/RelayProtocol.ts`) receives the body
  base64-encoded, then `atob` → `Uint8Array` → `Blob`, so peak memory is
  several times the file size, and the whole transfer must finish inside the
  single `API_REQUEST_DEADLINE_MS` (120 s) request deadline. A large file over
  a slow relay therefore fails or times out. Investigate a chunked relay
  transfer that streams to disk (a service-worker-backed download URL, or the
  File System Access API where available) rather than one buffered Blob.
- **Viewer previews buffer whole media.** In relay mode the `FileViewer` raw
  blob (images, PDF, audio/video) and `LocalMediaModal` previews fetch the
  entire file into a Blob before showing it; a large video holds its full size
  for as long as the viewer is open.
- **Blob retention is unmeasured.** Revoking an object URL does not free a
  Blob that React state, a cache or a closure still references, and the budget
  is shared across every tab and extension in the browser. Candidates that hold
  Blobs for their component's lifetime include `AttachmentChip` (`fullBlob`),
  `ComposerRecents` files and turn image galleries. Nobody has watched
  `chrome://blob-internals` across a long-lived YA tab to see whether the total
  grows. Do that before and after opening many images and files and closing
  their viewers; a total that does not fall back is a leak.
- **Unrevoked object URLs.** `openPdfInNewTab`
  (`packages/client/src/components/renderers/tools/ReadRenderer.tsx`) never
  revokes its PDF object URL, so each opened PDF stays referenced for the
  page's lifetime. `preloadRemoteImage` (`packages/client/src/hooks/useRemoteImage.ts`)
  returns an object URL its caller must revoke and has no callers; delete it.

If the failure recurs, before restarting Chrome record the
`chrome://blob-internals` total and the failed request's `net::ERR_*` code from
DevTools → Network: a high total suggests a leak, `ERR_OUT_OF_MEMORY` the memory
budget, and `ERR_FILE_NOT_FOUND`/`ERR_FAILED` on a large body the disk-backed
store. **Flush socket pools** is not the remedy: the failing reads returned an
error within a second while other reads to the same host succeeded, which is
not connection-pool exhaustion.

Found 2026-10-03 while diagnosing a failed 17 MB file-link download in a
direct Chrome tab.
