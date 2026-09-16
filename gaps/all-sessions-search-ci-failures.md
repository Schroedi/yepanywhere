# All Sessions search fails in CI despite passing locally

The `e2e-tests` job stops at its five-failure limit in
`packages/client/e2e/all-sessions-search.spec.ts`. This prevents later browser
specs from running, including the live catch-up ordering regression.
The contract is [All-Session Content Search](../topics/all-session-content-search.md).

Evidence from 2026-09-15:

- [Mirror baseline CI](https://github.com/graehl/yepanywhere/actions/runs/34934010326)
  at `d729f4bf3` already failed appended-turn discovery, arriving-match layout,
  streaming/selection, and phone fan-out assertions, including retries.
- [Mirror ordering-fix CI](https://github.com/graehl/yepanywhere/actions/runs/34937359212)
  at `c70767325` repeats the appended-turn, layout and streaming failures.
  It also fails the copy-selection assertion at line 165: right-clicking
  changes trailing newlines in `window.getSelection().toString()`.
  That assertion passed in the baseline run, so its cause remains unresolved.
- [Upstream CI](https://github.com/kzahel/yepanywhere/actions/runs/34937347553)
  also reports an `e2e-tests` failure at `c70767325`.
- The complete local browser suite passed 265 tests with 7 skipped at that
  source, including these All Sessions tests. The later focused desktop/phone
  catch-up and sequential-typing checks also passed.

The repeated baseline failures predate the ordering fix; local success does
not establish harmless flakes. Reproduce with CI's browser/runtime versions,
fresh profile, reporters and failure limit. Inspect the saved traces and
network responses for search completion/visibility failures, and compare the
selection text before and after native right-click handling. Fix the owning
contract or test oracle rather than increasing waits or suppressing failures.

Repeated at `28a58cf9b` on 2026-09-16 in both
[origin](https://github.com/kzahel/yepanywhere/actions/runs/35085173084/job/104758191326)
and [graehl](https://github.com/graehl/yepanywhere/actions/runs/35085176248/job/104758200450):
the same five appended-turn, arriving-match, desktop streaming/selection and
phone fan-out failures stopped each run after 13 passes, leaving 270 tests
unrun. This is an existing unresolved failure, not evidence of green E2E.

Captured after publication; investigating the search failures is separate
from the completed transcript-ordering fix. This note does not claim CI
validated browser tests that were never reached.

Found 2026-09-15 while reporting source CI after publishing the catch-up fix.
Contributing-model: 6-Astra
