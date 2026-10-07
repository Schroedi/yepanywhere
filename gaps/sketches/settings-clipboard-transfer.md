# Client settings cannot be copied between YA servers

A user running more than one YA server, such as a Linux workstation and the
Windows desktop app, has to recreate their client preferences on each one.
Browser preferences already have a transfer path (Settings → **Save from this
browser** / **Apply to this browser**, see `topics/settings-ui-placement.md`),
but its snapshot lives on one server, so it moves preferences between browsers
of that server, not between servers.

Sketch: a **Copy client settings** / **Paste client settings** pair that moves
the same allowlisted browser preference set through the clipboard.

- **Copy** writes one versioned JSON document
  (`{ kind: "ya-client-settings", version, sourceHostName, settings: {...} }`)
  built from the existing browser-settings-backup allowlist. Whether the
  server-persisted `clientDefaults` belong in it is open.
- **Paste** reads the clipboard, or a pasted text field where clipboard read
  is denied (plain-HTTP origins, some mobile browsers), validates the
  document, previews the changed preferences, and applies them through the
  same path as **Apply to this browser**, including its reload.
- The allowlist already keeps out browser identity, relay/auth and speech
  credentials, source-scoped state, drafts, caches, device ids, and recent
  projects, so nothing host-bound or secret enters the clipboard text.

Not pursued: copying server settings. Remote Access, Local Access, Apps, and
most path-bearing settings configure how one host is reached or what it
serves, and the maintainer has no use for server-settings transfer.

Related: `gaps/sketches/live-full-state-backup.md` covers a consistent full
backup of one server.

Found 2026-10-07 while setting up the Windows desktop YA beside an existing
Linux YA server.
