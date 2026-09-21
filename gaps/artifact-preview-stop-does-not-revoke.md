# Stopping an interactive artifact preview leaves its grant usable

The full browser suite fails at
`packages/client/e2e/artifact-viewer.spec.ts:172`: after navigating within an
interactive preview and clicking "Stop interactive preview", the recorded
artifact URL still returns HTTP 200 instead of 404. The assertion exhausts its
five-second window. Earlier script execution, navigation, and isolation checks
in that case pass.

This contradicts the stop/close lifetime contract described in
`topics/active-content-security.md` and the current premise of
`gaps/artifact-grant-revocation-ui.md`. It is distinct from the deferred grant
inventory UI. The revoke request and grant identity need tracing; the failure
does not yet distinguish a missing request from revoking the wrong grant.

Not changed during the bang-command repair: that work does not touch the
artifact viewer or grant lifecycle. The full browser run stopped after this
first failure (25 passed, 2 skipped, 272 not run).

Found 2026-09-21 during repository-wide bang-command verification.
Contributing-model: 6-Astra
