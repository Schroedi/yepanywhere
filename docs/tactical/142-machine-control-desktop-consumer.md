# Consume the installed Machine Control desktop app

Status: in progress, 2026-10-02. Bundled Python CLI, authenticated installation
discovery and opt-in local launch advertisement are implemented. Platform and
real-model acceptance, followed by Windows legacy retirement, remain open.

Owning topics: [Optional Computer Control](../../topics/optional-computer-control.md),
[Native sudo](../../topics/native-sudo.md), and
[New-Session Agent Tooling](../../topics/new-session-agent-tooling.md).

## Objective and originating direction

The maintainer requested a replacement for YA's separate Windows Machine
Control component now that MC has a desktop app. Installing MC should supply
the control CLI and its instructions, so any shell-capable agent can use it
without being told to inspect a source checkout. YA should discover and
advertise that installed interface, following the small native-sudo adapter's
pattern.

Keep the shared CLI in Python as an intentional architecture choice. Quick
command development must continue to work without a Rust toolchain or a desktop
rebuild. Distribution should package the same implementation with its runtime
and dependencies; it is not a preliminary step toward a Rust rewrite.

## Existing context and blockers

- [Tactical 131](131-optional-windows-computer-control.md) and its owning topic
  record the accepted Windows Node/local-Codex preview. YA still downloads,
  verifies, installs and updates a separate workstation component, launches its
  resident, supervises its descendants with a Windows Job Object, and owns
  session grants and a Windows-specific dynamic tool. This migration has not
  happened in the current checkout.
- [The native-sudo adapter](../../packages/server/src/sdk/providers/native-sudo.ts)
  already verifies a configured Mac app and helper signatures, adds the helper
  directory to agent PATH, and supplies an exact command path and instructions.
  It neither uses nor changes Computer Control settings.
- MC's [system map](../../../machine-control/SYSTEM-MAP.md),
  [distribution topic](../../../machine-control/topics/native-distribution.md),
  and [desktop product](../../../machine-control/desktop/README.md) own native
  packaging and lifecycle. Its current Python client invokes repository-local
  platform adapters and shared helpers. Bundling only the tiny launcher leaves
  an incomplete client.
- [Native exec privilege hardening](../../gaps/native-server-no-new-privs.md)
  remains separate. Native sudo deliberately crosses an OS privilege boundary;
  CLI advertisement is not a solution to same-user shell containment.
- [Windows validation](../../gaps/windows-validation-baseline.md) and the
  [historical archive extraction stall](../../gaps/windows-archive-extraction-test-timeout.md)
  remain existing evidence limits. Retiring an obsolete package path does not
  establish that its historical defects were repaired. Relevant local tasks
  contain prior CI diagnosis, not an existing desktop-consumer migration plan.

This work remains separate from the release-delivery priority in the
[roadmap](../roadmap/README.md). The immediate dependency is an accepted MC
package containing a source-independent CLI, not another YA installer.

## Intended ownership and experience

| Owner | Responsibility after migration |
| --- | --- |
| Machine Control | Desktop installation and updates, resident lifecycle, native approvals and arming, access enforcement, claims, CLI packaging, capability/result contracts, and agent instructions |
| YepAnywhere | Session eligibility and opt-in advertisement, verified discovery on the execution host, launch context, optional tool/transport adaptation, and result presentation |
| Agent | Read MC's instructions, discover capabilities, coordinate use, request access, and execute operations through the installed CLI |

```text
YA discovers and verifies the installed MC interface on the execution host
  -> eligible opted-in session gets a command path and short instructions
  -> agent runs MC's Python-backed CLI through its existing shell
  -> client reaches the installed target-native resident
  -> MC enforces access and executes the operation
  -> observations, refusals and artifacts return to the agent
```

YA discovers one supported entry point, not a directory of independently
callable Python scripts. MC may package Python modules, adapters and helpers as
internal resources. On macOS executable resources belong in the signed app
bundle; App Support holds writable configuration/state. Windows and Linux use
their platform installation and state locations. YA must not copy executable
code out of the app into an independently maintained helper installation.

PATH delivery is convenient, but instructions also carry the exact safely
quoted executable path because login shells can replace PATH. Invocation must
work from an unrelated directory. Example commands below describe the intended
surface; the new instruction/discovery commands still need implementation.

```sh
machine-control agent instructions
machine-control --target host desktop windows
machine-control --target host browser tabs
machine-control --target host browser snapshot --tab TAB_ID
```

## Boundaries

