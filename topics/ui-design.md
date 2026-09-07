# UI design and mockup exports

> YA UI proposals use real client components in isolated Vite fixtures,
> exported as relocatable HTML, CSS, JavaScript, fonts, and linked captures.

Topic: ui-design

## Design language and component owners

Start with the actual surface being proposed: `pages/ProjectsPage.tsx` and
`components/ProjectCard.tsx` for project browsing, `pages/SessionPage.tsx`
for a session, and `pages/settings/` for settings. These paths are relative to
`packages/client/src`. Check the current component API and its providers before
reusing it. [UI architecture](ui-architecture.md) owns rendering boundaries;
[CSS architecture](css-architecture.md) owns styles and their containment.

`src/styles/index.css` supplies the existing dark/light/verydark themes,
semantic colors, spacing, typography, and bundled font faces; component-owned
styles live beside their components in CSS Modules. Reuse those tokens and
component SVGs. The normal UI font is the system sans; the example explicitly
selects the existing **YA Inter** option to exercise bundled font loading.
This is fixture configuration, not a change to the application's default.
Keep related controls grouped, allow long content to scroll, and inspect the
real desktop and phone renders under [UI testing](ui-testing.md).

## Authoring and commands

The retained example is `packages/client/mockups/projects/`: an HTML entry,
React source importing the actual `ProjectCard`, and a fixture-owned CSS
Module. Sixteen sample projects exercise attention/queue counts, long content,
responsive columns, and the card menu. `I18nProvider` uses English, and
`MemoryRouter` keeps card/new-session navigation inside the fixture. Selecting
Project settings changes local feedback; navigation displays its destination.
Neither action contacts a provider, changes project settings, or starts a
session. The fixture's explanatory copy and sample data are fixed English.

From the checkout root:

```bash
# Author the fixture on an unused port; stop this server when done.
pnpm --filter @yep-anywhere/client mockup:dev --host 127.0.0.1 --port 4310 --strictPort

# Typecheck and build HTML/CSS/JS/assets plus the versioned manifest.
pnpm --filter @yep-anywhere/client mockup:build

# Build, compare source/export renders, capture, and check direct YA viewing.
pnpm --filter @yep-anywhere/client mockup:export

# Repeat capture/direct verification against an existing build.
pnpm --filter @yep-anywhere/client exec playwright test --config playwright.mockups.config.ts

# Independently build the fixture and check hosted-relay viewing.
pnpm --filter @yep-anywhere/client exec playwright test --config playwright.artifact-relay.config.ts
```

