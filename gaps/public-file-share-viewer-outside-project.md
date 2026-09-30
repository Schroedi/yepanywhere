# The public file share viewer cannot open a linked file outside the project

A live public file share authorizes everything its root links to, including
files outside the share's project, requested by absolute path
(`topics/relay-origin-and-share-gating.md` § Public File Views). The server
serves them (`servePublicShareProjectFile` in
`packages/server/src/routes/public-shares.ts`), but the hosted viewer never
asks:

- `normalizePublicShareFilePath` in `packages/client/src/lib/publicShareFiles.ts`
  returns null for an absolute path outside the share's project, so
  `buildPublicShareFileHref` mints no link and a rendered Markdown link to such
  a file stays pointed at `/api/local-file`, which a share viewer cannot use.
- The share file page parses its `path` through the same normalizer, so a
  play-page link that opens an outside Markdown or data file in the viewer
  fails there. An outside HTML file opens in play, but its own assets are not
  inlined: `buildPlayableHtml` and `fetchPublicShareRawFileBlob` also expect
  project-relative paths.

A file vhost of the same root has no such gap: it serves those files at the
URLs the browser requests.

Not fixed in place because `normalizePublicShareFilePath` also decides which
session-share transcript paths become links. Accepting an absolute outside path
there would mint dead links in session shares, whose server refuses outside
paths. The likely fix is a file-share-only normalization that the file viewer
page, play page and file-share link rewriting use, while session shares keep
today's rule.

Found 2026-09-30 while making live file shares serve what their root links to.
