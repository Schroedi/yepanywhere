# Server sandbox tests fail on macOS

Root `pnpm test` on macOS reported five failures across three server files:

- `test/session-sandbox.test.ts`, “names every missing host package in one
  blocker”: expected `bubblewrap, slirp4netns`, received
  `bubblewrap, util-linux`.
- `test/projects/template-creation.test.ts`: the limited-user sandbox setup
  returned 409 instead of 202; the production route fixture did not reach its
  expected completed project state.
- `test/routes/sessions-clone-claude-sandbox.test.ts`: both successful-clone
  cases returned 500; the first reported `ENOENT` opening
  `/proc/self/fd/15/project-clone-test` on macOS.

A focused rerun of these three files reproduced all five failures (14 passed,
21 skipped), independently of the desktop renderer and VM tests.

The desktop updater changes do not touch these server paths. Review the
fixtures' Linux capability assumptions and pinned-directory route setup;
exercise native Linux behavior separately from supported macOS fallbacks.
Do not weaken sandbox containment to make a non-Linux fixture pass. This is
deferred because sandbox policy and project creation are independent security
boundaries outside the updater repair.

Found 2026-09-28 while validating desktop manual-update feedback on a Mac VM.
