# Chrome extension client

Topic: chrome-extension-client

Status: in progress 2026-10-13, experimental. Store identity is reserved as
a draft and relay origin support is deployed and publicly verified. The
client spike (steps 3–5) builds, loads unpacked under the store id, reaches
the public relay and survives reloads; logged-in verification (step 6) is
next.

## Objective

Serve the full YA web client from a Chrome extension, connecting to saved
hosts through the public relay exactly as the hosted client at
`yepanywhere.com` or `latest.yepanywhere.com` does. Only Chrome is in scope.

The first goal is an experiment, not a release surface: prove the remote
client runs from a `chrome-extension://` origin with login, session viewing,
typing and reload intact, then use the extension's own capabilities (side
panel, background worker, tab-aware actions) as later slices.

## Motivation

- [Trusted client packaging](../../topics/trusted-client-packaging.md) already
  lists "a Chrome-friendly local-client setup that serves pinned client files
  from a stable local or extension origin" as a candidate shape. An extension
  is the Chrome form of that idea: the code a user runs is a reviewed,
  versioned package rather than whatever a hosted origin serves today.
- Credential isolation. [Security](../../topics/security.md#authenticated-remote-access-and-the-relay)
  names "a privileged browser extension" as a client-side threat: any
  extension with all-sites access can read the hosted client's stored Remote
  Access resume secrets. Other extensions cannot inject content scripts into a
  `chrome-extension://` page, and its storage belongs to that extension alone.
  The trust root becomes the extension's publishing account instead of live
  hosted JavaScript.
- Browser integration the hosted page cannot have: a side panel beside any
  tab, a toolbar action and keyboard shortcuts, and tab-aware lookups such as
  "which YA sessions mention this GitHub PR or Jira ticket" (see
  [Issue and PR lookup](#issue-and-pr-lookup)).

## Current constraints

Recorded 2026-10-13 against `b16af8b22`.

- **The relay refused extension origins at the recorded baseline.** `/ws`
  and `/mux` upgrades check
  `Origin` (`packages/relay/src/index.ts:227`) against
  `DEFAULT_RELAY_ALLOWED_ORIGINS` (`yepanywhere.com`, `*.yepanywhere.com`,
  `ya.graehl.org`) or `RELAY_ALLOWED_ORIGINS`. `parseRule` accepts only
  `http`/`https` origins (`packages/relay/src/origin-policy.ts`), so a
  `chrome-extension://<id>` page gets 403 and cannot even be configured. The
  same policy drives relay HTTP CORS. The
  [origin-gating plan](000-relay-origin-and-share-gating.md#non-goals) is
  explicit that `Origin` is a browser-origin allowlist, not an identity
  signal; SRP and NaCl remain the security boundary.
- **The remote build is close to what an extension needs.**
  `vite.config.remote.ts` builds `remote.html` → `src/remote-main.tsx` with
  `VITE_IS_REMOTE_CLIENT` baked in at build time, so remote mode does not
  depend on the serving host.
- **Inline script.** `remote.html` carries an inline theme script, permitted on
  the web by a hashed CSP meta tag (`vite-plugin-csp.ts`). Manifest V3
  extension pages allow only `'self'` script sources; the script must become a
  file and the manifest owns CSP.
- **Path routing.** `remote-main.tsx` uses `BrowserRouter`, and the client reads
  `location.pathname` directly in roughly 120 places, so switching to a hash
  router is a large refactor. In-app navigation via `pushState` works on an
  extension origin, but reloading `chrome-extension://<id>/-/relay/<user>/…`
  asks Chrome for a file that does not exist.
- **Page service worker.** `public/sw.js` provides push notifications,
  network-first navigation, and streamed downloads (`src/lib/streamedDownload.ts`);
  relay artifact frames rely on a service-worker content origin. An extension
  page cannot register its own service worker; the extension has one
  background worker. `registerServiceWorker.ts` already skips registration for
  packaged origins (`isPackagedAppOrigin`: Tauri and the Android asset host).
- **Version pinning.** An installed extension stays on its packaged client
  version while servers update, as the bundled Android client already does;
  [remote hosted compatibility](../../topics/remote-hosted-compatibility.md)
  applies unchanged.

## Steps

### 1 — register the store item and pin the extension id

Completed 2026-10-13 using Machine Control in the signed-in Chrome profile.
The **Yep Anywhere** item is a draft, version `0.0.1`, with extension id
`dgeameddpnggdeenoekpiaacfghdodch`. A minimal Manifest V3 registration ZIP
requests no permissions and displays an implementation-pending page. It has
not been submitted for review or published.

The store public key is recorded in
[`identity.json`](../distribution/chrome-extension/identity.json). Its SHA-256
derives the recorded extension id. Copy its `key` into the eventual manifest
so unpacked development builds share the store identity, following
[Chrome's key instructions](https://developer.chrome.com/docs/extensions/reference/manifest/key).
The private publisher/dashboard inventory and deployment evidence belong in
the dotfiles runbook.

### 2 — let the relay accept the extension origin

Completed 2026-10-13. Exact extension origins use the validated spelling
because the standard URL parser reports `null` for this scheme. The
registered id is included in production defaults; explicit
`RELAY_ALLOWED_ORIGINS` still replaces those defaults. Local coverage includes
`/ws`, `/mux`, HTTP GET and OPTIONS, exact-id isolation, and malformed origins.
Relay suite: 136 tests passed, including 11 origin HTTP/WebSocket integration
cases (about one second for the whole relay suite). Root lint, format,
typecheck and unit suites pass. The root checks still emit the known
[tsx loader warning](../../gaps/tsx-loader-deprecation-warning.md); changing
the shared cross-platform loader is separate tooling work.

The public default relay was deployed through the private dotfiles relay-only
script from source `2d1c87eb1`; only the relay service restarted. Public TLS
health and 26 origin probes pass: registered-id admission on `/ws` and `/mux`,
GET/OPTIONS CORS, other-id/malformed/other-scheme/opaque-origin rejection, and
retained hosted-web and missing-Origin access. Private infrastructure and the
US relay availability limitation are recorded in the dotfiles runbook.
Client login and typing acceptance remains step 6 after client packaging.

- Extend the origin policy with exact `chrome-extension://<id>` rules. Accept
  only that scheme and only a well-formed id (32 characters `a`–`p`); no
  wildcards, so a configured entry names one extension.
- Add the published id to `DEFAULT_RELAY_ALLOWED_ORIGINS` and make it
  expressible through `RELAY_ALLOWED_ORIGINS`.
- Apply it to both WebSocket upgrades and HTTP CORS, as for web origins.
- Relay unit coverage for parsing, matching, and rejection of malformed or
  other-scheme origins.
- Update the [relay origin topic](../../topics/relay-origin-and-share-gating.md)
  contract, then deploy the public relay.

### 3 — build the remote client for an extension origin

- Add an extension Vite config derived from `vite.config.remote.ts`: remote
  client flag on, base `/`, no CSP meta tag, theme bootstrap as an external
  script file, output into the extension package.
- Treat `chrome-extension:` as a packaged origin in `isPackagedAppOrigin`, so
  service-worker registration and web push setup are skipped rather than
  failing.
- Keep `BrowserRouter`; reload is handled in step 5.

Spiked 2026-10-13 as `packages/client/vite.config.extension.ts`. It reuses
the remote config and adds one post-order HTML transform, ahead of the CSP
plugin, that moves each inline classic script (theme bootstrap, pre-boot
composer) into its own file at the same position, so both still run during
parse. The CSP plugin then emits `script-src 'self'` with no hashes, and the
meta policy is kept as defense in depth. The web manifest link is dropped and
`play.html` (public-share frames) is not built. The hosted remote build is
unchanged. The bundle needs no `eval` or WebAssembly: `tweetnacl` and
`tssrp6a` are plain JavaScript, so the default Manifest V3 policy suffices.

### 4 — package the extension

- New `packages/browser-extension` workspace: Manifest V3 `manifest.json` with
  the pinned `key`, a background service worker, and a toolbar action that
  focuses an existing app tab or opens one.
- Request no content scripts and no all-sites host permissions. Add a
  permission only when a step proves it necessary, and record why here.
- A build script that runs the step 3 build and assembles a loadable
  directory and a store zip.

Spiked 2026-10-13. `pnpm --filter @yep-anywhere/browser-extension
build:extension` builds into `packages/browser-extension/dist`, renames
`remote.html` to `index.html`, removes web-host files (`sw.js`, `_headers`,
the web manifest), and writes `manifest.json` with the key from
[`identity.json`](../distribution/chrome-extension/identity.json). The
version is `git describe` as four integers (`v0.9.2-814-g…` → `0.9.2.814`),
with the full description as `version_name`. The manifest requests no
permissions; `chrome.tabs.query` on the extension's own URLs works without
one, so the toolbar action focuses an existing app tab. The package has no
build script under the name `build`, so `pnpm -r build` and CI do not run
it, and root typecheck skips it as it skips the Android package. The store
zip is not produced yet.

### 5 — make reloads and deep links work

First check whether the extension's background worker can answer navigations
to its own origin (a `fetch` handler serving the app shell for unknown paths).
If it can, that is the cleanest fallback and may also host streamed downloads
later. Otherwise, the background worker watches for failed navigations to
non-file extension paths and redirects to `index.html?route=<path>`, and the
app replaces the URL with that route before the router starts.

Verified 2026-10-13: it can. The background worker's `fetch` handler answers
same-origin navigations whose path has no file extension with
`/index.html`, and Chrome then keeps the requested URL. In Playwright's
Chromium with the unpacked build, `/`, `/login` and
`/-/relay/<user>/projects` each loaded with status 200 and routed normally;
`/` opens the host picker. The redirect fallback is not needed.

### 6 — verify against real hosts

Load the unpacked build (pinned id) with the deployed relay and confirm:

- login to a saved host through the public relay, and resume after closing and
  reopening the tab and after a browser restart;
- several saved hosts, as in the hosted client;
- session viewing and live updates;
- sequential typing in the composer at realistic transcript size, each
  keystroke visible within 100 ms (repository rule in `AGENTS.md`);
- reload on a session page and on Settings;
- desktop and narrow-window screenshots delivered through the artifact capture
  facility ([UI testing](../../topics/ui-testing.md)).

Record which features are knowingly unavailable (push, streamed downloads,
relay artifact frames) rather than letting them fail obscurely.

Progress 2026-10-13:

- From the extension origin, a relay login for a nonexistent server name
  opened `wss://relay.yepanywhere.com/ws` and received
  `{"type":"client_error","reason":"unknown_username"}`, so the deployed
  relay admits the origin end to end. No credential was used.
- The unpacked build is loaded in the maintainer's Chrome under the store id
  `dgeameddpnggdeenoekpiaacfghdodch`; the toolbar action opens the host
  picker and refocuses that tab on later clicks.
- Machine Control's browser debugger cannot attach to the extension's page
  ("Cannot access a chrome-extension:// URL of different extension"). That is
  the isolation this plan relies on, observed directly; verification of the
  logged-in client therefore uses desktop capture rather than page
  automation.
- Pending: login with a real password (the maintainer types it), resume,
  session viewing, typing latency, reload on session and Settings pages.

### 7 — open YA in the side panel

Use `chrome.sidePanel` with the same app page, so YA can sit beside any tab.
This is the first capability the hosted client cannot offer and the main
reason to use the extension day to day.

### 8 — publish to the store

Decide visibility (private to testers or unlisted), version numbering relative
to YA releases, and whether CI produces the store zip. Publishing a new
version is the extension's update path; until a signed-update policy exists
(open in trusted client packaging), the store account is the trust root.

## Deferred

### Issue and PR lookup

The original prompt for this plan: on a GitHub PR/issue or Jira page, click to
find the YA sessions that mention it via
[Issues & PRs](../../topics/issue-session-associations.md). With the client
inside the extension, this becomes a toolbar action, link context menu or
badge. Findings to carry forward:

- `IssuesPage` keeps its search box in local state; only `sessionId` and
  `projectId` come from the URL, so a deep link needs a `q`/`ref` parameter.
- Search is a literal `LIKE` substring (`IssueStore.list`). A browser URL such
  as `…/pull/12/files` misses the stored canonical `…/pull/12`, while
  `…/pull/12` also matches `…/pull/123`, and GitHub issue/PR URLs share
  identity but differ textually. An exact lookup should reuse the server's
  `services/issues/extract.ts` canonicalization rather than a copy in the
  extension.
- A badge needs only `github.com` and the user's Atlassian hosts, not all
  sites.

### Other later slices

- Push notifications and streamed downloads through the extension's
  background worker.
- Direct-mode (LAN/Tailscale, possibly plain HTTP) servers, including server
  origin checks and mixed-content behavior from an extension page.
- A narrowly scoped extension credential instead of the full Remote Access
  login. This is a new principal and needs
  [principals and grants](../../topics/principals-and-grants.md) review first.
- Address-bar keyword and global shortcuts.

## Topic ownership on landing

The Chrome-extension shape and its observable contract (supported features,
known unavailable ones, update path) belong in
[trusted client packaging](../../topics/trusted-client-packaging.md); the
extension origin rule belongs in the
[relay origin topic](../../topics/relay-origin-and-share-gating.md).
