# HTML viewing loses fidelity and lacks inline drag/pinch inspection

Status: proposed direction, implementation unstarted. This gap owns richer
display of HTML documents and their assets, including ordinary linked files
and [project mockup exports](ui-mockup-export-bundle.md). A special bundle must
not become mandatory for a simple HTML document with neighboring resources.

## Current limitation and existing owners

`LocalMediaModal.tsx` and `FileViewer.tsx` display HTML through
`packages/client/src/lib/scriptlessHtmlPreview.ts` inside `sandbox=""`.
The wrapper permits inline CSS and data/blob images, denies scripts and network
connections, and has no font allowance. Standalone HTML viewing is constrained
by this document/resource policy; the rich-text fragment sanitizer is a
different mechanism. Broadening that sanitizer alone cannot fix this path.

Reuse [media rendering and routing](../topics/media-rendering-and-routing.md)
for authorization, transport, file links, and inline media, and the
[parked file viewer](../topics/parked-file-viewer.md) for document-window
ownership, zoom, fullscreen, minimize/restore, and composer access. The
[active-content contract](../topics/active-content-security.md) and
[tactical 078](../docs/tactical/078-active-content-origin-isolation.md) already
track incomplete asset brokering and isolated executable content. This is a
concrete viewer use case for that work, not a competing hosting system.

## User-directed behavior

Allow higher-fidelity HTML/CSS, fonts, SVG, animation, and intended local
JavaScript effects inside a scrollable/zoomable session panel. Relax current
presentation restrictions where isolation can keep the effects within it.
Support both a self-contained bundle and an HTML document referencing other
authorized files: relative stylesheets, images, fonts, and linked documents.
Resolve references from the document, not from the YA page URL. Cross-document
links stay within the shared viewer/navigation model and preserve file access
checks; a link is not authority to read arbitrary host files or fetch the web.

Inline previews should support drag-to-pan when zoomed and two-finger pinch
zoom with movement around the gesture's focal point. Keep ordinary scrolling,
text selection, and embedded controls usable. Expand into the existing
document-like window; minimize and restore it through the session controller.
The source preview may be a rendered document or an image linked to that
document. Keep one state owner across inline, expanded, and parked forms,
including when transcript virtualization removes the originating row.

Keep zoom/fit separate from layout viewport selection: magnifying a desktop
design must not silently switch its mobile breakpoint. Preserve local
interaction state, scroll and zoom during expand/minimize/restore. YA-owned
window controls and the composer remain outside the embedded document.

## Implementation direction and crux

Use a separate document sandbox rather than inserting richer arbitrary markup
into YA's trusted transcript DOM. The standard
[iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
can permit scripts while withholding same-origin authority and top navigation.
The trusted client should fetch authorized, bounded resources over existing
direct or encrypted-relay transport and broker them into the document. This
follows the active-content topic's controlled-bundle option without granting
YA cookies, storage, APIs, native bridges, or sibling-frame access. Popups,
parent navigation, and device permissions are unnecessary for these effects.

Multi-file ES modules, dynamic imports, CSS URLs, webfonts, frame navigation,
and browser differences are the central delivery work. A folder or ZIP is not
a browser origin, and `srcdoc` supplies no virtual filesystem. Prove the
supported asset graph in an early spike using established parsers or build-time
inlining, not regex source rewriting. If an opaque broker cannot support the
chosen build reliably, use the already-specified isolated content host. Do not
fall back to execution on an authenticated YA origin.

Static and scripted documents are both part of the target. An initial static
slice or fully inlined adapter must leave unsupported functionality explicit.
Bound package size, file counts, and path resolution; show a clear limitation
and screenshot fallback when needed. Visual containment does not establish
CPU/memory isolation: evaluate expensive scripts, hidden animation, and
close/teardown responsiveness before claiming all effects are contained.

## Acceptance

- Compare a source fixture and YA's view at matching viewport, fonts, theme,
  and state. Include relative CSS, a webfont, SVG/image, a linked HTML page,
  and a local scripted control. Test ordinary linked files and packaged output.
- Exercise direct and hosted-relay delivery with the source dev server stopped.
  Include an ES-module dependency/dynamic import or record that missing support
  as unfinished. Verify supported Chromium and WebKit paths.
- On desktop and phone, inspect inline scrolling, drag-pan, focal-point pinch,
  selection, controls, zoom/fit, expand, minimize, restore, close, and linked
  document Back. Preserve interaction state and session/composer usability.
- Verify document content cannot alter YA DOM/storage, navigate its parent,
  access YA APIs, or escape through resource URLs or document navigation.
  Closing releases broker resources. Parking must not create uncontrolled
  background activity; a cooperative pause message alone proves no isolation.
- Resolve any new client/server capability plan through the existing
  [compatibility contract](../topics/remote-hosted-compatibility.md).

Why not fixed in place: the user requested this gap while the generic
instruction scheme is implemented in the agents repository. The YA change
crosses viewer lifecycle, gesture handling, transport, and document isolation.

Found 2026-09-07 while specifying project mockup export and broader HTML viewer
freedom, including linked resources and inline drag/pinch zoom.
Contributing-model: 6-Astra
