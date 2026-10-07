# Android CI rebuilt the minified live probe beside its running emulator

Internal-release run 503 on `8610677ef` passed build/lint/package inspection
and ordinary instrumentation, then stopped producing output at
`:app:minifyBundledDebugWithR8` during live-probe preparation. The same source's
ordinary Android verification run 502 passed both gates. Run 503 then exceeded
the instrumentation job's 30-minute limit and publication was skipped.
Resource starvation remains an inference, not an established diagnosis.

The workflow's pre-emulator build prepared ordinary Debug APKs. The later
`test:live` runner enables both `yaNativeProbeCleartext` and
`yaNativeProbeMinify`, requiring another build and R8 shrinking after emulator
startup. This contradicts the existing goal of compiling before the emulator
to avoid competing with it. A stall at a build task is not evidence that a
reconnection assertion failed.

The local candidate uses the same minified fixture variant for prebuilding,
ordinary connected tests and live tests. The ordinary suite passes on the owned
API 35 emulator: 17 executed cases and 25 fixture-dependent assumptions, with
the full live direct/relay suite already passing on that minified variant.
Repeated local preparation completes in five seconds with both R8 tasks
up-to-date. No test, typing threshold, timeout or Release network policy is
weakened. Replacement internal-release run 505 on `7c7a1261c` was canceled after the
actual Release smoke found a system-bar contrast defect. Its duplicate
push-only run 504 was also canceled deliberately. The next repaired candidate
owns hosted confirmation.
Hosted confirmation is required before deleting this gap.

Found 2026-10-08 while waiting for the requested internal release.
