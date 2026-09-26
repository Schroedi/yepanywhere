# DuckDB for on-demand transcript queries and derived tables

Status: evidence-backed candidate, not an approved dependency or migration.
Documentation and YA source review on 2026-09-26 found a plausible use for
file-backed analytical queries. No DuckDB installation, YA integration, or
performance benchmark was performed.

## Why investigate

The maintainer proposes DuckDB in its tables-in-files role: the kind of work
often done with pandas and columnar data tools. Evaluate SQL over provider JSONL
and reusable derived tables for cold history, cross-session aggregation, and
repeated queries. Apache Arrow is a columnar interchange/in-memory format;
Parquet is a columnar file format. Neither requires a new authoritative store
for provider transcripts.

The maintainer encountered both DuckDB and Skip through persuasive appearances
on the **Developer Voices** interview show. That is the reason for the
[Skip cross-reference](skip-session-tracking.md); their techniques and concepts
are mostly orthogonal, with no proposed implementation dependency. DuckDB can
acquire and query a selected historical corpus; the Skip sketch evaluates
maintained dependent views and selective client synchronization. Either
experiment can proceed independently. The interview context is maintainer-
reported; this investigation used the technical sources below, not episode
transcripts.

**Live truth/index maintenance over JSONL was the maintainer's speculation.**
They did not hear a concrete claim of that capability. Evaluate it as a possible
YA design, without attributing it to DuckDB or the interview guest. The verified
file-query capabilities below are sufficient motivation for this sketch even
if that speculative maintenance path proves unattractive.

## Evidence and limits

The following primary sources were checked on 2026-09-26. Versioned behavior
must be rechecked against the exact release chosen for a POC.

