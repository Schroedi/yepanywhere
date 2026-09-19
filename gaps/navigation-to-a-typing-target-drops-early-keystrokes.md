# Navigation that lands on a typing target still drops early keystrokes

Reverse search now places focus in the commit that creates its query input and
holds keys at the window until then
(`packages/client/src/hooks/useMessageListIsearch.tsx`, `attachSearchInput` /
`startEarlySearchKeys`). Every other navigation whose whole point is to leave
the user in a composer or search field still defers focus by a frame or a
`setTimeout(0)`, so a key struck in that gap is lost — or worse, reaches a
single-key transcript shortcut.

The discipline this gap asks for, in order:

1. focus the field in the commit that mounts it (a ref callback), not in a
   later frame or timer;
2. where the field genuinely cannot exist yet — it waits on a fetch, a route
   change, or a parent that is still loading — install a receiver at the
   moment the navigation is requested, and write the buffered characters into
   the same state the field will render;
3. hand over on evidence, never on a timer: retire when the target holds
   focus *and* already shows every character taken so far — the focus event
   fires inside `focus()`, so in the normal case that is the same call that
   mounts it. Retiring earlier lets a key report a value that is missing
   buffered characters and overwrite them; retiring later keeps intercepting
   after the user clicks elsewhere. Bound the wait (a field that rewrites what
   it is given never agrees), and on that escape put the caret at the end so
   at most the last character is out of order;
4. buffer deliberately, not blindly: printable keys and Backspace only, and
   only from "the user asked for a typing target" until that target holds
   focus. Blanket capture-and-replay of all keystrokes is not wanted here,
   though it is worth revisiting if it collapses several of these cases into
   one mechanism.

Known or suspected targets, none verified against current code beyond the
grep noted below:

- **Fork, and any action that navigates to a prepopulated composer.** These
  carry a second requirement: the buffered keys must land at the caret the
  action intends relative to the auto-populated text (before it, after it, or
  replacing a selected region), not merely appended once the text arrives.
- **New session** (`components/NewSessionForm.tsx:1779`) — the `autoFocus`
  path focuses the prompt textarea from a passive mount effect, which React
  runs after paint rather than in the mounting commit.
- **Switch to a session** — entering a session is expected to leave the
  composer ready to type.
- **Session rename** — `components/SessionListItem.tsx:320` and
  `pages/SessionPage.tsx:5103` both focus-and-`select()` the rename input from
  a `setTimeout(…, 0)`. Mount-time focus keeps the select-all rename semantics
  while closing the gap; no buffer is needed if the input mounts with the row.
- **Source control / working tree** — believed to land focus on a typeable
  filter or search field somewhere in `pages/WorkingTreeBrowser.tsx` or
  `pages/CommitRevisionPane.tsx`; both currently focus rows, so confirm
  whether a typing target is involved at all before changing anything.

One thing a receiver cannot carry across: an IME composition started before
the field exists. `keydown` reports `Process` and the composed text belongs to
the element that held focus, so composition-heavy input still depends on the
field existing early. Worth stating in whatever topic documents this once more
than one target implements it.

`components/MessageInput.tsx:2288` and `:2320` also focus from a frame, but
that is completion acceptance on an already-focused textarea: the exposure
there is caret placement clobbering keys typed in the gap, a related but
distinct defect worth checking in the same pass.

Not fixed in place because each target needs its own check of what focus and
caret it intends, and the reverse-search commit was a CI fix that should not
grow a client-wide focus sweep.

Found 2026-09-19 while fixing the reverse-search e2e failure that traced back
to focus deferred one animation frame.
