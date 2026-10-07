# Reconnecting reports retained draft attachments as unavailable

Android App CI [498](https://github.com/kzahel/yepanywhere/actions/runs/37679085281)
failed the wake and real-network-restoration page checks because the session
composer repeatedly showed “Draft attachments were no longer available.”
The connection recovered. The fixture had a draft containing a prior upload.

The matched desktop web experiment `browser-attachment-wake` independently
reproduces the same warning with a newly uploaded `lifecycle-draft.txt`: freeze
the page, refuse sockets, resume while still offline, then restore connectivity.
The final attachment chip is present and the draft remains intact. Thus this
is a shared client defect, not a reason to change web reconnection policy.

`SessionPage.hydrateDraftAttachments` and `NewSessionForm` interpret a rejected
validation request as missing attachments. With draft synchronization enabled
they preserve references but show a false warning; the legacy path additionally
clears references. A temporary transport failure proves neither expiry nor loss.
Preserve the draft during interrupted validation, and retain the existing warning
for a completed server validation that actually reports missing references.

Recorded before repair as an emulator/CI escape; the existing request tests did
not exercise draft-attachment hydration. The hardening report records matched
runs and the eventual owning-layer regression checks.

Found 2026-10-07 while investigating Android lifecycle hardening.
