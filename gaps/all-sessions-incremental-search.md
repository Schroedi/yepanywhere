# All Sessions lacks incremental content search and an editable age range

Status: open. User-requested gap and UI discussion, 2026-09-14; no production
implementation authorized by this request. This concerns the sidebar's **All
Sessions** destination, not changing search inside a single session.

Related current boundary: [all-session content search](../topics/all-session-content-search.md).
The existing [search sketches](../topics/all-session-content-search.sketches.md)
own the candidate server search, corpus, cancellation, coverage, and compatibility
design. The UI requirements below refine that proposal's older User / Assistant /
Both selector; they do not approve its backend design or reprioritize the roadmap.

## Current evidence

- `packages/client/src/pages/GlobalSessionsPage.tsx`: `searchInput` changes
  immediately, but `handleSearch` submits it to the catalog query. `AgeFilter`
  accepts only 3/7/14/30-day lower bounds against `updatedAt`.
- That page owns `selectedIds` separately from `filteredSessions`, but does not
  restrict the search corpus to selected sessions. `handleSelectAll` replaces
  the set. Filter edits must preserve hidden selections; the deliberate
  Select just shown action replaces the set.
- `packages/client/src/components/BulkActionBar.tsx` currently renders fixed
  bottom actions: archive/unarchive, star/unstar, and mark read/unread, plus a
  filtered select-all shortcut when nothing is selected.
- `packages/client/src/components/UserTurnNavigator.tsx` owns highlighted match
  previews, full-text titles, expanded facsimiles, and excerpt context (24
  characters before, 118 after a collapsed match).
  `UserTurnNavigator.module.css` owns their presentation.
- The user's screenshot shows the current search field and older-than menu.

## Requested behavior

- Search incrementally as text, search fields, or valid filters change. No
  Enter, search-button click, or blur is needed to run a search. A short
  debounce may bound requests; cancel/supersede old queries and reject late
  results. Incomplete coverage must not be presented as a complete empty result.
- Offer three independent checkboxes under **Search in**: **Title**,
  **Assistant**, and **User**. Checked fields form a union. Title implicitly
  searches the opening prompt too when it differs from the editable title;
  there is no separate opening-prompt checkbox. Renaming must not erase the
  opening-prompt match, and a turn matching multiple fields appears once.
  The visible-text exclusions in the existing sketches continue to apply.
  This user refinement supersedes the earlier four-checkbox design.
- Put the checkboxes to the left of a bounded-width search input in the title
  bar; remove the "All Sessions" heading from that bar. On mobile, wrap the
  input below the checkboxes and hide C-s/C-r hints. No "Turn text" caption or
  "text" suffix on the role labels. Use **Projects** and **Providers**, without
  "All", for unfiltered dropdown labels. Drop the visible **Age** caption.
  Keep the result list compact: avoid stacked explanatory labels, oversized
  controls and cards, or persistent helper prose consuming result space.
- While All Sessions is active, Ctrl+S and Ctrl+R focus its search box and
  activate assistant-text and user-text search respectively. Handle the browser
  default locally to that route. Leave single-session bindings unchanged.
- Replace the age preset menu with two editable text fields, visually
  **[0h] – [14d]**. Accept `d`, `h`, and `m`; a number without a suffix means
  days. This specifies both ends of a time range, rather than only "older than".
  The preferred discussion design is a single three-way toggle choosing
  **Turns / Last activity / Created**, below the two turn-text checkboxes.
  Turns restricts the age of content searched; Last activity and Created
  restrict sessions. Blank bounds mean unbounded: lower placeholder `0d`,
  upper placeholder `∞d`. The user also considered three ranges with automatic
  expansion, but expects joint conditions to be uncommon; the recommendation
  remains one range, with no automatic weakening of other conditions.
  All combinations of the three conditions are valid; one range is a UX
  simplification, not a claim that joint constraints are contradictory.
- Show session-grouped results with first matching turn previews directly
  beneath each session, in the search outline/toolbar presentation. Hide
  nonmatching sessions. Reuse the in-session Ctrl+S preview code and styling,
  including excerpt amount, highlighting, and full-text tooltip; extract its
  presentation owner rather than copying a separate implementation into the
  production All Sessions page. Do not mount transcript viewers for every hit.
