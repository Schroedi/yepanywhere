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

Further evidence from the maintainer, same day. The session was known to be
active and known to have been started from YA's New session. It was absent
from both the sidebar's last-24-hours and starred sections. It was not hidden
as a duplicate title. Opening Agents or Projects located it easily. A capture of All Sessions filtered to the project listed it, titled "new
built-in /v /view autocompleting commands autocomplete UI…", second,
updated "just now", with a live "Thinking" status. So the server knows the
session, including its live state, and other client views list it; the omission is in
the sidebar feed's rows or its client-side membership, not in discovery or
the session catalog.

A full browser reload does not bring it back (maintainer, same day). That
rules out stale client state: a missed `session-created` or temporary-id
remap event, and a long-idle client's retained `knownGeneration`. The
omission reproduces from a fresh load, so it is deterministic in what the
sidebar requests (`/api/sessions?summaryMode=retained&limit=50`, `&starred=true`,
`&categorized=true`) or in how the client assigns those rows to sections.

Severity: high (maintainer: "bad gap"). A live owned session, including one
waiting for input, is invisible in the navigation the maintainer relies on.

First step: while such a session is live, request the three sidebar feeds as
the maintainer and check whether its row is present. If it is, the client's
section assignment drops it. If not, compare the feed's selection and ordering
(retained catalog, `createdByUser`, first-page limit) with the All Sessions
query that does list it.

Found 2026-09-30 while diagnosing a publish blocked by an active peer the
maintainer could not see. Contributing-model: opus-5.5

## Diagnosis — 2026-09-30

The sidebar reads `summaryMode=retained`, answered by
`readRetainedSessionItems` (`packages/server/src/routes/retained-session-collections.ts`)
straight from session-catalog rows. `useSidebarSessionOrder` places a row by
the latest of this browser's own interaction record, `lastHumanTurnAt` and
`createdAt`; a row with none of them has time 0 and files under Older.

- No catalog row carries `lastHumanTurnAt` (0 of 1,457 rows in the live
  catalog), and the retained read never sets it. The full-walk route does.
  So in retained mode the sidebar cannot place a session by a turn sent from
  another device. A browser idle for a day files such sessions by creation
  time or by its own old records.
- A Claude row gets `createdAt` only from a cached summary
  (`readFileRow` in `sessions/catalog-adapters/collection-catalog-adapters.ts`).
  Without one, the title and recency come from bounded head/tail reads and
  `createdAt` is omitted. A live session is appended to constantly, so it
  rarely has a cached summary: 49 rows lacked `createdAt`, and they were the
  newest Claude sessions, including `49c4a527`, the current session and the
  2026-09-28 `ec451911` case above.
- The current session showed only because this browser recorded sends to it.
  `49c4a527` was started from this browser, but its first send was recorded
  before the temporary id became canonical, so it had no local record either.

Fix owner: the catalog row, so the retained read keeps the full walk's
contract. Carry `createdAt` from the transcript head's first timestamp and
`lastHumanTurnAt` from the summary or the tail window (the same per-entry
human-turn test the summary uses). Pass both through the retained read. Bump
`FILE_ROW_FORMAT` so existing rows are re-read. Separately, move a local
interaction record from a temporary id to its canonical id on remap.

Diagnosed 2026-09-30. Contributing-model: opus-5.5
