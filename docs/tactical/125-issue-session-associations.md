# Issues And PRs Associated With Sessions

Topic: issue-session-associations

Status: implementation plan, 2026-09-10. The maintainer selected this bounded
MVP and requested the plan; no feature code has landed. The proposed wire
contract still needs the normal compatibility review before implementation.

## Outcome and scope

Provide an experimental, default-off Issues & PRs sidebar surface that answers:
"Where did we work on this ticket, and why are these sessions associated?"
Support Jira tickets, GitHub issues, and GitHub PRs, with many sessions per item,
many items per session, and multiple durable observations per association.

The complete first workflow is: paste a URL, add a title, associate sessions,
discover supporting references, search by title/key/URL, inspect evidence, and
navigate to the original issue or session. Correcting false matches and keeping
the data through restart and schema upgrades are part of the MVP.

All state belongs to one YA server's app-data database. Sessions may belong to
different projects on that server. Multi-server aggregation, a controller,
database replication, and shared search across machines are explicitly future
work. Do not add their UI or infrastructure here. Existing client source
scoping still applies: an item from server A must never be queried on server B.

Also deferred: remote tracker authentication/synchronization, issue mutations,
PR stacks, automatic completion/settlement, commit attribution, semantic
matching, and automatic whole-corpus transcript indexing. This is a concrete
issue/PR feature, not an extensible arbitrary-entity graph framework.

## Existing work and reference audit

Planning searched `tasks/` and `on-deck/` (both absent), `gaps/`, topics, and
tactical plans. Preserve these boundaries:

- [Roadmap](../roadmap/README.md): ticket/PR links are a later direction; this
  plan does not reprioritize the publishing initiative.
- [Built-in SQLite](../../topics/optional-sqlite.md): reuse
  `packages/server/src/storage/{sqlite,discovery-sqlite}.ts` and
  `{dataDir}/discovery.sqlite`. Current code has schema versions 1-3; the topic
  still describes version 2. Reconcile that description when migration work
  lands, and allocate the next version against the then-current tree.
- [Cold-storage startup gap](../../gaps/sqlite-backed-cold-storage-startup.md):
  indexed cold queries are relevant; migrating existing JSON metadata stores
  is separate work and this plan does not close that gap.
- [Commit/session attribution](../../gaps/committed-change-session-attribution.md):
  shares the evidence principle, but its opted-in Git notes writer is separate.
  This feature writes no project files or Git metadata.
- [All-session search](../../topics/all-session-content-search.md): title
  search here covers stored issues, not arbitrary transcript content. The
  selected-session scan does not establish a global search index.
- [SQLite capability test gap](../../gaps/version-speech-session-terms-test.md):
  inspect the known readiness assertion before adding another SQLite-dependent
  capability. If fixed, isolate that correction and remove its gap in the
  closing commit; do not change existing advertisements to satisfy the test.
- [Session ID remaps](../../topics/session-id-remap.md) and
  [working directories](../../topics/agent-working-directory-tracking.md):
  preserve canonical YA identity and distinguish effective project from
  provider transcript location.

T3 Code was inspected at `d29c56a5c` (2026-09-10) in `~/github/t3code`.
Paths below are relative to that reference checkout, not YA dependencies:

- `apps/server/src/persistence/Migrations.ts` statically registers numbered
  migrations through Effect's SQL migrator and tracks them in
  `effect_sql_migrations`. Adopt explicit registration and old-data upgrade
  fixtures; do not add Effect or replace YA's runner.
- `Migrations/042_ProjectionThreadLinkedPullRequest.ts` and
  `048_ProjectionThreadBranchPullRequest.ts` added single JSON fields.
  `050_ProjectionThreadPullRequests.ts`, under the same persistence directory,
  introduces `(thread_id, host, repository, number)` links and a reverse index,
  backfills old links, and retains the legacy column.
- `apps/server/src/persistence/ProjectionThreadPullRequests.ts` stores a link
  source and cached snapshot/stack JSON. YA needs separate observations because
  one association can have several independent reasons.
- `packages/shared/src/threadPullRequests.ts` normalizes external identity,
  supplies title/URL search terms, and hides dismissal tombstones. Preserve the
  useful rule that automatic rediscovery does not reverse a user's dismissal.

T3's persisted PR snapshot is a refreshable summary of remote title/state,
branches, checks, etc.; it is not association evidence. Its client aggregation
of independent environments is a future reference only.

