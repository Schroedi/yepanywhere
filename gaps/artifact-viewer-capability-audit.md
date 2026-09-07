# Artifact viewer capability audit rejects its route ownership

`pnpm capabilities:audit` reports these artifact integration errors:

- `artifact-viewer owns POST / but serverContract.routes does not advertise it.`
- `artifact-viewer advertises POST /api/artifacts, but no owned route module declares it.`
- `packages/server/src/routes/version.ts checks raw capability "artifact-viewer"; import its registry constant/helper instead.`

The route module uses a root-relative handler mounted by `app.ts`; reconcile
that mounting with the audit's route ownership contract rather than changing
the public endpoint. Replace the raw capability check with the registry
constant. The active artifact session was notified and owns the fix; these
files overlap its in-progress work, so the async-question change leaves them
to that owner. An earlier raw check in `ArtifactPreview.tsx` was already
fixed by that session.

Found 2026-09-07 while verifying cross-session async question capabilities.
