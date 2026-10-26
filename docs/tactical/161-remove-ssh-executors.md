# Remove SSH executors

Status: **in progress**, 2026-10-26. Implements house-cleaning rows 2 and 3
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

Pending row 3.
