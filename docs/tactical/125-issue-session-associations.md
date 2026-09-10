# Issues And PRs Associated With Sessions

Topic: issue-session-associations

Status: implementation plan, corrected to the maintainer's automatic-indexing
MVP on 2026-09-10. No feature code has landed. Automatic evidence collection is
required for the first release; manual-only linking is not a useful MVP for
this request. The wire contract still needs the normal compatibility review.

## Outcome and scope

Enable an experimental Issues & PRs section, then have YA discover ticket keys
and issue/PR URLs in ordinary sessions, retain why each connection was found,
and make the associated sessions searchable and navigable later. A user should
not need to register every ticket or attach each session themselves.

The acceptance workflow starts with an empty issue database: view conversations
mentioning a Jira key or GitHub issue/PR URL, let the indexer populate references
and associations, then search the key/title/URL and inspect the source evidence.
Paste-to-find, manual title editing, linking, confirmation, and dismissal are
supporting controls for discovery and correction, not the primary workflow.

Everything is scoped to one YA server's app data. One ticket may connect many
sessions across projects, and one session may connect many tickets. Multi-server
aggregation, controllers, replication, and cross-machine search remain future
work. Existing source-scoped routing must still prevent querying server B for
server A's records.

Defer branch/worktree discovery entirely in this MVP, including YA Workstreams.
This is the deliberate scope reduction that protects automatic ticket discovery.
Also defer tracker auth/synchronization, issue mutations, PR stacks, commit
attribution, semantic matching, tool-output mining, and unbounded whole-corpus
backfill. Do not build a generic arbitrary-entity graph framework.

## Existing work and source evidence

Planning searched `tasks/` and `on-deck/` (absent), topics, tactical plans, and
`gaps/`. Existing owners and constraints:

- [Roadmap](../roadmap/README.md): this remains a later product direction; the
  plan does not reprioritize publishing.
- [Built-in SQLite](../../topics/optional-sqlite.md): reuse
  `packages/server/src/storage/{sqlite,discovery-sqlite}.ts` and
  `{dataDir}/discovery.sqlite`. Code currently has migrations 1-3. Version 3
  removed the old vocabulary receipt/count tables; the remaining vocabulary
  state table is unused by current code. Active settings/counts live in a JSON
  settings file and separate `speech-vocabulary.sqlite`. Discovery readiness
  still gates vocabulary startup. Correct the stale version-2 topic when the
  migration work lands and allocate new IDs against the current tree.
- [Cold-storage gap](../../gaps/sqlite-backed-cold-storage-startup.md): do not
  add evidence blobs to the all-in-memory JSON session metadata store. Migrating
  that existing store is separate work.
- [All-session search](../../topics/all-session-content-search.md): this feature
  indexes issue references, not a general full-text transcript corpus. Reuse its
  visible-text/access principles without importing the whole search proposal.
- [Session remaps](../../topics/session-id-remap.md) and
  [working directories](../../topics/agent-working-directory-tracking.md): use
  canonical YA session identity and current effective project mapping.
- [Architecture mandates](../../topics/architecture-mandates.md): one bounded
  acquisition/indexing owner, no repeated full-corpus parse or idle-session loops.
- [Project storage](../../topics/project-directory-storage.md): no project files,
  Git metadata, notes, or refs are written by this feature.
- [Commit attribution](../../gaps/committed-change-session-attribution.md) and
  [session worktree identity](../../gaps/session-worktree-file-links.md) are
  related evidence problems, but neither is a dependency or closed by this work.
- `services/voice/vocabulary-sessions.ts` and `VocabularyLearning.ts` show
  persisted extraction, source-version checkpoints, coalescing, cancellation,
  and progress. Reuse these concepts, not their whole-catalog scan policy or an
  assumption that compaction paging bounds source reads.
- [SQLite capability test gap](../../gaps/version-speech-session-terms-test.md):
  recheck the recorded readiness assertion against concurrent corrections before
  touching version tests. Preserve existing capability semantics; if an open gap
  is fixed here, isolate that correction and remove its entry in that commit.

### What YA actually knows about Workstreams and branches

`SessionMetadataService.ts` has optional `workstreamId` and a `setWorkstream`
writer. `routes/sessions.ts` resolves it only when explicitly supplied, checks
`workstreamsEnabled`, and persists it for a selected YA lane. `WorkstreamService`
stores lane path/branch metadata. This is implemented experimental lane plumbing,
not automatic discovery of arbitrary Git worktrees used by ordinary sessions.
The read-only localhost:3400 check on 2026-09-10 returned
`workstreamsEnabled: false`; the project workstreams route returned disabled.
The maintainer has not used this feature. It must not constrain this MVP.

