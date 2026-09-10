# A 256 MB random-access vocabulary file can land on a network filesystem with nothing said

`VocabularyStore` keeps its "already seen" set in `speech-seen.bloom`, a
paged blocked-bloom file that `BloomFile` opens `r+` and rewrites dirty chunks
of in place (`packages/server/src/services/voice/blocked-bloom.ts:207`). It
defaults to 256 MB (`VocabularyStore.ts:76`) and is 256 MB on the maintainer's
host. Access is random by construction: a bloom lookup touches one block at a
hashed offset, and a write is a read-modify-write of that block.

That file takes no locks, so the startup refusal added for
`discovery.sqlite` ([optional SQLite](../topics/optional-sqlite.md) § Data
directory placement) never considers it. Being lock-free does not make it
cheap on a share; a quarter-gigabyte file written a block at a time over NFS is
its own kind of unusable.

Normally it is fine, because `reserveScratchSpace` puts it on local disk and
already rejects network filesystems for that purpose. The problem is the last
resort. When no candidate qualifies — no usable cache home, no writable
temporary directory, a container without either mount — the reservation falls
back to `join(dataDir, purpose)` (`packages/server/src/lib/scratchSpace.ts`),
which is exactly the network directory the SQLite check refuses to open a
database on. The bloom file and the vocabulary database both land there.

The diagnosis already exists and goes nowhere. `reserveScratchSpace` returns
`degraded: true` and a `reason` that names the filesystem, and `VocabularyStore`
puts that string in one log line (`VocabularyStore.ts:443`). No client sees it.
The banner added for the data directory keys on `sqlite.networkFilesystem`,
which describes a different directory and stays absent here.

## One banner, one signal, a varying reason

The maintainer has settled the shape: not a second status field and not a second
banner. There is one placement signal that carries a reason text, and the banner
behaves identically whichever condition raised it — startup finding the data
directory on a share with SQLite enabled, or vocabulary learning enabled with
its scratch reservation degraded onto that same directory. Only the reason
differs. A user with a network home directory would otherwise be told two things
at once and given two instructions for one action.

That matters because the banner is the entry point for offering to move the data
directory ([the migration gap](network-filesystem-banner-offers-no-migration.md)),
and a move must happen with no live handles into the directory, or the flow has
to close and reopen them. The two conditions do not arrive equal on that point:

- **The SQLite path arrives clean.** The refusal means no database was ever
  opened, so there is no handle to close.
- **The vocabulary path arrives with the worst handles open.** If learning is
  enabled and the reservation degraded, the 256 MB bloom file is open `r+` and
  the vocabulary database is open alongside it, both in the directory the user
  is about to be offered a move of.

So the cleanest way to hold the constraint is to make the vocabulary path behave
like the SQLite one: when the reservation degrades onto a network filesystem,
decline to open its files and raise the signal, rather than opening them and
warning afterwards. That keeps "banner showing" and "nothing open in the data
directory" the same state, and leaves the migration with nothing to close. The
alternative is a real close-and-reopen sequence around the move, which is more
machinery for a case the refusal makes impossible.

Found 2026-09-10, raised by the maintainer while reviewing the data-directory
filesystem check: the lock-free half of speech vocabulary deserves the same
warning as the locked half.
