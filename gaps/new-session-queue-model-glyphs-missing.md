# New Session's project queue lost its model glyphs

`e2e/new-session-project-queue.spec.ts:119` ("keeps the selected project
queue beneath the selector") fails deterministically, including every retry:
the queue under the New Session project chooser shows its two items' text but
no `claude-opus-4-6` model glyph (`getByRole("img", { name:
"claude-opus-4-6" })` finds 0 of 2, line 90).

It failed on CI for `70faaa782` (graehl run 36389582420) and again for
`a7ce9e78b` (run 36402047742), and locally at `a7ce9e78b`, so it predates
that publish range. Not investigated: whether the rows stopped rendering the
glyph, stopped receiving the model, or the fixture's model id no longer maps
to a glyph. Bisect from the last green CI run of that spec.

Found 2026-09-28 while reporting CI for a publish.
