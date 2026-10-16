# Managed artifact content host

The first-party hosted YA client supplies this viewer automatically when its
server advertises `artifact-relay-preview` and no custom public artifact host
is configured. The static host carries no artifact storage or YA credentials.
The real file viewer captures its source transport and forwards bounded reads
through an authenticated, principal/session-bound preview lease.

## Delivery

`artifact-<32 lowercase hex digits>.yepanywhere.com` is a fresh origin for one
viewer. First-level labels fit ordinary wildcard TLS. Only the fixed
`/__ya/1/bootstrap.html`, `bootstrap.js`, `worker.js` and `frame.js` are served;
all artifact and API network paths return inert failures. A worker scoped to
`/v/` synthesizes document/asset responses from the parent broker. Its CSP
allows local assets and scripts while restricting ordinary external resource
loads, workers, nested frames, forms and top-level escape. This is credential
and API isolation, not network containment: artifact scripts can read every
non-dot file granted under the entry directory and exfiltrate it through
WebRTC STUN/TURN, their own frame navigation or DNS side channels. Source bytes remain inert
on the authenticated YA API origin.

Only `https://yepanywhere.com` and `https://latest.yepanywhere.com` may embed
or connect the bootstrap. The client and bootstrap both validate exact source,
origin, protocol and viewer identity. Content receives an entry name and theme
and widget state, never a server credential, grant API path or general fetch
interface. The server rechecks file authority even if content forges messages.

The small fragment adapter exposes `openai.theme`, `widgetState`,
`setWidgetState()` (64 KiB), and `sendFollowUpMessage()` (8,000 characters,
eight insertions per viewer, requiring transient user activation and viewer-frame focus in the trusted
parent). Follow-ups insert undoably into the current
session draft and never send automatically. State belongs to one source,
session and artifact; it is not durable across closing the viewer. The fixed
frame helper also supports the existing file-viewer find protocol.

Version `1` is the message/asset compatibility family. Compatible changes keep
its URLs and protocol working for existing viewers. A future incompatible
family must retain version 1 assets while its active viewers can still run.
New viewers always get a fresh origin. Viewer documents are no-store; the host
never caches file bytes. Network fallback is always safe if worker control is
lost. Parent cleanup cancels readers/ports and releases the server lease; the
bootstrap unregisters on explicit close and pagehide.

## Build and deploy

Build shared first so the generated, existing find agent is available:

```bash
pnpm --filter shared build
npm ci --prefix sharing-worker
node --test artifact-host/host.test.mjs
cd artifact-host
# Use the project's credentialed Wrangler installation.
../sharing-worker/node_modules/.bin/wrangler deploy --config wrangler.jsonc
```

The route uses `*.yepanywhere.com/*`. DNS must provide a proxied wildcard
record. Existing explicit service records remain DNS-only and bypass the
Worker; a non-artifact hostname reaching this Worker returns 404. Review that
constraint before proxying any additional first-party service hostname.
Private account/zone records, credentials and actual deployment receipts live
in the dotfiles runbook, not public source. Logs/observability are disabled.
This is the real HTTPS content host, not a separate YA staging environment.

## Acceptance

The explicit manual runner uses a temporary YA profile and a fresh, random
identity/password on the public TLS relay. It loads the **actual newly built
YA client** from the owned worktree into an intercepted first-party-origin
page in a separately identified Playwright Chromium profile. The content
origin's DNS, TLS and responses are real network requests to this deployment;
the first-party parent build is temporary, not the public site's deployed
client. It needs no browser insecure-origin, resolver, TLS or LNA overrides.
Third-party cookies are blocked in the disposable browser profile.

```bash
pnpm exec tsx --conditions source artifact-host/acceptance.mjs --public-relay
```

The public relay sees only normal SRP/NaCl encrypted traffic. The runner stops
its owned YA/browser processes, and leaves secret-free diagnostics/captures
under ignored `.artifacts/managed-artifact/`. No screenshots belong in Git.
It is manual qualification, not a production-dependent CI test. Fast host
security and real-filesystem lease tests run in ordinary unit CI.

