# Session rewind, `/clear N`, `/fork N`, and `/clearloop`

> An in-place rewind drops the tail of a live session while keeping its
> session id, records the dropped turns as a collapsed group in YA's durable
> history, and is the primitive behind `/clear N`, the turn menu's Clear
> entries, and the `/clearloop` repeat.

Topic: session-rewind

Status: specified 2026-09-18; Claude is the first provider. Codex follows
once `thread/revert` is in YA's generated protocol (see
[gaps/fork-is-the-only-rewind-and-changes-the-cache-key.md](../gaps/fork-is-the-only-rewind-and-changes-the-cache-key.md)
for the provider primitives and the cache measurements that motivated this).

Related topics:
[fork-from-turn](fork-from-turn.md) (the existing per-turn Fork menu these
entries join; a fork creates a new session, a rewind keeps this one),
[session-context-actions](session-context-actions.md) § Clear (the kebab-menu
Clear, which starts a *new* session; `/clear N` is not that),
[emulated-slash-commands](emulated-slash-commands.md) (YA-routed command
rules and the tagged `ya-command` queue chip),
[queued-messages](queued-messages.md) (the server-owned queue projection the
clearloop entry rides on),
[transcript-display-objects](transcript-display-objects.md) (the durable
notice and rewind records are display objects, never model context),
[claude](claude.md) § Transcript Structure (why a rewound tail is a dead
branch in the Claude transcript, and why the reader hides it today),
[settings-ui-placement](settings-ui-placement.md) (why the inactivity window
is one server-wide value).

## Vocabulary

- **Turn index `N`.** The 1-based ordinal of a real user turn in the
  session's active branch, in display order. Tool-result user rows, compact
  rows, injected context, and synthetic rows are not turns (same boundary
  rule as [fork-from-turn](fork-from-turn.md)). `N` is a stable identifier: a
  rewind only removes turns *after* its cut, so every surviving turn keeps
  its index, and turns written after a rewind continue the count from the cut.
  `N = 0` names the empty prefix before turn 1.
- **Cut.** The last kept chain entry. *After turn N* keeps turn N's prompt
  and its complete response; *before turn N* keeps everything preceding
  turn N's prompt, which is the same cut as *after turn N−1*.
- **Rewind.** Drop everything past the cut from the provider's live
  conversation while keeping the session id. On Claude this is the SDK's
  truncating resume (`resume` + `resumeSessionAt`), so it is a process
  restart; the transcript file keeps the dropped rows as a dead branch.
- **Rewound group.** The dropped tail, kept in YA's durable session view as
  one collapsed outline entry at the cut.

## Commands

All three are YA-routed commands resolved by the composer's typed command
resolver before provider ingress (`parseComposerSlashCommand`,
`handleCustomCommand`). Their argument text is parsed by their handler, not
the generic layer. They are available only when the server advertises the
`session-rewind` capability and the session's provider supports rewind;
otherwise the command menu marks them unavailable and a typed invocation
fails visibly with the draft retained (never falls through as prompt text).

- **`/clear N`** — rewind to the cut *after turn N*. Turn N and its response
  are the new tail. `/clear` with no argument is `/clear 0`.
- **`/clear 0`** — drop every turn. On Claude the first chain entry is turn
  1's own prompt row, so the truncating resume cannot express an empty
  prefix. v1 therefore implements `/clear 0` on Claude as the existing Clear
  action from [session-context-actions](session-context-actions.md): a new
  session with the same project, provider, and model, plus a rewound group
  in the *old* session recording that it was cleared to the new one. The
  grouped-in-place guarantee below applies to `N ≥ 1`.
- **`/fork N`** — identical to the turn menu's **Fork after this turn** at
  turn N: a new cold session keeping through turn N. This session is
  unchanged.
- **`/clearloop [N] M: <prompt>`** — repeat: rewind to *after turn N*, send
  `<prompt>`, wait for the iteration to end, M times. The colon after `M` is
  required and separates the counts from the prompt, which is taken
  verbatim (leading whitespace trimmed). When `N` is omitted, `N` is the
  current last turn index, so the first rewind is a no-op and
  `/clear N` followed by `/clearloop M: p` is equivalent to
  `/clearloop N M: p`. `M ≥ 1`.

**Native `/clear` is deliberately shadowed.** The
[emulated-slash-commands](emulated-slash-commands.md) rule that a
provider-native command wins has one exception here: Claude's native
`/clear` starts a fresh context with no YA history, and the whole point of
`/clear N` is the kept id and the durable group. The composer's command
menu shows the YA entry, not the provider's, for `clear` on rewind-capable
providers.

## Turn menu

The existing per-prompt **Fork from this turn** menu
(`ForkTurnMenu`, rendered by `UserPromptBlock`) gains two same-session
entries on rewind-capable providers, after the fork entries:

