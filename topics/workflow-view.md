# Workflow view

> Proposal: Workflow view groups a workflow's declared parts, progress, outcomes,
> and associated activities under a shared workflow ID, initially as a
> collapsible outline within one agent turn with no workflow input from the user.

Status: Proposal, 2026-09-07; not implemented or scheduled. The first version
is a display-only, single-turn span. Harness awareness of the workflow ID is
desirable; the calling session knowing and emitting the ID is sufficient.

## Purpose and scope

A multistep skill can describe both how the agent should work and how its work
should be presented. For example, a review can expose an outline whose entries
collect progress, findings, and links to the relevant searches and checks:

```text
Review changes                                      in progress
  Inspect affected paths                            completed
    Outcome: two call sites need checking
  Check behavior                                    in progress
    Exercise normal inputs                          completed
    Exercise cancellation                           in progress
  Report findings                                   pending
```

Collapsing a branch or focusing on cancellation reveals the associated
activities without losing the overall outline. These are viewing operations.
Version one has no answer fields, approvals, editable checkboxes, or controls
that instruct the agent to skip, retry, or reorder work. It does not extend the
workflow into another turn. A later version may do both.

The workflow is a shared rendering context across several harness activities.
Its **schema** defines the permitted structure and meanings; a **declaration**
supplies the particular parts, labels, and initial state. A formal skill or
ordinary instructions can supply both, including when to emit updates. Merely
providing a JSON Schema does not identify the actual work or report progress.

An **artifact** is an output of the work: a report, chart, comparison, or other
content with an appropriate viewer. A workflow part can link to artifacts and
transcript activities. The workflow structure does not prescribe a new general
rich-output format. Existing Markdown, media, file, and tool renderers remain
useful independently of workflow grouping.

## Published precedents

Sources checked 2026-09-07. This is a bounded review of documented contracts and
local YA integration points, not a runtime compatibility test. Product help,
provider event schemas, and interoperability protocols have different scope.