The supported v1 file tree is the entry HTML's directory and descendants.
UTF-8 HTML, relative resources, computed modules and linked HTML documents work without asset
rewriting. Absolute OS paths, root-relative web-app routing, external scripts
or APIs, application backends and WebSockets are not supplied by this broker.
Custom artifact hosts, app vhosts and public sharing retain their existing
contracts. Chrome is the initial qualified engine. WebKit and native WebViews
keep their existing viewer. Only the two official parent origins are supported;
`PARENT_ORIGINS` is a diagnostic override, not custom-deployment support, since
the content response CSP also fixes its ancestors.

## Measured qualification — 2026-10-16

Chrome for Testing 148.0.7778.96 passed the real YA-pane/public encrypted-relay
runner with the artifact listener disabled and third-party cookies blocked:

- Native PNG/srcset, imported CSS/background URL, WOFF2 font, classic script,
  static and computed dynamic module imports, and JSON fetch.
- Linked HTML navigation/reload, explicit worker termination/restart, separate
  origins/storage for concurrent viewers, and find (1/1).
- Fragment theme and widget-state restoration on inner reload; a follow-up
  populated the draft without submission.
- Cancellation after the first 65,536 bytes of a 4 MiB stream, followed by a
  successful read; close removed all registrations and a surviving controlled
  frame's next read returned 503. Direct network artifact fallback returned 404.
- All 32 sequential artifact keystrokes acknowledged within 4 ms. All 33
  composer keystrokes acknowledged within 6 ms while 12 transcript updates
  caused 38 DOM mutations. No browser console/page errors.
- Desktop 1000×600 and phone-width 375×812 captures inspected; no screenshots
  committed. Phone-width Chromium is not Android/iOS device qualification.

Selected, secret-free evidence is in [acceptance-results.json](acceptance-results.json).
Server tests separately cover range responses, traversal/symlink denial,
principal/session binding, policy changes and revocation/expiry. Those security
cases are API integration evidence, not additional browser measurements.

## Android emulator qualification — 2026-10-16

The same ten managed-viewer checks passed in stock Android Chrome
124.0.6367.219 on a disposable Android 15/API 35 ARM64 emulator, against the
real public encrypted relay and deployed content host. This covers the actual
Android browser engine, not a desktop viewport simulation. A cross-site cookie
probe confirms both network and script cookies are blocked; the same cookies
are accepted when that probe is top-level. The captured parent is still the
actual worktree build supplied by the harness, not a published hosted client.
Final run: 32 sequential artifact keys acknowledged within 32 ms, and 33
composer keys within 44 ms during live transcript updates; no console/page
errors. An earlier successful run reached 95 ms for an artifact key, still
within the 100 ms requirement.

The separately built bundled Debug app uses `appassets.androidplatform.net`
and intentionally stays on the scriptless fallback: the local PNG does not
load, scripts do not execute, and no managed content frame is created. Opening
and closing that fallback were exercised after a cold resume. Four console
policy refusals (stylesheet, image, and scripts) are expected on this legacy
fallback; unexpected errors remain failures. This is **not** native interactive
artifact support. No production origin allowlist or WebView policy was relaxed.

Fresh native pairing also exposed an independent
[pairing stall](../gaps/android-native-pairing-remains-busy-after-registration.md),
reproduced with the main server. Native viewer observation used the explicit
force-stop/relaunch workaround after verifying real device registration. It
must not be confused with a successful fresh-login flow.

Reproduce with an explicitly selected **disposable** emulator, an initialized
stock Chrome profile, SDK `adb` on PATH, and root access only for setting and
restoring that disposable Chrome profile's cookie preferences:

```bash
ANDROID_SERIAL=<owned-emulator> pnpm exec tsx --conditions source artifact-host/acceptance.mjs --public-relay --android

# Build the actual bundled app first (ANDROID_HOME points to the local SDK):
pnpm --filter @yep-anywhere/android build:android:debug
ANDROID_SERIAL=<owned-emulator> pnpm exec tsx --conditions source artifact-host/acceptance.mjs --public-relay --native-fallback --resume-after-pair
```

