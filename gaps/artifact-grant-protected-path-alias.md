# Artifact grant ownership can miss a protected directory through a path alias

`packages/server/src/artifacts/GrantStore.ts` compares an artifact's canonical
root with protected paths using `path.resolve`, which does not resolve symlinks.
`local-resource-policy.ts` returns the artifact file's `realpath`. On macOS,
the temporary-home test runner uses `/tmp/...`, while the file path becomes
`/private/tmp/...`. The protected home path and artifact root then fail the
containment comparison. An `owned: true` grant can be accepted for a directory
under the configured home, allowing expiry cleanup to remove its files.

The full `pnpm test` run on 2026-09-27 failed two assertions in
`packages/server/test/routes/artifact-grants.test.ts` (lines 246 and 274).
Running that file alone under `run-with-safe-home.js --temporary-home` reproduced
both failures (12 passed, 2 failed). In the same runner, `os.tmpdir()` returned
`/tmp/yep-anywhere-test-…/tmp` and `realpath` returned
`/private/tmp/yep-anywhere-test-…/tmp`.

Canonicalize existing protected roots before comparing them with the already
canonical artifact root. Keep a safe rule for a configured protected path that
does not yet exist. Add a focused alias/symlink case and rerun the artifact
grant tests and repository unit suite. This was found beside E2E test-cost
work, which did not touch the artifact ownership boundary.

Found 2026-09-27 while verifying the first E2E suite reduction slice.
