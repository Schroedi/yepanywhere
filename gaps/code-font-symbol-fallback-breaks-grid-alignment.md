# Code-block grids misalign when symbols fall back to another font

A fixed-width text grid inside a fenced code block in an assistant message
renders ragged in YA when it uses symbols such as `█` `◎` `●` `→` `·`: rows
that should be equal width are not. The monospace stacks in
`packages/client/src/styles/index.css` (`--font-mono-system`: SF Mono,
Monaco, Cascadia Code, Consolas, then `monospace`; and the bundled Fira,
IBM Plex and Iosevka faces) lack some of these glyphs, so the browser takes
them from a proportional symbol font whose advance widths differ from one
cell. Characters of ambiguous East Asian width are also drawn single or
double width depending on the font that supplies them.

Seen in an Order of the Sinking Star board view the agent rendered with
those symbols (screenshot in the session below). The agent's tool now
emits plain ASCII, so that case no longer depends on this.

The user's expectation: YA keeps code-block columns aligned even when a
glyph must come from a font with a different aspect ratio, re-spacing
rather than letting the row drift. A robust fix forces each character into
its cell: wrap characters the primary font lacks (or all non-ASCII ones) in
spans of fixed width (`1ch`, or `2ch` for East Asian wide characters per
Unicode width data), centred, so a fallback glyph cannot change the advance.

Cheaper partial fix: add a monospace face with broad symbol coverage (for
example DejaVu Sans Mono or JuliaMono) to every mono stack before the
generic `monospace` fallback, ideally bundled as the existing YA faces are;
check box-drawing, block, arrow and geometric-shape ranges at desktop and
phone widths. Not fixed in place: it was noticed in another repository's
work and needs a font-coverage choice and visual verification.

Found 2026-10-13 while building the OSS puzzle simulator's text grid
(session d9b49f8c-73de-4f58-afa1-233b2703d9be).