These emulator modes refuse physical-device serials, restore Chrome preferences,
removes its DevTools forwards and temporary command-line file, and stops its
owned app/browser/server. Native mode clears the disposable app data. The
caller owns emulator shutdown. Selected results are in
[android-acceptance-results.json](android-acceptance-results.json); screenshots
remain ignored. iOS/WebKit and interactive native delivery remain unqualified.

## Physical Android qualification — 2026-10-16

Attached physical Android 17/API 37, Chrome 155.0.8059.79: all eleven checks
pass against the **final main-checkout client/server**, public encrypted relay
and deployed HTTPS host. The actual client build is temporarily supplied by the
harness; the public hosted client has not been published by this test.
In addition to the earlier graph/lifecycle checks, this verifies 24 simultaneous
reads, exact JSON whitespace and integers above 2^53, invalid JSON, binary wasm
bytes, empty JS/CSS and six 4-byte range reads from a 64 MiB file. Range status,
Content-Range, Accept-Ranges and byte counts survive the relay. This is range
transport qualification, not video seeking or long-media playback acceptance.
Artifact/composer sequential keys peak at 22/30 ms during live transcript
updates; no console/page errors. The default isolated Chrome context allows
third-party cookies; the desktop/emulator runs separately prove blocked-cookie
behavior. No phone browser settings were changed.

The physical bundled Debug app (WebView 154.0.8037.106) successfully pairs via
its **fresh native UI**, opens the scriptless fallback, and tears it down. No
cold-resume workaround was needed on this phone. The fallback intentionally
loads no local PNG and executes no scripts. This does not implement native
interactive artifacts. The APK uses an isolated application ID, no app-link
claims, unchanged native transport sources, and Firebase disabled for this
viewer-only test. It was removed afterward; the user's installed app and data
were preserved. Captures were inspected and remain ignored.

```bash
pnpm exec tsx --conditions source artifact-host/acceptance.mjs --public-relay --physical-chrome
YA_ARTIFACT_TEST_APK=<isolated-test-apk> pnpm exec tsx --conditions source artifact-host/acceptance.mjs --public-relay --physical-native
```

These explicit physical modes select the authorized handheld through the
machine-control Android adapter. Chrome uses an ephemeral context in the
existing DevTools connection and closes only that context; it never resets,
roots or force-stops the user's browser. Native mode verifies the isolated
`com.yepanywhere.mobile.artifacttest` application ID before installation and
refuses to replace an existing installation of that test package. The test APK
must remove MainActivity intent filters to avoid claiming production app links.
No device selectors, credentials, APKs or screenshots belong in source.
Selected evidence: [physical-acceptance-results.json](physical-acceptance-results.json).

## Review hardening

YA API launched Claude Opus 5.5 at high effort for a source/security review.
No security blocker was found. Its functional findings were addressed: bounded
FIFO admission (64 waiting per viewer / 256 per tab, eight active per viewer, 32 per tab), byte-exact
relay download streams, range-header forwarding and response-byte budgets,
late admission cleanup, explicit lease-expiry/unavailability Retry, immediate
static fallback while version is unknown, and server slots reserved before
filesystem awaits. Follow-ups require transient user activation; reserved
content hosts are excluded from the extension's session-tab trust lookup.
The scriptless link listener is shared with the configured viewer. A follow-up
review accepted all fixes without blockers. Its additional recommendations
were applied: server read headroom (16/64), 64 queued reads per viewer, and
viewer focus as well as user activation for composer insertions.

Leases do not renew automatically. Expiry or server lease loss exposes Retry,
which admits the original entry through the captured trusted source. Missing
individual files remain resource failures. Every read has a 60-second absolute
deadline; long/paused media and linked PDF/download navigation remain outside
this qualification. Other file bytes are transported verbatim; HTML needs UTF-8.

Qualification limits: queued response heads still have the worker's 15-second
limit; slow cellular/resource bursts can time out. Server read caps are shared
across clients, so overload can still return 429. The expiry notification uses
the server timestamp against the client clock; clock skew may show Retry early.
Lease expiry intentionally tears down in-page state after 30 minutes; dashboard
renewal and durable widget state are not supplied by v1.
