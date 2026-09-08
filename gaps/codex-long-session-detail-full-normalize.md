# Long Codex session-detail still full-normalizes despite compact-tail

YA claims long sessions are supported by compact-tail pagination
([`topics/session-compact-tail-pagination.md`](../topics/session-compact-tail-pagination.md)
§ Provider-bounded source windows): a default
`tailCompactions=2` / `tailTurns=20` read should omit the known-hidden
prefix before normalization.

Visiting
`01a075a8-3339-7110-a496-4f3d52b30675`
(yepanywhere project, live Codex rollout
`~/.codex/sessions/2026/09/06/rollout-2026-09-06T07-39-12-01a075a8-3339-7110-a496-4f3d52b30675.jsonl`)
on 2026-09-08 still did a 3.7 s session-detail on the Hono thread:

- file size ~281 MiB and still growing
- `normalizedMessageCount` 18511
- `returnedMessageCount` 458
- `totalMessageCount` 1582
- `tailCompactions` 2, `tailTurns` 20, `owned` false
- timings: read 1520 ms, normalize 1016 ms, route 725 ms, augment 456 ms

That is a full-transcript normalize then a slice, not a bounded source
window. The same generation logged `CODEX_READER: slow entry read` for
this session id immediately before the detail request.

This is the long-session example. It did **not** show stuck Sending.
The per-tab `Sending` chip stall on a different Codex session was a
missed live user-echo with no while-connected fallback (`c0c98ff80`).
The coupling risk remains: this 3.7 s parse shares the event loop with
every provider’s POST and WS. Sibling-tab composer resurrection of the
last sent prompt is separate
([sibling-tab-restores-sent-composer-draft](sibling-tab-restores-sent-composer-draft.md)).

Sidebar/new-window slowness with many Codex rows is the same family:
`CODEX_SCANNER: slow scan` / `CODEX_READER: slow scan` every few
seconds (often 100–800 ms). Retained collections already split list
hydration from async question enrichment
([`topics/session-catalog-observation.md`](../topics/session-catalog-observation.md));
session-detail and the Codex scanner/reader have not.

Cheap fix if the bounded reader is supposed to fire here: make the
default session-detail path refuse a response whose
`normalizedMessageCount` greatly exceeds the returned tail unless
`fullHistory=1`, and keep prefix omission before normalize. Do not
raise the slow-log threshold.

Same class as the 2026-08-04 277 MiB Codex parse incident in
[`topics/server-performance-observability.md`](../topics/server-performance-observability.md).
That write-up’s process-list child-projection owner is not automatically
this session-detail owner.

Found 2026-09-08 while checking whether a 281 MiB Codex session was
the stuck-Sending tab (it was not).
