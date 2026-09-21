# Repository lint still emits seven warnings

`pnpm lint` exits successfully but reports seven Biome warnings outside the
Project Queue client surface: four `noControlCharactersInRegex` and two
`noAssignInExpressions` findings in
`packages/server/src/projects/TemplateSourceService.ts`, plus one
`noAssignInExpressions` finding in
`scripts/generate-vendored-model-prices.mjs`. The warning-free commit contract
is therefore not currently met even when changed client files are clean.

Fix the regex representation without weakening its input rejection and expand
the three assignment expressions into ordinary statements, then run their
owning server/script tests before removing this gap.

Found 2026-09-21 while verifying Project Queue provider/model badges.
