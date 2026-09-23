# Session search landed-frame e2e can miss the clear on the next key

The full client e2e run (`pnpm test:e2e`, ~16 minutes, 318 tests) failed in
`packages/client/e2e/session-isearch-scope-controls.spec.ts` at "committed
jumps fade the row frame and clear on the next key": after pressing `Shift`,
`[data-search-match="true"]` still counted `1` through the 5 s `toHaveCount(0)`
budget. The same spec file passed 3 of 3 times when rerun alone, so this is
load-sensitive clearing or test-settling behavior rather than a deterministic
product failure.

Reproduce under full-suite load and establish whether the next-key clear is
lost (key event delivered before the landed-state listener attaches) or only
late. Make the test wait on that owned contract rather than lengthening the
timeout.

Found 2026-09-23 during the publish verification of the filter-menu scroll fix.
