# Trusted Client Packaging
> Trusted client packaging pins YA client code delivery through signed or local
> app installs so Remote Access credentials and cached session keys do not
> depend on live hosted JavaScript.

Topic: trusted-client-packaging

## Problem

Normal Remote Access can be zero-trust with respect to the relay only when the
entry client code is trusted. A hosted client such as `ya.graehl.org` is a
convenient bookmark/PWA entry point, but a compromise of that hosted JavaScript
can steal a password or cached resume secret before the SRP and encrypted relay
transport protections matter.

Trusted client packaging is the candidate answer for the stronger threat model:
the relay may be compromised, and the live hosted web origin may later be
compromised, but the user has already installed or pinned a trusted client.

## Candidate Shapes

- A packaged Android app serves bundled YA client assets from the app itself
  and only needs WebSocket connectivity to the configured relay.
- A Chrome-friendly local-client setup serves pinned client files from a stable
  local or extension origin rather than from a mutable hosted origin.
- A signed-update flow downloads replacement client assets only after verifying
  a manifest and artifact hashes under pinned graehl/kzahel signing keys.
- A first-run native flow uses full SRP with the Remote Access password; later
  native reconnects use the Keystore-protected resume credential without
  asking a hosted page for the password again. The bundled web client normally
  consumes that authenticated native connection without receiving the
  credential.

