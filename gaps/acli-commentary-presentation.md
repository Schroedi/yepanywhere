# Present acli commentary as prose alongside normal tool output

The acli Python library can emit default-on Markdown commentary inside
JSON/JSONL, but YA does not yet implement the agreed presentation of those
items. This gap is explicitly requested alongside the producer implementation;
it does not authorize renderer or provider-service changes now.

The canonical producer and interpretation contract is
[`~/agents/topics/acli.md`, Stdout-aligned commentary](https://github.com/graehl/agents/blob/master/topics/acli.md#stdout-aligned-commentary).
The local source may be ahead of the published repository. Keep general
encoding, context association, and capability definitions there rather than
making YA the owner of a competing protocol.

## Required presentation

- Recognize `+commentary` on a full `acli: 1` tool or the narrow
  `acli-capabilities: commentary/1` declaration. A command path, Python import,
  or package-manager invocation is not a capability declaration. Narrow
  producers need not use Python or implement the full acli baseline. Use
  known invocation provenance; do not execute arbitrary tools for discovery.
- Decode reserved `_acli.commentary` arrays on any JSON object, including
  nested objects. Collect per invocation in the order defined by the spec;
  do not inspect JSON-looking strings or recurse inside metadata. Unsupported
  or malformed metadata must remain visible as raw output rather than being
  silently stripped or interpreted as assistant text.
- Sweep commentary into a `ul` or paragraphs styled like assistant prose,
  while keeping the normal output box. Render each decoded `text` verbatim
  through the ordinary assistant Markdown path: links, math, and supported
  inline media previews share its semantics. Do not paraphrase, flatten into
  captions, or expose JSON escaping. Future renderer extensions should work
  without changes to each tool.
- Retain the commented-on context before removing metadata from the normal
  output view. The spec assigns an enclosing data map to attached commentary,
  a preceding data list item to a standalone array item, and a preceding stdout
  data record to standalone JSONL commentary. Keep source associations stable
  when commentary is collected apart from its data.
- Consider mouseover tooltips or left-margin notes for focused context,
  with keyboard/touch access. A top-level map normally needs no duplicate
  tooltip: the full output is already nearby and the user can scroll to it.
  Nested maps and preceding list items/records are the useful hint cases.
- Keep commentary in its originating tool invocation through streaming,
  reconnect, replay, and parallel calls. Use retained source identity and
  record/item locations so partial chunks and replay cannot duplicate prose
  or silently associate it with another call's output.
- Brief the agent on the presentation contract and preserve what was said in
  its tool result or model-visible receipt. Emission and queue admission alone
  cannot establish successful presentation. Synthetic assistant-history
  insertion is independently optional, tracked by
  [`acli-commentary-history-injection`](https://github.com/graehl/agents/blob/master/gaps/acli-commentary-history-injection.md);
  do not start an extra user turn to simulate it.

Start from [the architecture entry point](../ARCHITECTURE.md),
[acli UI discovery](../topics/acli-ui.md), and
[stream/persisted parity](../topics/stream-persisted-render-parity.md). Trace the
actual provider tool-output envelopes before selecting the shared decode and
presentation boundary. Review client/server compatibility and the applicable
YA feature default at implementation; producer-default commentary does not
silently decide those separate release contracts.

## Closure evidence

Exercise a real commentary-emitting command plus fixtures for nested maps,
standalone array items, standalone JSONL lines, empty/absent context, Markdown
links/math, malformed metadata, and data-only `--no-commentary` output. Verify
the normal output remains available, top-level context does not create a huge
tooltip, focused hints refer to the correct source, and streamed output matches
replay without duplicate prose. Inspect desktop and phone captures under the
project's UI verification rules. Provider-history injection is not required.

Found 2026-09-07 while implementing acli commentary in `~/agents`.
Contributing-model: 6-Astra
