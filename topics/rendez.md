# Rendezvous uploads

> Rendezvous sends files copied into a project's `.rendez` directory to a
> selected agent session, including the session most recently messaged by the user.

Topic: rendez

The current monitoring backend uses
the `rendez` executable from graehl/agents on the YA server's PATH. It requires
Linux for watching and `uv` on that PATH, which supplies Python 3.10+ and Pillow
for image preparation; no system image packages are needed.
Claude and Codex sessions are supported. Other platforms can use explicit scans
of completed transfers; filesystem watching does not require provider hosting.

## Enable monitoring

Monitoring defaults off. In **Settings → Message Delivery**, search for
`rendez` and enable **Watch .rendez uploads (Rendezvous)**. This changes the
global default immediately, preserving project overrides and burst limits.
Header Undo restores the global default from when the pane opened. A server
without the `rendezvous-uploads` capability shows update guidance instead of
a toggle; the client sends no unsupported settings write.

The optional-feature compatibility review covered stable v0.9.0, v0.9.1 and
v0.9.2, which lack the rendezvous settings field. The new capability has
permanent ID 131 and is version-implied from 0.9.4; it does not change any
existing capability's meaning.

Project overrides and burst limits remain available through the authenticated
`PUT /api/settings` API:

```json
{
  "rendezvous": {
    "enabled": false,
    "projects": { "/work/project": true },
    "windowMs": 1000,
    "maxPerWindow": 10
  }
}
```

Set `enabled` to `true` for the global default. Each absolute project-path entry
overrides that default; omit an entry to inherit it. YA checks live projects
every 30 seconds, with at most 32 observers. Turning the setting off stops its
observers; a helper failure is logged and requires a settings change to retry.

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
with an attachment. It queues behind work already running; latest-session
delivery is non-reviving by default. An inactive target is not resumed just
because another session in the project is live.

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

## Accidental bulk transfers

Uploads start immediately. By default, each route admits at most ten uploads
per rolling 1,000 ms, with at most ten uploads awaiting queue acceptance across
the project. `windowMs` and `maxPerWindow` configure those limits. Acceptance
can mean queued for the session; it does not wait for model completion.

Excess arrivals are **held**, never automatically sent later. After overload,
new arrivals remain held until four quiet windows pass (four seconds by
default). That reset applies only to future uploads. One additional message
says many files were uploaded, potentially unintentionally, and identifies the
held records under `.rendez/delivered/<route>/`. Those records include the
incoming paths and hashes; held originals are not separately archived.
An explicit helper `unhold` command can bypass the limit if needed.

The watcher ignores dot-prefixed temporary files and directories. Normal rsync
publishes completed files by rename; `--delay-updates` can produce a rapid burst
at the end, which these limits hold. Keep temporary files in rsync's usual
location or a hidden directory, not as non-hidden files inside the watched
inbox. [rsync manual](https://download.samba.org/pub/rsync/rsync.1)

## Choose the recipient

`latest-session` follows the last session accepting an actual user message in
that project. Coordination requests, takeover notices, automated turns, and
rendezvous uploads do not change it. Once an upload is received, its recipient
is fixed. For an ongoing transfer stream that must stay with one session, use
the stable directory returned by an explicit subscription instead.

Monitoring is opt-in, with a global default and a per-project override.
YA watches only projects with a verified live session, including sessions
known to the provider service but not owned by YA. Watcher ownership is
independent: YA can use its own live-session state when provider hosting is
disabled. An explicit helper subscription can opt into revival separately.
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

Broadcast subscriptions and the [atomic SSH receiver](../gaps/sketches/rendez-receive.md)
remain future extensions.