| Surface and source | Documented contract | What informs this proposal |
| --- | --- | --- |
| [Claude chat/Desktop artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) — product documentation | A dedicated artifact view alongside conversation, multiple artifacts, revision selection, source inspection, and download. | A work product can have identity and a viewing context separate from individual chat messages. The reviewed help does not specify a reusable workflow hierarchy or activity-association schema. |
| [Claude Code artifacts](https://code.claude.com/docs/en/artifacts) — tool behavior documentation | The `Artifact` tool publishes an HTML or Markdown file; changing the file and republishing updates the artifact at the same URL. A later session can attach an existing artifact. | A terminal-driven session can maintain a browser-viewable analysis result. This documents artifact publication and continuity, not a general workflow event format. |
| [Cowork artifacts](https://support.claude.com/en/articles/14729249-use-artifacts-in-claude-cowork) — product documentation | The account-backed system introduced August 19, 2026 supports versioned artifacts; existing links can be used to update them from another session. Earlier live artifacts have separate legacy behavior. | Artifact lifetime can exceed a turn or session. Keep that lifetime separate from the initial single-turn workflow span. |
| [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) — provider schemas | Planning tools expose task IDs, status, descriptions, and dependency updates (`addBlocks` / `addBlockedBy`). Runtime task-start/progress messages separately carry `task_id` and optional `tool_use_id`; forwarded subagent messages can identify a parent tool call. | Task identity, dependency, and execution correlation are useful ingredients. Planning task IDs and runtime task IDs belong to distinct contracts; neither alone supplies the proposed rendering context. |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) — provider protocol | `turn/plan/updated` contains thread and turn IDs, optional explanation, and entries with `step` and `status`. Tool activities have item lifecycle IDs. The separate `plan` item carries plan text. | YA can associate a checklist with a turn. The checked checklist schema has no stable per-step ID, hierarchy, or explicit step-to-tool association. |
| [Agent Client Protocol (ACP) plans](https://agentclientprotocol.com/protocol/v1/agent-plan) and [tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls) — protocol specifications | Plan notifications carry complete replacement entry lists with content, priority, and status. Tool calls have stable session-local `toolCallId` values and incremental updates. | Full snapshots are a simple baseline. The plan entry contract does not require stable node IDs or nesting; tool-call identity provides a separate possible association target. |
| [Agent User Interaction Protocol (AG-UI) events](https://docs.ag-ui.com/concepts/events) — protocol documentation | Run/step lifecycle events coexist with `ActivitySnapshot` and `ActivityDelta`. An activity has a `messageId`, an activity-type discriminator, and structured content; deltas use JSON Patch. | Closest structural precedent in this review: an identified activity view can evolve between chat messages. The domain-specific workflow hierarchy still needs a payload contract. |
| [Model Context Protocol (MCP) Apps](https://modelcontextprotocol.io/extensions/apps/overview) — extension overview | Hosts such as Claude Desktop can render tool-provided HTML interfaces in sandboxed frames and mediate communication with tools. | Relevant to an artifact's viewer and eventual interaction. Adopting an app container would not by itself define workflow membership, outline state, or transcript grouping. |

Claude's [task-tool availability](https://code.claude.com/docs/en/tools-reference#task-tool-availability)
varies with model, context, and configuration. A skill cannot assume a native
task tool is always present. This also separates a documented capability from
the capabilities available in a particular running session.

The resulting design inference is to borrow identified activity state and
snapshot semantics while keeping the transport replaceable. None of the
reviewed contracts supplies the entire skill declaration, nested progress,
artifact association, and transcript projection described here. That is a
finding about this source set, not a claim that no such system exists.

## Session-first production

The baseline producer is the calling agent session. Instructions teach it to
choose a workflow ID, emit the declaration, and report meaningful changes
under that ID. YA recognizes a versioned structured block in the session's
output and binds it to the observed session, turn, and source message. Ordinary
unbuffered stdout from an invoked tool is another possible carrier when that
tool is explicitly designated as a workflow producer.

No new callback broker, MCP server, or persistent process is required for this
display contract. A CLI can query a daemon or attach to an existing interaction
and emit the same data. Selecting a carrier should follow what the harness
preserves and the model produces reliably. This proposal does not add a CLI or
choose the final marker syntax.

Native harness metadata can later carry the same logical records and improve
association with tool calls. Keep that as an adapter capability. The agent
does not need to know provider-assigned message or tool IDs to show an outline.

YA supplies identity boundaries: for v1, the effective key is the canonical YA
session ID, observed turn identity, and producer's workflow ID. Provider IDs
remain namespaced references. An identical workflow ID in another turn does
not implicitly continue this instance. Markers carry display data and do not
become user messages, approval, or authority over another session.

## Candidate declaration and updates

The following is an illustrative complete snapshot, not a released schema or
an invocation recipe. It shows the information that a skill and YA would share:

```json
{
  "format": "workflow-view/1",
  "workflowId": "review-7",
  "schemaId": "review/1",
  "revision": 2,
  "title": "Review changes",
  "status": "in_progress",
  "parts": [
    {
      "id": "inspect",
      "label": "Inspect affected paths",
      "status": "completed",
      "outcome": "Two call sites need checking"
    },
    {
      "id": "check",
      "label": "Check behavior",
      "status": "in_progress"
    },
    {
      "id": "cancel",
      "parentId": "check",
      "label": "Exercise cancellation",
      "status": "in_progress"
    },
    {
      "id": "report",
      "label": "Report findings",
      "status": "pending"
    }
  ]
}
```

The format version defines the common envelope. The schema identity describes
the workflow kind and any domain-specific outcome fields. Every snapshot
contains enough labels, hierarchy, and generic status to render the outline
without fetching that schema from an arbitrary URL or scanning project files.
A skill can include a declaration alongside its instructions, and a tool can
document the same contract through its normal self-description.

Stable part IDs preserve expansion and focus across revisions. Parent links
form an acyclic outline, and array order supplies sibling order. Dependency
edges are a separate future concern: something can depend on another part
without belonging beneath it. An initial status vocabulary could be pending,
in progress, completed, failed, blocked, and skipped. Outcomes explain what was
learned; completion of a review can include findings that identify defects.

Start with complete replacement snapshots at useful boundaries: declaration,
change of active part, material result, and conclusion. A producer need not
emit updates for every tool output or incur an extra model round for each
marker. Incremental patches can wait until an observed size or update pattern
justifies their replay and resynchronization complexity.

## Activity and artifact association

An outline is useful with no fine-grained activity mapping. Activities can stay
in their ordinary turn view while the outline reports part states and outcomes.
Where supported, a part may additionally carry explicit references to observed
messages, tool calls, or artifacts. A producer-chosen activity key is useful
only if it also appears on the relevant activity in a carrier YA can observe;
an invented provider tool ID is not a substitute.

Do not infer a unique part assignment just because a tool call follows a
marker. Concurrent work and several active parts make that ambiguous. A known
span can group activities at workflow level while leaving their part
association unknown. Explicit associations can be many-to-many: one check may
support two parts. Unknown references remain unresolved and inspectable.

Artifact references identify outputs and, when the underlying artifact system
supports them, particular revisions. A mutable URL alone cannot reproduce an
earlier version; the UI should not present it as frozen historical evidence.
Inline rich content uses the existing approved renderer for that content type.
The workflow envelope itself contains data, with no executable renderer code.

## Projection, replay, and lifecycle

The workflow outline is a projection over the conversation. Canonical messages,
chronological order, tool results, and anchors remain intact. Grouping should
compose with [conversation view](conversation-view.md), retain access to the
original transcript, and leave unassociated activities visible. A user can
inspect the source update that caused a displayed state.

The first recognized declaration opens the span inside the observed turn. An
explicit terminal snapshot closes it. Ending or canceling the turn without
such a snapshot leaves the workflow incomplete or interrupted; it does not
mark pending parts completed. A completed command does not prove completion
of its containing part. A tool error does not by itself fail the entire
workflow. The displayed part result is the producer's report, with linked
evidence available for inspection.

Replaying the same source records should yield the same outline as live
updates. Deduplicate by source identity, accept complete validated revisions,
and retain the last accepted state when an update is incomplete or malformed.
Conflicting duplicate revisions remain inspectable rather than silently
overwriting state. A tail load needs the latest complete snapshot at its
boundary; it must not require an off-window declaration to recover labels.

Parse only designated structured output envelopes, including explicitly
selected producer results. Quoted examples, file contents, logs, and arbitrary
nested JSON are not independent declarations. Unknown envelope versions or
invalid hierarchy retain their ordinary readable output. A known generic
envelope with an unknown domain schema can still show its basic outline.

## Existing YA footholds and boundaries

YA already reconstructs task state across Claude tool events:
`createTaskListAugmenter` and `projectTaskListSnapshots` in
`packages/server/src/augments/task-list-augments.ts` produce `_taskSnapshot`;
the session route projects before slicing history, and the stream augmenter
uses the same fold. `TaskListRenderer.tsx` renders snapshots through registered
`TaskCreate` and `TaskUpdate` renderers. See
[task-list rendering](task-list-rendering.md). This verifies an existing state
reconstruction pattern, not support for the workflow envelope above.

Keep normalization and grouping at the shared transcript/render boundary,
following [UI architecture](ui-architecture.md). The implementation location
should follow live/reload parity and history-slicing requirements; a public
portable transcript protocol is not a prerequisite. A novel workflow view
would be configurable and initially default-off under
[vanilla defaults](vanilla-defaults.md).

[Interactives](interactives.md) concerns richer app hosting and isolation;
[rich interviews](rich-interviews.md) banks structured user-input workflows.
Both are separate proposals. This topic neither activates them nor makes
their implementation necessary for an outline of agent work.

## What a first implementation would need to demonstrate

These are proposed acceptance cases, not tests already run:

- One skill-led turn containing several agent messages and tool calls produces
  a coherent nested outline using only session-authored workflow IDs.
- Collapse and focus survive valid updates; each result and associated
  activity remains reachable in the original transcript.
- Concurrent calls without explicit part references remain unassigned; adding
  real references associates them without changing the underlying chronology.
- Cancellation, malformed partial output, duplicate delivery, and reload do
  not invent completion or silently lose the last valid state.
- A tail-loaded view can recover the current outline; unsupported viewers
  retain useful ordinary text or structured output.
- The producer instructions are short enough to use in a real skill, and the
  chosen output carrier survives both live streaming and saved history in
  Claude and Codex. Their end-to-end reliability remains untested here.

The next decision, if implementation becomes useful, is the smallest producer
convention that those harnesses preserve reliably. A schema file, helper,
provider-native adapter, or richer transport should earn its place in that
exercise; none is scheduled by this proposal.

## Later extensions

Cross-turn continuity could explicitly bind later turns to a persistent
workflow ID. The session can report that ID on continuation; native harness
support would make active-workflow detection more reliable. Branching and
resumed sessions need deliberate ownership and continuation rules before an
ID can group them. Do not infer continuation merely from similar task labels.

With that contract, a workflow-focused view could nest turns and their
agent/tool/user dialogue under parts, or order the view by workflow structure
while preserving each source turn and chronological transcript. Dependency
graphs could supplement the outline. Structured user answers and controls that
change execution would be a further interaction contract, outside v1.