## Proposed product behavior

### Enablement and failure behavior

Use one explicitly server-scoped, persistent experimental opt-in for this
feature's retention and discovery. Settings must say it applies to this YA
server. Do not build a generic settings or demand-lease framework to deliver
it. The sidebar entry and session controls are hidden until enabled.

Enabling creates no historical scan or tracker network request. SQLite may
create empty tables as infrastructure before opt-in, but records are acquired
only while enabled. Disabling cancels scans, unregisters observers, rejects
stale-client writes, and preserves existing records. Re-enabling does not
silently catch up the intervening history. A generation fence prevents work
started before disable/delete from publishing afterward.

Storage failure must never acknowledge an unsaved link. Surface an actionable
error while ordinary sessions remain usable. If SQLite is unavailable, show
unavailability in the supported settings surface rather than an empty issue
list that appears to have lost data. No localStorage database fallback.

### Issue identity and titles

Use a concrete `external_issues` table, with kind `jira-issue`, `github-issue`,
or `github-pr`. An opaque local ID addresses the record; a unique normalized
external key prevents duplicate records from different pasted URLs.

- GitHub: host, normalized owner/repository, number, and kind. Recognize
  ordinary `/issues/N` and `/pull/N` URLs, including suffixes such as `/files`.
- Jira: host and normalized issue key from `/browse/KEY-N`. Only supported,
  unambiguous URL forms are accepted in this slice; no URL resolution request.
- Store the canonical navigation URL separately from the exact observed URL.
  Fragments and tracking parameters must not create new items. Preserve a
  useful comment/message fragment in evidence, without retaining credentials
  or authentication query parameters.
- Include the host in every identity. Do not treat `#123` as globally unique,
  infer tracker kind from arbitrary URL shapes, or collapse Jira tenant names.
  Nonstandard/self-hosted URLs require an explicit tracker interpretation;
  unsupported forms produce a clear validation result.

An issue can exist without a session link. It remains findable by URL/key when
untitled. Keep an editable title override separate from an observed title and
its provenance; manual text wins until explicitly cleared. A Markdown label
may supply a candidate title when it is actually descriptive. Never invent a
title or claim an observed label is an authoritative remote value.

No remote cache is needed to ship. Add nullable cached summary fields only
with a consumer, in a later migration; do not reserve PR-stack schema now.

### Associations, evidence, and corrections

`session_issue_links` has a unique `(issue_id, session_id)` pair and state
`discovered`, `confirmed`, or `dismissed`, with creation/update/decision times.
Manual linking confirms; automatic evidence creates discovered links and does
not downgrade confirmed links. Repeated observations do not change dismissal.
An explicit relink/confirm can restore a dismissed association.

`session_issue_evidence` references the link and records:

- kind: manual, message URL, branch key, or worktree key;
- a bounded observed value and optional human explanation;
- source occurrence time when known and a separate observation time;
- stable message/turn reference where available, or a provider-owned source
  locator with its source generation; bounded excerpt for later explanation;
- repository/project context and observed branch/worktree for Git evidence;
- extractor version and a deterministic occurrence key for deduplication.

Live and persisted sightings of the same occurrence converge. Different
occurrences remain separate evidence. Stream deltas do not produce a record
per token: inspect completed logical messages, and reconcile corrected messages
by stable source identity. Do not invent source timestamps or message anchors.
Historical evidence remains readable when its original source is unavailable;
the UI then marks the source link unavailable rather than fabricating a jump.

Use foreign keys from evidence to links and links to issues. Sessions remain
owned by the existing catalog, not copied into a new SQL sessions table.
Missing/archived sessions do not cascade-delete metadata. Resolve current
session titles and project membership through existing canonical services.
Remapping a provisional session ID merges colliding links and evidence
transactionally; preserve the latest explicit user decision, with dismissal
winning an equal-time conflict, and never lose either side's observations.

Unlink is a durable dismissal retaining evidence and a way to restore it.
Deleting a saved issue explicitly removes its links/evidence after explaining
that scope; it is not a permanent exclusion and a later new observation or
requested scan may rediscover it. In-flight scans cannot undo deletion. Turning
off the experiment is not deletion. Manual metadata and evidence have no
automatic expiry; search-index maintenance never purges them.

### Discovery and its limits

