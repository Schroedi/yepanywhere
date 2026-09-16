# Session right pane

> The session right pane is an opt-in, session-owned column that shows
> auxiliary content beside the transcript: a right-edge drawer on a
> narrow viewport, and a resizable side-by-side column on a wide one,
> with the left sidebar collapsing while the pane is expanded.

Topic: session-right-pane

Status: implemented for static-vhost tool URLs and artifact links. File-viewer migration remains
deferred; multiple viewer tabs are a sketch rather than shipped behavior.

See also:

- [`parked-file-viewer.md`](parked-file-viewer.md) — covering-modal file
  viewer and park/restore; this pane is the intended later default for
  that flow when the Appearance setting is on.
- [`provider-agnostic-btw-asides.md`](provider-agnostic-btw-asides.md) —
  existing session right-column split for a focused `/btw` aside
  (≥1100px, collapsible handle, composer stays in the session column).
- [`source-control.md`](source-control.md) — workbench splitters: edge
  handles, keyboard resize, live reflow, persisted width.
- [`ui-architecture.md`](ui-architecture.md) — desktop sidebar
  expanded/collapsed/minimized modes.
- [`vanilla-defaults.md`](vanilla-defaults.md) — YA-novel chrome ships
  configurable and default-off.
- [`active-content-security.md`](active-content-security.md) — vhost Host
  dispatch and isolated origins for loopback HTTP apps.
- [`settings-ui-placement.md`](settings-ui-placement.md) — Appearance
  category; browser-local persistence.

## Product

The session page has one optional **right pane** owned by the visible
session. It is a layout, not a second transcript renderer. The session
column (messages, composer, status) stays mounted and remains the
primary conversation surface.

First consumer: a loopback HTTP app whose port is in the non-empty
static vhost table, discovered from tool output (Plannotator is the
worked case). Later consumers, including the parked file viewer, should
reuse this pane instead of covering the transcript when the setting is
on.

## Enablement

Two independent gates:

1. **Appearance → Session right pane**, browser-local, **default off**.
   When off, existing covering modals and park/restore stay as they are,
   and a discovered vhost URL is offered as a new-window link in the
   session App action. Opening requires a user gesture.
2. **Vhost-tool integration** requires a non-empty artifact vhost table.
   An empty table means YA has no Host to proxy, so loopback tool-output URLs
   are not rewritten. Configured artifact grant links remain eligible.

The Appearance setting may later drive file viewers into this pane even
when the vhost table is empty. File-viewer migration is not this slice.

## Layout

The wide/narrow cutoff is the same 1100px used for desktop chrome and
the `/btw` split (`DESKTOP_BREAKPOINT`).

### Wide (≥1100px)

Side-by-side columns: the complete session header (including provider badge),
transcript, status and composer stay on the left; the pane owns the right
column's full height. The transcript and embedded content each own their
scrollbar; scrolling either does not scroll the other or the outer document.
A vertical splitter between
them is keyboard-operable (arrow keys, Home/End) and pointer-draggable.
Its hit area occupies a separate strip inside the pane, outside the session
scrollbar's hit area. With two scrolling surfaces, wheel input goes to the
surface under the pointer. Forwarding wheel input from a non-scrolling
cross-origin frame requires cooperation from that app; YA cannot inspect or
intercept arbitrary embedded app events.
Pane width is persisted per browser. The session column may shrink to a
readable minimum but is never removed.

A detected-app action opens the latest discovered app, including after Close.
While the pane is expanded, that App action closes it completely without
creating a bottom-bar entry. The separate minimize button still parks it.
With the setting off it is a new-window link. V1 has one managed viewer:
opening another replaces it. Browser-style multi-view tabs and keyboard
switching are deferred to [the tab sketch](session-right-pane.sketches.md).

The sidebar shows a small App chip for sessions with a discovered app in this
browser. Discovery state is persisted per session/source; no background scan
of unopened session transcripts is needed. Replay restores link availability,
not an expanded pane.

Minimize parks the pane at the existing bottom viewer controller, returning
its width to the transcript. The iframe stays mounted so restore does not
reload it. App toggle dismissal destroys the pane content and removes the
bottom controller but retains the discovered app for reopening.

For a proxied app, the red × means **Kill app and close**. The server first
identifies the configured listener; stop rechecks its process identity before
sending SIGTERM. It refuses another user's process, YA itself, YA's ancestors,
or a listener that replaced the observed process. Kill clears the session's
known announcements and App chip even if signalling fails, with the failure
shown explicitly. New tool announcements can establish an app again. There is
no app-data deletion. Kill is separately gated by `vhost-app-control`; initial
host support is Linux with `/usr/bin/lsof` and `/proc`. Other hosts and older
servers retain App/minimize but show no Kill and make no control requests.

Artifact links use the same pane but have no process to kill. Their × clears
the session app entry; the existing grant expiry/ownership/deletion lifecycle
remains authoritative. The URL token is not the grant's management id, so
closing a discovered artifact URL does not send a guessed revocation request.

### Narrow (<1100px)

A right-edged overlay drawer, analogous to the mobile left sidebar:
expanded it covers the session with a small exposed left edge. No splitter.
Escape or the backdrop minimizes the drawer to the bottom controller.
Minimize/close semantics match the wide pane.
The expanded drawer covers the composer and its bottom controller; dismissal
lives in the drawer header until it is minimized. Wide panes leave composer
actions usable without automatically minimizing the pane. Modal-viewer
toolbar elevation and automatic parking apply only to covering viewers.

### Left sidebar

When the pane **expands**, the desktop left sidebar collapses to the
icon rail if it was expanded. That collapse is a layout override: it
does not write the stored sidebar preference. Closing or hiding the pane
restores the stored mode. The reader may expand the sidebar again while
the pane is open.

