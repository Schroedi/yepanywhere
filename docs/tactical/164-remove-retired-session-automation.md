# Remove retired session automation and unfinished helper surfaces

Status: accepted, implementation in progress, 2026-10-27.
Baseline: `f16a04ad8`. Topic: core-house-cleaning.

The maintainer selected rows 7, 5, 4 and 15 of
[core house cleaning](../../topics/core-house-cleaning.md), following Graehl's
revised decisions. Implement and validate each cut, then obtain an independent
Opus 5.5 High review through the local YA work pool / Weekly pace. Address
findings and push each completed commit. No provider refresh or general core
rewrite is required.

## 1 — Remove the post-compact replay message policy

Remove provider checkboxes/count settings, prompt generation, prose collection
and automatic `continue.` delivery. Old saved enablement is inert. Preserve
historical transcript recognition, native compaction, general hidden messages
and the post-compact action hook with its idle, queue, newer-input and lifetime
gates. Keep that hook opt-in at the internal runtime boundary with no built-in
message action. Do not replace the removed policy with another prompt.

## 2 — Remove synthetic heartbeat turns and automatic resurrection

Remove configured periodic turns, forced nudges, candidate indexing, settings,
session overrides and feature-owned scans/benchmarks. Preserve transport/status
heartbeats, liveness probes, cleanup fences, event-driven wake, done actions and
patient-queue delivery. Shared scheduling must retain its real consumers and
quiesce when none remain. Inventory `autoResumeDisabled` before touching it.

## 3 — Remove dormant helper targets

Delete the unfinished target registry/editor/discovery/selector plumbing. Keep
provider-local models for recaps and other retained helpers. Do not construct
the proposed in-house provider as a prerequisite. Retired target identifiers
must not become provider model identifiers accidentally.

## 4 — Remove unfinished aside report-back

Delete pending summary/file report modes and report-back affordances. Preserve
Quick Question, Save Q+A, Continue /btw, the aside destination, close/return,
ordinary `/done` and `/archive`, and access to existing child transcripts.

## Compatibility, verification and stopping point

These cuts withdraw features without adding a new client requirement. New
clients stop exposing the controls even with older servers. Retired saved
settings and stale-client writes cannot reactivate execution. Preserve IDs and
registry entries for retired capabilities and withdraw advertisements where
needed. No history or user workspace deletion.

For each cut: focused retained-behavior tests, root lint/format/typecheck/tests,
and appropriate browser checks. Use isolated test homes, data and runtime
directories, never restart localhost:3400. Verify sequential typing within
100 ms in affected input/settings flows; capture and inspect desktop/phone
states through the artifact facility. Record test removals by the behavior
retired, retain historical and tricky shared-lifecycle regressions, and avoid
new wiring-only tests. Follow DEVELOPMENT.md and linked task guides.

Update owning contracts, the decision table and roadmap with actual status.
Keep wake migration, keepalive economics, recap UI changes, `/btw` removal,
provider qualification and the resumed core refactor separate. Completion is
the four selected removals, passing checks and addressed review findings.

## Verification and review record

### Replay policy removal

Implemented the row 7 cut. The remaining internal `postCompactAction` seam
reuses the old admission/lifetime gates, with no default application action.
Historical recognizer tests remain; generator, prose-buffer and checkbox/count
tests were removed because their behavior is retired. Existing integration
coverage now verifies explicit hook dispatch and no default continuation.
A disk-roundtrip test proves saved enablement is inert.

macOS / Node 22.23.3: 355 focused server cases passed in 4.48 s; full workspace
passed in 143.61 s (6,586 server / 7,056 client). Lint, format, typecheck and
console budget passed. Three focused browser cases passed in 43.71 s including
setup; 900-message sequential typing stayed below 100 ms for every key.
Desktop/phone provider settings and session captures were inspected under
`.artifacts/ui-testing/2026-10-27-retired-automation/`. No capture warnings.
Unrelated full-suite fault-path diagnostics remain recorded in the existing
`gaps/full-suite-timing-and-diagnostics.md`; focused tests were warning-free.

### Synthetic heartbeat removal

Removed periodic/forced turns, unowned candidate registry, project/session/global
configuration and UI, startup seeding, dedicated probes/benchmarks and retired
feature tests. Preserved project app/sharing controls in the project modal.
Transport/lease heartbeats, provider liveness, patient delivery, done actions,
automatic-resume exemptions and Project Queue initialization remain. The shared
deadline scheduler is now `SessionMaintenanceScheduler`; its disposal and
coalescing tests remain. The no-work integration test requires zero sweeps.
Old metadata writes receive 410; obsolete global settings are omitted, and
project-default capability withdrawal covers negotiated and legacy responses.
An assembled-app reader regression verifies the withdrawal.

Focused server checks: 713 cases passed in 24.32 s (including intentional
ProjectQueueScheduler failure-path diagnostics already recorded in the diagnostics
gap). Five client suites: 249 cases passed in 6.83 s. Version/storage fixture
checks: 40 passed in 4.28 s. Four browser cases passed in 45.6 s, including
900-message real typing. The retained project app/settings browser case passed
in 40.4 s including setup; desktop/phone settings captures were inspected.
Lint/format/typecheck/console/CSS contracts pass; deleted selectors lowered both
legacy CSS ceilings. Full workspace passed in 130.44 s: 6,539 server / 7,047 client. The known
Rendez nested-watch case recurred once and passed isolated and full reruns;
the existing gap records evidence. No watcher source or timeout changed.

### Dormant helper-target removal

Removed the target registry, hidden editor, model discovery route and selector
plumbing. Saved targets are omitted by settings normalization; stale writes are
ignored. Provider-local recap models remain available. A regression verifies
that a saved retired target is refused before the provider summarizer is called,
without a silent fallback. Removed tests covered retired configuration/discovery.

Focused server checks: 220 passed in 1.26 s. Desktop/phone provider-settings
browser cases passed in 53 s including setup. Lint, format and typecheck passed.
The full server suite passed all 6,536 cases. Workspace runs encountered two
unrelated fixture failures: capture-CLI timeout and Gateway loopback-family
selection. Both isolated files passed (13 and 27 cases respectively); the
existing full-suite gap records evidence. Final workspace validation and
independent review follow after the remaining cut. Deleted helper-only CSS
also lowered the legacy stylesheet ceiling.

Aside report-back cut and independent review pending.
