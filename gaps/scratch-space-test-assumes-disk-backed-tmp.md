# scratchSpace test fails wherever /tmp is tmpfs

`packages/server/test/lib/scratchSpace.test.ts` → "uses the configured
directory and creates it" builds its `YEP_SCRATCH_DIR` with `mkdtempSync` under
`os.tmpdir()`, then asserts `reserveScratchSpace` chose that directory.

`packages/server/src/lib/filesystemKind.ts:42` classifies tmpfs as the `memory`
category, and scratch selection declines a memory-backed directory — correctly,
since the point of the scratch space is to escape a slow or unsafe data
directory onto real local disk, not into RAM. So on a host whose `/tmp` is
tmpfs the reservation lands elsewhere and the `startsWith` assertion fails,
with no defect in either module.

Observed 2026-09-14 on a host with `tmpfs 63G /tmp`; the same suite passed on
2026-09-13 on a host with a disk-backed `/tmp`. Nothing in the repository
changed between those runs for this path.

The fix belongs in the test: reserve the fixture directory somewhere
disk-backed (a path under the repository's own working tree, or a temp
directory whose filesystem the test checks with the same `filesystemKind`
helper the code uses), or assert the contract that actually holds on any
filesystem — that the chosen directory exists and is not degraded — rather than
that a memory-backed candidate was honored.

Found 2026-09-14 while running the server suite for an unrelated sidebar
chronology change.