Use one server-owned extractor over normalized, visible user/assistant messages
YA already processes. Do not subscribe a second provider reader or change the
transcript presentation pipeline. Exclude hidden prompts, reasoning, tool
arguments/results, and incidental raw logs in this pass. Report these coverage
limits in the scan result; full transcript/tool-output discovery is future work.

An explicit Scan this session action reads only the selected session through
its existing reader. Share concurrent requests for that session/source
generation and expose completion, partial progress, failure, and cancellation.
Never report "no references" as a whole-session claim after a partial scan.
Provider readers unable to honor bounds must return an unsupported/partial
result rather than eagerly reading the complete transcript.

Starting bounds to implement and test: one active historical scan per server,
no unbounded job queue, at most 8 MiB of source acquisition and 2,000 logical
messages per requested pass, with a 30-second deadline and explicit continuation.
Bound individual reads before acquisition, yield between batches, and cap SQL
write batches at 100 evidence rows. Oversized records are skipped with reported
coverage. Cap retained excerpts at 512 characters and input URLs at 4 KiB.
These are product limits to validate on realistic fixtures, not performance
claims. Persist resumable progress only for readers with stable locators;
otherwise a retry rescans the bounded slice and deduplicates existing evidence.

Observe branches/worktrees only through existing session-specific facts.
Match exact Jira keys to already-known, unambiguous issues; multiple matching
tenants remain unresolved. GitHub shorthand additionally needs an exact
repository identity. A bare number in a branch is insufficient. Do not assign
the current branch of a shared checkout retrospectively to every session.
No new Git polling, directory watcher, process scan, or per-session timer.

### Browsing and search

The sidebar entry opens a list of saved issues with kind/provider, key, title,
and visible associated-session count. A detail view lists sessions with their
confirmation state, expandable evidence, and external/source navigation.
Session controls show the reverse association list and an add/link action.
Provide restore access for dismissed associations without including them in
ordinary counts. Distinguish untitled, empty, loading, unavailable, and failed.

Search is case-insensitive literal substring matching over saved title/key/URL,
with optional project filtering through associated sessions. Escape SQL LIKE
metacharacters and bind inputs; searching `%` must search a literal percent.
Start with SQL over these small records, not FTS or transcript indexing.
Paginate both list and evidence reads (default 50, maximum 100), use stable
cursors/order, and index canonical identity and reverse session lookups. A
limit on returned rows does not bound SQL work: measure title-search latency
at the declared fixture size and use a bounded auxiliary index if necessary.

Reuse existing components/theme tokens, CSS Modules, canonical session routes,
and source-scoped requests. New UI strings go through English i18n keys.
Long URLs/titles and evidence actions must work on desktop and phone without
requiring hover. The browser never becomes the metadata owner.

## SQLite migration policy

Keep `PRAGMA user_version` as the schema authority and the YA application ID
check. One ordered sequence owns the shared database; features do not maintain
independent version counters. Extract existing versions into named, statically
registered migration modules without changing their SQL. Freeze their contents
rather than importing future mutable feature schema definitions. Retain SQL-only
migrations until a real data conversion needs a synchronous callback.

Released migrations are append-only: do not renumber, edit, or reuse IDs.
Resolve concurrent migration-number collisions before merge and verify fresh
installation equals sequential upgrade. Keep consecutive-version validation,
foreign keys, the 250 ms lock wait, and the existing single immediate transaction
around pending schema changes and version advancement. Do not adopt T3's WAL
or five-second timeout without a demonstrated workload reason.

Use additive columns/tables first. Conversions must preserve manual values,
decisions, and evidence, with explicit old/new fixtures and failure rollback.
Large backfills and provider reads never run in schema initialization; use
bounded resumable work after the database is ready. A backup required by a
future destructive conversion must be a consistent SQLite backup, not a live
file copy; that conversion needs its own recovery plan before shipping.

Newer schemas and foreign/corrupt files remain refused and untouched. There
are no automatic down migrations or database resets. Downgrading YA below a
schema migration can make the entire shared SQLite store unavailable, including
other SQLite features. Disabling this experiment does not roll the schema back.
Document that consequence and recovery (upgrade again, or explicitly restore a
consistent pre-upgrade backup with its data-loss implications). Do not promise
old-binary write compatibility merely because the migration was additive.

## Proposed compatibility boundary

