# Roadmap

Last updated: 2026-10-01.

This is Yep Anywhere's canonical product-priority overview. Keep initiative
status, the next action, and major blockers here; keep implementation steps in
`docs/tactical/` and durable behavior contracts in `topics/`. Planning stays in
the repository and does not require epics, ticket numbers, or pull requests.

## 1. Publish the desktop and mobile apps with continuous delivery

**Highest priority.** Make Yep Anywhere available as supported public releases
on desktop, iOS, and Android, with CI covering every distribution and an
automatically published **Latest** channel for bleeding-edge builds. Desktop
should graduate from its current beta positioning; mobile should reach the
App Store and Google Play, not stop at internal testing.

**Status:** in progress. Mobile release direction selected 2026-09-30:
bundled web UI as the primary foreground, with native login, host selection,
secure SRP/session storage, transport, reconnect, and notifications. Android
now opens the complete bundled UI through its native authenticated transport,
with native host management and no duplicate dashboard/Conversation screens.
The implementation and acceptance evidence are recorded in
[the WebView app plan](../tactical/083-android-bundled-web-native-transport.md).
Native dashboard/Conversation rendering and the experimental Simple Client API
preview are no longer mobile release prerequisites. iOS follows the same shell
boundary; the [iOS/shared-core plan](../tactical/138-ios-native-core-proof.md)
has passed its Rust crypto interoperability and native build experiment,
including iOS simulator execution. A Daybreak Blue engineering review supports
the proof and conditional development use of SRP 0.7; the plan records its
production login gates and accepted limits. The maintainer accepted the shared
Rust core with pinned SRP 0.7.0-rc.3 and unchanged-server compatibility. The
consumer iOS 17+ shell now runs the bundled UI over native Rust SRP,
with Keychain storage, continuity-key registration/check-in/revocation and
foreground lifecycle reconstruction. Owned simulator acceptance covers real
native login, concurrent streaming/typing within 100 ms, route/draft preservation
and Switch Host. Direct/mux/legacy server probes and an unsigned device build
pass, including OS TLS trust/hostname/expiry checks and cancellation across FFI.
Dedicated iOS CI runs independently of physical-device signing. The
[hosted source run 36926705262](https://github.com/kzahel/yepanywhere/actions/runs/36926705262)
passed all 18 simulator tests without skips, including native login, streamed
typing, foreground/relaunch draft preservation and Switch Host, then linked the
unsigned ARM device app. Typing acknowledged all 37 characters with a 26 ms
maximum, zero drops and 342 overlapping transcript mutations. The
[main CI run](https://github.com/kzahel/yepanywhere/actions/runs/36926705404)
passed all 24 jobs and 361 browser cases without retries.
CI uses macOS 15 Apple Silicon / Xcode 26.3 with iOS 18.6, compiles before
simulator boot, and requires CPU/memory headroom before UI acceptance. Its owned
simulator uses a verified background-service profile; local runs remain stock
by default. The Darwin sampler reports available and free memory separately.
Automatic XCTest recording is disabled while six explicit screenshots remain.
Native shell checks use control identifiers, and restored WebKit controls use
current-frame taps. Intel native tests also pass with their Rust simulator
target, but Intel UI remained CPU-bound. The 18 tests and 100 ms typing ceiling
remain intact. Initial physical-phone acceptance also passes: 15 native and both
UI tests on iPhone SE (3rd generation), iOS 26.6.1, with development signing and installation.
Typing peaks at 33 ms over 37 keys, with zero drops and 226 concurrent transcript
mutations; foreground/relaunch and Switch Host pass. Store signing/publication,
tablet acceptance and the broader device/network matrix remain release work.
Embedded viewers/downloads need the
[remaining WebKit adapters](../../gaps/ios-webview-viewers-and-downloads.md).
Notification permission/FCM/broker
foundations exist; common per-server native push enrollment and real Apple push
delivery remain pending. The maintainer prioritized [Android/shared transport migration](../tactical/139-shared-mobile-transport-migration.md)
on 2026-10-02. That implementation now uses Rust/UniFFI in Android and common
per-profile source leases on iOS. Shared mux circuits, credential-proven route
fallback, scoped ownership and final teardown pass unchanged-server tests.
Android's R8-minified physical Pixel proof includes two hosts on one relay socket
and a 100 MiB upload with 16.6 ms peak typing latency. iOS simulator acceptance
and the physical iPhone native/UI suites pass; the updated physical typing proof
records 37 inputs, zero drops, 19 ms peak and 294 concurrent mutations.
Release builds and required root checks pass. Store publication, native push and
the viewer/download gap remain the next mobile release work.

### Current baseline

- Signed macOS and Windows desktop releases already exist. The
  [desktop release QA log](../testing/desktop-release-qa-log.md) records
  installer and updater validation; the
  [public distribution catalog](../../site/src/data/distributions.ts) still
  identifies desktop as beta.
- The web client and npm server are available. The
  [Latest remote-client workflow](../../.github/workflows/latest-remote-client.yml)
  already deploys the exact successful CI commit after pushes to `main`.
- [Desktop CI](../../.github/workflows/desktop-ci.yml) packages and signs
  desktop releases. [Nightly Desktop](../../.github/workflows/nightly-desktop.yml)
  publishes verified `main` changes to Latest; the first signed nightlies and
  the unchanged-source skip have passed release validation. September 30
  verification repaired stale filtered-run discovery and prevents selecting
  source behind an already published Latest. The selector now reads the workflow
  inventory and filters main pushes locally. Forward-source
  [nightly 36715214551](https://github.com/kzahel/yepanywhere/actions/runs/36715214551)
  published `0.3.2701` at verified `2d2f524d5`, with both macOS installers
  notarized, Windows signing successful and all updater signatures verified.
  The earlier draft-creation 403 did not recur with the existing permissions.
- The website's [desktop downloads page](../tactical/134-desktop-download-links.md)
  is live in `site-v1.11.0`. It suggests the visitor's platform and links to
  current Stable macOS and Windows installers through the update server;
  nightly builds remain separate.
- The [server runtime matrix](https://github.com/kzahel/yepanywhere/actions/runs/34485119811)
  now passes full packaged startup on Linux, macOS and Windows across all four
  Node versions and the pinned Bun runtime, including clean npm installations.
- [Android CI](../../.github/workflows/android-app-ci.yml) tests and builds
  application artifacts but does not publish them to Google Play. Android
  implementation exists; neither native mobile app is publicly published.
- Linux remains supported through the server/web distribution. The current
  desktop installer matrix is macOS and Windows; a Linux desktop installer
  would need its own scope and release criteria.

### Release outcomes

- [ ] Establish and meet desktop release criteria, then publish and present
  desktop as a supported release rather than beta. Reuse existing signed
  installer and updater evidence instead of restarting the packaging work.
- [x] Decide the first mobile release scope and its acceptance criteria.
  Native shell/full bundled web UI selected; tactical 083 records the gates.
- [ ] Complete and publish Android on Google Play and iOS on the App Store.
  Automated internal testing is an intermediate milestone, not completion.
- [ ] Give every distribution CI verification and automated release delivery:
  website/web client, npm server, desktop, Android, and iOS. Extend existing
  workflows rather than creating a parallel release system.
- [ ] Publish passing, relevant `main` changes to Latest channels without a
  manual version bump, release tag, or upload for each preview build. Include
  signed desktop updates, Android internal testing, and internal TestFlight;
  broader mobile testing must respect platform review and distribution rules.
- [ ] Make each platform's latest available build easy to find, with its
  version, source commit, publication state, and installation path. A failed
  or still-processing build leaves the previous successful build available.

### Latest channel expectations

Desktop starts with nightly publication at 02:37 UTC, skipping unchanged
packaged inputs, plus manual dispatch for recovery and validation. Same-app
Stable/Latest selection and signed nightly publication are available. Windows
installed-upgrade acceptance passed, including channel persistence and data
preservation. The macOS VM resumed normally on 2026-09-28, clearing the earlier
suspended-state restore blocker. Installed macOS upgrade acceptance remains
pending; the manual-check regression was reproduced and locally fixed. See the
[desktop release QA log](../testing/desktop-release-qa-log.md).
Continuous per-commit desktop delivery remains a later extension of this
foundation.

Continuous publication should make builds available as soon as verification,
packaging, signing, and platform processing allow; it is not restricted to a
nightly schedule. Coalesce superseded pending work when necessary instead of
building an ever-growing release queue. Store availability and device update
timing are separate; hourly automatic installation is not a guarantee.

Desktop discovers the available update and offers it through a banner or
equivalent notice. The user approves installation through one Update action;
publication must not silently install or restart the desktop app. Mobile
installation follows the user's platform update preferences.

Stable and Latest remain distinct choices. Latest clients must preserve the
supported older-server fallbacks; joining Latest must not require upgrading
every paired machine together. Versioning, signing, installation, update, and
compatibility checks belong to the release criteria, not just compilation.

### Mobile scope decisions and next action

The 2026-09-30 direction uses the full bundled web interface for ordinary
projects, sessions, transcripts, input and settings. Android owns native login,
reauthentication, host selection, protected SRP/resume credentials, transport,
reconnect and notifications. Saved-host selection enters the web app directly;
Switch Host returns to native management. Management observes connection state
without retaining dashboard subscriptions.

The initial mobile release uses server-owner login. Native limited-user login
is explicitly deferred (2026-10-01). Android and the iOS native-login/transport
shell are implemented; iOS has owned simulator, unsigned-device and signed
physical-phone acceptance evidence.

The [WebView app implementation](../tactical/083-android-bundled-web-native-transport.md)
reuses the existing native pairing and multi-host core and the web client's
SourceTransport contract. It adds no server authentication protocol or child
credential. The duplicate native dashboard and Conversation presentation are
removed, with reusable decoder/projection helpers retained.

The [Simple Client API experiment](../tactical/130-simple-client-api-and-three-client-demo.md)
remains separate work: the generated contracts and deliberate-entry web preview
are useful independently, but native Conversation UI and SourceOverview are
not mobile release prerequisites. The previous native preview remains
historical evidence in Git.

**Next action:** finish store signing/distribution, notification enrollment and
tap acceptance, and release-device/network checks for both mobile apps. Complete
the iOS embedded-viewer/download adapters before claiming full UI parity; a new
SwiftUI transcript/composer design is not required. Desktop release and
continuous-delivery work continue independently.

## Later directions

The separately authorized [project-template implementation](../tactical/132-project-template-implementation.md)
now has a native library composer and opt-in settings for ordered GitHub/local
sources, pinned retrieval and manual updates. Production creation, ready-content
admission and limited-user template grants with project-confined setup are
implemented. Personal-workspace scopes, retained App access, reservations and
project-local identity remain pending. The three default templates are admitted.
The [project service specification](../../topics/project-service.md) now defines
main-pane App access, standardized serving/lifecycle declarations, conditional
vhost association in project Settings and audit-preserving personal removal;
its mockup does not implement those runtime contracts.
This work does not displace release delivery above.

The separately authorized [optional Windows Computer Control preview](../tactical/131-optional-windows-computer-control.md)
is implemented and accepted for source-run Windows Node/Codex: signed local
package management, deferred tools, explicit session selection, native images
and crash-isolated lifecycle. Public download/update code is implemented; first
release publication and packaged YA acceptance remain pending. This opt-in work does not displace
release delivery above.

These remain candidates behind publishing and continuous delivery, not a
ranked or approved implementation queue. Recheck current code and owning
documents before defining work.

| Direction | Existing context / decision still needed |
| --- | --- |
| Multi-machine experience across the full web and desktop clients | The simple-client demo above now owns the first grouping experiment; broader adoption follows evidence from that work and [source runtimes](../../topics/client-source-runtime-topology.md). |
| Authentication and delegated access | [Limited users](../../topics/limited-users.md) delivers local accounts and project grants. [Principals and grants](../../topics/principals-and-grants.md) coordinates the broader proposed invitation/account and issuer boundaries; it does not approve a universal grant protocol. [Session notes and discussion](../../topics/session-notes-and-discussion.md) and [participatory Live Share](../../topics/relay-origin-and-share-gating.sketches.md#participatory-live-share) propose human-only notes/chat, owner-reviewed suggestions, and later explicit session-input grants. These remain later directions, not a newly ranked implementation queue. |
| Related work across repositories | [Issues & PRs](../../topics/issue-session-associations.md) now has experimental, default-off automatic ticket/URL discovery from viewed sessions and a configurable recent-session window, durable evidence, search and correction controls. Conservative URL/known-prefix matching, durable Jira project learning, and session-grouped browsing are implemented and locally validated. SQLite migrations and compatibility gating are implemented. Multi-server issue grouping enters the simple-client demo above; workstream/branch inference and tracker synchronization remain deferred. |
| Parallel work within one repository | Follow the [workstreams proposal](../../topics/workstreams.md), which uses ordinary lane clones; do not revive the old automatic-worktree sketch as an approved design. |
| Scheduling | Follow [yacron](../../topics/yacron.md) and its [open gap](../../gaps/sketches/yacron-scheduler.md); the first management UI remains a design prerequisite. |
| Agent command runtime | Opt-in [`ya-agent self`](../../topics/agent-self.md) implements ownership and model/effort evidence reporting. Use operator-managed global instructions initially; defer automatic advertisement, private input, broader session access, and scheduling integration. |
| Node 22 and built-in SQLite | Follow the approved [runtime cutover plan](../tactical/123-node-22-builtin-sqlite-cutover.md): raise the server runtime floor now, retain older-server hosted frontend support with advisory runtime warnings, and gate new SQLite-backed features by their exact capabilities before considering any separate frontend cutoff. |
| Source workflow depth and traceability | Build on [Source Control](../../topics/source-control.md), [review handoff](../../topics/source-review-to-session.md), and [commit/session attribution](../../gaps/sketches/committed-change-session-attribution.md). Additional Git or terminal controls need a concrete user workflow. |
| Provider maturity and other deferred work | Consult the owning provider topics and [deferred backlog](../../topics/deferred-roadmap.md); its local ordering does not override this product priority. |
| CI browser reliability and cost | The [CI isolation campaign](../tactical/135-e2e-suite-cost-ratchet.md) owns worker profiles, mutable services and joined cleanup. CI exercises two workers per existing shard. The fixed-source pair passed both schedules, with the worker pair's slower job 47.8% shorter and combined jobs 41.2% shorter; each needed one retry. Subsequent worker revisions completed first-attempt E2E repeats. September 30 fixture-home and reload-environment isolation resolved seven reproduced local failures; the full four-worker suite then passed 352 cases without retries. Source CI 36712930735 and follow-up 36715163980 each passed all 353 browser cases without retries, the full unit suite and every native platform leg. October 1 source CI 36799408077 is red on new dependency advisories and Windows computer-control cleanup; its passing browser shards include one retry in the All Sessions reservation assertion. Server Runtime And SQLite 36799408196 also failed Windows Bun package readiness. Local repairs cover audit resolutions, asynchronous cleanup with native regression coverage, port-file publication, measured macOS identity-probe headroom, and the reservation oracle. Final local browser verification passed 360 cases without retries plus 20 reservation repetitions. Repair commit `17a085b59` passed all 24 jobs in [CI 36816545726](https://github.com/kzahel/yepanywhere/actions/runs/36816545726), including 361 browser cases without retries and every native platform leg; [runtime/SQLite 36816545797](https://github.com/kzahel/yepanywhere/actions/runs/36816545797) passed all 12 platform/runtime legs on the first run. The documentation follow-up [CI 36817606854](https://github.com/kzahel/yepanywhere/actions/runs/36817606854) also passed, but exposed a right-pane reload retry: late app metadata made historical output look fresh. A deterministic hook regression reproduced that defect; discovery now remembers initial tool URLs before their mappings resolve. Thirty local browser repetitions then passed without retries, retaining concurrent typing and reload assertions. Source CI 36820386055 exposed a separate Intel macOS assembled-inventory timeout: its one-second status budget was shorter than the three-second native identity-probe bound. That scenario now gives inventory four seconds, derived from the observed CI limit; its lifecycle and process-identity checks remain intact. October 2 CI exposed three deterministic browser failures and a mutable upstream libsodium archive repack that blocked both mobile workflows. Repairs vendor the original signed archive under its unchanged checksum, keep Apps domain rows compact, align attachment quick-hide tests with the menu and isolate their saved defaults, wait for project-delete acknowledgement, select audio transcription capabilities after microphone acquisition, and give the resume API fixture its actual saved Claude transcript instead of probing unrelated providers. Source [CI 36970258142](https://github.com/kzahel/yepanywhere/actions/runs/36970258142) passed both browser shards (368 executed cases without retries), but a late thinking-toggle scroll restore caused an unhandled client-unit error after teardown. Two deterministic regressions reproduce writes to detached DOM before the fix; the transcript now owns and cancels both restoration frames, and refuses restoration without its current mounted container. Repair `6591bd7f9` passed all 24 jobs in [CI 36972149383](https://github.com/kzahel/yepanywhere/actions/runs/36972149383) and all 12 [runtime/SQLite legs](https://github.com/kzahel/yepanywhere/actions/runs/36972149416). One viewer-mode browser case retried because its cold edit dialog missed a five-second assertion limit; the retry needed 4.869 seconds and a prior CI popup measured 5.7 seconds. That first-mode readiness assertion now allows 15 seconds (about 2.6 times the observed maximum), retaining the 30-second case, both real gestures, mode checks and source-viewer invariance. Ten local repetitions pass without retries. Concurrent main pushes superseded the native workflows, so platform acceptance is tracked on the latest main source. Focused browser verification retains the typing and row-height limits. The comparable median/p90 window remains the campaign acceptance blocker. The separate initial search-highlight, [live search discovery](../../gaps/browser-suite-artifact-and-search-failures.md), [Windows extraction](../../gaps/windows-archive-extraction-test-timeout.md), and [Codex fake-process waiter](../../gaps/codex-provider-unit-startup-timeouts.md) findings remain open with bounded diagnostics. |
| macOS backend reload continuity | [Provider-host port](../tactical/128-macos-provider-host.md) has verification evidence for live Claude/Codex reload, approval, durable resume, concurrent sessions and terminal cleanup on Node source checkouts. Subsequent test-running sessions showed active-turn interruptions correlated with provider-owner exit, so macOS now defaults to ordinary in-Hono ownership and requires `YEP_PROVIDER_HOST_ENABLED=true` to opt in while the [interruption gap](../../gaps/macos-provider-host-turn-interruptions.md) is investigated. Linux remains enabled by default. Native CI still covers Linux, Apple Silicon/Intel Mac and Windows fallback. The separate [Claude project-alias history gap](../../gaps/claude-symlink-project-transcript-routing.md) remains open. This developer iteration work does not displace release delivery. |

## What changed from the old roadmap

The February 2026 list is superseded. Status/diff browsing, line-review
comments, and signed desktop installers are existing capabilities, not new
feature proposals. Source Control remains deliberately bounded; the old
stage/commit/PR checklist is not an approved expansion. The former blanket
"Not Planned" exclusions are retired rather than carried forward as current
product decisions.

The [T3 Code analysis](../competitive/t3code.md) informs this reprioritization.
Provider-native session continuity remains a central differentiator; release
availability and a coherent multi-machine mobile experience make it easier to
use. Further feature comparisons do not displace the publishing priority.
