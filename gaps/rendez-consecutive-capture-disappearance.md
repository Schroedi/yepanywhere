# Consecutive rendez captures disappear from view

The user reports two consecutive captures disappearing after the session
composer countdown feature was added. The affected surface and exact capture
pair still need identifying; do not treat a successful reload as a fix.

The inspected session's latest 25 accepted capture records each matched one
provider user message. Its newest inbox files also had accepted receipts.
A fresh browser rendered the recent consecutive image turns, and every image
in the inspected tail loaded at its expected width. This rules out permanent
intake loss for those inspected files, but does not explain the reported
transient disappearance. No production change was made on a guessed cause.

Reproduce across the live composer, its countdown transition, manual Send,
and streamed history. Check whether an attachment arriving during an earlier
submission's acknowledgement survives draft clearing. Identify the exact
missing capture before attributing this to that race or to transcript display.

Found 2026-10-26 while repairing publish checks and investigating the user's
consecutive-capture report.
Contributing-model: 6.1-Sol.
