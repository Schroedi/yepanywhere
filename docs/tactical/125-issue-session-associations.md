# Issues And PRs Associated With Sessions

Topic: issue-session-associations

Status: implementation plan, revised after an independent Opus 5 xhigh review
on 2026-09-10. The maintainer selected this bounded MVP and requested the plan
and review; no feature code has landed. The proposed wire contract still needs
the normal compatibility review before implementation.

## Outcome and scope

Provide an experimental, default-off Issues & PRs sidebar surface that answers:
"Where did we work on this ticket, and why are these sessions associated?"
Support Jira tickets, GitHub issues, and GitHub PRs, with many sessions per item,
many items per session, and multiple durable observations per association.

The complete first workflow is: paste a URL, add a title, associate sessions,
discover supporting references, search by title/key/URL, inspect evidence, and
navigate to the original issue or session. Correcting false matches and keeping
the data through restart and schema upgrades are part of the MVP.

Ship the manual workflow as the first useful increment. Persisted-message
discovery is the next increment of this plan and remains required for its full
completion; it must not hold manual linking hostage to a provider-reader rewrite.
The first increment exposes no scan controls or promises of automatic discovery.

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
  `{dataDir}/discovery.sqlite`. Current code has schema versions 1-3. Version 3
  drops the old vocabulary counts/receipt tables; only the unused
  `speech_vocabulary_state` table remains. Active vocabulary settings and counts
  live in `speech-vocabulary-state.json` and a separate local-disk
  `speech-vocabulary.sqlite`. Discovery storage currently gates vocabulary
  availability rather than owning its live data; issues would be its first
  active data tenant. Correct the stale version-2 topic when migration work
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
  inspect the recorded readiness assertion before adding another SQLite-dependent
  capability. Concurrent work may already have corrected it or changed the
  session-terms advertisement; recheck current code rather than assuming the
  recorded failure still exists. If fixed here, isolate that correction and
  remove its gap in the closing commit; do not change existing advertisements
  merely to satisfy the test.
- [Session ID remaps](../../topics/session-id-remap.md) and
  [working directories](../../topics/agent-working-directory-tracking.md):
  preserve canonical YA identity and distinguish effective project from
  provider transcript location.
- [Session worktree file gap](../../gaps/session-worktree-file-links.md): YA
  does not reliably retain the actual sibling worktree used by a session.
  General worktree/branch inference is deferred. The narrow available precedent
  is `SessionMetadata.workstreamId` and `WorkstreamService` lane metadata;
  [Workstreams](../../topics/workstreams.md) remains a separate experiment.
- `services/voice/vocabulary-sessions.ts` and `VocabularyLearning.ts` provide
  precedents for persisted-session extraction, source-version validation,
  coalescing, cancellation generations, and progress. Their compaction-window
  paging does not bound source acquisition for every provider; reuse those
  lifecycle concepts, not the whole-catalog scanner or its acquisition policy.

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
feature's retention and discovery. Add `issueAssociationsEnabled?: boolean` to
the existing `ServerSettingsService`, default false, following its
`workstreamsEnabled` precedent. Settings must say it applies to this YA server.
Do not build a generic settings or demand-lease framework to deliver it. The
sidebar entry and session controls are hidden until enabled.

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

- kind: manual, message URL, or workstream branch;
- a bounded observed value and optional human explanation;
- source occurrence time when known and a separate observation time;
- stable message/turn reference where available, or a provider-owned source
  locator with its source generation; bounded excerpt for later explanation;
- repository/project context, lane ID, and configured branch for Workstream
  evidence, labeled as lane metadata rather than proof of a Git operation;
- extractor version and a deterministic occurrence key for deduplication.

Extract message evidence only from persisted source records. Retries of the
same occurrence converge; different occurrences remain separate evidence.
Use a stable persisted message ID plus normalized URL, or a provider-owned
source locator/generation when no message ID exists. A timestamp alone is not
unique, and a content-only fingerprint must not merge repeated quotations in
different messages. Rewrites invalidate scan coverage without erasing historical
observations. An extractor-version change must not blindly duplicate existing
occurrences. Do not invent source timestamps or message anchors. Historical
evidence remains readable when its original source is unavailable; mark source
navigation unavailable rather than fabricating a jump.

