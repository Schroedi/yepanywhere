# Clair: session awareness across shared and isolated checkouts

Status: sketch; investigation recorded, implementation not authorized.

## Aim

Explore [Clair](https://github.com/JBJamesBrownJB/clair)'s Git-backed awareness
model as a possible successor to the personal `agentctl active` registry and
as an early coordination layer for long-running work in separate checkouts.
Preserve the shared-worktree preference: isolation is useful only if agents
can notice incompatible plans before integration, and reliably bring finished
work home. Lower spurious interference matters as much as detecting overlap.

The primary local project checkout could serve as a rendezvous for sibling
checkouts; a GitHub remote is an optional later transport. YA would own
provider-neutral integration rather than require Claude hooks. This proposal
does not change workstream defaults or promote the workstreams experiment.

Team-built repositories are an explicit target, not just a future extension of
one person's parallel agents. The user also identifies multiple YA servers,
multiple human users on one YA server, and multiple users across separate YA
servers working on the same project. Reusing their Git remote could supply a
common awareness channel without deploying another coordination service.
Transport efficiency remains a hypothesis to measure, but this distributed
reach is a distinct reason to consider Git even if local registry replacement
proves unnecessary.

## Source checkpoint

Inspected Clair default-branch revision
[`f97df841f749cd26a2cec7111189886dae8815a8`](https://github.com/JBJamesBrownJB/clair/tree/f97df841f749cd26a2cec7111189886dae8815a8)
on 2026-09-26. This is a source/doc inspection, not a runtime evaluation.

- Current [`plugin/README.md`](https://github.com/JBJamesBrownJB/clair/blob/f97df841f749cd26a2cec7111189886dae8815a8/plugin/README.md)
  explicitly says no commands, hooks, or MCP server are wired. The CLI prints
  a skeleton greeting; `clair-core` contains a placeholder test. It is not
  currently an integration-ready Claude plugin.
- The [archive notice](https://github.com/JBJamesBrownJB/clair/blob/f97df841f749cd26a2cec7111189886dae8815a8/docs/archive/README.md)
  identifies the old same-branch pairing implementation and its hook/MCP
  architecture as pre-reset provenance. Archived diagrams labelled SHIPPED
  do not describe the current tree. Historical code was not evaluated here.
- The current [data-model draft](https://github.com/JBJamesBrownJB/clair/blob/f97df841f749cd26a2cec7111189886dae8815a8/docs/architecture/data-model.md)
  proposes a latest-presence register per session plus expiring decision,
  incident, and finding events. Cheap headlines/path facets precede details.
  Branch and worktree are attributes, not session identity.
- Linked Git worktrees share the proposed shadow ref namespace. Independent
  clones require explicit exchange. The draft leaves transport/ref layout,
  pruning ownership, and shared-checkout per-session cursors unresolved.
- Collision detection is proposed as a consumer-derived view over presence
  and committed/pushed diffs. It is not a pre-write exclusion mechanism, and
  it cannot by itself attribute shared dirty-tree changes to their writers.

The originating [interview](https://www.youtube.com/watch?v=JCPrxKse4YQ) is
human context only; neither video nor transcript was retrieved.

## Assessment of replacing the registry

The useful idea is selective, session-aware disclosure of relevant work.
Git transport is a separate choice. No measurement currently supports replacing
local text records with Git objects/refs for efficiency.

| Concern | Local registry today | What the Clair direction adds or leaves open |
| --- | --- | --- |
| Presence | Session gist, scope, freshness, completion | Automatic activity and relevance filtering could reduce manual updates and context reading. |
| Edit coordination | Advisory per-path claims and project-wide solitude checks | An awareness event does not preserve claim clearance or rewrite exclusion semantics. |
| Separate checkouts | Registry is rooted in the working project directory | A repository-wide rendezvous can connect isolated work without sharing dirty files. |
| Transport cost | Local file reads/writes and scans | Git adds object/ref operations; remote exchange adds latency and credentials. Costs need measurement. |
| Lower interference | Broad scopes can block unrelated edits | Distinguishing intent, observed edits, and concrete overlap may reduce noise regardless of storage. |

The personal `agents/topics/agentctl.md` contract defines claims as advisory,
with an observe-then-claim race; it does not promise a mutex. A replacement
must nevertheless account for its existing DONE/staleness, exact/covering
claims, waiting notices, and REWRITE behavior. Replacing only active records
must not accidentally remove unrelated run management or steward state.

For shared-worktree use, a common Git diff cannot identify who changed what.
Presence should retain explicit planned scope and observed successful edits
per session. Narrow claims still protect immediate writes; asynchronous
merge-risk notices are insufficient. Hunk disjointness also does not prove
semantic independence: different files can implement conflicting contracts.

## YA baseline and existing owners

Inspected YA at `3eadaebd079947dafd9a51cb2e0b257179414c22`.

- [Workstreams](../../topics/workstreams.md) and
  [tactical 054](../../docs/tactical/054-workstreams.md) already own parallel
  topic work. A lane is an ordinary local clone, with a canonical main
  checkout. Multiple clones may all be on `main`, so branch name alone
  cannot identify a lane or an agent.
- Current `WorkstreamsPage.tsx` (`WorkstreamsTable`/`WorkstreamsRow`) renders
  lane, kind, branch, queue pause state, status, and path; session counts are
  placeholders. `routes/workstreams.ts` exposes gated listing, checkout
  preview, and creation; `WorkstreamService` creates ordinary local clones.
  This is a partial lane view, not a live cross-branch conflict/landing graph.
  Lane queue targeting, scheduling, sync, and landing remain pending in the
  tactical. Metadata rendered in a row is not proof of a fresh Git observation.
- [Source Control](../../topics/source-control.md) already owns status,
  commit/file/diff/blame navigation and relevant-session links. Its
  **Dirty-file last editor** section and `DirtyFileEditorService` provide a
  provider-neutral seam: successful structured mutations can be attributed
  to canonical YA session ids. The retained record is only the last observed
  editor, not an edit history, intent record, or complete coverage of shell
  writes and external tools.
- [Fork with checkout](fork-with-worktree-checkpoint.md) preserves the
  maintainer concern about stranded work and faulty land-back. Awareness
  could help before divergence, but does not resolve that failure class.
- [Session worktree file links](../session-worktree-file-links.md) records
  viewer source-identity problems. Any eventual awareness link must open the
  exact checkout's file, not the same relative path in main.

This extends the existing workstreams direction rather than opening a second
lane-management implementation. It remains a later candidate under the
[roadmap](../../docs/roadmap/README.md#later-directions).

## Candidate design to test

The topology should support four cases without conflating them:

| Participants | Candidate rendezvous | Additional requirement |
| --- | --- | --- |
| One human, one YA server | Local app-data aggregation; optional project refs | Shared-checkout claims and separate session views. |
| One human, several YA servers | Explicit local/remote Git awareness exchange | Source-qualified session identity, offline freshness, deduplication. |
| Several humans, one YA server | One local coordination owner | Named principals and project-scoped visibility/action permissions. |
| Several humans, several YA servers | Existing team Git remote | Cross-server identity, explicit publication audience, bounded eventual delivery. |

Follow [Working Across Machines](../../topics/multi-machine-architecture.md)
and [Principals and grants](../../topics/principals-and-grants.md) for ownership
and authorization. Git access transports awareness; it does not establish a
YA user identity or authorize session steering. Clair's self-asserted display
identity is insufficient for that. Current YA operator access is not already
a multi-user project-membership system. Keep the awareness feature independent
of granting remote control, so a team can benefit before delegation exists.

1. **One identity model, separate coordination meanings.** Key records by
   repository identity, source/server, checkout, and canonical session id;
   retain the human principal separately. Attach
   branch/HEAD, declared intent, observed paths, freshness, and provenance.
   Keep presence, explicit edit claims, and inferred risk distinct. A stale
   observation means unknown, not safe; an idle session can still own
   unfinished branch work.
2. **YA as the common integration boundary.** Reuse session lifecycle and
   successful normalized edit observations, with explicit intent updates for
   planned changes. Provide a CLI/adapter path for sessions outside YA before
   claiming replacement coverage. Capability gaps remain visible; a provider
   that cannot receive a notice mid-turn must not be presented as notified.
   Do not infer full intent or authorship from dirty-file state.
3. **Local awareness first.** Compare app-data-backed YA state plus an
   `agentctl` compatibility view against Git-backed storage. Keep the current
   registry operational during an opt-in comparison. The local canonical
   project is the logical rendezvous; this does not require storing its state
   inside that project's Git directory.
4. **Optional Git transport.** If justified, isolate writers by session and
   use ref updates with expected-old values, bounded retries, expiry and
   deletion rules. Create orphan object histories through Git plumbing with
   an isolated index; never switch the user's checkout or reuse its index.
   Orphan means no ancestry to source history, not an empty message tree.
   Linked worktrees can see shared refs locally; lane clones need deliberate
   local exchange, even when their immutable object files began hardlinked.
   Do not push application branches merely to exchange awareness.
5. **Escalate useful evidence.** Start with path/intent overlap notices; use
   common-base-aware committed diffs for stronger merge-risk evidence. Separate
   these from dirty-edit warnings. Coalesce unchanged notices, bound retained
   detail, and avoid a receive/rebroadcast loop. Capture whether a notice
   changed a plan, caused coordination, or was dismissed as irrelevant.

Any Git-backed variant must obey
[project directory storage](../../topics/project-directory-storage.md): YA
may not silently create project-local refs/objects in App data only mode.
Project-local coordination and remote publication are distinct opt-ins.
Remote access exposes the chosen payload to that remote's readers; TTL is
reader expiry, not guaranteed erasure of Git objects. Peer-supplied intent is
attributed data, never executable instructions or authority to grant claims.

## Small discriminating evaluation before adoption

Use isolated fixtures, with runtime/profiling procedures selected before
benchmarking. Compare the existing registry, local YA aggregation, and an
orphan-ref prototype only if the first comparison leaves a transport need.

- Two sessions in one dirty checkout: distinct identity and intent, correct
  edit attribution where observable, independent read cursors, unchanged
  claim behavior, no lost status updates or index/HEAD mutation.
- Two linked worktrees and two ordinary lane clones: notice overlapping
  plans before merge, distinguish same branch names across clones, and show
  which inputs are unavailable or stale. Include renames and different bases.
- Concurrent writers, crash/restart, expired presence, idle unfinished work,
  and unavailable transport: no false clearance or unbounded polling/retries.
- Multiple servers/users: duplicate session labels, disconnected peers,
  delayed or reordered exchange, remote access revocation, and participants
  with different project permissions. Presence must not imply permission to
  read another user's transcript or steer their session.
- Disjoint hunks in one file, conflicting interfaces in different files,
  and deliberate shared work: measure both missed warnings and nuisance
  interruptions, not just detection of same-file edits.
- Measure subprocess count, local write/read work, ref/object growth, delivery
  latency, context tokens, time blocked unnecessarily, and actual plan changes.
  Lower operational cost and better coordination are separate outcomes.

Adopt a replacement only after demonstrating preserved local coordination and
useful cross-checkout awareness. If the awareness model helps while the Git bus
does not, retain the model with local storage. Reliable supervised landing is
still a separate workstreams prerequisite.

Opened 2026-09-26 from the user-requested Clair investigation.
Scope expanded by user direction on 2026-09-26 to team repositories and
multiple YA servers/human users, including same-server collaboration.
Contributing-model: gpt-6-astra
