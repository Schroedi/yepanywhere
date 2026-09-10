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

## How urgent this is: not very

Measured for the actual shape — 256 MiB, 8 hashes, all 8 bits inside one
64-byte block, so 4,194,304 blocks — the false-positive rate reaches 0.1% at
**137.6 million messages**, and the 12-bits-per-key mark the code calls full
sits at 179.0 million and 0.407%. Block imbalance costs about 6% against an
idealized filter, which would reach 0.1% at 147.0 million. The maintainer's host
had inserted 15,655 messages, where the rate is around 1.8e-15 percent.

So saturation is a real dead end with no exit, and it is roughly four orders of
magnitude away. Treat it as a design debt to clear deliberately rather than an
incident. The live cost is the other end of the same fact: 256 MiB is reserved
in the data directory to hold what is currently fifteen thousand messages, and
a time-bounded filter would need a tiny fraction of it.

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

### Epsilon is sized by clock jumps, not by write latency

Two hours is deliberately generous, and the reason is that harness and provider
timestamps are not assumed to come from a monotonic, daylight-saving-immune
clock. Epsilon has to absorb a wall-clock step: a daylight-saving shift is the
named worst case at an hour, leaving an hour of margin, and a stepped or
corrected host clock is the same class of event. Do not tune it down toward the
ten-minute write interval; that interval bounds how much recounting a crash
costs under Resolution B and has nothing to say about how far a clock can move.

The watermark is monotonic in YA's own bookkeeping even though the timestamps it
is compared against are not, which is where the two failure directions come
from. Both undercount silently, so both deserve a test:

- **A backward step larger than epsilon** gives newly produced messages
  timestamps below the threshold, so they read as already counted and are
  skipped.
- **A forward step larger than epsilon** drags the watermark ahead of real
  content, and everything produced after the clock is corrected then falls below
  the threshold.

The second is worse under a strictly monotonic watermark, because one message
bearing an absurd future timestamp poisons it permanently. Detect that outlier
and refuse to let it advance the watermark. Do not clamp it to the present plus
a slack: clamping writes down a synthesized time that no content actually
carries, and the watermark's whole job is to state when content was really last
seen. An implausible reading is evidence the clock is wrong, not evidence about
the content, so the watermark should advance from the highest timestamp that
passed the plausibility test and stand still otherwise.

The message itself is still counted. Downgrading a timestamp means distrusting
it as a clock reading, never discarding the text it came with.

Corroboration is the practical test, and the stream of events makes it easy.
Rather than judging one timestamp against the host clock, advance the watermark
only to a time that several later observations agree has passed: a high quantile
over a recent window, or the highest value that some number of subsequent events
have exceeded. One outlier then cannot move it by construction, and the test
needs no reference to the local clock, which matters because the local clock is
the thing we already said not to trust.

The price is that the official time lags real time, and that price is the right
way round. A watermark that lags leaves more content inside the window, so the
filter is consulted for messages that did not need it: wasted lookups, no lost
counts. A watermark that runs ahead skips content and undercounts silently. So
smoothing trades the harmless failure for the harmful one, and the lag it costs
is minutes against an epsilon already measured in hours.

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
on filesystem timestamps. Either way the write interval bounds the error: it
defaults to ten minutes, so "promptly updated" means the resume can recount up
to ten minutes of content. That is this resolution's sloppiness budget, and it
is unrelated to epsilon above.

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