| Capability | Verified evidence | Implication for YA |
| --- | --- | --- |
| SQL directly over JSONL | [JSON loading](https://duckdb.org/docs/current/data/json/loading_json) supports newline-delimited JSON, explicit schemas or inference, multiple files, and `CREATE TABLE AS SELECT` from JSON. | Query selected files without first designing a permanent database; optionally materialize a reusable projection. |
| Vectorized JSON analysis | [DuckDB's JSON article](https://duckdb.org/2023/03/03/json) describes nested JSON conversion into vectors and parallel file/NDJSON reading. | Plausible cold-corpus extraction and aggregation engine. Its example timings are not evidence of a YA speedup. |
| Lazy query construction | [Python relational API](https://duckdb.org/docs/current/clients/python/relational_api) defers execution until a result is requested; the relation itself holds no data. | This is deferred execution, not automatic lazy index construction or a dependency-tracked cache. The Python API is evidence for the distinction, not a selected YA binding. |
| Views versus retained data | [CREATE VIEW](https://duckdb.org/docs/current/sql/statements/create_view) reruns the underlying query when referenced rather than materializing results. | A view over JSONL is a convenient query definition, not an append-maintained table. Persisting selected results is a separate operation. |
| Native table indexes | [Indexes](https://duckdb.org/docs/current/sql/indexes) documents automatic min/max indexes and explicit/constraint-created adaptive radix trees for selective lookups. | Do not assume these create persistent seek indexes over arbitrary external JSONL. Materialize native tables before evaluating their index behavior. |
| Columnar file pruning | [Parquet reading](https://duckdb.org/docs/current/data/parquet/overview) supports projection/filter pushdown and row-group skipping using available statistics. | A normalized Parquet projection is a candidate for repeated history queries. Do not transfer Parquet's physical skipping properties to raw JSONL. |
| Text search limitations | [Full-text search](https://duckdb.org/docs/current/core_extensions/full_text_search) provides token-oriented ranked search and explicitly warns that its index does not update when the input table changes. | It is not a drop-in answer to YA's arbitrary-substring and live-append requirements. Plain substring SQL remains a scan unless a separately proven index accelerates it. |
| Node integration | [Node Neo](https://duckdb.org/docs/current/clients/node_neo/overview) supplies `@duckdb/node-api` over C API bindings, with memory and file-backed databases. | Integration is possible, but adds packaging/runtime obligations beyond YA's built-in SQLite. Node support does not prove compatibility with Desktop's pinned Bun. |
| Process ownership | [Concurrency](https://duckdb.org/docs/current/connect/concurrency) distinguishes one-process embedded read/write ownership from multi-process read-only access and separate remote/catalog approaches. | Give a writable derived database one owner for the first POC. Do not let Hono and the provider host independently open it for writes. |

The supported opportunity is **on-demand querying and explicit materialization**.
The inspected core APIs do not establish automatic filesystem observation,
incremental view maintenance over changing JSONL, or a reactive subscriber
protocol. Those would need YA-owned ingestion/reconciliation or a separately
evaluated extension. Keep native table-index maintenance after SQL writes
distinct from detecting and ingesting external file changes.

## JSONL can remain the source of truth

Materialization does not imply moving future authoritative writes from JSONL
into a database. Keep three possible modes distinct:

1. Query provider-owned JSONL directly each time, accepting the acquisition
   cost of each query.
2. Retain a disposable query table refreshed from provider-owned JSONL, with
   an ingestion owner responsible for coverage and changes.
3. Make a database the authoritative write destination. This is a different
   migration and is not proposed for provider transcripts here.

The maintainer specifically suspects an existing append-JSONL maintenance flow.
Targeted follow-up found relevant primitives and ecosystem support, but not
proof of the exact desired tail-following contract:

- DuckDB's [Appender](https://duckdb.org/docs/current/data/appender) inserts
  batches supplied by a caller into a table. It is not itself a file follower.
- [`COPY FROM`](https://duckdb.org/docs/current/sql/statements/copy) can append
  imported JSON/NDJSON rows to a table. Re-running it on the same full source
  does not establish an automatically remembered input offset or deduplication.
- The separate ingestion tool
  [omniload documents incremental JSONL file selection into DuckDB](https://omniload.readthedocs.io/supported-sources/filesystem.html):
  its mtime cursor selects new or modified files. Its
  [incremental-loading contract](https://omniload.readthedocs.io/getting-started/incremental-loading.html)
  describes file selection and append/replace behavior, not resuming at the
  last complete-record byte offset within a growing file. It also documents
  missed older-mtime backfills and unchanged-mtime modifications. This is
  evidence that recurring file-to-DuckDB ingestion exists, not a recommendation
  to adopt that tool or proof of correct YA transcript tail maintenance.

Efficient suffix ingestion from an existing growing JSONL file therefore
remains an open investigation, not a rejected possibility. Before building
another follower, check any candidate integration for durable byte/record
checkpoints, partial final records, idempotent restart, truncation/replacement,
and rewrite detection. Distinguish logical incrementality (only new rows reach
the table) from physical incrementality (old bytes are not reread and parsed).
YA's existing bounded provider reader is one available source of such batches;
using it would preserve JSONL authority even while DuckDB tables receive updates.

## Concrete YA candidates

**Cold transcript exploration and backfill are the clearest first fit.** Run
bounded, selected-corpus queries for record distributions, activity counts,
provider/session relationships, and historical summaries. A disposable local
analysis tool can be useful even if a runtime dependency proves unwarranted.
For user-facing results, extract through YA's provider interpretation boundary
or prove parity; a JSON field named `text` is not necessarily visible turn text.

**Reusable normalized history is a second candidate.** Materialize only the
requested project/session partitions into DuckDB tables or Parquet, with stable
session/message identifiers and source coverage. Compare repeated queries with
direct JSONL scans and equivalent SQLite tables. Avoid eagerly loading all
history at startup or converting every store because a query engine is present.

**All Sessions search is relevant but remains an open index problem.**
[The existing gap](../all-sessions-search-index.md) records repeated transcript
acquisition, explicit coverage, append/rewrite invalidation, and the missing
disk-backed substring index. Its [index sketches](../../topics/all-session-content-search.sketches.md)
already consider substring candidate structures. DuckDB may help retain/query
normalized text or batch-build candidates, but its built-in full-text extension
does not close that gap. Preserve current role filtering, substring semantics,
normalization, stable navigation IDs, cancellation, and partial-coverage reporting.

The checked-in acquisition path is
`packages/server/src/routes/session-content-search.ts` → provider
`readIssueTextBatch` → `packages/server/src/sessions/issue-text-reader.ts` and
provider normalization. It already has bounded reads, continuation state, and
incomplete-tail handling. Compare against this baseline rather than an
unbounded `JSON.parse` of entire transcripts.

Related [SQLite cold-storage work](../sqlite-backed-cold-storage-startup.md)
targets readiness and bounded cold queries, while
[session catalog observation](../../topics/session-catalog-observation.md)
owns compact retained summaries. DuckDB must demonstrate a distinct analytical
benefit before displacing these mechanisms. The
[runtime-portable SQLite contract](../../topics/optional-sqlite.md) remains the
existing storage baseline, not authority to add DuckDB.

## Truth, coverage, and refresh remain explicit

Provider files stay authoritative; every materialized table is rebuildable
derived state in YA app data. Persist a manifest of source identity/revision,
accepted complete-record boundary, normalization/schema version, and covered
sessions with each accepted generation. A fast empty query is not evidence of
absence outside that coverage.

For live files, acquire a coherent complete-record prefix through an adapter or
use an immutable snapshot for the first experiment. Test unfinished final lines,
append, truncate, replacement, and earlier-byte rewrites followed by growth.
Schema inference from sampled records is not a provider-schema guarantee;
heterogeneous types, missing fields, and large records need deliberate handling.
Do not use `ignore_errors` to turn corrupt or excluded records into silent
claims of completeness. Preserve YA's diagnostics and provider visibility rules.

An optional later refresh owner could batch confirmed new records into tables
and invalidate/rebuild affected partitions on rewrite. Measure that owner and
its publication protocol as part of the system: DuckDB transactions cannot make
an independently mutating JSONL corpus an atomic external snapshot. Filesystem
subscriptions can schedule refresh, but are not themselves proof of coverage.

## Small POC before any runtime adoption

1. Use immutable, sanitized Claude/Codex fixtures plus normalized visible-turn
   rows as a parity oracle. Include many retained sessions with 1–5 active in
   the later mutation trace. No provider process is needed for the first pass.
2. Compare the existing bounded reader, direct DuckDB JSONL queries, and reused
   DuckDB tables on the same selected corpus and query outputs. Add a comparable
   SQLite projection; evaluate Parquet separately rather than combining format
   conversion and engine changes into one unexplained speedup.
3. Include cold one-shot extraction, repeated counts/grouping/joins, selective
   session/time queries, and exact substring scans. Separate build cost from
   reuse benefit; record bytes read, CPU, peak/retained memory, storage/spill,
   cancellation latency, and interference with the serving event loop.
4. In a second pass, append and rewrite fixture sources. Verify idempotent
   ingestion, exact covered results, invalidation, restart, and interrupted
   publication. Account for watcher/ingestion work rather than crediting DuckDB
   with maintenance the harness performs.
5. Decide whether the result earns a diagnostic-only tool, optional backend
   worker, or production path. Check native package size, supported OS/CPU and
   Node/Bun combinations, resource ceilings, and deployment cost before adding
   a dependency. A server query engine alone does not satisfy the Skip sketch's
   selective local-client view goal; any later connection needs explicit
   snapshot/delta publication and coverage semantics.

The proposal is warranted by documented file-query capabilities and YA's
existing repeated-acquisition problem. Performance, operational fit, and simpler
maintenance remain hypotheses. This sketch changes no roadmap priority and
does not authorize a production migration.

Captured 2026-09-26 while evaluating the maintainer's DuckDB suggestion.
Contributing-model: 6-Astra
