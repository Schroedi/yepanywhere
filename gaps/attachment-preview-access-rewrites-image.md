# Opening an attachment preview may rewrite its full image to disk

`loadCachedAttachmentPreview` (`packages/client/src/lib/attachmentPreviewCache.ts`)
updates `lastAccessedAt` by putting the whole cached record back into
IndexedDB, including `fullBlob` and `thumbnailBlob`. Chromium stores
IndexedDB Blobs as separate files and, as far as is known, writes a new file
for each put rather than reusing the one it read, so every chip that loads a
cached preview may copy the full-size image on disk. Unverified: confirm by
watching the origin's IndexedDB blob directory or write counters while
remounting chips.

If confirmed, keep access times in a small metadata record (or a separate
store keyed by attachment id) so touching an entry writes no Blob; eviction
already reads `lastAccessedAt` through its own index.

Found 2026-10-03 while auditing Blob holders for
`gaps/chrome-client-blob-buffering.md`.