- **Clear after this turn** — `/clear N` for this turn.
- **Clear replacing this turn** — `/clear N−1` for this turn, then put this
  turn's prompt text into the composer as a draft (the Codex Esc-Esc shape).
  The draft replaces an empty composer only; a nonempty draft is left
  untouched and the prompt is offered through the existing draft-recovery
  copy instead.

The menu's trigger tooltip becomes **Fork from this turn [N]** so the index a
user types into `/clear N`, `/fork N`, and `/clearloop N …` is discoverable
from the turn it names. The same index is shown in the user-turn navigator
rail entries. Both entries are disabled while the selected or latest
response is still active, exactly like Fork after; the menu never waits
implicitly.

## Server rewind operation

`POST /api/projects/:projectId/sessions/:sessionId/rewind` with
`{ cut: { kind: "after-user-turn" | "before-user-turn", sourceMessageId } }`
or `{ cut: { kind: "after-turn-index", turnIndex } }`. The server resolves
the real human-turn boundary from the transcript exactly as the fork route
does (provider ids stay server-side), then:

1. Rejects (`409`) when the session is `in-turn`, `waiting-input`, or
   compacting, when a live queued or steered message is pending, or when the
   cut is not a completed human-turn boundary. The client never substitutes
   a partial boundary.
2. Records a **rewind record** in session metadata before touching the
   provider: `{ id, at, cutMessageId, droppedFromMessageId, droppedTurnCount,
   reason: "clear" | "clearloop" (+ loop id and iteration) }`. It is a
   display object: never model context, survives restart and device change.
3. Restarts the provider process with `resumeSessionAt = cutMessageId`. When
   exactly one turn is dropped, `resumeDropsTurn` names that turn's prompt
   UUID so the CLI refuses if the discarded range holds anything the user's
   view had not seen (an absorbed queued message, a task notification). The
   SDK validates only a single declared turn, so a multi-turn drop passes no
   `resumeDropsTurn` and YA performs the equivalent check itself from the
   transcript: the discarded range must consist of the dropped turns' own
   rows. A refusal is deterministic; YA reports it, deletes the rewind
   record, and does not retry.
4. Returns the new turn count and the rewind record. The queue projection and
   session metadata event carry the record so every client converges.

The rewind changes only the conversation. Files, worktree state, and
provider-side file checkpoints are untouched; a code-restoring rewind is the
separate [fork with worktree checkpoint](../gaps/sketches/fork-with-worktree-checkpoint.md)
story.

## Durable history: the rewound group

YA's session view must not lose rewound turns. The Claude reader today hides
a deliberate rewind branch (the active branch continues through a user row)
per [claude](claude.md) § Transcript Structure. With rewind records as an
input, the reader instead emits the dropped rows as a **rewound group**:

- Group membership: rows descending from the cut whose branch was written
  before the record's `at`. Rows the session writes after the rewind are the
  live branch and are never grouped, even before the next turn exists (the
  record, not tip selection, decides the cut; until a new turn is written the
  displayed tail is the cut itself).
- Placement: at the cut, in transcript order, before any later live rows.
- Presentation: one collapsed outline entry by default, labelled with the
  reason, the cut (`cleared after turn N`), the dropped turn count, and the
  time; for a clearloop iteration also `m/M`. Expanding shows the dropped
  turns with their ordinary rendering. The nested-subagent presentation
  (`subagent-item` rows in `RenderItemComponent`) may be reused for the
  group body. The main session view is required; the sidebar's nested
  rendering of the same group is optional.
- Every rewind produces its own group, so M clearloop iterations leave M
  reviewable groups at the same cut, in order.
- Search, copy, and turn navigation treat grouped rows as history: they are
  reachable when expanded and never counted as turns for `N`.

## `/clearloop`

A clearloop is a **server-owned job** persisted in session metadata
(`{ id, cutMessageId, cutTurnIndex, prompt, total: M, completed: m,
state: "running" | "completed" | "cancelled" | "interrupted", startedAt,
endedAt }`). The requesting tab may disconnect; the loop continues.

**Iteration.** Rewind to the cut (the first iteration is a no-op rewind when
the cut is already the tail), then send the prompt as an ordinary direct
turn. The iteration ends when the session has been **inactive for the
inactivity window**: no user send and no assistant progress for that long,
where progress is any provider message or raw provider event and the session
is idle or waiting for input at the end of the window. Then `m` increments;
if `m < M` the next iteration starts, else the loop completes.

