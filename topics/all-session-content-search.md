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
A stricter needle first refines retained whole searchable turn text, yielding
between short slices so typing can interrupt it. Excerpts are display
projections, never sufficient evidence that a complete turn does not match.
Uncapped sessions reuse acquired prefixes and continue from their saved cursor;
completed sessions require no new disk read until their source changes.
When a third generation starts, it displaces the second unless that second
has enough matching rows for the measured viewport, or is already complete;
then the first is retired. Retired work cannot publish into the current source.
Rows keep a stable order across updates. Initial streaming reserves one match
and a continuation line per selected turn role, within the preview limit. Once
search completes, 500 ms without pointer, keyboard or scroll activity permits
expansion to the requested preview count. Later live updates do not collapse
the already expanded rows back to the initial streaming shape.
Changing search fields or time criteria starts a fresh reservation, including
when turn search is enabled after a settled title-only search.

Progress occupies reserved header space to the right of the needle, with full
text available on hover or tap; starting and stopping work does not move the
results. Incomplete coverage lists quoted, emphasized session titles and reasons
after the matching results, and remains visible during revalidation. Diagnostics
link to the nearest preceding readable turn and identify the source byte offset.
Opening zoom takes a page-owned snapshot;
reordering or revalidation does not dismiss it.

Ctrl+S selects assistant search and Ctrl+R selects user search, focusing the
search box. On a server without turn-search support they only focus title
search. Desktop typing outside an actual text entry returns to the search's end
and applies the typed character. Clicking, selecting, right-clicking and copying
do not steal focus; other text inputs and dialogs retain their interaction. Mobile never
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
integer limits displayed previews independently for User and Ass.; one shows
one of each when both exist. It never stops acquisition. Minus/plus above a
session's first preview adjust this global budget, with minimum one, and
compensate scrolling to preserve that session's position. Their placement leaves
the full checkbox column available for selection.

Acquisition has separate named policy constants, with no settings UI:
`MIN_TURN_SEARCH_QUERY_LENGTH = 1`, `MAX_CACHED_MATCHES_PER_SESSION = 1024`,
`MAX_CACHED_SEARCH_TEXT_BYTES_PER_SESSION = 2 MiB`, and
`MAX_CACHED_SEARCH_TEXT_BYTES_PER_SCAN = 32 MiB`. Byte accounting charges two
bytes per JavaScript string code unit, separate from object overhead. At a
match or text budget limit the session stops, discards whole text, and retains
bounded excerpts/IDs. It restarts for the next needle. A reserved header notice
reports capped sessions; this is distinct from malformed-record coverage.
Backspace or another non-prefix edit starts fresh acquisition. Uncapped sessions
retain both roles and all timestamps, so role/time filtering does not reread
transcripts. Title-only search never initiates turn acquisition.

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
turns fail visibly. Retained whole text supplies tooltips immediately; after
cache eviction and on older servers, a tooltip fetches bounded transcript pages
by stable turn ID. The concise selection help sits inline with filters only if
it fits without another row; otherwise it follows results in scrolling flow.

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
The cursor binds the acquisition request, expires after 30 minutes, and becomes
invalid after server restart. Client refinement keeps that original broader
acquisition needle for cursor reads and filters returned whole text against the
current needle; no subscription update is needed. Completed batches return `resumeCursor`,
which resumes append acquisition from the verified native tail.
New batches also report replaced message IDs, so a revised message that no
longer matches removes its old hit. This optional delta is additive for older
clients.
Older servers without `resumeCursor` revalidate only the changed session from
its start.
`includeSearchText` requests whole matching text; `includesSearchText` confirms
complete text coverage even for an empty batch. Older servers ignore the request
field and cannot seed exact local refinement, so those sessions rescan.
`allowRestart` lets a native reader return an authoritative `reset` batch and
valid continuation after replacement, truncation, layout or boundary changes.
Normal appends continue quietly; unfinished final JSON awaits its next append
without a malformed-record warning. Legacy requests retain their original
source-version checks and 409 restart response. Expired cursors restart only the
affected session; acquisition errors do not stop the remaining traversal.

Provider metadata advertises `supportsBoundedTurnSearch`, independently of
installation or authentication. The Providers menu explains which providers
support bounded turns and which remain title-only. Known unsupported providers
are excluded before content traversal and from its progress count, while their
titles and opening prompts remain searchable. Explicit server capability values
take precedence; older servers without this additive metadata field use the
known Claude-family and Codex-family reader support. The global route capability
still gates all turn requests, including on v0.8.0/v0.8.1.

The initial provider reader supports Claude-family and Codex-family transcripts.
It admits up to 128 native records and 8 MiB per batch, skips oversized or
malformed records with explicit partial coverage, and searches visible user
and assistant text rather than tool output or reasoning. Case, escaped display
line breaks, and whitespace runs are normalized using the preview rules;
Markdown-delimiter normalization from the index sketch
is not implemented. Ordinals count normalized visible records.

The page shares four concurrent batch slots across both generations, rotating
eligible sessions after each batch so a long transcript cannot starve later
matches. The server admits at most four concurrent
requests; identical in-flight native reads join one computation. There is no
persistent search job or transcript cache between requests. Legacy or manual
requests for unsupported providers return an explicit unavailable result before
project or native-reader access, never a complete empty transcript result.
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
