# All-Session Content Search

> All Sessions incrementally searches catalog titles and optional visible turn
> text, grouping matches by session while preserving explicit selection.

Topic: all-session-content-search

## Search surface

The sidebar's All Sessions view owns these controls; in-session search keeps
its existing bindings and behavior. Title is enabled by default. Ass. and User
are opt-in, independent checkboxes whose matches form a union. Title searches
the displayed title and the original opening prompt retained in hot metadata.
A rename does not replace that retained prompt.

Typing is acknowledged locally, independently of router navigation and result
work: no keystrokes may be dropped, and each must appear within 100 ms.
Title-only search reads catalog metadata and makes no content-search request.
The result DOM grows in batches as the reader scrolls; filtering and selection
still cover all matching sessions, including those not mounted yet.

Turn search keeps one latest pending needle and at most two scan generations.
A stricter needle filters previous previews while a replacement scan runs;
an excerpt failing that local filter does not prove its complete turn fails.
When a third generation starts, it displaces the second unless that second
has enough matching rows for the measured viewport, or is already complete;
then the first is retired. Retired work cannot publish into the current source.
Rows keep a stable order across updates. Initial streaming reserves one match
and a continuation line per session, within the user's preview limit. Once
search completes, 500 ms without pointer, keyboard or scroll activity permits
expansion to the requested preview count. Later live updates do not collapse
the already expanded rows back to the initial streaming shape.
Changing search fields or time criteria starts a fresh reservation, including
when turn search is enabled after a settled title-only search.

Progress occupies reserved header space to the right of the needle, with full
text available on hover or tap; starting and stopping work does not move the
results. Incomplete coverage lists session names and reasons inline and remains
visible during revalidation. Opening zoom takes a page-owned snapshot;
reordering or revalidation does not dismiss it.

Ctrl+S selects assistant search and Ctrl+R selects user search, focusing the
search box. On a server without turn-search support they only focus title
search. Desktop focus returns to search after non-entry interactions; other
text inputs, native choices and dialogs retain their interaction. Mobile never
autofocuses search. The header has no redundant All Sessions caption. Search in
appears only when the field checkboxes occupy their own row.

## Time and result limits

A single Turns / Last activity / Created selector chooses what an age range
constrains. The minimum and maximum fields accept d, h and m, with days implied
when the unit is omitted. Bounds are inclusive. Blank means 0d / infinity;
the upper field also accepts the infinity symbol. Negative, malformed and
reversed bounds produce a visible error rather than silently changing meaning.
The lower value is right-aligned and the upper value left-aligned toward the
separator. Small initial fields grow while typing and retain reserved width
during editing to avoid repeated expansion and contraction.

Turns uses original message timestamps. Last activity and Created constrain
sessions. A renamed title has no turn timestamp; the original prompt uses the
session creation timestamp. Multiple simultaneous ranges remain a possible
future extension, not an assertion that their combinations are invalid.

Turns/session is empty by default, meaning every matching preview. A positive
integer limits displayed previews per session; it never limits which sessions
qualify or certifies an incompletely searched transcript.

## Selection and actions

Let S be explicit selected session IDs and F the current query and filters.
Displayed sessions are (S when nonempty, otherwise the whole catalog)
intersected with F. Typing, clearing text, changing filters, and excluding rows
never change S.

The summary displays a checkmark N, a bordered left-arrow action, and result
count M. N opens selection management. The arrow replaces S with the current
result session IDs, including matches below the viewport; it does not add to
S. It is disabled for zero results because assigning an empty set would remove
the selection restriction. The larger red X clears S. With no selection,
M can exceed N; there is no separate hidden count.

Selection management explains each excluded session's applicable project,
provider, executor, status, time, or selection restriction. For eligible
sessions without text matches it distinguishes ongoing search, incomplete
coverage, errors, and completed nonmatches. All fields unchecked produces an
explicit field-choice hint. Keeping results during a scan takes a snapshot of
matches found so far; late arrivals do not add to that selection.

Archive/unarchive, star/unstar and read/unread icons filter their statuses.
Opposites are exclusive; different pairs intersect. The most recently active
filter exposes Make [status] followed by the checkmark and N. This action
updates the complete explicit selection, including currently excluded rows.
An operation keeps its original server transport across all batches, even
when the user switches servers while it runs.
Its tooltip names the action and selected count. No selection disables the
action. The action sits to the right on desktop and occupies a normal-height
full row on phones. Filter is omitted only when the compact row lacks room.

The checkbox owns a wide, full-height selection column. Role/ordinal chips
visually occupy that column and align against the preview's blue rule.
Clicking the column selects instead of navigating. Titles extend halfway
into it; provider metadata retains its usual indentation. Ordinary row and
preview links navigate, including while there is a selection. Modified clicks
and middle clicks retain new-tab behavior.

## Previews and navigation

