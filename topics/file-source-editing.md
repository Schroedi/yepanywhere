# File source editing

> Authenticated viewers can edit local text directly and use producer-authored
> HTML targets to open an approximate location in the original source.

Topic: file-source-editing

## Viewer behavior

Ordinary `.html` and `.htm` files open as rendered, scriptless previews. An
explicit Source choice still opens raw HTML. **Edit mode** opens a workspace
covering the session and sidebar without unmounting them. Desktop uses a
source/preview split; narrow screens switch between Source and Preview. The
HTML selection view is a static snapshot, including for an interactive artifact.
Clicking a mapped item or choosing it in the keyboard-accessible target list
opens the original file at its range's starting line and UTF-16 column. The
location is explicitly approximate; character-level click mapping is deferred.
Without supported targets, edit the HTML itself. Malformed targets show an error
and leave the original HTML available for direct editing.

The selection snapshot of an ordinary project HTML file loads no external
assets, so it renders unstyled. A play toggle above the target picker turns on
the **styled preview**: it obtains an artifact grant for the file, exactly as
the viewer's interactive mode does, and rebuilds the same scriptless snapshot
with that grant URL as its base, so the page's stylesheets, images, and fonts
load from the artifact origin under the snapshot's existing policy. Scripts,
forms, and frames stay stripped, and plain click still selects a mapped item;
no modifier is needed. The notice above the panes says which preview is
showing. The toggle is absent when the source already lives on the artifact
origin, whose snapshot has that base from the start, and when the artifact
viewer is unavailable. Shift-click on the toggle opens the fully interactive
viewer in a new tab as elsewhere. A live interactive pane inside the editor,
with a click bridge injected into the served artifact, is sketched in
[live-editor-preview-select](../gaps/sketches/live-editor-preview-select.md).

File and artifact viewers share a square pencil toggle for Edit mode. The same
pencil is highlighted while editing and exits through the dirty-close flow.
HTML files also have a matching play toggle for interactive preview, beside
Edit in the viewer header; its highlighted state means scripts are running on
the isolated artifact origin. Tooltips and accessible names describe each
action. Ordinary clicks toggle in place. Shift-click opens the requested mode
in a new tab; middle-click and the browser's Open link in new tab use the same
real link. These gestures leave the original pane and draft unchanged.

Mode links use authenticated `/file-view` (beneath the current relay prefix
when applicable), carrying the original file or artifact reference and mode.
They do not grant permission. Artifact URLs must match the current source's
configured isolated origins before embedding. New edit tabs retain the
`file-source-editing` gate; interactive tabs use the existing artifact gate.

Text and Markdown viewers expose **Edit**, using the supplied file/line location.
The editor saves only on explicit Save or Save and close. Leaving a dirty editor
offers Save, Discard, or Keep editing. Save errors retain the draft. Ordinary
text viewers reload after closing a saved editor. HTML previews remain frozen:
saving does not rebuild, reload the artifact, or update source-map coordinates.
The editor warns about this after saving. No notice is sent to an agent session.

The first editor supports UTF-8 text up to 1 MiB, preserves uniform LF or CRLF
line endings, and refuses mixed line endings, binary data, and hard-linked files.
HTML up to 200 MiB can supply the selection preview, but editing a mapped source
still uses the 1 MiB limit; large HTML itself is not put into a textarea.

## Initial HTML target convention

Producers place matched HTML comments around an item or sibling range:

```html
<!--# sourceMappingURL=report.html.map -->
<!-- ya-source-target:v1 {"id":"summary","source":"../sections/summary.qmd","sourceRange":[[2,0],[7,0]],"precision":"item"} -->
<p>Rendered summary.</p>
<!-- /ya-source-target:v1 summary -->
```

The coordinates are zero-based lines and UTF-16 columns, with half-open ranges.
`source` resolves relative to the annotated map's directory, or the HTML's
directory when no map annotation exists. Relative references use forward slashes;
absolute POSIX source paths are accepted. Map annotations must be relative file
references. Targets have unique ids and properly nested paired markers; the
smallest containing mapped target wins. Only real DOM comments count, never
comment-like strings in scripts. At most 10,000 targets are accepted.

This HTML spelling and target record are YA extensions, using the familiar
`sourceMappingURL` discovery spelling and source-map coordinate conventions.
They are not a browser HTML source-map standard. This increment reads original
`source`/`sourceRange` fields in comments; it does not fetch a sidecar, decode
version-3 VLQ mappings, consume `sourcesContent`, or infer source from text.
Generated-range-only records cannot locate an original source yet. The richer
[source-map sketch](../gaps/sketches/source-mapped-artifact-editing.md) remains
future work.

## Authority, compatibility, and conditional saves

The `file-source-editing` capability gates all Edit controls and requests.
Stable 0.8.1 and 0.9.0 lack it. Without it, clients retain viewing/commenting,
hide Edit, and make no `/api/file-edit` requests. Existing capabilities keep
their meanings. This additive contract was approved by the maintainer.

Authenticated GET `/api/file-edit` accepts a local/project path, a source path
relative to an allowed HTML file, or a currently valid configured artifact grant
URL. It returns canonical path, UTF-8 content, SHA-256 revision, and `editable`.
`preview=1` allows the larger HTML read. Artifact grants locate content; they
never grant source-edit permission. All resolved files must pass the existing
canonical local-file allow-set. Public shares expose no Edit action or write API.

PUT `/api/file-edit` takes `{path, revision, content}`. It checks the current
bytes against the revision and atomically replaces the file, preserving mode.
A stale revision, another browser save in progress, a detectable in-flight agent
write, or a hard link returns a conflict. Unknown external writers are not
filesystem-locked; a writer racing after the final comparison is not prevented.
No source backup or editor state is stored inside the project.

The selection iframe has an opaque origin and runs only YA's nonce-authorized
selection script. Producer scripts, handlers, forms, and embedded frames are
removed. The parent validates frame identity, null origin, nonce, and target id;
messages select a source but never save or execute commands. Ordinary file
selection previews deny external assets; artifact selection previews may load
assets from their configured artifact origin. Authenticated YA owns reads/writes.

## Known limitations

- [No artifact rebuild trigger](../gaps/artifact-source-edit-rebuild.md).
- [Source-map positions become stale](../gaps/artifact-source-map-staleness.md).
- [Further text editing and optional session notice](../gaps/sketches/direct-text-edit-in-viewer.md).

Browser integration tests cover mapped selection, sequential typing with a
3,000-line source, disk saving, conflict preservation, direct HTML editing, and
older-server gating. Filesystem tests cover bounds, UTF-8, allow-set escapes,
pending writers, and mode preservation. Cross-platform validation is still
needed beyond Linux; WebKit is not installed on the validation host.