The mobile ownership decision is recorded separately in
[`mobile-server-pairing.md`](mobile-server-pairing.md): native Compose and
background operation use a native secure connection core, while the bundled
full web client acquires an isolated logical lease on the same core.
The accepted shared Rust/iOS direction and unchanged-server compatibility
contract are owned by that topic's
[iOS and shared Rust section](mobile-server-pairing.md#ios-and-shared-rust-direction).

## Current Mobile Packaging Checkpoint

The first-class Android application has two explicit asset channels. Local
debug and ordinary production builds bundle the current checkout's client
assets through Android's HTTPS app-assets origin; a separate hosted-`latest`
release channel loads a fixed YA HTTPS origin for Play internal or closed
testing. Neither channel accepts an arbitrary runtime UI URL. Its native host
is exact-origin and main-frame bound and exposes only declared high-level
methods. The small control-plane methods are `host.describe`,
`notifications.status`, and the explicitly user-triggered
`notifications.requestPermission` and `notifications.manage`, which opens the
native Servers screen; no method exports native credentials.

The signed Android package also owns one platform-native launcher identity:
YA's white Y over the established green gradient. Android 8 and later receive
separate full-bleed background, foreground Y, and monochrome Y layers so each
launcher can apply its own circle, squircle, themed tint, and motion effects.
The artwork does not bake in a rounded tile, bevel, border, or shadow. Because
the app's minimum SDK is 24, only Android 7 and 7.1 use density-specific legacy
PNGs; those fallbacks precompose the same Y over a green circle. Google Play's
512-pixel listing icon remains a separate full-bleed artifact rather than a
launcher resource.

The selected foreground is the bundled full web UI, with native login and host
management. A duplicate native dashboard or Conversation renderer is not a
release prerequisite. Hosted-latest retains independent web authentication and
never receives the privileged bundled native transport.

Android host management exposes the publisher privacy policy at
`https://graehlarts.com/privacy.html#yepanywhere` before pairing or login,
using the platform's external URI handler. This link carries no saved
host credentials and does not change the bundled client origin.

Bundled app-assets JavaScript is trusted application code: it is shipped under
the APK signature, is isolated in the app WebView, and does not load ordinary
browser extensions. It may legitimately read and modify YA application data.
The native host still remains exact-origin and method-scoped as inexpensive
defense in depth.

The bundled client normally uses a native data-plane adapter so an already
authenticated Android user enters the complete application without a second
web login. The adapter exposes high-level
source operations over a bounded exact-origin channel; Kotlin keeps SRP and
resume material private and arbitrates concurrent Compose, foreground-service,
and WebView leases. Binary uploads remain chunked and flow-controlled rather
than copied into one bridge message.

Still unresolved are the stable public asset update/signing policy and the
remaining storage/rotation acceptance across release-device builds. An
independently authenticated
WebView remains a possible future performance or isolation mode, but it uses
normal explicit SRP and its own browser-scoped resume session. The baseline
does not mint or hand off a child credential. Native installation and
push-management secrets remain app-private and are not web credentials.

## Android Internal CI Delivery

Android CI builds a bundled Release AAB in its verification job. Publication
requires an explicit manual dispatch on main with `publish_internal=true`,
the repository publishing switch enabled, and both build and instrumentation
gates passing. It signs that run's exact artifact with the existing upload key
and publishes to the existing Play internal testing track. Pushes, nightly
runs, tags, pull requests, forks and manual runs without the publish option
cannot publish. The hosted-latest flavor is verified separately and is not
the uploaded package.

CI codes are `10000 + run_number * 100 + run_attempt`; attempts must remain
below 100. These monotonically advance for new workflow runs without a source
version bump. The human version is `0.1.2-ci.<run>.<attempt>`. Local fixed-version
builds retain their checked-in version. After CI delivery starts, local manual
uploads must explicitly choose a code above the current Play release.

Publishing uses short-lived GitHub OIDC credentials for a dedicated Play
publisher; this is a deployment principal, separate from YA owner/user/device
principals and application transport credentials. The Google grant is limited
to this app's testing releases. Production and tester membership are not
modified. The workflow retains a signed AAB and receipt with source SHA,
version, bundle SHA-256, internal track and publication result.

A requested release of the already published source is skipped. An older version
cannot replace a newer internal release. A mismatching uploaded bundle, unknown
track, failed test, rejected API validation or failed commit stops publication;
there is no fallback to a different track or an uninstallable draft.
Verification runs cancel superseded runs on the same ref. Explicit release
runs use a separate concurrency group and finish without automatic cancellation;
a new push cannot interrupt the selected release or its Play edit. Only the
latest pending release is retained. Failed builds leave the preceding available
internal release in place.

Setup and activation state are in [mobile store preparation](../docs/distribution/mobile/README.md#android-ci-internal-delivery).
The trusted delivery path is enabled and verified: its first successful hosted
publication produced code 56401, with its signed bundle and receipt retained
and Play availability confirmed. Both Android verification gates and the
main browser CI suite passed for that source. The maintainer subsequently
selected explicit release requests instead of publication after every CI run.

## Selected iOS Packaging Direction

The iOS shell bundles the same full React application in the signed app and
loads it in WKWebView. SwiftUI owns login and host management; the shared Rust
core owns authenticated transport, and Keychain protects persisted resume
credentials. The bridge grants only bounded, source-scoped operations to the
owning bundled main-frame document. Passwords, resume keys and transport keys
never enter JavaScript. Navigation or document destruction invalidates its
handles and releases its native leases.

The consumer application is implemented in `packages/ios`, with shared native
transport in `packages/mobile-core`. The iOS 17+ shell uses a bundled
`yepapp://bundle` origin and a separate persistent WKWebsiteDataStore per
native profile. No developer server or hosted login is part of this path.
Full replacement navigation and renderer loss invalidate the document handle.
Asset path traversal and foreign/stale document messages are rejected.

The privileged document forbids embedded frames. Its additional CSP is inserted
before bundled scripts and fails closed if the entry HTML cannot be recognized.
This policy excludes executing same-origin children that could proxy through
parent functions; `isMainFrame` alone is not asserted to distinguish such calls.
Embedded HTML/app viewers need a separately unprivileged surface before they
can be enabled. Blob download navigation also awaits a native download adapter;
these [viewer/export gaps](../gaps/ios-webview-viewers-and-downloads.md) remain
release acceptance work. The existing native source adapter's speech/device-stream
unsupported fallbacks also remain in effect.

Simulator acceptance covers the shipped React UI, source requests and events,
chunked responses, upload-consumption acknowledgement, Blob media metadata,
Keychain persistence/failure paths, native continuity proofs, real sequential
keyboard input with concurrent updates, saved routes/drafts across suspension
and relaunch, and native Switch Host. The Apple device target links separately;
physical-device, signing and notification delivery remain release acceptance.
Reproducible commands and packaging limits live in
[the iOS README](../packages/ios/README.md).

## Chrome Extension Client

The experimental Chrome extension (id `dgeameddpnggdeenoekpiaacfghdodch`,
[plan 151](../docs/tactical/151-chrome-extension-client.md)) serves the full
remote client from its own origin and adds a side panel. Other extensions
cannot inject into or debug its pages, and its storage belongs to it alone.

- **Permissions.** Installed with `sidePanel`, `storage`, `activeTab` and
  `contextMenus` only, none of which shows an install warning. Host access
  is optional and granted per site by the user from the side panel or
  Settings → Browser extension; there are no content scripts, no `tabs`
  permission and no `externally_connectable` entry.
- **Credentials.** Saved hosts and resume sessions stay in the extension
  origin's `localStorage` under the existing compare-and-set rules. Extension
  pages mirror that record into `chrome.storage.local` after each write, for
  the background worker only; the worker reads it, resumes the saved session
  on demand, and never writes a credential. Saved logins never enter
  `chrome.storage.sync`.
- **Contexts.** The app tab, the side panel and the background worker each
  connect to a host when they need it and close idle connections; nothing
  keeps a persistent background page or offscreen document.
- **Side panel.** Opens from the toolbar button. On a GitHub issue/PR or Jira
  page it lists, across the active hosts, the sessions that mention that item
  by exact identity. On a session page, in the extension's own app tab or in
  the hosted app on `yepanywhere.com` and its subdomains, it lists that
  session's issues and PRs from the active host whose relay username the
  route names, and says so when no active host matches; opening one opens
  the tracker page in a new tab. The app tab publishes its route to
  `chrome.storage.session` for this, since the panel cannot read its
  address, and withdraws it when the page goes away. Elsewhere the panel
  lists sessions needing input, running and recent; each group collapses
  from its heading, and collapsed groups stay collapsed across panel opens
  (extension-origin `localStorage`). The top of the panel always has a
  "+ New session" button, which opens the default host's new-session page
  in a dedicated popup window. On an issue or PR page it also has "+ New
  session about this", which opens the same window with the item's address
  already in the composer and, for GitHub, the project whose name matches
  the repository selected. There is at most one such window: the buttons
  bring it forward and show their new-session page in it in place (a plain
  "+ New session" leaves a new-session page it already shows alone), and
  opening sessions or the app from the panel never navigates it. It saves
  its own size and place, opens narrower than the desktop layout so the app
  shows no sidebar, and Ctrl/⌘-click opens an ordinary app page instead.
  A session page is looked up whenever its address is readable, regardless
  of the issue allowlist. A toolbar click makes the clicked page readable
  once (`activeTab`);
  automatic lookup and the per-tab badge count need granted site access and
  respect the optional repository/project allowlist. Opening a session
  navigates the existing YA tab in place, or opens one.
- **Opening the app.** The side panel header has an "Open Yep Anywhere"
  button, and the toolbar button's right-click menu has "Open Yep
  Anywhere" and "Open Yep Anywhere in a popup window". "Open Yep Anywhere"
  brings the most recently used YA tab or popup forward without
  navigating it, or opens a new app page. The popup item always opens a
  new popup window. When the toolbar button is set to open the app, the
  menu also offers "Open the side panel", which reads the clicked page
  once as a toolbar click does. Menu items appear only on the toolbar
  button, never on web pages.
- **Popup window.** With Settings → Browser extension → "Open Yep Anywhere
  as" set to a popup window, every new YA page the toolbar button or the
  side panel opens is a Chrome popup window (no tabs or address bar) instead
  of a tab. A popup counts as the existing YA tab for later opens. Each
  popup saves its size and place when resized or closed, and the next popup
  opens there, falling back to a default size when Chrome rejects those
  bounds. The default is a browser tab.
- **Settings.** Settings → Browser extension appears only on the extension
  origin and stores its values in `chrome.storage.local`, not on any host.
- **Known unavailable.** Push notifications, streamed downloads, HTML
  artifact previews and direct (LAN) hosts. The update path is the store
  item; until a signed-update policy exists the store account is the trust
  root.
- **Publication.** The extension has its own three-part store version in
  `packages/browser-extension/package.json`, independent of server versions.
  `scripts/release-extension.sh <version>` bumps it and atomically pushes main
  and the matching `extension-v<version>` tag after a committed changelog entry.
  Tagged main-branch releases build, audit and exercise the exact upload ZIP,
  then submit that artifact for automatic publication after Google's review.
  A dedicated GitHub environment uses Google workload identity federation and
  a publisher-linked service account, without stored keys. This deployment
  principal is separate from YA owner/user/device grants. Trust is restricted
  to this repository, workflow, environment, main and extension release tags.
  Publication checks the pinned store id/public key, clean source revision and
  ZIP checksum. It refuses policy warnings, older versions and replacing a
  different pending submission; retries recognize an already submitted or
  published version. A GitHub release retains the ZIP, checksum, source record
  and store receipt after submission, without claiming review has completed.
  Manual `package` dispatch only builds artifacts; `check` on main performs
  authentication and a read-only store status check. The ZIP preserves the
  public-key-derived id, contains all scripts locally, and requests only the
  permissions listed above. Listing/privacy changes still use the dashboard.
  Store assets, setup and release commands live in
  [store preparation](../docs/distribution/chrome-extension/README.md).

## Deferred Verification Setup

A useful host-local regression gate would run a separate YA checkout or built
artifact, not the in-tree hot-reload instance, with its own data directory,
ports, and fixed relay reservation name. A script could refresh that isolated
server, load credentials from an operator-private file, register it with the
relay, serve the candidate remote client, and then run the same browser path a
GitHub Pages publish would expose. That would test the actual hosted-client +
relay + YA-server shape before pushing Pages changes, while keeping private
relay credentials out of the public repo.

## Security Requirements

- A pinned value must be a verification key, key commitment, or server-auth
  proof input. It must not be a bearer token that an impostor server can simply
  accept.
- The client must authenticate the YA server, not merely the relay username.
  Full SRP already gives the client a server proof; session resume must also
  require an encrypted server proof bound to fresh client/server nonces before
  the client enters authenticated state.
- Cached resume material is secret bearer-equivalent material, not public-key
  material. Store it in the narrowest available app/origin scope and make it
  revocable from the YA server.
- The relay remains transport-only for authenticated Remote Access. It may see
  pairing metadata, timing, sizes, and public-share plaintext, but it must not
  receive Remote Access passwords or application plaintext.
- Public read-only shares remain a separate plaintext-to-relay design until YA
  grows share-specific end-to-end encryption.

## Current Remote Access Boundary

Protocol 3 resume uses a client nonce in `srp_resume_init`, the server's
one-time resume challenge as the transport nonce, and a `serverProof` encrypted
under the stored base session key. A relay-controlled impostor server can still
ask the client for a resume proof, but it cannot produce the server proof unless
it also has the stored resume key. The proof also carries the server's resume
protocol version; the client pins the highest authenticated protocol version it
has seen in local storage and rejects later resumes that prove a lower version.

That closes the compromised-relay false-server path after first trusted login.
It does not protect the password or cached resume key from malicious JavaScript
served by the trusted web origin itself. Avoiding that stronger hosted-client
threat requires signed or locally served client packaging.

## Open Questions

- How are permanent bundled web assets updated and verified without making
  live hosted JavaScript the credential trust root or waiting indefinitely for
  fixes behind app-store review?
- Do representative full-web workloads ever justify an independently
  authenticated bundled-WebView mode despite the duplicate login and extra
  server session?
- Should graehl and kzahel use independent signing keys, a threshold policy, or
  a primary/backup-key policy with explicit rotation?
- What is the minimum browser storage model that keeps local-file or
  extension-served YA ergonomic while preserving WebSocket, clipboard, and
  service-worker behavior?
- Should first full SRP also pin a server-auth public-key commitment, so future
  first-login-like flows can detect an impostor before revealing any password
  proof material?
