# Edit provenance stops at "last session per dirty path"

YA already observes every successful structured file mutation (Edit, Write,
`apply_patch`, provider equivalents, and a bounded set of write-shaped shell
commands) at the normalized `tool_use`/`tool_result` boundary, with the
session, the path, and the tool's before/after content in hand. It retains
only one row per dirty path: the last editing session and an observation
time, cleared when Git status sees the path clean
(`packages/server/src/services/DirtyFileEditorService.ts`,
[Source Control](../../topics/source-control.md) `lastEditor`). Nothing maps a
line to the *turn* that wrote it, nothing survives a commit, and nothing maps
a turn to the lines it changed after the file moves on.

Zed's DeltaDB makes both directions structural by storing every operation
with its producing message ([analysis](../../docs/competitive/deltadb.md)).
YA does not need an operation store to get most of the way there: the
observations exist, they are simply not retained or indexed.

## Desired behavior

- **Line → turn.** From a Source Control diff, blame, or Files line, or from
  the session file viewer, "Which turn wrote this?" resolves to the canonical
  session id, the turn (a real user turn plus its assistant activity), and
  the specific mutation tool call, for dirty and for committed content.
- **Turn → lines.** From a transcript turn, "What did this touch?" lists the
  paths and hunks the turn's successful mutations produced, and can open each
  in Source Control against the current tree, relocated the way
  [review anchors](../../topics/source-review-to-session.md#relocation--deferred-but-its-contract-is-stated)
  relocate.
- **Survives commit.** A committed line keeps resolving to its turn without
  YA writing Git notes or refs. Post-commit resolution uses content matching
  of the retained mutation hunk against `git blame`'s originating commit and
  the current file, not a stored commit id at write time.
- **Honest gaps.** Human edits, unobserved processes, and shell writes YA does
  not recognize stay unattributed; a turn is named only when its retained
  hunk matches. Ambiguity is a result, not a guess.

## Shape

One server-owned, app-data index keyed by project and canonical session:
`(sessionId, turnId, toolUseId, path, hunk content hash, observedAt)` plus a
bounded copy of the mutation's before/after text. It is written by the same
observer that maintains `lastEditor`, so it adds no provider discovery,
transcript backfill, or Git work at observation time. Reads are on demand from
Source Control and the transcript; `lastEditor` remains the cheap projection
and is not replaced.

Retention follows [app-data-only storage](../../topics/project-directory-storage.md)
and needs a size/age budget like the review capture store. This index is the
natural producer for the "Session links" the
[git-notes sketch](committed-change-session-attribution.md) wants on commit
rows; that sketch's notes writer becomes an optional *export* of this index,
not its source of truth.

## Not yet decided

Turn identity across providers (Claude `parentUuid` turns versus Codex
rollout items), how hunks from a resumed or forked session are attributed to
the fork rather than the parent, the retention budget, and whether the
transcript-side "what did this touch" list is a per-turn rail marker or a
turn context-menu action.

Found 2026-09-15 while comparing YA's provenance links with Zed DeltaDB's
"trace code to conversation".
Contributing-model: fable-5.1
