# Jujutsu awareness in Source Control and parallel sessions

Status: researched sketch; implementation and repository conversion are not
authorized. Preserve ordinary Git defaults and existing workstream decisions.

## Question and initial disposition

If a user already uses Jujutsu (`jj`) locally with ordinary Git remotes,
what must YA understand? Start by testing whether existing Git inspection is
sufficient in a colocated workspace. Do not build a second source-control
client merely because jj exists. Full semantic equivalence is unlikely:
current YA assumes Git branches, an index, and HEAD-based history.

Research checkpoint: 2026-09-26. Evidence is upstream documentation, live
GitHub metadata, and YA source inspection at
`abe07cde97cf2d84faf3284246f2cabe82ea0e26`. No jj executable was found on this
host; no jj/YA integration or concurrency experiment was run. Linked `latest`
documentation is moving and must be rechecked against an explicitly selected
version before implementation.

## Mental model: a revisable change, a bookmark, and a workspace

The user's “amended to final” intuition fits a **change**: a draft with a
stable change ID and successive immutable commit hashes as it is rewritten.
It is not itself a Git branch. A **bookmark** is a named pointer that maps to
a Git branch on push; there is no currently checked-out bookmark. One can
prepare a single change or a stack before publishing.
[Bookmarks](https://docs.jj-vcs.dev/latest/bookmarks/).

For example, edit a file in working-copy change `@`, then run `jj status`.
The snapshot replaces that change's current commit revision; more edits and
another snapshot produce another hash for the same change. `jj new` starts
another change. The evolution history retains previous revisions separately
from the parent/child commit graph. “Snapshotted” therefore says nothing about
review readiness, completion, or publication.
[FAQ: automatic saves](https://docs.jj-vcs.dev/latest/faq/#jj-is-said-to-record-the-working-copy-after-jj-log-and-every-other-command-where-can-i-see-these-automatic-saves).

A **workspace** contains actual files plus `.jj` metadata. Each workspace has
its own working-copy commit. Most commands snapshot eligible file edits;
new non-ignored files are tracked by default. This is command-time recording,
not continuous capture of every write. Separate workspaces may share one
repository; rewriting another workspace's checked-out commit can leave that
workspace stale. [Working copy](https://docs.jj-vcs.dev/latest/working-copy/).

## Where normal Git compatibility is enough, and where it is not

Upstreams can remain ordinary Git servers, including SSH remotes; collaborators
need not use jj. Colocated mode places `.git` beside `.jj`, shares filesystem
contents, and automatically imports/exports Git state during jj commands.
Git HEAD normally points at the working-copy commit's parent and is detached.
Non-colocated mode keeps its backing Git repository under `.jj`, outside
ordinary work-directory Git discovery. Git tools do not faithfully represent
jj's stored conflicts; the Git index is not jj's staging model. Native jj
workspaces are also distinct from Git linked worktrees.
[Git compatibility](https://docs.jj-vcs.dev/latest/git-compatibility/).

Consequently, a Git diff remaining dirty after a jj snapshot can be correct:
it still compares the files with the draft's parent. Conversely, a clean Git
working tree is not proof that all jj changes are published or finished.
These are different questions that a jj-aware view would need to label.

YA findings, rather than a runtime compatibility claim:

| Current owner | Verified assumption | Implication to test |
| --- | --- | --- |
| `packages/server/src/routes/git-status.ts`, `getGitStatus` | Runs Git porcelain-v2 status, staged/unstaged numstats, and `git log`; detached HEAD becomes `branch: null`. | Basic colocated changes may display correctly, but this is a Git projection, not jj change/bookmark history. |
| Same file, pull/push routes | Pull runs `git pull --ff-only`; push requires an upstream or a current branch to publish to origin. | A normal jj detached HEAD does not supply the branch the controls expect. Do not infer a publish target from an arbitrary bookmark. |
| `packages/server/src/git/gitExec.ts`, `runGit` | All calls disable optional Git locks. | Passive jj observation must preserve the existing no-incidental-mutation boundary. |
| `packages/server/src/projects/projectWorktreeSubscriptionManager.ts`, Git metadata discovery | Resolves Git administrative/common directories and HEAD refs. | It does not establish freshness of jj-only change/bookmark state. Audit `.jj` exclusions and invalidation before adding awareness. |

The existing [Source Control contract](../../topics/source-control.md#product-boundary)
owns inspection, narrow explicit mutations, and passive-read behavior.
The smallest candidate is detection plus an honest compatibility indication
and clearly unavailable operations where needed, retaining proven Git reads.
Non-colocated repositories require an explicit support decision; never silently
convert them or aim Git commands into jj's private backing store.

## Shared files versus separate workspaces

Jj's operation log records repository views and reconciles concurrent
repository operations. That is useful recovery infrastructure. It does not
make two agents' ordinary filesystem writes transactional or give each agent
an independent copy of a shared file. Upstream also qualifies its distributed
filesystem/concurrency claims, especially for colocated repositories.
[Concurrency](https://docs.jj-vcs.dev/latest/technical/concurrency/).

Concrete shared-directory case: agent A edits `a.ts`, B edits `b.ts`, and A
runs `jj status`. Both eligible edits can enter the same working-copy change.
The snapshot identifies captured content, not which session owns each edit.
If B overwrites A's bytes before a snapshot, the operation log cannot be assumed
to contain the overwritten version. A subsequent checkout-changing operation
also affects both agents. Existing coordination remains necessary.

Separate jj workspaces plausibly fit independent agents better: each gets
its own files and working-copy change while sharing repository history.
This is a hypothesis, not evidence of better total throughput than Git clones
or coordinated shared-directory work. Shared bookmarks, cross-workspace
rewrites, stale workspaces, conflicting plans, and integration still need an
owner. A global undo/restore must not casually undo a peer's operation.

[Clair](clair.md) supplies the complementary awareness question: communicate
intent and overlap before independent work diverges. Jj supplies versioned
changes and workspace mechanics, not Clair's session identity or intent bus.
If Clair uses Git refs, verify how those refs interact with jj import/export;
do not assume its linked-Git-worktree transport applies unchanged.

[Workstreams](../../topics/workstreams.md) currently chooses ordinary lane
clones. This sketch does not replace that choice or change the shared-worktree
preference. A future jj workspace option must satisfy the same supervised
landing concerns in [Fork with checkout](fork-with-worktree-checkpoint.md)
and exact-source viewing in [Session worktree file links](../session-worktree-file-links.md).

## Passive observation is a design constraint

Do not replace a Git status poll with plain `jj status`: it can write a
snapshot. `--ignore-working-copy` avoids snapshotting and updating files but
observes possibly stale recorded contents. It is not a blanket no-mutation
flag: divergent operations can still be reconciled. The CLI documents
`--at-op=@ --ignore-working-copy` for non-mutating operation-log inspection.
Verify the precise read-command set, including ambiguous operation heads,
before relying on this for YA; show unresolved state rather than repairing it
as a side effect of opening a page.
[CLI reference](https://docs.jj-vcs.dev/latest/cli-reference/).

Distinguish live filesystem differences, last recorded working-copy revision,
and publication state. Review anchors need immutable commit/blob identities;
a stable change ID alone can resolve to newer content after a rewrite.
No automatic snapshot, workspace creation, ref write, or repository conversion
is licensed by detection. Existing
[project storage policy](../../topics/project-directory-storage.md) remains
the boundary for any eventual project-local writes.

## Adoption and prospects

This is an active, substantial project, not an abandoned prototype. Live
[GitHub repository metadata](https://api.github.com/repos/jj-vcs/jj) on
2026-09-26 reported 31,759 stars, 1,234 forks, and a push that day. The latest
release endpoint returned
[v0.45.1](https://github.com/jj-vcs/jj/releases/tag/v0.45.1), published
2026-09-03. These measure interest/activity, not installed users or market share.

Martin von Zweigbergk's [project disclaimer](https://github.com/jj-vcs/jj#mandatory-google-disclaimer)
describes jj growing from his hobby project into full-time work at Google,
with other Googlers contributing; it expressly is not a supported Google
product. The [upstream roadmap](https://docs.jj-vcs.dev/v0.45.0/roadmap/)
describes Google's internal database-backed server and plans for broader
RPC/UI integration. This demonstrates organizational investment and internal
infrastructure, not that all Google developers use jj.

Assessment: promising enough to justify compatibility fixtures when a YA user
needs them. Git interoperability lowers adoption cost because a team need not
migrate its forge together. The counterweight is integration maturity:
upstream documents gaps for Git hooks, attributes, submodules and LFS, while
its roadmap still contains forge and UI/API work. Check the selected release
and actual workflow rather than projecting those gaps indefinitely.
No representative adoption survey, YA-user demand count, or controlled
multi-agent advantage was established in this investigation. Popularity alone
does not justify a jj-native UI or a change in isolation defaults.

## Small evaluation before choosing implementation

In disposable repositories, pin jj and Git versions and exercise YA's real
status/diff/history/mutation paths:

1. Compare plain Git, colocated jj, non-colocated jj, and an additional native
   jj workspace. Include nested cwd discovery, no bookmark, multiple bookmarks,
   merge parents, conflicts, new files, and staged Git leftovers.
2. Check Git projection before/after a jj snapshot and `jj new`; prove what
   YA means by dirty, clean, current revision, upstream, ahead, and behind.
   Exercise SSH fetch/publish against a test remote with explicit targets.
3. Record files, index, refs, jj operation heads and working-copy metadata
   before/after repeated passive YA reads. They must not snapshot, reconcile,
   move refs, rewrite files, or flood metadata watchers. Test divergent
   operation heads, not just a linear quiet repository.
4. Run two sessions sharing files, then two with separate workspaces. Include
   disjoint edits, same-file collisions, unsnapshotted edits, a peer rewrite,
   restart/recovery, and supervised landing with both contributions verified.
   Compare coordination and total integration effort, not just snapshot ease.
5. Keep the no-change outcome available: if Git inspection meets the intended
   workflow, document its tested limits. Add detection/guardrails only for
   demonstrated mismatches; require a concrete unmet workflow before a native
   jj status/history adapter or workstream backend.

Opened 2026-09-26 from the user-requested jj compatibility, adoption, and
multi-session investigation, including the draft-commit/branch clarification.
Contributing-model: gpt-6-astra