The review's claim that there is no branch evidence outside Workstreams was
also too strong: `shared/src/claude-sdk-schema/entry/BaseEntrySchema.ts` carries
optional `gitBranch` and a `cwd`, and provider transcripts retain these facts.
Those could later support provider-reported observations; they do not by
themselves prove every tool's actual working directory or a repository mutation.
Future branch/worktree discovery should compare provider metadata, tool cwd,
and properly scoped Git observations, recording their provenance independently
of whether YA created a lane. All such extraction is deferred here.

### How T3 collects associations

Read-only reference: `~/github/t3code` at `d29c56a5c`, 2026-09-10. Paths in this
subsection are relative to that checkout, not YA runtime dependencies.

- `apps/server/src/orchestration/ThreadPullRequestReactor.ts` groups eligible
  threads by saved project/worktree/branch, reacts to thread metadata and turn
  lifecycle changes, and performs a periodic sweep. It asks
  `git/GitManager.ts::branchPullRequest` for the PR matching that branch.
  GitManager resolves remotes/upstreams and calls the source-control provider's
  `listChangeRequests`; it validates repository identity and caches lookups.
  This is Git/remote-PR correlation, not arbitrary Jira-key transcript extraction.
- `apps/server/src/git/linkCreatedPullRequest.ts` associates a PR produced or
  opened by a T3 Git action with its thread, using source `created`.
- `apps/server/src/mcp/toolkits/pullRequests/handlers.ts` implements
  `link_pull_request`, scoped to the invoking thread, recording source `agent`.
- `apps/server/src/orchestration/PullRequestSyncReactor.ts` refreshes known PR
  summaries, groups requests by PR, and links host-reported stack members.
- `apps/server/src/persistence/Migrations.ts` statically registers numbered
  migrations through Effect. Migrations 042/048 added single PR JSON columns;
  050 added many-to-many links plus a reverse index and backfilled old links.
  `ProjectionThreadPullRequests.ts` stores source and cached snapshot/stack JSON.
  `packages/shared/src/threadPullRequests.ts` normalizes identity, exposes search
  terms, and preserves hidden stack-dismissal tombstones.

No general Jira/ticket-number transcript indexer was found in these paths.
Borrow explicit discovery producers, stable external identity, deduplication,
and dismissal protection. YA's initial producer is a deterministic reference
extractor over session text; it does not require T3's Git actions, agent MCP,
remote credentials, or Workstreams. A current PR snapshot is a cache, distinct
from the historical evidence explaining an association.

## Automatic indexing contract

### Scope and controls

One server-scoped experimental opt-in enables the complete feature. Use the
existing `ServerSettingsService` rather than a new settings framework. Proposed
settings: `issueAssociationsEnabled` (false), `issueIndexScope` (`viewed` by
default, or `recent`), and `issueIndexRecentDays` (7 by default; integer 1-90).
Selecting recent mode explicitly authorizes bounded recent-session indexing.

- **Viewed sessions:** normal authenticated session viewing automatically
  indexes the persisted message window already delivered; loading older pages
  indexes those pages too. There is no separate Scan click to make the feature
  useful. Reuse normalized server-side data from the authorized detail read,
  before public-share projection and without another full transcript read.
  While a session has active view demand, completed turns trigger bounded
  capture of newly persisted content. Closing the last view releases its
  ongoing demand; a bounded in-flight batch may finish, but no idle loop remains.
- **Sessions active in the last N days:** automatically admit sessions whose
  catalog activity is within the window and continue eligible changed sessions.
  The setting selects sessions by activity, not messages by timestamp: their
  history may include older messages. State that explicitly in Settings. Viewed
  older sessions may additionally contribute their viewed windows. Expanding N
  queues newly eligible candidates; reducing N stops new background acquisition
  outside it. Already retained metadata/evidence is not deleted as it ages out.

Show coverage: viewed windows only, queued/indexing, indexed through a source
position, stale, unsupported, or failed. An empty partial result cannot claim
that no session mentions the ticket. A recent-window sweep returns results
incrementally and is resumable after restart; it does not block server startup
or the first usable issue list. Do not automatically backfill all history.