### Occupancy

At most one right-column occupant. While this pane is expanded,
a focused `/btw` aside does not also take the
right column; it keeps the composer sticky-card presentation. Opening
the pane does not change aside focus or lifetime.

## Vhost tool URLs

While a provider tool result (including still-running output) contains
an `http://localhost:<port>` / `127.0.0.1` / `[::1]` URL whose port
matches a vhost row, YA rewrites it to the browser-reachable vhost
origin:

- local YA (`localhost` / loopback client): use the configured local artifact
  origin's scheme and forwarded port with `<name>.localhost`
- hosted / public client with a vhost public root: `https://<name>.<root>/…`

`share.plannotator.ai` links are not the pane target; they are a
vendor share blob, not the live local app.

Only tool-result text is eligible; user prose, assistant prose, tool inputs,
and vendor share links cannot launch a pane. Discovery retains original
transcript bytes and creates a separate rewritten view. Old servers without
vhost metadata require no new request and expose no integration. Public
clients without a configured public root expose no unreachable loopback link.

Initial loaded output makes its latest discovered app available through the
App action without automatically opening it: historical URLs may point to
processes that have already exited. Reloading therefore does not resurrect a
closed or expired app pane.
Tool-result rows also display clickable app links, reconstructed from the
original output on replay without changing the provider transcript. Ordinary
click opens that app in the pane when enabled; with the setting off or a
modified click, the link opens a browser tab. The header App action remains
an additional shortcut to the latest app.

Subsequent tool announcements select and expand the newest app when enabled.
An announcement is identified by its source message and URL; replaying it
never opens it again. A fresh tool result can announce the same URL after an
app restarts. Loading older history must not supersede the current latest app.
Changing sessions isolates discovery and selection; inactive retained sessions
cannot collapse the current route's sidebar or open its drawer.

Source-code template placeholders are not app announcements, including their
URL-encoded forms. A fresh announcement reloads the frame even when its URL
matches the previous app; minimizing and restoring the same viewer preserves
its mounted content.

When `vhost-app-control` is available, expansion checks the configured listener
before loading the frame. A missing listener shows an unavailable-app message.
After a live frame has loaded, listener disappearance dismisses the pane
without parking it. Listener checks run every three seconds only for the
active, expanded pane in a visible tab; hiding, parking, navigating away or
closing releases the timer. Check failures show an error rather than claiming
the app exited. Older servers retain direct frame loading without new requests.

The pane header shares the file and artifact viewer window-action group:
**link, move to new tab, minimize, close**, in that order and style. An ordinary
left-click on the chain-link icon copies the viewer URL; Shift-left-click or
middle-click opens it in a new tab while retaining the pane. The separate
move-out icon opens the URL in a new tab and removes the pane. These are
user-gesture links with no opener or referrer. File viewers use their stable
YA viewer URL, including share scope where applicable, never a raw active file.
For a proxied app with a public vhost root, Copy link uses the public URL and
its app bearer, even when the pane itself is using the local origin.
The compact header retains the shared control sizes. YA tooltips belong to
the header controls, never to the embedded content area; entering the frame
dismisses any remaining YA tooltip. The frame keeps an accessible label
without a native hover title.

The pane hosts the rewritten origin in an iframe. Parent `frame-src`
already allows `http:`/`https:`. The frame uses no opener, no referrer,
and no YA credentials supplied by YA. It is sandboxed on the separate origin.
An observable parent CSP violation shows an explanation. Cross-origin frame
errors, app shutdown, and remote framing policies cannot all be detected by
the parent, so an Open-in-window action is always present.

## Design decisions

- **Transferable durable app bearers** protect proxied content from hostname
  scans. [Active-content security](active-content-security.md#private-app-links)
  owns token issuance, restart durability, revocation and the separately gated
  old-server fallback. Apps settings owns hosting; Appearance owns this layout.

- **Reuse existing version vhost metadata** rather than introducing a route or
  broadening an existing capability; absent metadata disables integration.
- **The existing single-viewer controller** rather than a second retention
  model: minimize goes to the bottom and Close unloads, as with modal viewers.
  Multiple viewer windows are a later, separately selectable display option.

## File viewer (later)

When the Appearance setting is on, opening a file, artifact, or other
managed viewer should present in this pane instead of covering the
transcript. Park/restore remains: minimize parks at the
existing composer controller; close destroys. Open ↔ minimize must reuse
the mounted viewer instance, the same invariant as today's open ↔
parked transition. That migration is a follow-up; this topic is the
layout contract it will use.

## Non-goals

- Dynamic `ya-vhost` PATH helper (still postponed).
- Auto-`window.open` without a user gesture.
- A second transcript renderer, or moving the composer into the pane.
- Changing default-on file viewing for users who leave the setting off.

## Implementation and verification

`sessionVhostApps` parses tool results and rewrites configured ports;
`useSessionRightPane` discovers apps only for the active route and publishes
the selected app to the existing single-viewer controller. `SessionRightPane`
owns the iframe and resize interaction. `SessionPage` owns the two-column
workspace, and `NavigationLayout` owns the temporary sidebar override.
`ViewerWindowActions` supplies the common header controls.

The browser regression in `packages/client/e2e/session-right-pane.spec.ts`
uses a 240-message transcript and a separate-origin review page. It covers
default-off persistence, header placement, separate scrolling and divider hit
areas, resize, minimize/restore without iframe reload, explicit close and
reopen, link gestures, and sequential composer typing during incoming updates.
File-viewer tests retain stable authenticated/share URL behavior. Live
Plannotator's own Done/feedback lifecycle remains owned by that application;
the browser fixture does not claim end-to-end coverage of its CLI.