Playwright Chromium must be installed for export/capture. The relay test also
requires OpenSSL and the relay workspace's native dependencies; see the
[isolated relay recipe](media-rendering-and-routing.md#interactive-artifact-relay-verification)
for the temporary-home wrapper and browser cache setting. The source/dev and
viewer servers used by tests are fresh, use unused ports, and are closed
by the tests. No test restarts the operator's YA server.

Output is `.artifacts/mockups/projects/`. A build replaces that generated
directory; copy an export elsewhere before regenerating if it must be kept.
The source stays in Git. `mockup:build` does not produce screenshots;
`mockup:export` is complete only on exit 0 and adds four PNG captures plus
`review.html`, whose images link to their interactive document/state.
Source-comparison and direct/relay captures are retained separately under
`.artifacts/mockups/captures/projects/`.

To revise the example, change its fixture source/data and regenerate. To build
another surface, use an isolated HTML/React entry with its actual component
providers and explicit local service substitutes, then adapt the fixture root,
metadata, and behavior assertions. The current adapter is one example, not a
component catalogue or arbitrary source-to-HTML converter. Production client
entries do not import it.

## Export contract

`ya-mockup.json` is version 1 of the `ya-ui-mockup` metadata format. It declares:

- `title`, relative HTML `entry`, and `presentation` (`scripted` here);
- selected `theme`, `locale`, and `font`;
- `states`: names and entry URLs (`default`, `selected`);
- `viewports`: named width/height pairs (1000×600 and 375×812);
- `files`: the complete finite set of exported relative file paths, including
  the manifest itself and, after capture, screenshots and the review page;
- `screenshots`: state, viewport name, image path, and linked document URL;
- `regenerate`: the command that recreates the bundle and captures.

The development manifest has empty file/capture lists because source serving
is not an export. The build manifest declares every output asset; screenshot
metadata is added by the capture command. This manifest is portable authoring
metadata, not a YA protocol capability, security allowlist, or installation
format. YA currently opens the HTML entry and does not interpret the manifest.

Vite builds with `base: "./"`, no public-directory copying, and file-based
assets. Keep all required resources below the HTML entry's directory. Import
assets through the builder; root-relative resources, parent-directory assets,
external services, and history-router fallback are not supplied by this
adapter. Viewing the export needs no source server, package install, or build.
Transfer the whole directory; an optional ZIP must be extracted before viewing.
Local state is illustrative and resets on document reload unless the fixture
deliberately implements persistence.

## Delivery and verification

When presenting a proposal, give a clickable absolute local path to the
exported HTML, such as `[Open mockup](/absolute/checkout/.artifacts/mockups/projects/index.html)`,
and a path to `review.html` or an inspected PNG as the fallback. Resolve the
actual checkout path; do not give only a source-code path or a dev URL. Explain
the interactive-preview setting below when it is required. The file-viewer
link opens the document; it is not a publicly shareable artifact grant.

When interactive delivery is configured, also create a grant through the
existing `POST /api/artifacts` route for the exported HTML and present its
returned `url` on the configured artifact domain, with its expiry. Select
the local/public audience appropriate to the user's connection. Verify that
URL in a browser, including its assets and an interaction, before calling it
usable. Ordinary taps on configured artifact links inside an authenticated
session open its [managed viewer](parked-file-viewer.md#interactive-artifact-links),
keeping the session and composer mounted on mobile as well as desktop. Prefer
that interaction for review; deliberate browser new-tab gestures remain
available. A parent policy that blocks embedding requires a frontend restart
and then a page reload. Keep the grant's directory limited to the
export, and never substitute a URL on YA's authenticated application origin.
The URL grants access until expiry or revocation; do not commit it into docs.

Open `index.html` in YA's file viewer and click the top-row source/preview
toggle once. It starts interactive HTML directly; switching back to source
stops it. Interactive HTML artifacts must be enabled in Local Access, with
a reachable separate artifact origin. Local access can use
`artifacts.localhost` on the forwarded YA port; hosted clients need a configured
public HTTPS artifact address. The exact configuration, grant, expiry, and
security contract lives in [active content security](active-content-security.md#interactive-html-artifacts).
Any required restart of a live YA server belongs to the operator.

Source/scriptless viewing remains available when interactive delivery is
disabled or unsupported; it cannot run the React fixture. Link directly to the
PNGs as the fallback. The gallery also needs interactive asset delivery to
show its linked images inside YA's viewer. An on-disk bundle or localhost dev URL alone
does not prove remote reachability. Check the user's actual configured path
before promising access through a particular hosted installation.

If **Run interactive preview** produces the browser's blocked-content page,
check the parent YA document's CSP as well as the artifact response. A stale
Vite process may still serve `default-src 'self'` without the current
`frame-src 'self' blob: http: https:` directive from `vite-plugin-csp.ts`.
That policy blocks the separate artifact host even when its health check and
grant work. It requires an operator-owned frontend restart and a page reload;
ordinary module hot reload does not establish that the HTML policy is current.
The viewer now replaces an enforced frame-policy failure with an explanation
and a link to open the granted document in a separate tab. That link remains
owned by the viewer and is revoked when it is stopped or closed.

The automated export check compares source and relocated production output
pixel-for-pixel at equal fonts, theme, state, and viewport, after waiting for
fonts. It verifies every declared file's served bytes, rejects undeclared or
external runtime requests, and checks font loading, SVG icons, scrolling,
overflow, and project-menu behavior. The source server is closed before the
export is viewed. The direct test embeds it through the existing same-port
artifact-host route; the relay test uses real encrypted authentication/grants
and a separate disposable HTTPS gateway, exercises menu/navigation at desktop
and phone sizes, checks credential separation, and revokes the grant.

Chromium on Linux is verified. The tests use portable Node filesystem/server
APIs; macOS, Windows, and WebKit remain unverified. The relay gateway explicitly
skips when OpenSSL is unavailable. These local-service tests do not attest to
a particular public tunnel or published hosted-client build. Broader HTML
inspection controls remain owned by [the HTML viewer gap](../gaps/html-document-viewer.md).

## Design decisions

- **A dedicated Vite entry with real components**, versus a new renderer or
  Storybook catalogue: uses the existing builder without runtime dependencies
  or a second UI implementation. A project with established stories can use
  its static exporter, but must prove the same completeness and viewing path.
- **A directory plus ordinary HTML metadata**, versus mandatory single-file
  inlining or browser-specific bundle navigation: preserves modules and fonts
  and works with the existing artifact grant. The current export includes the
  full shared stylesheet/font inventory and locale chunks; it favors fidelity
  over a minimal download. It does not install applications or launch servers.
- **Reuse the existing artifact isolation**, versus new hosting machinery:
  source authoring and document delivery remain separate concerns. The broader
  [Interactives](interactives.md) proposal is not required for mockup review.
