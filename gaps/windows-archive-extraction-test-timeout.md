# Windows archive extraction test still exceeds its measured timeout

Graehl's computer-control Windows job failed the test “native extraction
rejects traversal and handles a valid ZIP” in
`packages/server/test/computer-control-releases.test.ts` at 5,003 ms against
the default 5,000 ms timeout. The other 31 assertions passed.

Evidence: [failed Windows job](https://github.com/graehl/yepanywhere/actions/runs/35085176248/job/104758200265).
The [origin Windows job](https://github.com/kzahel/yepanywhere/actions/runs/35085173084/job/104758191096)
passed on the identical `28a58cf9b` commit; both repositories' Linux legs
also passed. This suggests a timing flake rather than a deterministic
platform failure. Measure native subprocess startup and extraction before
deciding whether the integration test needs a longer explicit deadline.

Found 2026-09-16 while reporting source CI after speech-backend publication.
This Windows test issue is outside the speech implementation scope.

2026-09-30: the test now has an explicit 20,000ms budget, based on the earlier
5,000ms failure and successful 3,348ms/4,051ms observations. It nevertheless
timed out at 20,003ms in
[CI 36692427921](https://github.com/kzahel/yepanywhere/actions/runs/36692427921/job/109812489685).
The same job's first Windows process-ownership case took 24,140ms; its later
cases took roughly one second. These observations do not establish contention
or identify the blocked extraction stage.

Capture elapsed times for child spawn, traversal rejection, valid extraction
and child exit, with bounded stderr on failure. Compare a serial native-file
run against the current parallel invocation before changing another timeout.
The native PowerShell helper permits 120 seconds per child while the test
permits 20 seconds for two calls, so also verify cancellation joins child exit
before the fixture directory is removed. No extraction assertion or deadline
was changed during the browser module-loading repair.
