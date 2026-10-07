# Provider sign-in leaves 11 lint warnings

`pnpm lint` passes with warnings, which fails the zero-warning rule in
`docs/development/code-quality.md`. All 11 came in with `85be3babe` (Sign
Claude and Codex in from Settings → Providers):

- `packages/server/src/services/ProviderLoginService.ts:49-51` — ten
  `noControlCharactersInRegex` hits on the ANSI-stripping patterns
  (`OSC_SEQUENCE`, `CSI_SEQUENCE`, `CONTROL_CHARACTERS`). Matching control
  characters is these regexes' purpose. The cheap fix is a
  `biome-ignore lint/suspicious/noControlCharactersInRegex` with that reason
  on each, or building them with `new RegExp` from escaped strings.
- `packages/client/src/pages/settings/ProviderSignIn.tsx:73` —
  `useExhaustiveDependencies` reports `flow` as unnecessary in the polling
  effect. It may be deliberate, re-arming the poll timer after each flow
  update; if so, say so in a `biome-ignore`, otherwise remove it.

Not fixed in place because the author's intent on the effect dependency
should decide the second fix.

Found 2026-10-07 while running the quick verify tier for the settings
clipboard transfer.
