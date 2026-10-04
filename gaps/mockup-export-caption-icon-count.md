# Mockup export checks omit the caption pencil icon

[CI run 37223293080](https://github.com/kzahel/yepanywhere/actions/runs/37223293080)
on `8b67ddefc` failed both `e2e/artifact-relay.spec.ts:410` and
`e2e/mockup-export.spec.ts:35`, including their retries. Their shared
`e2e/fixtures/mockup-checks.ts` expects 48 SVGs across 16 project cards, but
the rendered fixture has 64. Font loading, scrolling and overflow checks pass.

The helper still describes three icons per card. `ProjectCaptionEditor.tsx`
now also renders a pencil SVG, added by `818813a84` (caption editing by pencil
or long press). The fixture uses the real project cards and supplies editable
captions, explaining the extra 16 icons. Update the fixture contract for the
caption control and run both export tests, including direct and relay previews.

This is adjacent browser-fixture maintenance, outside the Android launcher-ANR
repair and its separate internal-publication workflow. No product behavior or
browser assertions were changed during that release.

Found 2026-10-04 while publishing the Android tabs and warm-resume test version.
