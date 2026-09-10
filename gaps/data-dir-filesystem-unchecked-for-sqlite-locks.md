# The data directory is chosen without checking the filesystem can take SQLite locks

`getDataDir()` (`packages/server/src/config.ts:58`) defaults to
`~/.yep-anywhere` and never asks what filesystem that is. Now that ordinary YA
storage lives in `discovery.sqlite` there, a network home directory makes the
server unusable rather than merely slow: SQLite takes a POSIX advisory lock per
transaction, and both runtime adapters
([optional SQLite](../topics/optional-sqlite.md) § Runtime adapters) are
synchronous, so every lock is a network round trip taken on the Node event loop.

Measured on an NFSv4 home (`/proc/<pid>/task/<tid>/syscall` sampling plus
`/proc/self/mountstats` deltas), with the discovery database holding almost no
rows:

| signal | value |
| --- | --- |
| main thread in uninterruptible sleep on `fcntl` against `discovery.sqlite` | 95% of samples |
| NFS `LOCK` / `LOCKU` | 182/s and 91/s, ~3.3 ms each |
| NFS `READ` | 215/s, ~8.5 ms each |
| event-loop delay, per one-minute sample | 6.5–10.7 s max, 3.3 s p99 |
| `GET /health` | 4–13 s, and the dev frontend proxy returned 502 |

The same database copied to local NVMe answers the same read transactions in
0.008 ms. The filesystem is the whole difference.

## Suggested default

Place the data directory on a non-temporary, local, SSD-backed filesystem and
leave the home path pointing at it:

- traverse the first-level subdirectories of the root for a user-writable
  candidate on such a filesystem;
- quickly benchmark when several qualify;
- create `.yep-anywhere` there and symlink `~/.yep-anywhere` to it;
- if `~/.yep-anywhere` already exists, accept that placement and change nothing.

`YEP_DATA_DIR` already overrides the location. When it is set and
`~/.yep-anywhere` does not exist, creating that symlink is the safe default, so
tools and documentation that name the home path keep working.

## Why it was not fixed here

Choosing a filesystem is a startup contract that belongs to
[optional SQLite](../topics/optional-sqlite.md) and
[app-data ownership](../topics/project-directory-storage.md), and it needs
portable detection for Linux, macOS and Windows plus a decision about migrating
an existing directory. The maintainer relocated their own data directory by
hand, and the README now tells new installs to choose local disk first.

## Open question: the transaction rate itself

Those lock counts are roughly 91 `BEGIN IMMEDIATE` transactions per second
against a discovery database whose tables are empty, with the issue-association
feature at its default `enabled: false`. Local disk makes that free rather than
fatal, so it is not the placement defect, but nothing should be opening ~91
write transactions a second at idle. The caller is unattributed.
[Per-publication vocabulary scans](speech-vocabulary-scan-per-catalog-publication.md)
is the nearest known scheduling defect and may or may not be the source.

Related: [large JSON stores delay startup](sqlite-backed-cold-storage-startup.md)
put this data in SQLite in the first place.

Found 2026-09-10 while diagnosing a YA server that stopped answering on
localhost after a kzahel merge.
