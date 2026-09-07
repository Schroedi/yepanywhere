# Workflow annotations precede commentary extraction

`compileTranscriptProjection` runs `annotateWorkflowTags` on the original tool
output. Later, `ToolCommentaryBoundary` removes recognized ACLI metadata and
renders its prose. These projections do not yet compose:

- A stage prefix inside `_acli.commentary[].text` is not a column-one prefix
  in serialized JSONL, so workflow matching does not recognize it.
- Removing a declaration or metadata record changes the offsets used by
  `WorkflowOutput`. A Bash preview can apply old marker offsets to shortened
  text. A code-mode preview can instead use its retained `workflow.outputText`,
  displaying the original metadata again alongside the rendered commentary.

A production-path probe using an inline `build` schema, a declared commentary
record, and a raw `[build]` progress line found its stage marker at offset 84
before extraction, while cleaned output was only 21 characters long. Only the
raw progress line matched; the commentary's `[build]` prefix did not. The
code-mode annotation retained the original `_acli` output. This can arise when
a provider merges structured stdout with separately tagged stderr progress.

The current publish schema has `toolOutput.containsTags: false`, and its
publisher emits opaque `PUBLISH:` logs, so it does not depend on this
combination. Do not advertise tagged commentary/JSONL composition yet.

Resolve the producer contract in `~/agents/topics/workflow-tags.md` and
`~/agents/topics/acli.md` before instrumenting both modes in the publisher.
The likely owning boundary is a shared output projection: decode envelopes and
ACLI records into data/prose fragments with source identities, then classify
workflow tags against those fragments before Markdown presentation. Keep
tool-local stages and lifecycle authority distinct from assistant commentary,
preserve original output, and never apply offsets across different projections.

Two producer conventions remain open for that design:

- **Extract commentary first.** A decoded commentary text may begin with a
  schema tag prefix, such as `[build][types] Checked the types.`. Workflow
  matching can then classify/group that prose while preserving its Markdown,
  original record, and context bullet. Its tool provenance must remain intact:
  it cannot acquire the assistant's ability to close the calling workflow.
- **JSONL records as logical lines.** Define which JSONL parts supply tag text
  or a structured stage path and which data belongs to that segment. One
  physical JSONL line can contain escaped newlines or several commentary
  items, so record boundaries, decoded text-line boundaries, ordering, and
  whether a stage carries into following records need an explicit contract.
  Do not infer tag meaning from arbitrary string fields or prefix serialized
  JSON with raw tags that would invalidate JSONL.

These are compatible directions, not implemented promises. The official
workflow topic should own their framing and matching rules; the ACLI topic
should cross-reference them while retaining valid JSONL output. Test both
feature switches independently and together, complete and streaming records,
original-output recovery, and separate invocation/stream contexts.

See [ACLI commentary](../topics/acli-commentary.md) and
[workflow view](../topics/workflow-view.md). This is a concrete composition
defect, separate from optional gallery grouping.

Found 2026-09-07 while reviewing publish workflow and ACLI commentary interaction.