Use foreign keys from evidence to links and links to issues. Sessions remain
owned by the existing catalog, not copied into a new SQL sessions table.
Missing/archived sessions do not cascade-delete metadata. Resolve current
session titles and project membership through existing canonical services.
Resolve aliases on every write. Do not persist automatic observations under
unresolved provisional launch IDs. Manual linking during that brief state
returns a retryable session-not-ready result. The existing supervisor remap is
the integration point, not only the public event, which can be omitted when
the old ID was never published. Any remap of saved IDs merges colliding links
and evidence transactionally; preserve the latest explicit user decision, with
dismissal winning an equal-time conflict, and never lose observations through
`UPDATE OR IGNORE` followed by deleting the losing row. Do not migrate the JSON
session catalog into SQLite to solve this local merge.

Unlink is a durable dismissal retaining evidence and a way to restore it.
Deleting a saved issue explicitly removes its links/evidence after explaining
that scope; it is not a permanent exclusion and a later new observation or
requested scan may rediscover it. In-flight scans cannot undo deletion. Turning
off the experiment is not deletion. Manual metadata and evidence have no
automatic expiry; search-index maintenance never purges them.

### Discovery and its limits

Use one extractor over normalized, visible user/assistant messages from the
persisted source. Do not attach per-process live-message subscriptions or change
the transcript presentation pipeline. Exclude hidden prompts, reasoning, tool
arguments/results, and incidental raw logs. Show those coverage limits; tool
output discovery remains future work. Discovery is eventually visible after
persistence and a bounded scan, not immediately on each live token.

Use exact changed-session/completed-turn signals already owned by the server
to schedule a scan for that session, then resolve its canonical catalog entry.
Do not transplant vocabulary's loop over the entire catalog onto each update.
Changes while disabled and history older than the first admitted observation
are not automatically backfilled. Persist source-version/position checkpoints
and label coverage partial until an explicit retrospective scan covers it.
Compare source generation before/after acquisition; invalidated work cannot
advance a checkpoint or certify coverage. Idempotent batches may retain
already-committed historical evidence while the source is reconciled.

There is currently no provider-neutral bounded acquisition API.
`ISessionReader.getSession` accepts presentation selectors, and the Claude
reader loads `claudeTranscriptCache` before applying `afterMessageId`.
`tailCompactions: 1` can still describe an arbitrarily large uncompacted file.
An evidence-row limit cannot protect against that read. Explicitly budget an
optional provider-owned bounded persisted-message iterator in step 4, sharing
existing parsing/normalization helpers. Its contract takes source-byte and
record limits, a deadline/abort signal, and an opaque cursor, and returns
coverage/continuation information. It must bound acquisition before allocation,
including oversized JSONL records. Existing full-detail readers need not change.
Unsupported adapters report that status; they never silently fall back to a
whole-transcript read. Prove Claude and Codex adapters first, including Codex
lineage/compaction identity; manual associations work for all providers.

Starting limits to implement and validate: one active scan per server, a
coalescing pending set of at most 16 distinct sessions, at most 8 MiB acquired
and 2,000 logical messages per pass, and a 30-second deadline. Queue overflow
leaves explicit stale/partial coverage rather than spawning work or marking a
session scanned. Closing the scan view releases its explicit demand; disable
and shutdown cancel all work. Yield between acquisition/write batches and cap
SQL batches at 100 evidence rows. Admission of further historical passes
requires explicit continuation; unchanged sessions receive no timer-driven
scan. Cap retained excerpts at 512 characters and URLs at 4 KiB. These are
proposed starting limits, not measured performance claims.

Scan this session requests a bounded retrospective pass through that same
iterator, with progress, cancellation, continuation, and honest unsupported
states. Identical requests share one session/source-generation owner. Durable
checkpoints resume supported cursors; rewrites invalidate them without losing
manual decisions. Restart restores checkpoints, not automatic whole-corpus
work. An empty partial result never claims that the whole session has no links.

Limit branch evidence to explicit YA Workstream membership and lane branch
metadata. Capture what was known at observation time; a later lane branch does
not prove what an older session checked out. Match exact Jira keys to
already-known, unambiguous issues; multiple matching tenants stay unresolved.
GitHub shorthand additionally needs exact repository identity. A bare number
is insufficient. Missing lane metadata simply produces no branch evidence.
Do not enable Workstreams or infer general tool cwd/worktree relationships here.
No new Git polling, directory watcher, process scan, or per-session timer.

