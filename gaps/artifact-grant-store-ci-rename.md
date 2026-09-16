# Artifact grant persistence can fail during server tests

At source `28a58cf9b`, graehl's CI unit job passed all 5,317 server assertions
but failed on an unhandled `ENOENT` in `GrantStore.ts:165`: renaming
`grants.json.<pid>` to `grants.json` failed during `ArtifactServer.restore`
and `sweep`, while `test/routes/processes.test.ts` was running.

Evidence: [unit job 104758200340](https://github.com/graehl/yepanywhere/actions/runs/35085176248/job/104758200340).
Origin's unit job passed on the identical commit, so reproduction must account
for a nondeterministic failure rather than assume a consistently broken path.
The cause is not established. Check concurrent stores sharing the same file
and temporary name, plus asynchronous restore/cleanup ownership. Do not hide
the rejection or treat passing assertions as a successful suite.

Found 2026-09-16 while reporting source CI after speech-backend publication.
This artifact-persistence defect is outside the speech implementation scope.
