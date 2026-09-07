# YA cannot present portable UI mockups with full project fidelity

Status: proposed direction, implementation unstarted. The user requested this
gap and accepts investment in UI projects to produce YA-renderable exports.
This records a bounded extension of the existing viewer and asset-broker work;
it does not schedule implementation of the broader Interactives proposal.

## Missing behavior and current evidence

A new-feature UI discussion should be able to show the project's actual
components, styles, fonts, responsive layout, and local interactions inside a
scrollable/zoomable session panel. The panel should expand into the existing
document-view window and minimize/restore without losing its state. Screenshots
remain sufficient evidence and a fallback, but lose selectable text, reflow,
vector sharpness, hover states, and interaction.

The current standalone HTML path reads the original HTML into
`LocalMediaModal.tsx` or `FileViewer.tsx`, then calls
`packages/client/src/lib/scriptlessHtmlPreview.ts` inside `sandbox=""`.
Its CSP permits inline CSS and data/blob images, denies scripts and network
connections, and has no font allowance. This path is constrained by isolation
and resource policy, not the rich-text fragment sanitizer. Sanitized Markdown
fragments and clipboard HTML have different contracts. Merely broadening their
sanitizer would not provide a portable, functioning component build.

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
Document the project adapter in `topics/ui-design.md` (proposed default name,
or the existing equivalent): representative screens, component/style owners,
fixture setup, export command, and capture command. Import the design system
and realistic fixture data instead of recreating a generic visual theme.

## Panel and isolation direction

User-directed requirement: relaxing YA's current rendering restrictions is
acceptable when effects remain constrained within the panel. Preserve CSS,
fonts, SVG, animation, and intended local JavaScript interactions there.
Use a separate document sandbox instead of passing richer arbitrary markup
through YA's trusted transcript DOM. The browser's
[iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
can allow scripts while withholding same-origin authority and top navigation.

Extend the existing managed viewer with inline, expanded, and parked
presentations over one state owner. Keep zoom/fit separate from layout viewport
selection: magnifying a desktop design must not silently switch its mobile
breakpoint. Preserve state and scroll when expanding, parking, or restoring,
including when transcript virtualization removes the originating row. Keep
YA-owned window controls and the composer outside the embedded document.

The trusted client should obtain a bounded export through the existing direct
or encrypted-relay transport. Follow the active-content topic's controlled
bundle option: opaque sandbox and complete asset broker, allowing bundled
scripts for the scripted profile without YA cookies, storage, APIs, native
bridges, or access to sibling frames. Broadening presentation permissions must
not grant surrounding-session authority. No popup, top navigation, or device
permission is needed for the intended mockup interactions.

Multi-file ES modules, dynamic imports, CSS URLs, webfonts, frame navigation,
and browser differences are the central delivery work. A folder or ZIP is not
directly a browser origin, and `srcdoc` does not provide a virtual filesystem.
Prove the supported asset graph in an early spike; use established parsers or
build-time inlining rather than regex source rewriting. If an opaque broker
cannot support the chosen build reliably, use the already-specified isolated
content host. Do not quietly fall back to authenticated YA-origin execution.

Static exports may render without script permission; interactive exports are
part of the target, not permanently deferred behind a static-only definition
of success. Unsupported assets/features should produce an explicit limitation
and screenshot fallback. Bound package size/file counts and path resolution.
Visual containment does not establish CPU/memory isolation: evaluate expensive
scripts, hidden animation, and close/teardown responsiveness before claiming
that all effects are contained.

## First implementation and acceptance

1. Build one small YA fixture from real components with theme CSS, a bundled
   font/icon, long scrollable content, responsive layout, and a local toggle or
   menu. Export it with the current Vite builder; retain source and screenshots.
2. Prove asset-complete static and scripted rendering through direct and hosted
   relay connections with the source server stopped. Include an ES-module
   dependency/dynamic import, or explicitly constrain the initial export
   adapter to a fully inlined build and record multi-file support as unfinished.
3. Connect the session panel to the existing managed viewer. Exercise scroll,
   zoom, viewport choice, expand, minimize, restore, and close on desktop and
   phone; verify interaction state and transcript/composer usability survive.
4. Compare screenshots of the original fixture and YA-rendered export at equal
   viewports, fonts, theme, and state. Verify that panel content cannot alter
   YA DOM/storage, navigate its parent, access YA APIs, or escape through an
   asset URL/navigation. Test supported Chromium and WebKit paths. Closing
   releases broker resources; parking must not create uncontrolled background
   activity. A cooperative pause message alone is not an isolation proof.

Why not fixed in place: this turn authorizes research and a gap, while the
implementation crosses viewer lifetime, asset transport, and executable-content
isolation. No renderer policy or dependency was changed. Before implementation,
resolve the applicable client/server capability plan under the existing
[compatibility contract](../topics/remote-hosted-compatibility.md).

Found 2026-09-07 while designing project-aware UI proposal/mockup defaults and
the user requested a higher-fidelity YA export with bounded panel effects.
Contributing-model: 6-Astra
