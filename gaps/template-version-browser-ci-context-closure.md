# Template version browser checks fail during context closure in CI

Both source CI runs for `2c1d8e6d371316e438cca54134b55c70f1bee3b2`
failed the `e2e-tests` job on September 22. The two reported failures are
`packages/client/e2e/project-template-sources.spec.ts:127`, covering older
servers 0.8.0 and 0.8.1. The route handler at line 132 awaits `route.fetch()`
for `/api/version` and reports that the page, context, or browser closed.
Additional all-sessions search, mobile viewport, and panel animation cases
were interrupted and also reported route callback/context closure errors.

Evidence: [upstream run](https://github.com/kzahel/yepanywhere/actions/runs/35770951605)
and [fork run](https://github.com/graehl/yepanywhere/actions/runs/35770957265).
These cases passed in the local serial browser suite. That contrast does not
establish a flake or identify whether shutdown is the cause or a consequence.
Inspect the uploaded traces and request/fixture lifetime before changing
teardown or suppressing route errors. No adjacent same-tree passing CI run
was established during this report.

Not pursued during the session-stall publication: the source CI monitor is
advisory, and this is a separate browser-test lifecycle investigation.

Found 2026-09-22 while reporting CI after session-stall recovery publication.
Contributing-model: 6-Astra
