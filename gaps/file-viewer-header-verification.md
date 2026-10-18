# Finish compact viewer and inline diff verification

2026-10-18 · Contributing-model: 6-Astra

The maintainer requested a local checkpoint before restarting the provider.
The compact file header and in-session inline diff implementation are landed,
but final verification is incomplete. Contracts are in
`topics/parked-file-viewer.md` and `topics/source-control.md`.

- `packages/client/e2e/file-viewer-header.spec.ts` passed the content-dependent
  window-control transition with unchanged filename height, zoom, and Find
  typing. Its phone overflow assertion failed because the invisible full-width
  filename measurement contributed to scroll width. The measurement now has
  a zero-size clipping parent; recapture and verify that fix.
- The new Read case in `packages/client/e2e/file-viewer-github-link.spec.ts`
  appends fixture transcript rows, but the page rendered only its original
  user turn. Diagnose fixture refresh before judging the diff-opening behavior.
  The existing clipboard, pushed/unpushed, and source-return case passed.
- The focused component run passed 70/71 cases. The remaining test queried
  both visible and measuring filenames; its selector now names the visible
  `.file-viewer-path`. Rerun it. Typecheck's LastSessionFile literal-union error
  was corrected but also needs rerunning.
- Full checks and final phone capture inspection remain. Keep UI testing
  proportionate: the maintainer explicitly asked to reduce test cost. Reuse a
  single focused browser invocation; do not add another large test matrix.

Found 2026-10-18 while compacting viewer controls and keeping inline diffs in
the current session.