Disabled state hides the sidebar/controls, releases indexing demand, cancels
background work, and rejects new acquisitions/writes from stale clients.
Disabling preserves records. Re-enabling viewed mode waits for new view demand;
re-enabling recent mode resumes the configured recent window. A generation fence
prevents in-flight work from publishing after disable, deletion, or scope changes.

### Extract references without preregistered issues

Use one deterministic extractor for both viewed windows and background batches:

- Jira-style keys with token boundaries, such as `ABC-123`.
- Full Jira issue, GitHub issue, and GitHub PR URLs.
- Repository-qualified GitHub references such as `owner/repo#123`.
- `#123` only when the text explicitly calls it an issue/PR and trustworthy
  repository context is available; arbitrary bare numbers are not issue evidence.

Create evidence and discovered associations automatically when identity resolves.
Existing registered issues are not a prerequisite. Keep an unresolved reference
searchable with its session/source when a Jira host, repository, or issue-vs-PR
kind is unknown; uncertainty must not discard the ticket mention or invent a URL.
Resolve with an explicit full URL in matching scoped context, an unambiguous
existing mapping, or an operator-supplied project tracker/repository mapping.
Different Jira tenants or repositories sharing a key/number never silently merge.
Group unresolved search results by reference plus observed project/tracker
context; the same text across unrelated contexts is not one canonical issue.
A false-positive candidate can be dismissed; use supported patterns/configured
prefixes rather than an LLM classification step. Case and delimiter normalization
must be deterministic and tested.

The corpus is ordinary visible user/assistant message text. Exclude hidden
instructions, reasoning, synthetic setup, tool arguments/results, and raw logs.
A ticket-like string in conversation is evidence of mention, not evidence that
work was implemented or completed. Provider-reported branch/cwd data is outside
this first extractor. Remote title fetching and tracker mutation are absent.
Titles can come from a descriptive Markdown label or manual override, with
provenance. Key/URL search works before a title exists; do not fabricate titles.

### Acquisition and scheduling

The viewed-window path adds no source read: consume the already-authorized
persisted normalized records. It must cover normal detail-return branches and
incremental page loads, not only one provider/happy path. Run extraction in
bounded chunks outside response-critical synchronous work; never retain entire
transcript arrays in an unbounded queue. Reject public-share traffic as an
indexing trigger. Use exact persisted IDs/source locators and wait for durable
identity when a live-only row has not yet been saved.

Recent-window indexing and unseen persisted tails need real bounded acquisition.
`ISessionReader.getSession` currently has presentation selectors, not universal
byte limits; Claude loads `claudeTranscriptCache` before filtering, and one
compaction window can be arbitrarily large. Add an optional provider-owned
bounded persisted-message iterator that reuses parsing/normalization helpers,
with byte/record limits, deadline/abort signal, cursor and coverage information.
Never silently fall back to loading an entire transcript. Prove Claude and
Codex paths first, including lineage/compaction identity. Other providers retain
automatic viewed-window indexing where normalized persisted text is available,
and clearly report any unsupported background acquisition.

One server-owned worker coalesces view/turn/catalog signals by canonical session
and source version. Viewed sessions have priority. Recent candidate enumeration
is paged over catalog metadata; unchanged cold transcripts are never reparsed
by a timer. Start with one active acquisition, at most 16 pending session IDs,
8 MiB/2,000 logical records per batch, a 30-second batch deadline, and 100 rows
per SQL transaction. Bound individual reads before allocation, including an
oversized JSONL record. Yield between batches. These are starting limits to
validate on fixtures, not measured performance claims.

Batch limits mean automatic yielding/requeueing while scope/demand remains
eligible, not requiring the user to click Continue for each batch. Fairness
must prevent one large session starving others. Persist coverage and a
candidate-enumeration cursor so queue saturation leaves discoverable pending
work rather than silently losing sessions or retaining an unbounded queue.
Source rewrites invalidate checkpoints without erasing historical evidence.
Settings changes and shutdown cancel stale generations; failures use bounded
retry/backoff and visible state, not an endless per-session poll loop.

## Data, evidence, and corrections

Keep three domain tables, plus small operational indexing checkpoints as needed:

- `external_issues`: canonical external identity and URL, kind, observed title
  and source, manual title override, timestamps. Host participates in identity.
  Normalize GitHub owner/repository and number and Jira host/key. Strip navigation
  suffixes/tracking parameters for identity; preserve safe source anchors in
  evidence. No credentials or authentication query parameters are retained.
