# Client E2E CI cost ledger

This log records comparable browser-suite measurements for the
[E2E reduction plan](../tactical/135-e2e-suite-cost-ratchet.md). The
[run-level CSV](e2e-ci-cost-baseline-2026-09-27.csv) preserves the source SHA,
elapsed time, case count, and retry counts for each job. The
[case-level CSV](e2e-ci-case-baseline-2026-09-27.csv) preserves 336 observed
case identities, passing-run duration medians and 90th percentiles, and their
first-failure, retry-pass, and final-failure counts. Run IDs in the first file
resolve under `https://github.com/kzahel/yepanywhere/actions/runs/<run_id>`.

## 2026-09-27 baseline — 35 main-branch CI jobs

Source: the latest 35 completed `ci.yml` runs on `main` when sampled, from
[run 35909851714](https://github.com/kzahel/yepanywhere/actions/runs/35909851714)
at 2026-09-23 19:31 UTC through
[run 36312838295](https://github.com/kzahel/yepanywhere/actions/runs/36312838295)
at 2026-09-27 10:32 UTC. Each run used the single-worker `e2e-tests` job.
Thirty jobs passed and five failed; the listed case count grew from 318 to
334 across these changing commits. One successful
[334-case run](https://github.com/kzahel/yepanywhere/actions/runs/36312160095)
is the fixed reference for inspecting individual case durations.

| Measure | Median on 30 passing jobs | 90th percentile | What it includes |
| --- | ---: | ---: | --- |
| Entire `e2e-tests` job | 20m39s | 21m05s | Checkout, install, browser install, test command, cleanup. |
| `pnpm test:e2e` step | 20m06s | 20m33s | Shared/client builds, services, then Playwright cases. |
| Before `Running … tests` | 1m49s | 1m53s | Setup and builds inside the test command. |
| From `Running … tests` to step end | 18m16s | 18m40s | Serial case execution, fixture overhead, reporting, teardown. |
| Sum of reported case attempts | 17m42s | 18m08s | Includes retry attempts; excludes skipped cases and between-case work. |

The medians of these components are calculated independently and therefore
need not add exactly. The separate `pnpm install` and Playwright browser-install
steps had passing-job medians of 3s and 8s. The successful reference run used
about 1m51s before cases and 18m15s afterward; its reported case attempts
sum to 17m44s. Case execution dominates job time, while every focused run
also pays the setup cost unless it uses a narrower fixture.

### Slowest specs in passing CI jobs

Each value is the sum of Playwright's reported case-attempt durations for a
spec within a job. Medians and nearest-rank 90th percentiles use the 30 passing
jobs; they are prioritization signals, not isolated-spec wall time. All listed
specs appeared in all 30 jobs.

| Spec | Cases per job | Median | 90th percentile | Reference run |
| --- | ---: | ---: | ---: | ---: |
| `async-questions.spec.ts` | 1 | 72.0s | 78.0s | 78.0s |
| `relay-integration.spec.ts` | 13 | 56.9s | 57.5s | 52.5s |
| `slash-command-argument-completions.spec.ts` | 3 | 48.7s | 52.0s | 48.6s |
| `multi-host-secure-coexistence.spec.ts` | 14 | 47.0s | 49.3s | 38.5s |
| `all-sessions-search.spec.ts` | 15 | 39.7s | 41.3s | 40.3s |
| `remote-login.spec.ts` | 13 | 36.0s | 37.7s | 33.1s |
| `source-control-clean-landing.spec.ts` | 7 | 34.7s | 35.0s | 34.7s |
| `question-aside.spec.ts` | 1 | 34.5s | 35.0s | 34.3s |
| `file-viewer-comment.spec.ts` | 11 | 29.9s | 30.4s | 30.2s |
| `artifact-viewer.spec.ts` | 12 | 28.9s | 32.8s | 32.8s |

The earlier local run ranked All Sessions search first at 37.4s and async
questions second at 35.2s. CI reverses that order, with async questions taking
roughly twice as long as in the local run. Subsequent reduction slices should
use the CI ranking and report both environments separately.

### First two contract inventories

`async-questions.spec.ts` is one 797-line case that visits the session,
Settings, Inbox, and sidebar at desktop and phone widths. Its distinct browser
checks include focus and scroll preservation during a live message, reply
failure and retry through the server, cross-session counts delivered over the
activity stream, phone overflow controls, a 200-character real sequential
typing sequence, and an older-server capability fallback. Existing
`asyncQuestions.test.ts`, `AsyncQuestionsButton.test.tsx`, and
`useDrafts.test.ts` already cover some reminder aging, compact button text,
and draft source isolation. `QuestionAnswerPanel.test.tsx` covers blocking
provider interviews, not async questions, so it is not replacement coverage.
Compare each repeated state assertion with the relevant tests before moving
it. The [known timing gap](../../gaps/async-questions-e2e-flake.md)
reported two failures in four unchanged local runs on 2026-09-24.

`relay-integration.spec.ts` has 13 cases around real encrypted relay login,
bounded transfer, refresh/resume, stale saved URL, error paths, and relay route
navigation. Its transport boundary is not replaceable by a mocked component
test. All cases share remote-access configuration and teardown; setup and
duplicated page assertions are the first costs to inspect. The `!! Commands`
route case failed alongside its local and remote counterparts in four CI jobs,
so it needs a shared-cause diagnosis before a coverage decision.

### Failures and retries

Twenty cases failed on their first attempt across eight jobs. Seven passed on
a retry; 13 remained failed. Six jobs had at least one retry pass, including
two jobs that still failed for another case. The five failed jobs comprise four
jobs where the same three `!! Commands` cases failed together across local,
relay, and remote routes, plus one earlier job with a persistent Files API
case failure. The latest three-case failure followed an intervening passing
run, so its cause needs investigation before classifying it as a product
regression or intermittent test behavior. No job in this window stopped during
compilation.

The seven retry-pass cases were one each in `session-right-pane`,
`slash-command-argument-completions`, `page-keys-after-scrollbar-drag`,
`all-sessions-search`, `artifact-viewer`, `source-selection`, and
`question-aside`. The four failed `!! Commands` jobs account for 12 of the 13
persistent case failures. Retry attempts added 43s of reported case time to
passing jobs and 289s to failed jobs across this window. These are observed
replays, not an estimated flake rate: source revisions and case counts changed
throughout the window.

### First follow-up diagnosis

The latest failed job's `!!` local-command attempt reached a completed command
before its held POST receipt settled. The test reloaded immediately, so the
recovery draft remained in local storage and its reload assertion failed.
Retries then encountered a command left in the shared server. The relay and
remote route cases were asserting that the global history was empty, so they
failed after the local test even though their own navigation worked. The
fix waits for the receipt and draft clearance, removes this test's commands
after each attempt, and checks the destination heading in the two route
cases. A focused component test keeps the empty-history assertion. Two
focused repeats of each of the three affected cases passed on one shared
test server after the cleanup correction. A full CI run after the change is
still needed to confirm the retry trend.

### Collection method and next comparison

Run selection used `gh run list --workflow ci.yml --branch main --limit 35`.
Job and step timestamps came from the GitHub Actions jobs API. Case identity,
duration, attempts, and the `Running … tests` timestamp came from each job's
Playwright list-reporter log. The CSV records job and step durations to whole
seconds and derived durations to tenths; percentile figures use nearest-rank
ordering. The case-level file groups by spec path and full Playwright title;
its duration columns use only passing jobs, while failure counts use all 35.

After the first reduction slice, collect another fixed window with the same
method. Compare passing-job median and high-percentile wall time at comparable
case counts and revisions, and report first-attempt failures, retry passes,
and persistent failures separately. Keep the unique browser or transport
assertions beside each removed or moved case in the tactical plan.
