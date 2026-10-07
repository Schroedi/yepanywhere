# Server settings cannot be copied between YA servers

A user running more than one YA server, such as a Linux workstation and the
Windows desktop app, has to recreate each server's settings by hand. Browser
preferences already have a transfer path (Settings → **Save from this
browser** / **Apply to this browser**, see `topics/settings-ui-placement.md`),
but it deliberately excludes server-persisted settings, and it moves state
between browsers of one server, not between servers.

Sketch: a **Copy settings** / **Paste settings** pair that moves selected
settings through the clipboard.

- **Client settings only** is the likely intended boundary and the first
  offered scope: the same allowlisted browser preference set that **Save from
  this browser** transfers, plus the server-persisted `clientDefaults`. It
  needs no section checklist and carries nothing host-bound, so it can ship
  before the server-section mode below, possibly without it.
- **Copy** in the wider scope opens a section checklist and writes one versioned JSON document
  (`{ kind: "ya-settings", version, sourceHostName, sections: {...} }`) to the
  clipboard. Unchecked sections are absent from the document, not nulled.
- **Paste** reads the clipboard (or a pasted text field where clipboard read
  is denied, as on plain-HTTP origins and some mobile browsers), validates the
  document, and shows the same checklist limited to sections present. Each
  section shows a changed-fields preview against the current server. Applying
  replaces only the checked sections through the ordinary settings update
  path, so existing validation and capability gates apply. Sections the
  target server does not recognize are listed as skipped.
- **Default selection** follows portability. Behavioral sections are checked
  by default: new-session defaults, client defaults, prompt-cache keepalive,
  compaction and replay, compose/turn-timestamp, heartbeat and wake turns,
  global instructions, agent context hints, provider options (Codex reasoning
  summary and plan tool, Claude additional models), speech audio retention.
- **Remote Access, Local Access, and Apps are not offered.** Each configures
  how this host is reached or what it serves (relay identity, network binding
  and allowed hosts, artifact delivery, static vhosts, app links), so a copy
  is wrong on another server rather than merely suspect.
- **Other host-bound sections are unchecked by default** because their values
  name this machine's filesystem, network, or hardware and are usually wrong
  on another host: file access roots, project directory storage, artifact viewer,
  static vhosts and apps, remote executors, ChromeOS hosts, allowed hosts,
  host identity, host awake, gateway service export paths and start commands,
  Ollama URL, `yaClientBaseUrl`, public share viewer base URL, speech backends
  and GPU selection. They remain selectable for two hosts with matching
  layouts.
- **Secrets never enter the document**: lifecycle webhook token, API keys,
  relay and auth credentials, limited-user records and instructions, and any
  field the server's limited-user settings projection already withholds.
  The copied document is plain text on a clipboard and may be pasted into
  chat.

Open questions:

- Whether section membership is declared once in the server settings model
  (each field tagged portable, host-bound, or secret) so the exporter, the
  default checklist, and future settings cannot drift. A hand-maintained
  client list would silently export a new host path or secret.
- Whether the wider server-section mode is worth building once client-only
  transfer exists, or whether server settings stay per host.
- How paste reports a target server too old to accept a section's fields; a
  server capability is needed before the client offers paste for a section
  whose route an older server lacks.

Related: `gaps/sketches/live-full-state-backup.md` covers a consistent full
backup of one server; this sketch is a selective, human-reviewed transfer of
configuration only.

Found 2026-10-07 while setting up the Windows desktop YA beside an existing
Linux YA server.
