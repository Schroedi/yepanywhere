# Atomic rendezvous receiver

Extend [rendezvous uploads](../../topics/rendez.md) with a smart SSH receiver.
The first workflow uses ordinary scp or rsync; this command is deliberately
deferred, not required to enable the watcher.

Accept a project/route and filename as CLI arguments, with the entire stdin
stream containing file bytes. Choose a non-colliding destination, publish it
atomically, and deliver to the selected subscribers once. Share the watcher's
delivery records and observer locking so direct delivery cannot also trigger a
second send. A `.rendez/delivered/` destination or equivalent explicit
publication marker should make that ownership unambiguous.

Leave incoming originals untouched; retain the prepared snapshot for message
history. Do not turn this receiver into a required transport for ordinary file
copies. Broadcast subscriber sets and a recent-uploads UI remain separate
extensions.

User-directed deferral, 2026-10-18.
Contributing-model: gpt-6-astra
