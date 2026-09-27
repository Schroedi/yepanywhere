# Early typing handoff

> Any navigation whose point is to leave the user typing must take focus in
> the commit that creates the field, and where the field cannot exist yet,
> hold the keys struck in between and hand them over in order once it does.
> Retirement waits for the field to hold focus and already show what was
> taken, is bounded so a field that rewrites its own text cannot trap the
> keys, and repairs the caret when it ends that way.

Topic: early-typing-handoff

Status: implemented for reverse search, session entry with a prefilled or
focused composer, both rename fields, and the new-session prompt (2026-09-19).

## Why

A dropped keystroke is never acceptable
([AGENTS.md](../AGENTS.md) § sequential typing), and deferred focus drops
them silently: between asking for a typing target and that target holding
focus, keys reach whatever had focus before. In YA that is usually the
transcript, where single letters are shortcuts, so the keystroke is not just
lost but acted on.

The observed shapes, all of which existed at once:

- **A frame.** Reverse search focused its query input in a
  `requestAnimationFrame`, and that frame also called `select()`, so a
  character typed in the gap was left selected and the next keystroke
  replaced it. CI caught it as `"ho"` typed and `"o"` read.
- **A timer.** Both rename fields focused from `setTimeout(…, 0)`.
- **A passive effect.** The new-session prompt focused from a mount effect,
  which React runs after paint. React does flush the effects of an update a
  click or key handler made before the next event, but the same effect run
  after a navigation or an asynchronous load waits for paint, so rule 1 does
  not lean on that distinction.
- **A whole load.** Entering a session with `composerPrefill` or
  `focusComposer` could only reach the composer once the session had loaded,
  because that is when the composer exists.

## Contract

1. **Focus in the mounting commit.** Use a ref callback, not an effect, a
   timer or a frame. A field that exists when the request is made is focused
   synchronously in the handler.
2. **Hold the keys when the field cannot exist yet.** Start the handoff at the
   request, not at the arrival, and write the held characters into the state
   the field will render, so they are simply its initial value.
3. **Hand over on evidence, per key.** Retire when the field holds focus *and*
   already shows everything taken so far, then let that key through. Retiring
   earlier lets a key report a value missing held characters and overwrite
   them; retiring later keeps intercepting after the user clicks elsewhere.
   There is no pending-key queue to transfer, so this per-event check is what
   makes the switchover gapless.
4. **Bound the wait.** A field that rewrites what it is given never agrees, so
   focus alone retires the handoff after `attempts` (focus plus one key), and
   that escape puts the caret after whatever the field shows: at most the last
   character is out of order.
5. **Bound the hold.** An unclaimed handoff stops intercepting after 15 s
   rather than for the rest of the page's life. Expiry ends interception only:
   keys it already took were kept from the page, so it still delivers them
   to a field that claims later, such as a composer behind a slow session
   load. Keys struck after expiry reach the page as usual. Only an abandoned
   request (a new navigation, leaving the page) forgets the held keys.
6. **Take printable keys and Backspace only**, and only for the span of one
   request. This is not a general keystroke recorder, and modified or named
   keys keep reaching the shortcuts they belong to.
7. **Respect the caret the action intends.** Held characters go where the
   request meant them to go relative to any prefilled text — after it for a
   prefilled composer — and the caret ends after them. Where the text arrives
   after the keys and was never shown while they were typed (a new-session
   launch seed that is still being fetched), the typed text follows it as its
   own paragraph unless the seed already ends in whitespace.
8. **A refused commit keeps its field rather than refocusing it.** Enter
   commits in place, and the field stays focusable while a save is in flight
   (read-only, not disabled), so a refusal leaves the user typing in it with
   no later focus call. A commit started by leaving the field does not pull
   focus back from where the user moved it.

## Where it lives

`packages/client/src/lib/earlyTypingHandoff.ts` owns the mechanism;
`startEarlyTypingHandoff(sink?)` takes a sink when the field already exists
and buffers internally when it does not, replaying in order on `claim`.
`packages/client/src/lib/earlyComposerTyping.ts` adapts it to a composer's
`DraftControls`, which is why that interface exposes `isFocused`.

Call sites: `useMessageListIsearch` (reverse search),
`SessionPage` (`flushEarlyComposerTyping`, claimed from the navigation effect
or from `handleDraftControlsReady`), `NewSessionForm`, `SessionListItem` and
`SessionPage`'s title rename, and the Projects card's `ProjectCaptionEditor`
and `ProjectCodeNameEditor` (focus only — those fields mount with their row,
so there is no window to hold; the two Projects editors also follow rule 8).

## What does not need it

A request handled synchronously in its own event already satisfies the
contract: `useSourceSearchShortcut` focuses and selects the commit/blame
search field inside the `/` keydown handler, so no key can fall between.
Fork deliberately takes no focus at all (`RestartSessionModal` passes
`autoFocus={!isFork}`), so there is nothing to hold.

## Not covered

An IME composition begun before the field exists cannot be carried across:
`keydown` reports only `Process`, and the composed text belongs to whatever
element held focus. Composition-heavy input still depends on the field
existing early, which is what rule 1 is for.
