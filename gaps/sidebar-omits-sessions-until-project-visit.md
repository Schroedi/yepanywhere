# Sidebar omits existing sessions until their project is opened

The maintainer reports (2026-09-28) that their own sessions often do not
appear in the sidebar until they navigate to them under Projects, and suspects
a regression from list "optimizations" in the preceding weeks.

Same day, as the superuser, limited user archer's sandboxed session
`ec451911-5a06-4821-9d2b-e6ed911e9d93` (project
`/home/graehl/archer/scooter-parkour`) was absent from the superuser's
sidebar. It was present in the server's newest session-catalog generation,
with `updatedAt` 07:38 UTC. The server had restarted at 07:52 with the
sandbox-transcript listing fix (`02f02fb90`), and its catalog row read from
the sandbox provider root. So the row existed on the server while the client
list lacked it. Archer's own sidebar showed it. The session had lost its
`createdByUser` (fixed going forward by `e075e4e01`). That changes which
section the row belongs in, not whether it is listed.

Not yet diagnosed. Candidate owners: the sidebar feed's first page
(`SIDEBAR_SESSION_FEED_LIMIT` 50) and its load-more trigger, the conditional
`knownGeneration` read answering `unchanged` to a client whose rows predate a
new session, retained-catalog mode versus the full walk, and the client
store's query membership when a `session-created` event was missed while the
feed was inactive. See `topics/session-catalog-observation.md` and
`topics/sidebar-session-ordering.md` § Storage and ownership.

First step: reproduce with an isolated instance. Create a session while the
sidebar feed is inactive, or from another principal, then compare the
`GET /api/sessions` rows with the client's query records.

Found 2026-09-28 while building sidebar categories and per-user sections.

## Isolated startup hold defect — 2026-09-30

A faster built-client read-state fixture reproduced a separate omission: the
sidebar opened while its feed was loading, captured an empty interaction layout,
and kept showing “No sessions yet” after HTTP responses contained the expected
row. The trace retained the main title and had no WebSocket row removal. A
controlled hook regression reproduces the omission against the original code.
The sidebar now admits its first population under a stationary pointer/focus
and holds that populated order against later arrivals and reordering. The E2E
still opens while loading; it does not move the pointer or wait away the defect.
This explains that isolated failure, not the maintainer's earlier incident.
Keep the original cross-principal/catalog investigation open.

## Active YA-started sessions missing — 2026-09-30

The maintainer reports that sessions started in YA and still active often do
not appear in the sidebar at all, most often on a device last used about a
day earlier. Concrete case: Claude session
`49c4a527-7256-4fac-83eb-59c70c0f7f8f` in this project was started in YA
(server log: temporary id `ec36d654-98ba-46fa-af3f-80791f8b4249`, remapped to
the canonical id and registered at 16:28:11 UTC). Its last transcript write
at 16:30:23 was a question awaiting the maintainer. It kept a fresh
`.agentctl/active` entry that blocked `publish.sh`, yet the maintainer had not
seen it and assumed there were no active sessions. An owned session waiting
for input is exactly what the sidebar must never hide.

Additional candidate owners, beyond those above: the temporary-to-canonical
id remap (`session_id_mapping_updated`) reaching a client whose list holds
neither id; and a client resuming after a long idle with a retained
`knownGeneration` that the server answers `unchanged` or with a page that
excludes rows created while it was away. First step for this case: on a
browser profile idle for a day, start a session from another tab or device
and compare `GET /api/sessions` rows with the client's records before and
after the `session-created` and remap events.

Found 2026-09-30 while diagnosing a publish blocked by an active peer the
maintainer could not see. Contributing-model: opus-5.5
