# Project app and service Settings mockup

Isolated design fixture for [project service](../../../../topics/project-service.md).
Uses YA's real ProjectCard, English provider, router and theme stylesheet.
New service UI and the scooter illustration are fixture-only. All state is
local; no project is started, published, reserved or removed.

```sh
pnpm --filter @yep-anywhere/client exec tsc -p mockups/project-service/tsconfig.json
pnpm --filter @yep-anywhere/client exec vite build --config mockups/project-service/vite.config.ts
pnpm exec tsx packages/client/mockups/project-service/capture.mts app
pnpm exec tsx packages/client/mockups/project-service/capture.mts settings
pnpm exec tsx packages/client/mockups/project-service/capture.mts session
```

The exported entry is `.artifacts/mockups/project-service/index.html`.
The review strip switches App, Settings and Projects, principal, vhost feature
availability and service/static/artifact content. Settings includes a previous
reservation by default. More preview states allows a new reservation or stopped
service. Limited-user removal hides the sample project; switch to superuser
and Projects to inspect the retained audit state and restore it. No real
authorization or runtime behavior is established by this fixture.

The viewer band demonstrates Back, new tab, copy, conditional Share, new session
and microphone entry. The microphone transition shows a new project session
with the app alongside it and simulated listening; it never accesses hardware.
Capture checks these local transitions, sequential typing, feature gating and
personal removal/superuser retention, then emits 1200×600, 1000×600 and 375×812
captures through the artifact facility. An authenticated grant may be refused
by the running server; the HTML file-viewer link and captures remain available.