- `session_issue_links`: unique `(issue_id, canonical YA session_id)`, state
  `discovered`, `confirmed`, or `dismissed`, and creation/decision times.
  Automatic discovery is visible without requiring confirmation. Manual actions
  can confirm/correct it; new evidence never undoes dismissal.
- `session_issue_evidence`: the source session, occurrence key, kind
  `message-url`, `ticket-key`, or `manual`, observed value, bounded excerpt/note,
  source locator, occurrence/observation times and extractor version. The link
  reference is nullable while a raw reference awaits resolution; index unresolved
  keys with their project/tracker context so searches already find the sessions.
  When resolution succeeds, attach existing evidence to the canonical link
  atomically. Suppression of an unresolved occurrence survives reindexing.

Operational checkpoints track source coverage and queued recent enumeration;
these are rebuildable state, not a fourth user-facing entity. Do not call all
of `discovery.sqlite` disposable. Evidence-to-link and link-to-issue references
use foreign keys. Session records remain owned by the current catalog.

Deduplicate by stable persisted message ID/source occurrence and normalized
reference. A timestamp or content-only hash is insufficient: distinct repeated
mentions must survive, and a parser upgrade must not duplicate the same sighting.
Extract URL and enclosed ticket-key text as one observation when they identify
the same occurrence. Cap excerpts at 512 characters and URL inputs at 4 KiB;
paginate evidence instead of imposing a lossy lifetime evidence-count cap.

Source-session identity exists even for unresolved observations. Resolve aliases
on writes, avoid unresolved provisional launch IDs, and integrate saved-ID
remaps with the supervisor's internal mapping, not just its optional public
notification. Merge collisions by unioning evidence and preserving the latest
explicit decision, with dismissal winning an equal-time tie. Missing sessions
remain marked unavailable; archiving, project moves or missing transcripts do
not erase evidence. Source anchors that no longer resolve are labeled unavailable.

Dismissal retains evidence and can be reversed explicitly. Deleting a saved
issue explains that it removes its resolved links/evidence; a genuinely later
observation may rediscover it. In-flight work cannot reverse deletion. Unresolved
observations can be removed/dismissed explicitly without inventing an external
issue. Disabling/index-window expiry is never a data purge. Manual titles,
notes, decisions and historical observations have no automatic expiry.

## Search and UI

The opt-in Issues & PRs sidebar lists automatically discovered issues/references,
with key/title/provider, resolution state and associated-session count. Search
stored keys, title and URLs with case-insensitive literal substring matching.
Unresolved keys appear as unresolved, with their associated sessions and source
text; external navigation waits for real identity. Opening an issue lists its
sessions and expandable evidence. Session detail shows the reverse references.
Paste a URL to find/resolve an item or add a missing association, not to seed the
indexer. Confirmation, dismissal/restore and manual titles remain available.

Show indexing coverage beside results, including provider limitations and the
selected recent window. Do not make lack of remote titles look like index failure.
Use bound SQL with escaped LIKE metacharacters; no FTS/semantic search machinery.
Paginate list/evidence reads (default 50, maximum 100), index canonical identity,
reference keys, session reverse lookups and checkpoint ownership. Apply project
filters using current catalog membership before final page limits; a bounded
candidate continuation must not pretend a filtered first page is all results.

Reuse existing theme/components, CSS Modules, English i18n keys, session routes
and client source runtime. Long keys/URLs and evidence controls work on phone
without hover. All records stay server-owned. Existing session-access controls
apply to counts, unresolved references, excerpts and navigation. Public shares
neither trigger indexing nor receive issue metadata. Storage failure never
acknowledges unsaved data or masquerades as an empty list; no localStorage fallback.

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

## Compatibility and implementation sequence

The first public capability covers the automatic MVP, not a manual-only release.
Propose sparse optional `issue-session-associations-v1` for settings/scope,
issue/reference search, association/evidence reads and corrections, view
indexing admission, and coverage/progress. Advertise only with implemented
indexing and ready SQLite, independently of opt-in; routes separately enforce
policy, authorization and per-provider background availability. An absent bit
hides controls and sends no new requests. Existing SQLite status can explain
unavailability without guessing a detailed failure reason.

