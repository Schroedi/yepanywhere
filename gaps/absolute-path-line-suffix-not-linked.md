# Absolute and `~/` paths with a line suffix stay plain text

A home-relative or absolute mention with a line suffix, such as
`~/agents/topics/verify.md:29-56`, renders as plain text in a transcript even
though the file exists and lies inside the file-access allow-set. The same file
without the suffix, and a project-relative `src/server.ts:42`, both link.

The absolute tokenizer, `ABSOLUTE_PATH_TOKEN` in
`packages/shared/src/project-path-links.ts`, takes everything up to the next
whitespace. The server then probes that whole token as a filename
(`absoluteTokenTarget` in `packages/server/src/augments/project-path-links.ts`).
So it asks for a file literally named `verify.md:29-56`, finds none, and leaves
the text plain. Relative tokens avoid this because `RELATIVE_PATH_TOKEN`
excludes `:`.

The whole-token probe is deliberate
([project path links](../topics/project-path-links.md#why-membership-not-shape),
"an existing prefix is never linked out of a longer filename"), so do not just
cut at `:`. Cheap fix: when the whole token is not a file, retry once with a
trailing `:N`, `:N-M`, or `:N:C` suffix removed; link only the path part,
leaving the suffix visible, and pass the line to the viewer if it accepts one.
Keep the probe budget and the allow-set check unchanged. Agents are told to
cite `path:line` in prose (global file-citation rule), so these mentions are
common.

Found 2026-10-18 while reviewing a transcript where a cited
`~/agents/topics/verify.md:29-56` did not link.
Contributing-model: opus-5-5