No wire changes are approved by this documentation commit. Before editing
shared types/routes/client consumers, inspect the latest two stable releases
and all stable releases in the preceding 14 days, then present the exact
release corpus, proposed gate, and absent-gate behavior for maintainer review
under [DEVELOPMENT.md](../../DEVELOPMENT.md#clientserver-compatibility-review).
Do not reuse the September 8 corpus without checking for newer releases.

Propose a new sparse optional `issue-session-associations-v1` capability,
available only with the implementation and ready SQLite. Advertise support
independently of the enabled setting so capable clients can show the opt-in;
server routes independently enforce enablement and request authorization.
The proposed surface covers settings/status, issue CRUD/search, reverse links,
link confirmation/dismissal, paginated evidence, and selected-session scan
start/status/cancel/continue. Final path names and payloads belong to that review.

Absent capability: hide feature controls and send no feature requests. An
unsupported direct URL gets a clear unavailable view. Existing capabilities,
protocol levels, session payload semantics, and older fallbacks keep their
meaning. Reads/writes use existing authenticated session-access boundaries;
counts, excerpts, and source navigation must not expose inaccessible sessions
or flow into public shares. Reads from one source server stay on that source.

## Implementation sequence

### 1 — Pin contracts and migration upgrades

Complete the compatibility review above. Create the owning
`topics/issue-session-associations.md` as implemented behavior lands, leaving
future-only extensions in this plan or a sketches companion. Update the SQLite
topic's current schema description and migration policy. Extract/freeze current
migrations and add tests for empty, v1, v2, and v3 databases, rerun no-ops, failed
upgrade rollback, contention, newer-schema refusal, and Node/Bun interchange.
Retain existing vocabulary records and feature behavior in every fixture.

### 2 — Persist issues, associations, and evidence

Add the next migration and a focused issue service under server services,
with prepared/bound SQL and explicit transaction ownership. Add URL identity
helpers and defensive payload validation in shared code only where consumed.
Implement title override/provenance, link state transitions, deduplication,
remap handling, pagination, deletion fences, and unavailable-session behavior.
Test manual and discovered data across restart and schema upgrades.

### 3 — Expose the manual workflow and experimental UI

Add the reviewed capability, opt-in, and dedicated routes; compose them into
server startup without growing a general metadata hub. Implement the list,
paste/search, issue detail, session reverse links, evidence display, and
confirm/dismiss/restore/delete actions. At this point the complete manual
workflow is usable, though the final MVP still requires discovery below.
Prove disabled/old-server behavior, write failures, and cross-client refresh.
Use explicit mutation invalidation and existing lifecycle refresh paths; if
new events are needed, include them in the compatibility review, not polling.

### 4 — Discover references with bounded work

Attach completed-message observation at an existing normalization seam, add
the explicit selected-session scan, and consume trustworthy branch/worktree
facts where available. Reuse one extractor across live and persisted paths.
Test duplicate delivery, source rewrites, missing anchors, URL variants,
namespace ambiguity, cancellation, limits, resume, disable, and deletion races.
Unknown facts remain unknown. Every admitted job and subscription has teardown.

### 5 — Verify the complete workflow and document its limits

Use realistic fixtures containing multiple projects, the same ticket on two
sessions, two tickets on one session, several evidence occurrences, duplicate
URLs, long titles, false positives, and a missing transcript. Exercise manual
and automatic paths, then restart and upgrade an older fixture database.

Acceptance scenario: paste a Jira URL, set a title, link two sessions, discover
another reference, search the title after restart, and navigate to both sessions
and their evidence. Dismiss a false match and rescan without restoring it.
Disable/re-enable without losing data or triggering historical work. Verify
GitHub issue/PR identity and old-server behavior through the same UI paths.

Run the repository-required lint, format, typecheck, unit, and browser checks,
plus the client console scan and scoped CSS checks. Use the existing packaged
SQLite harness on supported Node and pinned Bun, with Linux/macOS/Windows
coverage; state any unavailable host validation rather than claiming it.
Inspect fresh-server desktop/phone captures per the UI testing contract.
Measure query latency, bounded scan responsiveness, and retained memory on a
declared fixture; follow the measurement-host requirements for regression claims.

Finish with current observable contracts for enablement, retention, identity,
search coverage, failure behavior, migration/downgrade handling, and access
boundaries. Keep the roadmap status current. These checks establish the MVP;
remote tracker refresh and multi-server aggregation are subsequent decisions.
