# Restore supported tool displays after contract hardening

Status: renderer repairs remain proposed, 2026-09-11. The reusable read-only
audit command is implemented; the user requested validation, commit, push, and
a handoff for another machine. No renderer or provider compatibility fix is
included in the audit-tooling change.

## Evidence and scope

The September 10 registry migration (`ee42f7f7f`), following crash fix #124,
rejects valid Codex ViewImage output arrays. In session
`01a08b0b-740c-7cf3-b55d-7cc25cfae9e4`, all 13 ViewImage calls in the inspected
window have valid paths and stored media, yet fail result eligibility. The
early raw return in `ToolCallRow` bypasses both the filename affordance and
`ToolResultMediaRows`. The old renderer only needed the input path.

The raw fallback introduced in `dedea8fa7` expands pretty-printed output by
default; its 18rem scrolling limit still consumes substantial transcript
space. The image fixture uses `null`; the native corpus substitutes the string
`Image displayed`, so neither tests the observed multimodal result.

Continue [tactical 124](124-enforced-tool-display-contracts.md), the existing
[native coverage gap](../../gaps/tool-display-native-provider-coverage.md), and
the [rich-rendering contract](../../topics/rich-text-rendering.md#malformed-and-partial-tool-records).
The [forwarded-image duplication gap](../../gaps/code-mode-forwarded-image-duplication.md)
is separate; this work does not authorize image deduplication or storage changes.
The implemented [ViewImage rematerialization repair](114-codex-view-image-rematerialization.md)
concerned server-side media candidates; this incident already has stored media.
This repair does not change roadmap priorities.

## Implementation steps

### 1 — Preserve valid image and media affordances

Cover observed text/image result arrays and gate each presentation on the data
it actually consumes. Keep valid stored media and validated file-path actions
available when unrelated rich result parsing fails. Preserve actual execution
status and the original data; retain containment for malformed Write and other
records. Do not solve this by removing validation across the registry.
Cover Exec multimodal results, detached Shell/wait output arrays, and Edit
acknowledgement arrays without throwing away validated input-side diffs. Check
the nullable Edit original-file case and explicitly retain supported aliases
consumed by renderer helpers. Do not blanket-pass unchecked fields to callbacks.

### 2 — Make fallback compact and inspectable

Use the normal compact tool-row presentation with a short unavailable-preview
indication and explicit disclosure for raw input/output. Avoid an expanded JSON
box for successful calls. Actual execution errors must remain discoverable.
Keep diagnostics available without making them the default transcript body.
Update the owning rich-rendering topic when behavior is implemented.

### 3 — Prove successful presentation as well as containment

Add sanitized observed multimodal specimens independent of display fixtures.
Exercise normalization, pairing, the complete ToolCallRow, stored media, path
actions, nested/forwarded Exec output, pending-to-complete transitions, and raw
disclosure. Assert intended affordances, not only no exceptions or schema
acceptance. Preserve #124 rejection/recovery controls. Review other contracts
for rejected supported shapes and schema projections that silently drop fields.

Run required source checks and UI integration checks at implementation time;
inspect desktop/phone captures for compactness and working media controls.

## Reusable historical audit and second-machine handoff

`pnpm tools:audit` replaces the ad hoc probes below. Its maintained command,
exit-code, privacy, and coverage contract is in
[rich text rendering](../../topics/rich-text-rendering.md#historical-tool-display-audit).
The implementation lives in `scripts/audit-tool-displays.ts` and
`scripts/tool-display-audit.ts`; regressions are in
`packages/server/test/tool-display-audit.test.ts` and participate in ordinary
tests and `tools:typecheck`.

On the other machine, update this checkout with `git pull --ff-only`, use Node
24 for compressed-rollout support, and run:

```bash
pnpm install --frozen-lockfile
pnpm tools:audit --output ~/tool-display-audit.json --locations ~/tool-display-audit.locations.json
```

The output names must be new. Defaults cover `CODEX_HOME/sessions`,
`CODEX_HOME/archived_sessions`, and `CLAUDE_CONFIG_DIR/projects`, with the usual
`~/.codex` and `~/.claude` defaults. Repeat explicit `--codex PATH` and
`--claude PATH` to include alternate profiles or copied histories; explicit
roots replace the defaults. Include ancestor rollout roots when inspecting
reference-backed children. Use `--timeout-seconds 300` for unusually large
files. `--limit N` is a deliberately partial smoke test, not a corpus sign-off.

Send back `tool-display-audit.json`; retain the locations file privately on the
machine for locating hashed examples. Compare groups by provider family,
version, tool, rejection reason, and structural shape. The same underlying call
can occur in multiple copied/forked histories, so counts are transcript-row
occurrences, not unique executions. A group merits a sanitized regression
fixture and before/after presentation check before being called a regression.
Expected execution-error fallback has separate counts.

### First full local corpus run

The working implementation on 2026-09-11 scanned all 261 discovered default-root
files: 166 Codex rollouts and 95 Claude transcripts, about 1.2 GB. Five Codex
leaves had reference-backed history. No malformed lines, read failures,
normalization/compiler warnings, or source changes during reads were reported.
The scan produced 24,917 compiled tool rows, of which 22,181 were registered:
19,325 rich, 26 partial, 2,667 successful raw, 152 error raw, and 11 unfinished
raw. The 2,736 unregistered rows are counted separately.

Successful raw candidates by tool: Edit 1,725; WriteStdin 598; ViewImage 240;
Exec 91; Read 6; get_goal 5; create_goal 1; update_goal 1. This adds two useful
findings beyond the small sample: six Claude 2.1.251 Read results have
`type: "file_unchanged"` with a valid `filePath`, and seven Codex 0.152.0 goal
results use code-mode text arrays. Both are rejected by the current contracts.
Include them in the repair fixtures and validate the old affordance before
claiming a complete semantic fix.

Local reports were explicitly written outside the checkout to
`/tmp/ya-tool-display-full-20260911.json` and
`/tmp/ya-tool-display-locations-20260911.json`; neither is committed. This is
full selected-file coverage under the command's documented projection limits,
not full browser or every-provider coverage. These final-row counts differ
from the earlier API-window, pre-folding counts below.

Validation on macOS / Node 24.20.0: all 12 focused audit regressions pass,
including full history across compaction, inherited history/missing parents,
Claude subagents, native zstd, malformed data, partial scans, timeout isolation,
new-output protection, and redaction. Root lint (zero warnings), formatter,
typecheck, and workspace tests pass: 11,583 tests passed, 55 skipped. The final
focused suite and tool typecheck passed again after the last command changes.
Linux/Windows execution remains for CI/the second machine; the command uses
portable Node filesystem and child-process APIs. No UI source changed, so no
browser rendering verification is claimed.

## Audit evidence, 2026-09-11

Read-only review covered all 26 registered contracts, targeted callback
projections, row/media ordering, the September 10 changes, and fixture/diagnostic
boundaries.
Data-only probes used 822 paired registered tool records from the current API
windows of 15 September 10 Codex sessions, plus 147 paired records from four
local Claude project transcripts. Windows can exclude compacted history; these
counts describe paired records before folding, not visible rows or full-history
coverage. No provider sessions were started and no UI implementation changed.

### Confirmed retained-record failures

| Display | Rejected paired records | Cause and user-visible consequence | Introduced |
| --- | ---: | --- | --- |
| ViewImage | 21 | Result arrays fail eligibility; valid file actions and stored media are bypassed. | `ee42f7f7f` |
| Exec | 16 | Result schema permits only text blocks, so mixed text/image arrays hide stored media behind raw JSON. Eight are in the original incident session. | `ee42f7f7f` |
| WriteStdin / wait | 2 | Detached code-mode results are arrays, but the schema accepts only strings/objects. The compact Shell presentation is replaced by raw inspection. | `ee42f7f7f` |
| Edit / apply_patch | 4 | Code-mode acknowledgement arrays fail the result gate even with usable `_rawPatch`, `_structuredPatch`, and `_diffHtml` on input. | `dedea8fa7` |

The original incident session passed through `compileTranscriptProjection`
still produces 13 rejected ViewImage rows and eight rejected Exec rows.
Session `01a08a4c-be06-7f13-a89e-057720815290` retains one rejected Shell row
after folding. Session `01a08b3b-04d4-7481-8f06-0d6ae5fd6098` retains one
rejected Edit row with input-side diff augmentation. Example call ids:
`call_zPqeUiKTVAhSPmxE098U7F0u` (Exec),
`call_PbKaBlAFZO7uwHPuL49FcrpR` (wait record), and
`call_DRGvE2ZK8Dncyv4g4TSee2eZ` (Edit). Keep private output/path contents out of
checked-in fixtures; preserve their structural shapes in sanitized specimens.

An in-memory comparison against the contract implementation immediately before
`ee42f7f7f` confirms rich-to-raw changes for ViewImage, Exec, and WriteStdin.
Edit arrays were already rejected by the initial #124 patch. Before that patch,
the Edit renderer could derive its diff from the input without consuming the
acknowledgement array. Both September 10 commits therefore need coverage in
the regression baseline.

The sampled Claude records (Bash, Read, WebFetch, WebSearch) produced no raw
eligibility failures. This does not establish coverage for other Claude tools
or providers, live-only shapes, commentary transforms, or browser interactions.

### Source-level compatibility losses requiring targeted specimens

- **Nullable Edit original file:** shared `EditResultSchema` explicitly permits
  `originalFile: null` for new files, and the renderer supports optional/null
  original context. The display schema rejects it. A data-only probe confirms
  rejection both now and immediately after `dedea8fa7`; no matching retained
  record was found in the sampled windows.
- **Shell input aliases disappear:** `WriteStdinRenderer` reads `cellId`,
  `command`, and `cmd` as fallbacks. The new input schema strips all three;
  `{ cellId: "cell-42", command: "pnpm test" }` parses successfully to `{}`.
  This loses the supported target/command display without triggering fallback.
- **Pending goal budget disappears:** the create-goal renderer accepts
  `tokenBudget` as well as `token_budget`, but its input schema keeps only the
  latter. `{ objective: "Check", tokenBudget: 1000 }` loses the budget before
  rendering. No sampled native call established current provider use of this
  alias; record it as a supported-input regression, not an observed incident.

These alias losses start with `ee42f7f7f`. Probe each supported spelling through
actual prepared callbacks before deciding whether to preserve it or explicitly
retire an unused compatibility promise. Do not count every stripped unknown
field as a regression: only fields with an observable consumer qualify.

### Why existing verification missed these cases

- Exhaustive registration/variant enumeration is bounded by its fixtures.
  ViewImage uses `null`; the reconstructed native case substitutes
  `"Image displayed"`. Exec covers text-only results. Real code-mode envelopes
  need independent specimens for promoted tools as well as generic Exec.
- The all-or-nothing result gate runs before safe input-side actions and media.
  It turns a narrow parsing limitation into loss of unrelated usable UI.
- `toolDisplayDiagnostics` counts thrown exceptions, not schema rejection.
  Zero catches/page errors therefore does not prove rich presentation survived.
  The advisory validator also has no ViewImage, Exec, or WriteStdin schema and
  treats an absent schema as valid; it cannot diagnose these display rejections.
- Existing browser checks verify width, recovery, and selected semantics. They
  do not assert a compact fallback height or preserve media on rejected results.
  Add rejection-reason assertions for fixtures expected to remain rich, without
  conflating intentionally rejected malformed records with regressions.

Actual failed calls without a declared failure presentation deliberately use
raw inspection under tactical 124. Treat their excessive default expansion as
the shared fallback UX issue; do not automatically label every such rejection
as an unsupported successful-result regression.
