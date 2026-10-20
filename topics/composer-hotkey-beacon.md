# Composer hotkey beacon

> A session tab exposes composer recency and acknowledged sends in its title so a desktop hotkey helper can focus YA and return to the previous application.

Topic: composer-hotkey-beacon

## Use and scope

Keep YA selected in a dedicated Chrome window on the second monitor. The
desktop helper saves the game's window handle, finds the most recently focused
YA composer, activates its window, and sends **Ctrl+Alt+Shift+F8**. YA focuses
the existing composer without replacing its draft or selecting its text.
After an accepted send, the helper restores the saved game window. A second
hotkey press or Escape can return manually. The normal Enter/Shift+Enter
behavior remains authoritative; YA does not intercept the operating system's
global keys or manage native window focus.

**Composer Hotkey Beacon** is a browser-local Appearance setting beside the
tab-title activity and project-code options. It defaults **on**, explicitly
requested by the maintainer on 2026-10-20. Disabling removes both the suffix
and shortcut; settings undo and browser-settings backup include the choice.
There is no server endpoint, capability or authentication change. Existing
direct and encrypted-relay submission paths retain their normal semantics.

The beacon applies to the mounted, current session's main composer. Parked
session views, focused `/btw` main-composer modes, and non-session routes do
not advertise it. It does not discover inactive Chrome tabs. The selected tab
must remain visible in its window for ordinary OS window-title matching.

## Version 1 title protocol

Human title formatting runs first: unread counts, host identity, full project
names or short project codes, and optional activity pulsing. Then YA appends:

```text
<normal title> <optional glyph> [YA1 f=1792526000000 r=1792526000100 a=0 s=idle]
```

Fields are ASCII and always in that order:

- `f`: local epoch milliseconds of the most recent composer focus, monotonically
  increasing within this mounted session. Zero means not yet focused. Choose
  the largest positive `f` among candidate Chrome windows before activating
  any of them. Recency does not persist through reload or navigation.
- `r`: invocation token. The shortcut publishes a fresh nonzero timestamp only
  after the editable composer actually holds focus. Zero means not armed.
- `a`: the invocation token whose submission YA accepted. Zero until acceptance.
  A helper waits for a fresh `r`, saves it, and returns only when `a == r` for
  that saved invocation. An old asynchronous completion cannot acknowledge a
  newer invocation or another mounted session.
- `s`: latest main-composer submission state: `idle`, `sending`, `queued`,
  `delivered`, or `error`. It is independent of whether the helper is armed.

Glyphs are `↥` for an unacknowledged send (including attachment preparation),
`◷` for an acknowledged deferred send, `✓` for an acknowledged direct/steered
send or a deferred send subsequently seen in the transcript, and `!` for a
failed send. There is no focus glyph. `✓` does not mean the agent has finished
answering. The suffix describes this tab's latest submission during the current
mount, not every message or a durable delivery history.

AHK should ignore glyphs and match the bracketed fields anywhere in the OS
title, allowing Chrome's own trailing application name. The title contains no
session IDs, message text, credentials or cross-device discovery information
beyond whatever the ordinary human title already reveals.

## Completion and cancellation

The send path captures its invocation before awaiting uploads or network
delivery. A direct/resume acceptance or confirmed deferred-queue acceptance
sets `a` to that invocation; a rejected send never does. Normal draft recovery
remains in place. The helper can return on queue acceptance without waiting for
queue release or the assistant's answer. Transcript evidence can confirm a
direct send even if its HTTP response was lost, matching existing YA behavior.

Leaving the window or hiding the tab clears the armed invocation; it preserves
recency and the delivery glyph. Navigation, changing the source/session,
parking the session or disabling the feature removes its ownership. The helper
must also cancel its watcher if another window becomes foreground, the beacon
disappears, or its invocation changes. Never reactivate the game in response to
an unrelated future send.

## Design decisions

- **Title suffix rather than Unicode-styled first letters:** the beacon does
  not conflict with project-code pulsing, and remains machine-readable even
  when Chrome visually truncates the tab title.
- **Native helper owns focus:** browser JavaScript cannot reliably activate a
  particular game window. No extension or extra server transport is needed
  when the YA tab stays selected.
- **Acceptance rather than Enter:** a keypress alone cannot prove successful
  delivery. The helper leaves YA visible on failure and restores the game only
  after the acknowledgement for its own invocation.

## Verification boundary

Hook integration tests cover title-option composition, stale completions,
blur, settings disablement, errors and queue-to-transcript transitions. The
browser case exercises the real session composer with controlled network
responses, sequential typing against a populated transcript during title
updates, readiness, send failure/recovery, successful acceptance, and the
Appearance setting. Windows AHK activation and the specific game's fullscreen
behavior require verification on Windows; a browser test cannot establish them.
