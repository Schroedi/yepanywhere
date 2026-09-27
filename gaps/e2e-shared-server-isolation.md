# Full-app E2E cases share mutable server state

`packages/client/e2e/global-setup.ts` starts one YA server, relay, and data
directory for the whole Playwright invocation. Browser contexts are fresh per
test, but server settings, remote-access credentials, sessions, and files are
not reset between cases. `remote-login.spec.ts` and `relay-integration.spec.ts`
both configure and clear the same remote-access state. The full local run with
`--workers=2` stopped after five failures and 186 passes, including two remote
login failures. The list reporter shows the remote-login and relay cases
interleaving during those failures; the exact cause of each failure is not yet
established.

The one-worker default serializes files, so it avoids simultaneous mutation
but can hide order dependencies and leaked state. The two-shard CI workflow
runs separate servers on separate runners, but still shares a server within
each shard. Audit mutating specs and their cleanup, reproduce suspected
interactions with focused pairs and changed order, then give each mutable
state boundary a reliable reset or an isolated server fixture. Verify cases
both alone and in the full suite before considering the gap closed. Keep
browser and transport coverage while making those checks independent.

Found 2026-09-27 while comparing local two-worker execution with isolated CI
shards.
