# YA lacks a project mockup fixture and high-fidelity export facility

Status: proposed direction, implementation unstarted. The user requested this
gap and accepts investment in UI projects to produce YA-renderable exports.
This gap owns authoring and exporting mockups from YA's actual UI components.
The separate [HTML document viewer gap](html-document-viewer.md) owns viewing
those exports and ordinary HTML documents. Both remain open; neither schedules
implementation of the broader Interactives proposal.

## Missing behavior and current evidence

A new-feature UI discussion should be able to show YA's actual components,
styles, fonts, responsive layout, and local interactions through a repeatable
fixture/export command. `packages/client/package.json` already supplies Vite
builds but no dedicated mockup exporter. The missing authoring facility should
reuse that stack and the owning component styles.

Deliver a high-fidelity viewable HTML/CSS/assets document instead of or in
addition to an image. An image plus a link to the viewable document is an
explicitly acceptable presentation. Screenshots remain sufficient now and a
fallback while the viewer gap is open; do not claim a bundle is YA-viewable
before checking the actual supported delivery path.

Existing owners:

- [Media rendering and routing](../topics/media-rendering-and-routing.md):
  shared viewers, file authorization, transport, inline media, and zoom.
- [Parked file viewer](../topics/parked-file-viewer.md): session-level mounted
  viewer, minimize/restore, document window, composer access, and lifecycle.
- [Active content security](../topics/active-content-security.md): scriptless
  previews, incomplete asset broker, and isolated executable bundle delivery.
- [Tactical 078](../docs/tactical/078-active-content-origin-isolation.md):
  existing uncompleted viewer/asset-broker work. Implement this use case there
  rather than creating a competing isolation mechanism.
- [Interactives](../topics/interactives.md): broader optional application
  hosting proposal; persistent servers, app registries, and public hosting are
  not prerequisites for reviewing a self-contained UI export.

## Recommended export and authoring tools

Use a normal static web build: an HTML entry plus CSS, fonts, images, and
optional bundled JavaScript. Keep files in an export directory; ZIP is an
ordinary transfer envelope when one file is useful. A small versioned YA
manifest would identify the entry, title, static/scripted presentation,
named states or entry URLs, suggested viewport sizes, and screenshot fallback.
The manifest is proposed YA metadata, not an existing standard or a new UI
language. Declare the finite asset set; viewing must not install packages,
build source, or need a project dev server.

Tool choice, checked against primary sources on 2026-09-07:

