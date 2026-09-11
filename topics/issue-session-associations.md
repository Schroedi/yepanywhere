# Issues and PRs associated with sessions

Topic: issue-session-associations

Implemented: 2026-09-10. Experimental and default off.

## User contract

Enable **Settings → Issues & PRs** on a server with ready SQLite. The sidebar
then exposes issue search, and session headers link to their associated issues.
One glyph stands for the feature in the settings list, the sidebar and that
header link; the settings list carries it in every selectable icon style.
Ordinary authenticated session viewing automatically captures references from
persisted user/assistant text already delivered by the session route, including
incremental updates and older pages. Manual linking is not an admission step.
Public shares neither trigger capture nor receive these records.

The default scope is **Viewed session windows**. **Sessions active recently**
additionally indexes sessions whose catalog activity is within a configurable
1–90 days, default 7. This selects sessions, not individual message dates: an
eligible session's history can contain older messages. Viewed older sessions can
still contribute their viewed windows. Background readers currently support
Claude and Codex; other providers retain viewed-window capture where persisted
normalized text is available. Compressed Codex sources cannot be read by this
background adapter.

Search uses literal, case-insensitive substrings of stored keys, URLs and titles.
Pasting a full URL finds its canonical record. Search and evidence pages default
to 50 rows and accept at most 100. Project/session filters apply before the limit.
The browser content scrolls vertically within the app while its page header
remains visible. Long result lists, pagination controls, and association evidence
remain reachable at desktop and phone widths. Controls and evidence cards use the
app theme colors, typography and focus states. Results occupy the available width
until evidence is selected; phone layouts stack the result and evidence.

A shared ticket glyph identifies Issues & PRs in the sidebar, settings category
(including emoji icon mode), and the session header. The session shortcut is a
compact button-style link; on phones it keeps its accessible name and tooltip
while showing only the icon with a 44-pixel touch target. Discovery settings use
the standard searchable settings rows and toggle, with scope guidance above
the control.
An unresolved reference is useful and searchable before a tracker host is known.
Its detail can resolve it by supplying the matching full URL. Markdown labels
supply observed titles; a user can override a resolved item's title. Discovery
itself makes no tracker request and changes no external issue; the only
outbound requests come from the opt-in confirmation step below.

Coverage distinguishes viewed windows, queued/indexing, indexed, partial,
unsupported, failed and outside-scope jobs. Counts describe acquired sources,
not the whole transcript corpus. Empty search results explicitly refer to indexed
content. The page refreshes while its worker is active; there is no idle global
client poll. Refresh reloads results, rather than forcing a full scan.

The session header link carries the count of that session's undismissed
associations, read from one page of the same search route, so more than a full
page reads as `100+`. Because indexing this session's own text starts when the
session is opened, the first answer usually predates it: the header asks again
a bounded number of times, sooner while the server reports active indexing, and
restarts that sequence when the transcript grows. It then stops rather than
polling. A count the server does not currently confirm shows no badge at all,
so the number on screen is one the client actually read, and a later
association can go unnoticed until the session is reopened or extended.

## Tracker confirmation

Shape alone cannot separate a bare Jira key from ordinary prose: `UTF-8`,
`ISO-8601`, `COVID-19`, `RFC-2119` and `SHA-256` all match the pattern. Two
defences need no network. A Jira project key is at least two characters, which
excludes `H-1` structurally. `jiraKeyBlocklist` names project parts to ignore,
prefilled with the common offenders and editable to any list, including none.
Blocking applies only to keys seen without a URL, so a tracker whose real
project key is on the list keeps working through browse links.

**Settings → Issues & PRs** then offers opt-in confirmation, off by default:
turning it on is what authorizes an outbound request carrying a credential.
With it on, a reference seen for the first time gets exactly one lookup, GitHub
by repository and number and Jira by key against the configured site and
account email. A confirmed reference gains the tracker's own summary, the first
title that does not depend on someone having written a Markdown link. A missing
item is recorded as rejected, and a failed or unauthorized lookup as
unreachable.

One question per reference is the whole retry policy, and it lives in the
schema rather than in a scheduler. `issue_confirmations` takes a pending row
when a reference is first captured, and only while confirmation is on, so
enabling the feature never sets a backlog loose. The insert ignores conflicts,
so a reference holding any verdict, unreachable included, is never asked about
again by itself. Nothing polls. `POST /api/issues/confirm` is the only second
question and belongs to an explicit user action. Verdicts are per project, and
the most decisive one wins across projects: one project confirming a key
settles it even if another recorded only an outage.

Credentials resolve from a key stored in Settings, then environment variables
(`YEP_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`; `YEP_JIRA_API_TOKEN`,
`JIRA_API_TOKEN`, `ATLASSIAN_API_TOKEN`), then, for GitHub, the signed-in `gh`
CLI. The settings pane names every source and says whether it is present; no
route returns a key to a client. Stored keys are written to
`{dataDir}/issue-credentials.json` with owner-only permissions rather than into
server settings, which the settings route hands to any authenticated client.
Both credential routes stay reachable while discovery is off, so an
installation can be configured before it is turned on.

