# ACLI tool commentary

> ACLI commentary is tool-authored Markdown displayed beside that invocation's
> ordinary output, with margin bullets that open focused context or its viewer.

Topic: acli-commentary

The encoding and context rules belong to the producer's
[Stdout-aligned commentary contract](https://github.com/graehl/agents/blob/master/topics/acli.md#stdout-aligned-commentary).
YA owns presentation, feature settings, and compatibility. See also
[ACLI discovery](acli-ui.md), [stream and replay parity](stream-persisted-render-parity.md),
[assistant media](media-rendering-and-routing.md), and
[vanilla defaults](vanilla-defaults.md).

## Activation and compatibility

**Tool commentary** in Appearance is a browser-local setting, enabled by
default at graehl's explicit direction on 2026-09-07. Turning it off restores
ordinary tool output and makes no commentary-rendering requests.

The client requires `acli-commentary-rendering`, permanent capability ID 62,
version-implied from 0.8.2. Source-ahead servers advertise it explicitly.
Stable 0.8.0 and 0.8.1 lack it: they retain ordinary raw output and receive no
new requests. Graehl approved this compatibility plan on 2026-09-07. Public
shares also retain ordinary output; the authenticated render endpoint is not
part of the public-share contract.

An invocation declares support with `acli: 1 ... +commentary` or
`acli-capabilities: commentary/1`, optionally prefixed by `#`. Detection reads
only the first line of stdout and stderr, bounded to 4096 characters per
stream, including recognized shell provider envelopes. The stdout check covers
wrappers that merge stderr into output. The shared Python producer emits its
stderr declaration before ordinary output. YA does not infer support from a command name, import,
or `_acli` key, execute discovery probes, or consult the proposed composer trust
registry. A quiet producer must supply a declaration in its retained output to
activate this presentation.

Known code-mode `Exec` content arrays also participate. The existing code-mode
decoder recognizes text blocks and command-result envelopes, including its
fulfilled-result wrapper. Each block has separate framing and context; no
association crosses block boundaries. Commentary stays visible beside the
collapsed row, while ordinary command data, exit status, and duration remain
in the output box. Appending another output block preserves existing commentary
streams without re-rendering their Markdown. A root bullet uses the script
source as its command tooltip and opens that block's original output.
Mixed-media or unrecognized envelopes
retain their ordinary rendering. YA does not guess which source call produced
an output block or recursively interpret arbitrary string-valued fields.

The [artifact capture command](ui-design.md#portable-artifact-captures) emits
this metadata by default in JSON, including both generated image captures.
Its call can fulfill the handoff itself in an enabled, supporting YA client;
image expansion follows the ordinary inline-media setting. No specification
or producer library is vendored into YA.

Artifact captures use a normal Markdown table to keep desktop and phone
previews side by side. Markdown table cells align at the top so differently
shaped captures retain a common starting edge. Automatic gallery grouping is
only a [low-priority proposal](acli-commentary.sketches.md), not required for
this handoff.

Workflow tag highlighting currently classifies original output before this
commentary projection. Tags inside commentary JSON are not recognized, and
mixing tagged raw progress with stripped metadata can leave stale display
offsets or re-expose metadata. This [composition defect](../gaps/acli-workflow-composition.md)
must be resolved before advertising a combined tagged-commentary transport.

Classification happens before publishing a record. Once an invocation has
published ordinary output without a declaration, it keeps that presentation
for the mounted invocation even if a banner arrives later. This avoids
retrospectively relocating visible metadata. A provider that delays stderr
until after stdout has already been displayed can consequently remain raw
live and gain commentary on a later full replay; this limitation is tracked in
[late declaration delivery](../gaps/acli-commentary-late-declaration.md).

## Presentation and context

Each valid commentary `text` is preserved exactly after JSON decoding and
rendered through the existing assistant Markdown renderer and `TextBlock`.
Links, math, sanitization, and supported media use that same path and the
session's project context. Prose remains within its source tool row; it does
not become an assistant message or start another provider turn.

The normal output box remains. Removing metadata preserves the source's data
spelling, serialized key order, containers, and array positions. Standalone
array commentary becomes `{}`; standalone JSONL commentary produces no data
row. Unsupported or malformed metadata remains literal output. JSON-looking
strings and metadata interiors are never recursively interpreted.

A clickable margin bullet aligns with each prose item's first line. A root
map or a first JSONL commentary record has no focused context: its tooltip is
the tool command and clicking opens the existing minimizable session viewer,
including original output. Nested data maps preview their data; standalone
array or JSONL commentary previews the nearest preceding data item or record,
skipping commentary-only predecessors. Empty objects, zero, and false remain
valid contexts. Associations never cross tool invocations.

Context opens on hover or keyboard focus. Clicking pins it for touch access;
clicking the bullet again, the close control, outside the overlay, or Escape
closes it. The viewport-bounded overlay does not alter transcript geometry.
The larger transparent click target keeps its visible highlight in the margin.

## Streaming and resource limits

`AcliRecordFramer` scans only appended characters. JSONL records become eligible
at their closing newline; pretty JSON waits for its complete document. Neither
partial `_acli` keys nor unrendered metadata is painted and then removed.
Completed data and its rendered commentary publish together in source order.
Previously published records are not reparsed on ordinary React rerenders.
Source replacement cancels the old projection and rebuilds it atomically.
Completed immutable tool results retain a weakly keyed presentation cache.

Parsing preserves lexical source spans instead of round-tripping data through
JavaScript numbers or reordered integer-like object keys. Records exceeding
1,048,576 UTF-16 code units, nesting deeper than 128, duplicate object keys,
and malformed JSON stay raw. Context strings are materialized when opened.
Snapshot prefix validation and assembling cumulative displayed output still
touch accumulated text; the incremental decoder is not a claim that the whole
provider-to-DOM pipeline has linear total cost.

`POST /api/projects/:projectId/tool-commentary/render` accepts a strict
`{texts: string[]}` body, at most 32 nonempty strings and 64 KiB of request
bytes. Its ordered `{html: string[]}` response uses the existing cached
assistant Markdown renderer and project-path index. At most four requests
render concurrently per server app. Oversized requests return 413, malformed
bodies 400, and overload 503. The client sends bounded sequential batches per
output stream and aborts them on unmount. Failed rendering retains the affected
original records and reports the failure; it never strips unseen commentary.

The producer's standard `--help` briefs agents on verbatim prose, context,
suppression, and the fact that emission does not prove presentation. YA keeps
the original tool result, including what the producer said, in provider and
persisted history. This feature adds no model-visible delivery receipt or
synthetic assistant-history insertion, and a successful render request does
not prove that a user read the result.

## Verification

Shared decoder tests cover nested and standalone contexts, ordered extraction,
lossless data spelling, invalid metadata, and split/pretty records. Client
tool-row tests exercise setting/capability fallback, atomic publication,
replacement, pinning, and the managed viewer. Server route tests exercise
Markdown/math/link/media rendering and request bounds.

`pnpm --filter @yep-anywhere/client exec playwright test --config
playwright.commentary.config.ts` starts a fresh isolated Vite server and the
real commentary endpoint. It verifies desktop and phone rendering, unchanged
transcript dimensions when opening context, no horizontal overflow, the
minimizable viewer, and no rendering requests when disabled. Set
`ACLI_FIXTURE_JSON` to a JSON file with `stdout` and `stderr` strings to repeat
the check using actual producer output.
