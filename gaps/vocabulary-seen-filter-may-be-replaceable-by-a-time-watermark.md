# A 256 MB durable filter does what a timestamp watermark could do

Speech vocabulary learning discards already-counted messages with
`speech-seen.bloom`, a paged blocked-bloom file that defaults to 256 MB
(`VocabularyStore.ts`, `DEFAULT_SEEN_BYTES`) and now lives in the data
directory. Every observed message is fingerprinted over session key, source,
timestamp and text (`vocabularyFingerprint`) and admitted only if the filter has
not seen it.

It earns that size only because it remembers everything forever. The maintainer
proposes bounding it in time instead, in three steps of increasing ambition.

## 1. Only consult the filter inside a recent window

Every provider exposes a reliable coarse-resolution time signal, so keep one
durable monotonic "last seen content time" and consult the filter only for
messages after that minus an epsilon, starting at two hours and configurable.
Everything older is already counted by definition of the watermark.

Two facts support the feasibility. The fingerprint already contains the
message timestamp, so a time window and the dedupe key agree by construction.
And learning already refuses a message whose timestamp does not parse
(`VocabularyLearning.ts`), so no path depends on undated content.

## 2. Rebuild the filter periodically from the window

Once only a window matters, the filter can be rebuilt from the last epsilon of
content, written beside the old one and renamed into place. That bounds its
occupancy instead of letting it fill, which is the real fix for false positives:
the filter reports saturation today (`blocked-bloom.ts`) but has no way to
recover from it. A filter covering two hours rather than all history is also
smaller than 256 MB by orders of magnitude, which changes what the data
directory has to hold.

## 3. Or drop the durable filter entirely

If missing or double counting a little on restart is acceptable, resume counting
at exactly the watermark and keep no durable filter at all. The presumption is
that the counts database was promptly updated; one implementation of the
watermark is the modification time of the vocabulary database file, or its moral
equivalent.

There is a stronger equivalent already stored. Counts and per-session
checkpoints are written in the same batch, which is the property the store's own
comment relies on to bound what a crash costs, so `hasScanned`'s per-session
`{version, cutoff}` rows are already a consistent watermark and do not depend on
filesystem timestamps. Whichever is chosen, the write interval bounds the error:
it defaults to ten minutes, so "promptly updated" means up to ten minutes of
recounting, and that is the number to sanity-check the epsilon against.

## 4. What is left may already exist elsewhere

With a window in place the filter is no longer durable state; it is an in-memory
coalescer for duplicates seen during one scan. That may be redundant with
machinery already gating the normalized session representations being observed,
and the audit belongs in this entry before anything is built.

The specific prior art to compare against is the issue-association acquisition
path, which answers the same question on the same catalog rows and answers it
better: it keeps a durable per-session resume cursor over source position, file
identity and a boundary hash, so appends resume and a detected rewrite resets
acquisition. It never re-reads what it has consumed. Vocabulary learning instead
re-reads a changed session from the retrospective cutoff and throws away what it
recognizes. If that cursor generalizes, the filter's remaining job may vanish
rather than shrink.

Note what already limits the damage: `hasScanned` skips an unchanged session
outright, so the filter only earns its keep when a session's source version has
moved and the earlier messages come back around.

Found 2026-09-10, proposed by the maintainer after the filter moved into the
data directory and its size became the largest thing YA keeps there.
