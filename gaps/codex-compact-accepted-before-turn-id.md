# Codex compaction can be accepted between turn/start and its turn id

`test/api/codex-compact.test.ts` > "rejects direct compaction during a turn
without replacing the process" failed once in a full `pnpm --filter
@yep-anywhere/server test` run on 2026-09-16 (expected 409, received 200),
and passed on rerun alone, grouped with the artifact suites, and in a second
full run. Only `packages/server/src/artifacts/*` changed in that working tree,
which that assertion does not exercise.

The window is real, not purely a test artifact. The route's guard in
`packages/server/src/sdk/providers/codex.ts:2416` refuses compaction on
`runtimeState.activeTurnId`, which is assigned when the app server answers
`turn/start`. The test's readiness poll instead waits for the `turn/start`
request to appear in the recorded request log, which happens before that
answer. Under full-suite load the gap between the two widens enough for the
compaction to arrive while no turn id is assigned yet.

Two readings, and the choice is a product decision rather than a test cleanup:
either an unanswered `turn/start` should already block compaction — a narrow
provider-state fix, and the test is right as written — or the guard is correct
and the test should poll the state it asserts on (`process.state.type` is
`in-turn`) rather than the request log. Do not simply relax the assertion.

Found 2026-09-16 while verifying the artifact grant-store staging fix.
