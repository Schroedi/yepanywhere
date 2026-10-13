# Chrome extension client

Topic: chrome-extension-client

Status: proposed 2026-10-13, experimental. The maintainer is registering the
Chrome Web Store item to obtain a stable extension id; no implementation yet.

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

- **The relay refuses extension origins.** `/ws` and `/mux` upgrades check
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

Create the Chrome Web Store item (maintainer, on another machine) and record
its id and public key. The manifest's `key` field carries that public key so
unpacked development builds get the same id as the published item. Record the
id in this plan and in the relay defaults (step 2).

### 2 — let the relay accept the extension origin

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

### 4 — package the extension

- New `packages/browser-extension` workspace: Manifest V3 `manifest.json` with
  the pinned `key`, a background service worker, and a toolbar action that
  focuses an existing app tab or opens one.
- Request no content scripts and no all-sites host permissions. Add a
  permission only when a step proves it necessary, and record why here.
- A build script that runs the step 3 build and assembles a loadable
  directory and a store zip.

### 5 — make reloads and deep links work

First check whether the extension's background worker can answer navigations
to its own origin (a `fetch` handler serving the app shell for unknown paths).
If it can, that is the cleanest fallback and may also host streamed downloads
later. Otherwise, the background worker watches for failed navigations to
non-file extension paths and redirects to `index.html?route=<path>`, and the
app replaces the URL with that route before the router starts.

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
