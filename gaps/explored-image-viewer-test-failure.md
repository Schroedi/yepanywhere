# Image-read thumbnail browser test cannot find its expected viewer

The full `pnpm test:e2e` run on 2026-09-16 failed in
`packages/client/e2e/explored-image-strip.spec.ts:63`. After clicking the first
grouped image-read thumbnail, `.modal--image-viewer` remained absent for the
10-second assertion deadline (expected one, received zero).

Determine whether the image now opens through a different viewer surface or
the click actually fails. Inspect the rendered result before changing the
selector; a passing thumbnail count does not establish that opening works.
The failure occurred outside the post-compact replay changes, so neither the
viewer nor its assertion was changed during that work.

Local evidence is under
`packages/client/test-results/4fe359cf-c189-4d43-b983-d158c7c8aabe/explored-image-strip-group-94e30-bnails-that-open-the-viewer/`
(`test-failed-1.png` and `error-context.md`). Reproduce with the owning
Playwright spec; repeatability has not been established.

Found 2026-09-16 while validating quoted post-compact replay.
