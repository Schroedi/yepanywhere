# Escape dismissal moves the landed transcript search match

The full local browser suite at `3a0281f83` fails
`packages/client/e2e/session-isearch-scope-controls.spec.ts:125` for Escape
dismissal. The selected match starts at y=549; sampled frames move to
489.421875, violating the under-two-pixel stability check at line 195. The
click-dismissal variant passes.

The owning search-dismissal/scroll anchoring path needs a focused reproduction;
this was found during app-controls publication and was not hidden by relaxing
the assertion. The failing capture is retained in the Playwright run directory
`packages/client/test-results/e2d6bd32-c68c-4e17-9d0a-c52bba429be7/` locally.

Found 2026-09-29 while reporting post-publication browser checks.
Contributing-model: 6-Astra.
