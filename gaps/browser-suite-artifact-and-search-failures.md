# Browser suite fails in artifact viewing and live session search

The post-publication browser suite on source `8c9c0d784` reported 339 passed,
11 failed, and 10 skipped on 2026-09-30. Failures need diagnosis; this run does
not establish whether they are product regressions, fixture mismatches, or flakes.

- `packages/client/e2e/artifact-viewer.spec.ts`: nine failures (tests declared
  at lines 122, 204, 374, 424, 474, 511, 586, 697, 713). Expected preview
  frames, Edit/Run controls, artifact settings, or public-copy controls were
  absent. Start by checking capability advertisement and fixture setup.
- `packages/client/e2e/mockup-export.spec.ts:35`: exported preview failed.
- `packages/client/e2e/all-sessions-search.spec.ts:204`: the newly discovered
  session's `quasarneedle live beta original request` never became visible
  within 30 seconds (assertion at line 248).

Local evidence: `.artifacts/publish/run.HWMSSn/18-verify.out` and `.err`;
screenshots under `packages/client/test-results/58317e21-68a7-46da-ac4a-36f9d054f160/`.
Reproduce with `pnpm --filter client exec playwright test` and the three spec
paths above. These areas are outside the draft-notice correction; no broad
test-suite repair was attempted. The four draft tests in that full run passed.

Source CI on the same tip also failed `e2e-tests (1/2)` in
[kzahel CI](https://github.com/kzahel/yepanywhere/actions/runs/36674187772)
and [graehl CI](https://github.com/graehl/yepanywhere/actions/runs/36674190907).
Graehl additionally failed `computer-control (windows-latest)`. Their causes
have not been compared with the local failures. Both repositories passed
Server Runtime And SQLite, Android App CI, and Desktop CI; the local relay
e2e check passed.

Found 2026-09-30 while publishing the draft-notice fix.
Contributing-model: 6-Astra
