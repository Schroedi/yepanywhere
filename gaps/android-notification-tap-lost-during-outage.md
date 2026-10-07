# Android loses a notification destination when its lookup is offline

The `android-notification-offline` emulator experiment delivers a real FCM
notification after proving the app process absent. The previously selected tab
is Inbox. It then refuses the app's server sockets, taps the notification in the
system tray, waits 16 seconds and restores connectivity. Inbox and its sidebar
recover, but the requested session never opens within three minutes. Native
preparation and cleanup both pass. The absent session composer is not evidence
that its persisted draft was deleted; the app is on the wrong page.

`MainActivity.routeLaunch` consumes the notification's extras before requesting
`/version` and the authenticated destination route. It catches every noncancelled
exception and drops the action. A temporary connection failure is therefore
indistinguishable from a revoked or inaccessible destination.

Retain the pending tap across recoverable connection failures and retry it when
the existing connection owner becomes ready. Keep normal foreground recovery
visible; do not invent an independent background retry loop or accept a project
path from push payloads. Recheck the binding before opening, cancel superseded
work, and continue treating revoked/authentication failures as terminal.

This is an Android tap-routing escape. Browser web push has a separate service
worker/navigation path, so a Chrome cold-open during outage is only a partial
comparison; those URL-restoration experiments recover successfully. Native real
FCM delivery itself succeeded. The first online control exposed an observer
replacement defect; the corrected control passes. Two isolated offline-tap
runs remain on Inbox for the full observation window.

Found 2026-10-07 while investigating Android lifecycle hardening.
