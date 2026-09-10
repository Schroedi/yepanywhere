# The paragraph quote rail re-schedules itself every frame on an idle session

A session page left open on a transcript keeps calling `scheduleMeasure`
(`packages/client/src/components/ParagraphQuoteRail.tsx:134`) about 2,581 times
per second, from the intersection-observer callback at `:181`. Measured in a
headless Chromium viewer of a live session with the browser's own frame counter,
while the page was receiving well under ten WebSocket frames per second, so the
work is self-sustaining rather than driven by inbound streaming.

The frame guard at `:135` collapses those calls into roughly one measurement per
frame, but each measurement is `getBoundingClientRect` per visible block plus a
state publish (`:126`, `:130`), and the calls themselves are ~43 per frame,
which means the observer is re-firing with a full set of entries every frame.
The likely closure is `refreshBlocks` (`:187`): the mutation observer at `:215`
watches `content` with `subtree: true`, `refreshBlocks` re-observes every block,
re-observation makes the intersection observer deliver entries again, and its
callback schedules another measurement. That path is a hypothesis; the call rate
and its dependence on this component are measured.

The cost is not theoretical. In the same viewer the page held 58 to 60 style
recalculations per second and 7 to 8 layouts per second indefinitely, on a page
with 85 rendered rows. The work is proportional to the number of blocks
collected by `collectTopLevelBlocks`, so a long transcript pays more, and a tab
that never idles cannot let the browser rest.

The feature is on by default: `DEFAULT_QUOTE_REPLY_BUTTON_MODE` is
`paragraph-hover` (`packages/client/src/hooks/useQuoteReplyButtonMode.ts:12`),
and the rail is enabled whenever the mode is not `block`
(`packages/client/src/hooks/useMessageListSelectionQuote.tsx:64`).

Verified workaround, which also isolates the cause: setting Settings ->
Appearance -> "> Reply Buttons" to **Block only** removes that caller entirely.
Re-running the same measurement with the mode forced to `block` left
`ProcessingIndicator` at 6 calls per second as the top scheduler and no
`ParagraphQuoteRail` entry at all.

Cheap fix is not yet identified — the loop's closing edge has to be established
first. Two candidates: stop `refreshBlocks` from re-observing blocks it already
observes, and keep the rail's own rendered output out of the subtree the
mutation observer watches.

Found 2026-09-10 while investigating a hard client lock that ended in a renderer
kill.
