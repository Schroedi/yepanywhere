# Remove SSH executors

Status: **rows 2 and 3 implemented and locally verified**, 2026-10-26. Implements house-cleaning rows 2 and 3
as separate verified commits, pushing each before proceeding.

## Released executor removal (row 2)

Delete the Claude SSH spawn and rsync/session-sync implementations, settings
routes/editor and launch selector. Preserve historical executor labels only
to identify retired records and refuse execution. Explicit stale-client SSH
requests, saved remote-session resume and direct non-HTTP provider launches
must fail rather than selecting a local checkout. Preserve local Claude,
Gateway/Ollama behavior, local goal reads, sandbox and agent-env safety.

The managed prototype shares SSH quoting/alias utilities, so retain those
until its own row 3 deletion. A pure local Claude transcript-folder helper
currently imported from session-sync must survive without importing rsync.
Do not touch Git SSH, Machine Control transport, saved YA host access or user
remote files/credentials. Close only defects exclusively about removed sync;
keep independent source-identity defects open.

## Managed runner removal (row 3)

Delete managed SSH session/target/workspace/diagnostic adapters, runner entry,
Codex auth projection and transcript mirror, dedicated build/probe commands
and tests. Remove remaining remote-only owner branches and utilities after
checking retained consumers. Preserve same-host runtime host/workers and
their actual stdio/socket consumers. No native remote-stop qualification or
remote workspace cleanup is required to delete this prototype.

## Verification and completion

For each cut, run required lint, formatting, typechecking and workspace tests,
plus focused launch/refusal and affected browser checks. Use isolated owned
profiles and Playwright Chromium. Verify sequential typing within 100 ms
where the creation form changes; capture retained desktop/phone UI through
the artifact facility. Update the cleanup ledger and owning contracts,
commit and push each completed row. This plan does not authorize row 10 or
graehl-led feature deletions.

## Results

### Released executor evidence

- Dedicated SSH spawn, rsync sync, settings routes/page, selector and tests
  are removed. SSH quoting remains only for the separately pending prototype.
- Explicit SSH start/create requests fail before launch. Historical executor
  records remain readable, but execution actions return 410 even when a
  caller asks for local; direct Claude and Supervisor paths also refuse.
- Four focused server suites pass: 347 tests, three existing skips, 2.49 s.
  Full-app session API coverage also passes (47 cases, 3.84 s).
- Owned New Session/account-discovery and Settings browser checks pass: four
  cases in 44.3 s. All 54 sequential keys are acknowledged; maximum 8.3 ms.
  Desktop/phone captures under `.artifacts/ui-testing/2026-10-26-remove-ssh/`
  were recorded through the artifact facility. Inspected settings controls
  fit at 1000×600 and 375×812; the retired category and launch selector have
  no remaining client entry points.
- Site check/build validates all 33 public pages; the historical announcement
  now identifies SSH execution as retired.
- Sync-only config-directory/rsync gaps close with their deleted implementation.
  Historical source identity remains a separate open gap.
- Final lint (zero warnings, one unrelated informational suggestion), format,
  typecheck and `pnpm test` pass. Server: 6,606 tests in 118.44 s; client:
  7,063 in 129.40 s; shared/relay/push-broker also pass. Existing intentional
  fault logging and Node SQLite notices remain in the root suite; affected
  focused checks are warning-free. No primary server restart or remote deletion.

### Managed prototype evidence

- Managed session/target/workspace/diagnostic adapters, injected entrypoint,
  dedicated stdio protocol, credential projection/transcript mirror and all
  build/probe commands are removed. No active source imports these facilities.
- Internal local/remote placement types and branches are removed; same-host
  host/socket workers and their deterministic fixture remain.
- The pinned `rust-v0.164.0` source was inspected before deleting only the
  prototype's external-token login/refresh integration. Ordinary Codex auth,
  router transport and experimental API/MCP capabilities remain. Local
  `codexHome` configuration remains: a retained regression caught its use by
  ordinary local config discovery, so it was preserved.
- Six focused host/settings/supervisor/Codex/rendez suites pass: 322 tests,
  two existing skips. No UI behavior changes in this cut, so the retained
  creation/settings browser evidence from row 2 remains applicable.
- Final lint (zero warnings; one unrelated informational suggestion), format,
  typecheck and `pnpm test` pass. Server: 6,578 tests in 117.63 s; client:
  7,063 in 132.33 s; shared/relay/push-broker also pass. Focused retained
  consumers: 322 pass, two skips, 23.27 s. Existing intentional root fault
  logging/SQLite notices remain; no credentials or remote workspaces touched.
- Source audit finds no active managed-runner/SSH placement or external-auth
  imports. Historical plan links point to the pre-removal source where needed.
  Local verification is macOS; Linux/Windows remain CI checks.
