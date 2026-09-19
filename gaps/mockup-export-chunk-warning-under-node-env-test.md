# The mockup export build fails the warning-free gate under NODE_ENV=test

`packages/client/e2e/mockup-export.spec.ts` calls `build({ configFile })` on
`vite.config.mockup.ts`, whose `warningFreeBuildLogger("Mockup")` turns any
Vite warning into a failure. Run on its own, the spec passes: the bundle's
largest chunk is 490.71 kB, under Vite's 500 kB `chunkSizeWarningLimit`. Run
inside the full `pnpm test:e2e`, the same source builds to 504.85 kB and the
spec fails on

```
(!) Some chunks are larger than 500 kB after minification.
```

`NODE_ENV=test` is the difference, and it reproduces directly:

```bash
pnpm --filter @yep-anywhere/client exec vite build --config vite.config.mockup.ts
# index-DEaZCOy4.js 490.71 kB, exit 0
NODE_ENV=test pnpm --filter @yep-anywhere/client exec vite build --config vite.config.mockup.ts
# index-DCBR3qdX.js 504.85 kB, exit 1 — same hash the full-suite run produced
```

So the gate is 2% away from its limit, and whether it trips depends on an
environment variable the suite sets for unrelated reasons rather than on the
mockup fixtures. Anything that grows the fixture bundle slightly will make it
fail standalone too.

Not fixed here because the right resolution is a build-policy decision: pin
the mockup build to production mode so the e2e run and a direct run agree,
raise `build.chunkSizeWarningLimit` for a fixture bundle that is never
shipped, or split the fixture entry. Each is a different statement about what
the warning-free gate is protecting.

Found 2026-09-19 while fixing rewound-group membership
(topics/session-rewind.md); the mockup bundle contains none of the changed
code, so the failure predates that work.
