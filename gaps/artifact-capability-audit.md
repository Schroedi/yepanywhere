# Artifact server declarations fail the capability audit

`pnpm capabilities:audit` reports three errors for the isolated artifact
viewer even though its HTTP/browser tests pass:

- `packages/server/src/routes/artifacts.ts` declares `POST /`, mounted at
  `/api/artifacts` in `packages/server/src/app.ts`. The audit compares route
  suffixes and cannot match that root declaration to advertised
  `POST /api/artifacts`, producing two ownership errors.
- `packages/server/src/routes/version.ts` pushes the raw `artifact-viewer`
  string instead of using its registry entry.

Use `SERVER_CAPABILITIES.artifactViewer.name` for the version advertisement.
Keep the public HTTP URLs unchanged while declaring the artifact namespace
inside its owning route module and mounting it at `/api`, as other route
modules do. Verify create/configure/revoke through the actual app and rerun the
capability audit. Do not weaken the audit or advertise a different URL merely
to satisfy the check.

The matching client capability check is corrected. The server changes were
deferred because another active session held both shared server files; its
owner was contacted for clearance. The feature contract is in
[Active Content Security](../topics/active-content-security.md).

Found 2026-09-07 while finishing configurable artifact expiry.
