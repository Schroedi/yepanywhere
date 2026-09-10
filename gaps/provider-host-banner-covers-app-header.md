# The provider-host degraded banner covers the app header and blocks its clicks

`ProviderHostDegradedBanner` renders as a fragment sibling ahead of the routed
app in `App.tsx` and `RemoteApp.tsx`, styled `position: sticky; top: 0;
z-index: 10000`. The routed layout sizes itself to the full viewport
(`.session-page` is `height: 100dvh` in `packages/client/src/styles/index.css`),
so the banner does not push it down. It sits on top of the app header instead.

The header controls underneath are then unclickable. Playwright reported the
banner subtree intercepting pointer events for "Open sidebar" and "Session
options", and a full-page capture at 1000x600 showed the banner where the
header should be, with the dashboard content starting directly beneath it.

Any Linux user whose YA cannot start or attach a provider host sees this, which
is exactly when they most need the header to reach settings and logs. The
banner is not dismissible, so there is no way out of it in the UI.

The fix is a layout question, not a CSS patch on the banner: the app shell has
to reserve the banner's height rather than let a full-viewport child slide
under it. Other top-of-screen notices avoid the problem by different means —
`ConnectionBar` is a 2px fixed strip, and the reload banners float in a
bottom-right stack.

Found 2026-09-10 while closing the nine locally failing e2e specs, whose test
servers were reaching an incompatible provider host and running the whole suite
in this degraded mode. Those servers now get their own provider-host runtime
directory, so the suite no longer exercises the banner at all.
