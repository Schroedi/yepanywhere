# Nine e2e specs fail deterministically on this host

`pnpm test:e2e` on `main` finishes 194 passed, 9 failed, 2 did not run. The
failures are not flaky: a targeted re-run of just those specs reproduces the
same nine, and a clean worktree at the same commit with no local changes
reproduces the same nine again.

    e2e/artifact-viewer.spec.ts:108
    e2e/async-questions.spec.ts:17
    e2e/codex-compact-availability.spec.ts:13
    e2e/mockup-export.spec.ts:35
    e2e/question-aside.spec.ts:13
    e2e/slash-command-argument-completions.spec.ts:72, :216, :343
    e2e/thinking-toolbar-menu-layout.spec.ts:81

One concrete cause is visible in the output: `Port 5173 is already in use`,
which is the fixed port the fixture's remote-client Vite server binds. Nothing
was listening on 5173 when checked afterward, so whatever takes it does so
intermittently. That would plausibly account for the specs needing the remote
or exported bundle — artifact viewer and mockup export — but it has not been
shown to explain all nine. `thinking-toolbar-menu-layout` fails on its own
terms, timing out because the overflow-strip trigger is never visible.

Worth separating before chasing: a fixed port in a fixture is a defect
regardless of what currently collides with it, since it makes the suite
unrunnable alongside anything else that wants 5173, including a second
worktree. `packages/client/e2e/support/vite-server.ts` and the remote-client
startup in `global-setup.ts` are where that port is chosen.

Not investigated further because the work in progress was unrelated, and the
baseline comparison had already answered the question that mattered then —
whether the change under test caused them. It did not.

Note the suite is also red on CI for a different and already-fixed reason: the
last pushed commit fails typecheck on `writeIntervalMs` in
`packages/server/src/services/voice/VocabularyStore.ts`, which later unpushed
local commits corrected. Do not read a red CI badge as confirmation of these
nine.

Found 2026-09-10 while verifying the Mermaid code-fence renderer.
