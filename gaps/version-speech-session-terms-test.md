# Version test assumes only one speech capability follows SQLite readiness

`packages/server/test/version.test.ts` fails its
`reports retained SQLite ready status and gates vocabulary in every encoding`
case: `speech-vocabulary-session-terms: expected true to be false`.
It reproduces independently with:

```sh
pnpm --filter @yep-anywhere/server test test/version.test.ts
```

The capability comparison singles out `speechVocabulary`, but the route also
advertises `speechVocabularySessionTerms` when SQLite is ready. The other
30 tests in the file pass. Review the speech-vocabulary capability contract
and extend the test's readiness expectation to its session-terms capability
if that paired advertisement is intended. Do not change advertised capability
semantics merely to satisfy the test.

This is outside fork discovery: neither the version route nor capability
registry is changed by the clone fix, and the failed case never creates a
fork. Left for the owning speech/SQLite change rather than adjusting an
independent capability assertion as part of the clone fix.

Found 2026-09-09 while validating immediate Codex/Pi clone discovery on the
checkout based on `2c03afe5f`.
