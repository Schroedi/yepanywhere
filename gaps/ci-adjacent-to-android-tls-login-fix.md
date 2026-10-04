# Full CI has failures outside the native Android TLS login fix

[CI run 37169253484](https://github.com/kzahel/yepanywhere/actions/runs/37169253484)
at `2a5dae690` failed three jobs while native login was being reproduced and
fixed. The full macOS workspace unit suite passes locally. These CI failures
have not been reproduced or diagnosed completely:

- `packages/server/test/projects/HostedProjectServices.test.ts`, “keeps the
  same sandbox app across controller replacement and cleans up on worker-loss”:
  the child service exits with `listen EADDRINUSE` on loopback. Investigate
  ownership between port reservation and child startup rather than increasing
  a timing budget.
- `packages/client/e2e/ipad-home-screen.spec.ts`, limited-user relay login:
  both iPad WebKit and the ordinary browser shard cannot find
  `[data-testid="relay-limited-username-input"]`; all retries fail. Inspect the
  retained trace/screenshot and fixture login state before changing a selector.
- `packages/client/e2e/blob-retention.spec.ts`: the browser shard expects one
  `video[src^="blob:"]` and sees zero. Inspect the fixture's selected source
  and media-rendering boundary before changing the assertion. This case was
  introduced by the upstream commits incorporated in the rebase.

Kept separate because the current fix changes Android's native connection
dispatcher and its device acceptance caller, not these provider/browser
fixtures. Public TLS login from Main and the isolated production-R8 Release
form both pass on a physical Pixel. Android CI's build/lint/package job also
passes; its WebView job was still running at capture time. Do not report the
overall CI run as green based on those narrower results.

Found 2026-10-04 while preparing the Android 0.1.1 internal login fix.
