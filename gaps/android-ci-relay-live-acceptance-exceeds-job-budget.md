# Hosted Android relay acceptance exceeded the combined job budget

Internal run 511 attempt 2 (`37704886933`) on `c3d828c98` passed build,
ordinary instrumentation and direct live acceptance (497.575 seconds; 17
reported tests including fixture assumptions). Preparation used about thirteen
minutes before emulator tests; the exact minified live APK reuse then took only
14 seconds, with 62 of 64 tasks up-to-date. The earlier duplicate-R8-build
complaint is therefore fixed.

The job reached its 30-minute limit during the relay group. That group's output
was buffered until process completion, so the last active test and its result
were lost. Neither a relay pass nor an application hang is established.
Publication was skipped. The failure screenshot and available log are retained
under `tasks/android-hardening-round2/`.

The candidate streams instrumentation output while retaining the full result
for existing acceptance checks. The combined build/emulator job has a bounded
40-minute allowance; individual test deadlines, the typing gate and every app
assertion remain unchanged. A full hosted replacement must establish both live
routes before publication. Do not silently retry app assertion failures.

Found 2026-10-08 during final internal-release verification.
