# The vocabulary seen filter saturates with nothing to detect or recover it

Speech vocabulary learning discards already-counted messages with
`speech-seen.bloom`, a paged blocked-bloom file of fixed size, defaulting to
256 MB (`VocabularyStore.ts`, `DEFAULT_SEEN_BYTES`) and now the largest thing YA
keeps in the data directory. Every observed message is fingerprinted over
session key, source, timestamp and text and admitted only if the filter has not
seen it.

A fixed-size filter that remembers everything forever eventually passes its
design load, after which its false-positive rate climbs and real messages are
silently dropped from the counts. The code knows this. `BlockedBloom.saturated`
computes it, `VocabularyStore.seenSaturated` exposes it, and its comment already
names the cure — "Recovering means emptying it and relearning the retained
window". Nothing reads that getter, and nothing empties anything. The 256 MB
default postpones the problem rather than solving it.

So this entry has two possible resolutions, and they are not equally settled.

## Resolution A: bound the filter in time (uncontroversial)

Some clear-or-resize is needed whatever else happens. The maintainer's mechanism
drives it from coarse time rather than an occupancy check:

- Keep one durable monotonic "last seen content time". Every provider exposes a
  reliable coarse-resolution time signal, so this is cheap.
- Consult the filter only for messages after that watermark minus an epsilon,
  starting at two hours and configurable. Anything older is already counted by
  definition of the watermark.
- Periodically rebuild the filter from the last epsilon of content, writing it
  beside the old one and renaming it into place.

The rebuild is the clear. Occupancy stops growing with history and becomes a
function of the window, so the false-positive rate stops drifting and the file
stops needing to be a quarter gigabyte to buy time.

Two verified facts say the time window is workable. The fingerprint already
contains the message timestamp, so the window and the dedupe key agree by
construction. And learning already refuses a message whose timestamp does not
parse (`VocabularyLearning.ts`), so no path depends on undated content.

## Resolution B: delete the durable filter (controversial)

Keep no durable filter. Resume counting at the watermark and accept that a
restart may miss or double count. This is faster and markedly simpler, and it
buys that with really sloppy counts, which is why it needs a decision rather
than a review.

The naive form presumes the counts database was promptly updated, with the
watermark implemented as the modification time of the vocabulary database file
or its moral equivalent. A stronger equivalent is already stored: counts and
per-session checkpoints are written in the same batch, which is the property the
store's own comment relies on to bound what a crash costs, so the `hasScanned`
`{version, cutoff}` rows are already a consistent watermark that does not depend
on filesystem timestamps. Either way the write interval bounds the error. It
defaults to ten minutes, so "promptly updated" means up to ten minutes of
recounting, and that is the number to sanity-check any epsilon against.

## Orthogonal: what is left may already exist

Under Resolution A the filter is no longer durable state; it is an in-memory
coalescer for duplicates within one scan. That may be redundant with machinery
already gating the normalized session representations being observed, and this
audit belongs before either resolution is built, because it can moot both.

The comparison to make is the issue-association acquisition path, which answers
the same question on the same catalog rows and answers it better: a durable
per-session resume cursor over source position, file identity and a boundary
hash, so appends resume and a detected rewrite resets acquisition. It never
re-reads what it consumed. Vocabulary learning instead re-reads a changed
session from the retrospective cutoff and throws away what it recognizes.

Note what already limits the damage today: `hasScanned` skips an unchanged
session outright, so the filter only earns anything when a session's source
version has moved and its earlier messages come back around.

Found 2026-09-10, proposed by the maintainer after the filter moved into the
data directory and its size became the largest thing YA keeps there.
