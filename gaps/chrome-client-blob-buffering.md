# Direct-tab viewers buffer whole media as Blobs, and nothing measures retention

Chrome keeps every live `Blob` in one browser-wide store
([browser Blob budget](../topics/media-rendering-and-routing.md#known-sharp-edges)),
so whole-file buffering that a tab does not need spends a budget shared by
every tab. Downloads on a direct transport already stream through the
browser, and relay transfers now fail one request with `413` rather than the
connection
([relay transfer size](../topics/media-rendering-and-routing.md#relay-transfer-size)).
Two parts remain:

- **Direct-tab media still fetches Blobs.** The default `FileViewer` source
  always supplies `fetchRawFileBlob` (`packages/client/src/components/FileViewer.tsx`),
  so on a direct transport its images, audio and video are read whole with
  `response.blob()`; only same-origin PDFs frame the raw URL.
  `LocalMediaModal` and `useLocalMediaInlinePreviews` do the same on every
  transport. A large video holds its full size for as long as it is shown.
  When `capabilities.sameOriginUrls` is true, render the raw URL instead
  (CSP already admits `media-src 'self'`). Neither `/api/projects/:id/files/raw`
  (`packages/server/src/routes/files.ts`) nor the local media routes honor
  `Range`, so add `206` responses first or a URL-backed `<video>` cannot seek
  past what it has buffered.
- **Blob retention is unmeasured.** A Playwright persistent browser context
  can read `chrome://blob-internals` (each Blob's refcount and length; the
  default incognito-like context shows nothing). Add a browser check that
  opens many images, videos and files in the viewer, modal and transcript,
  closes them, forces garbage collection over CDP
  (`HeapProfiler.collectGarbage`), and asserts the total returns to its
  baseline. Code review found the known holders revoke and drop their Blobs
  (`AttachmentChip`'s come from IndexedDB and are disk-backed), so the check
  is expected to pass and guards regressions.

Found 2026-10-03 while diagnosing a failed 17 MB file-link download in a
direct Chrome tab.