- First prove local `host` desktop/browser use, starting on macOS with the
  existing sudo discovery precedent. Prove Windows before retiring its old YA
  component. Linux is a separate acceptance cell, not inferred from Python
  portability. Preserve MC's target selection and remote/device contract;
  broader packaged adapter coverage can follow independently.
- MC's installed product must work without YA. Developers retain direct Python
  execution from the checkout; publishing changed commands to installed users
  still requires an MC release. YA does not ship a fork of the CLI.
- YA advertisement is configurable and default-off under
  [vanilla defaults](../../topics/vanilla-defaults.md). Discovery, session
  selection, target-use claims and MC access grants are distinct. A YA session
  id supplies attribution, not bearer authority. Use the vocabulary in
  [principals and grants](../../topics/principals-and-grants.md).
- Discover on the agent's execution host, not the operator's browser machine.
  Begin with local launches; remote executors and sandboxed sessions remain
  unavailable until their command/IPC route is proven. Do not widen a sandbox
  to make discovery succeed or fall back to the YA host's desktop.
- Native sudo remains independently selected and verified, with system sudo
  authentication and its local secure-field dialog. Desktop/browser access
  never implies administrator authority. Keep cancellation/failure terminal.
- YA must not duplicate MC's native grant UI, arming controls or updater. YA
  session selection controls advertisement or a tool adapter, not arbitrary
  same-user shell access. Removal of session advertisement cannot honestly
  revoke a grant MC has not bound to that session. Preserve existing tool
  revocation guarantees during migration or explicitly resolve that difference
  in MC before claiming parity.
- Retain a thin YA tool adapter only where it adds useful model/image delivery
  or session adaptation. It uses the same installed MC contract; neither MCP
  nor Codex dynamic tools are prerequisites for ordinary CLI use. Do not carry
  the Windows-only `hwnd` schema into the portable interface.
- The maintainer subsequently authorized end-to-end implementation and
  incremental commits. Releases and legacy retirement retain the acceptance
  gates below.

## Completion conditions

- A packaged MC CLI works with no checkout, system Python or developer
  toolchain, while the direct Python development path remains available.
- YA can verify and identify a compatible installation, including the CLI's
  dependencies, and advertise it only to eligible selected launches. Missing,
  tampered and incompatible installations produce bounded, useful failures.
- A real shell-capable agent reads installed instructions, performs semantic
  desktop and browser operations, and consumes a capture. Independent fixture
  state establishes effects; an accepted request alone is insufficient.
- Claims and native access approval/revocation behave honestly. Unselected
  sessions gain no YA context/environment changes or implicit approval.
- Native sudo shares installation discovery without broadening its existing
  selection, publisher checks or authentication boundary.
- Accepted Windows desktop-app use replaces the old component path with a
  deliberate compatibility/removal plan and no orphaned YA-owned processes.
  YA shutdown does not kill the independently installed MC app.
- Topics and both repositories' ownership documents distinguish accepted
  platforms/providers from open acceptance cells. Migration is complete only
  when obsolete lifecycle code and its product controls are retired safely.

## Ordered work

### 1 — package the Python control client in Machine Control

In MC, inventory the client dependency closure: common modules, local platform
adapters, claim helpers, subprocess executables and resource locators. Package
it with Python; eliminate checkout-relative assumptions and accidental system
Python dependencies in subprocesses. Ship one stable terminal entry point that
preserves stdout JSON, stderr diagnostics, exit status and artifact retrieval.

Resolve naming before shipping: the Windows/Linux desktop GUI binaries already
use `machine-control`. A separate launcher or a command dispatch mode must not
open/focus the settings UI for a normal CLI operation. Avoid a Rust command
port. Define how the packaged client discovers or asks MC to activate its
resident; YA must not regain resident supervision through this mechanism.

Prove a clean installation from an unrelated working directory, with the
source tree and developer Python unavailable, before adding the YA consumer.

### 2 — publish a discoverable CLI identity and agent instructions

MC owns machine-readable product/client version, supported protocol and feature
identity plus `agent instructions`. Settle exact discovery fields and commands
in MC's contracts; YA checks compatibility rather than guessing it from paths
or trusting a self-declared publisher. Verify installation authenticity before
executing its probes. Use platform-appropriate signed/authenticated packaging.

Keep the initial launch fragment small: executable location, purpose and the
instruction command. Full instructions cover doctor, capabilities, exact
claims and release, access requests, stale references, delivery/effect
uncertainty, captures/artifacts and scope-specific browser/devtools access.
Instructions do not perform an operation or obtain approval by being read.

### 3 — share verified MC discovery with native sudo

