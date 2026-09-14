# All Sessions turn search still requires transcript sweeps

The initial All Sessions implementation pulls bounded native-record batches
from disk. It has no efficient disk-backed substring index for either explicit
selected sessions or the complete session catalog. Repeated needles therefore
repeat acquisition; a long first session can delay later-session matches.

Build the index behind the existing capability/coverage boundary in
[all-session content search](../topics/all-session-content-search.md). Evaluate
full substring candidates against token-begin-anchored search, including disk
amplification, short needles, Unicode boundaries, selected-session intersections,
append/rewrite invalidation and exact verification. A token-begin restriction
would be an explicit product contract, not a silent optimization. Worker or
off-node acquisition remains an option if measured disk/parse cost warrants it.

The first bounded native reader covers Claude and Codex families. Other
providers report unavailable coverage; oversized/malformed records report
partial coverage. Extend their native bounded readers instead of falling back
to unbounded whole-session reads. Match ordinals currently count visible
records, not coalesced conversational turns; normalization parity across record
boundaries and Markdown display delimiters remains to be established.

The index should return low-latency session-grouped matches with original
timestamps, stable IDs and on-demand context, while keeping coverage explicit.
Cap retained memory, share identical source-version work across clients, stop
unused work, and measure query/cancellation cost against the reference scan.
The [index sketches](../topics/all-session-content-search.sketches.md) preserve
candidate structures and measurement gates.

Found 2026-09-14 while implementing the approved All Sessions search design.
