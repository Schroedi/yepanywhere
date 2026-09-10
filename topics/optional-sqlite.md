# Built-in SQLite storage

> SQLite is normal YA storage infrastructure for keeping cold data out of RAM
> and avoiding startup-blocking JSON loads. It uses the runtime builtin, without
> a native package build. Product features keep their own enablement and retention
> policies; opening storage does not enable learning, search, or indexing.

Topic: optional-sqlite

Verified: 2026-09-10

## Startup policy

`YEP_SQLITE` accepts `off` or `auto`. An unset value means `auto`; invalid values
are configuration errors. Changes take effect after restarting the server.

This default is infrastructure, not a feature opt-in. Independent features
still govern learning, indexing, retention, and their own background work.
An explicit `off` is a development/recovery escape hatch: SQLite-dependent
capabilities may be unavailable or hidden. The previous unset/off default
was not persisted by browsers, so it needs no client migration; restarting
updated YA with no explicit setting initializes storage automatically.

- `off` does not load either SQLite builtin, create a connection, or create a
  discovery database.
- `auto` attempts initialization once per Hono generation. A missing builtin
  produces `unsupported`; an open, filesystem, lock, or migration failure
  produces `error`. Either state preserves ordinary server operation.
- The desktop launcher supplies `auto` when `YEP_SQLITE` is absent and preserves
  an explicit inherited value, including `off`. `YEP_DESKTOP` alone is not a
  storage override.

The service retains status; version requests do not probe storage or retry
initialization. Restarting after correcting an error performs another attempt.
Server logs retain initialization error details; wire status contains no paths
or raw exception messages.

Close failures are also logged and do not interrupt the remaining app teardown.
The service clears its connection and reports `error` after a failed close.

## Runtime adapters

The server selects `bun:sqlite` when running under Bun and otherwise attempts
`node:sqlite`. Loading is guarded and deferred until storage is enabled. No
SQLite package, native installer, sidecar, or compiler is added to the core
distribution. Desktop's pinned Bun is tested directly, independently of claims
about newer Bun versions' Node compatibility.

The adapter exposes synchronous prepared statements with positional parameters,
SQL execution, transactions, and idempotent close. Values are strings, null,
byte arrays, and numbers; integer inputs/results must fit JavaScript's safe
integer range. A missing single row is `undefined` on both runtimes. Transaction
callbacks must be synchronous; nested transactions and thenable results are
rejected. Callers must not begin/commit transactions manually within a callback.
Future indexing consumers must bound their synchronous work rather than place
large scans on request paths.

Callers finalize statements when finished. Finalization drops the statement on
Node and explicitly releases its native resources on Bun. Closing the adapter
also finalizes outstanding Bun statements before closing the database; Bun
1.3.14's default close otherwise leaves them and the Windows file handle alive.
Using a finalized statement or one belonging to a closed adapter throws.

Node versions without an accessible SQLite builtin still load the published
modules and report `unsupported` in auto mode. Node's experimental-module notice
on applicable versions is not suppressed by the service.

## Database ownership and migration

The database is `{dataDir}/discovery.sqlite`, using the existing profile and
`YEP_DATA_DIR` resolution. No project or Git-metadata writes are introduced.
One connection belongs to each Hono generation and closes during the existing
reload/shutdown disposal path. Separate profiles have separate databases.

The initial schema reserves a YA application identity (`0x59414449`, ASCII
`YADI`). Historical version 2 added speech vocabulary tables; version 3 removed
its receipts/counts/staging tables. The remaining vocabulary state table is no
longer used: active learning settings and counts live in their separate JSON and
`speech-vocabulary.sqlite` files. See
[learned vocabulary](pluggable-speech-recognition.md#learned-vocabulary-contract).
Versions 4 and 5 add [issue/session associations](issue-session-associations.md):
three durable domain tables and operational indexing/resolution/deletion state.
Opening the database does not enable that experiment.

One statically registered, consecutive migration sequence owns `user_version`.
Historical SQL lives in frozen named modules; released migrations are append-only.
Do not edit, renumber or reuse them, or import mutable current feature schemas.
`discoveryMigrationPrefix(version)` builds historical fixtures with the actual
migration prefix. Resolve concurrent number collisions before landing.
Additive changes are preferred; data conversions need preservation/rollback
fixtures and a recovery plan. Provider reads and large backfills belong in bounded
resumable post-startup work, never migration initialization. A future destructive
conversion's backup must be a consistent SQLite backup, not a live file copy.

Pending migrations and version advancement run in one immediate transaction.
Foreign keys are enabled and lock waits are bounded to 250 ms, including the
migration lock. The default rollback journal remains unchanged. Even a no-op
startup takes the immediate lock; concurrent mixed-version profile use is not
supported, and contention may report error without data loss.

An existing foreign database, malformed database, or newer schema is refused.
YA does not reset or delete it. A failed migration rolls back its statements
and schema version. Initialization closes a partially opened connection before
retaining error status. The database is not disposable: issue decisions, manual titles and historical
evidence must survive independently of rebuildable indexing checkpoints.
There are no automatic down migrations. Disabling a feature does not roll back
the schema. An older reader that refuses this schema also loses discovery-gated
speech capabilities/routes, while preserving the separate speech files. Recover
by upgrading again or explicitly restoring a consistent pre-upgrade backup.

Existing JSON metadata/caches, OpenCode's independently owned database and
reader, and the relay/push-broker SQLite dependencies are unaffected.

## Availability and frontend compatibility

`GET /api/version` has an additive optional field:

```ts
sqlite?: { state: "disabled" | "unsupported" | "ready" | "error" };
```

An absent field means that source server does not report SQLite state. A
frontend must not infer readiness from its own runtime, desktop presence, or
server semver. The field passes through the existing source-scoped version
snapshot, including legacy and negotiated capability encodings.

No generic SQLite capability ID is allocated. Future session discovery routes
must receive their own exact optional capability, advertised only when their
implementation and required storage are available. Storage readiness alone
does not enable discovery UI. Old/disabled servers receive no new requests;
older clients can ignore the new field. Existing capability meanings and protocol
levels are unchanged; the separately approved server runtime floor is documented in
[server runtimes](server-runtime.md).

The approved optional-feature corpus is v0.8.0 (2026-08-31) and v0.8.1
(2026-09-05): the latest two stable server releases and all stable server
releases within the preceding 14 days on 2026-09-08. Both lack SQLite status.
This change adds no frontend consumer, endpoint, or unsupported fallback call.

## Verification

`scripts/test-discovery-sqlite.mjs` runs the same contract against packaged
modules across the supported Node boundaries and Desktop's pinned Bun. It
covers persistence, parameters, rollback, migrations, newer/corrupt files,
contention, teardown and disabled/unsupported driver behavior. Shared-file
checks verify Node/Bun interoperability.

`scripts/test-sqlite-startup.mjs` checks real packaged `/api/version` state and
runtime identity in disposable profiles. The Server Runtime And SQLite workflow
also verifies fresh npm installation rather than only attached workspace deps.
Linux, macOS and Windows run full Node/Bun startup across disabled, ready and
error SQLite states. The [restored matrix](https://github.com/kzahel/yepanywhere/actions/runs/34485119811)
passed all twelve OS/Node combinations on 2026-09-10; Windows no longer excludes
full packaged startup.
Node 20 is no longer a supported main-server runtime; an old running server
remains compatible with the hosted frontend. See [server runtimes](server-runtime.md).

Related: [server capabilities](server-capabilities.md),
[YA environment variables](ya-env-vars.md),
[OpenCode storage](opencode-backend.md).
