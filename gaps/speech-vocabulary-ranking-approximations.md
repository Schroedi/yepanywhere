# Speech vocabulary ranking and storage use approximations

Learned-vocabulary selection now keeps in-memory hash maps/sets and
snapshots them to files. Several ranking and persistence choices are
deliberately approximate so a scan cannot stall the Node event loop.

## Score

Recognition ranking is still
`(observed - expected) / sqrt(expected + 1)` with
`expected = T * p` from the English unigram list, unlisted `p = 0`,
and a fivefold multiplier for active-session terms
(`topics/pluggable-speech-recognition.md`). That formula is not a
simple excess count.

## What is approximate

- **Non-updated reordering.** Incrementing any token raises `T`, so
  every word’s score changes at a `p`- and `c`-dependent rate. Two
  untouched words can cross: the former 101st can become 100th when a
  low-ranked item is incremented. The live path only re-scores the
  incremented word against the current worst-of-top-k threshold. A full
  rebuild from the in-memory map runs on flush (1M new distinctive
  tokens or scan completion), not on every increment.
- **Bounded heaps, not the full lexicon.** A global distinctive heap
  keeps about 500 terms; each learned session keeps its own 100 with
  the session multiplier already applied. A recognition request merges
  those heaps and takes 100. Terms outside both heaps are omitted until
  a rebuild. Session state lives on the server (session key from the
  speech context); the client still *may* send `sessionTerms`, but that
  is not required for the overlay.
- **Tail-only fingerprints.** A hash set of content hashes skips
  already-seen messages. Revised or deleted text is not subtracted.
  Dropped tokens are accepted. The set is open addressing in a packed
  32-byte-slot file (mmap when Bun provides it, otherwise ordinary
  read/write). It is not a B-tree.
- **Counts are an in-memory string→count map** snapshotted to JSON.
  `count > k` is a linear filter of that map. The map is small enough
  to hold; it is not an ordered on-disk index.
- **Durability.** Unflushed hashes and counts are lost on crash. Scan
  work yields every 16 messages so the process stays responsive.

Exact per-increment maintenance of the true top 100 under a changing
`T`, and a fully crash-safe log, were deferred.

Cheap exact-enough follow-up: rebuild the global 500 from the map more
often (time or `T`-doubling), still without walking every session’s
transcript.

Found 2026-09-09 while replacing SQLite per-token updates that blocked
the server; the maintainer accepted clumsy ranking approximations and
asked that they be recorded.