- Offer a **first N matches per session** display limit. The main task is to
  locate a session, then a position within it; a prolific session must not
  dominate the result list. The limit controls preview presentation, not which
  sessions qualify or how much history is indexed/searched.
  Use a small **Turns/session** text box, empty by default (no limit), at the
  end of the Projects/Providers row. Show an infinity placeholder and explain
  empty/unbounded semantics in its tooltip. A positive integer limits previews.
- Session/result links offer ordinary opening and opening in a new tab at the
  matched position. Standard click, modified-click and middle-click behavior
  suffices; use real stable deep links rather than click-only buttons. Keep
  tooltips. A context menu may initially contain only **Zoom preview**.
  The session item opens its first displayed match; each excerpt opens its own
  position. No redundant "Open match" button. Only the explicit checkbox
  toggles selection: tapping the item must not deselect it and remove it from
  the selected-only result set. Keep checkbox left inset and native margins
  minimal while retaining a practical touch target.
  Reserve a full-height selection gutter with a large hit area (40px wide in
  the mockup). The entire gutter belongs to selection and cannot activate the
  session link; the checkbox's visible ink remains close to the left edge.
- Zoom preview shows the full matched turn, then a horizontal rule and a
  neighboring-turn preview: prefer the next assistant turn for a user match,
  or the preceding user turn for an assistant match. The neighboring turn is
  context and need not match the search. Keep menu access available to touch
  users as well as desktop right-click and keyboard users.
- If selection is nonempty, search only those session identities, intersected
  with age/project/provider/status filters. Search exclusion must never clear a
  selection checkbox. Clearing the query or changing filters reveals selected
  rows with their checks intact. Keep selection independent of result pages,
  query generations, and duplicate-title hiding; matching distinct sessions
  must remain reachable even when their titles are equal.
- Place existing bulk action buttons beside the selection summary, replacing
  the detached bottom action bar. Each tooltip states **[action] N selected**,
  using the complete explicit selection count, including filtered-out sessions.
  Keep existing applicability/pending rules and operation behavior.
- Add **Select just shown**. User-confirmed implementation: set the explicit
  selection to the visible result session IDs (`selection = shownSessionIds`).
  This replaces the selection, not a union. A search for A, Select just shown,
  search for B, Select just shown, then search for C operates over the successive
  intersection A ∩ B ∩ C. Only this deliberate button or explicit
  checkbox changes discard selected nonmatches; typing/filtering alone does not.
  Typing, replacing or clearing a series of needles never creates a selection,
  accumulates matches, or implicitly intersects queries. With no explicit
  selection, each query searches the full eligible catalog independently.
  The two independent inputs are the persistent explicit selection and the
  current time-range/needle/filter criteria. Shown results are their
  intersection, using the full catalog when selection is empty. An empty needle
  does not clear or bypass a nonempty selection. "Shown" means the result list,
  including rows below the fold, not just pixels in the current viewport.

## Recommended details for discussion

These are design recommendations, not additional settled user requirements.

- Make Ctrl+S an assistant-only preset and Ctrl+R a user-only preset, preserving
  the query and all non-field filters; checkboxes then allow any combination.
  Show the shortcut alongside each role checkbox. Ordinary entry retains
  metadata search by default; content scope is explicitly chosen.
- Start the mockup in Turns mode; retain bounds when switching the basis.
  Last activity retains the existing `updatedAt` meaning; Created uses session
  creation time. Use inclusive bounds. Empty lower
  bound means zero; empty upper means unbounded. Reject negative/unknown units
  or reversed ranges inline; do not silently exchange endpoints or search with
  an invalid range. `0h–14d` is an illustration, not a proposed default cutoff.
- In Turns mode, date the opening prompt by its original turn timestamp;
  current title matches have no turn timestamp and remain metadata matches.
  Label this exception when Title is checked. Unknown turn timestamps must be
  disclosed as incomplete coverage or excluded explicitly, never assigned
  session creation/activity time silently. If joint conditions are later
  useful, prefer explicit additional conditions over automatic expansion.
