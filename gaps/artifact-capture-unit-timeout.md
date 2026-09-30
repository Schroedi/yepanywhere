# Standalone artifact capture can exceed its unit-test budget

`packages/client/scripts/artifact-capture.test.ts` failed its first test,
"captures a standalone bundle in both standard sizes without YA", at the
default 5000 ms limit during `pnpm test` on macOS with Node 24.19.0. Lint,
format verification, and typechecking were also running. The other 6442 client
tests passed. An isolated rerun passed all 22 artifact tests in 21.96 seconds.

The test launches Chromium, loads and captures two viewports, and closes the
browser. The failing log does not identify which step exceeded the budget;
contention is a possibility, not a confirmed cause. This is outside the
session-resume seam, so no capture behavior or timeout was changed here.
Instrument those phases under full-suite load before choosing a fix. If a
larger budget is appropriate, follow `topics/test-time-budgets.md` and include
the observed 5000 ms timeout in the measured maximum.

Found 2026-09-29 while verifying dormant-session settings restoration.

2026-09-30: a Node 24.19.0 full workspace run during the file-API module repair
timed out two more cases at 5,000ms: `skips health and grants when delivery is
absent: {"capable":false}` and `takes the session's announced artifact origin
without asking the server`. Browser and typechecking verification overlapped
that run. The logs still do not identify a blocked capture phase, so no
deadline or capture behavior was changed. Keep phase timing and first-attempt
full-suite evidence as the next diagnostic step.
