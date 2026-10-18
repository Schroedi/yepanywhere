# Concurrent glossary join test intermittently observes an extra refresh

The full server suite on macOS failed
`test/projects/projectGlossarySubscriptionManager.test.ts` →
“shares one post-observation snapshot barrier across concurrent joiners”:
`getObservedGlossaryPaths` was called four times instead of three (line 631).
The next full server run passed all 6,599 tests unchanged.

The test uses real filesystem watchers alongside fake interval/timeout clocks.
`runRefreshLoop` resamples observations when refreshQueued is set; a filesystem
notification can request an extra scan independently of the explicit observation
barrier. That is a plausible source of the extra call, not yet a proved diagnosis.
The failing assertion precedes the snapshot-content assertions, so this run does
not establish whether the externally visible snapshots were wrong.

Keep the concurrency and stale-snapshot protection. Diagnose watcher delivery
versus the shared readiness barrier before changing the exact scan-count
assertion; do not increase timeouts or delete the race coverage. The workspace
storage change does not touch these paths, so this needs a separate focused fix.

Found 2026-10-18 during Android multi-root workspace acceptance.