In YA, extract installation discovery and authenticity checks from the sudo
precedent into a small common consumer boundary. Keep feature availability
separate: an installed sudo helper does not prove a compatible control CLI,
and a working control CLI does not enable sudo. Preserve explicit configuration
precedence, trusted publisher sources and current configured-failure behavior.

Cover disabled defaults, exact paths with spaces, incomplete/tampered bundles,
incompatible versions, independent feature opt-ins and signed app replacement.
Revalidate at appropriate launch/use boundaries; do not retain a stale locator
or cache trust across an app replacement indefinitely.

### 4 — advertise installed control to eligible agent sessions

Reuse launch environment/context composition so existing instructions,
own-session tooling and feature selections survive. Supply the verified CLI
directory and exact command path, then let the agent invoke it through its
existing shell. Start with the already proven local unrestricted launch shapes;
verify other providers/runtimes separately instead of inheriting a Windows/
Node/Codex-only restriction or promising universal support.

Test real model use and capture consumption. If a provider cannot consume a
CLI artifact directly, implement the smallest adapter into YA's existing media
pipeline, preserving MC's bounded artifact validation and native result
meaning. Do not introduce a general persistent evaluator or register MCP in
every session to solve advertisement.

### 5 — prove the desktop route and migrate Windows consumers

Exercise local Windows desktop-app control with an exact signed package,
without a checkout and without the YA-managed resident. Retain independent
controller access for diagnosis. Prove ordinary enumeration, a semantic action,
browser operation, native approval refusal/revocation, stale-generation
rejection and screenshot delivery to the model and live/reloaded YA views.

Inventory what the old session-scoped tool guaranteed and how the new route
enforces or honestly changes each guarantee. Decide whether a thin tool adapter
is required before removing it. Existing grants must not be silently widened,
copied to MC, or revived on restart. An MC update/uninstall or resident restart
must yield explicit compatibility/unavailability results without replaying
uncertain mutations or reinstalling a legacy resident as fallback.

Only after acceptance, remove YA's component download/update/install controls,
resident launcher, Job Object supervision and idle shutdown for the migrated
route. Stop/uninstall only the legacy instance YA owns through its established
cleanup path; never terminate the desktop product or appliance service. Keep
failed cleanup locators for retry and provide deliberate handling of persisted
legacy settings and old clients. Follow
[server capabilities](../../topics/server-capabilities.md) and
[hosted compatibility](../../topics/remote-hosted-compatibility.md) before API
changes; do not repurpose capability IDs 70/71 with broader semantics.

### 6 — record acceptance and retire obsolete ownership

Run touched-area regression and repository-required source/UI checks as
implementation lands. Record actual OS, architecture, provider and runtime
coverage. Acceptance includes MC replacement with no active grant, refused
replacement while access is active according to MC policy, YA restart/crash,
session close, expiry, concurrent callers and unavailable app recovery.

Update YA's optional-control, native-sudo and launch-tooling topics; update MC's
system map, distribution and desktop topics in MC. Current legacy implementation
facts stay marked current until cutover. Keep captures, concrete targets,
credentials and execution traces in private test storage. For VM validation,
use MC doctor, exclusive claims and finally-style cleanup. Preserve existing
Windows gaps unless their specific closure evidence is obtained.

## Result and remaining acceptance

MC packages its existing Python client, local host adapters, claims and pinned
CPython for six desktop targets. Offline identity and owned instructions are
implemented. Portable dependency/inventory negatives and a source-independent
Mac ARM64 smoke pass. A locally assembled Developer ID signed Mac app passes
YA's real publisher, full payload and compatibility verifier. This is signed
assembly evidence, not notarization or published-release acceptance.

YA's common installation consumer verifies native signatures/catalogs or the
Linux signed receipt before executing any client probe. Opt-in local Codex and
Claude launch composition adds the exact command and PATH while preserving
existing context and own-session grants. Native sudo shares Mac app verification
and optional location configuration, while retaining independent feature
selection and native executable checks. The installed route refuses a launch
that also selects a legacy Computer Control grant.

Touched-area launch tests, full lint, format, typecheck and the complete unit
suite pass locally. The broader suite still emits unrelated failure-path
warnings recorded in [this gap](../../gaps/unit-failure-path-log-warnings.md).
The installed probe verifies a real signed bundle and launch-context composition;
it does not start a model or establish screenshot consumption by one.

Remaining gates are actual desktop/browser effects and artifacts in a claimed
appliance, real provider/model use, Windows and Linux installed acceptance,
replacement/restart/expiry/concurrency acceptance, and deliberate migration of
legacy persisted settings and cleanup. The old Windows product controls,
installer, updater, grant/tool contract and supervisor remain current until
those gates pass. Do not infer retirement from the new environment opt-in.
