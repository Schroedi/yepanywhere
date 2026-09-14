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
  the set; future select-visible behavior must preserve hidden selections.
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
- Offer independent checkboxes for **Title**, **Opening prompt**, **Assistant
  text**, and **User text**. Checked fields form a union. Search the current
  editable title and the original opening prompt independently: renaming a
  session must not erase its opening-prompt match. A turn matching both opening
  prompt and user text appears once. The visible-text exclusions in the existing
  sketches continue to apply.
- While All Sessions is active, Ctrl+S and Ctrl+R focus its search box and
  activate assistant-text and user-text search respectively. Handle the browser
  default locally to that route. Leave single-session bindings unchanged.
- Replace the age preset menu with two editable text fields, visually
  **Age [0h] – [14d]**. Accept `d`, `h`, and `m`; a number without a suffix means
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
- If selection is nonempty, search only those session identities, intersected
  with age/project/provider/status filters. Search exclusion must never clear a
  selection checkbox. Clearing the query or changing filters reveals selected
  rows with their checks intact. Keep selection independent of result pages,
  query generations, and duplicate-title hiding; matching distinct sessions
  must remain reachable even when their titles are equal.

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
- Show one first matching turn per session initially, its role and turn number,
  plus a count/expander for further matching turns. A title-only hit has a title
  excerpt, not a fabricated transcript turn. Open a preview at its matching
  turn; preserve list query, selection, and scroll when returning.
- Full excerpt text is available on hover and keyboard focus, with an explicit
  touch expansion. Touch users must not need hover to read the same content.
- Show **Searching N selected · M hidden**, a selection list, and explicit
  **Clear selection**. Clear search/filters does not clear selection. With no
  selection, search the full eligible catalog, not just the loaded page.
- Bulk actions must disclose their full selected count, including hidden rows.
  Selecting visible rows unions them into the existing selection. When a query
  is active, selecting the first row narrows scope; the scope label makes this
  consequence visible, and clearing search permits expanding the selection.
- All unchecked fields produce "Choose at least one search field" rather than
  silently enabling a field. Keep empty-query browsing useful for selection.

## Indexing direction and fallback discussion

User-directed preference, 2026-09-14: **favor indexing** rather than making
overlapping full scans the normal incremental-search mechanism. The existing
sketches remain the owner of the index proposal; this preference selects a
direction for later implementation discussion, not a schema or runtime change.

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

Not fixed in place because this request is to discuss, open a gap, and produce
a mockup. The backend and shared preview extraction require a separate
implementation decision under the linked search contract.

Found 2026-09-14 while discussing the All Sessions search toolbar.
Contributing-model: 6-Astra
