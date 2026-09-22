# Template version browser checks fail during context closure in CI

Both source CI runs for `2c1d8e6d371316e438cca54134b55c70f1bee3b2`
failed the `e2e-tests` job on September 22. The two reported failures are
`packages/client/e2e/project-template-sources.spec.ts:127`, covering older
servers 0.8.0 and 0.8.1. The route handler at line 132 awaits `route.fetch()`
for `/api/version` and reports that the page, context, or browser closed.
Additional all-sessions search, mobile viewport, and panel animation cases
reported route callback/context closure errors on their initial attempts and
passed on retry. They were flaky cases, not interrupted cases.

Evidence: [upstream run](https://github.com/kzahel/yepanywhere/actions/runs/35770951605)
and [fork run](https://github.com/graehl/yepanywhere/actions/runs/35770957265).
These cases passed in the local serial browser suite. No adjacent same-tree
passing CI run was established during this report.

## Diagnosed mechanism

The downloaded fork CI retry traces establish premature test completion for
both older-server cases. In the 0.8.0 trace, `/api/version` starts at monotonic
560600.972ms. All assertions finish by 560778.644ms; teardown starts at
560778.962ms. The still-pending route fetch fails at 560829.123ms, after
context teardown begins. The 0.8.1 trace has the same ordering: fetch starts
566224.101ms, teardown starts 566406.654ms, and fetch fails 566458.887ms.
There is no earlier failed assertion. Raising a test timeout cannot fix this
ordering; the tests intentionally finish before their request is complete.

`project-template-sources.spec.ts:151-156` waits only for the settings search
box, then asserts an absent control and zero template requests. Those negative
assertions already hold while version discovery is pending:
`ProjectTemplatesSettings.tsx` treats an unknown version as unsupported and
returns no form. Consequently the test does not establish that its mocked old
version was received or applied. Slower CI exposes teardown of its pending
`route.fetch()`; fast local completion can hide the missing synchronization.

The repair should first await a positive signal that the mocked version has
been applied before checking capability absence, and explicitly finish owned
route handlers before context teardown. Do not merely swallow closure errors
or increase timeouts. Other retry-only cases use route.fetch too, but their
precise triggering request lifetimes still need separate trace confirmation.

Diagnosis requested after publication; no test or production code changed.

Found 2026-09-22 while reporting CI after session-stall recovery publication.
Contributing-model: 6-Astra