### Browsing and search

The sidebar entry opens a list of saved issues with kind/provider, key, title,
and visible associated-session count. A detail view lists sessions with their
confirmation state, expandable evidence, and external/source navigation.
Session controls show the reverse association list and an add/link action.
Provide restore access for dismissed associations without including them in
ordinary counts. Distinguish untitled, empty, loading, unavailable, and failed.

Search is case-insensitive literal substring matching over saved title/key/URL.
Without remote enrichment, title search covers manual titles and observed link
labels only; key/URL search is useful immediately. Optional project filtering
resolves associated sessions' current effective project through the catalog,
not a frozen project ID stored on the link. Apply the filter before final page
limits, using bounded candidate batches with a continuation cursor when needed;
do not filter one SQL page and incorrectly declare no matches. Escape SQL LIKE
metacharacters and bind inputs; searching `%` must search a literal percent.
Start with SQL over these small records, not FTS or transcript indexing.
Paginate both list and evidence reads (default 50, maximum 100), use stable
cursors/order, and index canonical identity and reverse session lookups. Keep
pagination so long-lived evidence does not require a lossy retention cap. A
limit on returned rows does not bound SQL work: validate straightforward LIKE
queries on a realistic saved-issue fixture. A specialized text index needs
observed evidence and a separate follow-up, not a speculative MVP dependency.

Reuse existing components/theme tokens, CSS Modules, canonical session routes,
and source-scoped requests. New UI strings go through English i18n keys.
Long URLs/titles and evidence actions must work on desktop and phone without
requiring hover. The browser never becomes the metadata owner.

## SQLite migration policy