## Identity and evidence

`services/issues/extract.ts` recognizes Jira browse URLs and uppercase Jira keys,
GitHub issue/PR URLs, and repository-qualified `owner/repo#123` references.
A bare `#123` needs explicit issue/PR wording and exactly one GitHub repository
URL in the same bounded text window. Arbitrary bare numbers are ignored. Generic
Jira deployments may have context paths. GitHub Enterprise issue paths are
recognized on `github.*` hosts; `/pull/N` URLs also identify PRs on other hosts.

Canonical identities include the host and Jira context path or GitHub repository.
GitHub issue and PR URLs for the same repository/number share identity; discovering
a PR cannot subsequently downgrade its kind. Credentials are rejected. URL
tracking/query/fragment payloads are removed from saved URLs and excerpts.

Unknown keys are grouped by current observed project plus key, not globally.
One explicit URL identity in that project can resolve matching observations.
A second tenant with the same key restores ambiguity for inferred, unconfirmed
observations. Confirmed decisions remain authoritative. Contextual bare-number
observations record their repository-based provenance separately from a seen
issue URL. This is evidence of mention, never proof that work was completed.

Three domain tables in `{dataDir}/discovery.sqlite` own durable state:

- `external_issues`: canonical identity, URL, provider/kind, observed and manual
  titles. An observed title comes from a descriptive Markdown link label;
  `manual_title` is an independently retained override.
- `session_issue_links`: unique issue/canonical-YA-session association with
  discovered, confirmed or dismissed state and decision time.
- `session_issue_evidence`: source/project, stable occurrence, reference, source
  locator, bounded excerpt, observed/source times and extractor version. Its
  link may be null until identity resolves. Evidence kinds distinguish URL,
  ticket key, contextual number and manual correction.

Distinct repeated mentions survive. Redelivering the same persisted occurrence
does not duplicate it. Codex source locators use rollout ordinal/byte provenance
through normalization rather than response-array indices. Dismissed associations
remain dismissed on new observations; unresolved suppression also survives
resolution. Restore is explicit. Remaps union evidence and preserve the latest
explicit decision, with dismissal winning equal-time ties. Current working-project
metadata updates evidence navigation independently of transcript storage location.
Missing source sessions keep their historical evidence and display unavailable.
Navigation opens the source session; exact-message deep links are not exposed.

Deletion removes the selected saved item and its links/evidence. It aborts buffered
work, and source-version receipts prevent the same background snapshot from
immediately recreating it. A later changed source or a new viewed-window observation
may rediscover it, as the deletion UI explains. Disabling or aging out of a recent
window preserves all existing metadata. No automatic retention expiry or local
browser fallback exists. No project files, Git metadata or YA refs are written.

## Acquisition and lifecycle

`IssueIndexer` owns one fair recent worker and a durable SQLite queue. It admits
catalog rows from the existing retained catalog, yielding after each 100 rows;
metadata enumeration is replayable/idempotent after restart, and every admitted
candidate is durable. It does not retain a separate unbounded candidate array or
reparse unchanged cold transcripts on a timer. At most 16 jobs are fetched into a
worker batch. Settings, catalog and completed-session signals drive admission.
An unchanged failed source is not retried by an endless loop; a changed source
version permits another attempt.

A republished catalog that has not changed costs nothing. Admission is keyed
to the publication's epoch and generation, so the sweep that already covered
that pair returns immediately rather than re-walking an identical corpus, which
matters because an active server republishes every few seconds. A caller with
its own reason to sweep — a settings change, a session-id remap — is not keyed
and always runs, and only a sweep that ran to completion retires its mark, so
an aborted one is repeated rather than assumed.

A catalog sweep costs write transactions only for sessions whose working
project actually moved. Ownership can change only for a session that already
has a job or evidence row, so one read names that set before the sweep begins
and every other candidate is skipped without opening a transaction. The
observable requirement is that admitting an unchanged catalog of any size
performs no writes: SQLite takes a file lock per transaction, and an idle
server was previously taking roughly one lock per known session per catalog
publication, which is fatal on the network filesystems
[optional SQLite](optional-sqlite.md) now refuses.

Provider-owned acquisition uses 64 KiB reads, an 8 MiB/2,000-record batch budget,
a 30-second acquisition deadline and a 1 MiB individual JSONL record limit.
Oversized/malformed records leave partial coverage. Codex lineage traversal is
limited to 32 segments. Cursor state tracks source position, lineage layout,
file identity, modification and a boundary hash. Appends resume; detected rewrites
reset acquisition without erasing historical evidence. Batch limits yield and
requeue automatically. Provider readers never fall back to full-transcript reads.

