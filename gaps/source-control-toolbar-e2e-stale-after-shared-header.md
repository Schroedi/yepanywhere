# Source-control toolbar browser test targets the retired DOM shape

`packages/client/e2e/source-control-toolbar-layout.spec.ts` fails on `main`
because it requires `.git-diff-file-identity` and both control groups to be
direct children of `.git-diff-pane-toolbar`. Commit `5baeb32e5` moved those
elements under the shared `ViewerHeader.module.css` identity/actions containers,
so the test finds neither the title nor the groups and stops before measuring
the new layout.

The focused spec reproduces the failure independently of the full browser
suite. Fix it by restating its geometry assertions against the shared viewer
header contract; merely loosening the selectors would preserve the old
"identity below controls" expectation even though the new greedy-wrap design
puts identity first and wraps controls according to available width.

Not fixed in place because it belongs to the separate shared-viewer-header
change and needs that feature's intended geometry, not the sidebar session
freshness contract.

Found 2026-09-21 while running the full browser suite for sidebar session
reconciliation.
