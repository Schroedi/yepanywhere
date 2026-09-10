# An unreachable dev server turns every lazy route into a fatal client error

In manual-reload development mode the reload-notify plugin rewrites every
dynamic import to go through `importFresh`
(`packages/client/vite-plugin-reload-notify.ts:69`), which calls
`checkGeneration` (`:59`) before the import, after it, and again on failure.
`checkGeneration` fetches the dev version endpoint and throws
"Could not check development source version" on any non-ok response (`:61`).

That throw is not caught. It surfaces through the route's Suspense boundary as
the client's fatal error screen, and any pane that had not loaded yet stays on
"Loading...". Observed 2026-09-10 at 20:10 while the Vite dev server on port
3402 was not answering and the YA server was returning 502 for it: the settings
pane died with that exact message and stack, and New Session never finished
loading.

Three things are missing:

- **No timeout.** The check inherits the client's general lack of a request
  deadline; see [client-requests-have-no-deadline](client-requests-have-no-deadline.md).
- **No retry.** A dev server restarting is the ordinary case this mode exists
  for, and it is transient by nature.
- **No distinction between the two answers.** "The generation changed" is a
  reason to reload the page, which the code does at `:65`. "I could not ask" is
  not evidence of anything, yet it produces a harder failure than a stale chunk
  would.

Cheap fix: bound the check with a short deadline, retry it a couple of times,
and on a still-unreachable dev server let the import proceed. A possibly-stale
chunk in a development-only path is a smaller harm than failing the route, and
the next successful check still catches a real generation mismatch. Do not
weaken the mismatch branch itself, which is the guard's actual contract.

Found 2026-09-10 while inspecting the client for blocking behavior under a slow
or unavailable server.
