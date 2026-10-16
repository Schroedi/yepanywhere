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
allows local assets and scripts but denies external network connections,
workers, nested frames, forms and top-level escape. Source bytes remain inert
on the authenticated YA API origin.

Only `https://yepanywhere.com` and `https://latest.yepanywhere.com` may embed
or connect the bootstrap. The client and bootstrap both validate exact source,
origin, protocol and viewer identity. Content receives an entry name and theme
and widget state, never a server credential, grant API path or general fetch
interface. The server rechecks file authority even if content forges messages.

The small fragment adapter exposes `openai.theme`, `widgetState`,
`setWidgetState()` (64 KiB), and `sendFollowUpMessage()` (8,000 characters,
eight insertions per viewer). Follow-ups insert undoably into the current
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
Relative resources, computed modules and linked HTML documents work without asset
rewriting. Absolute OS paths, root-relative web-app routing, external scripts
or APIs, application backends and WebSockets are not supplied by this broker.
Custom artifact hosts, app vhosts and public sharing retain their existing
contracts. Chrome is the initial qualified engine. WebKit and native WebViews
keep their existing viewer; desktop phone-width evidence is not device proof.

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

The runner refuses physical-device serials, restores Chrome preferences,
removes its DevTools forwards and temporary command-line file, and stops its
owned app/browser/server. Native mode clears the disposable app data. The
caller owns emulator shutdown. Selected results are in
[android-acceptance-results.json](android-acceptance-results.json); screenshots
remain ignored. iOS/WebKit and interactive native delivery remain unqualified.