Keep `PRAGMA user_version` as the schema authority and the YA application ID
check. One ordered sequence owns the shared database; features do not maintain
independent version counters. Copy the v2/v3 SQL constants from
`services/voice/vocabulary-schema.ts` into named frozen migration modules,
without changing their SQL; leave only the current vocabulary table schema in
the voice module. Statically register them instead of importing future mutable
feature definitions. Retain SQL-only migrations until a real data conversion
needs a synchronous callback. Add a test helper to apply a migration prefix
(the equivalent of T3's `toMigrationInclusive`) so old-format fixtures can be
constructed with the actual historical migrations.

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
are no automatic down migrations or database resets. At the reviewed baseline,
an older reader of a newer issue schema reports SQLite `error`, removes both
speech vocabulary capabilities, and does not mount the vocabulary routes
because `app.ts` gates their initialization on the discovery database handle.
It does not delete the issue database or vocabulary's separate durable files.
Keep this concrete regression fixture alongside future tenants' expectations.
Do not promise old-binary write compatibility merely because changes are additive.

Disabling this experiment does not roll the schema back. Recovery is upgrading
again, or explicitly restoring a consistent pre-upgrade backup with its data-loss
implications. Mixed YA versions concurrently using one profile are not a
supported way to test rollback. Even a no-op startup currently takes an
immediate write lock; contention can return `error` after 250 ms without data
loss. Preserve that behavior and test it rather than enlarging lock waits here.
The status payload carries only `state`, so UI cannot diagnose downgrade versus
corruption without a separately reviewed wire addition; details remain in logs.

Keep the shared discovery file for this bounded first tenant. A separate
`issues.sqlite` could isolate future migration availability failures, but adds
another storage lifecycle/version owner. Reconsider only if mixed-version or
independent recovery requirements justify it; do not couple issue retention to
vocabulary's rebuildable scratch-storage or weaker durability policy.

## Proposed compatibility boundary

No wire changes are approved by this documentation commit. Before editing
shared types/routes/client consumers, inspect the latest two stable releases
and all stable releases in the preceding 14 days, then present the exact
release corpus, proposed gate, and absent-gate behavior for maintainer review
under [DEVELOPMENT.md](../../DEVELOPMENT.md#clientserver-compatibility-review).
Do not reuse the September 8 corpus without checking for newer releases.

Propose a new sparse optional `issue-session-associations-v1` capability for
settings/status, issue CRUD/search, reverse links, confirmation/dismissal, and
paginated evidence. Follow the existing readiness-gated advertisement site in
`routes/version.ts`, independently of the enabled setting, so capable clients
can show the opt-in. Server routes independently enforce enablement and request
authorization. Add a separate `issue-session-discovery-v1` capability when the
persisted discovery increment lands, covering scan start/status/cancel/continue
and per-provider support/coverage. Do not expand the manual capability to imply
scan support on already-released servers. Final paths, payloads, and both
increments' release corpora belong to their compatibility reviews.

Absent manual capability: hide feature controls and send no feature requests.
Absent discovery capability: preserve manual browsing/linking, hide scan
controls, and send no discovery requests. An unsupported direct URL gets a
clear unavailable view. Existing capabilities, protocol levels, session payload
semantics, and older fallbacks keep their
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
Fixtures must preserve the historical v3 drop behavior, leave the separate
active vocabulary files unchanged, and verify that a successfully upgraded
discovery handle still enables vocabulary. Once issue records exist, every
subsequent upgrade fixture must preserve their titles, decisions, and evidence.

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
This is a shippable increment with its own manual-only capability and completed
topic contract. Prove disabled/old-server behavior, write failures, and
cross-client refresh. The later discovery increment adds its own capability.
Use explicit mutation invalidation and existing lifecycle refresh paths; if
new events are needed, include them in the compatibility review, not polling.

### 4 — Discover references with bounded work

First implement and prove the optional bounded acquisition contract described
above, with Claude/Codex adapters and an unsupported fallback for other readers.
This is explicit provider-reader scope, not a property of the existing detail
route. Reuse provider normalization without introducing a second transcript
store or changing full-detail behavior. Read the owning provider topics and
obtain any required protocol approval before changing those implementations.

Then wire exact changed-session/completed-turn signals into one coalescing
persisted-source scheduler, using vocabulary's generation/checkpoint lifecycle
as precedent. Add the explicit selected-session scan and Workstream metadata
evidence where available. Test duplicate sightings, source rewrites, missing
anchors, URL variants, namespace ambiguity, acquisition ceilings, oversized
records, queue saturation, cancellation, resume, disable, and deletion races.
Unknown facts remain unknown. Every admitted job and subscription has teardown.
Do not claim this increment complete if core provider discovery only returns
unsupported; ship the already-complete manual increment while resolving it.

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
Verify that issue evidence/excerpts never appear in public-share payloads, and
that counts and project filters honor existing session-access boundaries.

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

## Independent review and decisions

Kyle requested a read-only Opus 5 xhigh review through YA at localhost:3400.
The process API verified `claude-opus-5` and `effort: xhigh`; review session
`56c01728-ad7c-423b-af13-306f16699ebc` examined this plan, the owning topics,
actual YA seams, and T3 at `d29c56a5c`. Its result supported three tables and
the existing migration runner, but recommended a smaller manual-first delivery
and persisted-only discovery. The review is advisory, not compatibility approval.
It targeted plan commit `7402c6a6c`; recheck its code observations against the
implementation checkout, particularly concurrent capability/test corrections.

Accepted: name the settings/advertisement seams; freeze the existing SQL
literals concretely; correct vocabulary ownership and downgrade behavior;
cite the worktree gap; narrow branch evidence to lane metadata; ship manual
linking first; remove live observation and speculative text-index work; make
project filtering and exclusion from public shares explicit.

Adjusted rather than copied: vocabulary supplies useful scan lifecycle patterns,
but neither compaction-window paging nor an evidence-row cap bounds source
acquisition. Retain hard bounds and explicitly scope optional provider iterators;
do not replace them with the review's suggested paging-only limit. Do not copy
whole-catalog scans onto every change. Persisted-only ingestion also does not
prove all catalog IDs canonical or make timestamp fingerprints unique.

Kept despite suggested simplification: paginated evidence avoids a lossy cap
on long-lived history; remap collisions require unioning evidence and preserving
decisions, not ignoring updates then deleting leftovers. A read-only per-process
subscription would not inherently violate quiescence if correctly owned, but
its lifecycle and live/persisted reconciliation cost are unnecessary here.

Tradeoff: discovery becomes eventual and initially supports only proven bounded
adapters; it cannot delay the manual release. Title search initially covers
user titles and observed labels, not a synchronized tracker catalog. These are
explicit limits, not claims that the future integrations already exist.
