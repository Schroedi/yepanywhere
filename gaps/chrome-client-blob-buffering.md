# Nothing measures the client's Blob retention

Chrome keeps every live `Blob` in one browser-wide store
([browser Blob budget](../topics/media-rendering-and-routing.md#known-sharp-edges)),
and revoking an object URL does not free a `Blob` that state, a cache, or a
closure still references. Direct transports now stream downloads, viewer
media and local videos from server URLs, and relay transfers fail one request
with `413` rather than the connection
([relay transfer size](../topics/media-rendering-and-routing.md#relay-transfer-size)),
but no check shows that the Blobs the client does create are released.

A Playwright persistent browser context can read `chrome://blob-internals`
(each Blob's refcount and length; the default incognito-like context shows
nothing). Add a browser check that opens many images, videos and files in the
viewer, modal and transcript, closes them, forces garbage collection over CDP
(`HeapProfiler.collectGarbage`), and asserts the total returns to its
baseline. Code review found the known holders revoke and drop their Blobs
(`AttachmentChip`'s come from IndexedDB and are disk-backed), so the check is
expected to pass and guards regressions.

Found 2026-10-03 while diagnosing a failed 17 MB file-link download in a
direct Chrome tab.
