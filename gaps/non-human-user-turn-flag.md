# Non-human user-turn attention is not yet connected

Sessions receiving cross-session input still have no delivery-specific flag or
Inbox attention entry. Transcript text cannot reliably identify that input.

`SessionMetadataService` provides a private durable latest-delivery receipt and
an exact-message acknowledgement. Acknowledged receipts remain stored to avoid
raising attention again on replay. This is infrastructure only: no delivery
path records receipts, no API exposes them, and no UI consumes them yet.

Complete the feature by recording explicit sender provenance at actual turn
delivery, projecting the pending receipt into session lists and Inbox, and
navigating to its durable transcript identity before acknowledging it. Visiting
an older delivery must not clear a newer pending one. Forks and `/btw` context
imports should remain separate unless explicitly included.

The proposed `non-human-user-turn` capability and older-server fallback await
maintainer approval under
[`server-capabilities.md`](../topics/server-capabilities.md#minimum-compatibility-horizons).
The inspected optional-feature corpus is v0.8.0 and v0.8.1; neither provides
the new contract. Without the capability, the proposed client shows no flag or
additional attention and sends no new request fields. Existing capability
meanings remain unchanged.

Found 2026-09-14 while implementing non-human user-turn attention.