- Count distinct matching turns with repeat occurrences highlighted within
  that turn. Show "N of M matches" when the total is known;
  disclose partial totals while indexing. Keep transcript order within a
  session, with the session title opening its first displayed matching turn.
  A title-only hit has a title excerpt, not a fabricated transcript turn.
  Preserve list query, selection, and scroll when returning.
- Keep the normal excerpt to one compact row. Zoom loads full matched text
  and a bounded adjacent-turn preview on demand; large full turns scroll inside
  the overlay. For missing neighbors, show only the matched turn. Preserve
  chronological context labels and make each shown turn independently linkable.
  Opening-prompt hits receive the same user-turn context; title-only hits have
  no invented conversation pair. Do not require a neighbor to pass role/time
  filters intended for matching.
- Full excerpt text is available on hover and through keyboard/touch-accessible
  zoom. Touch users must not need hover to read the same content.
- Show **Searching N selected · M hidden**, a selection list, and explicit
  **Clear selection**. Clear search/filters does not clear selection. With no
  selection, search the full eligible catalog, not just the loaded page.
  User clarification: for search and display scope, no selection is equivalent
  to all sessions selected. No explicit selection means zero hidden selections
  and no "N hidden" indicator, even though ordinary filters still omit
  nonmatching sessions. This equivalence does not check every row or authorize
  bulk actions on the catalog.
  Compact copy may use **N selected · M hidden**. "Hidden" specifically means
  selected sessions excluded by the current result filters. Its tooltip must
  explain the applicable causes (text mismatch, role/field scope, time range,
  project/provider/status filter), not only repeat the count, and say that the
  sessions remain selected. Clicking opens the selection list with per-session
  reasons, providing a touch-accessible explanation and recovery path.
- Bulk actions must disclose their full selected count, including hidden rows.
  The explicit Select just shown button intentionally removes selected nonmatches;
  this supersedes the earlier add-only Select visible recommendation. Its
  tooltip should disclose both the matching count and the prior selected count.
  During partial search coverage, identify the set as matches found so far;
  never silently promise selection of undiscovered matches. Capture a deliberate
  snapshot rather than adding late arrivals to a selection after an action.
  Disable it for zero current matches: clearing to an empty selection would
  expand the search back to all sessions and lose an empty intersection.
  Individual checkbox additions remain ordinary additions. When a query is
  active, selecting the first row narrows scope; the scope label makes this
  consequence visible. Use the selection list to add sessions or clear selection
  to search the full catalog again.
- All unchecked fields produce "Choose at least one search field" rather than
  silently enabling a field. Keep empty-query browsing useful for selection.

## Indexing direction and fallback discussion

User-directed preference, 2026-09-14: **favor indexing** rather than making
overlapping full scans the normal incremental-search mechanism. The existing
sketches remain the owner of the index proposal; this preference selects a
direction for later implementation discussion, not a schema or runtime change.

Recommended initial implementation: one asynchronous indexing pipeline, not
the two-scan fallback below. A cold search prioritizes missing coverage for its
selected sessions/time range and streams results as those records are indexed,
showing concrete build progress. Warm keystrokes query the durable index;
strict refinements can additionally filter displayed hits immediately. Append
indexing updates active results. The first search can therefore be slow without
discarding its work at each keystroke. The index structure and short-query
policy still require a feasibility check; no initial latency was promised.

Recommended shape: a durable disk-backed index of visible turns, carrying
canonical session identity, stable turn anchor, role, original timestamp,
normalized searchable text and its source mapping. Session creation/activity
metadata supports the other two time bases. Query filters should narrow work
before excerpt retrieval; a time range must not redefine which history the
index claims to cover. Keep memory bounded; global search is a logical query
scope and need not imply one monolithic index file. Reuse the sketches'
app-data-only placement, append/rewrite watermarks, invalidation, and explicit
partial-coverage contract.

