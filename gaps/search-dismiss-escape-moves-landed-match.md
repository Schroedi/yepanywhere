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

2026-09-30: still deterministic on this host with identical frames (549 →
489.42) on a focused rerun and on upstream `87f933c97`; GitHub CI passed the
same commits, so the failure is host-dependent.
Contributing-model: opus-5.5

The CI isolation campaign separately proved a pending-follow ownership defect:
a bottom-release frame could re-enable Follow after user intent stopped it.
Two controlled-frame regressions fail against the old code. Follow release
frames are now owned/cancelled, and search navigation uses the same stop-follow
fence. This is a supported repair, but it does not yet establish the cause of
the exact 60px Escape shift above. Keep the frame assertion and this gap open
while repeated browser/CI evidence is gathered.
