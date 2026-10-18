# Atomic rendezvous receiver

Extend [rendezvous uploads](../../topics/rendez.md) with a smart SSH receiver.
The first workflow uses ordinary scp or rsync; this command is deliberately
deferred, not required to enable the watcher.

## Shape

```bash
ssh host rendez --project oss receive [--route ROUTE] [--wait] 123/shot.png < shot.png
```

Like `rsync --server`, the remote side is one command reading the SSH
channel's stdin, so an upload-only key can be pinned to it with an
`authorized_keys` `command=` restriction.

- **Destination.** `--route` names a route; the default resolves
  `latest-session` once at the start, pinning the upload even if the pointer
  moves. With no observer marker, or the never-messaged placeholder pointer,
  it fails before reading stdin: the "nobody is listening" error a plain
  scp or rsync cannot give.
- **Name.** A relative path such as `123/shot.png` is allowed; absolute
  paths, `..` and dot-prefixed parts are rejected. Missing subdirectories are
  created inside the inbox. An existing name becomes `shot-2.png`,
  `shot-3.png`, and so on, keeping the extension.
- **Atomic publication.** Stream stdin into a hidden temporary in the target
  directory, refusing more than 64 MiB, and flush it; publish with `link()`,
  which fails if the name was taken meanwhile (then try the next counter).
  Watchers never see a partial file and concurrent receivers never overwrite.
- **Delivery.** None of its own: whichever observer runs (YA or
  `rendez watch --turns`) delivers through the usual records, so there is one
  claim and preparation path.
- **Output.** One JSON line once published, and with `--wait` another when
  the record is `accepted`, `failed` or `held`; the last two exit non-zero.
  Each line has `state` and `destination`: the path relative to `.rendez/`
  through the route's alias, such as `session-a/123/shot-2.png`. Its first
  component is the resolved route (the session id for `latest-session`
  uploads), so it stays unambiguous after `latest-session` moves.

Leave incoming originals untouched; retain the prepared snapshot for message
history. Do not turn this receiver into a required transport for ordinary file
copies. Broadcast subscriber sets and a recent-uploads UI remain separate
extensions.

User-directed deferral, 2026-10-18; output and naming settled the same day.
Contributing-model: gpt-6-astra
Contributing-model: opus-5.5
