# Code-Fence Language Renderers

> How YA reduces a fenced code block's info string to one normalized language
> name, marks every rendered block with that name, and — proposed — dispatches a
> registered per-language renderer such as Mermaid instead of syntax
> highlighting.

Status: the normalization and the language marker described in the first two
sections are implemented. The language affordance, the renderer registry, and
the Mermaid renderer are a proposal; nothing dispatches on language yet beyond
the pre-existing `ansi` and `toon` cases.

See also [`rich-text-rendering.md`](rich-text-rendering.md) for the surrounding
render pipeline and [`active-content-security.md`](active-content-security.md)
for the boundary any generated-markup renderer has to satisfy.

## The info string is one language name

In CommonMark everything after the opening fence is an *info string*. Only its
first word is conventionally a language; the rest is renderer-specific
attributes. YA reduces it to a single comparable token: trim, take the first
whitespace-delimited word, lowercase. Anything left is discarded.

`normalizeCodeBlockLanguage` in
`packages/server/src/augments/code-language.ts` is the one implementation.

This applies to **every** code-block language string, not only ones some
renderer claims. `BlockDetector` normalizes at fence detection, for both the
completed-block and streaming-block paths, and both `AugmentGenerator` entry
points normalize before rendering. So the Shiki grammar lookup, the `ansi` and
`toon` special cases, the loaded-language set, and the emitted class all compare
the same form, and a fence written ```` ```JavaScript ```` behaves like
```` ```javascript ````.

The fence-detection regexes previously required `(\w*)`, which rejected an info
string containing a space or a punctuation attribute outright — such a line was
not recognized as a fence at all and fell through to paragraph handling. They
now accept `(.*)` and let normalization drop the tail.

## Every rendered block carries its language

A per-language client renderer needs the language in the DOM. The plain
fallback (`renderPlainCodeBlock`) and the ANSI path already emitted
`class="language-<name>"`, but Shiki did not: its output encodes the language
only in token colors, so a highlighted block was indistinguishable from any
other. A Shiki `code` transformer now adds the same class.

That one class is the whole client-facing contract. The client reads the
language from `pre > code[class*="language-"]` and never re-derives it from the
original fence text. The shared sanitizer already allows `class` on `code`, so
this needs no allowlist change.

Not covered: the rendered-Markdown-file path in `renderSafeMarkdown` uses
markdown-it's default fence rule, which emits `language-<first word of info>`
with the original case preserved. Bringing that path onto the same
normalization is unresolved.

## Proposed: default language affordance

The default treatment for a marked code block is a tooltip on hover and the
same text on tap for touch, naming the language. No visible chrome, no badge,
no layout change — the existing default is not buggy, so the label stays a
non-disturbing addition. A block with no language, or one whose info string
normalizes away, shows nothing.

## Proposed: renderer registry

Dispatch is a lookup in a map keyed by normalized language name. Two properties
matter more than the shape of the map:

- **Registration happens once.** Explicit registration at module load is the
  preferred form because it is the simplest thing that works and it keeps the
  set of renderers greppable. Scanning a directory once at startup to
  auto-register is also acceptable.
- **A code block never scans.** Rendering a block must cost a map lookup.
  No filesystem probe, no asset discovery, no dynamic resolution per block.
  Whatever a renderer needs, it acquires at registration or on its own first
  use, not per occurrence.

Existing per-language handling should be resolved into the registry rather than
left as a parallel branch. `ansi` and `toon` are already language-keyed special
cases inside `renderCodeWithHighlighter`, and Shiki highlighting is the default
when nothing else claims the language.

A renderer takes the normalized language plus the source text and either
produces a rendered result or declines. Declining falls back to ordinary
highlighting, so an unparseable diagram is still readable as its source.

## Proposed: Mermaid

Mermaid is the motivating case and the reason the registry has a client half:
it lays diagrams out against a live DOM, so it cannot run in the server
augment generator. The split is therefore:

- The server emits nothing special. A ```` ```mermaid ```` fence produces the
  ordinary marked code block. No new server dependency, no sanitizer
  relaxation, and a client that does not implement the renderer still shows
  readable diagram source.
- The client finds `pre > code.language-mermaid` inside an already-rendered
  container, replaces the `<pre>` with the produced diagram, and marks the
  result so a re-render of the same content is idempotent. Mermaid itself is a
  lazy dynamic import, so sessions without diagrams never pay for it.
- On a Mermaid parse or render failure, the code block is left exactly as it
  was.

**Open question, and the reason this is not yet implemented.** Mermaid
generates SVG in the client from agent-authored text. By the standard in
[`active-content-security.md`](active-content-security.md) that is active
content, and injecting it as raw markup would be a new hole rather than a
render feature. Mermaid's own `securityLevel: "strict"` is necessary but is not
by itself the argument that the output is inert. The generated SVG should go
through an allowlist on the way in, and which allowlist — the existing sanitizer
extended to SVG, or a separate narrower one — is undecided. Settle this before
writing the renderer.

## Streaming

A client may re-render on each streaming augment, but that is not the usual
case and no renderer should be designed around it. Streaming code blocks
deliberately take the plain fallback path with no highlighting, so a partial
Mermaid source would simply fail to parse.

Two consequences for the renderer contract: an incomplete source is "not yet",
never an error, and a renderer must not do expensive work per token. The
natural point to attempt a render is the completed-block augment; a client that
does attempt earlier should gate retries on the source actually having changed.
