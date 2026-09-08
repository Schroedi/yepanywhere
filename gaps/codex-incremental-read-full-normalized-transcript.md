# Codex incremental catch-up reads still hold the full normalized transcript

Compact-tail bounding is gated on `afterMessageId === undefined`
(`packages/server/src/sessions/codex-reader.ts`, `getSession`). Every
incremental catch-up read on an owned live session therefore works from the
whole normalized transcript to return a handful of new rows.

Observed 2026-09-08 on Codex session `01a075a8-3339-7110-a496-4f3d52b30675`
(288 MiB rollout). `session_detail_slow` rows about 30 s apart:

- `normalizedMessageCount` 18774 → 18952 across the run
- `returnedMessageCount` 0–13
- `afterMessageId` set on every one of them

The per-read cost is **not** re-parsing: `readMs` stayed at 20–80 ms and
`normalizeMs` at 1–2 ms, so the entry and normalization caches are doing their
job. Two reads did spend ~980 ms in normalize, and `projectMs`/`routeMs`
ranged 0–950 ms, but that variance is not attributed — it may be event-loop
contention from other work rather than this session.

So the concern is retention and the slicing walk, not repeated parsing: an
owned live session keeps ~19k normalized rows resident and scans them per
catch-up. This was not measured, and no user-visible symptom was traced to it.

Not fixed with the uncursored path because bounding an incremental read needs
its own cursor-to-source-offset story: `afterMessageId` is a durable message id,
not a byte position, and the compact-tail window may not contain it. Measure
resident size and slice cost before designing that.

Found 2026-09-08 while fixing the uncursored compact-tail window for a live
Codex rollout (`topics/session-compact-tail-pagination.md`
§ Indexed head fields for a session still being written).
Contributing-model: opus-5
