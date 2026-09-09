# Speech vocabulary learning rewrites its whole state every few seconds

While learning is on, the live server rewrites the entire fingerprint table
and the entire word-count map on every flush, and a flush ends every scan
run. Measured on the running dev server on 2026-09-09: 27 flushes per minute,
each writing an 8.4 MB `speech-seen.hash` plus a 416 KB `speech-words.json`
and a 32 KB state file — roughly 230 MB/minute to a data directory that is on
NFS here.

Two separate causes:

- `FingerprintSet.persist` (`packages/server/src/services/voice/fingerprint-set.ts:129`)
  concatenates a fresh header + whole slot buffer and writes all of it, with
  no dirty tracking and no incremental append. It writes the same bytes again
  when nothing was added.
- `VocabularyLearning.run` (`packages/server/src/services/voice/VocabularyLearning.ts:158`)
  flushes unconditionally at the end of every run, and a run is started by
  every `session-catalog-updated` event (`packages/server/src/app.ts:2047`).
  With active agent sessions the catalog republishes every few seconds, so
  scans that observe nothing new still pay a full flush, a
  `setReference` → `rebuildTop`, and a full catalog read.

`writeFile` also truncates before writing, so `speech-seen.hash` is observably
zero-length for a moment 27 times a minute. A crash or restart inside that
window drops the whole seen-set, and the next scan re-tokenizes every session
from scratch. Persist to a temporary file and rename, as
`VocabularyKeyterms` already does.

Cheap fix: skip the flush when no words, checkpoints, or fingerprints are
pending; track a dirty flag on the fingerprint set and skip `persist` when it
is clean; write through a temporary file and rename.

Not fixed in place because the session that found it was diagnosing an
unrelated server-responsiveness report and had no reproduction tying this
churn to that report.

Found 2026-09-09 while investigating a reported server-wide stall during
session switching.
