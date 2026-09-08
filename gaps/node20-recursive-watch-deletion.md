# Node 20.12 recursive watchers crash on file deletion

On Linux with Node 20.12.2, removing a watched transcript can terminate the
server with an uncaught `ENOENT` from `node:internal/fs/recursive_watch`.
`SharedDirectoryWatcher` calls native recursive `fs.watch`; Node's internal
callback calls `statSync` without handling a file that has disappeared. This
occurs before YA's callback or watcher error handler can recover.

The upstream [20.12.2 implementation](https://github.com/nodejs/node/blob/v20.12.2/lib/internal/fs/recursive_watch.js)
lacks the deletion catch present in [20.13.0](https://github.com/nodejs/node/blob/v20.13.0/lib/internal/fs/recursive_watch.js).
Browser E2E uses patched Node 20.20.0 so real transcript creation and deletion
remain covered. Unit tests, three-platform agent command tests, and npm
artifact checks retain Node 20.12. The published engine floor is unchanged,
so this remains a runtime limitation for users on the older patch release.

Moving the YA-owned Gemini project map outside its native session directory
removes one trigger but does not make arbitrary provider file deletion safe
on the affected runtime. Fully supporting it needs a safe recursive-watch
backend; alternatively, a separately reviewed runtime-floor change can require
the upstream fix. Neither broader change belongs to the agent self-inspection
feature. Do not suppress uncaught filesystem exceptions globally.

Found 2026-09-08 while running the full browser suite for ya-agent self.
