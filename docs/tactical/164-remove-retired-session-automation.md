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

Remaining cuts and independent review pending.
