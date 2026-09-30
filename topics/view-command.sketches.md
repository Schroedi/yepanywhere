# `/v` view command — sketches

Candidate designs that extend the [view command](view-command.md) contract.
Not current guidance; routine topic reads exclude this file.

## Custom completion surface

Status: candidate design, requested 2026-09-30 alongside the first
implementation, which deliberately reuses the `@` completion menu under the
composer (basename, parent, tier badge; Tab/click inserts, Enter opens).

That menu is a list of paths. Picking a file the user only half remembers,
or an agent named loosely, is a finder task, and the finder conventions users
already know (VS Code Quick Open, fzf, Sublime Goto Anything) differ from it
in three ways worth borrowing:

- **Show why a row matched.** Highlight each part's matched span in the path,
  so `/v rep tab` visibly lights `rep` and `tab` in `src/report/table.ts`.
  This needs the server to return per-part match offsets alongside each entry
  (an additive response field under the same capability, or a new one if
  shipped after 0.9.4). Without offsets the client would have to re-run the
  matcher and could disagree with the server's anchoring and case rule.
- **Show the file before opening it.** A preview column (desktop) or an
  expandable row (phone) with the first lines of the highlighted file, or the
  cited line range when the draft carries `:line`. It should read through the
  existing file endpoint with a small range, cancel on highlight change, and
  never block keystrokes; see the typing-latency rule in `AGENTS.md`.
- **Group by source, not only rank.** Section headers for *exact*,
  *mentioned in this session* (with a jump-to-turn control reusing the
  composer-recall `scrollToTurnRequest` path), *tracked*, *untracked*, and an
  explicit *Search ignored files* row. That row replaces today's
  submit-only ignored scan with a visible, opt-in action, so the cost is
  chosen rather than implied by Enter on an empty result.

### Shape

A composer-anchored sheet that grows upward from the composer (as the recall
drawer does, see [composer-recall-drawer](composer-recall-drawer.md)), rather
than a global command palette: `/v` stays a composer command, the draft stays
the query, and draft recovery stays the composer's existing contract. On a
phone the sheet takes the transcript area above the keyboard with full-width
rows at the existing touch-target height; the preview becomes an inline
expansion on the highlighted row.

Keyboard: arrows move, Tab inserts the highlighted path (unchanged), Enter
opens it (unchanged), Right on a directory-anchored row narrows the anchor to
that directory, Ctrl+Enter opens without closing the sheet so several files
can be looked at in turn. The one managed viewer still holds one file at a
time; tabs belong to the [parked file viewer](parked-file-viewer.sketches.md)
side-by-side sketch, not to this surface.

### Shared with `@` completion

`@` inserts a path into the prompt; `/v` opens one. The same sheet could serve
both with a different acceptance verb, which would also give `@` the match
highlighting. Keep one inventory, one matcher on the server, and one sheet
component with the verb as a prop; do not fork a second menu.

### Open questions

- A shortcut that opens the sheet with an empty `/v` draft (Ctrl+P conflicts
  with browser print; Ctrl+Shift+O and a toolbar entry are candidates). A
  toolbar entry would be default-visible chrome and needs its own
  vanilla-defaults decision.
- Whether a per-project most-recently-opened list (not just transcript
  mentions) should rank first. It needs browser storage keyed by server and
  project, like `@` completion's enablement flag, and a bound.
- Whether the New Session composer should open files through a modal viewer
  or navigate to the standalone file page, since it has no session viewer.