Before editing wire types/routes/client consumers, inspect the latest two stable
releases and all stable releases from the preceding 14 days, then present the
exact corpus, paths/fields/events, gate and fallback for maintainer review under
[DEVELOPMENT.md](../../DEVELOPMENT.md#clientserver-compatibility-review).
Do not infer approval from this document or expand existing capability meanings.

### 1 — Pin the automatic contract and migration upgrades

Complete compatibility review. Freeze current SQL migrations and add prefix
upgrade fixtures for empty/v1/v2/v3 databases, repeat startup, failure rollback,
contention, newer-schema refusal, and Node/Bun interchange. Preserve historical
v3 behavior and active vocabulary's separate files/readiness. Correct the SQLite
topic. Begin the owning `topics/issue-session-associations.md` as behavior lands;
keep speculative future extensions out of the implemented contract.

### 2 — Persist extracted references and their evidence

Implement canonical URL/key extraction, unresolved observations, context-aware
resolution and merge, three domain tables, indexing checkpoints, and the focused
service. Add idempotent writes, source/session remaps, dismissal/delete fences,
search, pagination and current-project filtering. Pure extractor tests must
begin with an empty issue registry and find real ticket keys and URLs.

### 3 — Deliver automatic viewed-session indexing

Connect the extractor to authorized persisted-message windows already loaded
for session views, including older-page and incremental paths. Add view-demand
ownership and bounded acquisition for newly persisted tails on core providers.
Verify viewing two ordinary sessions automatically creates searchable evidence
without manual linkage, Workstreams, or remote credentials. Add the sidebar,
search/detail/reverse-reference UI and correction controls around this behavior.
The feature does not ship at a manual-only intermediate milestone.

### 4 — Add configurable recent-session indexing

Implement bounded provider iterators and recent catalog enumeration, incremental
checkpoints, automatic fair continuation, progress and scope changes. Use exact
changed-session signals and metadata invalidation rather than reparsing the
whole catalog on every event. Prove Claude/Codex support, capture source identity
across compaction/lineage, and advertise other adapters' limitations honestly.
The configured recent scope is part of this plan's complete MVP. A deliberate
viewed-only release can be discussed separately if this step proves costly;
that would still include automatic extraction, never a manual-only substitute.

### 5 — Verify the automatic workflow and observable contracts

Required end-to-end scenario: start empty with Workstreams disabled. View two
sessions mentioning `ABC-123`, one also mentioning a GitHub PR URL. Without
creating a manual link, find the key and PR, see both sessions and their source
evidence, resolve the Jira host from a later explicit URL/context, and search
again after restart. Test a manually edited title, but do not depend on it for
the initial discovery. Dismiss a false match and reindex without restoring it.

In recent mode, configure N, discover an unopened eligible session, verify
out-of-window sessions are not scanned, and change N. Prove bounded acquisition,
fair automatic continuation, restart recovery, source rewrites, repeated views,
duplicate deliveries, unresolved namespace conflicts, large records, queue
saturation, disable/re-enable and deletion races. Reaching a scan batch limit
must not quietly require manual work to complete automatic indexing.

Use realistic multi-project fixtures, long titles, repeated mentions and missing
transcripts. Verify access isolation and absence from public-share payloads.
Run repository-required lint, formatting, typecheck, unit and browser checks,
client console scan and scoped CSS checks. Verify packaged SQLite on supported
Node/pinned Bun and Linux/macOS/Windows; state any unavailable host validation.
Inspect fresh-server desktop/phone captures per UI testing requirements. Check
that index work does not delay session opening and that cold-idle work quiesces;
follow measurement-host rules for any regression claims.

Finish with current topic contracts for automatic scope/coverage, identity,
resolution, retention, failure behavior, migrations and access boundaries. Keep
the roadmap current. No implementation is complete merely because manual CRUD
and an empty sidebar work.

## Review decisions and maintainer correction

The independent YA review used verified `claude-opus-5`, `effort: xhigh`, session
`56c01728-ad7c-423b-af13-306f16699ebc`, reviewing plan `7402c6a6c` and T3
`d29c56a5c`. Keep its useful findings: three tables, frozen SQL, actual bounded
acquisition work, concrete downgrade behavior, no speculative remote cache,
source-aware dedupe, and separation of link state from evidence.

The maintainer rejected the subsequent manual-first ship boundary and Workstream
restriction. Those recommendations do not define the requested product: evidence
collection must provide value for normal existing sessions. This version restores
automatic indexing as a release criterion and cuts branch/worktree inference
instead. Future Git evidence should be discovered independently of YA lane creation.

Do not copy the review's suggestions that compaction paging is a source-byte
bound, that catalog IDs eliminate all remap cases, or that timestamps uniquely
identify observations. Likewise, evidence pagination preserves durable history;
a small expected row count is not justification for a lossy lifetime cap.
