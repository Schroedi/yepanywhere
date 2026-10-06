# In-page anchor links do nothing in Markdown file previews

A Markdown document that links within itself cannot be navigated in the file
viewer's preview. Both common forms fail:

- explicit targets, `<a id="row-f"></a>` with `[f](#row-f)`, lose their
  target because the sanitizer strips `id`;
- heading links, `[see](#some-heading)`, have no target because headings get
  no generated ids.

`packages/server/src/augments/markdown-file-preview.ts` renders through
`packages/server/src/augments/safe-markdown.ts`. Its sanitizer
`allowedAttributes` permits `href` on `a` but grants no element an `id`, and
the markdown-it setup adds no heading anchors. GitHub and most editors honor
both forms, so documents written for them, such as summary tables linking to
their evidence sections and back, render with dead links here.

Not fixed in place: this was found from another project's document, and the
fix touches sanitizer policy and viewer navigation.

Likely fix, within the existing security posture:

- Allow `id` on `a` and `h1`–`h6`, rewritten with a fixed prefix (GitHub uses
  `user-content-`) so document ids cannot collide with or clobber the app's
  own element ids.
- Generate slug ids for headings under the same prefix.
- In the preview, handle same-document `#fragment` links by scrolling to the
  prefixed target instead of navigating, keeping the parked viewer's scroll
  ownership intact (`topics/parked-file-viewer.md`).

Verify explicit-anchor links, heading links, back-links, duplicate ids and
headings, and a hostile id such as `root`, in both the standalone file view
and the session-managed viewer, including through the relay client. Related
but separate: [parent-relative links lose anchors](markdown-parent-relative-links-lose-anchors.md)
covers `../` file links rather than in-page fragments.

Found 2026-10-06 while reviewing the draft repository's
`research/speech-recognition/topics/arabic-technique-evidence.md`, whose
summary-table row links and evidence-section back-links render dead in YA.
