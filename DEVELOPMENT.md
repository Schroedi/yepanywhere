# Development

This is the shared contributor guide for humans and agents. Read it before
planning implementation or making repository changes, including documentation
and configuration changes. Read the applicable topic documents before choosing
an approach. General discussion and read-only orientation do not require the
full development workflow; applicable topic-reading triggers still apply.
[AGENTS.md](AGENTS.md) supplies the agent entry rules.

Navigation:

- [Project context](#project-context), [setup](#setup), and [commands](#commands)
- [Contribution ethos](#contribution-ethos-minimalist-runtime),
  [architecture](#architecture), and [compatibility review](#clientserver-compatibility-review)
- [Verification](#after-editing-code), [formatting](#biome-formatting-is-a-repository-invariant),
  [CSS](#client-css), and [i18n](#client-i18n)
- [Documentation contracts](#observable-behavior-contracts) and
  [commit guidance](#commit-message-guidance)
- [Runtime configuration](#port-configuration), [logs](#server-logs), and
  [releases](#releasing-to-npm)

## Project Context

For cross-project context (how this project relates to other Kyle projects), see `~/code/dotfiles/projects/README.md`.

A mobile-first supervisor for Claude Code agents. Like the VS Code Claude extension, but designed for phones and multi-session workflows.

**Key ideas:**
- **Server-owned processes** — Claude runs on your dev machine; client disconnects don't interrupt work
- **Multi-session dashboard** — See all projects at a glance, no window cycling
- **Mobile supervision** — Push notifications for approvals, respond from your lock screen
- **Self-contained core** — The server/web app needs no hosted account or
  Firebase dependency; the optional published native app uses its separate
  hosted push broker for platform notifications

**Architecture:** Hono server manages Claude SDK processes. React client connects via WebSocket for real-time streaming. Sessions persist to jsonl files (handled by SDK).

For UI rendering-boundary and shared-view decisions, see
[UI architecture](topics/ui-architecture.md).

**Remote access:** Two connection modes:
- **Direct (Tailscale/LAN)** — Client connects to server WebSocket directly
- **Relay** — Client connects through a relay server (`packages/relay/`). SRP (Secure Remote Password) authenticates without exposing the password to the relay. All messages are end-to-end encrypted with NaCl (XSalsa20-Poly1305) so the relay sees only opaque ciphertext.

For detailed overview, see [`docs/project/`](docs/project/). Historical vision docs in
[`docs/archive/`](docs/archive/).

## Setup

Use Node.js `^22.16 || ^23.11 || >=24.10` (a maintained LTS is recommended).
See [server runtimes](topics/server-runtime.md) for Bun and remote upgrade guidance.

```bash
git clone https://github.com/kzahel/yepanywhere.git
cd yepanywhere
pnpm install
pnpm dev
```

Open http://localhost:3400 in your browser.

If you only want the main app and do not want to install the relay workspace, use:

```bash
pnpm setup:core
pnpm dev
```

## Commands

```bash
pnpm setup:core       # Install root + client + server + shared, skipping relay
pnpm dev              # Start dev server
pnpm lint             # Biome linter
pnpm format:check     # Biome formatter verification (does not write)
pnpm format           # Intentionally format all tracked supported files
pnpm typecheck        # TypeScript type checking
pnpm test             # Unit tests for non-Android workspaces
pnpm --filter @yep-anywhere/android test # Android unit tests
pnpm test:e2e         # E2E tests
pnpm references:sync  # Clone/sync upstream source to pinned provider versions
pnpm references:check # Verify local references match pinned provider versions
```

## Contribution Ethos: Minimalist Runtime

Running code — everything outside test/build tooling — is hand-built and lean on
dependencies. Before adding a runtime dep:

- **Narrow-scope utilities**: prefer a ~100-line hand-rolled implementation over
  a package. SGR parsers, debounces, small date helpers, tiny encoders — code
  them. A dep's long-term reading/audit cost usually exceeds the one-time write.
- **Exemptions**: don't hand-roll crypto (bcrypt, NaCl), auth protocols
  (SRP-6a), web frameworks (Hono), syntax highlighting (Shiki), or the official
  provider SDKs. Use the audited/canonical implementation.
- **Client bundle**: mobile-first — anything entering the client bundle must
  justify its payload. Prefer server-side rendering.
- **Mobile interaction**: visible controls and list rows must remain practical
  touch targets. Compact desktop density is acceptable only if mobile users can
  still tap the intended item without precision aiming; verify spacing-sensitive
  UI on a narrow viewport before landing.
- **Client rendering**: rich renderers should operate on block/tool-sized input
  and return cheap metadata they already know, such as whether output changed.
  Reuse a first completed scan for both control decisions and display instead
  of rendering once to decide whether a toggle exists and again to show it. See
  [packages/client/RENDERING_PERFORMANCE.md](packages/client/RENDERING_PERFORMANCE.md).
- **Dev-deps**: tooling (vitest, biome, playwright, tsx, types) doesn't ship to
  users; lower bar applies.

Rule of thumb: if a dep is essentially a one-file helper, write the file.

## Architecture

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the entry-point map of how
provider events flow through the server to the client, the transport modes,
and the large-scope refactor proposals. Read it before changing message-flow
or render-path code.

Before fielding a user request to improve **stability**, **performance**, or **security**, read `ARCHITECTURE.md` first. Check whether the issue is already addressed in the large-scope refactor proposals or the per-doc cleanup tables, and whether a relevant trigger condition has now been met. If the proposed work would touch a load-bearing piece named in `ARCHITECTURE.md` (fan-out, replay buffer, streaming throttle, transport framing, auth state), prefer reading the linked detailed doc and surfacing the existing trade-off to the user before writing code.

## Architecture Mandates

Before modifying background loops, watchers, polling, retry timers, heartbeat
scheduling, session liveness, client stream/reconnect behavior, or server
catch-up paths, read `topics/architecture-mandates.md`. In particular, an idle
provider session and a closed client tab must never indefinitely consume server
resources.

## Project Directory Storage

Before adding or changing any YA-managed write inside a selected project or
its Git metadata, read `topics/project-directory-storage.md`. App-data-only is
the default: browsing, rendering, replaying, indexing, caching, and preserving
viewer state must not create `.yep`, `.attachments`, Git excludes, or YA-owned
refs. A helper that creates or excludes a directory is not authorization;
project-local storage requires the explicit global opt-in, and feature-level
retention choices remain separate.

## Provider Session Identity

YA URL session ids are the canonical user-facing session ids. Provider-native
ids such as OpenCode `ses_*`, Codex thread ids, or other backend resume handles
may be stored and passed back to the provider for resume, export, or debugging,
but they must not silently replace the YA-visible session id in URLs, persisted
YA metadata, REST/WebSocket payloads, or UI copy. If a provider truly requires
using its own id as a public/session id, document that exception in the
provider contract and make the mapping explicit in the UI/debug surfaces.

## Vanilla Defaults

`topics/vanilla-defaults.md` is the overarching UX theory governing every new
user-visible feature. Out of the box, YA must feel exactly like the first-party
provider UIs users already know (Claude Code TUI, claude.ai, Codex): a
first-time user must not have to learn, or even notice, a new concept. Any
YA-novel user-visible behavior — including anything that modifies the user's
submitted text before it reaches the provider — ships configurable and
default-off. Narrow carve-out: an established cross-harness convention that
stays invisible until the user deliberately invokes it (e.g. a `!!`
shell-escape prefix, echoing Claude Code's `!` bash mode) is not YA-novel and
may ship always-on; any discoverable surface it adds (a sidebar entry) still
ships default-off. A configurable, visible resource-protection limit may also
default safer than the first-party harness only when invisible nested fan-out
can cause unpredictable token or quota burn, the provider default remains an
explicit choice, and the Maintainer has authorized the exact exception. See
`topics/vanilla-defaults.md` § Known Exceptions. A believed-but-unproven
benefit earns an option, never a default.
Novel features remain welcome; do not assume first-party harnesses already
cover all useful behavior. Read the topic before adding or enabling any
user-visible feature that is not configurable default-off.

## Client/Server Compatibility Review

Hosted clients can update before installed servers.

Before making the client depend on a server route, response field, event, or
changed semantic that is absent from a supported stable release, read
`topics/server-capabilities.md` and `topics/remote-hosted-compatibility.md`.
Identify whether the feature is core or optional and inspect every stable
server release in the applicable minimum horizon:

- optional features: the latest two stable releases and every stable release
  from the preceding 14 days;
- core functionality: the latest two stable releases and every stable release
  from the preceding 60 days.

Then present a compatibility plan before editing the client/server contract:
name the releases, new routes/fields/events, proposed capability or protocol
gate, exact behavior when it is absent, and whether any existing capability
meaning or older capable fallback changes. Pause for maintainer approval. An
originating request that already states and approves those decisions satisfies
the pause; do not ask twice.

Use an available structured async or blocking question form for this approval.
Use plain text only when neither question form is available.

Never expand an already-advertised capability to cover a contract older servers
do not provide. A new client must not call a new endpoint until its gate is
known present. Passing a support horizon permits human review only; it never
automatically removes a fallback or raises a compatibility floor. Security
exceptions follow `topics/hard-development-rules.md`.

Default a new global capability to `version-implied` when every official build
from its introducing release onward provides the contract. Use an explicit
sparse capability bit only when support is clearly experimental or
withdrawable, or can vary by build, host, or configuration. A version-implied
capability still receives a permanent ID for registry identity and source-ahead
advertisement, but released peers normally infer it from the version and do not
send a positive ID. An exceptional withdrawal uses the standard negative
capability set; do not classify anticipated variability as version-implied.

Suggested approval prompt:

> Compatibility review for `<feature>`: releases `<corpus>` lack
> `<routes/fields/events>`. I propose `<capability/protocol>`; without it the
> client `<fallback>` and makes no unsupported requests. Existing capability
> meanings and older capable behavior remain unchanged. Approve?

## Hard Development Rules

Follow `topics/hard-development-rules.md` for binding upstream-facing
development rules. Read it before changing deployment-sensitive defaults,
configuration precedence, relay or endpoint selection, provider/model settings,
hosted-client endpoint selection, migrations, or maintainer-specific deploy
configuration.

## Codex Version Bump Audit

Treat `package.json` `yepAnywhere.codexCli.expectedVersion` as the repo's
declared Codex CLI target version. When that value increases, or when Codex
API/protocol docs or checked-in Codex protocol files have changed in a way that
plainly implies a newer target version, do a routine compatibility check before
making YA source changes that respond to the Codex-side change.

The routine check may be automatic and read-only at first: inspect the
Codex-facing surfaces that are most likely to drift, especially
`packages/server/src/sdk/providers/codex*`,
`packages/shared/src/codex-schema/`, generated protocol files, and related
tests/scripts such as `scripts/update-codex-protocol.mjs`. A preliminary audit
that only identifies likely drift can happen immediately without asking first.

Before actually editing YA code for that compatibility work, pause and ask the
user whether they want the audit enacted now. Quote a prompt they can approve
or reuse, for example: "Audit YA for Codex CLI/API changes from <old> to <new>:
compare the changed Codex docs/files against our Codex-facing types, protocol
definitions, generated files, and tests; update whatever is needed for
compatibility; then summarize the behavioral changes, risks, and follow-on work."

Also state the likely benefit in one sentence, e.g. that this catches protocol
or schema drift early and reduces silent breakage in YA's Codex integration.

After any provider-refresh pass for Codex or Claude, update the tracked
compatibility marker in root `package.json`:

- `yepAnywhere.codexCli.compatibleThroughVersion` records the latest Codex CLI
  version whose YA-visible app-server protocol, model catalog, and runtime
  assumptions were checked or updated.
- `yepAnywhere.claudeCode.compatibleThroughVersion` records the latest Claude
  Code runtime version whose YA-visible SDK/package, model/command, and
  transcript/control assumptions were checked or updated; keep
  `yepAnywhere.claudeCode.claudeAgentSdkVersion` paired with the committed
  `@anthropic-ai/claude-agent-sdk` dependency when the SDK is refreshed.

This marker is the committed "compatible through / up to date as of" answer for
future minor-version checks. For Codex, keep `expectedVersion` in sync with
source/protocol refreshes that change the audited app-server target; a no-op
audit may advance only `compatibleThroughVersion` if the checked-in source did
not need to change.

## Reference Source

`references/` holds upstream source cloned for local reading. It is gitignored
and absent on a fresh checkout, so never assume a given repo is present. When
working on the Codex provider — schema, scanner, normalization, app-server
protocol (`packages/server/src/sdk/providers/codex*`,
`packages/shared/src/codex-schema/`, generated protocol files) — inspect the
Codex Rust source rather than guessing from YA behavior. Run `pnpm
references:sync` to shallow-clone or align `references/codex` with the official
`rust-v<expectedVersion>` tag derived from `package.json`, then grep it
directly. `pnpm references:check` verifies alignment without changing the
checkout. The sync command refuses to overwrite local changes. When
deliberately comparing a newer Codex version, state that mismatch explicitly
and do not treat it as evidence for the pinned runtime without checking the
matching tag. The Claude SDK is not open source, so it is not included.

The Codex Rust source is `codex-rs` under `references/codex`.
`pnpm clone-references` remains an alias for the sync command.

## After Editing Code

After editing TypeScript or other source files, verify your changes compile
and pass `pnpm lint`, `pnpm format:check`, `pnpm typecheck` (no emit), and
`pnpm test`. For UI changes, also run `pnpm test:e2e`.

For site changes (marketing pages in `site/`):

```bash
cd site && npm run build   # Astro check + build (or: pnpm site:build from root)
```

Fix any errors before considering the task complete.

The general CI unit-test job runs `pnpm test`. Android unit, lint, build, and
instrumentation coverage belongs to the dedicated Android App workflow so its
Gradle work does not contend with the JavaScript workspace test processes.
Android JVM unit-test tasks have a five-minute task timeout and emit per-test
lifecycle output so a stalled worker fails with attributable evidence.

Environment-dependent subprocess tests must control both the child environment
and relevant process descriptors. In particular, Bash `BASH_ENV` probes use
ignored stdin rather than inheriting a test runner's socket-backed stdin. See
[subprocess environment boundaries](topics/subprocess-environment.md) for the
runtime and hermetic-test contract.

## Cross-Platform Behavior And Tests

Treat Linux, macOS, and Windows as supported development targets. Code and
tests must not assume that the current host's filesystem, descriptor, process,
or shell behavior is portable. Pay particular attention to path syntax and
case handling, symlinks, `/proc` and `/dev/fd`, permissions and file locking,
signals and process trees, executable discovery, temporary directories, and
shell availability.

For every OS-sensitive change, either use portable APIs and cover all three
platforms, or make the narrower capability explicit: document it, gate native
tests by platform or capability, and test the supported fallback on the other
platforms. Passing on one contributor's OS is not sufficient evidence. When
other-OS validation is unavailable, state that limitation in the handoff.
Never weaken a security boundary merely to make another platform pass.

## Device Control Testing

Use the Android emulator only when testing the device-control/device-bridge feature. Check with `source ~/.profile && adb devices` and deploy/test on the emulator for changes that touch device streaming, `/api/devices`, `deviceBridge`, or `packages/device-bridge`. For general client, server, web UI, provider, relay, or rendering changes, do not require emulator testing.

## ChromeOS Debugging

For Chromebook testing and debugging (screenshots, input, diagnostics), use the chromeos-testbed CLI — NOT the browser control skill (which is for local headless Chromium).

```bash
~/code/chromeos-testbed/bin/chromeos screenshot              # saves screenshot, prints path
~/code/chromeos-testbed/bin/chromeos screenshot output.png   # saves to output.png
~/code/chromeos-testbed/bin/chromeos help                    # full command list
```

Requires SSH access to `chromeroot`. See `~/code/chromeos-testbed/CLAUDE.md` for details.

## Performance Measurement Hosts

Before treating benchmark output as regression evidence, read
`topics/performance-regression-suite.md`. The host need not be fully
uncontended, but the run must record its automatic capacity key plus start/end
CPU pressure, load, available physical/effective RAM, and swap evidence, with
enough headroom for the scenario. If contention is uncertain, run a small
speculative sample first and expand only when it reproduces. Compare historical
baselines and machine-specific ratchets only within one capacity key; portable
checked-in ceilings may run on any host whose samples show enough headroom, but
they are not same-machine historical evidence.

Small low-cost cloud instances may be created for performance verification
without a separate permission question. The launch still gets the normal
big-effect gate record and must install an external TTL or cleanup guard before
the instance starts. Record provider, region, instance class, and instance ID;
verify deletion after success or failure, including attached disks, reserved
addresses, and other paid resources.

## UI Design And Mockup Proposals

For requests about proposed UI appearance or interaction, including "thoughts
on the UI for X", or requests to author/export a mockup, read
[topics/ui-design.md](topics/ui-design.md) before choosing the fixture,
rendering, or export commands. It supplies the project component/style owners
and verified facility. For an already-built HTML artifact, use
`pnpm -s artifact:capture <entry.html> --json` (acli `+commentary`). With
Tool commentary enabled on a supporting YA server, the call itself presents
the file-viewer link, capture links, and image previews beside its output;
do not repeat that handoff in a separate assistant message. Inspect its desktop
and phone PNGs sequentially before claiming visual quality. When commentary
presentation is unavailable, present the returned Markdown links yourself.
Supply `--ya-url` only for a known YA server when interactive delivery is
wanted; disabled/unconfigured hosting skips health and grant requests. Include
the artifact URL and expiry when the command creates one, retaining the
file-viewer link for later reopening. The topic owns authentication options,
delivery, and preview settings. A source file or dev-server URL alone is not
a viewable mockup handoff. Respect explicit prose-only requests and the user's
visual-verification handoff.

## UI Tweak Visual Verification

Use an available browser-control capability for interactive web UI testing. If
browser setup or discovery reports that no browser is available, or the browser
inventory is empty, do not stop or keep retrying a desktop-only backend.
Immediately fall back to YA's installed Playwright dependency.

Before browser verification, read `topics/ui-testing.md`.
For multi-step interaction testing, add or run a focused `@playwright/test`
case under `packages/client/e2e/`.

By default, any UI tweak or layout/control-placement request ends with rendered
browser captures of the final result at 1000×600 and a phone width (375×812),
inspected by the agent against the request before claiming completion. Read and
inspect the captures sequentially, one image at a time; never batch image reads.
In-progress captures are optional.

Take those captures with `pnpm -s artifact:capture <url> --json`. One call
serves both readers: the agent opens the returned PNGs to judge the result, and
the maintainer examines the same capture through the links and previews the
call presents beside its output. A hand-rolled `playwright screenshot` pair
writes files only the agent can read, so the maintainer sees nothing and has to
ask for the pictures.

Run final captures against a fresh dev-server process started from the current
worktree; do not reuse an already-running server. Use an unused port and, when
needed, a disposable data directory so the user's live server stays untouched.
A capture containing the `Server changed` banner or another stale-runtime
indicator is invalid: restart fresh and recapture.

An explicit user handoff overrides this default. If the user says they will
visually verify the result or asks to skip screenshots or visual validation, do
not capture screenshots or launch a browser solely for visual QA. Continue
relevant nonvisual checks, and state in the final response that visual
verification was left to the user rather than claiming it was performed. Do
not cite this repository default as a reason to disregard that handoff.
Protocol, commands, scope, and archive paths: `topics/ui-testing.md`.

## Zero-Warning Commits

Before committing, the checks you run must be warning-free, not merely
passing: `pnpm lint` reports zero warnings, and test runs covering the
touched areas emit no runtime warnings (React "cannot update while
rendering", "not wrapped in act(...)", and similar). Fix the cause rather
than suppressing the report; a warning that must stand needs an inline
justification.

“Pre-existing” is provenance, not an exemption. When a task's checks expose
warnings or source-format debt that can be safely isolated, clear them in a
separate cleanup commit instead of carrying them forward or folding them into
the behavior change. Use the owning formatter for source rewrites (Biome in
the current TypeScript/JavaScript tree; Ruff wherever a Python surface adopts
it). If the cleanup cannot be isolated safely, record the exact warning or
format check and the reason it remains in `gaps/`.

## Biome Import/Export Ordering

Do not apply Biome's organize-imports/exports assist as a routine cleanup.
Keep import/export edits scoped to the symbols needed by the change. Whole-file
ordering churn, especially in barrel files, obscures review and carries no YA
runtime-safety benefit. Run the project lint wrapper for diagnostics, but do not
turn a one-line import or export addition into a broad reorder solely to satisfy
organize-imports advice.

## Biome Formatting Is A Repository Invariant

`pnpm lint` remains a lint-only diagnostic command. `pnpm format:check` is the
separate non-writing formatter check, and CI requires both to pass. `pnpm
format` is the intentional repository-wide writer: the wrapper expands `.` to
the current tracked files and runs `biome format --write` over them.

During feature work in a shared or dirty worktree, format only the exact files
you edited:

```bash
node scripts/biome.cjs format --write path/to/file.ts path/to/other.tsx
```

Do not pass a directory or `.` for routine feature work, and do not use
`biome check --write` as a substitute: `check` combines additional concerns
that are intentionally separate here. A clean whole-repository `pnpm format`
is appropriate only for deliberately establishing a baseline or applying a
formatter-version migration.

Keep a broad mechanical rewrite in its own commit, time it against open PRs and
known in-progress work, and add its full hash to `.git-blame-ignore-revs` in a
follow-up commit. Never add a mixed behavior-and-format commit to that file.
The revision list is committed; GitHub honors it automatically, but local
Git does not enable it automatically.
Opt this checkout in with `git config --local blame.ignoreRevsFile
.git-blame-ignore-revs`, or pass `--ignore-revs-file .git-blame-ignore-revs`
to an individual `git blame` invocation.

## Client I18n

When adding or changing client UI copy, add English entries in
`packages/client/src/i18n/en.json` and render them through `useI18n().t(...)`
for user-facing sentences, labels, headings, placeholders, tooltips, and aria
text. Do not force brand names, provider names, keyboard keys, terminal commands,
code tokens, protocol values, or source-like renderer text into i18n keys unless
the surrounding copy needs translation.

Add new strings to `en.json` only. Missing keys in the other locale files
fall back to English at runtime, and non-English locales are batch-updated
before a release (a maintainer step). Do not hand-translate per-locale
entries during feature work.

Non-English locales are sparse overlays; maintainer translation updates add
locale values only when an actual translation is available.

Run `pnpm i18n:scan` for a permissive advisory scan of likely raw English prose
in client TSX. It hides low-priority technical labels by default; inspect those
with `pnpm i18n:scan -- --include-info`. Use
`--max-warnings <n>` only when intentionally ratcheting it toward a blocking
check.

To review untranslated sparse-locale backlog without enforcing it on ordinary
code changes, run:

```bash
pnpm i18n:missing
pnpm i18n:missing -- --markdown --limit all > reports/i18n-missing-$(date +%F).md
```

`i18n:missing` reports English keys absent from non-English locale overlays and
always treats missing translations as advisory. Use this for daily or weekly
translation planning rather than as a blocking lint rule.

## Client CSS

Before adding or changing client styles, read `topics/css-architecture.md`.
Component-owned styles use co-located `*.module.css` files. The existing global
client stylesheets are frozen at ratcheting line-count ceilings: feature work
must extract enough legacy CSS to offset any unavoidable addition and must
never raise a ceiling as routine development.

Run `pnpm css:check` for client style changes. When an extraction lowers a
legacy file's line count, run `pnpm css:check --record` in the same change.
New non-module client stylesheets require an explicit documented exception in
the CSS architecture baseline; generated markdown/provider markup may keep its
narrow global vocabulary, but surrounding React-owned UI still belongs in a
module.

Generated HTML vocabularies, themes, tokens, and document-level rules may
remain global under the narrow exceptions in
[`topics/css-architecture.md`](topics/css-architecture.md).

When changing a React component that still emits legacy global classes, or
when editing a legacy stylesheet, run `pnpm css:touched` before finishing. It
uses the current diff to distinguish bounded opportunities from coupled,
scattered, dynamic, or unresolved ownership. Drill into a reported owner with
`pnpm css:inventory -- --owner <component>`. Opportunistically extract a
clearly owned slice when it stays within the task's product surface and can use
the task's existing verification setup. Do not expand the task through
generated markup, open-ended dynamic classes, broad composition, or unprovable
visual states;
state the concrete deferral reason in the final handoff instead. Fresh
inventory, not a standing migration queue, decides whether a later extraction
is worthwhile.

`pnpm css:modules:check` is also part of `pnpm lint`. It blocks undeclared,
production-unused, test-only, unimported, computed, and side-effect module
usage, plus `:global(...)` references that are missing or lack a local anchor.
Use `pnpm css:unused` for the broader investigative report; its known legacy
findings are advisory and do not make ordinary lint fail.

The dedicated migration campaign is complete. Zero global CSS is not a
target.

`pnpm css:touched` compares the working tree with `HEAD`; pass `--base <ref>` to
include committed branch work from that ref's merge base. It prints concise
ownership facts for changed React owners, labels bounded slices as
opportunities, and labels coupled, scattered, dynamic, or unresolved evidence
for deferral. The report is advisory and always succeeds for either outcome.

For standalone paydown work, select a bounded owner from the parser-backed
inventory instead of maintaining a speculative migration queue:

```bash
pnpm css:inventory
pnpm css:inventory -- --owner <component-or-path>
```

The inventory is advisory. Inspect its coupled, generated, unresolved, dynamic,
and test-reference findings before defining a slice. The full selection and
verification protocol lives in the CSS architecture topic.

If the touched component is not a safe extraction candidate, record the
specific reason in the change handoff rather than adding it to a migration
queue. CSS health is evaluated on demand across containment, ownership,
module-contract, escape-hatch, dead-code, and shipping-size signals; the global
line ratchet is one guardrail, not a complete progress score.

For a CSS-focused review or occasional architecture audit, run:

```bash
pnpm css:health
```

This composes the existing analyzers into a human-readable summary; `--json`
is available for a one-off comparison. It reports separate facts rather than a
score and does not build the client, persist results, or fail on observational
debt. Continue to use `css:check`, `lint`, and `css:unused` for their own exit
contracts.

## Client Console Chatter Budget

When a change touches `packages/client`, or a client console looks
chatty, run `pnpm console:scan` with the pre-commit checks and read
[`topics/console-chatter.md`](topics/console-chatter.md) — it carries
the budget policy, the remediation preference order, the measurement
tools, and the ratcheting baseline.

## Observable Behavior Contracts

Before an implementation is complete, verify that every intentional observable
behavior it adds or changes is covered by a contract in the owning
`topics/*.md`; update or create that contract when it is not. State externally
testable outcomes and constraints, including deliberate failure or fallback
behavior, rather than implementation narration. Tests and commit messages are
evidence and history, not substitutes for the product contract.

## Naming Steps In Tactical Plans

Name every step in a `docs/tactical/*.md` plan for the product surface or the
work it covers — "source-control chrome", "delete the dead git-status rules",
"teach the unused-CSS report about modules". Number them in recommended order
if a handle is useful, matching the house form `### 4 — map source-control CSS
ownership`.

Do not invent a private code scheme. Lettered lanes with numbered slices
(`A1`, `C1.5`, `F0`) force every reader — including the maintainer who asked
for the plan — to hold a lookup table in their head before they can discuss the
work, and the letters convey nothing on their own. Group related steps under a
plain heading instead. If a step's name is hard to write, that usually means
its boundary is not yet decided.

Reusing a scheme that already exists in a document you are editing is fine;
extending it into a new document is not. When you rename, leave one compact
mapping table so older commit messages stay traceable.

## Retiring Completed Tacticals And Gaps

A `docs/tactical/*.md` whose work is landed, validated, and working has no
remaining job as a plan. Retire it by first migrating its durable content —
the contracts, invariants, and design reasoning a later reader still needs —
into the owning `topics/*.md`, then deleting the file in that same commit.
What does not survive the migration is a finished todo list and its recon
notes, which the tree and git history already record. Migration first is the
whole procedure: a deletion that skips it loses knowledge nothing else holds.

Retiring is periodic or at-will, never obligatory — a completed plan may be
kept, and some carry enough durable design to serve as a topic doc would.
Retire only plans you authored; leave another author's completed plans alone
unless they ask.

`gaps/*.md` is stricter: the entry is deleted in the commit that fixes it
(`gaps/README.md`).

A `topics/*.md` or a code comment that names a retired file needs no scrub.
The path stays a searchable handle:
`git log --diff-filter=D -- docs/tactical/<name>.md` finds the removal, and
`git show <sha>^:docs/tactical/<name>.md` prints the file back.

## Commit Message Guidance

Do not add assistant co-author trailers or generated-with banners. Preserve
explicitly required provenance such as `Contributing-model:` when applicable;
that trailer is not a generated-with banner.

Aim for a <=65 char subject, and strictly enforce a 72-column line wrap
for the body. Prefer bullet lists in the commit body when items are
numerous or complex; prose when the content is short and simple.

**Maintainer**, here, means the human reviewer or a future agent
(possibly you) re-reading this commit to understand or re-derive the
change.

For non-trivial commits, include a concise excerpt or synthesis of the
originating instruction (or motivating observation, when the change
wasn't user-prompted) that is feasible to land in the committed
changes. Summarize the motivating request and key implementation
direction so a Maintainer could paste the message, add their own
adjustments, and recreate something close to the intended result. Prune
digressions, secrets, and low-signal chat detail; do not aim for a
verbatim or exhaustive transcript.

The subject line is the conventional scannable headline result — keep
it scannable in `git log --oneline`. The synthesis lives in the body.
The 72-column body wrap applies to synthesis prose as well.

**Exemption**: skip the synthesis for mechanical or small + self-evident
changes — formatter passes, typo fixes, version bumps, trivial renames
with no substantive user direction. The conventional one-line message
alone is sufficient there.

**Series threading**: when a commit is part of a related series, append one
or more `Topic: <string>` trailers at the bottom of the body. The topic
string is freeform (descriptive phrasing fine; not constrained to a short
UPPERCASE codename). A series shares the exact same topic string across
its commits for each topic name you include; "first in wins": later
commits copy their topic lines verbatim so `git log --grep "Topic: ..."`
finds the chain. Use multiple `Topic:` lines when one commit touches
multiple topics, and switch a given topic only when it's obviously time for a
new one. Standalone commits with no expected follow-up: no trailer.

Example:
```
... body text ...
Topic: session-liveness
Topic: provider-model-glyphs
```

To avoid accidentally reusing a topic for an unrelated series, keep a
project-level `topics.md` log at the repo root and append each new
topic string to it when the series begins. The log is appended to
whether or not it's tracked in git. Format is freeform (not a
traditional ChangeLog) — typically a bulleted list with optional
one-line notes. Scan `topics.md` before opening a new series.

## Dependency Security Maintenance

CI runs `pnpm audit --prod` on every push (the `audit` job in `ci.yml`) and it
must exit 0. Pay special attention to the `web-push -> asn1.js -> bn.js` chain.
Keep `bn.js` patched (currently via pnpm override) until `web-push` ships an
upstream fix.

When a transitive dep has no direct upgrade path, prefer a pnpm override. Pin it
exactly if a newer major would escape the parent's declared range — `fast-uri`
is pinned to `3.1.6` rather than `^3.1.6` because 4.x is published and `ajv`
declares `^3.0.1`. When the parent's declared range already contains the patched
version, no override is needed: refresh the lockfile with
`pnpm -r update <pkg> --depth=Infinity` (plain `pnpm update` skips transitive
deps).

### Install-script allowlist

Dependency install scripts (preinstall/install/postinstall) are blocked by
default via `onlyBuiltDependencies` in `pnpm-workspace.yaml`; only
`bcrypt` may run its native build. `better-sqlite3` 13 ships Node-API binaries
for Linux (glibc/musl), macOS and Windows on x64/arm64, so it is explicitly
listed in `ignoredBuiltDependencies`. pnpm 10 otherwise runs an unnecessary
`node-gyp` configure despite upstream's `gypfile: false`, requiring Visual
Studio even when the Windows binary is already present. Unsupported relay/
broker architectures require a separately reviewed source-build setup.
This neutralizes the `"preinstall": "node setup.mjs"` vector used
by npm supply-chain attacks. If a newly added dep needs its build script,
`pnpm install` warns `build scripts that were ignored: <pkg>` and the
package will be missing its native binary at runtime — vet the script,
then add the package name to the allowlist. Blocked today, each verified
a no-op with no performance fallback: `esbuild` (native binary ships via
`@esbuild/*` optional deps; the postinstall only swaps the bin shim, and
there is no silent WASM fallback), `@firebase/util` (bakes
`FIREBASE_WEBAPP_CONFIG` into web-SDK defaults; unset here), `protobufjs`
(prints a version-scheme warning).

### Known-unreachable advisories

Advisories triaged as unreachable are suppressed via
`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`; that list and this
table must stay in sync — every ignored GHSA needs a row here, and removing a
row means removing the ignore. As of 2026-09-08 three advisories are triaged as
unreachable with no fix compatible with YA's current dependency and runtime
constraints. Re-check when the listed trigger fires rather than re-deriving the
analysis:

| Advisory | Why unreachable | Revisit when |
|---|---|---|
| `react-router` RSC-mode CSRF (GHSA-qwww-vcr4-c8h2) | Client is SPA-only — `BrowserRouter`/`Routes`, no `createBrowserRouter`, RSC, or server actions | Migrating to react-router v8. The fix lands in 8.3.0 and `react-router-dom` never reaches it (v8 consolidated into `react-router`) |
| `@hono/node-server` serve-static traversal (GHSA-frvp-7c67-39w9) | `serveStatic` is never imported; only `serve`, `getRequestListener`, `HttpBindings`, `RESPONSE_ALREADY_SENT` | `@hono/node-ws` supports node-server 2.x — its peer is currently `^1.19.11`, so 2.x breaks the WebSocket path |
| `uuid` buffer bounds (GHSA-w5hq-g745-h8pq) | Only path is `firebase-admin -> @google-cloud/storage -> gaxios@6`, which calls `uuid.v4()` with no arguments; the defect needs v3/v5/v6 with a caller-supplied `buf`. Patched only in `>=11.1.1`, outside gaxios 6's `^9` range | `firebase-admin`/`gaxios` declare uuid `>=11`, or a 9.x patch release appears |

Anything not on this list is untriaged — treat a new advisory as actionable.

## Port Configuration

All ports are derived from a single `PORT` environment variable (default: 3400):

| Port | Purpose |
|------|---------|
| PORT + 0 | Main server (default: 3400) |
| PORT + 1 | Maintenance server (3401 by convention; only runs when `MAINTENANCE_PORT` is set) |
| PORT + 2 | Vite dev server (default: 3402) |

To run on different ports:
```bash
PORT=4000 pnpm dev  # Uses 4000, 4001, 4002
```

Individual overrides (rarely needed):
- `MAINTENANCE_PORT` - Port for the maintenance server; unset or 0 means it does not run
- `VITE_PORT` - Override vite dev port

## Data Directory

Server state is stored in a data directory (default: `~/.yep-anywhere/`). This includes:
- `logs/` - Server logs
- `indexes/` - Session index cache
- `uploads/` - Uploaded files
- `session-metadata.json` - Custom titles, archive/starred status
- `notifications.json` - Last-seen timestamps
- `push-subscriptions.json` - Web push subscriptions
- `vapid.json` - VAPID keys for push
- `auth.json` - Authentication state (password hash, sessions)

Follow [Project Directory Storage](#project-directory-storage)
for the app-data default and explicit global opt-in for project-local storage.

### Running Multiple Instances

Use profiles to run dev and production instances simultaneously (like Chrome profiles):

```bash
# Production (default profile, port 3400)
PORT=3400 pnpm start

# Development (dev profile, port 4000)
PORT=4000 YEP_PROFILE=dev pnpm dev
```

This creates separate data directories:
- Production: `~/.yep-anywhere/`
- Development: `~/.yep-anywhere-dev/`

Environment variables:
- `YEP_PROFILE` - Profile name suffix (creates `~/.yep-anywhere-{profile}/`)
- `YEP_DATA_DIR` - Full path override for data directory
- `CLAUDE_CONFIG_DIR` - Claude Code config directory (default: `~/.claude`). Use this to point at a Claude Code profile (e.g., `~/.claude-work`). Sessions are scanned from `{CLAUDE_CONFIG_DIR}/projects/`.

Note: By default, all instances share `~/.claude/projects/` (SDK-managed sessions). Set `CLAUDE_CONFIG_DIR` to use a different Claude Code profile per instance.

## Provider & Feature Configuration

Restrict which agent providers and features are available:

```bash
# Only show Claude Code (hide Codex, Gemini, etc.)
ENABLED_PROVIDERS=claude pnpm dev

# Disable voice input (microphone button)
VOICE_INPUT=false pnpm dev

# Combined example: Claude-only, no voice, dev profile
ENABLED_PROVIDERS=claude VOICE_INPUT=false PORT=4000 YEP_PROFILE=dev pnpm dev
```

Environment variables:
- `ENABLED_PROVIDERS` - Comma-separated list of provider names to expose (default: all). Valid names: `claude`, `claude-gateway`, `claude-ollama`, `codex`, `codex-oss`, `gemini`, `gemini-acp`, `opencode`, `grok`
- `VOICE_INPUT` - Set to `false` to disable the voice input button server-side (default: `true`)

## Server Logs

Server logs are written to `{dataDir}/logs/` (default: `~/.yep-anywhere/logs/`):

- `server.log` - Main server log (dev mode with `pnpm dev`)
- `e2e-server.log` - Server log during E2E tests

To view logs in real-time: `tail -f ~/.yep-anywhere/logs/server.log`

All `console.log/error/warn` output is captured. Logs are JSON format in the file but pretty-printed to console.

Environment variables:
- `LOG_DIR` - Custom log directory
- `LOG_FILE` - Custom log filename (default: server.log)
- `LOG_LEVEL` - Minimum level: fatal, error, warn, info, debug, trace (default: info)
- `LOG_FILE_LEVEL` - Separate level for file logging (default: same as LOG_LEVEL)
- `LOG_TO_FILE` - Set to "true" to enable file logging (default: off)
- `LOG_PRETTY` - Set to "false" to disable pretty console logs (default: on)

## Client Console Logs

Remote collection of browser `console.log/warn/error` from mobile clients. Useful for debugging connection issues on devices where you can't open DevTools.

**Enable:** Developer Mode settings → "Remote Log Collection" toggle.

**Storage:** `{dataDir}/logs/client-logs/` (default: `~/.yep-anywhere/logs/client-logs/`). One JSONL file per device per day, named `client-{YYYY-MM-DD}-{deviceId}.jsonl`. The device UUID is persisted in the client's `localStorage`.

Each line is a single log event:
```json
{"timestamp":1770790157738,"level":"log","prefix":"[SecureConnection]","message":"[SecureConnection] Closed: 1006","_receivedAt":1770790161477}
```

A `[ClientInfo]` entry is written on each session start with user agent, screen size, DPR, and language.

```bash
# List device log files
ls ~/.yep-anywhere/logs/client-logs/

# View today's logs for a device
cat ~/.yep-anywhere/logs/client-logs/client-$(date +%Y-%m-%d)-<deviceId>.jsonl

# Follow incoming logs
tail -f ~/.yep-anywhere/logs/client-logs/*.jsonl
```

**Implementation:** `packages/client/src/lib/diagnostics/ClientLogCollector.ts` (client), `packages/server/src/routes/client-logs.ts` (server `POST /api/client-logs`).

## Maintenance Server

A separate lightweight HTTP server can run on PORT + 1 (conventionally 3401) for out-of-band diagnostics, which is exactly when the main server is unresponsive. It is **off unless `MAINTENANCE_PORT` names a port** — set it at launch, because a server that is already wedged cannot be told to open it.

```bash
# Check server status
curl http://localhost:3401/status

# Enable proxy debug logging at runtime
curl -X PUT http://localhost:3401/proxy/debug -d '{"enabled": true}'

# Change log levels at runtime
curl -X PUT http://localhost:3401/log/level -d '{"console": "debug"}'

# Enable Chrome DevTools inspector
curl -X POST http://localhost:3401/inspector/open
# Then open chrome://inspect in Chrome

# Trigger server restart
curl -X POST http://localhost:3401/reload
```

Available endpoints:
- `GET /health` - Health check
- `GET /status` - Memory, uptime, connections
- `GET|PUT /log/level` - Get/set log levels
- `GET|PUT /proxy/debug` - Get/set proxy debug logging
- `GET /inspector` - Inspector status
- `POST /inspector/open` - Enable Chrome DevTools
- `POST /inspector/close` - Disable Chrome DevTools
- `POST /reload` - Restart server

Environment variables:
- `MAINTENANCE_PORT` - Port for maintenance server (default: 0, meaning no maintenance server; PORT + 1 is the usual choice)
- `PROXY_DEBUG` - Enable proxy debug logging at startup (default: false)

## Validating Session Data

Validate JSONL session files against Zod schemas:

```bash
# Validate all sessions in ~/.claude/projects
npx tsx scripts/validate-jsonl.ts

# Validate a specific file or directory
npx tsx scripts/validate-jsonl.ts /path/to/session.jsonl
```

Run this after schema changes to verify compatibility with existing session data.

## Validating Tool Results

Validate `tool_use_result` fields from SDK raw logs against ToolResultSchemas:

```bash
# Validate sdk-raw.jsonl (default location)
npx tsx scripts/validate-tool-results.ts

# Summary only (no error details)
npx tsx scripts/validate-tool-results.ts --summary

# Filter by tool name
npx tsx scripts/validate-tool-results.ts --tool=Edit
```

The SDK provides structured `tool_use_result` objects alongside tool results. These are logged to `~/.yep-anywhere/logs/sdk-raw.jsonl` when `LOG_SDK_MESSAGES=true` is set. Run this script after adding new tool schemas or when debugging tool result parsing.

## Type System

Types are defined in `packages/shared/src/claude-sdk-schema/` (Zod schemas as source of truth).

Key patterns:
- **Message identification**: Use `getMessageId(m)` helper which returns `uuid ?? id`
- **Content access**: Prefer `message.content` over top-level `content`
- **Type discrimination**: Use `type` field (user/assistant/system/summary)

## Releasing to npm

The package is published to npm as `yepanywhere` using GitHub Actions with OIDC trusted publishing (no npm tokens stored in secrets).

**Before releasing:**

1. Update `CHANGELOG.md` with a new version section:
   ```markdown
   ## [0.1.11] - 2025-01-24

   ### Added
   - New feature description

   ### Fixed
   - Bug fix description
   ```

2. Commit the changelog update

3. Tag and push:
   ```bash
   git tag v0.1.11
   git push origin v0.1.11
   ```

The CI workflow verifies the changelog contains an entry for the version being released. If missing, the release will fail with instructions to update the changelog.

The workflow runs lint, typecheck, and tests, then builds with `pnpm build:bundle` and publishes with `--provenance` for supply chain attestation. It also creates a GitHub Release with auto-generated notes.

## Releasing the Website

The website (landing pages + remote relay client at `/remote`) is deployed to GitHub Pages separately from npm. **Pushing to main does NOT deploy the site** — it only runs CI (lint, typecheck, tests). The site only deploys when a `site-v*` tag is pushed (or via manual workflow_dispatch).

See [site/RELEASING.md](site/RELEASING.md) for the full process.

Quick reference:
```bash
# Update site/CHANGELOG.md first, then:
scripts/release-website.sh 1.5.3
```

## Deploying to Staging

The staging deploy runbook is host-specific and intentionally kept out of this public
repo. It lives in the private dotfiles repo: `~/code/dotfiles/machines/pi/README.md`. If
asked to deploy to staging, read the steps there.
