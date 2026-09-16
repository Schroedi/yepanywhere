# Speech setup's capability routes disagree with its owned modules

The capability audit in the CI lint job fails with nine route-contract
errors for `speech-backend-setup`. It finds seven unadvertised owned routes
(`/xai-client-key`, `/xai-client-secret`, `/transcribe`, `/prewarm`, `/ws`,
counting HTTP methods separately) and two advertised `/api/settings` routes
that no owned module declares.

Observed in [CI run 35061217671](https://github.com/graehl/yepanywhere/actions/runs/35061217671),
job `lint`, at `3185fd39d`. Code lint and formatting passed before the audit.
The speech setup change predates the right-pane work. Reconcile its capability
metadata and module ownership under `pnpm capabilities:audit`; do not weaken
the audit. Server capability repair is outside the client pane change.

Found 2026-09-16 while reporting source CI for the session right pane.
Contributing-model: 6-Astra