| Tool/convention | Recommended role and limit |
| --- | --- |
| [Vite static build](https://vite.dev/guide/build) | Default for a small dedicated fixture entry importing real project components and styles. Relative-base output supports relocatable assets. YA already uses Vite; no new authoring framework is necessary here. Relative URLs alone do not solve sandbox delivery. |
| [Storybook static export](https://storybook.js.org/docs/sharing/publish-storybook), [CSF](https://storybook.js.org/docs/api/csf), [canvas embeds](https://storybook.js.org/docs/sharing/embed) | Established component/state authoring ecosystem. Reuse an existing Storybook; adding one is reasonable for a project that will benefit from a component catalogue. Export selected fixture stories with their providers/themes. CSF is source authoring, not a browser transport. Full Storybook support requires proving its asset/module loading in the YA sandbox. |
| [vite-plugin-singlefile](https://www.npmjs.com/package/vite-plugin-singlefile) | Optional first export adapter for one-entry demos. Inlines JS/CSS; documented public-directory/SVG and other un-inlined asset cases mean the output still needs a completeness check. Do not make this plugin's limitations the permanent transport contract. |
| [SingleFile](https://www.getsinglefile.com/) / [CLI](https://github.com/gildas-lormeau/single-file-cli) | Optional capture of a rendered page and its resources into HTML when a project export is unavailable. Useful for visual snapshots; do not infer a working application or responsive fidelity from successful capture alone. |
| [rrweb](https://rrweb.com/product/record-and-replay) | DOM/event replay is useful for recorded behavior evidence, but is a different job from freely exploring a proposed UI. Not the default export. |
| [Web Bundles](https://developer.chrome.com/docs/web-platform/web-bundles/) | Do not require browser-native `.wbn` navigation. Chrome's documentation says that experimental navigation implementation was removed in February 2023. Ordinary web files avoid that dependency. |

Prefer the project's current builder or established tools above; no custom
component renderer, JSX interpreter, or speculative serialization dependency.
Document the project adapter in `topics/ui-design.md` (the shared scheme's
default project entry, or the existing equivalent): representative screens,
component/style owners,
fixture setup, export command, and capture command. Import the design system
and realistic fixture data instead of recreating a generic visual theme.

## First implementation and acceptance

### Viewer checkpoint available for export testing — 2026-09-07

Use commit `59bbb5aaa121a98796ad3ee87468865815664f48` as the viewer
checkpoint. Its serving/configuration contract is
[Interactive HTML artifacts](../topics/active-content-security.md#interactive-html-artifacts).
The shared capability registry has been released for concurrent work.

The existing end-to-end fixture is
`packages/client/e2e/artifact-viewer.spec.ts`, with an ordinary HTML/CSS/JS/data
directory at `packages/server/test/fixtures/artifact`. The test copies a real
bundled KaTeX font into its disposable artifact directory. It starts a fresh
isolated YA instance and Vite client, exercises same-port artifact-host routing,
and tears them down. Run the verified Chromium path from the checkout root:

```bash
pnpm --filter @yep-anywhere/client exec playwright test --config playwright.artifacts.config.ts --project chromium
```

For a generated export, build an HTML entry with relative asset URLs (`base:
"./"` for a Vite export). Keep CSS, fonts, media, JavaScript modules, and mocked
data inside the entry's directory tree. Put no required assets above that root;
root-relative `/assets/...` URLs are not mapped into the grant. ZIPs must be
extracted before viewing. Supply any required providers and mocked/real data
services; YA does not recreate them.

Open the exported HTML in a fresh YA instance, enable Local Access →
Interactive HTML artifacts, and use its separate `artifacts.localhost` address
on the same forwarded YA port. Select Preview, then Run interactive preview.
The current live supervising server needs a user-managed restart before it has
this checkpoint; do not restart it from an agent session. Adapt the existing
browser scenario to the export's controls and assert actual fonts/assets and
interaction state. Passing the stock fixture alone does not verify a new export.

The stock bundle, settings saving, public-listener enable/disable, and
desktop/phone layout passed in Chromium. After the operator restarted YA,
the live public HTTPS demo also passed font/module/mock-data/menu/save checks.
The complete hosted-client embedded flow and WebKit remain unverified;
WebKit cannot launch with this host's current libraries. Keep the remaining
acceptance items below open until exercised.
Contributing-model: 6-Astra

### Export facility acceptance

1. Build one small YA fixture from real components with theme CSS, a bundled
   font/icon, long scrollable content, responsive layout, and a local toggle or
   menu. Export it with the current Vite builder; retain source and screenshots.
2. Export a complete asset set and a screenshot linked to its document, with
   selected state/viewport and regeneration instructions. Compare the source
   fixture and exported document at equal viewports, fonts, theme, and state.
3. Add the project `topics/ui-design.md` facility route with real component and
   design-language references plus verified fixture/export/capture commands.
   The shared instruction scheme can discover it without YA-specific commands
   in global policy. Do not document proposed commands as already available.
4. Once the viewer lands, verify the same export over direct and hosted-relay
   connections with the source server stopped. Until then, record which
   browser-rendered artifact is usable and keep the YA-viewability portion open.

Why not fixed in place: the user requested an open YA gap while implementing
the abstract instruction scheme in the agents repository. Project authoring
investment is accepted, but this turn does not implement the YA facility.

Found 2026-09-07 while designing project-aware UI proposal/mockup defaults and
the user requested a higher-fidelity YA export with bounded panel effects.
Contributing-model: 6-Astra
