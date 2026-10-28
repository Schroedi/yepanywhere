# Slash-command browser fixture sometimes stays on Loading session

The first attempt of “shows provider-owned slash hints and argument
completions” in `packages/client/e2e/slash-command-argument-completions.spec.ts`
missed `[data-composer-input]` for ten seconds. Its retained DOM shows
“Loading session...” and “Loading…” rather than the composer. The first
retry passed. This is distinct from the saved-turn restart case in
[the provider restart gap](provider-restart-browser-test-intermittent.md).

Evidence: [CI 40758010082, browser shard 2](https://github.com/kzahel/yepanywhere/actions/runs/40758010082/job/123062026169)
at `a28903424`, artifact `e2e-failures-shard-2-1` (ID `12846858583`). Inspect
the session-detail acquisition and source-dev fixture readiness before
changing product behavior or waits. A successful retry does not explain the
first attempt. The adjacent Source Control retirement does not change this
fixture, session acquisition, composer, or provider commands.

Found 2026-10-28 while following Source Control retirement CI.