Index construction, catch-up, and potentially blocking query execution should
run outside the server's main JavaScript thread, in a bounded worker or separate
process. Node already overlaps asynchronous I/O; CPU-heavy parsing/matching is
the reason for worker isolation. A local separate process is the initial
recommendation; a different host is an additional deployment decision, not
implied by "off-node". See [Node worker documentation](https://nodejs.org/api/worker_threads.html).

The user suggested permitting turn queries only at word boundaries if that
makes a useful smaller index. This remains an option to measure, not a settled
restriction overriding the sketches' arbitrary substring semantics. Distinguish
"query starts at a word boundary" from "whole words only": `select` should
still match `selection`; a multiword query must still verify the exact visible
substring rather than accepting an arbitrary bag of tokens. Define boundaries
for code identifiers, paths, punctuation and non-Latin text explicitly.

The proposed size multiplier has a precise limited interpretation. For N
character positions and B allowed boundary starts, a plain suffix-offset array
has N versus B entries: the ratio N/B is the average spacing between allowed
starts. It is not a universal ratio of total index bytes or query latency.
Shared text, compressed postings, repeated grams, position metadata and update
structures change that accounting. Token-prefix and trigram indexes have
different costs: SQLite FTS5 supports both prefix indexes and substring search
with its trigram tokenizer. Trigram search needs an explicit policy for one-
and two-character needles; reducing stored detail also changes supported query
operations. Compare these candidates on real corpus storage and latency before
restricting matching. [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html#the_trigram_tokenizer).

For initial build or uncovered tails, stream indexed results immediately and
merge additional verified matches with explicit coverage. The following
**two-scan fallback** was proposed by the user before favoring indexing; retain
it as a candidate only if uncovered scans still justify the complexity:

1. Scan A supplies a match stream. On a strict query refinement, immediately
   filter displayed results and all subsequent A arrivals by the current query.
2. Based on arrival rate and visible-result sufficiency, start narrower scan B
   in the background while A continues. Coalesce keystrokes before launching;
   keep no more than two admitted scan jobs and bound internal scan parallelism.
3. When a third scan C is needed, cancel B if it has not supplied enough current
   matches to fill the client screen; otherwise cancel A and promote B. Count
   distinct visible session groups after current filters, not raw turn hits.
4. Recommended exception: a completed narrower scan is authoritative even when
   it finds fewer than a screenful or zero results. Completion must not be
   confused with slow arrival or starvation.
5. Reuse requires a proven query-subset relation and the same source/scope
   generation. Backspace, role changes or time-basis changes cannot treat old
   negatives as coverage of a broader/new query. Deduplicate by stable turn
   identity; reject stale generations, bound buffers and visible updates, and
   never label a locally filtered partial set complete. Two repeated sweeps can
   compete for disk bandwidth even when their CPU work is isolated.

No index was built or benchmarked during this discussion. Cold build/storage,
append/rewrite cost, short-query latency, exact match parity, memory ceilings,
server responsiveness and partial-coverage behavior remain verification gates.

## Closure evidence required

Exercise the real search path with renamed titles, opening-only and later
user/assistant matches, multiple matches per session, an unselected matching
session, and selected nonmatches. Type without submission; switch Ctrl+S/Ctrl+R;
vary age units and invalid ranges; confirm full preview access on desktop and
phone; clear/retype search and verify hidden selections survive. Include data
beyond the initial catalog page and partial-coverage/stale-response cases.
Exercise all three time bases independently; verify turn age is taken from
the matching turn, not substituted from the session's last activity.
Vary N without losing sessions or selection. Open a result normally and in a
new tab and verify the same stable turn destination. Exercise right-click and
touch menu access, full-turn zoom, both neighboring-role directions, missing
neighbors and nonmatching/out-of-range context. Verify the compact header and
hidden mobile shortcuts in rendered desktop and phone captures.
Verify Select just shown through successive queries; test that
hidden selected rows remain included in bulk action counts until deliberately
removed. Check no-selection and empty-result cases separately.

Not fixed in place because this request is to discuss, open a gap, and produce
a mockup. The backend and shared preview extraction require a separate
implementation decision under the linked search contract.

Found 2026-09-14 while discussing the All Sessions search toolbar.
Contributing-model: 6-Astra
