# Speech recognition lacks a persistent learned vocabulary

YA needs this immediately: recognition misses project vocabulary, but there
is no shared word-unigram statistics map learned from typed composer text and
agent replies. The maintainer explicitly requested tracking this missing
feature as a gap while the model and microphone fixes land.

Related contract: [pluggable speech recognition](../topics/pluggable-speech-recognition.md#keyterm-biasing).
Existing batch requests accept `keyterms` in
`packages/server/src/routes/speech.ts`; streaming and direct Grok do not yet
consume learned terms. No vocabulary collector or integration is implemented.

## Required behavior

- A speech-recognition option, default off, enables server-side collection.
  Disabling it stops learning but preserves all counts and scan progress.
- Enabling it starts retrospective learning over a chosen number of hours.
  Provide a numeric text field and slider for hours and a Scan/Learn action
  with background progress. Subsequent content that comes to the server's
  notice is learned automatically while enabled.
- Efficiently scan, tokenize, aggregate, and persist word-unigram counts.
  Typed composer text supplies vocabulary; agent text also upvotes terms.
  Keep source contributions distinguishable so weighting can change without
  pretending that generated text was typed by the user.
- Store the map on the server under YA app data. An existing SQLite facility
  with an indexed string key and atomic counter updates is a candidate;
  inspect the repository's storage owners before choosing the implementation.
  Do not rewrite the entire map per token or keep unbounded transcripts in RAM.
- Persist which portions of each session have been scanned. Repeated scans,
  overlapping hour windows, live events followed by history replay, restart,
  and disable/re-enable must not count the same content twice. Commit counts
  and scan progress atomically. Account for growing and revised messages,
  rather than using a single "session scanned" bit.
- Provide an explicit Clear/Reset operation. It clears counts and scan
  checkpoints consistently, and prevents in-flight work from a previous reset
  generation from restoring cleared data. Scanning after reset can learn the
  selected history again.
- The scan/tokenize/count pipeline can land before any recognizer consumes it.
  Collection and recognizer integration must have separately visible status.

## Recognition integration

Use the same statistics map for Grok STT and other models that support
vocabulary bias, with bounded term selection appropriate to each backend's
limits. Record which terms were sent so quality comparisons are reproducible.

Version 1 integrates Grok through YA; Grok direct initially gains nothing.
Version 2 lets a direct client fetch a replica and synchronize it in memory
for its current session. Define snapshot/reset versions and incremental sync
before implementing that replica, and capability-gate new server endpoints.
Full composed text before the insertion cursor is a separate context input
for models such as Whisper; unigram counts do not replace it.

Found 2026-09-08 while investigating tablet speech recognition; requirements
expanded by the maintainer during the same session.