All Sessions and the in-session rail share excerpt generation and highlighted
text rendering: 24 characters before and 118 after the first match. A result
uses a stable normalized message ID; opening it loads older bounded pages
when necessary and jumps through the normal transcript navigation owner.

Title matches appear in the session title itself, with no separate Title row.
The title or matching opening prompt is fitted around the needle using the
actual available line width and inherited font, with ellipses on either side
as needed. Resizing recalculates that excerpt.

Full-text tooltips load detail on demand. The match menu offers Zoom preview:
full matching turn, a separator, and a bounded next assistant preview for a
user match or preceding user preview for an assistant match. Neighbor context
need not satisfy the search filters. Detail loading is abortable; unavailable
turns fail visibly. Help follows the results in normal scrolling flow.

## Initial acquisition and compatibility

The maintainer approved this optional contract on 2026-09-14 after review of
v0.8.0 (2026-08-31) and v0.8.1 (2026-09-05). Permanent capability
`session-content-search`, ID 73, is version-implied from 0.8.2 and explicitly
advertised by source builds. Those two older releases keep title-only search,
disable Ass./User with upgrade guidance, and receive no requests to the new
route. No existing capability changes meaning.

`POST /api/sessions/content-search` takes one catalog session ID, query,
selected user/assistant roles, optional inclusive absolute timestamp bounds
`after`/`before`, and an optional opaque cursor. It returns bounded matches,
continuation, done/partial flags, bytes read and an optional unavailable reason.
Authentication and source access remain those of normal session routes.
The cursor binds the request and source version, expires after 30 minutes,
and becomes invalid after server restart. Ordinary continuations require the
same source version. Completed batches may additionally return `resumeCursor`,
which resumes append acquisition from the verified native tail.
New batches also report replaced message IDs, so a revised message that no
longer matches removes its old hit. This optional delta is additive for older
clients.
Older servers without `resumeCursor` revalidate only the changed session from
its start.
Expired cursors, detected replacement, truncation, changed segment layout or
saved-boundary mismatch restart only the affected session; failed acquisition
is reported for that session and does not stop the remaining traversal.

The initial provider reader supports Claude-family and Codex-family transcripts.
It admits up to 128 native records and 8 MiB per batch, skips oversized or
malformed records with explicit partial coverage, and searches visible user
and assistant text rather than tool output or reasoning. Case, escaped display
line breaks, and whitespace runs are normalized using the preview rules;
Markdown-delimiter normalization from the index sketch
is not implemented. Ordinals count normalized visible records.

Each generation pulls one batch at a time, rotating between eligible sessions
after every batch so a long transcript cannot starve later matches. The server admits at most four concurrent
requests; identical in-flight native reads join one computation. There is no
persistent search job or transcript cache between requests. Unsupported
providers report incomplete coverage, never a complete empty transcript result.
A stopped client produces no further batches; a shared in-flight batch is
bounded by its record/byte limits and timeout.

A hidden document or page-hide event suspends content acquisition and aborts
the client's outstanding requests. Matches, coverage and cursors remain in
memory; summary changes coalesce while hidden. Visibility or page-show resumes
only unfinished and changed eligible sessions. Navigation/unmount permanently
stops that page's search. An already accepted shared server batch may finish
within its existing bounds, but a hidden or closed page requests no successor.

The existing source activity subscription supplies catalog and new-session
changes. Search has one eligible session-ID set, reconciled before scheduling:
project, provider, executor, status, explicit selection and session-time filters
exclude sessions from content traversal. Counts use that same eligible set.
Unchanged sessions retain matches and coverage; changed sessions resume their
tail, and newly eligible sessions join the queue. No per-session network
subscription or periodic whole-catalog content rescan is created. New owned
session notices include model, executor and activity alongside title, project
identity/name, creation time, last activity and provider. Existing metadata
updates keep those rows current without a detail fetch for every notice.

## Design decisions and remaining work

**Bounded request batches** (versus a new streaming transport): work over both
direct and encrypted relay HTTP without introducing another subscription
protocol. Results still arrive progressively.

**Title-only default** (versus automatic transcript scans): preserve fast hot
metadata search; disk work starts only when a turn field is selected.

An efficient disk-backed substring index for selected sessions and all sessions
is still absent. Word-boundary anchored matching remains an option to evaluate,
not an enabled query restriction. The open
[index and acquisition gap](../gaps/all-sessions-search-index.md) tracks this
and remaining provider/coverage limitations. Candidate indexing, maintenance
and measurement choices remain in the
[sketches](all-session-content-search.sketches.md).

Search and future index state stay in YA app data, never selected projects or
their Git metadata. Provider transcripts remain canonical.

Related contracts: [session catalog](session-catalog-observation.md),
[session detail](session-detail-data-layer.md),
[project storage](project-directory-storage.md), and
[capabilities](server-capabilities.md).