**Why inactivity, not turn counting.** A strict "one assistant turn plus its
blocking question and answer" boundary requires YA to classify every user
send as a question answer or a manual turn. The inactivity boundary needs no
classification and behaves obviously with the rest of the queue: a patient
queued message lands when the session is quiet, a steer lands during work,
and both simply reset the window. They are part of the iteration, and the
next rewind discards them into that iteration's rewound group along with
everything else after the cut. The strict variant remains a candidate behind
the same boundary seam; v1 ships inactivity only.

**Inactivity window setting.** One server-wide value,
`clearloopInactivitySeconds`, in the **Message delivery** settings
category, default 60, range 10 s to 1 h. It is edited as text accepting a
number with an `s`, `m`, or `h` suffix (`45s`, `2m`, `1h`; a bare number is
seconds), rounded to whole seconds and clamped to the range, and displayed
in the same form. It is server-definitive because the server runs the timer.
A running loop reads the current value at each boundary.

**Queue rail entry.** While a loop is running, the canonical queued-message
projection carries one entry `kind: "ya-command", yaCommand: "clearloop"`
with the prompt, `m/M`, and state. It renders through the existing chip
surface with a **m/M badge**, is always ordered last in the rail, and its
tooltip shows the full prompt. It never occupies a deferred, patient, or
provider delivery position, exposes no Steer or edit action, and no queued
send is ever admitted through the patient or deferred lane to start an
iteration: the loop sends its prompt directly at the boundary it owns.
Because the projection is server-owned, the badge is identical on every
tab and survives reloads.

**Stopping.**

- The entry's **x / cancel** control cancels the loop **without** stopping
  in-flight assistant work and **without** starting a turn: the current
  iteration is left to finish on its own, no further rewind happens, and the
  loop state becomes `cancelled`.
- The session **stop** button (abort) interrupts the provider as usual and
  also ends the loop as `interrupted`.
- Ordinary sends do not stop the loop (see the inactivity rationale). A user
  who wants to keep the current iteration's result cancels the loop before
  the window elapses.
- A rewind refusal or provider failure ends the loop as `interrupted` with
  the error.
- A server restart during a running loop marks it `interrupted`; YA never
  resumes a loop on startup.

**Durable notice.** Every terminal state writes a durable notice into the
session at the tail (a `local_command` display row, like goal receipts):
the original `/clearloop N M: <prompt>` line, `completed m of M`, and for
`cancelled`/`interrupted` the remaining `M−m`. The notice is session
history, not a toast, and is never model context.

## Defaults and compatibility

- The commands are explicitly invoked transforms and need no option
  ([vanilla-defaults](vanilla-defaults.md)). The two menu entries are added
  inside the existing hover menu on rewind-capable providers; the rewound
  group is collapsed by default so the default view reads like the
  provider's own rewound timeline. Authorized by graehl on 2026-09-18 in the
  originating request.
- `session-rewind` is a permanent, version-implied server capability,
  **ID 66**, introduced after 0.8.2, gating the rewind route, the clearloop
  routes, the `clearloop` queued-entry kind, and the rewind records in
  metadata. The optional-feature horizon on 2026-09-18 is v0.8.0 and
  v0.8.1 (the latest two stable releases and all releases from the
  preceding 14 days); neither has any of these. Without the capability the
  client hides the menu entries, marks the commands unavailable, makes no
  rewind or clearloop request, and ignores unknown queue kinds and metadata
  fields. No existing capability meaning changes; existing fork behavior is
  unchanged. The originating request approved this gate.
- Providers: Claude, Claude Gateway, and Claude Ollama sessions. Others
  report rewind unsupported; the route returns `409` and the client hides
  the surface.

## Tests that should fail on contract regressions

- `/clear N` on an idle Claude session restarts the process with
  `resumeSessionAt` equal to the last chain entry of turn N, records the
  rewind, and the next transcript read shows turns `1..N` live plus one
  collapsed group holding the dropped turns; the group persists across a
  metadata reload.
- `/clear N` during `in-turn` or with a pending queued message is refused
  with `409` and records nothing.
- A single-turn drop passes `resumeDropsTurn`; a multi-turn drop does not,
  and a discarded range containing a non-turn row is refused by YA.
- `/clearloop 3 2: p` and `/clear 3` then `/clearloop 2: p` produce the same
  rewind records and sends.
- A clearloop iteration ends only after the configured inactivity window
  elapses with no user send and no provider event; a steer or patient
  delivery inside the window resets it and is included in the next group.
- Cancel on the clearloop entry leaves the running provider turn alone,
  performs no further rewind, and writes the `completed m of M` notice.
- The clearloop entry never appears in deferred or patient positions and is
  ordered last.
- The inactivity setting rejects values outside 10–3600 seconds and parses
  `s`/`m`/`h` suffixes.
- Without `session-rewind`, the client shows no Clear menu entries and sends
  no rewind request for a typed `/clear N`.