Viewed windows add no file read. Their retained text budget is 8 MiB across up to
16 pending windows, inspecting at most 16,000 normalized records per admission;
overflow reports partial coverage. Extraction yields between 32 KiB text windows
with 4 KiB overlap. Transactions handle at most 25 observations or resolution rows
per batch; large project-key resolution runs through a durable continuation queue.
Settings changes, deletion, remaps and shutdown abort stale generations. Closing
the final view releases the existing session-view demand; this feature adds no
independent tail watcher or recurring per-session task.

Operational tables `issue_index_jobs`, `issue_resolution_jobs`,
`issue_deleted_snapshots` and `issue_confirmations` retain checkpoints,
resolution continuations, deletion fences and tracker verdicts. SQL statements finalize; startup migrations do no provider acquisition.
Storage errors do not acknowledge unsaved writes or become successful empty lists.
The server owns disposal and awaits indexing before closing its database.

## Compatibility and migrations

The approved optional-feature review covered v0.8.0 (2026-08-31) and v0.8.1
(2026-09-05), the latest two stable releases and all stable releases in the
preceding 14 days on 2026-09-10. Sparse optional capability
`issue-session-associations-v1` (permanent ID 68) covers:

- `GET /api/issues`, `GET /api/issues/evidence`;
- `GET /api/issues/settings`, `PUT /api/issues/settings`;
- `GET /api/issues/credentials`, `PUT /api/issues/credentials`;
- `POST /api/issues/decision`, `POST /api/issues/resolve`;
- `POST /api/issues/confirm`;
- `PATCH /api/issues/item`, `DELETE /api/issues/item`.

The shared settings service persists `issueAssociations: { enabled, scope,
recentDays }`. The bit requires ready SQLite and the installed indexing owner,
independently of opt-in; data routes also require enablement and ordinary app
authorization. Without it clients hide all controls and make no issue requests.
The Issues & PRs sidebar and direct page links open `/issues` locally and in
direct remote mode, or `/-/relay/:relayUsername/issues` in relay mode (beneath
the hosted client base when configured). Refresh preserves the issue browser
and its session/project scope; these routes must not fall back to Projects.
Selections and requests belong to the current source runtime; switching servers
remounts the browser before another server can receive the previous selection.
No existing capability meaning or protocol floor changes. This unpublished v1
contract can evolve before release; released peers require normal compatibility
review for subsequent changes.

[SQLite storage](optional-sqlite.md) owns migration policy. Frozen historical
v2/v3 SQL moved out of the mutable vocabulary schema. Migration 4 adds the domain
and indexing tables; migration 5 adds resolution/deletion continuations;
migration 6 adds the one-verdict-per-reference confirmation table. Prefix
fixtures test fresh installation, each historical upgrade, repeat initialization,
rollback and old-reader refusal. No down migrations, resets, WAL switch or longer
lock timeout were added. An older binary refusing the newer discovery schema
also loses its discovery-gated speech capabilities; separate speech files remain
untouched. Use a newer binary or explicitly restore a consistent older backup.

## Boundaries and references

Deferred: branch/worktree inference (including YA Workstreams), Git/commit
attribution, tracker synchronization, remote snapshots, semantic matching,
tool-output mining and multi-server aggregation. Credentials are now used, but
only to ask whether a reference exists: YA writes nothing to a tracker, mirrors
no tracker state, and makes no request for a reference it has already asked
about. This feature does not
close the [cold-storage startup gap](../gaps/sqlite-backed-cold-storage-startup.md),
[commit attribution gap](../gaps/committed-change-session-attribution.md) or
[worktree identity gap](../gaps/session-worktree-file-links.md).

T3 reference: `~/github/t3code` at `d29c56a5c`, inspected 2026-09-10.
`ThreadPullRequestReactor` correlates saved branch/worktree context with remote PRs;
`linkCreatedPullRequest` and the PR MCP handler supply explicit producers.
`ProjectionThreadPullRequests` retains association source and cached snapshot/stack
JSON. T3's numbered migrations and durable dismissal inspired this implementation;
YA's initial producer is visible session text and needs no YA Workstream or remote
credentials. The retired tactical 125 plan and independent Opus review are retained
in Git history under this topic's commit series.

Validation owners:
`test/storage/{issues,issue-indexing,issue-routes,issue-credentials,issue-confirmation}.test.ts`,
`client/src/pages/settings/__tests__/IssueSettings.test.tsx`,
`client/src/components/__tests__/SessionIssuesLink.test.tsx` and
`client/e2e/{issue-associations,issues-scroll,remote-issues}.spec.ts`, plus
packaged SQLite runtime checks. Remote navigation coverage uses the production
client bundle. The GitHub confirmation path was also exercised against the live
API with a real credential; the Jira path is covered against a stub.
