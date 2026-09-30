# Holding the App button sometimes fails to open full view in CI

The final green isolation-campaign run at `a9047ba40` needed one retry for
`packages/client/e2e/project-app.spec.ts:319`. After a 700ms mouse hold and
release, the App pane never reached the expected full width within the
5,000ms polling budget (`:479`). Retry #1 passed in 41.9 seconds.

Evidence: [CI 36667985253, shard 1](https://github.com/kzahel/yepanywhere/actions/runs/36667985253/job/109736677743).
The passing job does not establish first-attempt reliability. Capture pointer
down/up/cancel, the hold timer firing, view-state transitions and pane geometry
before changing the hold or polling deadlines. This interaction is separate
from the deterministic file-API module initialization crash repaired afterward.

Found 2026-09-30 while checking the CI isolation campaign's final retry evidence.
