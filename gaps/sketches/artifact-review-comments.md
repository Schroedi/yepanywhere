# Quote and batch-comment on rendered session artifacts

Status: actionable proposal, not implemented. Requested 2026-09-21.

Let a user point at a session right-pane artifact, quote-reply or open a
comment editor at that location, collect several comments, and explicitly
submit the set to the originating session. Cover text and non-text targets,
especially SVG. A separate browser tab may return to that session if cheap;
right-pane-only is an acceptable first release. This is new capability, so it
lives under sketches rather than asserting an existing contract is broken.

## Existing owners and the missing seam

- [Selection comment UI](../../topics/selection-comment-ui.md#session-file-comment-mode)
  already owns source-aware quote replies and inline session-file comments.
  `packages/client/src/components/FileViewer.tsx` explicitly excludes HTML
  previews from Comment mode. Its source and Markdown editors are reusable.
- `lib/sessionFileComments.ts` and `hooks/useSessionFileComments.ts` under
  `packages/client/src/` own draft keys, batch formatting, persistence and
  removal of successfully submitted snapshots. Existing text mode sends on
  Enter and flushes on blur/close/minimize; that is **not** the requested
  deliberate review-set submission behavior. Preserve that existing mode.
- `components/ArtifactPreview.tsx`, `ArtifactLinkViewer.tsx`, and
  `SessionRightPane.tsx` display separate-origin or scriptless iframes, without
  a rendered-target annotation adapter. Parent selection listeners cannot
  reach inside those frames. A keyboard shortcut alone cannot fix this.
- [Session right pane](../../topics/session-right-pane.md) owns placement and
  lifecycle. [Active content security](../../topics/active-content-security.md#preview-and-authority)
  owns artifact isolation; the current contract supplies no host bridge.
- [Plannotator integration](plannotator-integration.md) owns CLI app reach and
  vhost delivery. This proposal owns artifact comments, not a replacement proxy.
  [HTML viewer](../html-document-viewer.md) owns broader document interaction;
  [direct text editing](direct-text-edit-in-viewer.md) is a separate write feature.

YA inspection: 2026-09-21 working tree; relevant symbols above were checked
against implementation. No runtime or browser acceptance trial was performed.

## Plannotator suitability: trial before building another annotator

Upstream inspected at
[`8f2a8a81a384f1cd39c5f083d3c6fcd35a956422`](https://github.com/backnotprop/plannotator/tree/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422).
This is source evidence, not proof that YA's installed binary has these APIs.

| Evidence | Consequence for YA |
| --- | --- |
| [`HtmlViewer`](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/ui/components/html-viewer/HtmlViewer.tsx) accepts annotations, add/select callbacks, drag or pinpoint input, and an annotation-mode toggle. | Trial it as the sole rendered-artifact annotation surface; YA supplies session ownership and submission. |
| [`html-anchor.ts`](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/core/html-anchor.ts) records selector/tag/text/point and bounded element context. | Useful location awareness exists even without selectable text. The HTML anchor does not contain a source filename/line range. |
| [`parser.ts`](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/ui/utils/parser.ts) exports element context with feedback. | Preserve that context through YA submission; do not reduce comments to prose alone. |
| [`@plannotator/ui` host documentation](https://github.com/backnotprop/plannotator/blob/8f2a8a81a384f1cd39c5f083d3c6fcd35a956422/packages/ui/README.md#raw-html-annotation-viewer-htmlviewer) describes reusable components and host seams. | A library adapter is a supported candidate, distinct from launching a CLI process per artifact. |

**Recommendation:** first prove the library adapter on one HTML/SVG artifact.
If it meets the acceptance checks below, use Plannotator exclusively for this
new rendered-artifact comment UI. Keep YA's existing text-file quote/comment
workflow. Do not install a dependency or replace the production viewer merely
on this source inspection; first check package availability, license,
dependencies, lazy-load cost, asset resolution and browser behavior.

There are material integration questions. Plannotator's `src` live-app mode
expects its proxy to inject the bridge and declares an unsandboxed frame; it
is not a drop-in wrapper around YA's granted artifact URL. Its raw-HTML mode
has different asset/CSP requirements. `annotateModeActive=false` also leaves
text-selection commenting live, so it alone does not implement YA's opt-in
default. The trial must preserve the ordinary viewer until explicitly armed.

The CLI is a second candidate when already running a Plannotator review:
present its UI through the existing app path and let that invocation receive
its feedback once. CLI JSON is not automatically a structured YA comment-set
API, and return to the launching tool is not the same as a new session turn.
Do not both deliver CLI feedback and inject a duplicate YA message. Generic
viewed artifacts should not require an agent to start a blocking review tool.

If the library trial fails, record the concrete failed criterion. Reuse YA's
editor/draft primitives with a small artifact target adapter; do not reproduce
Plannotator's full UI or broadly rewrite HTML with regexes.

## Intended interaction and submission

1. Default-off artifact commenting exposes a visible **Comment** action,
   including on touch. Opening ordinary artifacts keeps native interaction.
   Start with a viewer-scoped accelerator to arm/disarm comment mode, then
   click to target; prefer Plannotator's existing Mod+Shift+A candidate only
   after auditing YA, browser and OS conflicts. Do not claim it is reserved
   yet. A modifier-click is optional convenience after that audit, never the
   only entry; avoid stealing Ctrl/Cmd-click new-tab and Shift-selection.
2. A text selection anchors exactly that passage; a collapsed caret anchors
   its enclosing source/rendered block. Pointer targets can be elements or
   image regions. Open a nearby editor without covering the target; narrow
   layouts may use a sheet. Escape dismisses the editor/mode without sending.
3. **Quote reply** inserts the captured quote/location into the originating
   session composer at its remembered caret (append if no caret is available),
   retaining existing draft text and undo. An element without text contributes
   an honest element/region description, not a fabricated quotation.
4. **Add comment** saves an item in the review set. Enter/newline and explicit
   Add behavior must be clear in the editor; neither blur, focus transfer,
   minimize, close nor session navigation sends this new review set. Show a
   count/list with edit, remove and return-to-anchor actions.
5. **Send N comments** previews the destination and sends one ordered user
   message through YA's existing session send/queue path. The main composer
   is untouched. Freeze the submitted snapshot; preserve edits made in flight.
   Failure retains drafts. Prevent repeat clicks; if acknowledgement is lost,
   use the existing request identity/receipt mechanism if available, otherwise
   report uncertain delivery rather than silently retrying.
6. Draft ownership is the source/server identity + canonical YA session id +
   project + artifact identity, never whichever session is currently visible.
   Restore locally after viewer closure; show the destination when reopening.
   Handle a deleted/unavailable destination explicitly; never redirect silently.
   Keep storage bounded and outside project files, following
   [project storage](../../topics/project-directory-storage.md).

## Context and locating non-text targets

One captured target record accompanies each comment. Proposed fields: stable
artifact identity/path, capture-time content hash or revision, resource/page
within the artifact, anchor kind, quote if any, rendered element context,
optional exact source span, normalized geometry, and user text. Keep source
identity and session routing in trusted YA state. Omit bearer grant URLs from
provider text; those are credentials, not durable source citations.

Distinguish **exact source**, **rendered element**, and **visual region** in
the review UI and submitted context. A DOM selector is not a source map.

| Content | Capture and mapping plan |
| --- | --- |
| Text/Markdown/source | Reuse aligned source offsets, quote and nearby lines from the current selection machinery. Preserve repeated-text disambiguation. |
| Static HTML or inline SVG | Hit-test inside the cooperating frame; prefer semantic element/id, enclosing group, label and a bounded element outline. A parser with source offsets can associate nodes of the original immutable document with exact HTML/SVG spans. Instrument only the review copy or use a sidecar map; never edit the author's file. |
| Script-generated DOM/SVG | Capture rendered context first. Use explicit author/build metadata for source locations only when resolvable and validated against the loaded revision. A runtime node or React component name alone does not identify its authoring line. |
| SVG loaded through an image element | The outer page sees the image, not its internal paths. Annotate a normalized region initially; exact SVG targets need a dedicated isolated SVG document view or an author-supplied mapping. Handle transforms, viewBox, nested groups and use/instance ambiguity. |
| Raster image, canvas or WebGL | Store region coordinates in intrinsic content space plus dimensions and a retained crop/snapshot when supported. Canvas pixels have no generic mapping back to drawing-source code; require explicit hit-region metadata for exact source attribution. |
| Uncooperative external app or inaccessible nested frame | Offer whole-artifact context or an explicit screenshot-region workflow. Do not pretend parent listeners can inspect its DOM. |

Capture viewport, zoom and scroll interpretation where needed; screen pixels
alone are not a durable anchor. Re-resolve against the capture revision. After
reload/content changes, retain the old quote and mark unresolved or ambiguous
anchors for review; never silently attach them to a similarly placed element.
Bound excerpt, context and screenshot sizes. For a visual-only comment the
agent must receive the image/crop through a supported attachment path, not
just a client-local blob URL. Initial text/element support may defer crops
explicitly if that path is unavailable.

## Bridge and optional new-tab return

Any annotation bridge is a deliberately new, bounded protocol under the
active-content contract. It may propose target data and reflect marker state;
it cannot execute commands, select arbitrary sessions, read YA storage, or
send provider input. Validate window source, expected origin where meaningful,
per-view instance/channel, schema and size. Opaque frames require a scoped
channel rather than treating the shared `null` origin as identity. All frame
data is untrusted even when its origin matches. YA chrome owns Send.

Keep current artifact isolation and granted-root resource access. Do not
adopt an unsandboxed live-view mode or enable scripts in scriptless viewing
without reviewing that explicit contract change. Pin both bridge and host
versions; unavailable/mismatched bridges leave a readable viewer with a clear
annotation limitation. Stop listeners/observers on teardown; no idle polling.
Any new server route/field needs the existing capability and hosted-client
compatibility review before implementation.

The cheap new-tab candidate is a **YA-owned review route**, opened by a user
gesture, embedding the same isolated artifact with an authenticated review
destination and a **Back to session** link. It uses canonical YA session and
source identity, not a provider thread id. Keep `noopener`; do not rely on an
opener surviving or transfer session credentials into the artifact. A raw
artifact tab has no YA authority and need not gain commenting in v1.
If source selection, authentication or draft sharing makes the wrapper a
substantial project, ship the right-pane workflow first and leave this item
explicitly deferred. Mere artifact possession is never submission authority.

## Implementation sequence and acceptance

1. **Prove the annotation adapter.** Isolated fixture with selectable text,
   textless inline SVG, a relative asset/module and a dynamic target. Exercise
   Plannotator callbacks, returned context, loaded-version compatibility and
   native interactions while disabled. Check actual installed/published APIs;
   preserve a small feedback specimen without private content. Decide library
   versus YA adapter from evidence before integrating production code.
2. **Connect the session review set.** Add the opt-in action at the managed
   viewer boundary, a captured-target adapter, and explicit draft/set state.
   Reuse `ReviewCommentEditor`, snapshot-clearing logic and
   `SessionViewerCommentContext` where their contracts fit. Do not reuse the
   existing auto-flush lifecycle. Prove text quote reply and one batch of mixed
   text/element comments to the correct session before adding exact SVG maps.
3. **Add source mapping and honest degradation.** Test static SVG source spans,
   duplicate text, dynamic nodes, image SVG, transformed geometry, reload and
   unresolved anchors. Preserve frozen context on source edits. Prove a useful
   comment still reaches the agent when exact source mapping is impossible.
4. **Verify delivery and lifecycle.** Real browser tests over direct and
   hosted-relay paths, covering two sessions viewing the same artifact,
   navigation/minimize/restore, draft recovery, failed/uncertain sends, in-flight
   edits, hostile frame messages, bridge failure and revoked artifact access.
   Existing text Comment mode and ordinary artifact controls must retain their
   current behavior. Inspect 1200×600 and 375×812 captures through the artifact
   capture facility. Sequential typing in both comment editor and main composer
   during a 240-message live session must lose no keystrokes and acknowledge
   each within 100 ms. Run normal client/server checks for the changed paths.
5. **Try the tab wrapper only if cheap.** Prove reload and Back to session on
   the same authenticated YA source, plus opener-closed behavior. Otherwise
   record it as deferred; it does not block right-pane acceptance.

Done means a user can point to a textless SVG part and a text passage, add
two comments without sending on focus changes, then submit one turn containing
both useful anchors to the originating session while preserving composer text.
An exact source citation is required only when demonstrably mapped; otherwise
the received context explicitly names the rendered element or visual region.

Why not a direct fix: iframe cooperation, target provenance and deliberate
batch lifecycle cross existing isolation and input-ownership contracts. The
user authorized an actionable plan; no runtime dependency or protocol change
is necessary to deliver that plan. Roadmap priorities are unchanged.

Found 2026-09-21 while planning user-requested artifact quote replies and
batch comments with possible exclusive Plannotator UI reuse.
Contributing-model: 6-Astra
