# Server tests crash when the live speech-vocabulary state file is mid-write

`createApp` constructs `VocabularyStore`, whose `loadJson`
(`packages/server/src/services/voice/VocabularyStore.ts:129`) rethrows every
read error except `ENOENT`. Server tests do not set `YEP_DATA_DIR`
(`packages/server/test/setup/config-env-vars.ts` clears it), so the store reads
the developer's live `~/.yep-anywhere/speech-vocabulary-state.json`. The store
writes that file with a plain `writeFileSync`
(`VocabularyStore.ts:290`), so a running YA server can be observed mid-write:
the test then throws `SyntaxError: Unexpected end of JSON input` before any
assertion runs.

Observed 2026-09-09: 32 of the `packages/server/test/api` tests failed this way
in two consecutive runs while the port-3400 server was active, and passed when
it was not writing.

Not fixed in place: this is the speech-vocabulary owner's file and was landed
minutes earlier in `204e3a7b2`; the goal work touched nothing here.

Cheap fix: write the state atomically (temp file plus rename) so no reader sees
a partial file, and treat an unparseable state file the same as a missing one
with a logged warning. Pointing the test setup at a scratch data directory
would also stop tests from reading the developer's live state.

Found 2026-09-09 while adding Claude `/goal` support.
