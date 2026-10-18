# Rendezvous uploads

> Rendezvous sends files copied into a project's `.rendez` directory to a
> selected agent session, including the session most recently messaged by the user.

Topic: rendez

Status: approved design, implementation in progress. The workflow below is the
intended interface; YA's monitoring setting and attachment presentation are not
yet wired end to end.

## Upload from another machine

Enable `.rendez` monitoring for the project, then send a normal message to the
session that should receive your files. The watcher creates a
`<project>/.rendez/latest-session` destination on the machine running the agent.
With SSH access to that machine, upload a screenshot from your desktop:

```bash
scp screenshot.png user@host:/work/project/.rendez/latest-session/
```

Replace `user@host` and `/work/project` with your SSH destination and project
path. This also works from Windows OpenSSH or a WSL shell. The receiving
machine watches the directory; your desktop does not need to invoke
`agentctl` or know the session id. Each completed upload becomes a user turn
with an attachment. It queues behind work already running and may resume an
idle session.

For repeated screenshot transfers, ordinary rsync preserves unchanged files:

```bash
rsync -a screenshots/ user@host:/work/project/.rendez/latest-session/
```

Use rsync's normal temporary-file-and-rename behavior; avoid `--inplace` and
`--append`. A closed file from an interrupted direct `scp` can be incomplete;
rsync's final rename provides a clearer completion boundary. Destination files
stay in place, so subsequent rsync runs can compare size and modification time.
The watcher compares file content to avoid redelivery of unchanged uploads and
to notice a filename overwritten with new content.

## Choose the recipient

`latest-session` follows the last session accepting an actual user message in
that project. Coordination requests, takeover notices, automated turns, and
rendezvous uploads do not change it. Once an upload is received, its recipient
is fixed. For an ongoing transfer stream that must stay with one session, use
the stable directory returned by an explicit subscription instead.

Monitoring is opt-in, with a global default and a per-project override.
The first creation adds `/.rendez/` to the checkout's local Git exclusions.
Disabling monitoring stops delivery without deleting the files.

## Files and attachment history

The incoming file remains the original. Delivery stores a separate snapshot
under `.rendez/delivered/<route>/<delivery-id>/`; large images may be resized
and compressed according to the receiving session's preparation profile.
Messages refer to this stable snapshot, so overwriting an incoming screenshot
does not change the image in an older message.

YA presents one attachment with its filename and thumbnail. The original can
be opened while its content still matches that upload; after an overwrite,
the retained prepared copy is sufficient. There is no permanent second archive
of full-size originals. Browser uploads keep their existing
[attachment storage policy](attachment-storage.md); enabling rendezvous does
not migrate them or require all attachments to share one storage directory.

## Optional helpers outside YA

The [graehl/agents repository](https://github.com/graehl/agents) supplies optional
subscription and watcher helpers, allowing the same directories to work with
YA monitoring disabled. See its
[rendezvous topic](https://github.com/graehl/agents/blob/master/topics/rendezvous.md)
for helper commands, delivery state, native-provider fallback, and the shared
protocol. Watching is an ordinary background process and consumes no model
turns while idle.

Broadcast subscriptions and an SSH receiver that accepts bytes, chooses a
non-colliding filename, and delivers directly without a duplicate watcher send
remain future extensions.
