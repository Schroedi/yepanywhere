# Initial-baseline watcher event classification races completion

During tactical 124 validation on macOS (2026-09-10), root `pnpm test`
failed `test/watcher/FileWatcher.test.ts`, “preserves an event observed while
the baseline is pending”. The one retained event had `changeType: "create"`
instead of the expected `"modify"`; `touchedPathsPreserved` was correctly 1.
The other 4,929 server tests passed (54 skipped). All 10 FileWatcher tests
passed when rerun alone. A subsequent complete server run also passed
all 4,930 tests (54 skipped), confirming the failure is intermittent.

The test queues a zero-debounce event immediately after `start()`, waits for
the baseline, then sleeps 10 ms. Event delivery can cross baseline completion;
classification depends on the baseline state when the delayed event is handled.
Investigate that ordering and decide whether the event needs its observation
phase retained or the fixture needs a deterministic pending-baseline barrier.
Do not weaken the create/modify assertion or replace it with a longer sleep.
No watcher implementation or timing policy changed in the display-contract work.
