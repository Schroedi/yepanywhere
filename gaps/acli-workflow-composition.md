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

See [ACLI commentary](../topics/acli-commentary.md) and
[workflow view](../topics/workflow-view.md). This is a concrete composition
defect, separate from optional gallery grouping.

Found 2026-09-07 while reviewing publish workflow and ACLI commentary interaction.
