# Fork copies the conversation but not the working tree

[Fork and Clone](../../topics/fork-from-turn.md) create a cold session from a
completed user turn's transcript prefix. Both the parent and the fork then
edit the same project checkout. A fork taken to try a different approach
therefore starts from whatever dirty state the parent has reached *now*, not
from the state the forked turn saw, and two live sessions racing on one
working tree is exactly the collision [session ownership](../../topics/session-ownership.md)
warns about for transcripts.

Zed's DeltaDB advertises that "any point in history is a valid branch point,
including mid-run" because its worktree is virtual
([analysis](../../docs/competitive/deltadb.md)). YA's real-checkout stance
([workstreams](../../topics/workstreams.md) lanes are ordinary clones) can
offer the completed-turn version of the same thing without a virtual
worktree.

## Desired behavior

- **Fork with checkout.** The fork/clone action gains an opt-in "into a new
  workstream lane" choice. YA creates the lane clone at the parent
  checkout's `HEAD`, then applies the parent's current uncommitted diff
  (tracked changes and untracked files, respecting ignores) so the fork's
  tree matches what the forked session is working on. The forked session
  launches with the lane as its cwd.
- **Checkpoint at the turn, when available.** If
  [turn-anchored edit provenance](turn-anchored-edit-provenance.md) exists,
  the fork may instead reconstruct the tree as of the forked turn by
  reversing later turns' retained hunks, and must say when it could not.
  Without it, "current dirty state" is the honest checkpoint and is labeled
  as such in the fork's first context.
- **No YA refs, no silent Git mutation.** The dirty diff travels as an
  app-data patch and is applied in the lane; no stash, commit, ref, or
  exclude is written in the canonical checkout
  ([project directory storage](../../topics/project-directory-storage.md)).
  A patch that fails to apply cleanly aborts the fork with the conflict
  listed, leaving both checkouts untouched.
- **Fresh context facts.** The fork receives the lane path, the source
  checkout path, `HEAD`, and the checkpoint kind through the existing
  [task-transition fresh-state](../../topics/agent-context-injection.md#task-transitions-and-fresh-state)
  path, so it does not keep editing the parent's path from stale context.

## Not yet decided

Whether the lane inherits the parent's branch or gets a named fork branch;
how a fork lane lands back through the workstreams landing flow; what happens
to the lane when the fork session is deleted; and whether the same action
should exist for Clone. Workstreams themselves are still a proposal, so this
sketch depends on their MVP rather than defining lanes on its own.

Found 2026-09-15 while comparing YA fork with DeltaDB mid-run branching.
Contributing-model: fable-5.1
