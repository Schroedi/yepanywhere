# The project app panel loses keyboard focus while an agent works

A project app open in the session's right pane (an iframe, e.g. a game
board that takes moves from the keyboard) stops receiving keys during
agent activity in the same session. The user has to click back into the
app. Requirement (user, 2026-10-15): YA never takes keyboard focus from
the app panel without a user action in YA itself.

Observed 2026-10-15 in `~/oss` (`board/index.html`, a process-served app
taking arrow keys), while a Claude session was running turns that edited
files, including the project's `.project-template/app.json`. Not yet
reproduced in an isolated instance, so the mechanism below is a ranked
reading of the code, not a confirmed cause.

Candidates, under `packages/client/src/`:

- `hooks/useProjectAppUpdates.ts` re-reads app info whenever a turn starts
  or ends and sets `declared` to null when a reading has no declaration.
  `pages/SessionPage.tsx` (`projectAppEnabled`) then drops the viewer:
  the iframe unmounts and `SessionRightPane` goes `inert`/hidden. Only
  agent activity is needed to trigger it, for an app opened from the
  session's App button (a `projectAppTarget` keeps it enabled). A reading
  during an `app.json` edit or service restart can lack a declaration.
- Programmatic focus after an `await`, with no check that the user is in
  an embedded app (`document.activeElement` an `HTMLIFrameElement`):
  - `components/MessageInput.tsx`: refocusing the composer after a `!`
    command completes;
  - `contexts/AsyncQuestionsContext.tsx` (`returnToPrevious` →
    `focusComposer`): its "user moved away" check listens to parent
    `pointerdown`/`focusin`, which clicks inside a cross-origin iframe
    never reach;
  - `lib/speechComposerFocus.ts`: voice start/stop, including the app
    toolbar's mic;
  - `components/ui/Modal.tsx`: focus on mount of a modal that opens by
    itself.
- No code refocuses on every streamed message; nothing found reacts to
  deltas by calling `.focus()`.

Fix direction: route every programmatic (non-gesture) focus through one
helper that does nothing while an iframe holds focus, and keep the app
viewer mounted across turn boundaries while it is open (latch the
declaration rather than dropping it on one empty reading). The app side
can only mitigate: `~/oss` now shows "keys inactive" and refocuses on a
click.

Found 2026-10-15 while playing a puzzle board through the `~/oss` project
app during an agent session.
